import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import nodemailer from 'nodemailer';
import { firebaseConfig, getMessagingStatus, serverConfig } from '../config.ts';
import {
  firestoreGetDoc,
  firestoreListCollection,
  firestorePatchFields,
  firestoreQueryByField,
  firestoreSetDoc,
} from '../firestoreRest.ts';

export type EmailDeliveryStatus =
  | 'sent'
  | 'accepted'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'rejected'
  | 'deferred'
  | 'not_configured'
  | 'scheduled'
  | 'cancelled'
  | 'duplicate_blocked';

export type EmailScope = 'public_website' | 'control_centre';
export type EmailKind = 'automatic' | 'manual' | 'scheduled' | 'bulk';

export interface EmailAttachmentInput {
  name: string;
  contentType: string;
  sizeBytes: number;
  storagePath?: string;
  downloadUrl: string;
}

export interface DeliveryResult {
  sent: boolean;
  status: EmailDeliveryStatus;
  provider: string;
  providerMessageId?: string;
  fromAddress: string;
  replyToAddress: string;
  detail: string;
  error?: string;
  sentAt?: string;
}

export interface GmailAuthCheckResult {
  authorized: boolean;
  connectedEmail: string;
  officialEmail: string;
  matchesOfficialEmail: boolean;
  hasGmailSendScope: boolean;
  scopes: string[];
  expiresInSeconds?: number;
  messagesTotal?: number;
  threadsTotal?: number;
  smtpConfigured: boolean;
  smtpProvider: string;
  error?: string;
  checkedAt: string;
}

export interface EmailLogEntry {
  emailLogId: string;
  scope: EmailScope;
  department: string;
  kind: EmailKind;
  eventType: string;
  campaignId?: string;
  recipientEmail: string;
  recipientName?: string;
  recipientUid?: string;
  recipientType?: 'user' | 'worker' | 'client' | 'admin' | 'custom';
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string;
  bodyPreview: string;
  htmlBody?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  attachments?: EmailAttachmentInput[];
  fromAddress: string;
  replyToAddress: string;
  provider: string;
  providerMessageId: string;
  status: EmailDeliveryStatus;
  deliveryStatusDetail?: string;
  errorDetail: string;
  bounceReason?: string;
  retryCount: number;
  batchId?: string;
  scheduledFor?: string;
  sentAt?: string;
  deliveredAt?: string;
  openedAt?: string;
  clickedAt?: string;
  idempotencyKey?: string;
  sourceRecord?: string;
  triggeredByUid: string;
  triggeredByEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainVerificationStatus {
  officialEmail: string;
  domain: string;
  providerConnected: boolean;
  providerType: string;
  providerName: string;
  spfStatus: 'verified' | 'missing' | 'unknown';
  spfRecord: string;
  dmarcStatus: 'verified' | 'missing' | 'unknown';
  dmarcRecord: string;
  dkimStatus: 'managed_by_gmail' | 'selector_required' | 'unknown';
  dkimNote: string;
  checkedAt: string;
}

const recentDispatchFingerprints = new Map<string, number>();
const processedIdempotencyKeys = new Set<string>();
const dispatchTimestamps: number[] = [];
const processingScheduledIds = new Set<string>();
const scheduledTokenCache = new Map<string, { idToken: string; uid: string; email: string; cachedAtMs: number }>();

let latestAdminToken: { idToken: string; uid: string; email: string; cachedAtMs: number } | null = null;

interface WebhookBufferedEvent {
  providerMessageId: string;
  status?: EmailDeliveryStatus;
  detail?: string;
  bounceReason?: string;
  deliveredAt?: string;
  openedAt?: string;
  clickedAt?: string;
  receivedAt: string;
}

const bufferedWebhookEvents = new Map<string, WebhookBufferedEvent>();

const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);

const ALLOWED_HTML_TAGS = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'span',
  'div',
  'hr',
]);

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, ' ').trim();
}

const STRICT_EMAIL_REGEX = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

export function normalizeEmailAddress(raw: string): string {
  const cleaned = sanitizeHeaderValue(raw);
  const angleMatch = cleaned.match(/<([^>]+)>/);
  return (angleMatch ? angleMatch[1] : cleaned).trim().toLowerCase();
}

export function isValidEmailAddress(raw: string): boolean {
  return STRICT_EMAIL_REGEX.test(normalizeEmailAddress(raw));
}

function dedupeEmailList(list: string[] | undefined, excludeEmail: string, maxCount: number): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>([excludeEmail]);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of list || []) {
    const trimmed = sanitizeHeaderValue(raw);
    if (!trimmed) continue;
    const norm = normalizeEmailAddress(trimmed);
    if (!STRICT_EMAIL_REGEX.test(norm)) {
      invalid.push(trimmed);
      continue;
    }
    if (!seen.has(norm)) {
      seen.add(norm);
      valid.push(norm);
      if (valid.length >= maxCount) break;
    }
  }
  return { valid, invalid };
}

function formatSmtpError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return typeof err === 'string' ? err : 'SMTP email delivery failed.';
  }
  const e = err as {
    message?: string;
    code?: string;
    responseCode?: number;
    response?: string;
    command?: string;
  };
  const baseMsg = e.message || e.response || 'SMTP email delivery failed.';
  if (e.responseCode === 535 || baseMsg.includes('535-5.7.8') || baseMsg.includes('Username and Password not accepted')) {
    return 'Gmail SMTP authentication failed (535): use a 16-character Google App Password for swastaskorg@gmail.com (not a standard account password), or connect swastaskorg@gmail.com via Gmail OAuth in Email Settings.';
  }
  if (e.code === 'EAUTH') {
    return `SMTP authentication rejected credentials (${baseMsg}).`;
  }
  if (e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT' || e.code === 'ESOCKET') {
    return `Unable to reach mail server (${e.code}): ${baseMsg}`;
  }
  return e.responseCode ? `SMTP ${e.responseCode}: ${baseMsg}` : baseMsg;
}

export async function inspectGmailOAuthToken(accessToken?: string): Promise<GmailAuthCheckResult> {
  const status = getMessagingStatus();
  const officialEmail = normalizeEmailAddress(serverConfig.officialPlatformEmail || 'swastaskorg@gmail.com');
  const checkedAt = new Date().toISOString();

  if (!accessToken || !accessToken.trim()) {
    return {
      authorized: false,
      connectedEmail: '',
      officialEmail,
      matchesOfficialEmail: false,
      hasGmailSendScope: false,
      scopes: [],
      smtpConfigured: status.emailConfigured,
      smtpProvider: status.emailProvider,
      error: status.emailConfigured
        ? undefined
        : 'No active browser Gmail OAuth token. Click Connect Gmail Account (swastaskorg@gmail.com) to authorize sending.',
      checkedAt,
    };
  }

  const token = accessToken.trim();
  try {
    const tokenInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token }).toString(),
    });
    const tokenInfo = (await tokenInfoRes.json().catch(() => ({}))) as {
      email?: string;
      scope?: string;
      expires_in?: string | number;
      error?: string;
      error_description?: string;
    };

    if (!tokenInfoRes.ok || tokenInfo.error) {
      const reason = tokenInfo.error_description || tokenInfo.error || `Token verification failed (HTTP ${tokenInfoRes.status}).`;
      return {
        authorized: false,
        connectedEmail: '',
        officialEmail,
        matchesOfficialEmail: false,
        hasGmailSendScope: false,
        scopes: [],
        smtpConfigured: status.emailConfigured,
        smtpProvider: status.emailProvider,
        error: `Gmail authorization token invalid or expired: ${reason}`,
        checkedAt,
      };
    }

    const scopes = String(tokenInfo.scope || '')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const hasGmailSendScope =
      scopes.includes('https://www.googleapis.com/auth/gmail.send') ||
      scopes.includes('https://mail.google.com/');

    let connectedEmail = tokenInfo.email ? normalizeEmailAddress(tokenInfo.email) : '';
    let messagesTotal: number | undefined;
    let threadsTotal: number | undefined;
    let profileErr: string | undefined;

    if (hasGmailSendScope || !connectedEmail) {
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (profileRes.ok) {
        const profile = (await profileRes.json().catch(() => ({}))) as {
          emailAddress?: string;
          messagesTotal?: number;
          threadsTotal?: number;
        };
        if (profile.emailAddress) {
          connectedEmail = normalizeEmailAddress(profile.emailAddress);
        }
        messagesTotal = profile.messagesTotal;
        threadsTotal = profile.threadsTotal;
      } else {
        const pErr = (await profileRes.json().catch(() => ({}))) as { error?: { message?: string } };
        if (pErr?.error?.message) {
          profileErr = pErr.error.message;
        }
      }
    }

    if (!connectedEmail) {
      const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (userinfoRes.ok) {
        const uinfo = (await userinfoRes.json().catch(() => ({}))) as { email?: string };
        if (uinfo.email) connectedEmail = normalizeEmailAddress(uinfo.email);
      }
    }

    const matchesOfficialEmail = Boolean(connectedEmail && connectedEmail === officialEmail);
    const expiresInSeconds =
      tokenInfo.expires_in !== undefined ? Number(tokenInfo.expires_in) || undefined : undefined;

    let error: string | undefined;
    if (!hasGmailSendScope) {
      error = 'Gmail sending permission (gmail.send) was not granted. Reconnect and approve Gmail send access.';
    } else if (!matchesOfficialEmail) {
      error = `Connected Google account (${connectedEmail || 'unknown'}) does not match ${officialEmail}. Disconnect and sign in with ${officialEmail}.`;
    } else if (profileErr) {
      error = profileErr;
    }

    return {
      authorized: true,
      connectedEmail,
      officialEmail,
      matchesOfficialEmail,
      hasGmailSendScope,
      scopes,
      expiresInSeconds,
      messagesTotal,
      threadsTotal,
      smtpConfigured: status.emailConfigured,
      smtpProvider: status.emailProvider,
      error,
      checkedAt,
    };
  } catch (err) {
    return {
      authorized: false,
      connectedEmail: '',
      officialEmail,
      matchesOfficialEmail: false,
      hasGmailSendScope: false,
      scopes: [],
      smtpConfigured: status.emailConfigured,
      smtpProvider: status.emailProvider,
      error: err instanceof Error ? err.message : 'Unable to reach Google OAuth verification endpoint.',
      checkedAt,
    };
  }
}

function sanitizeSafeUrl(urlRaw: string): string | null {
  const trimmed = urlRaw.trim();
  if (!trimmed) return null;
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed.replace(/["<>]/g, '');
  }
  return null;
}

export function sanitizeEmailHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  let cleaned = rawHtml
    // Strip dangerous containers and their contents completely
    .replace(/<(script|style|iframe|object|embed|svg|form|input|textarea|button|meta|link|base)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|form|input|textarea|button|meta|link|base)\b[^>]*\/?>/gi, '')
    // Strip HTML comments
    .replace(/<!--[\s\S]*?-->/g, '');

  // Filter tags to strict allowlist and strip event handlers/dangerous attributes
  cleaned = cleaned.replace(/<\/?([a-zA-Z0-9]+)\b([^>]*)>/g, (fullMatch, tagRaw, attrsRaw) => {
    const tag = String(tagRaw).toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(tag)) {
      return '';
    }
    const isClosing = fullMatch.startsWith('</');
    if (isClosing) {
      return `</${tag}>`;
    }
    if (tag === 'br' || tag === 'hr') {
      return `<${tag} />`;
    }

    const safeAttrs: string[] = [];
    if (tag === 'a') {
      const hrefMatch = attrsRaw.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const hrefVal = hrefMatch ? hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '' : '';
      const safeHref = sanitizeSafeUrl(hrefVal);
      if (safeHref) {
        safeAttrs.push(`href="${escapeHtml(safeHref)}"`);
        safeAttrs.push('target="_blank"');
        safeAttrs.push('rel="noopener noreferrer"');
        safeAttrs.push('style="color:#1265C8;text-decoration:underline;"');
      }
    }

    const alignMatch = attrsRaw.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (alignMatch && tag !== 'a') {
      const styleVal = alignMatch[1] ?? alignMatch[2] ?? '';
      const textAlign = styleVal.match(/text-align\s*:\s*(left|center|right|justify)/i);
      if (textAlign) {
        safeAttrs.push(`style="text-align:${textAlign[1].toLowerCase()};"`);
      }
    }

    return safeAttrs.length > 0 ? `<${tag} ${safeAttrs.join(' ')}>` : `<${tag}>`;
  });

  return cleaned.trim();
}

export function extractPlainText(htmlOrText: string): string {
  return htmlOrText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderPersonalizedVars(
  template: string,
  vars: Record<string, string>,
  escapeForHtml: boolean
): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, keyRaw: string) => {
    const key = keyRaw.toLowerCase();
    const val = vars[key] ?? '';
    return escapeForHtml ? escapeHtml(val) : val;
  });
}

export function buildSwasBrandedHtml(params: {
  title: string;
  greeting?: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  signatureHtml?: string;
  footerText?: string;
  logoUrl?: string;
  replyToEmail: string;
  officialEmail: string;
  senderDisplayName: string;
}): string {
  const safeTitle = escapeHtml(params.title);
  const safeSender = escapeHtml(params.senderDisplayName);
  const safeOfficial = escapeHtml(params.officialEmail);
  const safeReplyTo = escapeHtml(params.replyToEmail);
  const safeCtaUrl = params.ctaUrl ? sanitizeSafeUrl(params.ctaUrl) : null;
  const safeLogoUrl =
    params.logoUrl && /^https:\/\//i.test(params.logoUrl) ? escapeHtml(params.logoUrl) : null;

  const greetingBlock = params.greeting
    ? `<p style="margin:0 0 14px;font-size:14px;color:#172B46;">${escapeHtml(params.greeting)}</p>`
    : '';
  const ctaBlock =
    params.ctaLabel && safeCtaUrl
      ? `<p style="margin:24px 0;"><a href="${escapeHtml(
          safeCtaUrl
        )}" style="display:inline-block;background:#1265C8;color:#FFFFFF;padding:12px 22px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(
          params.ctaLabel
        )}</a></p>`
      : '';
  const signatureBlock = params.signatureHtml
    ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #E2E8F0;font-size:13px;color:#334155;">${sanitizeEmailHtml(
        params.signatureHtml
      )}</div>`
    : '';
  const customFooter = params.footerText
    ? `<p style="margin:0 0 6px;font-size:12px;color:#64748B;">${escapeHtml(params.footerText)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#F3F6FA;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#172B46;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
    <tr>
      <td style="background:#102B50;padding:20px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td>
              ${
                safeLogoUrl
                  ? `<img src="${safeLogoUrl}" alt="${safeSender}" style="max-height:34px;margin-bottom:8px;display:block;" />`
                  : ''
              }
              <p style="margin:0;font-family:Poppins,Inter,sans-serif;font-size:18px;font-weight:600;color:#FFFFFF;letter-spacing:-0.01em;">
                ${safeSender}
              </p>
              <p style="margin:4px 0 0;font-size:12px;color:#BFDBFE;">
                Official Platform Communications · ${safeOfficial}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <h2 style="margin:0 0 16px;font-family:Poppins,Inter,sans-serif;font-size:20px;font-weight:600;color:#102B50;">
          ${safeTitle}
        </h2>
        ${greetingBlock}
        <div style="font-size:14px;line-height:1.65;color:#172B46;">
          ${params.bodyHtml}
        </div>
        ${ctaBlock}
        ${signatureBlock}
      </td>
    </tr>
    <tr>
      <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:16px 24px;font-size:12px;color:#75869D;line-height:1.5;">
        ${customFooter}
        Sent by <strong>${safeSender}</strong> (${safeOfficial}).<br />
        Replies are routed to <a href="mailto:${safeReplyTo}" style="color:#1265C8;text-decoration:none;">${safeReplyTo}</a>.
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function loadEmailConfigSettings(idToken?: string): Promise<{
  senderDisplayName: string;
  officialEmail: string;
  replyToEmail: string;
  signatureHtml: string;
  footerText: string;
  logoUrl: string;
  hourlyLimit: number;
  dailyLimit: number;
  notificationRules: Record<string, boolean>;
  templates: Record<string, { subject?: string; body?: string }>;
}> {
  const defaults = {
    senderDisplayName: serverConfig.emailSenderName || 'SWAS TASKS Organization',
    officialEmail: serverConfig.officialPlatformEmail || 'swastaskorg@gmail.com',
    replyToEmail: serverConfig.emailReplyTo || 'swastaskorg@gmail.com',
    signatureHtml:
      '<p>Regards,<br /><strong>SWAS TASKS Organization</strong><br />swastaskorg@gmail.com</p>',
    footerText: 'SWAS TASKS Central Control Centre · Private Platform Administration',
    logoUrl: '',
    hourlyLimit: 500,
    dailyLimit: 2500,
    notificationRules: {} as Record<string, boolean>,
    templates: {} as Record<string, { subject?: string; body?: string }>,
  };

  try {
    const [doc, publicDoc] = await Promise.all([
      firestoreGetDoc('platform_settings', 'email_configuration', idToken),
      firestoreGetDoc('platform_settings', 'public', idToken).catch(() => null),
    ]);
    if (!doc) {
      return {
        ...defaults,
        logoUrl: typeof publicDoc?.logoUrl === 'string' ? publicDoc.logoUrl : '',
      };
    }
    const cfg =
      doc.config && typeof doc.config === 'object'
        ? (doc.config as Record<string, unknown>)
        : {};
    const displayName =
      typeof doc.senderDisplayName === 'string' && doc.senderDisplayName.trim()
        ? doc.senderDisplayName.trim()
        : typeof cfg.senderName === 'string' && cfg.senderName.trim()
        ? cfg.senderName.trim()
        : defaults.senderDisplayName;
    const replyTo =
      typeof doc.replyToEmail === 'string' && doc.replyToEmail.trim()
        ? doc.replyToEmail.trim().toLowerCase()
        : typeof cfg.replyToEmail === 'string' && cfg.replyToEmail.trim()
        ? cfg.replyToEmail.trim().toLowerCase()
        : typeof cfg.senderEmail === 'string' && cfg.senderEmail.trim()
        ? cfg.senderEmail.trim().toLowerCase()
        : defaults.replyToEmail;
    const notificationRules =
      cfg.notificationRules && typeof cfg.notificationRules === 'object'
        ? (cfg.notificationRules as Record<string, boolean>)
        : {};
    const templates =
      cfg.templates && typeof cfg.templates === 'object'
        ? (cfg.templates as Record<string, { subject?: string; body?: string }>)
        : {};

    return {
      senderDisplayName: displayName,
      officialEmail: defaults.officialEmail,
      replyToEmail: replyTo || defaults.officialEmail,
      signatureHtml:
        typeof cfg.signatureHtml === 'string' && cfg.signatureHtml.trim()
          ? cfg.signatureHtml
          : defaults.signatureHtml,
      footerText:
        typeof cfg.footerText === 'string' && cfg.footerText.trim()
          ? cfg.footerText.trim()
          : defaults.footerText,
      logoUrl:
        typeof cfg.logoUrl === 'string' && cfg.logoUrl.trim()
          ? cfg.logoUrl.trim()
          : typeof publicDoc?.logoUrl === 'string'
          ? publicDoc.logoUrl
          : '',
      hourlyLimit:
        typeof cfg.hourlyLimit === 'number' && cfg.hourlyLimit > 0
          ? Math.min(cfg.hourlyLimit, 10000)
          : defaults.hourlyLimit,
      dailyLimit:
        typeof cfg.dailyLimit === 'number' && cfg.dailyLimit > 0
          ? Math.min(cfg.dailyLimit, 50000)
          : defaults.dailyLimit,
      notificationRules,
      templates,
    };
  } catch {
    return defaults;
  }
}

export async function resolveEffectiveSenderIdentity(idToken?: string): Promise<{
  platformName: string;
  officialEmail: string;
  senderDisplayName: string;
  replyToEmail: string;
  signatureHtml: string;
  footerText: string;
  logoUrl: string;
  hourlyLimit: number;
  dailyLimit: number;
}> {
  const cfg = await loadEmailConfigSettings(idToken);
  return {
    platformName: 'SWAS TASKS',
    officialEmail: cfg.officialEmail,
    senderDisplayName: cfg.senderDisplayName,
    replyToEmail: cfg.replyToEmail,
    signatureHtml: cfg.signatureHtml,
    footerText: cfg.footerText,
    logoUrl: cfg.logoUrl,
    hourlyLimit: cfg.hourlyLimit,
    dailyLimit: cfg.dailyLimit,
  };
}

function isAllowedFirebaseStorageUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    const bucket = (firebaseConfig.storageBucket || '').toLowerCase();
    if (!bucket) return false;
    if (host === 'firebasestorage.googleapis.com') {
      return parsed.pathname.toLowerCase().includes(`/b/${bucket}/`);
    }
    if (host === 'storage.googleapis.com') {
      return parsed.pathname.toLowerCase().startsWith(`/${bucket}/`);
    }
    return false;
  } catch {
    return false;
  }
}

async function fetchValidatedAttachments(
  attachments?: EmailAttachmentInput[]
): Promise<Array<{ filename: string; content: Buffer; contentType: string }>> {
  if (!attachments || attachments.length === 0) return [];
  const limited = attachments.slice(0, 5);
  const resolved: Array<{ filename: string; content: Buffer; contentType: string }> = [];

  for (const att of limited) {
    if (!att.downloadUrl || !isAllowedFirebaseStorageUrl(att.downloadUrl)) {
      throw new Error(`Attachment '${att.name}' URL is not hosted in this project's Firebase Storage bucket.`);
    }
    if (!ALLOWED_ATTACHMENT_MIMES.has(att.contentType.toLowerCase())) {
      throw new Error(`Unsupported attachment MIME type '${att.contentType}' on '${att.name}'.`);
    }
    if (att.sizeBytes > serverConfig.maxEmailAttachmentBytes) {
      throw new Error(`Attachment '${att.name}' exceeds the 5 MB limit.`);
    }

    const res = await fetch(att.downloadUrl);
    if (!res.ok) {
      throw new Error(`Unable to fetch attachment '${att.name}' (${res.status}).`);
    }
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    if (buf.byteLength > serverConfig.maxEmailAttachmentBytes) {
      throw new Error(`Attachment '${att.name}' exceeded 5 MB during download.`);
    }
    resolved.push({
      filename: att.name.replace(/[/\\<>:"|?*]/g, '_').slice(0, 120) || 'attachment',
      content: buf,
      contentType: att.contentType,
    });
  }

  return resolved;
}

function checkSendingRateLimit(hourlyLimit: number, dailyLimit: number): string | null {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const oneHourAgo = now - 60 * 60 * 1000;
  while (dispatchTimestamps.length > 0 && dispatchTimestamps[0] < oneDayAgo) {
    dispatchTimestamps.shift();
  }
  const hourlyCount = dispatchTimestamps.filter((ts) => ts >= oneHourAgo).length;
  if (hourlyCount >= hourlyLimit) {
    return `Hourly platform sending limit (${hourlyLimit}/hr) reached. Please try again shortly.`;
  }
  if (dispatchTimestamps.length >= dailyLimit) {
    return `Daily platform sending limit (${dailyLimit}/day) reached.`;
  }
  return null;
}

export function rememberAdminSessionToken(admin: {
  idToken: string;
  uid: string;
  email: string;
}): void {
  latestAdminToken = {
    idToken: admin.idToken,
    uid: admin.uid,
    email: admin.email,
    cachedAtMs: Date.now(),
  };
}

export async function sendPlatformEmail(params: {
  toEmail: string;
  subject: string;
  title?: string;
  greeting?: string;
  bodyText: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  ccEmails?: string[];
  bccEmails?: string[];
  attachments?: EmailAttachmentInput[];
  includeSignature?: boolean;
  scope: EmailScope;
  department?: string;
  kind?: EmailKind;
  eventType: string;
  campaignId?: string;
  recipientName?: string;
  recipientUid?: string;
  recipientType?: 'user' | 'worker' | 'client' | 'admin' | 'custom';
  batchId?: string;
  scheduledFor?: string;
  idempotencyKey?: string;
  sourceRecord?: string;
  triggeredByUid?: string;
  triggeredByEmail?: string;
  idToken?: string;
  gmailAccessToken?: string;
  persistLog?: boolean;
  skipDuplicateGuard?: boolean;
}): Promise<{ delivery: DeliveryResult; emailLog: EmailLogEntry | null }> {
  const status = getMessagingStatus();
  const cfg = await loadEmailConfigSettings(params.idToken);

  const safeSenderName = sanitizeHeaderValue(cfg.senderDisplayName || 'SWAS TASKS Organization');
  const officialEmail = normalizeEmailAddress(cfg.officialEmail || 'swastaskorg@gmail.com');
  const replyToEmail = normalizeEmailAddress(cfg.replyToEmail || officialEmail);

  const hasGmailOAuth = Boolean(params.gmailAccessToken && params.gmailAccessToken.trim());
  const rawFromEmail = hasGmailOAuth
    ? officialEmail
    : status.emailProviderType === 'gmail_smtp'
    ? serverConfig.gmailSmtpUser || officialEmail
    : status.emailProviderType === 'smtp'
    ? serverConfig.smtpUser || officialEmail
    : serverConfig.emailFrom || officialEmail;

  const formattedFrom = rawFromEmail.includes('<')
    ? rawFromEmail
    : `${safeSenderName} <${rawFromEmail}>`;

  const templateOverride = cfg.templates[params.eventType];
  const effectiveSubject = sanitizeHeaderValue(
    params.subject || templateOverride?.subject || 'SWAS TASKS Notification'
  );
  const rawSanitizedHtml = params.bodyHtml ? sanitizeEmailHtml(params.bodyHtml) : '';
  const effectiveBodyText =
    params.bodyText ||
    (rawSanitizedHtml ? extractPlainText(rawSanitizedHtml) : '') ||
    templateOverride?.body ||
    '';

  const department = params.department || 'platform_settings';
  const kind: EmailKind = params.kind || 'manual';

  const normalizedToEmail = normalizeEmailAddress(params.toEmail || '');
  if (!isValidEmailAddress(normalizedToEmail)) {
    const errMsg = `Invalid recipient email address: "${params.toEmail || '(empty)'}".`;
    return {
      delivery: {
        sent: false,
        status: 'failed',
        provider: hasGmailOAuth ? 'Gmail OAuth API' : status.emailProvider,
        fromAddress: formattedFrom,
        replyToAddress: replyToEmail,
        detail: errMsg,
        error: errMsg,
      },
      emailLog: null,
    };
  }

  // Duplicate & idempotency checks
  if (params.idempotencyKey && processedIdempotencyKeys.has(params.idempotencyKey)) {
    const msg = `Duplicate dispatch prevented by idempotency key (${params.idempotencyKey}).`;
    return {
      delivery: {
        sent: false,
        status: 'duplicate_blocked',
        provider: 'Idempotency Guard',
        fromAddress: formattedFrom,
        replyToAddress: replyToEmail,
        detail: msg,
        error: msg,
      },
      emailLog: null,
    };
  }

  const fingerprint = `${normalizedToEmail}|${effectiveSubject}|${kind}`;
  const lastSentAt = recentDispatchFingerprints.get(fingerprint);
  if (!params.skipDuplicateGuard && lastSentAt && Date.now() - lastSentAt < 30_000) {
    const msg = 'Duplicate send to the same recipient and subject within 30 seconds was blocked.';
    return {
      delivery: {
        sent: false,
        status: 'duplicate_blocked',
        provider: 'Duplicate Protection',
        fromAddress: formattedFrom,
        replyToAddress: replyToEmail,
        detail: msg,
        error: msg,
      },
      emailLog: null,
    };
  }

  const rateLimitErr = checkSendingRateLimit(cfg.hourlyLimit, cfg.dailyLimit);
  if (rateLimitErr) {
    return {
      delivery: {
        sent: false,
        status: 'failed',
        provider: 'Rate Limiter',
        fromAddress: formattedFrom,
        replyToAddress: replyToEmail,
        detail: rateLimitErr,
        error: rateLimitErr,
      },
      emailLog: null,
    };
  }

  const renderedBodyHtml =
    rawSanitizedHtml ||
    `<p style="margin:0;">${escapeHtml(effectiveBodyText).replace(/\n/g, '<br />')}</p>`;

  const html = buildSwasBrandedHtml({
    title: params.title || effectiveSubject,
    greeting: params.greeting,
    bodyHtml: renderedBodyHtml,
    ctaLabel: params.ctaLabel,
    ctaUrl: params.ctaUrl,
    signatureHtml: params.includeSignature !== false ? cfg.signatureHtml : undefined,
    footerText: cfg.footerText,
    logoUrl: cfg.logoUrl,
    replyToEmail,
    officialEmail,
    senderDisplayName: safeSenderName,
  });

  const ccParsed = dedupeEmailList(params.ccEmails, normalizedToEmail, 20);
  const bccParsed = dedupeEmailList(params.bccEmails, normalizedToEmail, 50);
  const safeCc = ccParsed.valid;
  const safeBcc = bccParsed.valid.filter((b) => !safeCc.includes(b));
  const invalidCopyAddresses = [...ccParsed.invalid, ...bccParsed.invalid];

  let resolvedAttachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  let attachmentError: string | null = null;
  if (invalidCopyAddresses.length > 0) {
    attachmentError = `Invalid CC/BCC email address(es): ${invalidCopyAddresses.join(', ')}`;
  } else if (params.attachments && params.attachments.length > 0) {
    try {
      resolvedAttachments = await fetchValidatedAttachments(params.attachments);
    } catch (err) {
      attachmentError = err instanceof Error ? err.message : 'Failed to prepare attachments.';
    }
  }

  let delivery: DeliveryResult;
  const attemptedAt = new Date().toISOString();

  if (attachmentError) {
    delivery = {
      sent: false,
      status: 'failed',
      provider: hasGmailOAuth ? 'Gmail OAuth API' : status.emailProvider,
      fromAddress: formattedFrom,
      replyToAddress: replyToEmail,
      detail: attachmentError,
      error: attachmentError,
    };
  } else if (hasGmailOAuth) {
    const tokenCheck = await inspectGmailOAuthToken(params.gmailAccessToken);
    if (!tokenCheck.authorized || !tokenCheck.hasGmailSendScope || !tokenCheck.matchesOfficialEmail) {
      const errMsg =
        tokenCheck.error ||
        `Gmail OAuth authorization is invalid for ${officialEmail}. Reconnect swastaskorg@gmail.com in Email Settings.`;
      delivery = {
        sent: false,
        status: 'failed',
        provider: `Gmail OAuth (${officialEmail})`,
        fromAddress: formattedFrom,
        replyToAddress: replyToEmail,
        detail: errMsg,
        error: errMsg,
      };
    } else {
      try {
        const mimeBuilder = nodemailer.createTransport({
          streamTransport: true,
          buffer: true,
          newline: 'unix',
        });
        const mimeInfo = await mimeBuilder.sendMail({
          from: formattedFrom,
          to: normalizedToEmail,
          cc: safeCc.length > 0 ? safeCc : undefined,
          bcc: safeBcc.length > 0 ? safeBcc : undefined,
          replyTo: `${safeSenderName} <${replyToEmail}>`,
          subject: effectiveSubject,
          text: `${effectiveBodyText}\n\n---\n${safeSenderName} · ${officialEmail}\nReply-To: ${replyToEmail}`,
          html,
          attachments:
            resolvedAttachments.length > 0
              ? resolvedAttachments.map((a) => ({
                  filename: a.filename,
                  content: a.content,
                  contentType: a.contentType,
                }))
              : undefined,
        });

        const rawBuffer = Buffer.isBuffer(mimeInfo.message)
          ? mimeInfo.message
          : Buffer.from(String(mimeInfo.message || ''), 'utf8');
        const rawEncoded = rawBuffer.toString('base64url');

        const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.gmailAccessToken!.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: rawEncoded }),
        });

        if (!gmailRes.ok) {
          const errJson = (await gmailRes.json().catch(() => ({}))) as {
            error?: { code?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> };
          };
          const reasonDetail = errJson?.error?.errors?.[0]?.reason
            ? ` (${errJson.error.errors[0].reason})`
            : '';
          const errMsg = `Gmail API error ${gmailRes.status}${reasonDetail}: ${
            errJson?.error?.message || gmailRes.statusText || 'Message send rejected by Gmail API.'
          }`;
          delivery = {
            sent: false,
            status: 'failed',
            provider: `Gmail OAuth API (${officialEmail})`,
            fromAddress: formattedFrom,
            replyToAddress: replyToEmail,
            detail: errMsg,
            error: errMsg,
          };
        } else {
          const gmailJson = (await gmailRes.json().catch(() => ({}))) as { id?: string; threadId?: string };
          const msgId = gmailJson.id || `gmail_${Date.now()}`;
          dispatchTimestamps.push(Date.now());
          recentDispatchFingerprints.set(fingerprint, Date.now());
          if (params.idempotencyKey) processedIdempotencyKeys.add(params.idempotencyKey);
          const okDetail = `Email sent via Gmail OAuth (${officialEmail}) to ${normalizedToEmail} (Gmail ID: ${msgId}).`;
          delivery = {
            sent: true,
            status: 'sent',
            provider: `Gmail OAuth API (${officialEmail})`,
            providerMessageId: msgId,
            fromAddress: formattedFrom,
            replyToAddress: replyToEmail,
            sentAt: attemptedAt,
            detail: okDetail,
          };
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Failed to dispatch email via Gmail API.';
        delivery = {
          sent: false,
          status: 'failed',
          provider: `Gmail OAuth API (${officialEmail})`,
          fromAddress: formattedFrom,
          replyToAddress: replyToEmail,
          detail: errMsg,
          error: errMsg,
        };
      }
    }
  } else if (!status.emailConfigured) {
    const errMsg =
      'EMAIL SERVICE NOT CONFIGURED: Connect swastaskorg@gmail.com via Google OAuth in Email Centre → Settings, or configure server-side GMAIL_SMTP_USER & GMAIL_APP_PASSWORD / SMTP / RESEND_API_KEY.';
    delivery = {
      sent: false,
      status: 'not_configured',
      provider: 'EMAIL SERVICE NOT CONFIGURED',
      fromAddress: formattedFrom,
      replyToAddress: replyToEmail,
      detail: errMsg,
      error: errMsg,
    };
  } else if (status.emailProviderType === 'gmail_smtp' || status.emailProviderType === 'smtp') {
    try {
      const transporter =
        status.emailProviderType === 'gmail_smtp'
          ? nodemailer.createTransport({
              service: 'gmail',
              auth: {
                user: serverConfig.gmailSmtpUser,
                pass: serverConfig.gmailAppPassword,
              },
            })
          : nodemailer.createTransport({
              host: serverConfig.smtpHost,
              port: serverConfig.smtpPort || 465,
              secure: (serverConfig.smtpPort || 465) === 465,
              auth: {
                user: serverConfig.smtpUser,
                pass: serverConfig.smtpPass,
              },
            });

      const info = await transporter.sendMail({
        from: formattedFrom,
        to: normalizedToEmail,
        cc: safeCc.length > 0 ? safeCc : undefined,
        bcc: safeBcc.length > 0 ? safeBcc : undefined,
        replyTo: `${safeSenderName} <${replyToEmail}>`,
        subject: effectiveSubject,
        text: `${effectiveBodyText}\n\n---\n${safeSenderName} · ${officialEmail}\nReply-To: ${replyToEmail}`,
        html,
        attachments:
          resolvedAttachments.length > 0
            ? resolvedAttachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                contentType: a.contentType,
              }))
            : undefined,
      });

      const rejectedList = Array.isArray(info.rejected)
        ? info.rejected.map((r) => String(r)).filter(Boolean)
        : [];

      if (rejectedList.length > 0) {
        const errReasons = Array.isArray((info as { rejectedErrors?: unknown[] }).rejectedErrors)
          ? (info as { rejectedErrors: Array<{ message?: string }> }).rejectedErrors
              .map((re) => re?.message)
              .filter(Boolean)
              .join('; ')
          : '';
        const errMsg = `SMTP rejected recipient(s) [${rejectedList.join(', ')}]${errReasons ? `: ${errReasons}` : '.'}`;
        delivery = {
          sent: false,
          status: 'rejected',
          provider: status.emailProvider,
          providerMessageId: info.messageId || undefined,
          fromAddress: formattedFrom,
          replyToAddress: replyToEmail,
          detail: errMsg,
          error: errMsg,
        };
      } else if (!info.messageId) {
        const errMsg = 'Email provider did not confirm a messageId after submission.';
        delivery = {
          sent: false,
          status: 'failed',
          provider: status.emailProvider,
          fromAddress: formattedFrom,
          replyToAddress: replyToEmail,
          detail: errMsg,
          error: errMsg,
        };
      } else {
        dispatchTimestamps.push(Date.now());
        recentDispatchFingerprints.set(fingerprint, Date.now());
        if (params.idempotencyKey) processedIdempotencyKeys.add(params.idempotencyKey);
        delivery = {
          sent: true,
          status: 'sent',
          provider: status.emailProvider,
          providerMessageId: info.messageId,
          fromAddress: formattedFrom,
          replyToAddress: replyToEmail,
          sentAt: attemptedAt,
          detail: `Email accepted for delivery via ${status.emailProvider} to ${normalizedToEmail} (Message ID: ${info.messageId}).`,
        };
      }
    } catch (err) {
      const errMsg = formatSmtpError(err);
      delivery = {
        sent: false,
        status: 'failed',
        provider: status.emailProvider,
        fromAddress: formattedFrom,
        replyToAddress: replyToEmail,
        detail: errMsg,
        error: errMsg,
      };
    }
  } else {
    try {
      const resendPayload: Record<string, unknown> = {
        from: formattedFrom,
        to: [normalizedToEmail],
        reply_to: replyToEmail,
        subject: effectiveSubject,
        html,
        text: effectiveBodyText,
      };
      if (safeCc.length > 0) resendPayload.cc = safeCc;
      if (safeBcc.length > 0) resendPayload.bcc = safeBcc;
      if (resolvedAttachments.length > 0) {
        resendPayload.attachments = resolvedAttachments.map((a) => ({
          filename: a.filename,
          content: a.content.toString('base64'),
        }));
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serverConfig.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(resendPayload),
      });

      if (!response.ok) {
        const errText = await response.text();
        const errMsg = `Email provider returned ${response.status}: ${errText}`;
        delivery = {
          sent: false,
          status: 'failed',
          provider: status.emailProvider,
          fromAddress: formattedFrom,
          replyToAddress: replyToEmail,
          detail: errMsg,
          error: errMsg,
        };
      } else {
        const resJson = (await response.json().catch(() => ({}))) as { id?: string };
        dispatchTimestamps.push(Date.now());
        recentDispatchFingerprints.set(fingerprint, Date.now());
        if (params.idempotencyKey) processedIdempotencyKeys.add(params.idempotencyKey);
        delivery = {
          sent: true,
          status: 'accepted',
          provider: status.emailProvider,
          providerMessageId: resJson.id || `resend_${Date.now()}`,
          fromAddress: formattedFrom,
          replyToAddress: replyToEmail,
          sentAt: attemptedAt,
          detail: `Email accepted via Resend HTTPS API for ${normalizedToEmail}.`,
        };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Email provider request failed.';
      delivery = {
        sent: false,
        status: 'failed',
        provider: status.emailProvider,
        fromAddress: formattedFrom,
        replyToAddress: replyToEmail,
        detail: errMsg,
        error: errMsg,
      };
    }
  }

  let emailLog: EmailLogEntry | null = null;
  if (params.persistLog !== false && params.idToken) {
    const emailLogId = `eml_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const record: EmailLogEntry = {
      emailLogId,
      scope: params.scope,
      department: department.slice(0, 64),
      kind,
      eventType: params.eventType.slice(0, 64),
      ...(params.campaignId ? { campaignId: params.campaignId.slice(0, 128) } : {}),
      recipientEmail: normalizedToEmail.slice(0, 254),
      ...(params.recipientName ? { recipientName: params.recipientName.slice(0, 140) } : {}),
      ...(params.recipientUid ? { recipientUid: params.recipientUid.slice(0, 128) } : {}),
      ...(params.recipientType ? { recipientType: params.recipientType } : {}),
      ...(safeCc.length > 0 ? { ccEmails: safeCc } : {}),
      ...(safeBcc.length > 0 ? { bccEmails: safeBcc } : {}),
      subject: effectiveSubject.slice(0, 240),
      bodyPreview: effectiveBodyText.slice(0, 4000),
      htmlBody: renderedBodyHtml.slice(0, 32000),
      ...(params.ctaLabel ? { ctaLabel: params.ctaLabel.slice(0, 80) } : {}),
      ...(params.ctaUrl ? { ctaUrl: params.ctaUrl.slice(0, 500) } : {}),
      ...(params.attachments && params.attachments.length > 0
        ? { attachments: params.attachments.slice(0, 5) }
        : {}),
      fromAddress: formattedFrom.slice(0, 254),
      replyToAddress: replyToEmail.slice(0, 254),
      provider: delivery.provider.slice(0, 80),
      providerMessageId: (delivery.providerMessageId || '').slice(0, 160),
      status: delivery.status,
      deliveryStatusDetail: delivery.detail.slice(0, 800),
      errorDetail: delivery.sent ? '' : delivery.detail.slice(0, 800),
      retryCount: 0,
      ...(params.batchId ? { batchId: params.batchId.slice(0, 128) } : {}),
      ...(params.scheduledFor ? { scheduledFor: params.scheduledFor.slice(0, 64) } : {}),
      ...(delivery.sentAt ? { sentAt: delivery.sentAt } : {}),
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey.slice(0, 160) } : {}),
      ...(params.sourceRecord ? { sourceRecord: params.sourceRecord.slice(0, 200) } : {}),
      triggeredByUid: (params.triggeredByUid || 'system').slice(0, 128),
      ...(params.triggeredByEmail ? { triggeredByEmail: params.triggeredByEmail.slice(0, 254) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await firestoreSetDoc(
        'email_logs',
        emailLogId,
        record as unknown as Record<string, unknown>,
        params.idToken
      );
      emailLog = record;
    } catch (err) {
      console.error('Failed to persist email log:', err);
    }
  }

  return { delivery, emailLog };
}

export async function schedulePlatformEmail(params: {
  toEmail: string;
  recipientName?: string;
  recipientUid?: string;
  recipientType?: 'user' | 'worker' | 'client' | 'admin' | 'custom';
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  attachments?: EmailAttachmentInput[];
  scheduledFor: string;
  department: string;
  eventType: string;
  campaignId?: string;
  batchId?: string;
  sourceRecord?: string;
  triggeredByUid: string;
  triggeredByEmail: string;
  idToken: string;
}): Promise<EmailLogEntry> {
  const cfg = await loadEmailConfigSettings(params.idToken);
  const status = getMessagingStatus();
  const safeSenderName = sanitizeHeaderValue(cfg.senderDisplayName || 'SWAS TASKS Organization');
  const officialEmail = sanitizeHeaderValue(cfg.officialEmail || 'swastaskorg@gmail.com');
  const replyToEmail = sanitizeHeaderValue(cfg.replyToEmail || officialEmail);
  const formattedFrom = `${safeSenderName} <${officialEmail}>`;
  const emailLogId = `eml_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  const sanitizedHtml = params.bodyHtml ? sanitizeEmailHtml(params.bodyHtml) : '';

  const record: EmailLogEntry = {
    emailLogId,
    scope: 'control_centre',
    department: params.department.slice(0, 64),
    kind: 'scheduled',
    eventType: params.eventType.slice(0, 64),
    ...(params.campaignId ? { campaignId: params.campaignId.slice(0, 128) } : {}),
    recipientEmail: params.toEmail.trim().toLowerCase().slice(0, 254),
    ...(params.recipientName ? { recipientName: params.recipientName.slice(0, 140) } : {}),
    ...(params.recipientUid ? { recipientUid: params.recipientUid.slice(0, 128) } : {}),
    ...(params.recipientType ? { recipientType: params.recipientType } : {}),
    ...(params.ccEmails && params.ccEmails.length > 0 ? { ccEmails: params.ccEmails.slice(0, 20) } : {}),
    ...(params.bccEmails && params.bccEmails.length > 0 ? { bccEmails: params.bccEmails.slice(0, 50) } : {}),
    subject: sanitizeHeaderValue(params.subject).slice(0, 240),
    bodyPreview: (params.bodyText || extractPlainText(sanitizedHtml)).slice(0, 4000),
    ...(sanitizedHtml ? { htmlBody: sanitizedHtml.slice(0, 32000) } : {}),
    ...(params.ctaLabel ? { ctaLabel: params.ctaLabel.slice(0, 80) } : {}),
    ...(params.ctaUrl ? { ctaUrl: params.ctaUrl.slice(0, 500) } : {}),
    ...(params.attachments && params.attachments.length > 0
      ? { attachments: params.attachments.slice(0, 5) }
      : {}),
    fromAddress: formattedFrom.slice(0, 254),
    replyToAddress: replyToEmail.slice(0, 254),
    provider: status.emailProvider.slice(0, 80),
    providerMessageId: '',
    status: 'scheduled',
    deliveryStatusDetail: `Scheduled for delivery at ${params.scheduledFor}`,
    errorDetail: '',
    retryCount: 0,
    ...(params.batchId ? { batchId: params.batchId.slice(0, 128) } : {}),
    scheduledFor: params.scheduledFor.slice(0, 64),
    ...(params.sourceRecord ? { sourceRecord: params.sourceRecord.slice(0, 200) } : {}),
    triggeredByUid: params.triggeredByUid.slice(0, 128),
    triggeredByEmail: params.triggeredByEmail.slice(0, 254),
    createdAt: now,
    updatedAt: now,
  };

  await firestoreSetDoc(
    'email_logs',
    emailLogId,
    record as unknown as Record<string, unknown>,
    params.idToken
  );

  scheduledTokenCache.set(emailLogId, {
    idToken: params.idToken,
    uid: params.triggeredByUid,
    email: params.triggeredByEmail,
    cachedAtMs: Date.now(),
  });

  return record;
}

export async function processDueScheduledEmails(
  idToken?: string,
  departmentScope?: string
): Promise<{ processed: number; sent: number; failed: number }> {
  const tokenToUse = idToken || latestAdminToken?.idToken;
  if (!tokenToUse) {
    return { processed: 0, sent: 0, failed: 0 };
  }

  let logs: Record<string, unknown>[] = [];
  try {
    if (departmentScope && departmentScope !== 'all') {
      logs = await firestoreQueryByField('email_logs', 'department', 'EQUAL', departmentScope, tokenToUse, 200);
    } else {
      logs = await firestoreQueryByField('email_logs', 'status', 'EQUAL', 'scheduled', tokenToUse, 200);
    }
  } catch {
    return { processed: 0, sent: 0, failed: 0 };
  }

  const nowMs = Date.now();
  const dueLogs = logs.filter((row) => {
    if (row.status !== 'scheduled' || typeof row.scheduledFor !== 'string') return false;
    const dueMs = new Date(row.scheduledFor).getTime();
    return Number.isFinite(dueMs) && dueMs <= nowMs;
  });

  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const row of dueLogs) {
    const emailLogId = String(row.emailLogId || row.id || '');
    if (!emailLogId || processingScheduledIds.has(emailLogId)) continue;

    processingScheduledIds.add(emailLogId);
    try {
      const cached = scheduledTokenCache.get(emailLogId);
      const execToken = idToken || cached?.idToken || tokenToUse;
      const fresh = await firestoreGetDoc('email_logs', emailLogId, execToken);
      if (!fresh || fresh.status !== 'scheduled') continue;

      const { delivery } = await sendPlatformEmail({
        toEmail: String(fresh.recipientEmail || ''),
        recipientName: typeof fresh.recipientName === 'string' ? fresh.recipientName : undefined,
        recipientUid: typeof fresh.recipientUid === 'string' ? fresh.recipientUid : undefined,
        ccEmails: Array.isArray(fresh.ccEmails) ? (fresh.ccEmails as string[]) : undefined,
        bccEmails: Array.isArray(fresh.bccEmails) ? (fresh.bccEmails as string[]) : undefined,
        subject: String(fresh.subject || 'SWAS TASKS Notification'),
        bodyText: String(fresh.bodyPreview || ''),
        bodyHtml: typeof fresh.htmlBody === 'string' ? fresh.htmlBody : undefined,
        ctaLabel: typeof fresh.ctaLabel === 'string' ? fresh.ctaLabel : undefined,
        ctaUrl: typeof fresh.ctaUrl === 'string' ? fresh.ctaUrl : undefined,
        attachments: Array.isArray(fresh.attachments)
          ? (fresh.attachments as EmailAttachmentInput[])
          : undefined,
        scope: fresh.scope === 'public_website' ? 'public_website' : 'control_centre',
        department: typeof fresh.department === 'string' ? fresh.department : 'platform_settings',
        kind: 'scheduled',
        eventType: String(fresh.eventType || 'scheduled_email'),
        triggeredByUid: String(fresh.triggeredByUid || 'scheduler'),
        idToken: execToken,
        persistLog: false,
        skipDuplicateGuard: true,
      });

      const now = new Date().toISOString();
      await firestorePatchFields(
        'email_logs',
        emailLogId,
        {
          status: delivery.status,
          provider: delivery.provider.slice(0, 80),
          providerMessageId: (delivery.providerMessageId || '').slice(0, 160),
          deliveryStatusDetail: delivery.detail.slice(0, 800),
          errorDetail: delivery.sent ? '' : delivery.detail.slice(0, 800),
          ...(delivery.sentAt ? { sentAt: delivery.sentAt } : {}),
          updatedAt: now,
        },
        execToken
      );

      processed += 1;
      if (delivery.sent) sent += 1;
      else failed += 1;
      scheduledTokenCache.delete(emailLogId);
    } catch {
      failed += 1;
    } finally {
      processingScheduledIds.delete(emailLogId);
    }
  }

  return { processed, sent, failed };
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startEmailSchedulerLoop(intervalMs = 30_000): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    void processDueScheduledEmails().catch(() => undefined);
  }, intervalMs);
}

export async function runBulkCampaign(params: {
  campaignId: string;
  name: string;
  department: string;
  audienceFilter: string;
  recipients: Array<{
    email: string;
    name: string;
    uid?: string;
    recipientType?: 'user' | 'worker' | 'client' | 'admin' | 'custom';
    vars?: Record<string, string>;
  }>;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  attachments?: EmailAttachmentInput[];
  includeSignature?: boolean;
  templateId?: string;
  scheduledFor?: string;
  gmailAccessToken?: string;
  admin: { uid: string; email: string; idToken: string };
}): Promise<{
  campaign: Record<string, unknown>;
  sentCount: number;
  failedCount: number;
  logs: EmailLogEntry[];
}> {
  const now = new Date().toISOString();
  const isScheduled = Boolean(params.scheduledFor && new Date(params.scheduledFor).getTime() > Date.now());
  const sanitizedHtml = sanitizeEmailHtml(params.bodyHtml);
  const plainText = params.bodyText?.trim() || extractPlainText(sanitizedHtml);

  const initialCampaign: Record<string, unknown> = {
    campaignId: params.campaignId,
    name: params.name.slice(0, 160),
    department: params.department.slice(0, 64),
    audienceFilter: params.audienceFilter.slice(0, 120),
    recipientCount: params.recipients.length,
    sentCount: 0,
    failedCount: 0,
    subject: sanitizeHeaderValue(params.subject).slice(0, 240),
    bodyHtml: sanitizedHtml.slice(0, 32000),
    bodyText: plainText.slice(0, 16000),
    ...(params.attachments && params.attachments.length > 0
      ? { attachments: params.attachments.slice(0, 5) }
      : {}),
    status: isScheduled ? 'scheduled' : 'sending',
    ...(params.scheduledFor ? { scheduledFor: params.scheduledFor } : {}),
    ...(!isScheduled ? { startedAt: now } : {}),
    ...(params.templateId ? { templateId: params.templateId } : {}),
    createdByUid: params.admin.uid,
    createdByEmail: params.admin.email,
    createdAt: now,
    updatedAt: now,
  };

  await firestoreSetDoc('email_campaigns', params.campaignId, initialCampaign, params.admin.idToken);

  const logs: EmailLogEntry[] = [];
  let sentCount = 0;
  let failedCount = 0;

  if (isScheduled && params.scheduledFor) {
    for (const recipient of params.recipients) {
      const vars = {
        client_name: recipient.name,
        first_name: recipient.name.split(' ')[0] || recipient.name,
        last_name: recipient.name.split(' ').slice(1).join(' '),
        email: recipient.email,
        department: params.department,
        support_email: 'swastaskorg@gmail.com',
        current_date: new Date().toLocaleDateString('en-US', { dateStyle: 'medium' }),
        ...(recipient.vars || {}),
      };
      const log = await schedulePlatformEmail({
        toEmail: recipient.email,
        recipientName: recipient.name,
        recipientUid: recipient.uid,
        recipientType: recipient.recipientType || 'custom',
        subject: renderPersonalizedVars(params.subject, vars, false),
        bodyText: renderPersonalizedVars(plainText, vars, false),
        bodyHtml: renderPersonalizedVars(sanitizedHtml, vars, true),
        ctaLabel: params.ctaLabel,
        ctaUrl: params.ctaUrl,
        attachments: params.attachments,
        scheduledFor: params.scheduledFor,
        department: params.department,
        eventType: 'bulk_campaign',
        campaignId: params.campaignId,
        batchId: params.campaignId,
        triggeredByUid: params.admin.uid,
        triggeredByEmail: params.admin.email,
        idToken: params.admin.idToken,
      });
      logs.push(log);
    }
    return { campaign: initialCampaign, sentCount: 0, failedCount: 0, logs };
  }

  for (const recipient of params.recipients) {
    const vars = {
      client_name: recipient.name,
      first_name: recipient.name.split(' ')[0] || recipient.name,
      last_name: recipient.name.split(' ').slice(1).join(' '),
      email: recipient.email,
      department: params.department,
      support_email: 'swastaskorg@gmail.com',
      current_date: new Date().toLocaleDateString('en-US', { dateStyle: 'medium' }),
      ...(recipient.vars || {}),
    };

    const personalizedSubject = renderPersonalizedVars(params.subject, vars, false);
    const personalizedHtml = renderPersonalizedVars(sanitizedHtml, vars, true);
    const personalizedText = renderPersonalizedVars(plainText, vars, false);

    const { delivery, emailLog } = await sendPlatformEmail({
      toEmail: recipient.email,
      recipientName: recipient.name,
      recipientUid: recipient.uid,
      recipientType: recipient.recipientType || 'custom',
      subject: personalizedSubject,
      bodyText: personalizedText,
      bodyHtml: personalizedHtml,
      ctaLabel: params.ctaLabel,
      ctaUrl: params.ctaUrl,
      attachments: params.attachments,
      includeSignature: params.includeSignature,
      scope: 'control_centre',
      department: params.department,
      kind: 'bulk',
      eventType: 'bulk_campaign',
      campaignId: params.campaignId,
      batchId: params.campaignId,
      idempotencyKey: `cmp_${params.campaignId}_${recipient.email.toLowerCase()}`,
      triggeredByUid: params.admin.uid,
      triggeredByEmail: params.admin.email,
      idToken: params.admin.idToken,
      gmailAccessToken: params.gmailAccessToken,
      persistLog: true,
      skipDuplicateGuard: true,
    });

    if (emailLog) logs.push(emailLog);
    if (delivery.sent) sentCount += 1;
    else failedCount += 1;
  }

  const finalStatus =
    failedCount === 0
      ? 'completed'
      : sentCount > 0
      ? 'partially_failed'
      : 'failed';
  const finishedAt = new Date().toISOString();

  const updatedCampaign = await firestorePatchFields(
    'email_campaigns',
    params.campaignId,
    {
      sentCount,
      failedCount,
      status: finalStatus,
      completedAt: finishedAt,
      updatedAt: finishedAt,
    },
    params.admin.idToken
  );

  return { campaign: updatedCampaign, sentCount, failedCount, logs };
}

export function recordWebhookDeliveryEvent(event: WebhookBufferedEvent): void {
  if (!event.providerMessageId) return;
  bufferedWebhookEvents.set(event.providerMessageId, event);
}

export async function syncBufferedWebhookEvents(idToken: string): Promise<number> {
  if (bufferedWebhookEvents.size === 0) return 0;
  let updatedCount = 0;
  const entries = Array.from(bufferedWebhookEvents.entries());
  for (const [providerMessageId, evt] of entries) {
    try {
      const matched = await firestoreQueryByField(
        'email_logs',
        'providerMessageId',
        'EQUAL',
        providerMessageId,
        idToken,
        5
      );
      if (matched.length === 0) continue;
      for (const doc of matched) {
        const logId = String(doc.emailLogId || doc.id || '');
        if (!logId) continue;
        const patch: Record<string, unknown> = {
          updatedAt: new Date().toISOString(),
        };
        if (evt.status) patch.status = evt.status;
        if (evt.detail) patch.deliveryStatusDetail = evt.detail.slice(0, 800);
        if (evt.bounceReason) patch.bounceReason = evt.bounceReason.slice(0, 500);
        if (evt.deliveredAt) patch.deliveredAt = evt.deliveredAt;
        if (evt.openedAt) patch.openedAt = evt.openedAt;
        if (evt.clickedAt) patch.clickedAt = evt.clickedAt;
        await firestorePatchFields('email_logs', logId, patch, idToken);
        updatedCount += 1;
      }
      bufferedWebhookEvents.delete(providerMessageId);
    } catch {
      // keep buffered for next authorized sync
    }
  }
  return updatedCount;
}

export async function triggerAutomaticWorkflowEmail(params: {
  toEmail?: string;
  recipientName?: string;
  recipientUid?: string;
  recipientType?: 'user' | 'worker' | 'client' | 'admin';
  department: string;
  eventType: string;
  subject: string;
  title: string;
  greeting?: string;
  bodyText: string;
  ctaLabel?: string;
  ctaUrl?: string;
  sourceRecord: string;
  idempotencyKey: string;
  triggeredByUid: string;
  triggeredByEmail?: string;
  idToken: string;
  gmailAccessToken?: string;
}): Promise<void> {
  if (!params.toEmail || !params.toEmail.includes('@')) return;
  try {
    const cfg = await loadEmailConfigSettings(params.idToken);
    if (cfg.notificationRules[params.eventType] === false) {
      return;
    }
    await sendPlatformEmail({
      toEmail: params.toEmail,
      recipientName: params.recipientName,
      recipientUid: params.recipientUid,
      recipientType: params.recipientType,
      subject: params.subject,
      title: params.title,
      greeting: params.greeting,
      bodyText: params.bodyText,
      ctaLabel: params.ctaLabel,
      ctaUrl: params.ctaUrl,
      scope: params.department === 'api_management' || params.department === 'activity_logs' ? 'control_centre' : 'public_website',
      department: params.department,
      kind: 'automatic',
      eventType: params.eventType,
      sourceRecord: params.sourceRecord,
      idempotencyKey: params.idempotencyKey,
      triggeredByUid: params.triggeredByUid,
      triggeredByEmail: params.triggeredByEmail,
      idToken: params.idToken,
      gmailAccessToken: params.gmailAccessToken,
      persistLog: true,
      skipDuplicateGuard: false,
    });
  } catch (err) {
    console.error(`Workflow email failed (${params.eventType}):`, err);
  }
}

export async function sendInvitationEmail(params: {
  toEmail: string;
  fullName?: string;
  departmentLabel: string;
  departmentRole: string;
  inviteUrl: string;
  expiresAt: string;
  inviterName?: string;
  shareMessage?: string;
  emailRestricted?: boolean;
  triggeredByUid?: string;
  idToken?: string;
  gmailAccessToken?: string;
}): Promise<DeliveryResult> {
  const displayName = (params.fullName || 'Team Member').trim();
  const safeName = escapeHtml(displayName);
  const safeDept = escapeHtml(params.departmentLabel);
  const safeRole = escapeHtml(params.departmentRole);
  const safeEmail = escapeHtml(params.toEmail);
  const safeInviter = escapeHtml(params.inviterName || 'SWAS TASKS Administration');
  const safeExpiry = escapeHtml(new Date(params.expiresAt).toUTCString());
  const customNoteHtml = params.shareMessage?.trim()
    ? `<div style="margin:0 0 12px;padding:10px 12px;background:#F3F6FA;border-left:3px solid #1265C8;border-radius:4px;font-size:13px;color:#172B46;">${escapeHtml(
        params.shareMessage.trim()
      ).replace(/\n/g, '<br />')}</div>`
    : '';

  const bodyText = `Hello ${displayName},\n\nYou have been invited by ${
    params.inviterName || 'SWAS TASKS Administration'
  } to register for the ${params.departmentLabel} workplace as ${
    params.departmentRole
  }.\n\n${
    params.shareMessage?.trim() ? `${params.shareMessage.trim()}\n\n` : ''
  }Open your secure registration link: ${
    params.inviteUrl
  }\n\nNote: After completing registration and email verification, your account will await Super Administrator approval before workplace access is activated. Link expires on ${new Date(
    params.expiresAt
  ).toUTCString()}.`;

  const bodyHtml = `
    <p style="margin:0 0 12px;">You have been invited by <strong>${safeInviter}</strong> to register for the <strong>${safeDept}</strong> workplace as <strong>${safeRole}</strong>.</p>
    ${customNoteHtml}
    <p style="margin:0 0 12px;">${
      params.emailRestricted !== false
        ? `This private invitation link is bound to <strong>${safeEmail}</strong> and `
        : 'This private invitation link '
    }expires on <strong>${safeExpiry}</strong>.</p>
    <p style="margin:0 0 12px;font-size:13px;color:#172B46;">After completing registration, your staff account will enter <strong>Pending Verification</strong> until approved by the Super Administrator.</p>
    <p style="margin:0;font-size:12px;color:#75869D;">If you did not expect this invitation, please ignore this email or report it to swastaskorg@gmail.com.</p>
  `;

  const { delivery } = await sendPlatformEmail({
    toEmail: params.toEmail,
    recipientName: displayName,
    recipientType: 'admin',
    subject: `SWAS TASKS Control Centre Invitation – ${params.departmentLabel}`,
    title: 'Department Workplace Invitation',
    greeting: `Hello ${safeName},`,
    bodyText,
    bodyHtml,
    ctaLabel: 'Complete Staff Registration',
    ctaUrl: params.inviteUrl,
    scope: 'control_centre',
    department: 'user_management',
    kind: 'automatic',
    eventType: 'staff_invitation',
    triggeredByUid: params.triggeredByUid,
    idToken: params.idToken,
    gmailAccessToken: params.gmailAccessToken,
    persistLog: true,
    skipDuplicateGuard: true,
  });

  return delivery;
}

export async function sendStaffVerificationEmail(params: {
  stage: 'registered_pending' | 'admin_new_registration' | 'approved' | 'rejected';
  toEmail: string;
  staffName: string;
  staffEmail: string;
  departmentLabel: string;
  departmentRole: string;
  loginUrl?: string;
  rejectionReason?: string;
  triggeredByUid?: string;
  idToken?: string;
  gmailAccessToken?: string;
}): Promise<DeliveryResult> {
  const safeName = escapeHtml(params.staffName);
  const safeStaffEmail = escapeHtml(params.staffEmail);
  const safeDept = escapeHtml(params.departmentLabel);
  const safeRole = escapeHtml(params.departmentRole);

  let subject = '';
  let title = '';
  let greeting = `Hello ${safeName},`;
  let bodyText = '';
  let bodyHtml = '';
  let ctaLabel: string | undefined;
  let ctaUrl: string | undefined;

  if (params.stage === 'registered_pending') {
    subject = `SWAS TASKS Registration Received – Pending Super Admin Verification`;
    title = 'Registration Submitted for Verification';
    bodyText = `Hello ${params.staffName},\n\nYour staff account registration for ${params.departmentLabel} (${params.departmentRole}) has been received.\n\nYour account is currently Pending Super Administrator Verification. You will receive an email once your workplace access is approved.`;
    bodyHtml = `
      <p style="margin:0 0 12px;">Your staff account registration for <strong>${safeDept}</strong> (${safeRole}) has been received and verified.</p>
      <p style="margin:0 0 12px;">Your account status is currently <strong>Pending Super Administrator Verification</strong>. Access to departmental tools remains locked until approved by the Super Administrator.</p>
    `;
  } else if (params.stage === 'admin_new_registration') {
    subject = `Action Required: New Staff Verification Request (${params.staffName})`;
    title = 'New Staff Account Pending Verification';
    greeting = 'Hello Super Administrator,';
    bodyText = `A new staff member has completed invitation registration and requires your verification:\n\nName: ${params.staffName}\nEmail: ${params.staffEmail}\nDepartment: ${params.departmentLabel}\nRole: ${params.departmentRole}\n\nOpen Staff Management → Staff Verification in the Control Centre to approve or reject.`;
    bodyHtml = `
      <p style="margin:0 0 12px;">A new staff member has registered via an invitation link and awaits your verification:</p>
      <ul style="margin:0 0 12px;padding-left:18px;">
        <li><strong>Name:</strong> ${safeName}</li>
        <li><strong>Email:</strong> ${safeStaffEmail}</li>
        <li><strong>Department:</strong> ${safeDept}</li>
        <li><strong>Assigned Role:</strong> ${safeRole}</li>
      </ul>
      <p style="margin:0;">Review and verify this account in <strong>Staff Management → Staff Verification</strong>.</p>
    `;
    ctaLabel = params.loginUrl ? 'Review Pending Staff Account' : undefined;
    ctaUrl = params.loginUrl;
  } else if (params.stage === 'approved') {
    subject = `SWAS TASKS Account Approved – ${params.departmentLabel} Access Activated`;
    title = 'Staff Account Approved & Activated';
    bodyText = `Hello ${params.staffName},\n\nYour SWAS TASKS Control Centre staff account for ${params.departmentLabel} (${params.departmentRole}) has been verified and approved by the Super Administrator.\n\nYou may now sign in to your workplace: ${params.loginUrl || ''}`;
    bodyHtml = `
      <p style="margin:0 0 12px;">Your SWAS TASKS Control Centre staff account for <strong>${safeDept}</strong> (${safeRole}) has been verified and approved by the Super Administrator.</p>
      <p style="margin:0;">You may now sign in with your registered credentials to open your assigned departmental workplace.</p>
    `;
    ctaLabel = params.loginUrl ? 'Sign In to Control Centre' : undefined;
    ctaUrl = params.loginUrl;
  } else {
    const safeReason = escapeHtml(params.rejectionReason || 'Verification criteria were not met.');
    subject = `SWAS TASKS Staff Account Verification Update`;
    title = 'Staff Account Verification Declined';
    bodyText = `Hello ${params.staffName},\n\nYour staff account registration for ${params.departmentLabel} (${params.departmentRole}) was not approved by the Super Administrator.\n\nReason: ${
      params.rejectionReason || 'Verification criteria were not met.'
    }\n\nIf you believe this is an error, contact swastaskorg@gmail.com.`;
    bodyHtml = `
      <p style="margin:0 0 12px;">Your staff account registration for <strong>${safeDept}</strong> (${safeRole}) was declined during Super Administrator verification.</p>
      <p style="margin:0 0 12px;"><strong>Reason:</strong> ${safeReason}</p>
      <p style="margin:0;font-size:12px;color:#75869D;">For inquiries, contact swastaskorg@gmail.com.</p>
    `;
  }

  const { delivery } = await sendPlatformEmail({
    toEmail: params.toEmail,
    recipientName: params.stage === 'admin_new_registration' ? 'Super Administrator' : params.staffName,
    recipientType: 'admin',
    subject,
    title,
    greeting,
    bodyText,
    bodyHtml,
    ctaLabel,
    ctaUrl,
    scope: 'control_centre',
    department: 'user_management',
    kind: 'automatic',
    eventType: 'staff_registration',
    triggeredByUid: params.triggeredByUid,
    idToken: params.idToken,
    gmailAccessToken: params.gmailAccessToken,
    persistLog: true,
    skipDuplicateGuard: true,
  });

  return delivery;
}

export async function checkEmailDomainAuthentication(
  officialEmail = serverConfig.officialPlatformEmail
): Promise<DomainVerificationStatus> {
  const status = getMessagingStatus();
  const activeEmail =
    status.emailProviderType === 'gmail_smtp' && serverConfig.gmailSmtpUser
      ? serverConfig.gmailSmtpUser
      : status.emailProviderType === 'resend' && serverConfig.emailFrom
      ? serverConfig.emailFrom.replace(/.*<([^>]+)>.*/, '$1')
      : officialEmail;

  const domain = activeEmail.includes('@')
    ? activeEmail.split('@')[1].trim().toLowerCase()
    : 'gmail.com';

  let spfStatus: 'verified' | 'missing' | 'unknown' = 'unknown';
  let spfRecord = '';
  let dmarcStatus: 'verified' | 'missing' | 'unknown' = 'unknown';
  let dmarcRecord = '';

  try {
    const txtRecords = await dns.resolveTxt(domain);
    const flat = txtRecords.map((parts) => parts.join(''));
    const spf = flat.find((r) => r.toLowerCase().includes('v=spf1'));
    if (spf) {
      spfStatus = 'verified';
      spfRecord = spf;
    } else {
      spfStatus = 'missing';
    }
  } catch {
    spfStatus = 'unknown';
  }

  try {
    const dmarcTxt = await dns.resolveTxt(`_dmarc.${domain}`);
    const flatDmarc = dmarcTxt.map((parts) => parts.join(''));
    const dmarc = flatDmarc.find((r) => r.toLowerCase().includes('v=dmarc1'));
    if (dmarc) {
      dmarcStatus = 'verified';
      dmarcRecord = dmarc;
    } else {
      dmarcStatus = 'missing';
    }
  } catch {
    dmarcStatus = 'unknown';
  }

  const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';
  return {
    officialEmail: officialEmail || 'swastaskorg@gmail.com',
    domain,
    providerConnected: status.emailConfigured,
    providerType: status.emailProviderType,
    providerName: status.emailProvider,
    spfStatus,
    spfRecord,
    dmarcStatus,
    dmarcRecord,
    dkimStatus: isGmail ? 'managed_by_gmail' : 'selector_required',
    dkimNote: isGmail
      ? 'DKIM signing for @gmail.com is managed by Google when sending authenticated via Gmail SMTP with App Password / Google Workspace.'
      : `Verify your provider DKIM selector CNAME/TXT records on ${domain} before switching production traffic.`,
    checkedAt: new Date().toISOString(),
  };
}

export async function sendPhoneOtpSms(params: {
  phone: string;
  code: string;
}): Promise<{ sent: boolean; status: EmailDeliveryStatus; detail: string }> {
  const status = getMessagingStatus();
  if (!status.smsConfigured) {
    return {
      sent: false,
      status: 'not_configured',
      detail:
        'SMS verification service is Not Configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in server secrets).',
    };
  }

  try {
    const auth = Buffer.from(
      `${serverConfig.twilioAccountSid}:${serverConfig.twilioAuthToken}`
    ).toString('base64');
    const body = new URLSearchParams({
      To: params.phone,
      From: serverConfig.twilioFromNumber,
      Body: `SWAS TASKS Control Centre verification code: ${params.code}. Expires in 10 minutes.`,
    });

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
        serverConfig.twilioAccountSid
      )}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return {
        sent: false,
        status: 'failed',
        detail: `SMS provider returned ${response.status}: ${errText}`,
      };
    }

    return {
      sent: true,
      status: 'sent',
      detail: `Verification code sent via SMS to ${params.phone}.`,
    };
  } catch (err) {
    return {
      sent: false,
      status: 'failed',
      detail: err instanceof Error ? err.message : 'SMS delivery failed',
    };
  }
}

export async function retryCampaignFailedEmails(params: {
  campaignId: string;
  gmailAccessToken?: string;
  admin: { uid: string; email: string; idToken: string };
}): Promise<{ retried: number; sent: number; failed: number }> {
  const logs = await firestoreQueryByField(
    'email_logs',
    'campaignId',
    'EQUAL',
    params.campaignId,
    params.admin.idToken,
    500
  );
  const failedLogs = logs.filter(
    (l) =>
      l.status === 'failed' ||
      l.status === 'not_configured' ||
      l.status === 'bounced' ||
      l.status === 'rejected'
  );

  let retried = 0;
  let sent = 0;
  let failed = 0;

  for (const log of failedLogs) {
    const logId = String(log.emailLogId || log.id || '');
    if (!logId) continue;

    const { delivery } = await sendPlatformEmail({
      toEmail: String(log.recipientEmail || ''),
      recipientName: typeof log.recipientName === 'string' ? log.recipientName : undefined,
      subject: String(log.subject || 'SWAS TASKS Notification'),
      bodyText: String(log.bodyPreview || ''),
      bodyHtml: typeof log.htmlBody === 'string' ? log.htmlBody : undefined,
      attachments: Array.isArray(log.attachments)
        ? (log.attachments as EmailAttachmentInput[])
        : undefined,
      scope: 'control_centre',
      department: typeof log.department === 'string' ? log.department : 'platform_settings',
      kind: 'bulk',
      eventType: String(log.eventType || 'bulk_campaign'),
      campaignId: params.campaignId,
      triggeredByUid: params.admin.uid,
      triggeredByEmail: params.admin.email,
      idToken: params.admin.idToken,
      gmailAccessToken: params.gmailAccessToken,
      persistLog: false,
      skipDuplicateGuard: true,
    });

    await firestorePatchFields(
      'email_logs',
      logId,
      {
        status: delivery.status,
        provider: delivery.provider.slice(0, 80),
        providerMessageId: (delivery.providerMessageId || '').slice(0, 160),
        deliveryStatusDetail: delivery.detail.slice(0, 800),
        errorDetail: delivery.sent ? '' : delivery.detail.slice(0, 800),
        retryCount: Number(log.retryCount || 0) + 1,
        ...(delivery.sentAt ? { sentAt: delivery.sentAt } : {}),
        updatedAt: new Date().toISOString(),
      },
      params.admin.idToken
    );

    retried += 1;
    if (delivery.sent) sent += 1;
    else failed += 1;
  }

  if (retried > 0) {
    const campaignDoc = await firestoreGetDoc('email_campaigns', params.campaignId, params.admin.idToken);
    if (campaignDoc) {
      const prevSent = Number(campaignDoc.sentCount || 0);
      const nextSent = prevSent + sent;
      const total = Number(campaignDoc.recipientCount || nextSent + failed);
      const nextFailed = Math.max(0, total - nextSent);
      await firestorePatchFields(
        'email_campaigns',
        params.campaignId,
        {
          sentCount: nextSent,
          failedCount: nextFailed,
          status: nextFailed === 0 ? 'completed' : nextSent > 0 ? 'partially_failed' : 'failed',
          updatedAt: new Date().toISOString(),
        },
        params.admin.idToken
      );
    }
  }

  return { retried, sent, failed };
}

export { firestoreListCollection };
