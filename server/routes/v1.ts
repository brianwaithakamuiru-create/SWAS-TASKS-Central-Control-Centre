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
  firestoreGetDoc,
  firestoreListCollection,
  firestorePatchFields,
  firestoreSetDoc,
} from '../firestoreRest.ts';
import {
  hashApiKey,
  hashInvitationToken,
  isEmailLocked,
  recordFailedAttempt,
  requireAdminAuth,
  requirePermission,
  requireStaffManager,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { authAttemptRateLimiter } from '../middleware/security.ts';
import { openApiSpec } from '../openapi.ts';
import {
  checkEmailDomainAuthentication,
  resolveEffectiveSenderIdentity,
  sendInvitationEmail,
  sendPhoneOtpSms,
  sendPlatformEmail,
} from '../services/messaging.ts';
import {
  CONTROL_CENTRE_EMAIL_NOTIFICATION_TYPES,
  PUBLIC_EMAIL_NOTIFICATION_TYPES,
} from '../../src/config/platformIdentity.ts';

export const v1Router = express.Router();

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
] as const;

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

// Tracks invalidated/used/revoked invitation IDs in-process alongside authoritative Firestore state
const invalidatedInvitationIds = new Set<string>();
const pendingSmsOtps = new Map<
  string,
  { otpHash: string; phone: string; expiresAtMs: number; verified: boolean }
>();

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
    if (!decoded.invitationId || !decoded.email || !decoded.department || !decoded.exp) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
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
v1Router.get('/invitations/validate', (req, res: Response) => {
  const rawToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!rawToken) {
    res.status(400).json({ valid: false, error: 'Missing invitation token.' });
    return;
  }

  const payload = verifySignedInvitationToken(rawToken);
  if (!payload) {
    res.status(400).json({ valid: false, error: 'Invalid or tampered invitation link.' });
    return;
  }

  if (invalidatedInvitationIds.has(payload.invitationId)) {
    res.status(410).json({
      valid: false,
      error: 'This invitation has already been used, replaced, or revoked.',
    });
    return;
  }

  if (Date.now() > payload.exp) {
    res.status(410).json({
      valid: false,
      error: 'This invitation link has expired. Contact the Super Administrator for a new invitation.',
    });
    return;
  }

  res.json({
    valid: true,
    invitationId: payload.invitationId,
    fullName: payload.fullName,
    email: payload.email,
    phone: payload.phone,
    department: payload.department,
    departmentLabel: DEPARTMENT_LABELS[payload.department] || payload.department,
    departmentRole: payload.departmentRole,
    permissions: payload.permissions,
    expiresAt: new Date(payload.exp).toISOString(),
    messaging: getMessagingStatus(),
  });
});

v1Router.post('/invitations/send-sms-otp', authAttemptRateLimiter, async (req, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const payload = verifySignedInvitationToken(token);
  if (!payload || invalidatedInvitationIds.has(payload.invitationId) || Date.now() > payload.exp) {
    res.status(400).json({ error: 'Valid active invitation token is required.' });
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

  const targetPhone = phone || payload.phone;
  const otpCode = String(crypto.randomInt(100000, 999999));
  const delivery = await sendPhoneOtpSms({ phone: targetPhone, code: otpCode });
  if (!delivery.sent) {
    res.status(502).json({ configured: true, status: 'failed', error: delivery.detail });
    return;
  }

  const otpHash = crypto
    .createHmac('sha256', serverConfig.invitationSigningSecret)
    .update(`${payload.invitationId}:${otpCode}`)
    .digest('hex');

  pendingSmsOtps.set(payload.invitationId, {
    otpHash,
    phone: targetPhone,
    expiresAtMs: Date.now() + 10 * 60 * 1000,
    verified: false,
  });

  res.json({ configured: true, status: 'sent', detail: delivery.detail });
});

v1Router.post('/invitations/verify-sms-otp', authAttemptRateLimiter, (req, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const payload = verifySignedInvitationToken(token);
  if (!payload) {
    res.status(400).json({ error: 'Invalid invitation token.' });
    return;
  }

  const entry = pendingSmsOtps.get(payload.invitationId);
  if (!entry || Date.now() > entry.expiresAtMs) {
    res.status(400).json({ error: 'OTP expired or not requested.' });
    return;
  }

  const candidateHash = crypto
    .createHmac('sha256', serverConfig.invitationSigningSecret)
    .update(`${payload.invitationId}:${code}`)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(entry.otpHash))) {
    res.status(400).json({ error: 'Incorrect SMS verification code.' });
    return;
  }

  entry.verified = true;
  pendingSmsOtps.set(payload.invitationId, entry);
  res.json({ verified: true });
});

const acceptInviteSchema = z.object({
  token: z.string().min(20),
  fullName: z.string().min(2).max(140),
  phone: z.string().min(6).max(32),
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

  const payload = verifySignedInvitationToken(parsed.data.token);
  if (!payload) {
    res.status(400).json({ error: 'Invalid or tampered invitation token.' });
    return;
  }

  if (invalidatedInvitationIds.has(payload.invitationId) || Date.now() > payload.exp) {
    res.status(410).json({ error: 'Invitation has expired or is no longer active.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    const authedEmail = (decoded.email || '').toLowerCase();
    if (!authedEmail || authedEmail !== payload.email.toLowerCase()) {
      res.status(403).json({
        error: 'Authenticated email does not match the invited staff email address.',
      });
      return;
    }

    if (decoded.email_verified !== true) {
      res.status(403).json({
        error: 'Email verification is required before activating your staff account.',
      });
      return;
    }

    const msgStatus = getMessagingStatus();
    let phoneVerified = false;
    if (msgStatus.smsConfigured) {
      const otpEntry = pendingSmsOtps.get(payload.invitationId);
      if (!otpEntry || !otpEntry.verified) {
        res.status(403).json({
          error: 'Phone SMS verification must be completed before account activation.',
        });
        return;
      }
      phoneVerified = true;
    }

    // Verify authoritative Firestore invitation state using the caller's verified ID token
    const inviteDoc = await firestoreGetDoc('staff_invitations', payload.invitationId, idToken);
    if (!inviteDoc) {
      res.status(404).json({ error: 'Invitation record not found.' });
      return;
    }
    if (inviteDoc.status !== 'pending') {
      invalidatedInvitationIds.add(payload.invitationId);
      res.status(410).json({
        error: `Invitation cannot be used because its status is '${String(inviteDoc.status)}'.`,
      });
      return;
    }

    const expectedHash = hashInvitationToken(parsed.data.token);
    if (inviteDoc.tokenHash !== expectedHash) {
      res.status(403).json({ error: 'Invitation token hash mismatch.' });
      return;
    }

    const expiresAtStr = String(inviteDoc.expiresAt || '');
    if (expiresAtStr && Date.now() > new Date(expiresAtStr).getTime()) {
      res.status(410).json({ error: 'Invitation has expired.' });
      return;
    }

    // Never trust department/role/permissions from browser — enforce strictly from Firestore invitation!
    const serverDepartment = String(inviteDoc.department);
    const serverRole = String(inviteDoc.departmentRole);
    const serverPermissions = Array.isArray(inviteDoc.permissions)
      ? (inviteDoc.permissions as string[])
      : ['view'];

    const now = new Date().toISOString();
    const staffAccount = await firestoreSetDoc(
      'admin_users',
      decoded.uid,
      {
        uid: decoded.uid,
        email: authedEmail,
        displayName: parsed.data.fullName.trim(),
        phone: parsed.data.phone.trim(),
        emailVerified: true,
        phoneVerified,
        primaryDepartment: serverDepartment,
        role: serverRole,
        status: 'active',
        departments: [serverDepartment],
        actions: serverPermissions,
        invitationId: payload.invitationId,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: String(inviteDoc.createdBy || 'super_admin_invite'),
      },
      idToken
    );

    await firestorePatchFields(
      'staff_invitations',
      payload.invitationId,
      {
        status: 'accepted',
        acceptedByUid: decoded.uid,
        acceptedAt: now,
        updatedAt: now,
      },
      idToken
    );

    invalidatedInvitationIds.add(payload.invitationId);
    pendingSmsOtps.delete(payload.invitationId);

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
          invitationId: payload.invitationId,
          department: serverDepartment,
          phoneVerified,
        },
        createdAt: now,
      },
      idToken
    );

    const deptLabel = DEPARTMENT_LABELS[serverDepartment] || serverDepartment;
    void sendPlatformEmail({
      toEmail: authedEmail,
      subject: `SWAS TASKS Control Centre – ${deptLabel} Workplace Activated`,
      title: 'Staff Account Activated',
      greeting: `Hello ${parsed.data.fullName.trim()},`,
      bodyText: `Your SWAS TASKS Central Control Centre staff account for ${deptLabel} (${serverRole}) is now verified and active.`,
      scope: 'control_centre',
      eventType: 'staff_registration',
      triggeredByUid: decoded.uid,
      idToken,
      persistLog: true,
    }).catch(() => undefined);

    res.status(201).json({
      activated: true,
      staff: staffAccount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invitation acceptance failed';
    res.status(500).json({ error: message });
  }
});

// --- Super Admin Staff Invitation & Management Endpoints ---
const createInvitationSchema = z.object({
  fullName: z.string().min(2).max(140),
  email: z.string().email().max(254),
  phone: z.string().min(6).max(32),
  department: z.enum(VALID_DEPARTMENTS),
  departmentRole: z.string().min(2).max(80),
  permissions: z.array(z.enum(VALID_PERMISSIONS)).min(1).max(9),
  expiryHours: z.number().int().min(1).max(720).default(48),
});

v1Router.post(
  '/admin/invitations',
  requireAdminAuth,
  requireStaffManager,
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createInvitationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid invitation parameters.', details: parsed.error.flatten() });
      return;
    }

    const invitationId = `inv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expMs = Date.now() + parsed.data.expiryHours * 60 * 60 * 1000;
    const expiresAt = new Date(expMs).toISOString();
    const now = new Date().toISOString();
    const normalizedEmail = parsed.data.email.trim().toLowerCase();

    const signedToken = signInvitationPayload({
      invitationId,
      fullName: parsed.data.fullName.trim(),
      email: normalizedEmail,
      phone: parsed.data.phone.trim(),
      department: parsed.data.department,
      departmentRole: parsed.data.departmentRole.trim(),
      permissions: parsed.data.permissions,
      exp: expMs,
      nonce: crypto.randomBytes(8).toString('hex'),
    });

    const tokenHash = hashInvitationToken(signedToken);
    const originHeader =
      typeof req.headers.origin === 'string' && req.headers.origin
        ? req.headers.origin
        : serverConfig.appUrl !== 'MY_APP_URL'
        ? serverConfig.appUrl
        : 'http://localhost:3000';
    const inviteUrl = `${originHeader.replace(/\/$/, '')}/?invite=${encodeURIComponent(signedToken)}`;

    const emailResult = await sendInvitationEmail({
      toEmail: normalizedEmail,
      fullName: parsed.data.fullName.trim(),
      departmentLabel: DEPARTMENT_LABELS[parsed.data.department] || parsed.data.department,
      departmentRole: parsed.data.departmentRole.trim(),
      inviteUrl,
      expiresAt,
      triggeredByUid: req.admin!.uid,
      idToken: req.admin!.idToken,
    });

    try {
      const record = await firestoreSetDoc(
        'staff_invitations',
        invitationId,
        {
          invitationId,
          tokenHash,
          fullName: parsed.data.fullName.trim(),
          email: normalizedEmail,
          phone: parsed.data.phone.trim(),
          department: parsed.data.department,
          departmentRole: parsed.data.departmentRole.trim(),
          permissions: parsed.data.permissions,
          status: 'pending',
          expiresAt,
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
          email: normalizedEmail,
          department: parsed.data.department,
          departmentRole: parsed.data.departmentRole,
          emailDeliveryStatus: emailResult.status,
        }
      );

      res.status(201).json({
        invitation: record,
        inviteUrl,
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
  '/admin/invitations/:id/resend',
  requireAdminAuth,
  requireStaffManager,
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
      if (existing.status === 'accepted') {
        res.status(400).json({ error: 'Accepted invitations cannot be resent.' });
        return;
      }

      const expMs = Date.now() + 48 * 60 * 60 * 1000;
      const expiresAt = new Date(expMs).toISOString();
      const now = new Date().toISOString();

      const newInvitationId = `inv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      invalidatedInvitationIds.add(invitationId);

      const signedToken = signInvitationPayload({
        invitationId: newInvitationId,
        fullName: String(existing.fullName),
        email: String(existing.email),
        phone: String(existing.phone),
        department: String(existing.department) as (typeof VALID_DEPARTMENTS)[number],
        departmentRole: String(existing.departmentRole),
        permissions: Array.isArray(existing.permissions) ? (existing.permissions as string[]) : ['view'],
        exp: expMs,
        nonce: crypto.randomBytes(8).toString('hex'),
      });

      const tokenHash = hashInvitationToken(signedToken);
      const originHeader =
        typeof req.headers.origin === 'string' && req.headers.origin
          ? req.headers.origin
          : 'http://localhost:3000';
      const inviteUrl = `${originHeader.replace(/\/$/, '')}/?invite=${encodeURIComponent(signedToken)}`;

      const emailResult = await sendInvitationEmail({
        toEmail: String(existing.email),
        fullName: String(existing.fullName),
        departmentLabel: DEPARTMENT_LABELS[String(existing.department)] || String(existing.department),
        departmentRole: String(existing.departmentRole),
        inviteUrl,
        expiresAt,
        triggeredByUid: req.admin!.uid,
        idToken: req.admin!.idToken,
      });

      await firestorePatchFields(
        'staff_invitations',
        invitationId,
        { status: 'revoked', updatedAt: now },
        req.admin!.idToken
      );

      const replacement = await firestoreSetDoc(
        'staff_invitations',
        newInvitationId,
        {
          invitationId: newInvitationId,
          tokenHash,
          fullName: String(existing.fullName),
          email: String(existing.email),
          phone: String(existing.phone),
          department: String(existing.department),
          departmentRole: String(existing.departmentRole),
          permissions: existing.permissions,
          status: 'pending',
          expiresAt,
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

      res.json({ invitation: replacement, inviteUrl, delivery: emailResult });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Resend failed' });
    }
  }
);

v1Router.post(
  '/admin/invitations/:id/revoke',
  requireAdminAuth,
  requireStaffManager,
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
      const updated = await firestorePatchFields(
        'staff_invitations',
        invitationId,
        { status: 'revoked', updatedAt: new Date().toISOString() },
        req.admin!.idToken
      );
      await appendAuditLog(
        req,
        'security',
        'REVOKE_STAFF_INVITATION',
        `staff_invitations/${invitationId}`,
        'success',
        { email: existing.email }
      );
      res.json({ invitation: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Revoke failed' });
    }
  }
);

// Super Admin Staff Governance (Permissions, Department Transfer, Suspend, Deactivate, Revoke Session)
const updateStaffSchema = z.object({
  primaryDepartment: z.enum(VALID_DEPARTMENTS).optional(),
  role: z.string().min(2).max(80).optional(),
  actions: z.array(z.enum(VALID_PERMISSIONS)).min(1).max(9).optional(),
  status: z.enum(['active', 'suspended', 'deactivated', 'revoked']).optional(),
  reason: z.string().max(400).optional(),
});

v1Router.post(
  '/admin/staff/:uid/update',
  requireAdminAuth,
  requireStaffManager,
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

      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (parsed.data.primaryDepartment) {
        updates.primaryDepartment = parsed.data.primaryDepartment;
        updates.departments = [parsed.data.primaryDepartment];
      }
      if (parsed.data.role) updates.role = parsed.data.role;
      if (parsed.data.actions) updates.actions = parsed.data.actions;
      if (parsed.data.status) {
        updates.status = parsed.data.status;
        if (parsed.data.status !== 'active') {
          updates.sessionRevokedAt = new Date().toISOString();
        }
      }

      const updated = await firestorePatchFields('admin_users', staffUid, updates, req.admin!.idToken);

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
  requireStaffManager,
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
      const updated = await firestorePatchFields(
        'users',
        userId,
        { status: 'suspended', updatedAt: new Date().toISOString() },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'admin', 'SUSPEND_USER', `users/${userId}`, 'success', {
        previousStatus: existing.status,
      });
      res.json({ user: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Suspend failed' });
    }
  }
);

v1Router.post(
  '/admin/users/:id/activate',
  requireAdminAuth,
  requirePermission('user_management', 'edit'),
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
      const updated = await firestorePatchFields(
        'users',
        userId,
        { status: 'active', updatedAt: new Date().toISOString() },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'admin', 'ACTIVATE_USER', `users/${userId}`, 'success', {
        previousStatus: existing.status,
      });
      res.json({ user: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Activate failed' });
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
  requirePermission('bids_assignments', 'edit'),
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
      const updated = await firestorePatchFields(
        'bids',
        bidId,
        { status: parsed.data.status, updatedAt: new Date().toISOString() },
        req.admin!.idToken
      );
      await appendAuditLog(req, 'admin', `BID_${parsed.data.status.toUpperCase()}`, `bids/${bidId}`, 'success');
      res.json({ bid: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Bid review failed' });
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
      const updated = await firestorePatchFields(
        'disputes',
        disputeId,
        {
          status: parsed.data.status,
          resolutionNote: parsed.data.resolutionNote.trim(),
          resolvedBy: req.admin!.uid,
          updatedAt: new Date().toISOString(),
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
v1Router.get(
  '/admin/email/status',
  requireAdminAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const admin = req.admin!;
    if (
      admin.role !== 'SUPER_ADMIN' &&
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

const testEmailSchema = z.object({
  recipientEmail: z.string().email().max(254),
  subject: z.string().min(2).max(200).optional(),
  message: z.string().min(2).max(2000).optional(),
});

v1Router.post(
  '/admin/email/test',
  requireAdminAuth,
  requirePermission('platform_settings', 'update'),
  async (req: AuthenticatedRequest, res: Response) => {
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
      `This test message confirms official email delivery from SWAS TASKS (swastaskorg@gmail.com) triggered by ${req.admin!.email} on ${new Date().toUTCString()}.`;

    const { delivery, emailLog } = await sendPlatformEmail({
      toEmail: recipient,
      subject,
      title: 'Email Configuration Test',
      greeting: 'Hello,',
      bodyText,
      scope: 'control_centre',
      eventType: 'admin_communication',
      triggeredByUid: req.admin!.uid,
      idToken: req.admin!.idToken,
      persistLog: true,
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

const adminDispatchEmailSchema = z.object({
  recipientEmail: z.string().email().max(254),
  scope: z.enum(['public_website', 'control_centre']).default('control_centre'),
  eventType: z.string().min(2).max(64),
  subject: z.string().min(2).max(200),
  title: z.string().max(160).optional(),
  greeting: z.string().max(120).optional(),
  bodyText: z.string().min(2).max(4000),
  ctaLabel: z.string().max(80).optional(),
  ctaUrl: z
    .string()
    .url()
    .max(500)
    .refine((val) => /^https?:\/\//i.test(val), 'CTA URL must start with http:// or https://')
    .optional(),
});

v1Router.post(
  '/admin/email/dispatch',
  requireAdminAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = adminDispatchEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid email dispatch payload.', details: parsed.error.flatten() });
      return;
    }

    const { delivery, emailLog } = await sendPlatformEmail({
      toEmail: parsed.data.recipientEmail.trim().toLowerCase(),
      subject: parsed.data.subject.trim(),
      title: parsed.data.title?.trim(),
      greeting: parsed.data.greeting?.trim(),
      bodyText: parsed.data.bodyText.trim(),
      ctaLabel: parsed.data.ctaLabel?.trim(),
      ctaUrl: parsed.data.ctaUrl?.trim(),
      scope: parsed.data.scope,
      eventType: parsed.data.eventType,
      triggeredByUid: req.admin!.uid,
      idToken: req.admin!.idToken,
      persistLog: true,
    });

    await appendAuditLog(
      req,
      'admin',
      'DISPATCH_PLATFORM_EMAIL',
      emailLog ? `email_logs/${emailLog.emailLogId}` : `email/${parsed.data.recipientEmail}`,
      delivery.sent ? 'success' : 'failed',
      {
        eventType: parsed.data.eventType,
        scope: parsed.data.scope,
        status: delivery.status,
      }
    );

    res.json({ delivery, emailLog });
  }
);

v1Router.post(
  '/admin/email/logs/:id/retry',
  requireAdminAuth,
  requirePermission('platform_settings', 'update'),
  async (req: AuthenticatedRequest, res: Response) => {
    const emailLogId = String(req.params.id || '');
    if (!validateSafeId(emailLogId)) {
      res.status(400).json({ error: 'Invalid email log ID.' });
      return;
    }

    try {
      const existing = await firestoreGetDoc('email_logs', emailLogId, req.admin!.idToken);
      if (!existing) {
        res.status(404).json({ error: 'Email log record not found.' });
        return;
      }

      const recipientEmail = String(existing.recipientEmail || '');
      const subject = String(existing.subject || 'SWAS TASKS Notification');
      const bodyText = String(existing.bodyPreview || 'Official communication from SWAS TASKS.');
      const scope =
        existing.scope === 'public_website' ? 'public_website' : 'control_centre';
      const eventType = String(existing.eventType || 'admin_communication');

      const { delivery } = await sendPlatformEmail({
        toEmail: recipientEmail,
        subject,
        bodyText,
        scope,
        eventType,
        triggeredByUid: req.admin!.uid,
        idToken: req.admin!.idToken,
        persistLog: false,
      });

      const now = new Date().toISOString();
      const updatedLog = await firestorePatchFields(
        'email_logs',
        emailLogId,
        {
          provider: delivery.provider.slice(0, 80),
          providerMessageId: (delivery.providerMessageId || '').slice(0, 160),
          status: delivery.status,
          errorDetail: delivery.sent ? '' : delivery.detail.slice(0, 800),
          retryCount: Number(existing.retryCount || 0) + 1,
          updatedAt: now,
        },
        req.admin!.idToken
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
      const adminDoc = await firestoreGetDoc('admins', decoded.uid, idToken).catch(() => null);
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

