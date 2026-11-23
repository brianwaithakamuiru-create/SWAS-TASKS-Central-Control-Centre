import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as FirebaseAppletConfig;
}

export const firebaseConfig = loadFirebaseConfig();

const fallbackHmacSecret = crypto.randomBytes(32).toString('hex');
const fallbackInviteSecret = crypto.randomBytes(32).toString('hex');

export const serverConfig = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  publicWebsiteUrl: process.env.PUBLIC_WEBSITE_URL || '',
  allowedOriginsRaw: process.env.ALLOWED_ORIGINS || '',
  apiKeyHmacSecret: process.env.API_KEY_HMAC_SECRET || fallbackHmacSecret,
  invitationSigningSecret: process.env.INVITATION_SIGNING_SECRET || fallbackInviteSecret,
  bootstrapSuperAdminEmail: (
    process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'brianwaithakamuiru@gmail.com'
  ).toLowerCase(),
  officialPlatformEmail: (
    process.env.OFFICIAL_PLATFORM_EMAIL || 'swastaskorg@gmail.com'
  )
    .trim()
    .toLowerCase(),
  emailSenderName: (process.env.EMAIL_SENDER_NAME || 'SWAS TASKS').trim(),
  emailReplyTo: (
    process.env.EMAIL_REPLY_TO ||
    process.env.OFFICIAL_PLATFORM_EMAIL ||
    'swastaskorg@gmail.com'
  )
    .trim()
    .toLowerCase(),
  gmailSmtpUser: (process.env.GMAIL_SMTP_USER || '').trim(),
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || '',
  smtpHost: (process.env.SMTP_HOST || '').trim(),
  smtpPort: Number(process.env.SMTP_PORT || 465),
  smtpUser: (process.env.SMTP_USER || '').trim(),
  smtpPass: process.env.SMTP_PASS || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: (process.env.EMAIL_FROM || '').trim(),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
  mpesaEnv: process.env.MPESA_ENV || 'sandbox',
  mpesaConsumerKey: process.env.MPESA_CONSUMER_KEY || '',
  mpesaConsumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
  mpesaShortcode: process.env.MPESA_SHORTCODE || '',
  mpesaPasskey: process.env.MPESA_PASSKEY || '',
  mpesaCallbackUrl: process.env.MPESA_CALLBACK_URL || '',
};

export function getPaymentGatewayStatus(): {
  mpesaConfigured: boolean;
  mpesaEnvironment: string;
  mpesaProvider: string;
  currency: string;
} {
  const mpesaConfigured = Boolean(
    serverConfig.mpesaConsumerKey &&
      serverConfig.mpesaConsumerSecret &&
      serverConfig.mpesaShortcode &&
      serverConfig.mpesaPasskey
  );
  return {
    mpesaConfigured,
    mpesaEnvironment: serverConfig.mpesaEnv,
    mpesaProvider: mpesaConfigured ? 'Safaricom M-Pesa Daraja API' : 'Not Configured',
    currency: 'KES',
  };
}

export function getMessagingStatus(): {
  emailConfigured: boolean;
  emailProvider: string;
  emailProviderType: 'gmail_smtp' | 'smtp' | 'resend' | 'none';
  emailStatusLabel: string;
  officialEmail: string;
  senderDisplayName: string;
  replyToEmail: string;
  smsConfigured: boolean;
  smsProvider: string;
} {
  const gmailConfigured = Boolean(serverConfig.gmailSmtpUser && serverConfig.gmailAppPassword);
  const smtpConfigured = Boolean(
    serverConfig.smtpHost && serverConfig.smtpUser && serverConfig.smtpPass
  );
  const resendConfigured = Boolean(serverConfig.resendApiKey);

  const emailConfigured = gmailConfigured || smtpConfigured || resendConfigured;
  const emailProviderType: 'gmail_smtp' | 'smtp' | 'resend' | 'none' = gmailConfigured
    ? 'gmail_smtp'
    : smtpConfigured
    ? 'smtp'
    : resendConfigured
    ? 'resend'
    : 'none';

  const emailProvider =
    emailProviderType === 'gmail_smtp'
      ? 'Gmail SMTP (TLS)'
      : emailProviderType === 'smtp'
      ? `Custom SMTP (${serverConfig.smtpHost})`
      : emailProviderType === 'resend'
      ? 'Resend HTTPS API'
      : 'EMAIL SERVICE NOT CONFIGURED';

  const smsConfigured = Boolean(
    serverConfig.twilioAccountSid &&
      serverConfig.twilioAuthToken &&
      serverConfig.twilioFromNumber
  );
  return {
    emailConfigured,
    emailProvider,
    emailProviderType,
    emailStatusLabel: emailConfigured ? 'Connected' : 'EMAIL SERVICE NOT CONFIGURED',
    officialEmail: serverConfig.officialPlatformEmail,
    senderDisplayName: serverConfig.emailSenderName,
    replyToEmail: serverConfig.emailReplyTo,
    smsConfigured,
    smsProvider: smsConfigured ? 'Twilio SMS API' : 'Not Configured',
  };
}

export function getAllowedOrigins(): string[] {
  const origins = new Set<string>([
    'http://localhost:3000',
    'https://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  if (serverConfig.appUrl && serverConfig.appUrl !== 'MY_APP_URL') {
    try {
      origins.add(new URL(serverConfig.appUrl).origin);
    } catch {
      // ignore invalid placeholder
    }
  }
  if (serverConfig.publicWebsiteUrl) {
    try {
      origins.add(new URL(serverConfig.publicWebsiteUrl).origin);
    } catch {
      // ignore invalid URL
    }
  }
  if (serverConfig.allowedOriginsRaw) {
    for (const part of serverConfig.allowedOriginsRaw.split(',')) {
      const trimmed = part.trim();
      if (trimmed) {
        origins.add(trimmed);
      }
    }
  }
  return Array.from(origins);
}
