import crypto from 'node:crypto';
import express, { type Response } from 'express';
import { z } from 'zod';
import {
  firebaseConfig,
  getMessagingStatus,
  getPaymentGatewayStatus,
  serverConfig,
} from '../config.ts';
import { verifyFirebaseIdToken } from '../firebaseAuth.ts';
import {
  firestoreDeleteDoc,
  firestoreGetDoc,
  firestoreListCollection,
  firestorePatchFields,
  firestoreQueryByField,
  firestoreSetDoc,
} from '../firestoreRest.ts';
import {
  EMAIL_PERMISSIONS,
  hasEmailPermission,
  hashApiKey,
  hashInvitationToken,
  isEmailLocked,
  recordFailedAttempt,
  requireAdminAuth,
  requireDeptInvitationManager,
  requireEmailPermission,
  requirePermission,
  requireStaffManager,
  requireSuperAdmin,
  resolveScopedDepartment,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { authAttemptRateLimiter } from '../middleware/security.ts';
import { openApiSpec } from '../openapi.ts';
import {
  checkEmailDomainAuthentication,
  extractPlainText,
  inspectGmailOAuthToken,
  processDueScheduledEmails,
  recordWebhookDeliveryEvent,
  rememberAdminSessionToken,
  renderPersonalizedVars,
  resolveEffectiveSenderIdentity,
  retryCampaignFailedEmails,
  runBulkCampaign,
  sanitizeEmailHtml,
  schedulePlatformEmail,
  sendInvitationEmail,
  sendPhoneOtpSms,
  sendPlatformEmail,
  sendStaffVerificationEmail,
  syncBufferedWebhookEvents,
  triggerAutomaticWorkflowEmail,
  type EmailAttachmentInput,
} from '../services/messaging.ts';
import {
  CONTROL_CENTRE_EMAIL_NOTIFICATION_TYPES,
  PUBLIC_EMAIL_NOTIFICATION_TYPES,
} from '../../src/config/platformIdentity.ts';

export const v1Router = express.Router();

function extractGmailAccessToken(req: AuthenticatedRequest): string | undefined {
  const raw = req.headers['x-gmail-access-token'];
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return undefined;
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

const VALID_DEPARTMENTS = [
  'user_management',
  'client_management',
  'task_monitoring',
  'bids_assignments',
  'finance_control',
  'api_management',
  'activity_logs',
  'platform_settings',
] as const;

const DEPARTMENT_LABELS: Record<string, string> = {
  user_management: 'User Management',
  client_management: 'Client Management',
  task_monitoring: 'Task Monitoring',
  bids_assignments: 'Bids & Assignments',
  finance_control: 'Finance Control',
  api_management: 'API Management',
  activity_logs: 'Activity Logs',
  platform_settings: 'Platform Settings',
};

const VALID_PERMISSIONS = [
  'view',
  'create',
  'edit',
  'approve',
  'reject',
  'suspend',
  'revoke',
  'export',
  'manage',
  ...EMAIL_PERMISSIONS,
] as const;

const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const SHORT_CODE_REGEX = /^[A-Za-z0-9_-]{6,32}$/;

const VALID_INVITATION_TYPES = ['staff_account', 'department_member', 'department_admin'] as const;

interface SignedInvitationPayload {
  invitationId: string;
  fullName: string;
  email: string;
  phone: string;
  department: (typeof VALID_DEPARTMENTS)[number];
  departmentRole: string;
  permissions: string[];
  exp: number;
  nonce: string;
}

// Tracks invalidated/used/revoked invitation IDs & concurrency locks alongside authoritative Firestore state
const invalidatedInvitationIds = new Set<string>();
const inFlightInvitationRedemptions = new Set<string>();
const openedInvitationTracking = new Map<string, { openedAt: string; openedCount: number }>();
const pendingSmsOtps = new Map<
  string,
  { otpHash: string; phone: string; expiresAtMs: number; verified: boolean }
>();

function generateShortInviteCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SHORT_CODE_ALPHABET[crypto.randomInt(0, SHORT_CODE_ALPHABET.length)];
  }
  return out;
}

function resolveRequestOrigin(req: express.Request): string {
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (originHeader && /^https?:\/\//i.test(originHeader)) {
    return originHeader.replace(/\/$/, '');
  }
  const fwdHost =
    typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0].trim()
      : '';
  const fwdProto =
    typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0].trim()
      : 'https';
  if (fwdHost) {
    return `${fwdProto}://${fwdHost}`.replace(/\/$/, '');
  }
  const host = typeof req.headers.host === 'string' ? req.headers.host.trim() : '';
  if (host) {
    const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
    return `${proto}://${host}`.replace(/\/$/, '');
  }
  if (serverConfig.appUrl && serverConfig.appUrl !== 'MY_APP_URL') {
    return serverConfig.appUrl.replace(/\/$/, '');
  }
  return 'http://localhost:3000';
}

function buildShortInviteUrl(req: express.Request, shortCode: string): string {
  return `${resolveRequestOrigin(req)}/join/${encodeURIComponent(shortCode)}`;
}

function canManageInvitationDepartment(
  admin: NonNullable<AuthenticatedRequest['admin']>,
  department: string
): boolean {
  if (admin.role === 'SUPER_ADMIN') return true;
  if (admin.departments.includes('user_management') && admin.actions.includes('manage')) {
    return true;
  }
  return admin.actions.includes('manage') && admin.departments.includes(department);
}

function signInvitationPayload(payload: SignedInvitationPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', serverConfig.invitationSigningSecret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySignedInvitationToken(rawToken: string): SignedInvitationPayload | null {
  const parts = rawToken.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', serverConfig.invitationSigningSecret)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SignedInvitationPayload;
    if (!decoded.invitationId || !decoded.department || !decoded.exp) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

interface ResolvedPublicInvitation {
  mode: 'short_code' | 'legacy_token';
  codeHash?: string;
  invitationId: string;
  invitationType: string;
  department: string;
  departmentLabel: string;
  departmentRole: string;
  inviterName: string;
  emailRestricted: boolean;
  requiresPhone: boolean;
  singleUse: boolean;
  status: string;
  expiresAt: string;
  legacyPayload?: SignedInvitationPayload;
}

async function resolvePublicInvitation(
  rawCodeOrToken: string
): Promise<{ ok: true; data: ResolvedPublicInvitation } | { ok: false; status: number; error: string }> {
  const trimmed = rawCodeOrToken.trim();
  if (!trimmed) {
    return { ok: false, status: 400, error: 'Missing invitation code.' };
  }

  if (trimmed.includes('.')) {
    const payload = verifySignedInvitationToken(trimmed);
    if (!payload) {
      return { ok: false, status: 400, error: 'Invalid or tampered invitation link.' };
    }
    if (invalidatedInvitationIds.has(payload.invitationId)) {
      return { ok: false, status: 410, error: 'This invitation has already been used or revoked.' };
    }
    if (Date.now() > payload.exp) {
      return {
        ok: false,
        status: 410,
        error: 'This invitation link has expired. Contact an administrator for a new invitation.',
      };
    }
    return {
      ok: true,
      data: {
        mode: 'legacy_token',
        invitationId: payload.invitationId,
        invitationType: 'staff_account',
        department: payload.department,
        departmentLabel: DEPARTMENT_LABELS[payload.department] || payload.department,
        departmentRole: payload.departmentRole,
        inviterName: 'SWAS TASKS Administration',
        emailRestricted: Boolean(payload.email),
        requiresPhone: true,
        singleUse: true,
        status: 'pending',
        expiresAt: new Date(payload.exp).toISOString(),
        legacyPayload: payload,
      },
    };
  }

  if (!SHORT_CODE_REGEX.test(trimmed)) {
    return { ok: false, status: 400, error: 'Invalid invitation link format.' };
  }

  const codeHash = hashInvitationToken(trimmed);
  const linkDoc = await firestoreGetDoc('invitation_links', codeHash);
  if (!linkDoc) {
    return { ok: false, status: 404, error: 'Invitation link was not found or has been deleted.' };
  }

  const invitationId = String(linkDoc.invitationId || '');
  const singleUse = linkDoc.singleUse !== false;
  const status = String(linkDoc.status || 'pending');
  const expiresAt = String(linkDoc.expiresAt || '');

  if (status === 'revoked') {
    return { ok: false, status: 410, error: 'This invitation link has been revoked by an administrator.' };
  }
  if (invalidatedInvitationIds.has(invitationId) || (singleUse && status === 'accepted')) {
    return {
      ok: false,
      status: 410,
      error: 'This single-use invitation link has already been used.',
    };
  }
  if (status === 'expired' || (expiresAt && Date.now() > new Date(expiresAt).getTime())) {
    return {
      ok: false,
      status: 410,
      error: 'This invitation link has expired. Request a new invitation link from your administrator.',
    };
  }
  if (status !== 'pending' && status !== 'opened') {
    return {
      ok: false,
      status: 410,
      error: `This invitation link is no longer active (${status}).`,
    };
  }

  const dept = String(linkDoc.department || '');
  return {
    ok: true,
    data: {
      mode: 'short_code',
      codeHash,
      invitationId,
      invitationType: String(linkDoc.invitationType || 'staff_account'),
      department: dept,
      departmentLabel: String(linkDoc.departmentLabel || DEPARTMENT_LABELS[dept] || dept),
      departmentRole: String(linkDoc.departmentRole || ''),
      inviterName: String(linkDoc.inviterName || 'SWAS TASKS Administration'),
      emailRestricted: linkDoc.emailRestricted === true,
      requiresPhone: linkDoc.requiresPhone === true,
      singleUse,
      status,
      expiresAt,
    },
  };
}

function validateSafeId(id: string): boolean {
  return SAFE_ID_REGEX.test(id);
}

async function appendAuditLog(
  req: AuthenticatedRequest,
  category: string,
  action: string,
  affectedRecord: string,
  result: 'success' | 'denied' | 'failed',
  metadata: Record<string, unknown> = {}
): Promise<void> {
  if (!req.admin) return;
  const eventId = `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  try {
    await firestoreSetDoc(
      'activity_logs',
      eventId,
      {
        eventId,
        category,
        actorId: req.admin.uid,
        actorEmail: req.admin.email,
        actorRole: req.admin.role,
        department: req.admin.primaryDepartment,
        action,
        affectedRecord,
        result,
        correlationId: req.correlationId || crypto.randomUUID(),
        metadata,
        createdAt: now,
      },
      req.admin.idToken
    );
  } catch (err) {
    console.error('Audit log write failed:', err);
  }
}

// Public Platform Health & Connectivity Endpoint
v1Router.get('/platform/status', async (_req, res: Response) => {
  const started = Date.now();
  let firestoreReachable = false;
  let firestoreError: string | null = null;
  try {
    await firestoreGetDoc('test', 'connection');
    firestoreReachable = true;
  } catch (err) {
    firestoreError = err instanceof Error ? err.message : 'Firestore check failed';
  }
  res.json({
    service: 'SWAS TASKS – Central Control Centre API',
    status: firestoreReachable ? 'operational' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    latencyMs: Date.now() - started,
    messaging: getMessagingStatus(),
    firebase: {
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      storageBucket: firebaseConfig.storageBucket,
      firestoreReachable,
      firestoreError,
    },
  });
});

// Public Email & SMS Provider Configuration Status (No secrets exposed)
v1Router.get('/system/messaging-status', (_req, res: Response) => {
  res.json(getMessagingStatus());
});

// Public Payment Gateway & Messaging Configuration Status (No secrets exposed)
v1Router.get('/system/gateway-status', (_req, res: Response) => {
  res.json({
    messaging: getMessagingStatus(),
    paymentGateway: getPaymentGatewayStatus(),
  });
});

// Public Website Configuration Endpoint
v1Router.get('/config/public', async (_req, res: Response) => {
  try {
    const [publicSettings, emailSettingsDoc, senderIdentity] = await Promise.all([
      firestoreGetDoc('platform_settings', 'public'),
      firestoreGetDoc('platform_settings', 'email_configuration').catch(() => null),
      resolveEffectiveSenderIdentity(),
    ]);
    const msgStatus = getMessagingStatus();
    const emailCfg =
      emailSettingsDoc?.config && typeof emailSettingsDoc.config === 'object'
        ? (emailSettingsDoc.config as Record<string, unknown>)
        : {};
    const notificationRules =
      emailCfg.notificationRules && typeof emailCfg.notificationRules === 'object'
        ? (emailCfg.notificationRules as Record<string, boolean>)
        : {};

    res.json({
      configured: Boolean(publicSettings),
      emailIdentity: {
        platformName: senderIdentity.platformName,
        officialEmail: senderIdentity.officialEmail,
        senderDisplayName: senderIdentity.senderDisplayName,
        replyToEmail: senderIdentity.replyToEmail,
        emailConfigured: msgStatus.emailConfigured,
        statusLabel: msgStatus.emailStatusLabel,
        publicNotificationEvents: PUBLIC_EMAIL_NOTIFICATION_TYPES.map((evt) => ({
          id: evt.id,
          label: evt.label,
          enabled: notificationRules[evt.id] ?? evt.defaultEnabled,
        })),
      },
      typography: {
        primaryFont: 'Inter',
        headingFont: 'Poppins',
        monoFont: 'JetBrains Mono',
        scale: {
          dashboardHeading: { size: '28px', weight: 600 },
          pageHeading: { size: '24px', weight: 600 },
          sectionHeading: { size: '18px', weight: 600 },
          cardHeading: { size: '16px', weight: 600 },
          navigation: { size: '14px', weight: 500 },
          body: { size: '14px', weight: 400 },
          table: { size: '13px', weight: 400 },
          label: { size: '13px', weight: 500 },
          input: { size: '14px', weight: 400 },
          button: { size: '14px', weight: 600 },
          meta: { size: '12px', weight: 400 },
          smallLabel: { size: '11px', weight: 500 },
        },
      },
      settings: publicSettings || {
        sectionId: 'public',
        platformName: 'SWAS TASKS',
        tagline: 'Skilled Workforce & Task Marketplace',
        officialEmail: senderIdentity.officialEmail,
        maintenanceMode: false,
        allowWorkerRegistration: true,
        allowClientRegistration: true,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch public settings';
    res.status(500).json({ error: message });
  }
});

// OpenAPI JSON Spec
v1Router.get('/openapi.json', (_req, res: Response) => {
  res.json(openApiSpec);
});

// --- Invitation Validation & Staff Registration Endpoints ---
v1Router.get('/invitations/validate', async (req, res: Response) => {
  const rawCode =
    (typeof req.query.code === 'string' && req.query.code.trim()) ||
    (typeof req.query.token === 'string' && req.query.token.trim()) ||
    '';

  try {
    const resolved = await resolvePublicInvitation(rawCode);
    if (!resolved.ok) {
      res.status(resolved.status).json({ valid: false, error: resolved.error });
      return;
    }

    const inv = resolved.data;
    const prevOpen = openedInvitationTracking.get(inv.invitationId);
    openedInvitationTracking.set(inv.invitationId, {
      openedAt: prevOpen?.openedAt || new Date().toISOString(),
      openedCount: (prevOpen?.openedCount || 0) + 1,
    });

    res.json({
      valid: true,
      invitationId: inv.invitationId,
      invitationType: inv.invitationType,
      department: inv.department,
      departmentLabel: inv.departmentLabel,
      departmentRole: inv.departmentRole,
      inviterName: inv.inviterName,
      emailRestricted: inv.emailRestricted,
      requiresPhone: inv.requiresPhone,
      singleUse: inv.singleUse,
      status: prevOpen ? 'opened' : inv.status,
      expiresAt: inv.expiresAt,
      messaging: getMessagingStatus(),
    });
  } catch (err) {
    res.status(500).json({
      valid: false,
      error: err instanceof Error ? err.message : 'Unable to validate invitation link.',
    });
  }
});

v1Router.post('/invitations/send-sms-otp', authAttemptRateLimiter, async (req, res: Response) => {
  const codeOrToken =
    (typeof req.body?.code === 'string' && req.body.code.trim()) ||
    (typeof req.body?.token === 'string' && req.body.token.trim()) ||
    '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';

  const resolved = await resolvePublicInvitation(codeOrToken);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }

  const msgStatus = getMessagingStatus();
  if (!msgStatus.smsConfigured) {
    res.status(503).json({
      configured: false,
      status: 'not_configured',
      error: 'SMS verification service is Not Configured on this server.',
    });
    return;
  }

  const targetPhone = phone || resolved.data.legacyPayload?.phone || '';
  if (!targetPhone || targetPhone.length < 6) {
    res.status(400).json({ error: 'Valid phone number is required for SMS OTP.' });
    return;
  }

  const otpCode = String(crypto.randomInt(100000, 999999));
  const delivery = await sendPhoneOtpSms({ phone: targetPhone, code: otpCode });
  if (!delivery.sent) {
    res.status(502).json({ configured: true, status: 'failed', error: delivery.detail });
    return;
  }

  const otpHash = crypto
    .createHmac('sha256', serverConfig.invitationSigningSecret)
    .update(`${resolved.data.invitationId}:${otpCode}`)
    .digest('hex');

  pendingSmsOtps.set(resolved.data.invitationId, {
    otpHash,
    phone: targetPhone,
    expiresAtMs: Date.now() + 10 * 60 * 1000,
    verified: false,
  });

  res.json({ configured: true, status: 'sent', detail: delivery.detail });
});

v1Router.post('/invitations/verify-sms-otp', authAttemptRateLimiter, async (req, res: Response) => {
  const codeOrToken =
    (typeof req.body?.code === 'string' && req.body.code.trim()) ||
    (typeof req.body?.otp === 'string' && typeof req.body?.token === 'string' ? req.body.token.trim() : '') ||
    (typeof req.body?.token === 'string' ? req.body.token.trim() : '') ||
    '';
  const otp =
    (typeof req.body?.otp === 'string' && req.body.otp.trim()) ||
    (typeof req.body?.smsCode === 'string' && req.body.smsCode.trim()) ||
    (typeof req.body?.token === 'string' && typeof req.body?.code === 'string' ? req.body.code.trim() : '') ||
    '';

  const resolved = await resolvePublicInvitation(codeOrToken);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }

  const entry = pendingSmsOtps.get(resolved.data.invitationId);
  if (!entry || Date.now() > entry.expiresAtMs) {
    res.status(400).json({ error: 'OTP expired or not requested.' });
    return;
  }

  const candidateHash = crypto
    .createHmac('sha256', serverConfig.invitationSigningSecret)
    .update(`${resolved.data.invitationId}:${otp}`)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(entry.otpHash))) {
    res.status(400).json({ error: 'Incorrect SMS verification code.' });
    return;
  }

  entry.verified = true;
  pendingSmsOtps.set(resolved.data.invitationId, entry);
  res.json({ verified: true });
});

const acceptInviteSchema = z.object({
  code: z.string().min(6).max(2048).optional(),
  token: z.string().min(6).max(2048).optional(),
  fullName: z.string().min(2).max(140),
  phone: z.string().max(32).optional().default(''),
});

v1Router.post('/invitations/accept', authAttemptRateLimiter, async (req, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Firebase ID token.' });
    return;
  }
  const idToken = authHeader.slice('Bearer '.length).trim();

  const parsed = acceptInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid registration details.', details: parsed.error.flatten() });
    return;
  }

  const codeOrToken = (parsed.data.code || parsed.data.token || '').trim();
  const resolved = await resolvePublicInvitation(codeOrToken);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }

  const invMeta = resolved.data;
  if (inFlightInvitationRedemptions.has(invMeta.invitationId)) {
    res.status(409).json({ error: 'This invitation link is currently being redeemed. Please wait.' });
    return;
  }
  inFlightInvitationRedemptions.add(invMeta.invitationId);

  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    const authedEmail = (decoded.email || '').toLowerCase();
    if (!authedEmail) {
      res.status(403).json({ error: 'Verified email address is required.' });
      return;
    }

    if (decoded.email_verified !== true) {
      res.status(403).json({
        error: 'Email verification is required before completing staff registration.',
      });
      return;
    }

    const msgStatus = getMessagingStatus();
    let phoneVerified = false;
    if (msgStatus.smsConfigured && (invMeta.requiresPhone || parsed.data.phone.trim().length > 0)) {
      const otpEntry = pendingSmsOtps.get(invMeta.invitationId);
      if (!otpEntry || !otpEntry.verified) {
        res.status(403).json({
          error: 'Phone SMS verification must be completed before registration.',
        });
        return;
      }
      phoneVerified = true;
    }

    const inviteDoc = await firestoreGetDoc('staff_invitations', invMeta.invitationId, idToken);
    if (!inviteDoc) {
      res.status(404).json({ error: 'Invitation record not found.' });
      return;
    }

    const inviteStatus = String(inviteDoc.status || 'pending');
    const singleUse = inviteDoc.singleUse !== false;
    if (inviteStatus === 'revoked' || (singleUse && inviteStatus === 'accepted')) {
      invalidatedInvitationIds.add(invMeta.invitationId);
      res.status(410).json({
        error: `Invitation cannot be used because its status is '${inviteStatus}'.`,
      });
      return;
    }
    if (inviteStatus !== 'pending' && inviteStatus !== 'opened') {
      res.status(410).json({ error: `Invitation is not active (${inviteStatus}).` });
      return;
    }

    const expectedHash = hashInvitationToken(codeOrToken);
    if (
      (invMeta.mode === 'short_code' && inviteDoc.codeHash !== expectedHash) ||
      (invMeta.mode === 'legacy_token' && inviteDoc.tokenHash !== expectedHash)
    ) {
      res.status(403).json({ error: 'Invitation code hash verification failed.' });
      return;
    }

    const expiresAtStr = String(inviteDoc.expiresAt || '');
    if (expiresAtStr && Date.now() > new Date(expiresAtStr).getTime()) {
      res.status(410).json({ error: 'Invitation has expired.' });
      return;
    }

    const restrictedEmail = String(inviteDoc.email || '').trim().toLowerCase();
    const isEmailRestricted = inviteDoc.emailRestricted === true || Boolean(restrictedEmail);
    if (isEmailRestricted && restrictedEmail && authedEmail !== restrictedEmail) {
      res.status(403).json({
        error: 'Your signed-in email does not match the email address specified on this private invitation.',
      });
      return;
    }

    if (inviteDoc.requiresPhone === true && parsed.data.phone.trim().length < 6) {
      res.status(400).json({ error: 'Phone number is required by this invitation.' });
      return;
    }

    const existingAdminDoc = await firestoreGetDoc('admin_users', decoded.uid, idToken).catch(
      () => null
    );
    if (existingAdminDoc) {
      res.status(409).json({
        error:
          existingAdminDoc.status === 'pending_verification'
            ? 'Your account is already registered and awaiting Super Administrator verification.'
            : 'This user account is already registered in the Control Centre.',
      });
      return;
    }

    // Never trust department/role/permissions from browser — enforce strictly from Firestore invitation!
    const serverDepartment = String(inviteDoc.department);
    const serverRole = String(inviteDoc.departmentRole);
    const serverPermissions = Array.isArray(inviteDoc.permissions)
      ? (inviteDoc.permissions as string[])
      : ['view'];
    const invitationType = String(inviteDoc.invitationType || 'staff_account');
    const now = new Date().toISOString();

    const staffAccount = await firestoreSetDoc(
      'admin_users',
      decoded.uid,
      {
        uid: decoded.uid,
        email: authedEmail,
        displayName: parsed.data.fullName.trim(),
        phone: parsed.data.phone.trim() || String(inviteDoc.phone || ''),
        emailVerified: true,
        phoneVerified,
        primaryDepartment: serverDepartment,
        role: serverRole,
        status: 'pending_verification',
        verificationStatus: 'pending_verification',
        accessStatus: 'inactive',
        departments: [serverDepartment],
        actions: serverPermissions,
        invitationId: invMeta.invitationId,
        invitationType,
        registeredAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: String(inviteDoc.createdBy || 'super_admin_invite'),
      },
      idToken
    );

    const nextInviteStatus = singleUse ? 'accepted' : 'opened';
    const nextAcceptedCount = Number(inviteDoc.acceptedCount || 0) + 1;
    await firestorePatchFields(
      'staff_invitations',
      invMeta.invitationId,
      {
        status: nextInviteStatus,
        acceptedByUid: decoded.uid,
        acceptedByEmail: authedEmail,
        acceptedAt: now,
        acceptedCount: nextAcceptedCount,
        updatedAt: now,
      },
      idToken
    );

    if (invMeta.codeHash) {
      await firestorePatchFields(
        'invitation_links',
        invMeta.codeHash,
        {
          status: nextInviteStatus,
          updatedAt: now,
        },
        idToken
      ).catch(() => undefined);
    }

    if (singleUse) {
      invalidatedInvitationIds.add(invMeta.invitationId);
    }
    pendingSmsOtps.delete(invMeta.invitationId);

    const auditId = `sva_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await firestoreSetDoc(
      'staff_verification_audits',
      auditId,
      {
        auditId,
        staffUid: decoded.uid,
        staffName: parsed.data.fullName.trim(),
        staffEmail: authedEmail,
        invitationId: invMeta.invitationId,
        department: serverDepartment,
        assignedRole: serverRole,
        decision: 'registered',
        previousStatus: 'invited',
        newStatus: 'pending_verification',
        decidedByUid: decoded.uid,
        decidedByName: parsed.data.fullName.trim(),
        decisionReason: 'Completed invitation registration; awaiting Super Admin verification.',
        createdAt: now,
      },
      idToken
    ).catch(() => undefined);

    const notifId = `ntf_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const deptLabel = DEPARTMENT_LABELS[serverDepartment] || serverDepartment;
    await firestoreSetDoc(
      'notifications',
      notifId,
      {
        notificationId: notifId,
        department: 'staff_management',
        type: 'staff_verification',
        title: 'New Staff Account Pending Verification',
        message: `${parsed.data.fullName.trim()} (${authedEmail}) registered for ${deptLabel} (${serverRole}) and awaits Super Admin approval.`,
        read: false,
        createdAt: now,
      },
      idToken
    ).catch(() => undefined);

    const evtId = `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await firestoreSetDoc(
      'activity_logs',
      evtId,
      {
        eventId: evtId,
        category: 'account_change',
        actorId: decoded.uid,
        actorEmail: authedEmail,
        actorRole: serverRole,
        department: serverDepartment,
        action: 'STAFF_INVITATION_ACCEPTED',
        affectedRecord: `admin_users/${decoded.uid}`,
        result: 'success',
        metadata: {
          invitationId: invMeta.invitationId,
          department: serverDepartment,
          phoneVerified,
          verificationStatus: 'pending_verification',
        },
        createdAt: now,
      },
      idToken
    ).catch(() => undefined);

    const origin = resolveRequestOrigin(req);
    void sendStaffVerificationEmail({
      stage: 'registered_pending',
      toEmail: authedEmail,
      staffName: parsed.data.fullName.trim(),
      staffEmail: authedEmail,
      departmentLabel: deptLabel,
      departmentRole: serverRole,
      triggeredByUid: decoded.uid,
      idToken,
    }).catch(() => undefined);

    if (serverConfig.bootstrapSuperAdminEmail) {
      void sendStaffVerificationEmail({
        stage: 'admin_new_registration',
        toEmail: serverConfig.bootstrapSuperAdminEmail,
        staffName: parsed.data.fullName.trim(),
        staffEmail: authedEmail,
        departmentLabel: deptLabel,
        departmentRole: serverRole,
        loginUrl: `${origin}/#/staff_management/staff_verification`,
        triggeredByUid: decoded.uid,
        idToken,
      }).catch(() => undefined);
    }

    res.status(201).json({
      registered: true,
      pendingVerification: true,
      status: 'pending_verification',
      department: serverDepartment,
      departmentLabel: deptLabel,
      departmentRole: serverRole,
      staff: staffAccount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invitation registration failed';
    res.status(500).json({ error: message });
  } finally {
    inFlightInvitationRedemptions.delete(invMeta.invitationId);
  }
});

// --- Staff Invitation & Verification Governance Endpoints ---
const createInvitationSchema = z.object({
  invitationType: z.enum(VALID_INVITATION_TYPES).default('staff_account'),
  fullName: z.string().max(140).optional().default(''),
  email: z
    .string()
    .max(254)
    .optional()
    .default('')
    .refine((v) => v.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()), {
      message: 'Invalid recipient email address',
    }),
  phone: z.string().max(32).optional().default(''),
  department: z.enum(VALID_DEPARTMENTS),
  departmentRole: z.string().min(2).max(80),
  permissions: z.array(z.enum(VALID_PERMISSIONS)).min(1).max(24),
  expiryHours: z.number().int().min(1).max(720).default(48),
  singleUse: z.boolean().default(true),
  requiresPhone: z.boolean().default(false),
  shareMessage: z.string().max(1000).optional().default(''),
  sendEmail: z.boolean().default(true),
});

v1Router.post(
  '/admin/invitations',
  requireAdminAuth,
  requireDeptInvitationManager,
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createInvitationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid invitation parameters.', details: parsed.error.flatten() });
      return;
    }

    if (!canManageInvitationDepartment(req.admin!, parsed.data.department)) {
      res.status(403).json({
        error: `You may only generate invitations for your assigned department (${req.admin!.primaryDepartment}).`,
      });
      return;
    }

    const invitationId = `inv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const shortCode = generateShortInviteCode(8);
    const codeHash = hashInvitationToken(shortCode);
    const expMs = Date.now() + parsed.data.expiryHours * 60 * 60 * 1000;
    const expiresAt = new Date(expMs).toISOString();
    const now = new Date().toISOString();
    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const emailRestricted = Boolean(normalizedEmail);
    const departmentLabel = DEPARTMENT_LABELS[parsed.data.department] || parsed.data.department;
    const inviteUrl = buildShortInviteUrl(req, shortCode);

    const shareMessage =
      parsed.data.shareMessage.trim() ||
      `You're invited to join SWAS TASKS (${departmentLabel} – ${parsed.data.departmentRole.trim()}). Register using your secure link: ${inviteUrl}`;

    let emailResult: { sent: boolean; status: string; detail: string } = {
      sent: false,
      status: 'not_sent',
      detail: normalizedEmail
        ? 'Created shareable link without sending email immediately.'
        : 'Open shareable invitation link created (no target email entered).',
    };

    if (normalizedEmail && parsed.data.sendEmail) {
      emailResult = await sendInvitationEmail({
        toEmail: normalizedEmail,
        fullName: parsed.data.fullName.trim() || 'Team Member',
        departmentLabel,
        departmentRole: parsed.data.departmentRole.trim(),
        inviteUrl,
        expiresAt,
        inviterName: req.admin!.displayName,
        shareMessage: parsed.data.shareMessage.trim(),
        emailRestricted: true,
        triggeredByUid: req.admin!.uid,
        idToken: req.admin!.idToken,
        gmailAccessToken: extractGmailAccessToken(req),
      });
    }

    try {
      const linkDoc = {
        codeHash,
        invitationId,
        invitationType: parsed.data.invitationType,
        department: parsed.data.department,
        departmentLabel,
        departmentRole: parsed.data.departmentRole.trim(),
        inviterName: req.admin!.displayName,
        emailRestricted,
        requiresPhone: parsed.data.requiresPhone,
        singleUse: parsed.data.singleUse,
        status: 'pending',
        expiresAt,
        createdAt: now,
        updatedAt: now,
      };
      await firestoreSetDoc('invitation_links', codeHash, linkDoc, req.admin!.idToken);

      const record = await firestoreSetDoc(
        'staff_invitations',
        invitationId,
        {
          invitationId,
          shortCode,
          codeHash,
          tokenHash: codeHash,
          invitationType: parsed.data.invitationType,
          fullName: parsed.data.fullName.trim(),
          email: normalizedEmail,
          emailRestricted,
          phone: parsed.data.phone.trim(),
          requiresPhone: parsed.data.requiresPhone,
          singleUse: parsed.data.singleUse,
          department: parsed.data.department,
          departmentRole: parsed.data.departmentRole.trim(),
          permissions: parsed.data.permissions,
          shareMessage,
          inviterName: req.admin!.displayName,
          status: 'pending',
          expiresAt,
          openedCount: 0,
          acceptedCount: 0,
          emailDeliveryStatus: emailResult.status,
          createdBy: req.admin!.uid,
          createdAt: now,
          updatedAt: now,
        },
        req.admin!.idToken
      );

      await appendAuditLog(
        req,
        'account_change',
        'CREATE_STAFF_INVITATION',
        `staff_invitations/${invitationId}`,
        'success',
        {
          email: normalizedEmail || '(open-shareable)',
          invitationType: parsed.data.invitationType,
          department: parsed.data.department,
          departmentRole: parsed.data.departmentRole,
          singleUse: parsed.data.singleUse,
          emailDeliveryStatus: emailResult.status,
        }
      );

      res.status(201).json({
        invitation: record,
        shortCode,
        inviteUrl,
        shareMessage,
        delivery: emailResult,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to persist invitation',
      });
    }
  }
);

v1Router.post(
  '/admin/invitations/:id/send-email',
  requireAdminAuth,
  requireDeptInvitationManager,
  async (req: AuthenticatedRequest, res: Response) => {
    const invitationId = String(req.params.id || '');
    if (!validateSafeId(invitationId)) {
      res.status(400).json({ error: 'Invalid invitation ID.' });
      return;
    }

    const bodySchema = z.object({
      toEmail: z.string().email().max(254).optional(),
      shareMessage: z.string().max(1000).optional(),
    });
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid email dispatch payload.' });
      return;
    }

    try {
      const existing = await firestoreGetDoc('staff_invitations', invitationId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Invitation not found.' });
        return;
      }
      if (!canManageInvitationDepartment(req.admin!, String(existing.department))) {
        res.status(403).json({ error: 'Department scope denied for this invitation.' });
        return;
      }
      if (existing.status === 'revoked' || existing.status === 'accepted') {
        res.status(400).json({ error: `Cannot email a ${String(existing.status)} invitation.` });
        return;
      }

      const targetEmail = (parsed.data.toEmail || String(existing.email || '')).trim().toLowerCase();
      if (!targetEmail) {
        res.status(400).json({ error: 'Enter a recipient email address to send this invitation.' });
        return;
      }

      const shortCode = String(existing.shortCode || '');
      if (!shortCode) {
        res.status(400).json({ error: 'Legacy token invitation must be regenerated to produce a short link.' });
        return;
      }

      const inviteUrl = buildShortInviteUrl(req, shortCode);
      const departmentLabel =
        DEPARTMENT_LABELS[String(existing.department)] || String(existing.department);

      const delivery = await sendInvitationEmail({
        toEmail: targetEmail,
        fullName: String(existing.fullName || 'Team Member'),
        departmentLabel,
        departmentRole: String(existing.departmentRole),
        inviteUrl,
        expiresAt: String(existing.expiresAt),
        inviterName: String(existing.inviterName || req.admin!.displayName),
        shareMessage: parsed.data.shareMessage ?? String(existing.shareMessage || ''),
        emailRestricted: existing.emailRestricted === true,
        triggeredByUid: req.admin!.uid,
        idToken: req.admin!.idToken,
        gmailAccessToken: extractGmailAccessToken(req),
      });

      const updated = await firestorePatchFields(
        'staff_invitations',
        invitationId,
        {
          emailDeliveryStatus: delivery.status,
          updatedAt: new Date().toISOString(),
        },
        req.admin!.idToken
      );

      res.json({ invitation: updated, inviteUrl, delivery });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send invitation email' });
    }
  }
);

async function handleRegenerateOrResendInvitation(req: AuthenticatedRequest, res: Response) {
  const invitationId = String(req.params.id || '');
  if (!validateSafeId(invitationId)) {
    res.status(400).json({ error: 'Invalid invitation ID.' });
    return;
  }

  try {
    const existing = await firestoreGetDoc('staff_invitations', invitationId, req.admin!.idToken);
    if (!existing) {
      res.status(404).json({ error: 'Invitation not found.' });
      return;
    }
    if (!canManageInvitationDepartment(req.admin!, String(existing.department))) {
      res.status(403).json({ error: 'Department scope denied for this invitation.' });
      return;
    }
    if (existing.status === 'accepted' && existing.singleUse !== false) {
      res.status(400).json({ error: 'Accepted single-use invitations cannot be regenerated.' });
      return;
    }

    const expMs = Date.now() + 48 * 60 * 60 * 1000;
    const expiresAt = new Date(expMs).toISOString();
    const now = new Date().toISOString();

    const newInvitationId = `inv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const shortCode = generateShortInviteCode(8);
    const codeHash = hashInvitationToken(shortCode);
    const inviteUrl = buildShortInviteUrl(req, shortCode);
    const department = String(existing.department);
    const departmentLabel = DEPARTMENT_LABELS[department] || department;

    invalidatedInvitationIds.add(invitationId);

    const oldCodeHash = typeof existing.codeHash === 'string' ? existing.codeHash : '';
    if (oldCodeHash) {
      await firestorePatchFields(
        'invitation_links',
        oldCodeHash,
        { status: 'revoked', updatedAt: now },
        req.admin!.idToken
      ).catch(() => undefined);
    }

    await firestorePatchFields(
      'staff_invitations',
      invitationId,
      {
        status: 'revoked',
        revokedBy: req.admin!.uid,
        revokedAt: now,
        revokeReason: 'Regenerated new invitation link',
        updatedAt: now,
      },
      req.admin!.idToken
    );

    const targetEmail = String(existing.email || '').trim().toLowerCase();
    let emailResult: { sent: boolean; status: string; detail: string } = {
      sent: false,
      status: 'not_sent',
      detail: 'New short invitation link generated.',
    };

    if (targetEmail) {
      emailResult = await sendInvitationEmail({
        toEmail: targetEmail,
        fullName: String(existing.fullName || 'Team Member'),
        departmentLabel,
        departmentRole: String(existing.departmentRole),
        inviteUrl,
        expiresAt,
        inviterName: req.admin!.displayName,
        shareMessage: typeof existing.shareMessage === 'string' ? existing.shareMessage : '',
        emailRestricted: existing.emailRestricted === true,
        triggeredByUid: req.admin!.uid,
        idToken: req.admin!.idToken,
        gmailAccessToken: extractGmailAccessToken(req),
      });
    }

    await firestoreSetDoc(
      'invitation_links',
      codeHash,
      {
        codeHash,
        invitationId: newInvitationId,
        invitationType: String(existing.invitationType || 'staff_account'),
        department,
        departmentLabel,
        departmentRole: String(existing.departmentRole),
        inviterName: req.admin!.displayName,
        emailRestricted: existing.emailRestricted === true || Boolean(targetEmail),
        requiresPhone: existing.requiresPhone === true,
        singleUse: existing.singleUse !== false,
        status: 'pending',
        expiresAt,
        createdAt: now,
        updatedAt: now,
      },
      req.admin!.idToken
    );

    const replacement = await firestoreSetDoc(
      'staff_invitations',
      newInvitationId,
      {
        invitationId: newInvitationId,
        shortCode,
        codeHash,
        tokenHash: codeHash,
        invitationType: String(existing.invitationType || 'staff_account'),
        fullName: String(existing.fullName || ''),
        email: targetEmail,
        emailRestricted: existing.emailRestricted === true || Boolean(targetEmail),
        phone: String(existing.phone || ''),
        requiresPhone: existing.requiresPhone === true,
        singleUse: existing.singleUse !== false,
        department,
        departmentRole: String(existing.departmentRole),
        permissions: Array.isArray(existing.permissions) ? existing.permissions : ['view'],
        shareMessage: `You're invited to join SWAS TASKS (${departmentLabel} – ${String(
          existing.departmentRole
        )}). Register using your secure link: ${inviteUrl}`,
        inviterName: req.admin!.displayName,
        status: 'pending',
        expiresAt,
        openedCount: 0,
        acceptedCount: 0,
        emailDeliveryStatus: emailResult.status,
        createdBy: req.admin!.uid,
        createdAt: now,
        updatedAt: now,
      },
      req.admin!.idToken
    );

    await appendAuditLog(
      req,
      'account_change',
      'RESEND_STAFF_INVITATION',
      `staff_invitations/${newInvitationId}`,
      'success',
      { replacedInvitationId: invitationId, emailDeliveryStatus: emailResult.status }
    );

    res.json({ invitation: replacement, shortCode, inviteUrl, delivery: emailResult });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Regenerate failed' });
  }
}

v1Router.post(
  '/admin/invitations/:id/resend',
  requireAdminAuth,
  requireDeptInvitationManager,
  handleRegenerateOrResendInvitation
);

v1Router.post(
  '/admin/invitations/:id/regenerate',
  requireAdminAuth,
  requireDeptInvitationManager,
  handleRegenerateOrResendInvitation
);

v1Router.post(
  '/admin/invitations/:id/revoke',
  requireAdminAuth,
  requireDeptInvitationManager,
  async (req: AuthenticatedRequest, res: Response) => {
    const invitationId = String(req.params.id || '');
    if (!validateSafeId(invitationId)) {
      res.status(400).json({ error: 'Invalid invitation ID.' });
      return;
    }

    try {
      const existing = await firestoreGetDoc('staff_invitations', invitationId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Invitation not found.' });
        return;
      }
      if (!canManageInvitationDepartment(req.admin!, String(existing.department))) {
        res.status(403).json({ error: 'Department scope denied for this invitation.' });
        return;
      }

      const now = new Date().toISOString();
      const reason =
        typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 400) : 'Revoked by administrator';

      invalidatedInvitationIds.add(invitationId);
      if (typeof existing.codeHash === 'string' && existing.codeHash) {
        await firestorePatchFields(
          'invitation_links',
          existing.codeHash,
          { status: 'revoked', updatedAt: now },
          req.admin!.idToken
        ).catch(() => undefined);
      }

      const updated = await firestorePatchFields(
        'staff_invitations',
        invitationId,
        {
          status: 'revoked',
          revokedBy: req.admin!.uid,
          revokedAt: now,
          revokeReason: reason,
          updatedAt: now,
        },
        req.admin!.idToken
      );

      await appendAuditLog(
        req,
        'security',
        'REVOKE_STAFF_INVITATION',
        `staff_invitations/${invitationId}`,
        'success',
        { email: existing.email || '(open-shareable)', reason }
      );
      res.json({ invitation: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Revoke failed' });
    }
  }
);

v1Router.delete(
  '/admin/invitations/:id',
  requireAdminAuth,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    const invitationId = String(req.params.id || '');
    if (!validateSafeId(invitationId)) {
      res.status(400).json({ error: 'Invalid invitation ID.' });
      return;
    }

    try {
      const existing = await firestoreGetDoc('staff_invitations', invitationId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Invitation not found.' });
        return;
      }
      invalidatedInvitationIds.add(invitationId);
      if (typeof existing.codeHash === 'string' && existing.codeHash) {
        await firestoreDeleteDoc('invitation_links', existing.codeHash, req.admin!.idToken).catch(
          () => undefined
        );
      }
      await firestoreDeleteDoc('staff_invitations', invitationId, req.admin!.idToken);
      await appendAuditLog(
        req,
        'account_change',
        'DELETE_STAFF_INVITATION',
        `staff_invitations/${invitationId}`,
        'success',
        { email: existing.email || '(open-shareable)' }
      );
      res.json({ deleted: true, invitationId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  }
);

// --- Super Admin Staff Account Verification (Two-Step Activation Gate) ---
const approveStaffSchema = z.object({
  department: z.enum(VALID_DEPARTMENTS).optional(),
  role: z.string().min(2).max(80).optional(),
  actions: z.array(z.enum(VALID_PERMISSIONS)).min(1).max(24).optional(),
  note: z.string().max(400).optional(),
});

v1Router.post(
  '/admin/staff/:uid/verify-approve',
  requireAdminAuth,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    const staffUid = String(req.params.uid || '');
    if (!validateSafeId(staffUid)) {
      res.status(400).json({ error: 'Invalid staff UID.' });
      return;
    }

    const parsed = approveStaffSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid approval payload.', details: parsed.error.flatten() });
      return;
    }

    try {
      const existing = await firestoreGetDoc('admin_users', staffUid, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Staff account not found.' });
        return;
      }
      if (existing.role === 'SUPER_ADMIN') {
        res.status(400).json({ error: 'Super Administrator accounts cannot be verified via this endpoint.' });
        return;
      }

      // Verify invitation record integrity before activation
      const invitationId = typeof existing.invitationId === 'string' ? existing.invitationId : '';
      let targetDept = parsed.data.department || String(existing.primaryDepartment || '');
      let targetRole = parsed.data.role || String(existing.role || '');
      let targetActions = parsed.data.actions || (Array.isArray(existing.actions) ? (existing.actions as string[]) : ['view']);

      if (invitationId) {
        const invDoc = await firestoreGetDoc('staff_invitations', invitationId, req.admin!.idToken).catch(
          () => null
        );
        if (invDoc && !parsed.data.department && String(invDoc.department) !== targetDept) {
          res.status(409).json({
            error: 'Staff department mismatch against original invitation. Explicit Super Admin override required.',
          });
          return;
        }
        if (invDoc && !parsed.data.role && String(invDoc.departmentRole) !== targetRole) {
          targetRole = String(invDoc.departmentRole);
        }
        if (invDoc && !parsed.data.actions && Array.isArray(invDoc.permissions)) {
          targetActions = invDoc.permissions as string[];
        }
      }

      const now = new Date().toISOString();
      const previousStatus = String(existing.status || 'pending_verification');
      const updated = await firestorePatchFields(
        'admin_users',
        staffUid,
        {
          primaryDepartment: targetDept,
          departments: [targetDept],
          role: targetRole,
          actions: targetActions,
          status: 'active',
          verificationStatus: 'approved',
          accessStatus: 'active',
          approvedBy: req.admin!.uid,
          approvedByName: req.admin!.displayName,
          approvedAt: now,
          rejectionReason: '',
          updatedAt: now,
        },
        req.admin!.idToken
      );

      const auditId = `sva_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await firestoreSetDoc(
        'staff_verification_audits',
        auditId,
        {
          auditId,
          staffUid,
          staffName: String(existing.displayName || ''),
          staffEmail: String(existing.email || ''),
          invitationId,
          department: targetDept,
          assignedRole: targetRole,
          decision: 'approved',
          previousStatus,
          newStatus: 'active',
          decidedByUid: req.admin!.uid,
          decidedByName: req.admin!.displayName,
          decisionReason: parsed.data.note?.trim() || 'Verified and approved by Super Administrator.',
          createdAt: now,
        },
        req.admin!.idToken
      );

      await appendAuditLog(
        req,
        'account_change',
        'APPROVE_STAFF_VERIFICATION',
        `admin_users/${staffUid}`,
        'success',
        {
          previousStatus,
          newStatus: 'active',
          department: targetDept,
          role: targetRole,
          invitationId,
        }
      );

      const deptLabel = DEPARTMENT_LABELS[targetDept] || targetDept;
      const loginUrl = `${resolveRequestOrigin(req)}/#/${targetDept}`;
      if (typeof existing.email === 'string' && existing.email.includes('@')) {
        void sendStaffVerificationEmail({
          stage: 'approved',
          toEmail: existing.email,
          staffName: String(existing.displayName || existing.email),
          staffEmail: existing.email,
          departmentLabel: deptLabel,
          departmentRole: targetRole,
          loginUrl,
          triggeredByUid: req.admin!.uid,
          idToken: req.admin!.idToken,
          gmailAccessToken: extractGmailAccessToken(req),
        }).catch(() => undefined);
      }

      res.json({ approved: true, staff: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Staff approval failed' });
    }
  }
);

const rejectStaffSchema = z.object({
  reason: z.string().min(3).max(500),
  notifyEmail: z.boolean().default(true),
});

v1Router.post(
  '/admin/staff/:uid/verify-reject',
  requireAdminAuth,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    const staffUid = String(req.params.uid || '');
    if (!validateSafeId(staffUid)) {
      res.status(400).json({ error: 'Invalid staff UID.' });
      return;
    }

    const parsed = rejectStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'A clear rejection reason (minimum 3 characters) is required.',
        details: parsed.error.flatten(),
      });
      return;
    }

    try {
      const existing = await firestoreGetDoc('admin_users', staffUid, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Staff account not found.' });
        return;
      }
      if (existing.role === 'SUPER_ADMIN') {
        res.status(403).json({ error: 'Cannot reject a Super Administrator account.' });
        return;
      }

      const now = new Date().toISOString();
      const previousStatus = String(existing.status || 'pending_verification');
      const updated = await firestorePatchFields(
        'admin_users',
        staffUid,
        {
          status: 'rejected',
          verificationStatus: 'rejected',
          accessStatus: 'blocked',
          rejectedBy: req.admin!.uid,
          rejectedByName: req.admin!.displayName,
          rejectedAt: now,
          rejectionReason: parsed.data.reason.trim(),
          sessionRevokedAt: now,
          updatedAt: now,
        },
        req.admin!.idToken
      );

      const auditId = `sva_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await firestoreSetDoc(
        'staff_verification_audits',
        auditId,
        {
          auditId,
          staffUid,
          staffName: String(existing.displayName || ''),
          staffEmail: String(existing.email || ''),
          invitationId: String(existing.invitationId || ''),
          department: String(existing.primaryDepartment || ''),
          assignedRole: String(existing.role || ''),
          decision: 'rejected',
          previousStatus,
          newStatus: 'rejected',
          decidedByUid: req.admin!.uid,
          decidedByName: req.admin!.displayName,
          decisionReason: parsed.data.reason.trim(),
          createdAt: now,
        },
        req.admin!.idToken
      );

      await appendAuditLog(
        req,
        'security',
        'REJECT_STAFF_VERIFICATION',
        `admin_users/${staffUid}`,
        'success',
        {
          previousStatus,
          newStatus: 'rejected',
          reason: parsed.data.reason.trim(),
        }
      );

      const dept = String(existing.primaryDepartment || '');
      const deptLabel = DEPARTMENT_LABELS[dept] || dept;
      if (parsed.data.notifyEmail && typeof existing.email === 'string' && existing.email.includes('@')) {
        void sendStaffVerificationEmail({
          stage: 'rejected',
          toEmail: existing.email,
          staffName: String(existing.displayName || existing.email),
          staffEmail: existing.email,
          departmentLabel: deptLabel,
          departmentRole: String(existing.role || ''),
          rejectionReason: parsed.data.reason.trim(),
          triggeredByUid: req.admin!.uid,
          idToken: req.admin!.idToken,
          gmailAccessToken: extractGmailAccessToken(req),
        }).catch(() => undefined);
      }

      res.json({ rejected: true, staff: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Staff rejection failed' });
    }
  }
);

// Super Admin Staff Governance (Permissions, Department Transfer, Suspend, Deactivate, Revoke Session)
const updateStaffSchema = z.object({
  primaryDepartment: z.enum(VALID_DEPARTMENTS).optional(),
  role: z.string().min(2).max(80).optional(),
  actions: z.array(z.enum(VALID_PERMISSIONS)).min(1).max(24).optional(),
  status: z
    .enum(['pending_verification', 'active', 'rejected', 'suspended', 'deactivated', 'revoked'])
    .optional(),
  reason: z.string().max(400).optional(),
});

v1Router.post(
  '/admin/staff/:uid/update',
  requireAdminAuth,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    const staffUid = String(req.params.uid || '');
    if (!validateSafeId(staffUid)) {
      res.status(400).json({ error: 'Invalid staff UID.' });
      return;
    }
    const parsed = updateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid staff update payload.', details: parsed.error.flatten() });
      return;
    }

    try {
      const existing = await firestoreGetDoc('admin_users', staffUid, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Staff record not found.' });
        return;
      }
      if (existing.role === 'SUPER_ADMIN' && req.admin!.uid !== staffUid) {
        res.status(403).json({ error: 'Cannot alter another Super Administrator account.' });
        return;
      }

      const now = new Date().toISOString();
      const updates: Record<string, unknown> = {
        updatedAt: now,
      };
      if (parsed.data.primaryDepartment) {
        updates.primaryDepartment = parsed.data.primaryDepartment;
        updates.departments = [parsed.data.primaryDepartment];
      }
      if (parsed.data.role) updates.role = parsed.data.role;
      if (parsed.data.actions) updates.actions = parsed.data.actions;
      if (parsed.data.status) {
        updates.status = parsed.data.status;
        if (parsed.data.status === 'active') {
          updates.verificationStatus = 'approved';
          updates.accessStatus = 'active';
          if (!existing.approvedAt) {
            updates.approvedBy = req.admin!.uid;
            updates.approvedByName = req.admin!.displayName;
            updates.approvedAt = now;
          }
        } else if (parsed.data.status === 'pending_verification') {
          updates.verificationStatus = 'pending_verification';
          updates.accessStatus = 'inactive';
          updates.sessionRevokedAt = now;
        } else {
          updates.accessStatus = 'blocked';
          updates.sessionRevokedAt = now;
        }
      }

      const updated = await firestorePatchFields('admin_users', staffUid, updates, req.admin!.idToken);

      if (parsed.data.status && parsed.data.status !== existing.status) {
        const auditId = `sva_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const decision =
          parsed.data.status === 'active'
            ? existing.status === 'pending_verification'
              ? 'approved'
              : 'reactivated'
            : parsed.data.status === 'rejected'
            ? 'rejected'
            : 'suspended';
        await firestoreSetDoc(
          'staff_verification_audits',
          auditId,
          {
            auditId,
            staffUid,
            staffName: String(existing.displayName || ''),
            staffEmail: String(existing.email || ''),
            invitationId: String(existing.invitationId || ''),
            department: String(parsed.data.primaryDepartment || existing.primaryDepartment || ''),
            assignedRole: String(parsed.data.role || existing.role || ''),
            decision,
            previousStatus: String(existing.status || ''),
            newStatus: parsed.data.status,
            decidedByUid: req.admin!.uid,
            decidedByName: req.admin!.displayName,
            decisionReason: parsed.data.reason?.trim() || `Status changed to ${parsed.data.status}`,
            createdAt: now,
          },
          req.admin!.idToken
        ).catch(() => undefined);
      }

      await appendAuditLog(
        req,
        'account_change',
        parsed.data.primaryDepartment ? 'TRANSFER_OR_UPDATE_STAFF' : 'UPDATE_STAFF_PERMISSIONS',
        `admin_users/${staffUid}`,
        'success',
        {
          changes: parsed.data,
          previousDepartment: existing.primaryDepartment,
          previousStatus: existing.status,
        }
      );

      res.json({ staff: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Staff update failed' });
    }
  }
);

v1Router.post(
  '/admin/staff/:uid/revoke-session',
  requireAdminAuth,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    const staffUid = String(req.params.uid || '');
    if (!validateSafeId(staffUid)) {
      res.status(400).json({ error: 'Invalid staff UID.' });
      return;
    }
    try {
      const now = new Date().toISOString();
      const updated = await firestorePatchFields(
        'admin_users',
        staffUid,
        { sessionRevokedAt: now, updatedAt: now },
        req.admin!.idToken
      );

      const loginId = `lgn_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await firestoreSetDoc(
        'staff_login_history',
        loginId,
        {
          loginId,
          uid: staffUid,
          email: String(updated.email || ''),
          department: String(updated.primaryDepartment || ''),
          outcome: 'session_revoked',
          detail: `Session revoked by ${req.admin!.email}`,
          createdAt: now,
        },
        req.admin!.idToken
      );

      await appendAuditLog(
        req,
        'security',
        'REVOKE_STAFF_SESSION',
        `admin_users/${staffUid}`,
        'success'
      );

      if (typeof updated.email === 'string' && updated.email.includes('@')) {
        void triggerAutomaticWorkflowEmail({
          toEmail: updated.email,
          recipientName: typeof updated.displayName === 'string' ? updated.displayName : undefined,
          recipientUid: staffUid,
          recipientType: 'admin',
          department: 'user_management',
          eventType: 'login_alert',
          subject: 'SWAS TASKS Security Notice – Active Session Revoked',
          title: 'Control Centre Session Revoked',
          greeting: `Hello ${String(updated.displayName || 'Administrator')},`,
          bodyText: `Your active Control Centre session was revoked by ${req.admin!.email} on ${now}. Please sign in again to continue.`,
          sourceRecord: `admin_users/${staffUid}`,
          idempotencyKey: `revoke_session_${staffUid}_${now.slice(0, 16)}`,
          triggeredByUid: req.admin!.uid,
          triggeredByEmail: req.admin!.email,
          idToken: req.admin!.idToken,
        });
      }

      res.json({ staff: updated, sessionRevokedAt: now });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Session revocation failed' });
    }
  }
);

// Login Attempt Monitoring Endpoint
const authAttemptSchema = z.object({
  email: z.string().email().max(254),
  outcome: z.enum(['check', 'failed']),
});

v1Router.post('/auth/log-attempt', authAttemptRateLimiter, (req, res: Response) => {
  const parsed = authAttemptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid attempt payload.' });
    return;
  }
  if (parsed.data.outcome === 'check') {
    res.json(isEmailLocked(parsed.data.email));
    return;
  }
  const status = recordFailedAttempt(parsed.data.email);
  res.json(status);
});

// Current Authorized Administrator / Staff Profile
v1Router.get('/admin/me', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  rememberAdminSessionToken(req.admin!);
  const now = new Date().toISOString();
  const loginId = `lgn_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  void firestoreSetDoc(
    'staff_login_history',
    loginId,
    {
      loginId,
      uid: req.admin!.uid,
      email: req.admin!.email,
      department: req.admin!.primaryDepartment,
      outcome: 'success',
      detail: `Verified login (${req.admin!.role})`,
      createdAt: now,
    },
    req.admin!.idToken
  ).catch(() => undefined);

  res.json({
    uid: req.admin!.uid,
    email: req.admin!.email,
    displayName: req.admin!.displayName,
    phone: req.admin!.phone,
    emailVerified: req.admin!.emailVerified,
    phoneVerified: req.admin!.phoneVerified,
    primaryDepartment: req.admin!.primaryDepartment,
    role: req.admin!.role,
    status: req.admin!.status,
    verificationStatus: req.admin!.verificationStatus || 'approved',
    accessStatus: req.admin!.accessStatus || 'active',
    departments: req.admin!.departments,
    actions: req.admin!.actions,
    sessionRevokedAt: req.admin!.sessionRevokedAt,
    lastLoginAt: req.admin!.lastLoginAt || now,
    photoUrl: req.admin!.photoUrl,
    notificationPrefs: req.admin!.notificationPrefs,
  });
});

const updateOwnProfileSchema = z.object({
  displayName: z.string().min(2).max(120).optional(),
  phone: z.string().max(32).optional(),
  photoUrl: z.string().max(500).optional(),
  notificationPrefs: z
    .object({
      emailAlerts: z.boolean().optional(),
      securityAlerts: z.boolean().optional(),
      departmentMentions: z.boolean().optional(),
      dailyDigest: z.boolean().optional(),
    })
    .optional(),
});

v1Router.patch('/admin/me/profile', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateOwnProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid profile update payload.', details: parsed.error.flatten() });
    return;
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (parsed.data.displayName !== undefined) updates.displayName = parsed.data.displayName.trim();
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone.trim();
  if (parsed.data.photoUrl !== undefined) updates.photoUrl = parsed.data.photoUrl.trim();
  if (parsed.data.notificationPrefs !== undefined) {
    updates.notificationPrefs = parsed.data.notificationPrefs;
  }

  try {
    const updated = await firestorePatchFields(
      'admin_users',
      req.admin!.uid,
      updates,
      req.admin!.idToken
    );
    await appendAuditLog(req, 'account_change', 'UPDATE_OWN_PROFILE', `admin_users/${req.admin!.uid}`, 'success');
    res.json({ profile: updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Profile update failed' });
  }
});

// Main Dashboard Overview (Super Admin Only — Calculated from real Firestore records)
v1Router.get('/admin/overview', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (req.admin!.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Central overview is restricted to Super Administrator.' });
    return;
  }
  const token = req.admin!.idToken;
  try {
    const [users, clients, tasks, bids, assignments, transactions, withdrawals, logs, securityEvents] =
      await Promise.all([
        firestoreListCollection('users', token).catch(() => []),
        firestoreListCollection('clients', token).catch(() => []),
        firestoreListCollection('tasks', token).catch(() => []),
        firestoreListCollection('bids', token).catch(() => []),
        firestoreListCollection('assignments', token).catch(() => []),
        firestoreListCollection('transactions', token).catch(() => []),
        firestoreListCollection('withdrawals', token).catch(() => []),
        firestoreListCollection('activity_logs', token).catch(() => []),
        firestoreListCollection('security_events', token).catch(() => []),
      ]);

    const verifiedPaymentsTotalKes = transactions
      .filter((t) => t.status === 'verified')
      .reduce((sum, t) => sum + Number(t.amountKes || 0), 0);

    res.json({
      metrics: {
        totalUsers: users.length,
        totalWorkers: users.filter((u) => u.accountType === 'worker' || u.accountType === 'hybrid').length,
        totalClients: clients.length,
        activeAccounts:
          users.filter((u) => u.status === 'active').length +
          clients.filter((c) => c.status === 'active').length,
        suspendedAccounts:
          users.filter((u) => u.status === 'suspended').length +
          clients.filter((c) => c.status === 'suspended').length,
        publishedTasks: tasks.filter((t) => t.status === 'published').length,
        pendingTasks: tasks.filter((t) => t.status === 'pending').length,
        activeAssignments: assignments.filter((a) => a.status === 'active' || a.status === 'submitted').length,
        completedAssignments: assignments.filter((a) => a.status === 'completed' || a.status === 'approved').length,
        pendingBids: bids.filter((b) => b.status === 'pending').length,
        verifiedPaymentsTotalKes,
        pendingWithdrawalsCount: withdrawals.filter((w) => w.status === 'pending').length,
      },
      recentActivity: logs.slice(0, 10),
      recentSecurityEvents: securityEvents.slice(0, 10),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Overview query failed';
    res.status(500).json({ error: message });
  }
});

// Department Endpoints
v1Router.get(
  '/admin/users',
  requireAdminAuth,
  requirePermission('user_management', 'view'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const items = await firestoreListCollection('users', req.admin!.idToken);
      res.json({ users: items });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list users' });
    }
  }
);

v1Router.post(
  '/admin/users/:id/suspend',
  requireAdminAuth,
  requirePermission('user_management', 'suspend'),
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = String(req.params.id || '');
    if (!validateSafeId(userId)) {
      res.status(400).json({ error: 'Invalid user ID format.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('users', userId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }
      const now = new Date().toISOString();
      const updated = await firestorePatchFields(
        'users',
        userId,
        { status: 'suspended', updatedAt: now },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'admin', 'SUSPEND_USER', `users/${userId}`, 'success', {
        previousStatus: existing.status,
      });

      if (typeof existing.email === 'string') {
        void triggerAutomaticWorkflowEmail({
          toEmail: existing.email,
          recipientName: String(existing.fullName || ''),
          recipientUid: userId,
          recipientType: existing.accountType === 'worker' ? 'worker' : 'user',
          department: 'user_management',
          eventType: 'account_suspended',
          subject: 'SWAS TASKS – Account Suspension Notice',
          title: 'Account Suspended',
          greeting: `Hello ${String(existing.fullName || 'Member')},`,
          bodyText: `Your SWAS TASKS account has been suspended following administrative review. Contact swastaskorg@gmail.com if you wish to appeal.`,
          sourceRecord: `users/${userId}`,
          idempotencyKey: `user_suspend_${userId}_${now.slice(0, 16)}`,
          triggeredByUid: req.admin!.uid,
          triggeredByEmail: req.admin!.email,
          idToken: req.admin!.idToken,
        });
      }

      res.json({ user: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Suspend failed' });
    }
  }
);

v1Router.post(
  '/admin/users/:id/activate',
  requireAdminAuth,
  (req, res, next) => {
    const admin = (req as AuthenticatedRequest).admin;
    if (
      admin &&
      (admin.role === 'SUPER_ADMIN' ||
        (admin.departments.includes('user_management') &&
          ['edit', 'update', 'approve', 'manage'].some((a) => admin.actions.includes(a))))
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Insufficient permissions: requires 'user_management:edit' or 'approve'." });
  },
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = String(req.params.id || '');
    if (!validateSafeId(userId)) {
      res.status(400).json({ error: 'Invalid user ID format.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('users', userId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }
      const now = new Date().toISOString();
      const updated = await firestorePatchFields(
        'users',
        userId,
        { status: 'active', updatedAt: now },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'admin', 'ACTIVATE_USER', `users/${userId}`, 'success', {
        previousStatus: existing.status,
      });

      if (typeof existing.email === 'string') {
        void triggerAutomaticWorkflowEmail({
          toEmail: existing.email,
          recipientName: String(existing.fullName || ''),
          recipientUid: userId,
          recipientType: existing.accountType === 'worker' ? 'worker' : 'user',
          department: 'user_management',
          eventType: 'account_reactivated',
          subject: 'SWAS TASKS – Account Activated',
          title: 'Account Active',
          greeting: `Hello ${String(existing.fullName || 'Member')},`,
          bodyText: `Your SWAS TASKS account status is now active. You may access all authorized platform features.`,
          sourceRecord: `users/${userId}`,
          idempotencyKey: `user_activate_${userId}_${now.slice(0, 16)}`,
          triggeredByUid: req.admin!.uid,
          triggeredByEmail: req.admin!.email,
          idToken: req.admin!.idToken,
        });
      }

      res.json({ user: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Activate failed' });
    }
  }
);

const userStatusUpdateSchema = z.object({
  status: z.enum(['pending', 'active', 'suspended', 'banned', 'recovery_requested']).optional(),
  verificationStatus: z.enum(['unverified', 'pending', 'verified', 'rejected']).optional(),
  reason: z.string().max(400).optional(),
});

v1Router.post(
  '/admin/users/:id/status',
  requireAdminAuth,
  (req, res, next) => {
    const admin = (req as AuthenticatedRequest).admin;
    if (
      admin &&
      (admin.role === 'SUPER_ADMIN' ||
        (admin.departments.includes('user_management') &&
          ['edit', 'update', 'approve', 'reject', 'suspend', 'manage'].some((a) =>
            admin.actions.includes(a)
          )))
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Insufficient permissions: requires 'user_management' update access." });
  },
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = String(req.params.id || '');
    if (!validateSafeId(userId)) {
      res.status(400).json({ error: 'Invalid user ID format.' });
      return;
    }
    const parsed = userStatusUpdateSchema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.status && !parsed.data.verificationStatus)) {
      res.status(400).json({ error: 'Provide status or verificationStatus update.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('users', userId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = { updatedAt: now };
      if (parsed.data.status) updates.status = parsed.data.status;
      if (parsed.data.verificationStatus) updates.verificationStatus = parsed.data.verificationStatus;

      const updated = await firestorePatchFields('users', userId, updates, req.admin!.idToken);
      await appendAuditLog(req, 'admin', 'UPDATE_USER_STATUS', `users/${userId}`, 'success', updates);

      if (typeof existing.email === 'string') {
        const isVerifiedEvent = parsed.data.verificationStatus === 'verified';
        const isSuspendedEvent = parsed.data.status === 'suspended' || parsed.data.status === 'banned';
        const eventType = isVerifiedEvent
          ? 'account_verification'
          : isSuspendedEvent
          ? 'account_suspended'
          : 'account_updated';
        const subject = isVerifiedEvent
          ? 'SWAS TASKS – Identity Verification Approved'
          : isSuspendedEvent
          ? `SWAS TASKS – Account ${parsed.data.status === 'banned' ? 'Banned' : 'Suspended'}`
          : 'SWAS TASKS – Account Status Updated';
        const bodyText = isVerifiedEvent
          ? `Your SWAS TASKS account verification has been approved and your account is now verified.`
          : isSuspendedEvent
          ? `Your SWAS TASKS account status has been changed to ${parsed.data.status}.${parsed.data.reason ? ` Reason: ${parsed.data.reason}` : ''}`
          : `Your SWAS TASKS account has been updated (status: ${String(updated.status)}, verification: ${String(updated.verificationStatus)}).`;

        void triggerAutomaticWorkflowEmail({
          toEmail: existing.email,
          recipientName: String(existing.fullName || ''),
          recipientUid: userId,
          recipientType: existing.accountType === 'worker' ? 'worker' : 'user',
          department: 'user_management',
          eventType,
          subject,
          title: 'Account Update',
          greeting: `Hello ${String(existing.fullName || 'Member')},`,
          bodyText,
          sourceRecord: `users/${userId}`,
          idempotencyKey: `user_status_${userId}_${JSON.stringify(updates)}_${now.slice(0, 16)}`,
          triggeredByUid: req.admin!.uid,
          triggeredByEmail: req.admin!.email,
          idToken: req.admin!.idToken,
        });
      }

      res.json({ user: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'User update failed' });
    }
  }
);

v1Router.get(
  '/admin/clients',
  requireAdminAuth,
  requirePermission('client_management', 'view'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const items = await firestoreListCollection('clients', req.admin!.idToken);
      res.json({ clients: items });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list clients' });
    }
  }
);

const clientStatusUpdateSchema = z.object({
  status: z.enum(['pending', 'active', 'restricted', 'suspended']).optional(),
  verificationStatus: z.enum(['unverified', 'pending', 'verified', 'rejected']).optional(),
  reason: z.string().max(400).optional(),
});

v1Router.post(
  '/admin/clients/:id/status',
  requireAdminAuth,
  (req, res, next) => {
    const admin = (req as AuthenticatedRequest).admin;
    if (
      admin &&
      (admin.role === 'SUPER_ADMIN' ||
        (admin.departments.includes('client_management') &&
          ['edit', 'update', 'approve', 'reject', 'suspend', 'manage'].some((a) =>
            admin.actions.includes(a)
          )))
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Insufficient permissions: requires 'client_management' update access." });
  },
  async (req: AuthenticatedRequest, res: Response) => {
    const clientId = String(req.params.id || '');
    if (!validateSafeId(clientId)) {
      res.status(400).json({ error: 'Invalid client ID.' });
      return;
    }
    const parsed = clientStatusUpdateSchema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.status && !parsed.data.verificationStatus)) {
      res.status(400).json({ error: 'Provide status or verificationStatus update.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('clients', clientId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Client record not found.' });
        return;
      }
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = { updatedAt: now };
      if (parsed.data.status) updates.status = parsed.data.status;
      if (parsed.data.verificationStatus) updates.verificationStatus = parsed.data.verificationStatus;

      const updated = await firestorePatchFields('clients', clientId, updates, req.admin!.idToken);
      await appendAuditLog(req, 'client', 'UPDATE_CLIENT_STATUS', `clients/${clientId}`, 'success', updates);

      if (typeof existing.email === 'string') {
        const isVerified = parsed.data.verificationStatus === 'verified';
        const isRestricted = parsed.data.status === 'restricted' || parsed.data.status === 'suspended';
        void triggerAutomaticWorkflowEmail({
          toEmail: existing.email,
          recipientName: String(existing.name || existing.companyName || 'Client'),
          recipientUid: String(existing.ownerUid || clientId),
          recipientType: 'client',
          department: 'client_management',
          eventType: isVerified ? 'client_registration' : 'client_account_update',
          subject: isVerified
            ? 'SWAS TASKS – Client Account Verified'
            : isRestricted
            ? `SWAS TASKS – Client Account ${parsed.data.status === 'suspended' ? 'Suspended' : 'Restricted'}`
            : 'SWAS TASKS – Client Profile Updated',
          title: 'Client Account Notice',
          greeting: `Hello ${String(existing.name || 'Client')},`,
          bodyText: isVerified
            ? 'Your SWAS TASKS client profile has been verified. You can now publish tasks and manage assignments.'
            : isRestricted
            ? `Your SWAS TASKS client account has been placed under '${parsed.data.status}' status.${parsed.data.reason ? ` Note: ${parsed.data.reason}` : ''}`
            : `Your SWAS TASKS client profile status is now '${String(updated.status)}' (verification: ${String(updated.verificationStatus)}).`,
          sourceRecord: `clients/${clientId}`,
          idempotencyKey: `client_status_${clientId}_${JSON.stringify(updates)}_${now.slice(0, 16)}`,
          triggeredByUid: req.admin!.uid,
          triggeredByEmail: req.admin!.email,
          idToken: req.admin!.idToken,
        });
      }

      res.json({ client: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Client update failed' });
    }
  }
);

v1Router.get(
  '/admin/tasks',
  requireAdminAuth,
  requirePermission('task_monitoring', 'view'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const items = await firestoreListCollection('tasks', req.admin!.idToken);
      res.json({ tasks: items });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list tasks' });
    }
  }
);

const moderateTaskSchema = z.object({
  status: z.enum(['pending', 'published', 'active', 'completed', 'rejected', 'reported', 'removed']),
  moderationNotes: z.string().max(1000).optional(),
});

v1Router.post(
  '/admin/tasks/:id/moderate',
  requireAdminAuth,
  (req, res, next) => {
    const admin = (req as AuthenticatedRequest).admin;
    if (
      admin &&
      (admin.role === 'SUPER_ADMIN' ||
        (admin.departments.includes('task_monitoring') &&
          ['edit', 'update', 'approve', 'reject', 'suspend', 'manage'].some((a) =>
            admin.actions.includes(a)
          )))
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Insufficient permissions: requires 'task_monitoring' moderation access." });
  },
  async (req: AuthenticatedRequest, res: Response) => {
    const taskId = String(req.params.id || '');
    if (!validateSafeId(taskId)) {
      res.status(400).json({ error: 'Invalid task ID.' });
      return;
    }
    const parsed = moderateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid moderation payload.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('tasks', taskId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Task not found.' });
        return;
      }
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = {
        status: parsed.data.status,
        updatedAt: now,
      };
      if (parsed.data.moderationNotes !== undefined) {
        updates.moderationNotes = parsed.data.moderationNotes.trim();
      }
      const updated = await firestorePatchFields('tasks', taskId, updates, req.admin!.idToken);
      await appendAuditLog(req, 'admin', `TASK_${parsed.data.status.toUpperCase()}`, `tasks/${taskId}`, 'success', updates);

      if (existing.clientId && (parsed.data.status === 'published' || parsed.data.status === 'rejected' || parsed.data.status === 'removed')) {
        const clientDoc = await firestoreGetDoc('clients', String(existing.clientId), req.admin!.idToken).catch(() => null);
        if (clientDoc && typeof clientDoc.email === 'string') {
          void triggerAutomaticWorkflowEmail({
            toEmail: clientDoc.email,
            recipientName: String(clientDoc.name || existing.clientName || 'Client'),
            recipientUid: String(clientDoc.ownerUid || existing.clientId),
            recipientType: 'client',
            department: 'task_monitoring',
            eventType: parsed.data.status === 'published' ? 'task_posted' : 'task_moderated',
            subject:
              parsed.data.status === 'published'
                ? `SWAS TASKS – Task Published: ${String(existing.title)}`
                : `SWAS TASKS – Task Moderation Notice: ${String(existing.title)}`,
            title: parsed.data.status === 'published' ? 'Task Published' : 'Task Moderation Update',
            greeting: `Hello ${String(clientDoc.name || 'Client')},`,
            bodyText:
              parsed.data.status === 'published'
                ? `Your task "${String(existing.title)}" (KES ${Number(existing.budgetKes || 0).toLocaleString()}) has passed moderation and is now published for worker bidding.`
                : `Your task "${String(existing.title)}" was marked as '${parsed.data.status}' during moderation.${parsed.data.moderationNotes ? ` Notes: ${parsed.data.moderationNotes}` : ''}`,
            sourceRecord: `tasks/${taskId}`,
            idempotencyKey: `task_mod_${taskId}_${parsed.data.status}_${now.slice(0, 16)}`,
            triggeredByUid: req.admin!.uid,
            triggeredByEmail: req.admin!.email,
            idToken: req.admin!.idToken,
          });
        }
      }

      res.json({ task: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Task moderation failed' });
    }
  }
);

v1Router.get(
  '/admin/bids',
  requireAdminAuth,
  requirePermission('bids_assignments', 'view'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const items = await firestoreListCollection('bids', req.admin!.idToken);
      res.json({ bids: items });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list bids' });
    }
  }
);

v1Router.get(
  '/admin/assignments',
  requireAdminAuth,
  requirePermission('bids_assignments', 'view'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const items = await firestoreListCollection('assignments', req.admin!.idToken);
      res.json({ assignments: items });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list assignments' });
    }
  }
);

v1Router.get(
  '/admin/transactions',
  requireAdminAuth,
  requirePermission('finance_control', 'view'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const items = await firestoreListCollection('transactions', req.admin!.idToken);
      res.json({ transactions: items, currency: 'KES' });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list transactions' });
    }
  }
);

v1Router.get(
  '/admin/withdrawals',
  requireAdminAuth,
  requirePermission('finance_control', 'view'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const items = await firestoreListCollection('withdrawals', req.admin!.idToken);
      res.json({ withdrawals: items, currency: 'KES' });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list withdrawals' });
    }
  }
);

const processedWithdrawalKeys = new Set<string>();
const withdrawalReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reviewNote: z.string().min(2).max(500),
  providerRef: z.string().max(128).optional(),
});

v1Router.post(
  '/admin/withdrawals/:id/review',
  requireAdminAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    if (
      admin.role !== 'SUPER_ADMIN' &&
      (!admin.departments.includes('finance_control') ||
        (!admin.actions.includes('approve') &&
          !admin.actions.includes('reject') &&
          !admin.actions.includes('manage')))
    ) {
      res.status(403).json({ error: 'Insufficient finance_control approval permissions.' });
      return;
    }

    const withdrawalId = String(req.params.id || '');
    if (!validateSafeId(withdrawalId)) {
      res.status(400).json({ error: 'Invalid withdrawal ID.' });
      return;
    }

    const parsed = withdrawalReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid withdrawal review payload.', details: parsed.error.flatten() });
      return;
    }

    const headerKey = req.headers['idempotency-key'];
    const idempotencyKey =
      typeof headerKey === 'string' && headerKey.trim()
        ? headerKey.trim().slice(0, 128)
        : `wd_${withdrawalId}_${parsed.data.decision}`;

    if (processedWithdrawalKeys.has(idempotencyKey)) {
      res.status(409).json({ error: 'Duplicate withdrawal review request blocked by idempotency lock.' });
      return;
    }

    try {
      const existing = await firestoreGetDoc('withdrawals', withdrawalId, admin.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Withdrawal request not found.' });
        return;
      }
      if (existing.status !== 'pending') {
        res.status(409).json({
          error: `Withdrawal already processed with status '${String(existing.status)}'. Duplicate processing is blocked.`,
        });
        return;
      }

      processedWithdrawalKeys.add(idempotencyKey);
      const now = new Date().toISOString();
      const updated = await firestorePatchFields(
        'withdrawals',
        withdrawalId,
        {
          status: parsed.data.decision,
          reviewedBy: admin.uid,
          reviewNote: parsed.data.reviewNote.trim(),
          idempotencyKey,
          providerRef: parsed.data.providerRef?.trim() || '',
          updatedAt: now,
        },
        admin.idToken
      );

      await appendAuditLog(
        req,
        'financial',
        `WITHDRAWAL_${parsed.data.decision.toUpperCase()}`,
        `withdrawals/${withdrawalId}`,
        'success',
        {
          amountKes: existing.amountKes,
          workerUid: existing.workerUid,
          idempotencyKey,
        }
      );

      if (existing.workerUid) {
        const workerDoc = await firestoreGetDoc('users', String(existing.workerUid), admin.idToken).catch(() => null);
        if (workerDoc && typeof workerDoc.email === 'string') {
          void triggerAutomaticWorkflowEmail({
            toEmail: workerDoc.email,
            recipientName: String(workerDoc.fullName || existing.workerName || 'Worker'),
            recipientUid: String(existing.workerUid),
            recipientType: 'worker',
            department: 'finance_control',
            eventType: 'withdrawal_notification',
            subject: `SWAS TASKS – Withdrawal ${parsed.data.decision === 'approved' ? 'Approved' : 'Rejected'} (KES ${Number(existing.amountKes || 0).toLocaleString()})`,
            title: `Withdrawal ${parsed.data.decision === 'approved' ? 'Approved' : 'Rejected'}`,
            greeting: `Hello ${String(workerDoc.fullName || existing.workerName || 'Worker')},`,
            bodyText: `Your withdrawal request of KES ${Number(existing.amountKes || 0).toLocaleString()} (${String(existing.destinationType).toUpperCase()}) has been ${parsed.data.decision}. Reviewer note: ${parsed.data.reviewNote.trim()}`,
            sourceRecord: `withdrawals/${withdrawalId}`,
            idempotencyKey: `wd_mail_${withdrawalId}_${parsed.data.decision}`,
            triggeredByUid: admin.uid,
            triggeredByEmail: admin.email,
            idToken: admin.idToken,
          });
        }
      }

      res.json({ withdrawal: updated, idempotencyKey });
    } catch (err) {
      processedWithdrawalKeys.delete(idempotencyKey);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Withdrawal review failed' });
    }
  }
);

const bidReviewSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});

v1Router.post(
  '/admin/bids/:id/review',
  requireAdminAuth,
  (req, res, next) => {
    const admin = (req as AuthenticatedRequest).admin;
    if (
      admin &&
      (admin.role === 'SUPER_ADMIN' ||
        (admin.departments.includes('bids_assignments') &&
          ['edit', 'update', 'approve', 'reject', 'manage'].some((a) => admin.actions.includes(a))))
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Insufficient permissions: requires 'bids_assignments' review access." });
  },
  async (req: AuthenticatedRequest, res: Response) => {
    const bidId = String(req.params.id || '');
    if (!validateSafeId(bidId)) {
      res.status(400).json({ error: 'Invalid bid ID.' });
      return;
    }
    const parsed = bidReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bid review status.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('bids', bidId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Bid not found.' });
        return;
      }
      const now = new Date().toISOString();
      const updated = await firestorePatchFields(
        'bids',
        bidId,
        { status: parsed.data.status, updatedAt: now },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'admin', `BID_${parsed.data.status.toUpperCase()}`, `bids/${bidId}`, 'success');

      if (existing.workerUid) {
        const workerDoc = await firestoreGetDoc('users', String(existing.workerUid), req.admin!.idToken).catch(() => null);
        if (workerDoc && typeof workerDoc.email === 'string') {
          void triggerAutomaticWorkflowEmail({
            toEmail: workerDoc.email,
            recipientName: String(workerDoc.fullName || existing.workerName || 'Worker'),
            recipientUid: String(existing.workerUid),
            recipientType: 'worker',
            department: 'bids_assignments',
            eventType: 'bid_assignment',
            subject: `SWAS TASKS – Bid ${parsed.data.status === 'accepted' ? 'Accepted' : 'Not Selected'}: ${String(existing.taskTitle || existing.taskId)}`,
            title: `Bid ${parsed.data.status === 'accepted' ? 'Accepted' : 'Update'}`,
            greeting: `Hello ${String(workerDoc.fullName || existing.workerName || 'Worker')},`,
            bodyText: `Your bid of KES ${Number(existing.amountKes || 0).toLocaleString()} for "${String(existing.taskTitle || existing.taskId)}" has been ${parsed.data.status}.`,
            sourceRecord: `bids/${bidId}`,
            idempotencyKey: `bid_mail_${bidId}_${parsed.data.status}`,
            triggeredByUid: req.admin!.uid,
            triggeredByEmail: req.admin!.email,
            idToken: req.admin!.idToken,
          });
        }
      }

      res.json({ bid: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Bid review failed' });
    }
  }
);

const submissionReviewSchema = z.object({
  status: z.enum(['approved', 'revision_requested', 'rejected']),
  reviewerNote: z.string().max(1000).optional(),
});

v1Router.post(
  '/admin/submissions/:id/review',
  requireAdminAuth,
  (req, res, next) => {
    const admin = (req as AuthenticatedRequest).admin;
    if (
      admin &&
      (admin.role === 'SUPER_ADMIN' ||
        (admin.departments.includes('bids_assignments') &&
          ['edit', 'update', 'approve', 'reject', 'manage'].some((a) => admin.actions.includes(a))))
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Insufficient permissions: requires 'bids_assignments' review access." });
  },
  async (req: AuthenticatedRequest, res: Response) => {
    const submissionId = String(req.params.id || '');
    if (!validateSafeId(submissionId)) {
      res.status(400).json({ error: 'Invalid submission ID.' });
      return;
    }
    const parsed = submissionReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid submission review payload.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('work_submissions', submissionId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Work submission not found.' });
        return;
      }
      const now = new Date().toISOString();
      const updated = await firestorePatchFields(
        'work_submissions',
        submissionId,
        {
          status: parsed.data.status,
          reviewerNote: (parsed.data.reviewerNote || '').trim(),
          updatedAt: now,
        },
        req.admin!.idToken
      );

      if (existing.assignmentId) {
        const assignmentStatus =
          parsed.data.status === 'approved'
            ? 'completed'
            : parsed.data.status === 'revision_requested'
            ? 'revision_requested'
            : 'cancelled';
        await firestorePatchFields(
          'assignments',
          String(existing.assignmentId),
          { status: assignmentStatus, updatedAt: now },
          req.admin!.idToken
        ).catch(() => undefined);
      }

      await appendAuditLog(req, 'admin', `SUBMISSION_${parsed.data.status.toUpperCase()}`, `work_submissions/${submissionId}`, 'success', {
        reviewerNote: parsed.data.reviewerNote || '',
      });

      if (existing.workerUid) {
        const workerDoc = await firestoreGetDoc('users', String(existing.workerUid), req.admin!.idToken).catch(() => null);
        if (workerDoc && typeof workerDoc.email === 'string') {
          void triggerAutomaticWorkflowEmail({
            toEmail: workerDoc.email,
            recipientName: String(workerDoc.fullName || existing.workerName || 'Worker'),
            recipientUid: String(existing.workerUid),
            recipientType: 'worker',
            department: 'bids_assignments',
            eventType: 'bid_assignment',
            subject: `SWAS TASKS – Deliverable Review (${parsed.data.status.replace('_', ' ')}): ${String(existing.taskTitle || existing.taskId)}`,
            title: 'Work Submission Reviewed',
            greeting: `Hello ${String(workerDoc.fullName || existing.workerName || 'Worker')},`,
            bodyText: `Your work submission for "${String(existing.taskTitle || existing.taskId)}" has been marked '${parsed.data.status.replace('_', ' ')}'.${parsed.data.reviewerNote ? ` Reviewer notes: ${parsed.data.reviewerNote}` : ''}`,
            sourceRecord: `work_submissions/${submissionId}`,
            idempotencyKey: `sub_review_${submissionId}_${parsed.data.status}_${now.slice(0, 16)}`,
            triggeredByUid: req.admin!.uid,
            triggeredByEmail: req.admin!.email,
            idToken: req.admin!.idToken,
          });
        }
      }

      res.json({ submission: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Submission review failed' });
    }
  }
);

const disputeResolveSchema = z.object({
  status: z.enum(['under_review', 'resolved_client', 'resolved_worker', 'dismissed']),
  resolutionNote: z.string().min(2).max(1000),
});

v1Router.post(
  '/admin/disputes/:id/resolve',
  requireAdminAuth,
  requirePermission('bids_assignments', 'edit'),
  async (req: AuthenticatedRequest, res: Response) => {
    const disputeId = String(req.params.id || '');
    if (!validateSafeId(disputeId)) {
      res.status(400).json({ error: 'Invalid dispute ID.' });
      return;
    }
    const parsed = disputeResolveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid dispute resolution payload.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('disputes', disputeId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Dispute record not found.' });
        return;
      }
      const now = new Date().toISOString();
      const updated = await firestorePatchFields(
        'disputes',
        disputeId,
        {
          status: parsed.data.status,
          resolutionNote: parsed.data.resolutionNote.trim(),
          resolvedBy: req.admin!.uid,
          updatedAt: now,
        },
        req.admin!.idToken
      );
      await appendAuditLog(
        req,
        'admin',
        `DISPUTE_${parsed.data.status.toUpperCase()}`,
        `disputes/${disputeId}`,
        'success',
        { resolutionNote: parsed.data.resolutionNote.trim() }
      );

      const notifyUids = [String(existing.openedByUid || ''), String(existing.againstUid || '')].filter(Boolean);
      for (const targetUid of Array.from(new Set(notifyUids))) {
        const userDoc = await firestoreGetDoc('users', targetUid, req.admin!.idToken).catch(() => null);
        const clientDoc = !userDoc
          ? await firestoreGetDoc('clients', targetUid, req.admin!.idToken).catch(() => null)
          : null;
        const email = typeof userDoc?.email === 'string' ? userDoc.email : typeof clientDoc?.email === 'string' ? clientDoc.email : '';
        const name = String(userDoc?.fullName || clientDoc?.name || 'Member');
        if (email) {
          void triggerAutomaticWorkflowEmail({
            toEmail: email,
            recipientName: name,
            recipientUid: targetUid,
            recipientType: userDoc ? 'worker' : 'client',
            department: 'bids_assignments',
            eventType: 'dispute_update',
            subject: `SWAS TASKS – Dispute Update (${parsed.data.status.replace('_', ' ')}): ${String(existing.taskTitle || existing.assignmentId)}`,
            title: 'Dispute Arbitration Update',
            greeting: `Hello ${name},`,
            bodyText: `Dispute ${disputeId} has been updated to '${parsed.data.status.replace('_', ' ')}'. Arbitration note: ${parsed.data.resolutionNote.trim()}`,
            sourceRecord: `disputes/${disputeId}`,
            idempotencyKey: `dispute_${disputeId}_${parsed.data.status}_${targetUid}_${now.slice(0, 16)}`,
            triggeredByUid: req.admin!.uid,
            triggeredByEmail: req.admin!.email,
            idToken: req.admin!.idToken,
          });
        }
      }

      res.json({ dispute: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Dispute resolution failed' });
    }
  }
);

v1Router.get(
  '/admin/activity-logs',
  requireAdminAuth,
  requirePermission('activity_logs', 'view'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const items = await firestoreListCollection('activity_logs', req.admin!.idToken);
      res.json({ logs: items });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list activity logs' });
    }
  }
);

const announcementSchema = z.object({
  title: z.string().min(2).max(200),
  body: z.string().min(2).max(5000),
  audience: z.enum(['all', 'workers', 'clients', 'admins']).default('all'),
  active: z.boolean().default(true),
});

v1Router.post(
  '/admin/announcements',
  requireAdminAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid announcement payload.', details: parsed.error.flatten() });
      return;
    }
    const announcementId = `ann_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();
    try {
      const created = await firestoreSetDoc(
        'announcements',
        announcementId,
        {
          announcementId,
          ...parsed.data,
          createdBy: req.admin!.uid,
          createdAt: now,
        },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'admin', 'PUBLISH_ANNOUNCEMENT', `announcements/${announcementId}`, 'success', {
        audience: parsed.data.audience,
      });
      res.status(201).json({ announcement: created });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create announcement' });
    }
  }
);

// Cryptographic API Key Management
const createApiKeySchema = z.object({
  name: z.string().min(2).max(100),
  scopes: z.array(z.string().min(1).max(64)).min(1).max(20),
  rateLimitPerMin: z.number().int().min(1).max(100000).default(120),
  expiresAt: z.string().max(64).optional(),
});

v1Router.post(
  '/admin/api-keys/generate',
  requireAdminAuth,
  requirePermission('api_management', 'create'),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid API key payload.', details: parsed.error.flatten() });
      return;
    }
    const keyId = `key_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const rawSecret = `swas_live_${crypto.randomBytes(24).toString('hex')}`;
    const prefix = rawSecret.slice(0, 16);
    const keyHash = hashApiKey(rawSecret);
    const now = new Date().toISOString();

    try {
      const record = await firestoreSetDoc(
        'api_keys',
        keyId,
        {
          keyId,
          name: parsed.data.name,
          prefix,
          keyHash,
          scopes: parsed.data.scopes,
          status: 'active',
          rateLimitPerMin: parsed.data.rateLimitPerMin,
          expiresAt: parsed.data.expiresAt || '',
          createdBy: req.admin!.uid,
          createdAt: now,
          updatedAt: now,
        },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'api', 'GENERATE_API_KEY', `api_keys/${keyId}`, 'success', {
        name: parsed.data.name,
        scopes: parsed.data.scopes,
      });
      res.status(201).json({
        apiKey: record,
        plaintextSecretOnce: rawSecret,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate API key' });
    }
  }
);

v1Router.post(
  '/admin/api-keys/:id/rotate',
  requireAdminAuth,
  requirePermission('api_management', 'edit'),
  async (req: AuthenticatedRequest, res: Response) => {
    const keyId = String(req.params.id || '');
    if (!validateSafeId(keyId)) {
      res.status(400).json({ error: 'Invalid API key ID.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('api_keys', keyId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'API key not found.' });
        return;
      }
      const rawSecret = `swas_live_${crypto.randomBytes(24).toString('hex')}`;
      const prefix = rawSecret.slice(0, 16);
      const keyHash = hashApiKey(rawSecret);
      const updated = await firestorePatchFields(
        'api_keys',
        keyId,
        {
          prefix,
          keyHash,
          status: 'active',
          updatedAt: new Date().toISOString(),
        },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'api', 'ROTATE_API_KEY', `api_keys/${keyId}`, 'success');
      res.json({ apiKey: updated, plaintextSecretOnce: rawSecret });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to rotate key' });
    }
  }
);

v1Router.post(
  '/admin/api-keys/:id/revoke',
  requireAdminAuth,
  requirePermission('api_management', 'revoke'),
  async (req: AuthenticatedRequest, res: Response) => {
    const keyId = String(req.params.id || '');
    if (!validateSafeId(keyId)) {
      res.status(400).json({ error: 'Invalid API key ID.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('api_keys', keyId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'API key not found.' });
        return;
      }
      const updated = await firestorePatchFields(
        'api_keys',
        keyId,
        {
          status: 'revoked',
          updatedAt: new Date().toISOString(),
        },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'security', 'REVOKE_API_KEY', `api_keys/${keyId}`, 'success');
      res.json({ apiKey: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to revoke key' });
    }
  }
);

// --- Central Email Service & Notification Endpoints (swastaskorg@gmail.com) ---
const emailAttachmentSchema = z.object({
  name: z.string().min(1).max(120),
  contentType: z.string().min(3).max(120),
  sizeBytes: z.number().int().min(1).max(serverConfig.maxEmailAttachmentBytes),
  storagePath: z.string().max(400).optional(),
  downloadUrl: z.string().url().max(1000),
});

const TEMPLATE_CATEGORIES = [
  'General Announcements',
  'Account Updates',
  'Welcome Emails',
  'Payment Notifications',
  'Important Notices',
  'Task Notifications',
  'Warnings',
  'Support Responses',
  'Policy Updates',
  'Custom Templates',
] as const;

v1Router.get(
  '/admin/email/status',
  requireAdminAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    rememberAdminSessionToken(admin);
    if (
      admin.role !== 'SUPER_ADMIN' &&
      !hasEmailPermission(admin, 'email.view') &&
      !hasEmailPermission(admin, 'email.manage_settings') &&
      !admin.departments.includes('platform_settings') &&
      !admin.departments.includes('user_management')
    ) {
      res.status(403).json({ error: 'Insufficient permissions to inspect email configuration.' });
      return;
    }

    try {
      const [senderIdentity, verification] = await Promise.all([
        resolveEffectiveSenderIdentity(admin.idToken),
        checkEmailDomainAuthentication(serverConfig.officialPlatformEmail),
      ]);
      res.json({
        messaging: getMessagingStatus(),
        senderIdentity,
        verification,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to inspect email status',
      });
    }
  }
);

v1Router.post(
  '/admin/email/gmail-auth-check',
  requireAdminAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    rememberAdminSessionToken(admin);
    if (
      admin.role !== 'SUPER_ADMIN' &&
      !hasEmailPermission(admin, 'email.view') &&
      !hasEmailPermission(admin, 'email.manage_settings') &&
      !admin.departments.includes('platform_settings') &&
      !admin.departments.includes('user_management')
    ) {
      res.status(403).json({ error: 'Insufficient permissions to verify Gmail authorization.' });
      return;
    }

    try {
      const result = await inspectGmailOAuthToken(extractGmailAccessToken(req));
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to verify Gmail authorization',
      });
    }
  }
);

v1Router.get(
  '/admin/email/recipients',
  requireAdminAuth,
  requireEmailPermission('email.view', 'email.compose'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    rememberAdminSessionToken(admin);
    const token = admin.idToken;
    const isSuper = admin.role === 'SUPER_ADMIN';
    const hasDept = (dept: string) => isSuper || admin.departments.includes(dept);

    try {
      const [users, clients, admins, tasks, withdrawals] = await Promise.all([
        hasDept('user_management') || hasDept('bids_assignments') || hasDept('finance_control')
          ? firestoreListCollection('users', token).catch(() => [])
          : Promise.resolve([]),
        hasDept('client_management') || hasDept('task_monitoring') || hasDept('bids_assignments') || hasDept('finance_control')
          ? firestoreListCollection('clients', token).catch(() => [])
          : Promise.resolve([]),
        isSuper || (hasDept('user_management') && admin.actions.includes('manage'))
          ? firestoreListCollection('admin_users', token).catch(() => [])
          : Promise.resolve([]),
        hasDept('task_monitoring') ? firestoreListCollection('tasks', token).catch(() => []) : Promise.resolve([]),
        hasDept('finance_control') ? firestoreListCollection('withdrawals', token).catch(() => []) : Promise.resolve([]),
      ]);

      const map = new Map<string, Record<string, unknown>>();

      for (const u of users) {
        const email = String(u.email || '').trim().toLowerCase();
        if (!email) continue;
        const accountType = String(u.accountType || 'worker');
        const recipientType = accountType === 'client' ? 'client' : accountType === 'worker' || accountType === 'hybrid' ? 'worker' : 'user';
        map.set(`user_${email}`, {
          id: `user_${String(u.uid || u.id || email)}`,
          uid: String(u.uid || u.id || ''),
          name: String(u.fullName || email),
          email,
          phone: typeof u.phone === 'string' ? u.phone : '',
          recipientType,
          department: 'user_management',
          status: String(u.status || 'active'),
          accountStatus: String(u.status || 'active'),
          registrationDate: String(u.createdAt || ''),
          contextLabel: `${accountType} · ${String(u.verificationStatus || 'unverified')}`,
          sourceRecord: `users/${String(u.uid || u.id || '')}`,
        });
      }

      for (const c of clients) {
        const email = String(c.email || '').trim().toLowerCase();
        if (!email) continue;
        const taskCount = tasks.filter((t) => t.clientId === (c.clientId || c.id)).length;
        map.set(`client_${email}`, {
          id: `client_${String(c.clientId || c.id || email)}`,
          uid: String(c.ownerUid || c.clientId || c.id || ''),
          name: String(c.name || email),
          email,
          companyName: typeof c.companyName === 'string' ? c.companyName : '',
          recipientType: 'client',
          department: 'client_management',
          status: String(c.status || 'active'),
          accountStatus: String(c.status || 'active'),
          registrationDate: String(c.createdAt || ''),
          contextLabel: `${String(c.accountTier || 'individual')} client${taskCount > 0 ? ` · ${taskCount} tasks` : ''}`,
          sourceRecord: `clients/${String(c.clientId || c.id || '')}`,
        });
      }

      for (const a of admins) {
        const email = String(a.email || '').trim().toLowerCase();
        if (!email) continue;
        map.set(`admin_${email}`, {
          id: `admin_${String(a.uid || a.id || email)}`,
          uid: String(a.uid || a.id || ''),
          name: String(a.displayName || email),
          email,
          phone: typeof a.phone === 'string' ? a.phone : '',
          recipientType: 'admin',
          department: String(a.primaryDepartment || 'platform_settings'),
          status: String(a.status || 'active'),
          accountStatus: String(a.status || 'active'),
          registrationDate: String(a.createdAt || ''),
          contextLabel: String(a.role || 'Staff'),
          sourceRecord: `admin_users/${String(a.uid || a.id || '')}`,
        });
      }

      for (const w of withdrawals) {
        const uid = String(w.workerUid || '');
        const existingUser = Array.from(map.values()).find((r) => r.uid === uid);
        if (existingUser) {
          existingUser.contextLabel = `${String(existingUser.contextLabel)} · Withdrawal KES ${Number(w.amountKes || 0).toLocaleString()}`;
        }
      }

      res.json({ recipients: Array.from(map.values()) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build recipient directory' });
    }
  }
);

v1Router.get(
  '/admin/email/history',
  requireAdminAuth,
  requireEmailPermission('email.view'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    rememberAdminSessionToken(admin);
    try {
      await syncBufferedWebhookEvents(admin.idToken).catch(() => 0);
      const canSeeAll =
        admin.role === 'SUPER_ADMIN' ||
        admin.departments.includes('platform_settings') ||
        admin.departments.includes('activity_logs');
      const requestedDept = typeof req.query.department === 'string' ? req.query.department : undefined;
      const scopeDept = canSeeAll
        ? requestedDept && requestedDept !== 'all'
          ? requestedDept
          : 'all'
        : resolveScopedDepartment(admin, requestedDept);

      const logs =
        scopeDept === 'all'
          ? await firestoreListCollection('email_logs', admin.idToken, 500)
          : await firestoreQueryByField('email_logs', 'department', 'EQUAL', scopeDept, admin.idToken, 300);

      logs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      res.json({ logs });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load email history' });
    }
  }
);

v1Router.get(
  '/admin/email/reports',
  requireAdminAuth,
  requireEmailPermission('email.view_reports', 'email.view'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    rememberAdminSessionToken(admin);
    try {
      await syncBufferedWebhookEvents(admin.idToken).catch(() => 0);
      const canSeeAll =
        admin.role === 'SUPER_ADMIN' ||
        admin.departments.includes('platform_settings') ||
        admin.departments.includes('activity_logs');
      const scopeDept = canSeeAll ? 'all' : resolveScopedDepartment(admin);

      const [logs, campaigns, templates] = await Promise.all([
        scopeDept === 'all'
          ? firestoreListCollection('email_logs', admin.idToken, 500).catch(() => [])
          : firestoreQueryByField('email_logs', 'department', 'EQUAL', scopeDept, admin.idToken, 300).catch(() => []),
        scopeDept === 'all'
          ? firestoreListCollection('email_campaigns', admin.idToken, 200).catch(() => [])
          : firestoreQueryByField('email_campaigns', 'department', 'EQUAL', scopeDept, admin.idToken, 200).catch(() => []),
        scopeDept === 'all'
          ? firestoreListCollection('email_templates', admin.idToken, 200).catch(() => [])
          : firestoreQueryByField('email_templates', 'department', 'IN', ['all', scopeDept], admin.idToken, 200).catch(() => []),
      ]);

      const totalAttempted = logs.length;
      const sentOrAccepted = logs.filter((l) => l.status === 'sent' || l.status === 'accepted').length;
      const confirmedDelivered = logs.filter((l) => l.status === 'delivered').length;
      const failedCount = logs.filter((l) => l.status === 'failed' || l.status === 'rejected').length;
      const notConfiguredCount = logs.filter((l) => l.status === 'not_configured').length;
      const bouncedCount = logs.filter((l) => l.status === 'bounced').length;
      const scheduledCount = logs.filter((l) => l.status === 'scheduled').length;
      const cancelledCount = logs.filter((l) => l.status === 'cancelled').length;

      const denominator = sentOrAccepted + confirmedDelivered + failedCount + bouncedCount;
      const deliverySuccessRate =
        denominator > 0 ? Number((((sentOrAccepted + confirmedDelivered) / denominator) * 100).toFixed(1)) : 0;
      const bounceRate =
        denominator > 0 ? Number(((bouncedCount / denominator) * 100).toFixed(1)) : 0;

      const dailyMap = new Map<string, { date: string; sent: number; failed: number; scheduled: number }>();
      for (const l of logs) {
        const day = String(l.createdAt || '').slice(0, 10) || 'unknown';
        const cur = dailyMap.get(day) || { date: day, sent: 0, failed: 0, scheduled: 0 };
        if (l.status === 'sent' || l.status === 'accepted' || l.status === 'delivered') cur.sent += 1;
        else if (l.status === 'scheduled') cur.scheduled += 1;
        else if (l.status === 'failed' || l.status === 'bounced' || l.status === 'not_configured') cur.failed += 1;
        dailyMap.set(day, cur);
      }

      res.json({
        metrics: {
          totalAttempted,
          sentOrAccepted,
          confirmedDelivered,
          failedCount,
          notConfiguredCount,
          bouncedCount,
          scheduledCount,
          cancelledCount,
          deliverySuccessRate,
          bounceRate,
          campaignCount: campaigns.length,
          templateCount: templates.length,
        },
        volumeByDay: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-14),
        recentCampaigns: campaigns.slice(0, 10),
        templateUsage: templates
          .map((t) => ({
            templateId: t.templateId,
            name: t.name,
            category: t.category,
            usageCount: Number(t.usageCount || 0),
          }))
          .sort((a, b) => b.usageCount - a.usageCount)
          .slice(0, 10),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute email reports' });
    }
  }
);

const testEmailSchema = z.object({
  recipientEmail: z.string().email().max(254),
  subject: z.string().min(2).max(200).optional(),
  message: z.string().min(2).max(2000).optional(),
});

v1Router.post(
  '/admin/email/test',
  requireAdminAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    if (
      admin.role !== 'SUPER_ADMIN' &&
      !hasEmailPermission(admin, 'email.manage_settings') &&
      !hasEmailPermission(admin, 'email.send') &&
      !admin.departments.includes('platform_settings')
    ) {
      res.status(403).json({ error: 'Insufficient permissions to send test emails.' });
      return;
    }

    const parsed = testEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid recipient email is required.', details: parsed.error.flatten() });
      return;
    }

    const recipient = parsed.data.recipientEmail.trim().toLowerCase();
    const subject =
      parsed.data.subject?.trim() || 'SWAS TASKS – Official Email Configuration Verification Test';
    const bodyText =
      parsed.data.message?.trim() ||
      `This test message confirms official email delivery from SWAS TASKS (swastaskorg@gmail.com) triggered by ${admin.email} on ${new Date().toUTCString()}.`;

    const { delivery, emailLog } = await sendPlatformEmail({
      toEmail: recipient,
      recipientType: 'admin',
      subject,
      title: 'Email Configuration Test',
      greeting: 'Hello,',
      bodyText,
      scope: 'control_centre',
      department: resolveScopedDepartment(admin),
      kind: 'manual',
      eventType: 'admin_communication',
      triggeredByUid: admin.uid,
      triggeredByEmail: admin.email,
      idToken: admin.idToken,
      gmailAccessToken: extractGmailAccessToken(req),
      persistLog: true,
      skipDuplicateGuard: true,
    });

    await appendAuditLog(
      req,
      'system',
      'SEND_TEST_EMAIL',
      emailLog ? `email_logs/${emailLog.emailLogId}` : `email/${recipient}`,
      delivery.sent ? 'success' : 'failed',
      {
        recipientEmail: recipient,
        status: delivery.status,
        provider: delivery.provider,
        detail: delivery.detail,
      }
    );

    res.json({ delivery, emailLog });
  }
);

const recipientEntrySchema = z.object({
  email: z.string().email().max(254),
  name: z.string().max(140).optional(),
  uid: z.string().max(128).optional(),
  recipientType: z.enum(['user', 'worker', 'client', 'admin', 'custom']).optional(),
  vars: z.record(z.string(), z.string()).optional(),
});

const adminDispatchEmailSchema = z.object({
  recipientEmail: z.string().email().max(254).optional(),
  recipientName: z.string().max(140).optional(),
  recipientUid: z.string().max(128).optional(),
  recipientType: z.enum(['user', 'worker', 'client', 'admin', 'custom']).optional(),
  recipients: z.array(recipientEntrySchema).max(200).optional(),
  ccEmails: z.array(z.string().email().max(254)).max(20).optional(),
  bccEmails: z.array(z.string().email().max(254)).max(50).optional(),
  scope: z.enum(['public_website', 'control_centre']).default('control_centre'),
  department: z.string().max(64).optional(),
  eventType: z.string().min(2).max(64).default('admin_communication'),
  subject: z.string().min(1).max(240),
  title: z.string().max(160).optional(),
  greeting: z.string().max(120).optional(),
  bodyText: z.string().max(16000).optional(),
  bodyHtml: z.string().max(32000).optional(),
  ctaLabel: z.string().max(80).optional(),
  ctaUrl: z
    .string()
    .url()
    .max(500)
    .refine((val) => /^https?:\/\//i.test(val), 'CTA URL must start with http:// or https://')
    .optional(),
  attachments: z.array(emailAttachmentSchema).max(5).optional(),
  includeSignature: z.boolean().optional(),
  templateId: z.string().max(128).optional(),
  sourceRecord: z.string().max(200).optional(),
  personalizationVars: z.record(z.string(), z.string()).optional(),
});

v1Router.post(
  '/admin/email/dispatch',
  requireAdminAuth,
  requireEmailPermission('email.compose', 'email.send'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    rememberAdminSessionToken(admin);
    if (!hasEmailPermission(admin, 'email.send')) {
      res.status(403).json({ error: 'Insufficient permissions: requires email.send.' });
      return;
    }

    const parsed = adminDispatchEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid email dispatch payload.', details: parsed.error.flatten() });
      return;
    }

    const targets =
      parsed.data.recipients && parsed.data.recipients.length > 0
        ? parsed.data.recipients
        : parsed.data.recipientEmail
        ? [
            {
              email: parsed.data.recipientEmail,
              name: parsed.data.recipientName || '',
              uid: parsed.data.recipientUid,
              recipientType: parsed.data.recipientType || 'custom',
              vars: parsed.data.personalizationVars || {},
            },
          ]
        : [];

    if (targets.length === 0) {
      res.status(400).json({ error: 'At least one recipient email is required.' });
      return;
    }
    if (targets.length > 1 && !hasEmailPermission(admin, 'email.send_bulk')) {
      res.status(403).json({ error: 'Sending to multiple recipients requires email.send_bulk permission.' });
      return;
    }

    const dept = resolveScopedDepartment(admin, parsed.data.department);
    const rawHtml = parsed.data.bodyHtml ? sanitizeEmailHtml(parsed.data.bodyHtml) : '';
    const rawText = parsed.data.bodyText?.trim() || extractPlainText(rawHtml);

    if (!rawHtml && !rawText) {
      res.status(400).json({ error: 'Email body content cannot be empty.' });
      return;
    }

    const gmailAccessToken = extractGmailAccessToken(req);
    const results: Array<{
      email: string;
      status: string;
      detail: string;
      error?: string;
      emailLogId?: string;
      delivery: { sent: boolean; status: string; provider: string; detail: string; error?: string };
      emailLog: { emailLogId?: string } | null;
    }> = [];

    for (const target of targets) {
      const vars = {
        client_name: target.name || target.email,
        first_name: (target.name || target.email).split(' ')[0] || target.email,
        last_name: (target.name || '').split(' ').slice(1).join(' '),
        email: target.email,
        department: dept,
        support_email: 'swastaskorg@gmail.com',
        current_date: new Date().toLocaleDateString('en-US', { dateStyle: 'medium' }),
        ...(parsed.data.personalizationVars || {}),
        ...(target.vars || {}),
      };
      const subj = renderPersonalizedVars(parsed.data.subject.trim(), vars, false);
      const pHtml = rawHtml ? renderPersonalizedVars(rawHtml, vars, true) : undefined;
      const pText = renderPersonalizedVars(rawText, vars, false);

      const out = await sendPlatformEmail({
        toEmail: target.email.trim().toLowerCase(),
        recipientName: target.name || undefined,
        recipientUid: target.uid,
        recipientType: target.recipientType || 'custom',
        ccEmails: parsed.data.ccEmails,
        bccEmails: parsed.data.bccEmails,
        subject: subj,
        title: parsed.data.title?.trim() || subj,
        greeting: parsed.data.greeting?.trim(),
        bodyText: pText,
        bodyHtml: pHtml,
        ctaLabel: parsed.data.ctaLabel?.trim(),
        ctaUrl: parsed.data.ctaUrl?.trim(),
        attachments: parsed.data.attachments as EmailAttachmentInput[] | undefined,
        includeSignature: parsed.data.includeSignature,
        scope: parsed.data.scope,
        department: dept,
        kind: targets.length > 1 ? 'bulk' : 'manual',
        eventType: parsed.data.eventType,
        sourceRecord: parsed.data.sourceRecord,
        triggeredByUid: admin.uid,
        triggeredByEmail: admin.email,
        idToken: admin.idToken,
        gmailAccessToken,
        persistLog: true,
      });

      results.push({
        email: target.email.trim().toLowerCase(),
        status: out.delivery.status,
        detail: out.delivery.detail,
        error: out.delivery.error,
        emailLogId: out.emailLog?.emailLogId,
        delivery: out.delivery,
        emailLog: out.emailLog,
      });
    }

    if (parsed.data.templateId && validateSafeId(parsed.data.templateId)) {
      const tpl = await firestoreGetDoc('email_templates', parsed.data.templateId, admin.idToken).catch(() => null);
      if (tpl) {
        await firestorePatchFields(
          'email_templates',
          parsed.data.templateId,
          { usageCount: Number(tpl.usageCount || 0) + 1, updatedAt: new Date().toISOString() },
          admin.idToken
        ).catch(() => undefined);
      }
    }

    const first = results[0];
    const sentCount = results.filter((r) => r.delivery.sent).length;
    const failedResults = results.filter((r) => !r.delivery.sent);
    const failedCount = failedResults.length;

    const aggregatedDelivery =
      results.length === 1
        ? first.delivery
        : failedCount === 0
        ? {
            ...first.delivery,
            sent: true,
            detail: `Dispatched ${sentCount}/${results.length} email(s) successfully via ${first.delivery.provider}.`,
          }
        : {
            ...first.delivery,
            sent: false,
            status: failedResults[0].delivery.status,
            detail: `${sentCount} sent, ${failedCount} failed. ${failedResults
              .slice(0, 3)
              .map((f) => `${f.email}: ${f.error || f.detail}`)
              .join(' | ')}`,
            error: `${sentCount} sent, ${failedCount} failed. ${failedResults
              .slice(0, 3)
              .map((f) => `${f.email}: ${f.error || f.detail}`)
              .join(' | ')}`,
          };

    await appendAuditLog(
      req,
      'admin',
      'DISPATCH_PLATFORM_EMAIL',
      first.emailLog?.emailLogId ? `email_logs/${first.emailLog.emailLogId}` : `email/${targets[0].email}`,
      failedCount === 0 ? 'success' : 'failed',
      {
        recipientCount: targets.length,
        sentCount,
        failedCount,
        department: dept,
        eventType: parsed.data.eventType,
        status: aggregatedDelivery.status,
      }
    );

    res.json({
      delivery: aggregatedDelivery,
      emailLog: first.emailLog,
      sentCount,
      failedCount,
      results,
    });
  }
);

const bulkCampaignSchema = z.object({
  name: z.string().min(2).max(160),
  department: z.string().max(64).optional(),
  audienceFilter: z.string().max(120).default('Selected Recipients'),
  recipients: z.array(recipientEntrySchema).min(1).max(1000),
  subject: z.string().min(2).max(240),
  bodyHtml: z.string().min(1).max(32000),
  bodyText: z.string().max(16000).optional(),
  ctaLabel: z.string().max(80).optional(),
  ctaUrl: z.string().url().max(500).optional(),
  attachments: z.array(emailAttachmentSchema).max(5).optional(),
  includeSignature: z.boolean().optional(),
  templateId: z.string().max(128).optional(),
  scheduledFor: z.string().max(64).optional(),
});

v1Router.get(
  '/admin/email/campaigns',
  requireAdminAuth,
  requireEmailPermission('email.view'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    try {
      const canSeeAll = admin.role === 'SUPER_ADMIN' || admin.departments.includes('platform_settings');
      const scopeDept = resolveScopedDepartment(admin);
      const campaigns = canSeeAll
        ? await firestoreListCollection('email_campaigns', admin.idToken, 200)
        : await firestoreQueryByField('email_campaigns', 'department', 'EQUAL', scopeDept, admin.idToken, 200);
      campaigns.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      res.json({ campaigns });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list campaigns' });
    }
  }
);

v1Router.post(
  '/admin/email/send-bulk',
  requireAdminAuth,
  requireEmailPermission('email.send_bulk'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    rememberAdminSessionToken(admin);
    const parsed = bulkCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bulk campaign payload.', details: parsed.error.flatten() });
      return;
    }

    const campaignId = `cmp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const dept = resolveScopedDepartment(admin, parsed.data.department);

    try {
      const result = await runBulkCampaign({
        campaignId,
        name: parsed.data.name.trim(),
        department: dept,
        audienceFilter: parsed.data.audienceFilter,
        recipients: parsed.data.recipients.map((r) => ({
          email: r.email.trim().toLowerCase(),
          name: r.name || r.email,
          uid: r.uid,
          recipientType: r.recipientType || 'custom',
          vars: r.vars,
        })),
        subject: parsed.data.subject.trim(),
        bodyHtml: parsed.data.bodyHtml,
        bodyText: parsed.data.bodyText,
        ctaLabel: parsed.data.ctaLabel,
        ctaUrl: parsed.data.ctaUrl,
        attachments: parsed.data.attachments as EmailAttachmentInput[] | undefined,
        includeSignature: parsed.data.includeSignature,
        templateId: parsed.data.templateId,
        scheduledFor: parsed.data.scheduledFor,
        gmailAccessToken: extractGmailAccessToken(req),
        admin: { uid: admin.uid, email: admin.email, idToken: admin.idToken },
      });

      await appendAuditLog(req, 'admin', 'SEND_BULK_EMAIL_CAMPAIGN', `email_campaigns/${campaignId}`, 'success', {
        recipientCount: parsed.data.recipients.length,
        sentCount: result.sentCount,
        failedCount: result.failedCount,
      });

      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Bulk campaign execution failed' });
    }
  }
);

v1Router.post(
  '/admin/email/campaigns/:id/retry',
  requireAdminAuth,
  requireEmailPermission('email.retry_failed'),
  async (req: AuthenticatedRequest, res: Response) => {
    const campaignId = String(req.params.id || '');
    if (!validateSafeId(campaignId)) {
      res.status(400).json({ error: 'Invalid campaign ID.' });
      return;
    }
    try {
      const outcome = await retryCampaignFailedEmails({
        campaignId,
        gmailAccessToken: extractGmailAccessToken(req),
        admin: { uid: req.admin!.uid, email: req.admin!.email, idToken: req.admin!.idToken },
      });
      await appendAuditLog(req, 'system', 'RETRY_BULK_CAMPAIGN', `email_campaigns/${campaignId}`, 'success', outcome);
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Campaign retry failed' });
    }
  }
);

v1Router.post(
  '/admin/email/campaigns/:id/cancel',
  requireAdminAuth,
  requireEmailPermission('email.schedule'),
  async (req: AuthenticatedRequest, res: Response) => {
    const campaignId = String(req.params.id || '');
    if (!validateSafeId(campaignId)) {
      res.status(400).json({ error: 'Invalid campaign ID.' });
      return;
    }
    try {
      const now = new Date().toISOString();
      const updated = await firestorePatchFields(
        'email_campaigns',
        campaignId,
        { status: 'cancelled', updatedAt: now },
        req.admin!.idToken
      );
      const campaignLogs = await firestoreQueryByField(
        'email_logs',
        'campaignId',
        'EQUAL',
        campaignId,
        req.admin!.idToken,
        500
      );
      for (const log of campaignLogs) {
        if (log.status === 'scheduled') {
          await firestorePatchFields(
            'email_logs',
            String(log.emailLogId || log.id),
            { status: 'cancelled', updatedAt: now },
            req.admin!.idToken
          );
        }
      }
      await appendAuditLog(req, 'admin', 'CANCEL_EMAIL_CAMPAIGN', `email_campaigns/${campaignId}`, 'success');
      res.json({ campaign: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Campaign cancellation failed' });
    }
  }
);

const scheduleEmailSchema = z.object({
  recipients: z.array(recipientEntrySchema).min(1).max(200),
  ccEmails: z.array(z.string().email().max(254)).max(20).optional(),
  bccEmails: z.array(z.string().email().max(254)).max(50).optional(),
  subject: z.string().min(1).max(240),
  bodyHtml: z.string().max(32000).optional(),
  bodyText: z.string().max(16000).optional(),
  ctaLabel: z.string().max(80).optional(),
  ctaUrl: z.string().url().max(500).optional(),
  attachments: z.array(emailAttachmentSchema).max(5).optional(),
  scheduledFor: z.string().min(10).max(64),
  department: z.string().max(64).optional(),
  eventType: z.string().max(64).default('scheduled_email'),
  sourceRecord: z.string().max(200).optional(),
});

v1Router.post(
  '/admin/email/schedule',
  requireAdminAuth,
  requireEmailPermission('email.schedule'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    rememberAdminSessionToken(admin);
    const parsed = scheduleEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid schedule payload.', details: parsed.error.flatten() });
      return;
    }

    const scheduledMs = new Date(parsed.data.scheduledFor).getTime();
    if (!Number.isFinite(scheduledMs)) {
      res.status(400).json({ error: 'Invalid scheduledFor date-time.' });
      return;
    }

    const dept = resolveScopedDepartment(admin, parsed.data.department);
    const batchId = parsed.data.recipients.length > 1 ? `batch_${Date.now()}` : undefined;
    const rawHtml = parsed.data.bodyHtml ? sanitizeEmailHtml(parsed.data.bodyHtml) : '';
    const rawText = parsed.data.bodyText?.trim() || extractPlainText(rawHtml);

    try {
      const scheduledLogs = [];
      for (const r of parsed.data.recipients) {
        const vars = {
          client_name: r.name || r.email,
          first_name: (r.name || r.email).split(' ')[0] || r.email,
          last_name: (r.name || '').split(' ').slice(1).join(' '),
          email: r.email,
          department: dept,
          support_email: 'swastaskorg@gmail.com',
          current_date: new Date().toLocaleDateString('en-US', { dateStyle: 'medium' }),
          ...(r.vars || {}),
        };
        const log = await schedulePlatformEmail({
          toEmail: r.email,
          recipientName: r.name,
          recipientUid: r.uid,
          recipientType: r.recipientType || 'custom',
          ccEmails: parsed.data.ccEmails,
          bccEmails: parsed.data.bccEmails,
          subject: renderPersonalizedVars(parsed.data.subject, vars, false),
          bodyText: renderPersonalizedVars(rawText, vars, false),
          bodyHtml: rawHtml ? renderPersonalizedVars(rawHtml, vars, true) : undefined,
          ctaLabel: parsed.data.ctaLabel,
          ctaUrl: parsed.data.ctaUrl,
          attachments: parsed.data.attachments as EmailAttachmentInput[] | undefined,
          scheduledFor: new Date(scheduledMs).toISOString(),
          department: dept,
          eventType: parsed.data.eventType,
          batchId,
          sourceRecord: parsed.data.sourceRecord,
          triggeredByUid: admin.uid,
          triggeredByEmail: admin.email,
          idToken: admin.idToken,
        });
        scheduledLogs.push(log);
      }

      await appendAuditLog(req, 'admin', 'SCHEDULE_PLATFORM_EMAIL', `email_logs/${scheduledLogs[0]?.emailLogId}`, 'success', {
        recipientCount: scheduledLogs.length,
        scheduledFor: parsed.data.scheduledFor,
        department: dept,
      });

      res.status(201).json({
        scheduled: scheduledLogs,
        scheduledCount: scheduledLogs.length,
        logs: scheduledLogs,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to schedule email' });
    }
  }
);

v1Router.post(
  '/admin/email/scheduled/:id/cancel',
  requireAdminAuth,
  requireEmailPermission('email.schedule'),
  async (req: AuthenticatedRequest, res: Response) => {
    const emailLogId = String(req.params.id || '');
    if (!validateSafeId(emailLogId)) {
      res.status(400).json({ error: 'Invalid scheduled email ID.' });
      return;
    }
    try {
      const existing = await firestoreGetDoc('email_logs', emailLogId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Scheduled email not found.' });
        return;
      }
      if (existing.status !== 'scheduled') {
        res.status(409).json({ error: `Cannot cancel email with status '${String(existing.status)}'.` });
        return;
      }
      const updated = await firestorePatchFields(
        'email_logs',
        emailLogId,
        {
          status: 'cancelled',
          deliveryStatusDetail: `Cancelled by ${req.admin!.email}`,
          updatedAt: new Date().toISOString(),
        },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'admin', 'CANCEL_SCHEDULED_EMAIL', `email_logs/${emailLogId}`, 'success');
      res.json({ emailLog: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to cancel scheduled email' });
    }
  }
);

v1Router.post(
  '/admin/email/process-scheduled',
  requireAdminAuth,
  requireEmailPermission('email.view', 'email.schedule'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    rememberAdminSessionToken(admin);
    const canSeeAll = admin.role === 'SUPER_ADMIN' || admin.departments.includes('platform_settings');
    const deptScope = canSeeAll ? 'all' : resolveScopedDepartment(admin);
    try {
      const result = await processDueScheduledEmails(admin.idToken, deptScope);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Scheduler run failed' });
    }
  }
);

const emailTemplateSchema = z.object({
  templateId: z.string().regex(SAFE_ID_REGEX).optional(),
  name: z.string().min(2).max(140),
  category: z.enum(TEMPLATE_CATEGORIES),
  department: z.string().max(64).default('all'),
  subject: z.string().min(2).max(240),
  bodyHtml: z.string().min(1).max(32000),
  bodyText: z.string().max(16000).optional(),
  variables: z.array(z.string().max(64)).max(30).optional(),
  active: z.boolean().default(true),
});

v1Router.get(
  '/admin/email/templates',
  requireAdminAuth,
  requireEmailPermission('email.view', 'email.compose', 'email.manage_templates'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    try {
      const canSeeAll = admin.role === 'SUPER_ADMIN' || admin.departments.includes('platform_settings');
      const scopeDept = resolveScopedDepartment(admin);
      const templates = canSeeAll
        ? await firestoreListCollection('email_templates', admin.idToken, 200)
        : await firestoreQueryByField('email_templates', 'department', 'IN', ['all', scopeDept], admin.idToken, 200);
      templates.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      res.json({ templates });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list templates' });
    }
  }
);

v1Router.post(
  '/admin/email/templates',
  requireAdminAuth,
  requireEmailPermission('email.manage_templates'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    const parsed = emailTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid email template payload.', details: parsed.error.flatten() });
      return;
    }

    const templateId = parsed.data.templateId || `tpl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const dept =
      admin.role === 'SUPER_ADMIN' || admin.departments.includes('platform_settings')
        ? parsed.data.department || 'all'
        : resolveScopedDepartment(admin, parsed.data.department);
    const now = new Date().toISOString();
    const sanitizedHtml = sanitizeEmailHtml(parsed.data.bodyHtml);
    const plainText = parsed.data.bodyText?.trim() || extractPlainText(sanitizedHtml);

    try {
      const existing = await firestoreGetDoc('email_templates', templateId, admin.idToken).catch(() => null);
      const docPayload = {
        templateId,
        name: parsed.data.name.trim(),
        category: parsed.data.category,
        department: dept,
        subject: parsed.data.subject.trim(),
        bodyHtml: sanitizedHtml,
        bodyText: plainText,
        variables: parsed.data.variables || [],
        usageCount: existing ? Number(existing.usageCount || 0) : 0,
        active: parsed.data.active,
        createdByUid: existing ? String(existing.createdByUid || admin.uid) : admin.uid,
        createdByEmail: existing ? String(existing.createdByEmail || admin.email) : admin.email,
        createdAt: existing ? String(existing.createdAt || now) : now,
        updatedAt: now,
      };
      const saved = await firestoreSetDoc('email_templates', templateId, docPayload, admin.idToken);
      await appendAuditLog(req, 'admin', existing ? 'UPDATE_EMAIL_TEMPLATE' : 'CREATE_EMAIL_TEMPLATE', `email_templates/${templateId}`, 'success');
      res.status(existing ? 200 : 201).json({ template: saved });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save template' });
    }
  }
);

v1Router.delete(
  '/admin/email/templates/:id',
  requireAdminAuth,
  requireEmailPermission('email.manage_templates'),
  async (req: AuthenticatedRequest, res: Response) => {
    const templateId = String(req.params.id || '');
    if (!validateSafeId(templateId)) {
      res.status(400).json({ error: 'Invalid template ID.' });
      return;
    }
    try {
      await firestoreDeleteDoc('email_templates', templateId, req.admin!.idToken);
      await appendAuditLog(req, 'admin', 'DELETE_EMAIL_TEMPLATE', `email_templates/${templateId}`, 'success');
      res.json({ deleted: true, templateId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete template' });
    }
  }
);

const emailDraftSchema = z.object({
  draftId: z.string().regex(SAFE_ID_REGEX).optional(),
  department: z.string().max(64).optional(),
  toEmails: z.array(z.string().max(254)).max(200).optional(),
  ccEmails: z.array(z.string().max(254)).max(20).optional(),
  bccEmails: z.array(z.string().max(254)).max(50).optional(),
  subject: z.string().max(240).optional(),
  bodyHtml: z.string().max(32000).optional(),
  bodyText: z.string().max(16000).optional(),
  attachments: z.array(emailAttachmentSchema).max(5).optional(),
  scheduledFor: z.string().max(64).optional(),
  templateId: z.string().max(128).optional(),
  includeSignature: z.boolean().optional(),
});

v1Router.get(
  '/admin/email/drafts',
  requireAdminAuth,
  requireEmailPermission('email.view', 'email.compose'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    try {
      const drafts =
        admin.role === 'SUPER_ADMIN'
          ? await firestoreListCollection('email_drafts', admin.idToken, 200)
          : await firestoreQueryByField('email_drafts', 'createdByUid', 'EQUAL', admin.uid, admin.idToken, 100);
      drafts.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      res.json({ drafts });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list drafts' });
    }
  }
);

v1Router.post(
  '/admin/email/drafts',
  requireAdminAuth,
  requireEmailPermission('email.compose'),
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    const parsed = emailDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid draft payload.', details: parsed.error.flatten() });
      return;
    }
    const draftId = parsed.data.draftId || `drf_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const dept = resolveScopedDepartment(admin, parsed.data.department);
    const now = new Date().toISOString();
    const sanitizedHtml = parsed.data.bodyHtml ? sanitizeEmailHtml(parsed.data.bodyHtml) : '';

    try {
      const existing = await firestoreGetDoc('email_drafts', draftId, admin.idToken).catch(() => null);
      const saved = await firestoreSetDoc(
        'email_drafts',
        draftId,
        {
          draftId,
          department: dept,
          toEmails: parsed.data.toEmails || [],
          ccEmails: parsed.data.ccEmails || [],
          bccEmails: parsed.data.bccEmails || [],
          subject: (parsed.data.subject || '').trim(),
          bodyHtml: sanitizedHtml,
          bodyText: parsed.data.bodyText?.trim() || extractPlainText(sanitizedHtml),
          attachments: parsed.data.attachments || [],
          ...(parsed.data.scheduledFor ? { scheduledFor: parsed.data.scheduledFor } : {}),
          ...(parsed.data.templateId ? { templateId: parsed.data.templateId } : {}),
          includeSignature: parsed.data.includeSignature ?? true,
          createdByUid: existing ? String(existing.createdByUid || admin.uid) : admin.uid,
          createdByEmail: existing ? String(existing.createdByEmail || admin.email) : admin.email,
          createdAt: existing ? String(existing.createdAt || now) : now,
          updatedAt: now,
        },
        admin.idToken
      );
      res.status(existing ? 200 : 201).json({ draft: saved });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save draft' });
    }
  }
);

v1Router.delete(
  '/admin/email/drafts/:id',
  requireAdminAuth,
  requireEmailPermission('email.compose'),
  async (req: AuthenticatedRequest, res: Response) => {
    const draftId = String(req.params.id || '');
    if (!validateSafeId(draftId)) {
      res.status(400).json({ error: 'Invalid draft ID.' });
      return;
    }
    try {
      await firestoreDeleteDoc('email_drafts', draftId, req.admin!.idToken);
      res.json({ deleted: true, draftId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete draft' });
    }
  }
);

v1Router.post(
  '/admin/email/logs/:id/retry',
  requireAdminAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    if (
      admin.role !== 'SUPER_ADMIN' &&
      !hasEmailPermission(admin, 'email.retry_failed') &&
      !admin.departments.includes('platform_settings')
    ) {
      res.status(403).json({ error: 'Insufficient permissions: requires email.retry_failed.' });
      return;
    }

    const emailLogId = String(req.params.id || '');
    if (!validateSafeId(emailLogId)) {
      res.status(400).json({ error: 'Invalid email log ID.' });
      return;
    }

    try {
      const existing = await firestoreGetDoc('email_logs', emailLogId, admin.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Email log record not found.' });
        return;
      }

      const currentStatus = String(existing.status || '');
      if (currentStatus === 'sent' || currentStatus === 'delivered' || currentStatus === 'accepted') {
        res.status(409).json({
          error: `Email log '${emailLogId}' already has status '${currentStatus}' and cannot be retried.`,
        });
        return;
      }

      const recipientEmail = String(existing.recipientEmail || '');
      const subject = String(existing.subject || 'SWAS TASKS Notification');
      const bodyText = String(existing.bodyPreview || 'Official communication from SWAS TASKS.');
      const bodyHtml = typeof existing.htmlBody === 'string' ? existing.htmlBody : undefined;
      const scope =
        existing.scope === 'public_website' ? 'public_website' : 'control_centre';
      const eventType = String(existing.eventType || 'admin_communication');

      const { delivery } = await sendPlatformEmail({
        toEmail: recipientEmail,
        recipientName: typeof existing.recipientName === 'string' ? existing.recipientName : undefined,
        ccEmails: Array.isArray(existing.ccEmails) ? (existing.ccEmails as string[]) : undefined,
        bccEmails: Array.isArray(existing.bccEmails) ? (existing.bccEmails as string[]) : undefined,
        subject,
        bodyText,
        bodyHtml,
        attachments: Array.isArray(existing.attachments)
          ? (existing.attachments as EmailAttachmentInput[])
          : undefined,
        scope,
        department: typeof existing.department === 'string' ? existing.department : 'platform_settings',
        kind: (existing.kind as 'automatic' | 'manual' | 'scheduled' | 'bulk') || 'manual',
        eventType,
        triggeredByUid: admin.uid,
        triggeredByEmail: admin.email,
        idToken: admin.idToken,
        gmailAccessToken: extractGmailAccessToken(req),
        persistLog: false,
        skipDuplicateGuard: true,
      });

      const now = new Date().toISOString();
      const updatedLog = await firestorePatchFields(
        'email_logs',
        emailLogId,
        {
          provider: delivery.provider.slice(0, 80),
          providerMessageId: (delivery.providerMessageId || '').slice(0, 160),
          status: delivery.status,
          deliveryStatusDetail: delivery.detail.slice(0, 800),
          errorDetail: delivery.sent ? '' : delivery.detail.slice(0, 800),
          retryCount: Number(existing.retryCount || 0) + 1,
          ...(delivery.sentAt ? { sentAt: delivery.sentAt } : {}),
          updatedAt: now,
        },
        admin.idToken
      );

      await appendAuditLog(
        req,
        'system',
        'RETRY_EMAIL_DELIVERY',
        `email_logs/${emailLogId}`,
        delivery.sent ? 'success' : 'failed',
        { status: delivery.status, recipientEmail }
      );

      res.json({ delivery, emailLog: updatedLog });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Email retry failed' });
    }
  }
);

// Signed Provider Webhook for Authentic Delivery Tracking (delivered / bounced / opened / clicked)
v1Router.post('/webhooks/email-events', async (req, res: Response) => {
  if (!serverConfig.emailWebhookSecret) {
    res.status(503).json({
      error: 'EMAIL_WEBHOOK_SECRET is not configured on the server; unsigned webhook payloads are rejected.',
    });
    return;
  }

  const signatureHeader =
    (typeof req.headers['x-webhook-signature'] === 'string' && req.headers['x-webhook-signature']) ||
    (typeof req.headers['svix-signature'] === 'string' && req.headers['svix-signature']) ||
    '';

  if (!signatureHeader) {
    res.status(401).json({ error: 'Missing webhook signature header.' });
    return;
  }

  const rawBody = JSON.stringify(req.body || {});
  const expectedSig = crypto
    .createHmac('sha256', serverConfig.emailWebhookSecret)
    .update(rawBody)
    .digest('hex');

  const sigClean = signatureHeader.replace(/^sha256=/i, '').trim();
  const sigBuf = Buffer.from(sigClean);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    res.status(403).json({ error: 'Invalid webhook signature.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const eventType = String(body.type || body.event || '').toLowerCase();
  const dataObj =
    body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : body;
  const providerMessageId = String(
    dataObj.email_id || dataObj.messageId || dataObj.id || ''
  ).trim();

  if (!providerMessageId) {
    res.status(400).json({ error: 'Webhook payload missing provider message ID.' });
    return;
  }

  const now = new Date().toISOString();
  const eventUpdate: {
    providerMessageId: string;
    status?: 'delivered' | 'bounced' | 'deferred' | 'failed';
    detail?: string;
    bounceReason?: string;
    deliveredAt?: string;
    openedAt?: string;
    clickedAt?: string;
    receivedAt: string;
  } = {
    providerMessageId,
    receivedAt: now,
  };

  if (eventType.includes('deliver')) {
    eventUpdate.status = 'delivered';
    eventUpdate.deliveredAt = now;
    eventUpdate.detail = 'Confirmed delivered by provider webhook.';
  } else if (eventType.includes('bounce') || eventType.includes('complain')) {
    eventUpdate.status = 'bounced';
    eventUpdate.bounceReason = String(dataObj.reason || dataObj.bounce_type || eventType).slice(0, 500);
    eventUpdate.detail = `Bounce/complaint reported (${eventUpdate.bounceReason}).`;
  } else if (eventType.includes('defer')) {
    eventUpdate.status = 'deferred';
    eventUpdate.detail = 'Temporarily deferred by recipient mail server.';
  } else if (eventType.includes('open')) {
    eventUpdate.openedAt = now;
  } else if (eventType.includes('click')) {
    eventUpdate.clickedAt = now;
  }

  recordWebhookDeliveryEvent(eventUpdate);
  res.json({ received: true, providerMessageId, eventType });
});

const VALID_PUBLIC_EMAIL_EVENTS = new Set(PUBLIC_EMAIL_NOTIFICATION_TYPES.map((e) => e.id));
const VALID_CC_EMAIL_EVENTS = new Set(CONTROL_CENTRE_EMAIL_NOTIFICATION_TYPES.map((e) => e.id));

const publicEmailDispatchSchema = z.object({
  eventType: z.string().min(2).max(64),
  toEmail: z.string().email().max(254),
  subject: z.string().min(2).max(200).optional(),
  title: z.string().max(160).optional(),
  greeting: z.string().max(120).optional(),
  bodyText: z.string().min(2).max(4000).optional(),
  ctaLabel: z.string().max(80).optional(),
  ctaUrl: z
    .string()
    .url()
    .max(500)
    .refine((val) => /^https?:\/\//i.test(val), 'CTA URL must start with http:// or https://')
    .optional(),
});

v1Router.post('/public/email/dispatch', authAttemptRateLimiter, async (req, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authorization Bearer token required to dispatch official SWAS TASKS emails.',
    });
    return;
  }

  const parsed = publicEmailDispatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid public email payload.', details: parsed.error.flatten() });
    return;
  }

  const eventDef =
    PUBLIC_EMAIL_NOTIFICATION_TYPES.find((e) => e.id === parsed.data.eventType) ||
    (VALID_CC_EMAIL_EVENTS.has(parsed.data.eventType)
      ? CONTROL_CENTRE_EMAIL_NOTIFICATION_TYPES.find((e) => e.id === parsed.data.eventType)
      : undefined);

  if (!eventDef || (!VALID_PUBLIC_EMAIL_EVENTS.has(eventDef.id) && !VALID_CC_EMAIL_EVENTS.has(eventDef.id))) {
    res.status(400).json({ error: 'Unsupported notification eventType.' });
    return;
  }

  try {
    const idToken = authHeader.slice('Bearer '.length).trim();
    const decoded = await verifyFirebaseIdToken(idToken);
    const requestedRecipient = parsed.data.toEmail.trim().toLowerCase();
    const tokenEmail = (decoded.email || '').trim().toLowerCase();

    let isActiveAdmin = false;
    if (!tokenEmail || tokenEmail !== requestedRecipient) {
      const adminDoc = await firestoreGetDoc('admin_users', decoded.uid, idToken).catch(() => null);
      isActiveAdmin = Boolean(adminDoc && adminDoc.status === 'active');
      if (!isActiveAdmin) {
        res.status(403).json({
          error:
            'Forbidden: Authenticated public users may only trigger notifications to their own verified email address.',
        });
        return;
      }
    }

    const emailConfigDoc = await firestoreGetDoc('platform_settings', 'email_configuration').catch(
      () => null
    );
    const cfg =
      emailConfigDoc?.config && typeof emailConfigDoc.config === 'object'
        ? (emailConfigDoc.config as Record<string, unknown>)
        : {};
    const rules =
      cfg.notificationRules && typeof cfg.notificationRules === 'object'
        ? (cfg.notificationRules as Record<string, boolean>)
        : {};

    if (rules[eventDef.id] === false) {
      res.json({
        delivery: {
          sent: false,
          status: 'failed',
          provider: 'Policy Disabled',
          fromAddress: `${serverConfig.emailSenderName} <${serverConfig.officialPlatformEmail}>`,
          replyToAddress: serverConfig.officialPlatformEmail,
          detail: `Notification event '${eventDef.id}' is currently disabled in Central Platform Settings.`,
        },
      });
      return;
    }

    const { delivery } = await sendPlatformEmail({
      toEmail: requestedRecipient,
      subject: parsed.data.subject?.trim() || eventDef.defaultSubject,
      title: parsed.data.title?.trim() || eventDef.label,
      greeting: parsed.data.greeting?.trim(),
      bodyText: parsed.data.bodyText?.trim() || eventDef.defaultBody,
      ctaLabel: parsed.data.ctaLabel?.trim(),
      ctaUrl: parsed.data.ctaUrl?.trim(),
      scope: eventDef.scope,
      department: 'platform_settings',
      kind: 'automatic',
      eventType: eventDef.id,
      triggeredByUid: decoded.uid,
      idToken: isActiveAdmin ? idToken : undefined,
      persistLog: isActiveAdmin,
    });

    res.json({ delivery });
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Unauthorized email dispatch request',
    });
  }
});

