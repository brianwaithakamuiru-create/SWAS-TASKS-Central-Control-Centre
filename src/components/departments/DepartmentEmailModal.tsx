import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Eye,
  FileUp,
  Mail,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  OFFICIAL_PLATFORM_EMAIL,
  OFFICIAL_SENDER_DISPLAY_NAME,
} from '../../config/platformIdentity';
import { useAuth } from '../../context/AuthContext';
import {
  apiFetch,
  buildEmailPreviewSrcDoc,
  dispatchPlatformEmail,
  sanitizeClientHtml,
  schedulePlatformEmail,
  uploadEmailAttachment,
} from '../../services/firestoreService';
import { useGmailConnection } from '../../services/gmailOAuth';
import type {
  EightDepartmentId,
  EmailAttachmentMeta,
  EmailTemplateRecord,
  MessagingStatus,
} from '../../types/admin';

export interface DepartmentEmailTarget {
  name?: string;
  email: string;
  uid?: string;
  recipientType?: 'user' | 'worker' | 'client' | 'admin' | 'custom';
  sourceRecord?: string;
  vars?: Record<string, string>;
}

interface DepartmentEmailModalProps {
  open: boolean;
  onClose: () => void;
  department: EightDepartmentId;
  initialRecipient?: DepartmentEmailTarget | null;
  initialRecipients?: DepartmentEmailTarget[];
  templates?: EmailTemplateRecord[];
  defaultSubject?: string;
  defaultBody?: string;
  onSent?: () => void;
}

const VARIABLE_TOKENS = [
  '{{client_name}}',
  '{{first_name}}',
  '{{email}}',
  '{{account_id}}',
  '{{account_status}}',
  '{{message}}',
  '{{support_email}}',
  '{{company_name}}',
  '{{current_date}}',
];

export function DepartmentEmailModal({
  open,
  onClose,
  department,
  initialRecipient,
  initialRecipients,
  templates = [],
  defaultSubject = '',
  defaultBody = '',
  onSent,
}: DepartmentEmailModalProps) {
  const { adminProfile, hasEmailPermission } = useAuth();
  const gmailConn = useGmailConnection();
  const canSend = hasEmailPermission('email.send') || hasEmailPermission('email.send_bulk');
  const canSchedule = hasEmailPermission('email.schedule');

  const targets = useMemo(() => {
    if (initialRecipients && initialRecipients.length > 0) return initialRecipients;
    if (initialRecipient && initialRecipient.email) return [initialRecipient];
    return [];
  }, [initialRecipient, initialRecipients]);

  const visibleTemplates = useMemo(
    () =>
      templates.filter(
        (t) => t.isActive !== false && (t.department === 'all' || t.department === department)
      ),
    [department, templates]
  );

  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [customRecipientEmail, setCustomRecipientEmail] = useState('');
  const [ccText, setCcText] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyText, setBodyText] = useState(defaultBody);
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [attachments, setAttachments] = useState<EmailAttachmentMeta[]>([]);
  const [uploadingAtt, setUploadingAtt] = useState(false);

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  const [messagingStatus, setMessagingStatus] = useState<MessagingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(
    null
  );

  useEffect(() => {
    if (!open) return;
    setSelectedTemplateId('');
    setCustomRecipientEmail(targets.length === 1 ? targets[0].email : '');
    setCcText('');
    setSubject(defaultSubject);
    setBodyText(defaultBody);
    setCtaLabel('');
    setCtaUrl('');
    setAttachments([]);
    setScheduleEnabled(false);
    setScheduledFor('');
    setShowPreview(false);
    setConfirmStep(false);
    setFeedback(null);

    void apiFetch<{ messaging: MessagingStatus }>('/api/v1/admin/email/status')
      .then((res) => setMessagingStatus(res.messaging))
      .catch(() => setMessagingStatus(null));
  }, [open, targets, defaultSubject, defaultBody]);

  if (!open) return null;

  const activeRecipients: DepartmentEmailTarget[] =
    targets.length > 0
      ? targets
      : customRecipientEmail.trim()
      ? [{ email: customRecipientEmail.trim(), recipientType: 'custom' }]
      : [];

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const tpl = visibleTemplates.find((t) => t.templateId === templateId);
    if (!tpl) return;
    setSubject(tpl.subject);
    setBodyText(tpl.textBody || tpl.htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (tpl.ctaLabel) setCtaLabel(tpl.ctaLabel);
    if (tpl.ctaUrl) setCtaUrl(tpl.ctaUrl);
  };

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !adminProfile) return;
    setUploadingAtt(true);
    setFeedback(null);
    try {
      const meta = await uploadEmailAttachment(adminProfile.uid, file);
      setAttachments((prev) => [...prev, meta]);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Attachment upload failed.',
      });
    } finally {
      setUploadingAtt(false);
    }
  };

  const buildBodyHtml = () => {
    const paragraphs = bodyText
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
      .join('');
    return sanitizeClientHtml(paragraphs || `<p>${bodyText}</p>`);
  };

  const parseCcList = () =>
    ccText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes('@'));

  const handleConfirmSend = async () => {
    if (activeRecipients.length === 0 || !subject.trim() || !bodyText.trim()) {
      setFeedback({ type: 'err', text: 'Recipient, subject, and message body are required.' });
      setConfirmStep(false);
      return;
    }
    setBusy(true);
    setFeedback(null);
    const ccEmails = parseCcList();
    const bodyHtml = buildBodyHtml();

    try {
      if (scheduleEnabled) {
        if (!scheduledFor) {
          throw new Error('Select a future date and time for scheduled delivery.');
        }
        const iso = new Date(scheduledFor).toISOString();
        const res = await schedulePlatformEmail({
          recipients: activeRecipients.map((r) => ({
            email: r.email,
            name: r.name,
            uid: r.uid,
            recipientType: r.recipientType || 'custom',
          })),
          ccEmails,
          subject: subject.trim(),
          bodyHtml,
          bodyText: bodyText.trim(),
          ctaLabel: ctaLabel.trim() || undefined,
          ctaUrl: ctaUrl.trim() || undefined,
          attachments,
          scheduledFor: iso,
          department,
          eventType: 'department_scheduled_email',
          sourceRecord: activeRecipients[0]?.sourceRecord,
        });
        setFeedback({
          type: 'ok',
          text: `Scheduled ${res.scheduledCount} email(s) for ${new Date(iso).toLocaleString()}.`,
        });
        setConfirmStep(false);
        onSent?.();
      } else {
        const res = await dispatchPlatformEmail({
          recipients: activeRecipients.map((r) => ({
            email: r.email,
            name: r.name,
            uid: r.uid,
            recipientType: r.recipientType || 'custom',
            vars: r.vars,
          })),
          ccEmails,
          scope: 'public_website',
          department,
          eventType: 'department_direct_email',
          subject: subject.trim(),
          bodyHtml,
          bodyText: bodyText.trim(),
          ctaLabel: ctaLabel.trim() || undefined,
          ctaUrl: ctaUrl.trim() || undefined,
          attachments,
          includeSignature: true,
          templateId: selectedTemplateId || undefined,
          sourceRecord: activeRecipients[0]?.sourceRecord,
          personalizationVars: activeRecipients[0]?.vars,
        });
        if (res.delivery.status === 'not_configured') {
          setFeedback({
            type: 'warn',
            text:
              res.delivery.error ||
              res.delivery.detail ||
              'EMAIL SERVICE NOT CONFIGURED — connect swastaskorg@gmail.com in Email Settings.',
          });
        } else if (
          res.delivery.sent === false ||
          res.delivery.status === 'failed' ||
          res.delivery.status === 'rejected'
        ) {
          setFeedback({
            type: 'err',
            text: res.delivery.error || res.delivery.detail || 'Email dispatch failed.',
          });
        } else {
          setFeedback({
            type: 'ok',
            text:
              res.delivery.detail ||
              `Dispatched ${activeRecipients.length} email(s) from ${OFFICIAL_PLATFORM_EMAIL}.`,
          });
          onSent?.();
        }
        setConfirmStep(false);
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Email dispatch failed.',
      });
      setConfirmStep(false);
    } finally {
      setBusy(false);
    }
  };

  const previewSrcDoc = buildEmailPreviewSrcDoc({
    subject,
    bodyHtml: buildBodyHtml(),
    ctaLabel,
    ctaUrl,
    includeSignature: true,
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-lg max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#1265C8]" />
            <div>
              <h3 className="typo-section-heading text-[#172B46]">
                Department Email Communication
              </h3>
              <p className="typo-meta text-[#75869D]">
                Sender:{' '}
                <span className="font-mono text-[#172B46]">
                  {OFFICIAL_SENDER_DISPLAY_NAME} &lt;{OFFICIAL_PLATFORM_EMAIL}&gt;
                </span>{' '}
                · Department: <span className="font-mono">{department}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#75869D] hover:text-[#172B46]"
            aria-label="Close email modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {messagingStatus && !messagingStatus.emailConfigured && !gmailConn.connected ? (
          <div className="p-3 rounded-md bg-amber-50 border border-amber-200 flex items-start gap-2 typo-meta text-[#B7791F]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>EMAIL SERVICE NOT CONFIGURED:</strong> Connect{' '}
              <span className="font-mono">{OFFICIAL_PLATFORM_EMAIL}</span> via Google OAuth in{' '}
              <strong>Email Centre → Settings</strong> or configure Gmail SMTP / Resend credentials on the server.
            </span>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block typo-label text-[#172B46] mb-1">
              Recipient(s) ({activeRecipients.length})
            </label>
            {targets.length > 0 ? (
              <div className="px-3 py-2 rounded-md border border-slate-200 bg-[#F3F6FA] typo-meta text-[#172B46] max-h-20 overflow-y-auto">
                {targets.map((t) => (
                  <div key={t.email} className="truncate">
                    {t.name ? `${t.name} <${t.email}>` : t.email}
                  </div>
                ))}
              </div>
            ) : (
              <input
                type="email"
                required
                value={customRecipientEmail}
                onChange={(e) => setCustomRecipientEmail(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            )}
          </div>

          <div>
            <label className="block typo-label text-[#172B46] mb-1">
              Apply Department Template (Optional)
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
            >
              <option value="">-- Custom Message --</option>
              {visibleTemplates.map((tpl) => (
                <option key={tpl.templateId} value={tpl.templateId}>
                  [{tpl.category}] {tpl.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block typo-label text-[#172B46] mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="SWAS TASKS – Notification Subject"
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block typo-label text-[#172B46] mb-1">CC Emails (Comma-Separated)</label>
            <input
              type="text"
              value={ccText}
              onChange={(e) => setCcText(e.target.value)}
              placeholder="optional-cc@swastasks.org"
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
            />
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <label className="typo-label text-[#172B46]">Message Body</label>
            <div className="flex flex-wrap gap-1">
              {VARIABLE_TOKENS.slice(0, 5).map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => setBodyText((prev) => `${prev}${prev ? ' ' : ''}${token}`)}
                  className="px-2 py-0.5 text-[11px] font-mono bg-[#F3F6FA] hover:bg-[#E9F2FF] text-[#1265C8] border border-slate-200 rounded"
                >
                  {token}
                </button>
              ))}
            </div>
          </div>
          <textarea
            rows={6}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Write the official department communication..."
            className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block typo-label text-[#172B46] mb-1">Action Button Label (Optional)</label>
            <input
              type="text"
              value={ctaLabel}
              onChange={(e) => setCtaLabel(e.target.value)}
              placeholder="Open Account Dashboard"
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block typo-label text-[#172B46] mb-1">Action Button URL (https://...)</label>
            <input
              type="url"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              placeholder="https://swastasks.example.com/..."
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] hover:bg-slate-200 border border-slate-200 rounded-md cursor-pointer">
              <FileUp className="w-3.5 h-3.5 text-[#1265C8]" />
              {uploadingAtt ? 'Uploading...' : 'Attach File (PDF/DOCX/XLSX/IMG)'}
              <input
                type="file"
                accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
                onChange={(e) => void handleUploadAttachment(e)}
                disabled={uploadingAtt}
                className="hidden"
              />
            </label>

            {canSchedule ? (
              <label className="inline-flex items-center gap-2 typo-meta text-[#172B46]">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                />
                <CalendarClock className="w-3.5 h-3.5 text-[#1265C8]" />
                <span>Schedule Send</span>
              </label>
            ) : null}

            {scheduleEnabled ? (
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="px-2.5 py-1.5 typo-meta border border-slate-300 rounded-md"
              />
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-[#1265C8] border border-[#1265C8]/30 rounded-md hover:bg-[#E9F2FF]"
          >
            <Eye className="w-3.5 h-3.5" />
            {showPreview ? 'Hide Preview' : 'Preview Email'}
          </button>
        </div>

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {attachments.map((att, idx) => (
              <div
                key={`${att.name}_${idx}`}
                className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-[#F3F6FA] border border-slate-200 typo-small text-[#172B46]"
              >
                <span>{att.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-[#D34552]"
                  aria-label="Remove attachment"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {showPreview ? (
          <div className="border border-slate-200 rounded-md overflow-hidden bg-[#F3F6FA]">
            <iframe
              title="Email Preview"
              sandbox=""
              srcDoc={previewSrcDoc}
              className="w-full h-72 border-0"
            />
          </div>
        ) : null}

        {confirmStep ? (
          <div className="p-4 rounded-md bg-[#E9F2FF]/60 border border-[#1265C8]/40 space-y-3">
            <p className="typo-body font-semibold text-[#172B46]">
              Confirm Official Email Dispatch
            </p>
            <p className="typo-meta text-[#172B46]">
              Recipients: <strong>{activeRecipients.length}</strong> · Subject:{' '}
              <strong>{subject}</strong> · From:{' '}
              <span className="font-mono">{OFFICIAL_PLATFORM_EMAIL}</span>
              {scheduleEnabled && scheduledFor
                ? ` · Scheduled for ${new Date(scheduledFor).toLocaleString()}`
                : ' · Immediate Dispatch'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmStep(false)}
                className="px-3 py-1.5 typo-button text-[#172B46] bg-white border border-slate-300 rounded-md"
              >
                Back to Edit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConfirmSend()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {busy
                  ? 'Processing...'
                  : scheduleEnabled
                  ? 'Confirm & Schedule'
                  : 'Confirm & Send Now'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-3 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 typo-button text-[#172B46] bg-slate-100 rounded-md"
            >
              Close
            </button>
            <button
              type="button"
              disabled={!canSend || busy || activeRecipients.length === 0 || !subject.trim() || !bodyText.trim()}
              onClick={() => setConfirmStep(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {scheduleEnabled ? 'Review & Schedule' : 'Review & Send'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
