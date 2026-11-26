import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  LogOut,
  Mail,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  ALL_EMAIL_NOTIFICATION_TYPES,
  CONTROL_CENTRE_EMAIL_NOTIFICATION_TYPES,
  OFFICIAL_PLATFORM_EMAIL,
  OFFICIAL_REPLY_TO_EMAIL,
  OFFICIAL_SENDER_DISPLAY_NAME,
  PUBLIC_EMAIL_NOTIFICATION_TYPES,
  type EmailScope,
} from '../../config/platformIdentity';
import { apiFetch, savePlatformSettingsSection } from '../../services/firestoreService';
import {
  connectOfficialGmailAccount,
  disconnectOfficialGmailAccount,
  useGmailConnection,
  verifyGmailConnectionWithBackend,
} from '../../services/gmailOAuth';
import type {
  AdminUser,
  EmailLogRecord,
  EmailVerificationStatus,
  MessagingStatus,
  PlatformSetting,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { TablePagination, usePaginatedList } from '../common/TablePagination';

interface CentralEmailSettingsPanelProps {
  adminProfile: AdminUser | null;
  canEdit: boolean;
  settingsDocs: PlatformSetting[];
  emailLogs: EmailLogRecord[];
}

interface EmailStatusApiResponse {
  messaging: MessagingStatus;
  senderIdentity: {
    platformName: string;
    officialEmail: string;
    senderDisplayName: string;
    replyToEmail: string;
  };
  verification: EmailVerificationStatus;
}

export function CentralEmailSettingsPanel({
  adminProfile,
  canEdit,
  settingsDocs,
  emailLogs,
}: CentralEmailSettingsPanelProps) {
  const emailSettingsDoc = settingsDocs.find((d) => d.sectionId === 'email_configuration');

  const [senderDisplayName, setSenderDisplayName] = useState(OFFICIAL_SENDER_DISPLAY_NAME);
  const [replyToEmail, setReplyToEmail] = useState(OFFICIAL_REPLY_TO_EMAIL);
  const [signatureHtml, setSignatureHtml] = useState(
    '<p>Regards,<br/><strong>SWAS TASKS Organization</strong><br/>swastaskorg@gmail.com</p>'
  );
  const [footerText, setFooterText] = useState(
    'Sent via SWAS TASKS Central Control Centre · Official Support: swastaskorg@gmail.com'
  );
  const [hourlyLimit, setHourlyLimit] = useState(120);
  const [dailyLimit, setDailyLimit] = useState(1000);
  const [notificationRules, setNotificationRules] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const def of ALL_EMAIL_NOTIFICATION_TYPES) {
      init[def.id] = def.defaultEnabled;
    }
    return init;
  });
  const [templates, setTemplates] = useState<Record<string, { subject: string; body: string }>>(() => {
    const init: Record<string, { subject: string; body: string }> = {};
    for (const def of ALL_EMAIL_NOTIFICATION_TYPES) {
      init[def.id] = { subject: def.defaultSubject, body: def.defaultBody };
    }
    return init;
  });

  const [templateScopeTab, setTemplateScopeTab] = useState<EmailScope>('public_website');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    PUBLIC_EMAIL_NOTIFICATION_TYPES[0].id
  );

  // Live backend status & verification
  const [statusData, setStatusData] = useState<EmailStatusApiResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // Test email state
  const [testRecipient, setTestRecipient] = useState(adminProfile?.email || '');
  const [testSubject, setTestSubject] = useState(
    'SWAS TASKS – Official Email Configuration Verification Test'
  );
  const [testMessage, setTestMessage] = useState(
    'Verifying official SWAS TASKS email delivery from swastaskorg@gmail.com.'
  );
  const [sendingTest, setSendingTest] = useState(false);
  const [confirmTestOpen, setConfirmTestOpen] = useState(false);

  // Gmail OAuth connector state
  const gmailConn = useGmailConnection();
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  // Delivery logs & failed records filter
  const [logFilter, setLogFilter] = useState<'all' | 'sent' | 'failed'>('all');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(
    null
  );

  useEffect(() => {
    if (adminProfile?.email && !testRecipient) {
      setTestRecipient(adminProfile.email);
    }
  }, [adminProfile?.email, testRecipient]);

  useEffect(() => {
    if (!emailSettingsDoc) return;
    const cfg =
      emailSettingsDoc.config && typeof emailSettingsDoc.config === 'object'
        ? (emailSettingsDoc.config as Record<string, unknown>)
        : {};

    if (typeof emailSettingsDoc.senderDisplayName === 'string' && emailSettingsDoc.senderDisplayName) {
      setSenderDisplayName(emailSettingsDoc.senderDisplayName);
    } else if (typeof cfg.senderName === 'string' && cfg.senderName) {
      setSenderDisplayName(cfg.senderName);
    }

    if (typeof emailSettingsDoc.replyToEmail === 'string' && emailSettingsDoc.replyToEmail) {
      setReplyToEmail(emailSettingsDoc.replyToEmail);
    } else if (typeof cfg.replyToEmail === 'string' && cfg.replyToEmail) {
      setReplyToEmail(cfg.replyToEmail);
    } else if (typeof cfg.senderEmail === 'string' && cfg.senderEmail) {
      setReplyToEmail(cfg.senderEmail);
    }

    if (typeof cfg.signatureHtml === 'string' && cfg.signatureHtml) {
      setSignatureHtml(cfg.signatureHtml);
    }
    if (typeof cfg.footerText === 'string' && cfg.footerText) {
      setFooterText(cfg.footerText);
    }
    if (typeof cfg.hourlyLimit === 'number' && cfg.hourlyLimit > 0) {
      setHourlyLimit(cfg.hourlyLimit);
    }
    if (typeof cfg.dailyLimit === 'number' && cfg.dailyLimit > 0) {
      setDailyLimit(cfg.dailyLimit);
    }

    if (cfg.notificationRules && typeof cfg.notificationRules === 'object') {
      const savedRules = cfg.notificationRules as Record<string, boolean>;
      setNotificationRules((prev) => ({ ...prev, ...savedRules }));
    }

    if (cfg.templates && typeof cfg.templates === 'object') {
      const savedTpl = cfg.templates as Record<string, { subject?: string; body?: string }>;
      setTemplates((prev) => {
        const next = { ...prev };
        for (const def of ALL_EMAIL_NOTIFICATION_TYPES) {
          const override = savedTpl[def.id];
          if (override) {
            next[def.id] = {
              subject: override.subject || def.defaultSubject,
              body: override.body || def.defaultBody,
            };
          }
        }
        return next;
      });
    }
  }, [emailSettingsDoc]);

  const fetchEmailStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await apiFetch<EmailStatusApiResponse>('/api/v1/admin/email/status');
      setStatusData(res);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to check email service status.',
      });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void fetchEmailStatus();
  }, [fetchEmailStatus]);

  useEffect(() => {
    setSelectedTemplateId(
      templateScopeTab === 'public_website'
        ? PUBLIC_EMAIL_NOTIFICATION_TYPES[0].id
        : CONTROL_CENTRE_EMAIL_NOTIFICATION_TYPES[0].id
    );
  }, [templateScopeTab]);

  const handleSaveAllEmailSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminProfile) return;
    setSavingSettings(true);
    setFeedback(null);
    try {
      await savePlatformSettingsSection(adminProfile, 'email_configuration', {
        officialEmail: OFFICIAL_PLATFORM_EMAIL,
        senderDisplayName: senderDisplayName.trim() || OFFICIAL_SENDER_DISPLAY_NAME,
        replyToEmail: replyToEmail.trim().toLowerCase() || OFFICIAL_REPLY_TO_EMAIL,
        config: {
          senderName: senderDisplayName.trim() || OFFICIAL_SENDER_DISPLAY_NAME,
          senderEmail: replyToEmail.trim().toLowerCase() || OFFICIAL_REPLY_TO_EMAIL,
          replyToEmail: replyToEmail.trim().toLowerCase() || OFFICIAL_REPLY_TO_EMAIL,
          officialEmail: OFFICIAL_PLATFORM_EMAIL,
          signatureHtml: signatureHtml.trim(),
          footerText: footerText.trim(),
          hourlyLimit: Math.max(10, Number(hourlyLimit) || 120),
          dailyLimit: Math.max(50, Number(dailyLimit) || 1000),
          notificationRules,
          templates,
        },
      });
      setFeedback({
        type: 'ok',
        text: 'Official email sender identity, notification routing rules, and templates saved to Firestore.',
      });
      void fetchEmailStatus();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save email settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleConnectGmail = async () => {
    setConnectingGmail(true);
    setFeedback(null);
    try {
      const snap = await connectOfficialGmailAccount();
      if (snap.connected) {
        setFeedback({
          type: 'ok',
          text: `Official Gmail account (${snap.connectedEmail || OFFICIAL_PLATFORM_EMAIL}) connected and authorized for sending.`,
        });
      } else {
        setFeedback({
          type: 'err',
          text: snap.lastError || `Google authorization completed, but account did not match ${OFFICIAL_PLATFORM_EMAIL}.`,
        });
      }
      void fetchEmailStatus();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to connect official Gmail account.',
      });
    } finally {
      setConnectingGmail(false);
    }
  };

  const handleCheckGmailAuth = async () => {
    setFeedback(null);
    try {
      const res = await verifyGmailConnectionWithBackend();
      if (res.authorized && res.matchesOfficialEmail && res.hasGmailSendScope) {
        setFeedback({
          type: 'ok',
          text: `Verified live Gmail OAuth authorization for ${res.connectedEmail} with gmail.send permission.`,
        });
      } else {
        setFeedback({
          type: res.smtpConfigured ? 'warn' : 'err',
          text:
            res.error ||
            (res.smtpConfigured
              ? `No browser Gmail OAuth session active; backend ${res.smtpProvider} is configured.`
              : `Gmail OAuth is not yet authorized for ${OFFICIAL_PLATFORM_EMAIL}.`),
        });
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gmail authorization check failed.',
      });
    }
  };

  const handleConfirmSendTestEmail = async () => {
    if (!testRecipient.trim()) return;
    setSendingTest(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{
        delivery: { sent: boolean; status: string; detail: string; error?: string };
      }>('/api/v1/admin/email/test', {
        method: 'POST',
        body: JSON.stringify({
          recipientEmail: testRecipient.trim(),
          subject: testSubject.trim(),
          message: testMessage.trim(),
        }),
      });
      if (res.delivery.sent) {
        setFeedback({ type: 'ok', text: res.delivery.detail });
      } else if (res.delivery.status === 'not_configured') {
        setFeedback({ type: 'warn', text: res.delivery.error || res.delivery.detail });
      } else {
        setFeedback({ type: 'err', text: res.delivery.error || res.delivery.detail });
      }
      setConfirmTestOpen(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Test email request failed.',
      });
      setConfirmTestOpen(false);
    } finally {
      setSendingTest(false);
    }
  };

  const handleSendTestEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testRecipient.trim()) return;
    setConfirmTestOpen(true);
  };

  const handleRetryEmail = async (emailLogId: string) => {
    setRetryingId(emailLogId);
    setFeedback(null);
    try {
      const res = await apiFetch<{
        delivery: { sent: boolean; status: string; detail: string };
      }>(`/api/v1/admin/email/logs/${emailLogId}/retry`, {
        method: 'POST',
      });
      if (res.delivery.sent) {
        setFeedback({ type: 'ok', text: res.delivery.detail });
      } else if (res.delivery.status === 'not_configured') {
        setFeedback({ type: 'warn', text: res.delivery.detail });
      } else {
        setFeedback({ type: 'err', text: res.delivery.detail });
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Email retry failed.',
      });
    } finally {
      setRetryingId(null);
    }
  };

  const sortedLogs = useMemo(
    () =>
      [...emailLogs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [emailLogs]
  );

  const sentCount = useMemo(
    () => sortedLogs.filter((l) => l.status === 'sent').length,
    [sortedLogs]
  );
  const failedCount = useMemo(
    () => sortedLogs.filter((l) => l.status === 'failed' || l.status === 'not_configured').length,
    [sortedLogs]
  );

  const filteredLogs = useMemo(() => {
    if (logFilter === 'sent') return sortedLogs.filter((l) => l.status === 'sent');
    if (logFilter === 'failed') {
      return sortedLogs.filter((l) => l.status === 'failed' || l.status === 'not_configured');
    }
    return sortedLogs;
  }, [logFilter, sortedLogs]);

  const {
    page: logPage,
    setPage: setLogPage,
    pageSize: logPageSize,
    setPageSize: setLogPageSize,
    totalItems: totalFilteredLogs,
    totalPages: totalLogPages,
    pagedItems: pagedLogs,
  } = usePaginatedList(filteredLogs, 10);

  const messaging = statusData?.messaging;
  const verification = statusData?.verification;
  const emailConfigured = Boolean(messaging?.emailConfigured || gmailConn.connected);
  const activeProviderLabel = gmailConn.connected
    ? `Gmail OAuth (${OFFICIAL_PLATFORM_EMAIL})`
    : messaging?.emailConfigured
    ? messaging.emailProvider
    : 'EMAIL SERVICE NOT CONFIGURED';

  const recentFailedLogs = useMemo(
    () =>
      sortedLogs
        .filter(
          (l) =>
            (l.status === 'failed' || l.status === 'rejected' || l.status === 'bounced') &&
            Boolean(l.errorDetail)
        )
        .slice(0, 3),
    [sortedLogs]
  );

  const activeScopeEvents =
    templateScopeTab === 'public_website'
      ? PUBLIC_EMAIL_NOTIFICATION_TYPES
      : CONTROL_CENTRE_EMAIL_NOTIFICATION_TYPES;

  const selectedEventDef =
    ALL_EMAIL_NOTIFICATION_TYPES.find((e) => e.id === selectedTemplateId) || activeScopeEvents[0];
  const selectedTemplate = templates[selectedEventDef.id] || {
    subject: selectedEventDef.defaultSubject,
    body: selectedEventDef.defaultBody,
  };

  return (
    <div className="space-y-6">
      {/* Official Gmail Organization Account Connection Card */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="typo-card-heading text-[#172B46]">
                Official Organization Gmail Connection
              </h2>
              <StatusText
                status={emailConfigured ? 'connected' : 'not_configured'}
                label={activeProviderLabel}
              />
            </div>
            <p className="typo-meta text-[#75869D]">
              Connect <span className="font-mono text-[#172B46]">{OFFICIAL_PLATFORM_EMAIL}</span> to send real
              emails directly from <strong className="text-[#172B46]">SWAS TASKS Organization &lt;{OFFICIAL_PLATFORM_EMAIL}&gt;</strong>.
              OAuth tokens are kept strictly in active browser memory and cleared on sign-out.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={!canEdit || connectingGmail || gmailConn.checking}
              onClick={() => void handleConnectGmail()}
              className="inline-flex items-center gap-2.5 px-4 py-2 bg-white hover:bg-[#F8FAFC] text-[#1F1F1F] border border-[#747775]/60 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
              <span>
                {connectingGmail
                  ? 'Authorizing Gmail...'
                  : gmailConn.connected
                  ? 'Reconnect Gmail Account'
                  : `Connect ${OFFICIAL_PLATFORM_EMAIL}`}
              </span>
            </button>

            <button
              type="button"
              disabled={gmailConn.checking}
              onClick={() => void handleCheckGmailAuth()}
              className="inline-flex items-center gap-1.5 px-3 py-2 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] hover:bg-slate-200 border border-slate-200 rounded-md disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${gmailConn.checking ? 'animate-spin' : ''}`} />
              Check Authorization & Sending
            </button>

            {gmailConn.connected || gmailConn.connectedEmail ? (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setConfirmDisconnectOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 typo-meta font-medium text-[#D34552] bg-white hover:bg-red-50 border border-[#D34552]/30 rounded-md disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 typo-meta">
          <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
            <span className="text-[#75869D] block">Official Sender Email</span>
            <span className="font-mono font-semibold text-[#172B46]">{OFFICIAL_PLATFORM_EMAIL}</span>
          </div>
          <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
            <span className="text-[#75869D] block">Connected OAuth Account</span>
            <span className="font-mono font-semibold text-[#172B46] block truncate">
              {gmailConn.connectedEmail || 'Not Connected'}
            </span>
          </div>
          <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
            <span className="text-[#75869D] block">Gmail Send Scope</span>
            <StatusText
              status={gmailConn.hasGmailSendScope ? 'verified' : gmailConn.connectedEmail ? 'failed' : 'pending'}
              label={
                gmailConn.hasGmailSendScope
                  ? 'gmail.send Authorized'
                  : gmailConn.connectedEmail
                  ? 'Missing Permission'
                  : 'Awaiting OAuth'
              }
            />
          </div>
          <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
            <span className="text-[#75869D] block">Background SMTP Fallback</span>
            <StatusText
              status={messaging?.emailConfigured ? 'connected' : 'not_configured'}
              label={messaging?.emailConfigured ? messaging.emailProvider : 'Not Configured'}
            />
          </div>
        </div>

        {gmailConn.lastError || recentFailedLogs.length > 0 ? (
          <div className="p-3.5 rounded-md bg-red-50/70 border border-red-200 space-y-1.5 typo-meta">
            <p className="font-semibold text-[#D34552] flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Provider Diagnostics & Recent Errors
            </p>
            {gmailConn.lastError ? (
              <p className="text-[#172B46]">{gmailConn.lastError}</p>
            ) : null}
            {recentFailedLogs.map((l) => (
              <p key={l.emailLogId} className="text-xs text-[#75869D]">
                <span className="font-mono text-[#172B46]">{l.recipientEmail}</span>:{' '}
                <span className="text-[#D34552]">{l.errorDetail}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {/* Unconfigured Banner */}
      {!loadingStatus && !emailConfigured ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#B7791F] shrink-0 mt-0.5" />
            <div>
              <p className="typo-card-heading text-[#172B46]">EMAIL SERVICE NOT CONFIGURED</p>
              <p className="typo-meta text-[#75869D] mt-0.5">
                Click <strong className="text-[#172B46]">Connect {OFFICIAL_PLATFORM_EMAIL}</strong> above to send
                directly via Gmail, or configure server-side credentials (
                <span className="font-mono">GMAIL_SMTP_USER</span> +{' '}
                <span className="font-mono">GMAIL_APP_PASSWORD</span>) for automated background workflows.
              </p>
            </div>
          </div>
          <StatusText status="not_configured" label="EMAIL SERVICE NOT CONFIGURED" />
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`p-3 rounded-md typo-meta border ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-[#15966B]'
              : feedback.type === 'warn'
              ? 'bg-amber-50 border-amber-200 text-[#B7791F]'
              : 'bg-red-50 border-red-200 text-[#D34552]'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {/* Top Grid: Official Sender Identity & Service/Domain Verification Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={handleSaveAllEmailSettings}
          className="bg-white border border-slate-200 rounded-lg p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-[#1265C8]" />
              <h2 className="typo-card-heading text-[#172B46]">
                Official SWAS TASKS Email Identity
              </h2>
            </div>
            <StatusText
              status={emailConfigured ? 'connected' : 'not_configured'}
              label={activeProviderLabel}
            />
          </div>

          <p className="typo-meta text-[#75869D]">
            Unified communication identity applied across both the SWAS TASKS Public Website and the
            Central Control Centre. Secret credentials never enter browser code.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Official Platform Email
              </label>
              <input
                type="email"
                readOnly
                value={OFFICIAL_PLATFORM_EMAIL}
                className="w-full px-3 py-2 typo-input font-mono border border-slate-200 rounded-md bg-[#F3F6FA] text-[#172B46]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Sender Display Name
                </label>
                <input
                  type="text"
                  value={senderDisplayName}
                  onChange={(e) => setSenderDisplayName(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Reply-To Email Address
                </label>
                <input
                  type="email"
                  value={replyToEmail}
                  onChange={(e) => setReplyToEmail(e.target.value)}
                  className="w-full px-3 py-2 typo-input font-mono border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 typo-meta space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#75869D]">Active From Header</span>
                <span className="font-mono text-[#172B46]">
                  {senderDisplayName || OFFICIAL_SENDER_DISPLAY_NAME} &lt;{OFFICIAL_PLATFORM_EMAIL}&gt;
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#75869D]">SMS Companion Service (Twilio)</span>
                <StatusText
                  status={messaging?.smsConfigured ? 'connected' : 'not_configured'}
                  label={messaging?.smsConfigured ? 'Configured' : 'Not Configured'}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Hourly Send Limit
                </label>
                <input
                  type="number"
                  min={10}
                  max={10000}
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(Number(e.target.value) || 120)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Daily Send Limit
                </label>
                <input
                  type="number"
                  min={50}
                  max={100000}
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value) || 1000)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Default Email Signature (Sanitized HTML)
              </label>
              <textarea
                rows={3}
                value={signatureHtml}
                onChange={(e) => setSignatureHtml(e.target.value)}
                className="w-full px-3 py-2 typo-input font-mono text-xs border border-slate-300 rounded-md"
              />
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Platform Footer Text
              </label>
              <input
                type="text"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!canEdit || savingSettings}
            className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {savingSettings ? 'Saving Email Settings...' : 'Save Official Email Settings'}
          </button>
        </form>

        {/* Connection & Email Verification Status (SPF / DKIM / DMARC) */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#1265C8]" />
              <h2 className="typo-card-heading text-[#172B46]">
                Connection & Verification Status
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void fetchEmailStatus()}
              disabled={loadingStatus}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] hover:bg-slate-200 border border-slate-200 rounded-md"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
              Refresh Checks
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 typo-meta">
            <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
              <span className="text-[#75869D] block">Email Service Connection</span>
              <StatusText
                status={emailConfigured ? 'connected' : 'not_configured'}
                label={emailConfigured ? messaging?.emailProvider : 'EMAIL SERVICE NOT CONFIGURED'}
              />
            </div>

            <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
              <span className="text-[#75869D] block">Active Sending Domain</span>
              <span className="font-mono font-semibold text-[#172B46]">
                {verification?.domain || 'gmail.com'}
              </span>
            </div>

            <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#172B46]">SPF DNS Record</span>
                <StatusText
                  status={
                    verification?.spfStatus === 'verified'
                      ? 'verified'
                      : verification?.spfStatus === 'missing'
                      ? 'warning'
                      : 'pending'
                  }
                  label={
                    verification?.spfStatus === 'verified'
                      ? 'Verified'
                      : verification?.spfStatus === 'missing'
                      ? 'Missing'
                      : 'Checking'
                  }
                />
              </div>
              <p className="font-mono typo-small text-[#75869D] truncate" title={verification?.spfRecord}>
                {verification?.spfRecord || 'No SPF TXT record parsed'}
              </p>
            </div>

            <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#172B46]">DMARC DNS Policy</span>
                <StatusText
                  status={
                    verification?.dmarcStatus === 'verified'
                      ? 'verified'
                      : verification?.dmarcStatus === 'missing'
                      ? 'warning'
                      : 'pending'
                  }
                  label={
                    verification?.dmarcStatus === 'verified'
                      ? 'Verified'
                      : verification?.dmarcStatus === 'missing'
                      ? 'Missing'
                      : 'Checking'
                  }
                />
              </div>
              <p className="font-mono typo-small text-[#75869D] truncate" title={verification?.dmarcRecord}>
                {verification?.dmarcRecord || 'No DMARC TXT record parsed'}
              </p>
            </div>
          </div>

          <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 typo-meta space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#172B46]">DKIM Signing & Verification</span>
              <StatusText
                status={verification?.dkimStatus === 'managed_by_gmail' ? 'verified' : 'info'}
                label={
                  verification?.dkimStatus === 'managed_by_gmail'
                    ? 'Google DKIM Managed'
                    : 'Custom Domain DKIM'
                }
              />
            </div>
            <p className="text-[#75869D]">
              {verification?.dkimNote ||
                'Authenticate via Gmail SMTP App Password or verified custom domain DKIM selectors.'}
            </p>
            <p className="text-[#75869D] pt-1">
              In Firebase Console → Authentication → Templates, ensure sender Reply-To is also set to{' '}
              <span className="font-mono text-[#172B46]">{OFFICIAL_PLATFORM_EMAIL}</span> so Firebase
              verification and password reset emails share one unified identity.
            </p>
          </div>
        </div>
      </div>

      {/* Test Email Dispatch Card */}
      <form
        onSubmit={handleSendTestEmail}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="typo-card-heading text-[#172B46]">Test Email Function</h2>
            <p className="typo-meta text-[#75869D] mt-0.5">
              Attempts a real submission from <span className="font-mono">{OFFICIAL_PLATFORM_EMAIL}</span>{' '}
              and logs the provider response below. Delivery is only marked Sent upon provider confirmation.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block typo-label text-[#172B46] mb-1">Recipient Email</label>
            <input
              type="email"
              required
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
              placeholder="recipient@example.com"
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block typo-label text-[#172B46] mb-1">Test Subject</label>
            <input
              type="text"
              required
              value={testSubject}
              onChange={(e) => setTestSubject(e.target.value)}
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
            />
          </div>
        </div>

        <div>
          <label className="block typo-label text-[#172B46] mb-1">Message Body</label>
          <textarea
            rows={2}
            required
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
          />
        </div>

        <button
          type="submit"
          disabled={!canEdit || sendingTest}
          className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#102B50] hover:bg-[#172B46] rounded-md disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
          {sendingTest ? 'Dispatching Test Email...' : 'Send Test Email'}
        </button>
      </form>

      {/* Notification Settings & Template Management */}
      <form
        onSubmit={handleSaveAllEmailSettings}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="typo-card-heading text-[#172B46]">
              Email Notification Settings & Templates
            </h2>
            <p className="typo-meta text-[#75869D] mt-0.5">
              Control which automated emails dispatch from <span className="font-mono">{OFFICIAL_PLATFORM_EMAIL}</span>{' '}
              and customize branded subject/body templates across both platforms.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTemplateScopeTab('public_website')}
              className={`px-3 py-1.5 typo-nav rounded-md border transition-colors ${
                templateScopeTab === 'public_website'
                  ? 'bg-[#1265C8] text-white border-[#1265C8]'
                  : 'bg-white text-[#172B46] border-slate-200 hover:bg-[#E9F2FF]'
              }`}
            >
              Public Website ({PUBLIC_EMAIL_NOTIFICATION_TYPES.length})
            </button>
            <button
              type="button"
              onClick={() => setTemplateScopeTab('control_centre')}
              className={`px-3 py-1.5 typo-nav rounded-md border transition-colors ${
                templateScopeTab === 'control_centre'
                  ? 'bg-[#1265C8] text-white border-[#1265C8]'
                  : 'bg-white text-[#172B46] border-slate-200 hover:bg-[#E9F2FF]'
              }`}
            >
              Control Centre ({CONTROL_CENTRE_EMAIL_NOTIFICATION_TYPES.length})
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Event Toggle List */}
          <div className="lg:col-span-6 space-y-2 max-h-[430px] overflow-y-auto pr-1">
            {activeScopeEvents.map((evt) => {
              const enabled = notificationRules[evt.id] ?? evt.defaultEnabled;
              const isSelected = selectedEventDef.id === evt.id;
              return (
                <div
                  key={evt.id}
                  onClick={() => setSelectedTemplateId(evt.id)}
                  className={`p-3 rounded-md border cursor-pointer transition-colors flex items-start justify-between gap-3 ${
                    isSelected
                      ? 'border-[#1265C8] bg-[#E9F2FF]/40'
                      : 'border-slate-200 hover:bg-[#F3F6FA]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="typo-body font-medium text-[#172B46]">{evt.label}</p>
                    <p className="typo-small text-[#75869D] mt-0.5">{evt.description}</p>
                  </div>
                  <label
                    className="inline-flex items-center gap-1.5 shrink-0 pt-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) =>
                        setNotificationRules((prev) => ({ ...prev, [evt.id]: e.target.checked }))
                      }
                    />
                    <span className="typo-small font-medium text-[#172B46]">
                      {enabled ? 'Enabled' : 'Paused'}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>

          {/* Template Editor */}
          <div className="lg:col-span-6 p-4 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-3 h-fit">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="typo-small font-semibold text-[#1265C8] uppercase tracking-wider">
                  {selectedEventDef.scope === 'public_website'
                    ? 'Public Website Template'
                    : 'Control Centre Template'}
                </p>
                <h3 className="typo-card-heading text-[#172B46]">{selectedEventDef.label}</h3>
              </div>
              <button
                type="button"
                onClick={() =>
                  setTemplates((prev) => ({
                    ...prev,
                    [selectedEventDef.id]: {
                      subject: selectedEventDef.defaultSubject,
                      body: selectedEventDef.defaultBody,
                    },
                  }))
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-[#75869D] hover:text-[#172B46]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Default
              </button>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">Email Subject Line</label>
              <input
                type="text"
                value={selectedTemplate.subject}
                onChange={(e) =>
                  setTemplates((prev) => ({
                    ...prev,
                    [selectedEventDef.id]: {
                      ...selectedTemplate,
                      subject: e.target.value,
                    },
                  }))
                }
                className="w-full px-3 py-2 typo-input bg-white border border-slate-300 rounded-md"
              />
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">Template Body Copy</label>
              <textarea
                rows={5}
                value={selectedTemplate.body}
                onChange={(e) =>
                  setTemplates((prev) => ({
                    ...prev,
                    [selectedEventDef.id]: {
                      ...selectedTemplate,
                      body: e.target.value,
                    },
                  }))
                }
                className="w-full px-3 py-2 typo-input bg-white border border-slate-300 rounded-md"
              />
            </div>

            <div className="p-2.5 rounded bg-white border border-slate-200 typo-small text-[#75869D] flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#15966B] shrink-0" />
              <span>
                Dispatched as{' '}
                <span className="font-mono text-[#172B46]">
                  {senderDisplayName || OFFICIAL_SENDER_DISPLAY_NAME} &lt;{OFFICIAL_PLATFORM_EMAIL}&gt;
                </span>
              </span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={!canEdit || savingSettings}
          className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {savingSettings ? 'Saving...' : 'Save Notification Settings & Templates'}
        </button>
      </form>

      {/* Email Delivery Logs & Failed Email Records */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="typo-card-heading text-[#172B46]">
              Email Delivery Logs & Failed Email Records
            </h2>
            <p className="typo-meta text-[#75869D]">
              Audit trail of outgoing SWAS TASKS emails stored in Firestore{' '}
              <span className="font-mono">email_logs</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: `All Logs (${sortedLogs.length})` },
              { id: 'sent', label: `Delivered (${sentCount})` },
              { id: 'failed', label: `Failed / Unconfigured (${failedCount})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setLogFilter(tab.id as 'all' | 'sent' | 'failed');
                  setLogPage(1);
                }}
                className={`px-3 py-1.5 typo-meta font-medium rounded-md border transition-colors ${
                  logFilter === tab.id
                    ? 'bg-[#102B50] text-white border-[#102B50]'
                    : 'bg-white text-[#172B46] border-slate-200 hover:bg-[#F3F6FA]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {pagedLogs.length === 0 ? (
          <EmptyState
            title={
              logFilter === 'failed'
                ? 'No Failed Email Records'
                : 'No Email Delivery Records Yet'
            }
            description={
              logFilter === 'failed'
                ? 'Failed or unconfigured email attempts will appear here with provider diagnostics and retry controls.'
                : 'Send a test email or issue a staff invitation to record live delivery telemetry.'
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Recipient</th>
                    <th className="px-4 py-3 font-medium">Subject & Event</th>
                    <th className="px-4 py-3 font-medium">Sender / Provider</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Diagnostics</th>
                    <th className="px-4 py-3 font-medium">Timestamp</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedLogs.map((log) => (
                    <tr key={log.emailLogId} className="hover:bg-[#F3F6FA]/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#172B46]">{log.recipientEmail}</p>
                        <p className="font-mono typo-small text-[#75869D]">{log.emailLogId}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#172B46]">{log.subject}</p>
                        <p className="typo-small text-[#75869D]">
                          {log.scope === 'public_website' ? 'Public Website' : 'Control Centre'} ·{' '}
                          <span className="font-mono">{log.eventType}</span>
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-mono typo-small text-[#172B46]">{log.fromAddress}</p>
                        <p className="typo-small text-[#75869D]">{log.provider}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusText
                          status={log.status}
                          label={
                            log.status === 'not_configured'
                              ? 'EMAIL SERVICE NOT CONFIGURED'
                              : undefined
                          }
                        />
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        {log.status === 'sent' ? (
                          <span className="font-mono typo-small text-[#15966B] break-all">
                            {log.providerMessageId || 'Confirmed'}
                          </span>
                        ) : (
                          <span className="typo-small text-[#D34552] line-clamp-2" title={log.errorDetail}>
                            {log.errorDetail || 'Delivery not confirmed'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 typo-meta tabular-nums text-[#75869D]">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {log.status !== 'sent' && canEdit ? (
                          <button
                            type="button"
                            disabled={retryingId === log.emailLogId}
                            onClick={() => void handleRetryEmail(log.emailLogId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 typo-small font-medium text-[#1265C8] border border-[#1265C8]/30 hover:bg-[#E9F2FF] rounded disabled:opacity-50"
                          >
                            <RotateCcw className="w-3 h-3" />
                            {retryingId === log.emailLogId ? 'Retrying...' : 'Retry'}
                          </button>
                        ) : (
                          <span className="typo-small text-[#75869D]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              page={logPage}
              pageSize={logPageSize}
              totalItems={totalFilteredLogs}
              totalPages={totalLogPages}
              onPageChange={setLogPage}
              onPageSizeChange={setLogPageSize}
            />
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmTestOpen}
        title="Confirm Test Email Dispatch"
        description={`Send a live verification email from ${senderDisplayName || OFFICIAL_SENDER_DISPLAY_NAME} <${OFFICIAL_PLATFORM_EMAIL}> to ${testRecipient}?`}
        confirmLabel={sendingTest ? 'Dispatching...' : 'Send Test Email'}
        onCancel={() => setConfirmTestOpen(false)}
        onConfirm={() => void handleConfirmSendTestEmail()}
      />

      <ConfirmModal
        open={confirmDisconnectOpen}
        title="Disconnect Official Gmail Account"
        description={`Disconnect ${gmailConn.connectedEmail || OFFICIAL_PLATFORM_EMAIL} from this browser session? Outgoing emails will stop using Gmail OAuth until reconnected.`}
        confirmLabel="Disconnect Gmail"
        danger
        onCancel={() => setConfirmDisconnectOpen(false)}
        onConfirm={async () => {
          await disconnectOfficialGmailAccount();
          setConfirmDisconnectOpen(false);
          setFeedback({
            type: 'warn',
            text: `Disconnected Gmail OAuth session (${OFFICIAL_PLATFORM_EMAIL}).`,
          });
        }}
      />
    </div>
  );
}
