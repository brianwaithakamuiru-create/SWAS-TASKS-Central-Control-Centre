import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import nodemailer from 'nodemailer';
import { getMessagingStatus, serverConfig } from '../config.ts';
import { firestoreGetDoc, firestoreSetDoc } from '../firestoreRest.ts';

export type EmailDeliveryStatus = 'sent' | 'not_configured' | 'failed';
export type EmailScope = 'public_website' | 'control_centre';

export interface DeliveryResult {
  sent: boolean;
  status: EmailDeliveryStatus;
  provider: string;
  providerMessageId?: string;
  fromAddress: string;
  replyToAddress: string;
  detail: string;
}

export interface EmailLogEntry {
  emailLogId: string;
  scope: EmailScope;
  eventType: string;
  recipientEmail: string;
  subject: string;
  bodyPreview: string;
  fromAddress: string;
  replyToAddress: string;
  provider: string;
  providerMessageId: string;
  status: EmailDeliveryStatus;
  errorDetail: string;
  retryCount: number;
  triggeredByUid: string;
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

function escapeHtml(raw: string): string {
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

export function buildSwasBrandedHtml(params: {
  title: string;
  greeting?: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  replyToEmail: string;
  officialEmail: string;
  senderDisplayName: string;
}): string {
  const safeTitle = escapeHtml(params.title);
  const safeSender = escapeHtml(params.senderDisplayName);
  const safeOfficial = escapeHtml(params.officialEmail);
  const safeReplyTo = escapeHtml(params.replyToEmail);
  const greetingBlock = params.greeting
    ? `<p style="margin:0 0 14px;font-size:14px;color:#172B46;">${escapeHtml(params.greeting)}</p>`
    : '';
  const ctaBlock =
    params.ctaLabel && params.ctaUrl
      ? `<p style="margin:24px 0;"><a href="${escapeHtml(
          params.ctaUrl
        )}" style="display:inline-block;background:#1265C8;color:#FFFFFF;padding:12px 22px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(
          params.ctaLabel
        )}</a></p>`
      : '';

  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#F3F6FA;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#172B46;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
    <tr>
      <td style="background:#102B50;padding:20px 24px;">
        <p style="margin:0;font-family:Poppins,Inter,sans-serif;font-size:18px;font-weight:600;color:#FFFFFF;letter-spacing:-0.01em;">
          ${safeSender}
        </p>
        <p style="margin:4px 0 0;font-size:12px;color:#BFDBFE;">
          Official Platform Communications · ${safeOfficial}
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <h2 style="margin:0 0 16px;font-family:Poppins,Inter,sans-serif;font-size:20px;font-weight:600;color:#102B50;">
          ${safeTitle}
        </h2>
        ${greetingBlock}
        <div style="font-size:14px;line-height:1.6;color:#172B46;">
          ${params.bodyHtml}
        </div>
        ${ctaBlock}
      </td>
    </tr>
    <tr>
      <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:16px 24px;font-size:12px;color:#75869D;line-height:1.5;">
        Sent by <strong>${safeSender}</strong> (${safeOfficial}).<br />
        Replies are routed to <a href="mailto:${safeReplyTo}" style="color:#1265C8;text-decoration:none;">${safeReplyTo}</a>.
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function loadEmailConfigSettings(idToken?: string): Promise<{
  senderDisplayName: string;
  officialEmail: string;
  replyToEmail: string;
  notificationRules: Record<string, boolean>;
  templates: Record<string, { subject?: string; body?: string }>;
}> {
  const defaults = {
    senderDisplayName: serverConfig.emailSenderName || 'SWAS TASKS',
    officialEmail: serverConfig.officialPlatformEmail || 'swastaskorg@gmail.com',
    replyToEmail: serverConfig.emailReplyTo || 'swastaskorg@gmail.com',
    notificationRules: {} as Record<string, boolean>,
    templates: {} as Record<string, { subject?: string; body?: string }>,
  };

  try {
    const doc = await firestoreGetDoc('platform_settings', 'email_configuration', idToken);
    if (!doc) return defaults;
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
}> {
  const cfg = await loadEmailConfigSettings(idToken);
  return {
    platformName: 'SWAS TASKS',
    officialEmail: cfg.officialEmail,
    senderDisplayName: cfg.senderDisplayName,
    replyToEmail: cfg.replyToEmail,
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
  scope: EmailScope;
  eventType: string;
  triggeredByUid?: string;
  idToken?: string;
  persistLog?: boolean;
}): Promise<{ delivery: DeliveryResult; emailLog: EmailLogEntry | null }> {
  const status = getMessagingStatus();
  const cfg = await loadEmailConfigSettings(params.idToken);

  const safeSenderName = sanitizeHeaderValue(cfg.senderDisplayName || 'SWAS TASKS');
  const officialEmail = sanitizeHeaderValue(cfg.officialEmail || 'swastaskorg@gmail.com');
  const replyToEmail = sanitizeHeaderValue(cfg.replyToEmail || officialEmail);

  const rawFromEmail =
    status.emailProviderType === 'gmail_smtp'
      ? serverConfig.gmailSmtpUser || officialEmail
      : status.emailProviderType === 'smtp'
      ? serverConfig.smtpUser || officialEmail
      : serverConfig.emailFrom || officialEmail;

  const formattedFrom = rawFromEmail.includes('<')
    ? rawFromEmail
    : `${safeSenderName} <${rawFromEmail}>`;

  // Apply saved template override if present and caller did not force custom subject/body
  const templateOverride = cfg.templates[params.eventType];
  const effectiveSubject = sanitizeHeaderValue(
    params.subject || templateOverride?.subject || 'SWAS TASKS Notification'
  );
  const effectiveBodyText = params.bodyText || templateOverride?.body || '';

  const html = buildSwasBrandedHtml({
    title: params.title || effectiveSubject,
    greeting: params.greeting,
    bodyHtml:
      params.bodyHtml ||
      `<p style="margin:0;">${escapeHtml(effectiveBodyText).replace(/\n/g, '<br />')}</p>`,
    ctaLabel: params.ctaLabel,
    ctaUrl: params.ctaUrl,
    replyToEmail,
    officialEmail,
    senderDisplayName: safeSenderName,
  });

  let delivery: DeliveryResult;

  if (!status.emailConfigured) {
    delivery = {
      sent: false,
      status: 'not_configured',
      provider: 'EMAIL SERVICE NOT CONFIGURED',
      fromAddress: formattedFrom,
      replyToAddress: replyToEmail,
      detail:
        'EMAIL SERVICE NOT CONFIGURED: Set server-side Gmail SMTP (GMAIL_SMTP_USER & GMAIL_APP_PASSWORD), SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS), or Resend (RESEND_API_KEY) credentials in backend environment variables.',
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

      const safeToEmail = sanitizeHeaderValue(params.toEmail);
      const info = await transporter.sendMail({
        from: formattedFrom,
        to: safeToEmail,
        replyTo: `${safeSenderName} <${replyToEmail}>`,
        subject: effectiveSubject,
        text: `${effectiveBodyText}\n\n---\n${safeSenderName} · ${officialEmail}\nReply-To: ${replyToEmail}`,
        html,
      });

      if (!info.messageId) {
        delivery = {
          sent: false,
          status: 'failed',
          provider: status.emailProvider,
          fromAddress: formattedFrom,
          replyToAddress: replyToEmail,
          detail: 'Email provider did not confirm a messageId after submission.',
        };
      } else {
        delivery = {
          sent: true,
          status: 'sent',
          provider: status.emailProvider,
          providerMessageId: info.messageId,
          fromAddress: formattedFrom,
          replyToAddress: replyToEmail,
          detail: `Email delivered via ${status.emailProvider} to ${params.toEmail.trim()} (Message ID: ${info.messageId}).`,
        };
      }
    } catch (err) {
      delivery = {
        sent: false,
        status: 'failed',
        provider: status.emailProvider,
        fromAddress: formattedFrom,
        replyToAddress: replyToEmail,
        detail: err instanceof Error ? err.message : 'SMTP email delivery failed.',
      };
    }
  } else {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serverConfig.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: formattedFrom,
          to: [sanitizeHeaderValue(params.toEmail)],
          reply_to: replyToEmail,
          subject: effectiveSubject,
          html,
          text: effectiveBodyText,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        delivery = {
          sent: false,
          status: 'failed',
          provider: status.emailProvider,
          fromAddress: formattedFrom,
          replyToAddress: replyToEmail,
          detail: `Email provider returned ${response.status}: ${errText}`,
        };
      } else {
        const resJson = (await response.json().catch(() => ({}))) as { id?: string };
        delivery = {
          sent: true,
          status: 'sent',
          provider: status.emailProvider,
          providerMessageId: resJson.id || `resend_${Date.now()}`,
          fromAddress: formattedFrom,
          replyToAddress: replyToEmail,
          detail: `Email submitted via Resend HTTPS API to ${params.toEmail.trim()}.`,
        };
      }
    } catch (err) {
      delivery = {
        sent: false,
        status: 'failed',
        provider: status.emailProvider,
        fromAddress: formattedFrom,
        replyToAddress: replyToEmail,
        detail: err instanceof Error ? err.message : 'Email provider request failed.',
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
      eventType: params.eventType.slice(0, 64),
      recipientEmail: params.toEmail.trim().slice(0, 254),
      subject: effectiveSubject.slice(0, 240),
      bodyPreview: effectiveBodyText.slice(0, 1000),
      fromAddress: formattedFrom.slice(0, 254),
      replyToAddress: replyToEmail.slice(0, 254),
      provider: delivery.provider.slice(0, 80),
      providerMessageId: (delivery.providerMessageId || '').slice(0, 160),
      status: delivery.status,
      errorDetail: delivery.sent ? '' : delivery.detail.slice(0, 800),
      retryCount: 0,
      triggeredByUid: (params.triggeredByUid || 'system').slice(0, 128),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await firestoreSetDoc('email_logs', emailLogId, record as unknown as Record<string, unknown>, params.idToken);
      emailLog = record;
    } catch (err) {
      console.error('Failed to persist email log:', err);
    }
  }

  return { delivery, emailLog };
}

export async function sendInvitationEmail(params: {
  toEmail: string;
  fullName: string;
  departmentLabel: string;
  departmentRole: string;
  inviteUrl: string;
  expiresAt: string;
  triggeredByUid?: string;
  idToken?: string;
}): Promise<DeliveryResult> {
  const safeName = escapeHtml(params.fullName);
  const safeDept = escapeHtml(params.departmentLabel);
  const safeRole = escapeHtml(params.departmentRole);
  const safeEmail = escapeHtml(params.toEmail);
  const safeExpiry = escapeHtml(new Date(params.expiresAt).toUTCString());

  const bodyText = `Hello ${params.fullName},\n\nYou have been invited by the Super Administrator to join the ${params.departmentLabel} department workplace as ${params.departmentRole}.\n\nThis private registration link is single-use, tied to ${params.toEmail}, and expires on ${new Date(params.expiresAt).toUTCString()}.\n\nOpen your link to register: ${params.inviteUrl}`;

  const bodyHtml = `
    <p style="margin:0 0 12px;">You have been invited by the Super Administrator to join the <strong>${safeDept}</strong> department workplace as <strong>${safeRole}</strong>.</p>
    <p style="margin:0 0 12px;">This private registration link is single-use, strictly bound to <strong>${safeEmail}</strong>, and expires on <strong>${safeExpiry}</strong>.</p>
    <p style="margin:0;font-size:12px;color:#75869D;">If you did not expect this invitation, please ignore this email or report it to swastaskorg@gmail.com.</p>
  `;

  const { delivery } = await sendPlatformEmail({
    toEmail: params.toEmail,
    subject: `SWAS TASKS Control Centre Invitation – ${params.departmentLabel}`,
    title: 'Department Workplace Invitation',
    greeting: `Hello ${params.fullName},`,
    bodyText,
    bodyHtml,
    ctaLabel: 'Complete Staff Registration',
    ctaUrl: params.inviteUrl,
    scope: 'control_centre',
    eventType: 'staff_invitation',
    triggeredByUid: params.triggeredByUid,
    idToken: params.idToken,
    persistLog: true,
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
