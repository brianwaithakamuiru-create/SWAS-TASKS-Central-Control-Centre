import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bold,
  CalendarClock,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FileUp,
  Italic,
  Link2,
  List,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Underline,
  Users,
  X,
} from 'lucide-react';
import {
  EIGHT_DEPARTMENTS,
  EMAIL_CENTRE_SUBDEPARTMENTS,
  EMAIL_GRANULAR_PERMISSIONS,
} from '../../config/navigation';
import {
  OFFICIAL_PLATFORM_EMAIL,
  OFFICIAL_SENDER_DISPLAY_NAME,
} from '../../config/platformIdentity';
import { useAuth } from '../../context/AuthContext';
import {
  apiFetch,
  buildEmailPreviewSrcDoc,
  cancelEmailCampaign,
  cancelScheduledEmail,
  deleteEmailDraft,
  deleteEmailTemplate,
  dispatchPlatformEmail,
  exportRecordsToCsv,
  fetchEmailRecipients,
  fetchEmailReports,
  processDueScheduledEmailsNow,
  retryEmailCampaign,
  retryEmailLog,
  sanitizeClientHtml,
  saveEmailDraft,
  saveEmailTemplate,
  schedulePlatformEmail,
  sendBulkEmailCampaign,
  uploadEmailAttachment,
  type EmailReportsResponse,
} from '../../services/firestoreService';
import { useGmailConnection } from '../../services/gmailOAuth';
import type {
  AdminUser,
  EightDepartmentId,
  EmailAttachmentMeta,
  EmailCampaignRecord,
  EmailDraftRecord,
  EmailLogRecord,
  EmailRecipientOption,
  EmailTemplateCategory,
  EmailTemplateRecord,
  MessagingStatus,
  PlatformSetting,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { TablePagination, usePaginatedList } from '../common/TablePagination';
import { CentralEmailSettingsPanel } from './CentralEmailSettingsPanel';

interface EmailCentreViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  adminProfile: AdminUser | null;
  settingsDocs: PlatformSetting[];
  emailLogs: EmailLogRecord[];
  emailTemplates: EmailTemplateRecord[];
  emailDrafts: EmailDraftRecord[];
  emailCampaigns: EmailCampaignRecord[];
  scopedDepartment?: EightDepartmentId;
}

const TEMPLATE_CATEGORIES: EmailTemplateCategory[] = [
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
];

const PERSONALIZATION_VARIABLES = [
  { token: '{{client_name}}', label: 'Client Name' },
  { token: '{{first_name}}', label: 'First Name' },
  { token: '{{last_name}}', label: 'Last Name' },
  { token: '{{email}}', label: 'Email Address' },
  { token: '{{department}}', label: 'Department' },
  { token: '{{account_id}}', label: 'Account ID' },
  { token: '{{account_status}}', label: 'Account Status' },
  { token: '{{registration_date}}', label: 'Registration Date' },
  { token: '{{message}}', label: 'Message' },
  { token: '{{support_email}}', label: 'Support Email' },
  { token: '{{company_name}}', label: 'Company Name' },
  { token: '{{current_date}}', label: 'Current Date' },
];

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-4])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function EmailCentreView({
  subId,
  onSelectSub,
  adminProfile,
  settingsDocs,
  emailLogs,
  emailTemplates,
  emailDrafts,
  emailCampaigns,
  scopedDepartment,
}: EmailCentreViewProps) {
  const { isSuperAdmin, hasEmailPermission } = useAuth();
  const gmailConn = useGmailConnection();
  const effectiveDepartment =
    scopedDepartment ||
    (isSuperAdmin
      ? 'all'
      : adminProfile?.primaryDepartment && adminProfile.primaryDepartment !== 'all'
      ? adminProfile.primaryDepartment
      : 'platform_settings');

  const canCompose = hasEmailPermission('email.compose');
  const canSend = hasEmailPermission('email.send');
  const canSendBulk = hasEmailPermission('email.send_bulk');
  const canSchedule = hasEmailPermission('email.schedule');
  const canManageTemplates = hasEmailPermission('email.manage_templates');
  const canViewReports = hasEmailPermission('email.view_reports');
  const canRetryFailed = hasEmailPermission('email.retry_failed');
  const canManageSettings = hasEmailPermission('email.manage_settings');

  const emailConfigDoc = settingsDocs.find((d) => d.sectionId === 'email_configuration');
  const emailCfg =
    emailConfigDoc?.config && typeof emailConfigDoc.config === 'object'
      ? (emailConfigDoc.config as Record<string, unknown>)
      : {};
  const signatureHtml =
    typeof emailCfg.signatureHtml === 'string' ? emailCfg.signatureHtml : undefined;
  const footerText = typeof emailCfg.footerText === 'string' ? emailCfg.footerText : undefined;

  const [messagingStatus, setMessagingStatus] = useState<MessagingStatus | null>(null);
  const [recipients, setRecipients] = useState<EmailRecipientOption[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [reportsData, setReportsData] = useState<EmailReportsResponse | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(
    null
  );

  // Composer state
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | undefined>(undefined);
  const [selectedRecipients, setSelectedRecipients] = useState<EmailRecipientOption[]>([]);
  const [customEmailInput, setCustomEmailInput] = useState('');
  const [customEmails, setCustomEmails] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [composerDept, setComposerDept] = useState<string>(effectiveDepartment);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('<p></p>');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [includeSignature, setIncludeSignature] = useState(true);
  const [attachments, setAttachments] = useState<EmailAttachmentMeta[]>([]);
  const [uploadingAtt, setUploadingAtt] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [composerBusy, setComposerBusy] = useState(false);

  // Recipients directory state
  const [recSearch, setRecSearch] = useState('');
  const [recTypeFilter, setRecTypeFilter] = useState<'all' | 'worker' | 'client' | 'user' | 'admin'>('all');
  const [recStatusFilter, setRecStatusFilter] = useState('all');
  const [recipientPickerSearch, setRecipientPickerSearch] = useState('');

  // Templates state
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [tplEditingId, setTplEditingId] = useState<string | undefined>(undefined);
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState<EmailTemplateCategory>('General Announcements');
  const [tplDept, setTplDept] = useState<'all' | EightDepartmentId>('all');
  const [tplSubject, setTplSubject] = useState('');
  const [tplHtmlBody, setTplHtmlBody] = useState('');
  const [tplCtaLabel, setTplCtaLabel] = useState('');
  const [tplCtaUrl, setTplCtaUrl] = useState('');
  const [tplCategoryFilter, setTplCategoryFilter] = useState('all');
  const [tplBusy, setTplBusy] = useState(false);

  // Campaigns state
  const [campName, setCampName] = useState('');
  const [campAudience, setCampAudience] = useState<'selected' | 'all_workers' | 'all_clients' | 'all_users'>('all_workers');
  const [campSubject, setCampSubject] = useState('');
  const [campBodyHtml, setCampBodyHtml] = useState('');
  const [campScheduledFor, setCampScheduledFor] = useState('');
  const [campBusy, setCampBusy] = useState(false);

  // History / Logs filters & inspect drawer
  const [logSearch, setLogSearch] = useState('');
  const [logKindFilter, setLogKindFilter] = useState<'all' | 'automatic' | 'manual' | 'scheduled' | 'bulk'>('all');
  const [logDeptFilter, setLogDeptFilter] = useState('all');
  const [inspectingLog, setInspectingLog] = useState<EmailLogRecord | null>(null);
  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);

  // Confirm action modal
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const loadStatusAndRecipients = useCallback(async () => {
    setLoadingRecipients(true);
    try {
      const [statusRes, recList] = await Promise.all([
        apiFetch<{ messaging: MessagingStatus }>('/api/v1/admin/email/status'),
        fetchEmailRecipients(effectiveDepartment === 'all' ? undefined : effectiveDepartment),
      ]);
      setMessagingStatus(statusRes.messaging);
      setRecipients(recList);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to load Email Centre status.',
      });
    } finally {
      setLoadingRecipients(false);
    }
  }, [effectiveDepartment]);

  const loadReports = useCallback(async () => {
    if (!canViewReports) return;
    setLoadingReports(true);
    try {
      const rep = await fetchEmailReports(effectiveDepartment === 'all' ? undefined : effectiveDepartment);
      setReportsData(rep);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to load delivery analytics.',
      });
    } finally {
      setLoadingReports(false);
    }
  }, [canViewReports, effectiveDepartment]);

  useEffect(() => {
    void loadStatusAndRecipients();
  }, [loadStatusAndRecipients]);

  useEffect(() => {
    if (subId === 'dashboard' || subId === 'reports') {
      void loadReports();
    }
  }, [subId, loadReports]);

  useEffect(() => {
    setComposerDept(effectiveDepartment);
  }, [effectiveDepartment]);

  const syncEditorFromHtml = (html: string) => {
    const clean = sanitizeClientHtml(html);
    setBodyHtml(clean);
    if (editorRef.current) {
      editorRef.current.innerHTML = clean;
    }
  };

  const applyRichCommand = (command: string, value?: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, value);
    setBodyHtml(sanitizeClientHtml(editorRef.current.innerHTML));
  };

  const insertTokenIntoComposer = (token: string) => {
    if (!editorRef.current) {
      setBodyHtml((prev) => `${prev} ${token}`);
      return;
    }
    editorRef.current.focus();
    document.execCommand('insertText', false, token);
    setBodyHtml(sanitizeClientHtml(editorRef.current.innerHTML));
  };

  // Filtered datasets scoped to department when inside a department workplace
  const scopedLogs = useMemo(() => {
    const base =
      scopedDepartment
        ? emailLogs.filter((l) => l.department === scopedDepartment)
        : emailLogs;
    return [...base].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [emailLogs, scopedDepartment]);

  const scopedTemplates = useMemo(() => {
    const base = scopedDepartment
      ? emailTemplates.filter((t) => t.department === 'all' || t.department === scopedDepartment)
      : emailTemplates;
    return [...base].sort(
      (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    );
  }, [emailTemplates, scopedDepartment]);

  const scopedCampaigns = useMemo(() => {
    const base = scopedDepartment
      ? emailCampaigns.filter((c) => c.department === scopedDepartment)
      : emailCampaigns;
    return [...base].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [emailCampaigns, scopedDepartment]);

  const scopedDrafts = useMemo(() => {
    const base = scopedDepartment
      ? emailDrafts.filter((d) => d.department === scopedDepartment)
      : emailDrafts;
    return [...base].sort(
      (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    );
  }, [emailDrafts, scopedDepartment]);

  const dashboardMetrics = useMemo(() => {
    const total = scopedLogs.length;
    const sent = scopedLogs.filter(
      (l) => l.status === 'sent' || l.status === 'accepted' || l.status === 'delivered'
    ).length;
    const failed = scopedLogs.filter(
      (l) => l.status === 'failed' || l.status === 'bounced' || l.status === 'rejected' || l.status === 'not_configured'
    ).length;
    const scheduled = scopedLogs.filter((l) => l.status === 'scheduled').length;
    return {
      total,
      sent,
      failed,
      scheduled,
      drafts: scopedDrafts.length,
      campaigns: scopedCampaigns.length,
    };
  }, [scopedLogs, scopedDrafts.length, scopedCampaigns.length]);

  const filteredRecipientsDirectory = useMemo(() => {
    const q = recSearch.trim().toLowerCase();
    return recipients.filter((r) => {
      if (recTypeFilter !== 'all' && r.recipientType !== recTypeFilter) return false;
      if (recStatusFilter !== 'all' && r.status !== recStatusFilter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.companyName || '').toLowerCase().includes(q) ||
        (r.contextLabel || '').toLowerCase().includes(q)
      );
    });
  }, [recipients, recSearch, recTypeFilter, recStatusFilter]);

  const filteredPickerRecipients = useMemo(() => {
    const q = recipientPickerSearch.trim().toLowerCase();
    return recipients
      .filter(
        (r) =>
          !selectedRecipients.some((s) => s.email.toLowerCase() === r.email.toLowerCase()) &&
          (!q ||
            r.name.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q) ||
            r.recipientType.toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [recipients, selectedRecipients, recipientPickerSearch]);

  const sentHistoryLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return scopedLogs.filter((l) => {
      if (subId === 'scheduled' && l.status !== 'scheduled') return false;
      if (
        subId === 'failed' &&
        !['failed', 'bounced', 'rejected', 'deferred', 'not_configured'].includes(l.status)
      ) {
        return false;
      }
      if (logKindFilter !== 'all' && l.kind !== logKindFilter) return false;
      if (logDeptFilter !== 'all' && l.department !== logDeptFilter) return false;
      if (!q) return true;
      return (
        l.recipientEmail.toLowerCase().includes(q) ||
        (l.recipientName || '').toLowerCase().includes(q) ||
        l.subject.toLowerCase().includes(q) ||
        l.eventType.toLowerCase().includes(q)
      );
    });
  }, [scopedLogs, subId, logKindFilter, logDeptFilter, logSearch]);

  const {
    page: logPage,
    setPage: setLogPage,
    pageSize: logPageSize,
    setPageSize: setLogPageSize,
    totalItems: totalLogItems,
    totalPages: totalLogPages,
    pagedItems: pagedLogs,
  } = usePaginatedList(sentHistoryLogs, 12);

  const {
    page: recPage,
    setPage: setRecPage,
    pageSize: recPageSize,
    setPageSize: setRecPageSize,
    totalItems: totalRecItems,
    totalPages: totalRecPages,
    pagedItems: pagedRecipients,
  } = usePaginatedList(filteredRecipientsDirectory, 15);

  const combinedComposerRecipients = useMemo(() => {
    const map = new Map<
      string,
      {
        email: string;
        name?: string;
        uid?: string;
        recipientType: 'user' | 'worker' | 'client' | 'admin' | 'custom';
        vars?: Record<string, string>;
      }
    >();
    for (const r of selectedRecipients) {
      map.set(r.email.toLowerCase(), {
        email: r.email,
        name: r.name,
        uid: r.uid,
        recipientType: r.recipientType,
        vars: {
          client_name: r.name,
          first_name: r.name.split(' ')[0] || r.name,
          last_name: r.name.split(' ').slice(1).join(' '),
          email: r.email,
          department: composerDept || effectiveDepartment,
          account_id: r.uid,
          account_status: r.accountStatus || r.status,
          registration_date: r.registrationDate || '',
          company_name: r.companyName || 'SWAS TASKS',
        },
      });
    }
    for (const e of customEmails) {
      const lower = e.toLowerCase();
      if (!map.has(lower)) {
        map.set(lower, {
          email: lower,
          recipientType: 'custom',
          vars: {
            client_name: lower,
            first_name: lower.split('@')[0] || lower,
            last_name: '',
            email: lower,
            department: composerDept || effectiveDepartment,
            company_name: 'SWAS TASKS',
          },
        });
      }
    }
    return Array.from(map.values());
  }, [selectedRecipients, customEmails, composerDept, effectiveDepartment]);

  const parseEmailCsv = (val: string) =>
    val
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));

  const handleAddCustomEmail = () => {
    const entries = parseEmailCsv(customEmailInput);
    if (entries.length === 0) return;
    setCustomEmails((prev) => Array.from(new Set([...prev, ...entries])));
    setCustomEmailInput('');
  };

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleSaveDraft = async () => {
    setComposerBusy(true);
    setFeedback(null);
    try {
      const cleanHtml = sanitizeClientHtml(editorRef.current?.innerHTML || bodyHtml);
      const res = await saveEmailDraft({
        draftId: activeDraftId,
        department: composerDept,
        recipientEmails: combinedComposerRecipients.map((r) => r.email),
        ccEmails: parseEmailCsv(ccInput),
        bccEmails: parseEmailCsv(bccInput),
        subject: subject.trim() || '(Untitled Draft)',
        htmlBody: cleanHtml,
        textBody: htmlToPlainText(cleanHtml),
        ctaLabel: ctaLabel.trim() || undefined,
        ctaUrl: ctaUrl.trim() || undefined,
        templateId: selectedTemplateId || undefined,
        attachments,
        scheduledFor: scheduleEnabled && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      });
      setActiveDraftId(res.draft.draftId);
      setFeedback({ type: 'ok', text: `Draft saved (${res.draft.draftId}).` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save draft.',
      });
    } finally {
      setComposerBusy(false);
    }
  };

  const handleDispatchFromComposer = async () => {
    const cleanHtml = sanitizeClientHtml(editorRef.current?.innerHTML || bodyHtml);
    const plainText = htmlToPlainText(cleanHtml);
    if (combinedComposerRecipients.length === 0 || !subject.trim() || !plainText) {
      setFeedback({ type: 'err', text: 'Select at least one recipient, a subject, and message body.' });
      setSendConfirmOpen(false);
      return;
    }

    setComposerBusy(true);
    setFeedback(null);
    try {
      const ccEmails = parseEmailCsv(ccInput);
      const bccEmails = parseEmailCsv(bccInput);
      if (scheduleEnabled) {
        if (!scheduledFor) throw new Error('Pick a scheduled date and time.');
        const iso = new Date(scheduledFor).toISOString();
        const res = await schedulePlatformEmail({
          recipients: combinedComposerRecipients,
          ccEmails,
          bccEmails,
          subject: subject.trim(),
          bodyHtml: cleanHtml,
          bodyText: plainText,
          ctaLabel: ctaLabel.trim() || undefined,
          ctaUrl: ctaUrl.trim() || undefined,
          attachments,
          scheduledFor: iso,
          department: composerDept,
          eventType: 'control_centre_scheduled',
        });
        setFeedback({
          type: 'ok',
          text: `Queued ${res.scheduledCount} scheduled email(s) for ${new Date(iso).toLocaleString()}.`,
        });
      } else {
        const res = await dispatchPlatformEmail({
          recipients: combinedComposerRecipients,
          ccEmails,
          bccEmails,
          scope: 'public_website',
          department: composerDept,
          eventType: 'control_centre_manual',
          subject: subject.trim(),
          bodyHtml: cleanHtml,
          bodyText: plainText,
          ctaLabel: ctaLabel.trim() || undefined,
          ctaUrl: ctaUrl.trim() || undefined,
          attachments,
          includeSignature,
          templateId: selectedTemplateId || undefined,
          personalizationVars: combinedComposerRecipients[0]?.vars,
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
            text: res.delivery.error || res.delivery.detail || 'Email delivery failed.',
          });
        } else {
          setFeedback({
            type: 'ok',
            text:
              res.delivery.detail ||
              `Dispatched ${combinedComposerRecipients.length} email(s) via ${OFFICIAL_PLATFORM_EMAIL}.`,
          });
        }
      }
      if (activeDraftId) {
        await deleteEmailDraft(activeDraftId).catch(() => undefined);
        setActiveDraftId(undefined);
      }
      setSendConfirmOpen(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Dispatch failed.',
      });
      setSendConfirmOpen(false);
    } finally {
      setComposerBusy(false);
    }
  };

  const executeSendTestFromComposer = async () => {
    if (!adminProfile?.email) return;
    const cleanHtml = sanitizeClientHtml(editorRef.current?.innerHTML || bodyHtml);
    setComposerBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{
        delivery: { sent: boolean; status: string; detail: string; error?: string };
      }>('/api/v1/admin/email/test', {
        method: 'POST',
        body: JSON.stringify({
          recipientEmail: adminProfile.email,
          subject: subject.trim() || 'SWAS TASKS – Test Preview Email',
          message: htmlToPlainText(cleanHtml) || 'Test email verification from Email Centre.',
        }),
      });
      setFeedback({
        type: res.delivery.sent ? 'ok' : res.delivery.status === 'not_configured' ? 'warn' : 'err',
        text: res.delivery.sent ? res.delivery.detail : res.delivery.error || res.delivery.detail,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Test send failed.',
      });
    } finally {
      setComposerBusy(false);
      setConfirmModal(null);
    }
  };

  const handleSendTestFromComposer = () => {
    if (!adminProfile?.email) return;
    setConfirmModal({
      title: 'Confirm Test Email Dispatch',
      description: `Send a test email from ${OFFICIAL_SENDER_DISPLAY_NAME} <${OFFICIAL_PLATFORM_EMAIL}> to ${adminProfile.email}?`,
      confirmLabel: 'Send Test Email',
      danger: false,
      onConfirm: executeSendTestFromComposer,
    });
  };

  const openTemplateInComposer = (tpl: EmailTemplateRecord) => {
    setSelectedTemplateId(tpl.templateId);
    setSubject(tpl.subject);
    syncEditorFromHtml(tpl.htmlBody);
    setCtaLabel(tpl.ctaLabel || '');
    setCtaUrl(tpl.ctaUrl || '');
    onSelectSub('compose');
  };

  const openDraftInComposer = (draft: EmailDraftRecord) => {
    setActiveDraftId(draft.draftId);
    setSubject(draft.subject);
    syncEditorFromHtml(draft.htmlBody);
    setCtaLabel(draft.ctaLabel || '');
    setCtaUrl(draft.ctaUrl || '');
    setAttachments(draft.attachments || []);
    setCcInput((draft.ccEmails || []).join(', '));
    setBccInput((draft.bccEmails || []).join(', '));
    const matchedRecs: EmailRecipientOption[] = [];
    const leftoverCustom: string[] = [];
    for (const email of draft.recipientEmails || []) {
      const match = recipients.find((r) => r.email.toLowerCase() === email.toLowerCase());
      if (match) matchedRecs.push(match);
      else leftoverCustom.push(email);
    }
    setSelectedRecipients(matchedRecs);
    setCustomEmails(leftoverCustom);
    onSelectSub('compose');
  };

  const handleSaveTemplateForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setTplBusy(true);
    setFeedback(null);
    try {
      const cleanHtml = sanitizeClientHtml(tplHtmlBody);
      await saveEmailTemplate({
        templateId: tplEditingId,
        name: tplName.trim(),
        category: tplCategory,
        department: tplDept,
        subject: tplSubject.trim(),
        htmlBody: cleanHtml,
        textBody: htmlToPlainText(cleanHtml),
        ctaLabel: tplCtaLabel.trim() || undefined,
        ctaUrl: tplCtaUrl.trim() || undefined,
        isActive: true,
      });
      setTplModalOpen(false);
      setFeedback({ type: 'ok', text: `Template "${tplName.trim()}" saved.` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save template.',
      });
    } finally {
      setTplBusy(false);
    }
  };

  const handleLaunchBulkCampaign = (e: React.FormEvent) => {
    e.preventDefault();
    const audienceRecipients =
      campAudience === 'selected'
        ? combinedComposerRecipients
        : recipients
            .filter((r) => {
              if (campAudience === 'all_workers') return r.recipientType === 'worker';
              if (campAudience === 'all_clients') return r.recipientType === 'client';
              return true;
            })
            .map((r) => ({
              email: r.email,
              name: r.name,
              uid: r.uid,
              recipientType: r.recipientType,
              vars: {
                client_name: r.name,
                first_name: r.name.split(' ')[0] || r.name,
                last_name: r.name.split(' ').slice(1).join(' '),
                email: r.email,
                department: effectiveDepartment,
                account_id: r.uid,
                account_status: r.accountStatus || r.status,
                registration_date: r.registrationDate || '',
                company_name: r.companyName || 'SWAS TASKS',
              },
            }));

    if (audienceRecipients.length === 0) {
      setFeedback({ type: 'err', text: 'No live recipients matched the selected campaign audience.' });
      return;
    }

    setConfirmModal({
      title: campScheduledFor ? 'Confirm Scheduled Bulk Campaign' : 'Confirm Bulk Email Campaign',
      description: `${campScheduledFor ? 'Schedule' : 'Dispatch'} "${campName.trim()}" to ${audienceRecipients.length} live recipient(s) via ${OFFICIAL_SENDER_DISPLAY_NAME} <${OFFICIAL_PLATFORM_EMAIL}>?`,
      confirmLabel: campScheduledFor ? 'Confirm & Schedule' : 'Confirm & Launch',
      danger: false,
      onConfirm: async () => {
        setCampBusy(true);
        setFeedback(null);
        try {
          const cleanHtml = sanitizeClientHtml(campBodyHtml);
          const res = await sendBulkEmailCampaign({
            name: campName.trim(),
            department: effectiveDepartment,
            audienceFilter: campAudience,
            recipients: audienceRecipients,
            subject: campSubject.trim(),
            bodyHtml: cleanHtml,
            bodyText: htmlToPlainText(cleanHtml),
            includeSignature: true,
            scheduledFor: campScheduledFor ? new Date(campScheduledFor).toISOString() : undefined,
          });
          setFeedback({
            type: res.campaign.status === 'failed' ? 'err' : res.campaign.status === 'partially_failed' ? 'warn' : 'ok',
            text: `Campaign "${res.campaign.name}" status: ${res.campaign.status} (${res.campaign.sentCount}/${res.campaign.totalRecipients} sent).`,
          });
          setCampName('');
          setCampSubject('');
          setCampBodyHtml('');
          setCampScheduledFor('');
        } catch (err) {
          setFeedback({
            type: 'err',
            text: err instanceof Error ? err.message : 'Bulk campaign dispatch failed.',
          });
        } finally {
          setCampBusy(false);
          setConfirmModal(null);
        }
      },
    });
  };

  const handleRetryLogClick = (log: EmailLogRecord) => {
    setConfirmModal({
      title: 'Confirm Email Retry',
      description: `Retry sending "${log.subject}" to ${log.recipientEmail} via ${OFFICIAL_SENDER_DISPLAY_NAME} <${OFFICIAL_PLATFORM_EMAIL}>?`,
      confirmLabel: 'Confirm & Retry',
      danger: false,
      onConfirm: async () => {
        setRetryingLogId(log.emailLogId);
        setFeedback(null);
        try {
          const res = await retryEmailLog(log.emailLogId);
          setFeedback({
            type: res.delivery.status === 'sent' ? 'ok' : res.delivery.status === 'not_configured' ? 'warn' : 'err',
            text:
              (res.delivery.sent ? res.delivery.detail : res.delivery.error || res.delivery.detail) ||
              `Retry completed with status '${res.delivery.status}'.`,
          });
        } catch (err) {
          setFeedback({
            type: 'err',
            text: err instanceof Error ? err.message : 'Retry failed.',
          });
        } finally {
          setRetryingLogId(null);
          setConfirmModal(null);
        }
      },
    });
  };

  const handleExportLogsCsv = () => {
    exportRecordsToCsv(
      `swas_email_logs_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Log ID', 'Department', 'Kind', 'Event', 'Recipient', 'Subject', 'Status', 'Error', 'Created At'],
      sentHistoryLogs.map((l) => [
        l.emailLogId,
        l.department || 'all',
        l.kind || 'automatic',
        l.eventType,
        l.recipientEmail,
        l.subject,
        l.status,
        l.errorDetail || '',
        l.createdAt,
      ])
    );
  };

  const visibleSubTabs = EMAIL_CENTRE_SUBDEPARTMENTS.filter((t) => {
    if (t.id === 'compose' && !canCompose) return false;
    if (t.id === 'campaigns' && !canSendBulk) return false;
    if (t.id === 'reports' && !canViewReports) return false;
    if (t.id === 'settings' && !canManageSettings) return false;
    return true;
  });

  const activeTabLabel =
    EMAIL_CENTRE_SUBDEPARTMENTS.find((s) => s.id === subId)?.label || 'Email Dashboard';

  const composerPreviewSrcDoc = buildEmailPreviewSrcDoc({
    subject: subject || '(No Subject)',
    bodyHtml: editorRef.current?.innerHTML || bodyHtml,
    ctaLabel,
    ctaUrl,
    signatureHtml,
    footerText,
    includeSignature,
  });

  const effectiveEmailConfigured = Boolean(messagingStatus?.emailConfigured || gmailConn.connected);
  const effectiveProviderLabel = gmailConn.connected
    ? `Gmail OAuth (${OFFICIAL_PLATFORM_EMAIL})`
    : messagingStatus?.emailConfigured
    ? messagingStatus.emailProvider
    : 'EMAIL SERVICE NOT CONFIGURED';

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#E9F2FF] border border-[#1265C8]/20 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-[#1265C8]" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="typo-page-heading text-[#172B46]">
                {scopedDepartment
                  ? `${EIGHT_DEPARTMENTS.find((d) => d.id === scopedDepartment)?.label || scopedDepartment} Email Centre`
                  : 'SWAS TASKS Email Communication Centre'}
              </h1>
              <StatusText
                status={effectiveEmailConfigured ? 'connected' : 'not_configured'}
                label={effectiveProviderLabel}
              />
            </div>
            <p className="typo-meta text-[#75869D] mt-0.5">
              Unified platform messaging via{' '}
              <span className="font-mono text-[#172B46]">
                {OFFICIAL_SENDER_DISPLAY_NAME} &lt;{OFFICIAL_PLATFORM_EMAIL}&gt;
              </span>{' '}
              · Active Section: <strong className="text-[#172B46]">{activeTabLabel}</strong>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadStatusAndRecipients()}
            className="inline-flex items-center gap-1.5 px-3 py-2 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] hover:bg-slate-200 border border-slate-200 rounded-md"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingRecipients ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {canCompose ? (
            <button
              type="button"
              onClick={() => onSelectSub('compose')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
            >
              <FilePlus2 className="w-4 h-4" />
              Compose Email
            </button>
          ) : null}
        </div>
      </div>

      {/* Horizontal Sub-Navigation */}
      <div className="bg-white border border-slate-200 rounded-lg p-2 flex flex-wrap gap-1.5">
        {visibleSubTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectSub(tab.id)}
            className={`px-3 py-1.5 typo-meta font-medium rounded-md transition-colors ${
              subId === tab.id
                ? 'bg-[#1265C8] text-white'
                : 'text-[#172B46] hover:bg-[#F3F6FA]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {messagingStatus && !effectiveEmailConfigured ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#B7791F] shrink-0 mt-0.5" />
            <div className="typo-meta text-[#172B46]">
              <p className="font-semibold">EMAIL SERVICE NOT CONFIGURED</p>
              <p className="text-[#75869D] mt-0.5">
                Connect <span className="font-mono text-[#172B46]">{OFFICIAL_PLATFORM_EMAIL}</span> in{' '}
                <strong>Email Settings</strong> to send live emails via Gmail OAuth, or configure server-side{' '}
                <span className="font-mono text-[#172B46]">GMAIL_SMTP_USER</span> and{' '}
                <span className="font-mono text-[#172B46]">GMAIL_APP_PASSWORD</span>.
              </p>
            </div>
          </div>
          {canManageSettings ? (
            <button
              type="button"
              onClick={() => onSelectSub('settings')}
              className="px-3 py-1.5 typo-meta font-semibold text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md shrink-0"
            >
              Connect Gmail in Settings
            </button>
          ) : null}
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`p-3 rounded-md typo-meta border flex items-center justify-between gap-2 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-[#15966B]'
              : feedback.type === 'warn'
              ? 'bg-amber-50 border-amber-200 text-[#B7791F]'
              : 'bg-red-50 border-red-200 text-[#D34552]'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss notice">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : null}

      {/* 1. DASHBOARD */}
      {subId === 'dashboard' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            {[
              { label: 'Total Logged', val: dashboardMetrics.total, tone: 'text-[#172B46]' },
              { label: 'Sent / Accepted', val: dashboardMetrics.sent, tone: 'text-[#15966B]' },
              { label: 'Failed / Unconfigured', val: dashboardMetrics.failed, tone: 'text-[#D34552]' },
              { label: 'Scheduled Queue', val: dashboardMetrics.scheduled, tone: 'text-[#1265C8]' },
              { label: 'Saved Drafts', val: dashboardMetrics.drafts, tone: 'text-[#172B46]' },
              { label: 'Bulk Campaigns', val: dashboardMetrics.campaigns, tone: 'text-[#172B46]' },
            ].map((card) => (
              <div key={card.label} className="bg-white border border-slate-200 rounded-lg p-4">
                <p className="typo-meta text-[#75869D]">{card.label}</p>
                <p className={`typo-page-heading tabular-nums mt-1 ${card.tone}`}>{card.val}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="typo-card-heading text-[#172B46]">Recent Email Activity</h2>
                <button
                  type="button"
                  onClick={() => onSelectSub('sent')}
                  className="typo-meta font-medium text-[#1265C8] hover:underline"
                >
                  View All Logs
                </button>
              </div>
              {scopedLogs.length === 0 ? (
                <EmptyState
                  title="No Emails Recorded Yet"
                  description="Emails dispatched automatically by workflows or manually via Compose will appear here."
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {scopedLogs.slice(0, 7).map((log) => (
                    <div
                      key={log.emailLogId}
                      className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#F3F6FA]/50 cursor-pointer"
                      onClick={() => setInspectingLog(log)}
                    >
                      <div className="min-w-0">
                        <p className="typo-body font-medium text-[#172B46] truncate">
                          {log.subject}
                        </p>
                        <p className="typo-small text-[#75869D] truncate">
                          {log.recipientEmail} · {log.kind || 'automatic'} ·{' '}
                          <span className="font-mono">{log.department || 'all'}</span>
                        </p>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <StatusText status={log.status} />
                        <p className="typo-small tabular-nums text-[#75869D]">
                          {new Date(log.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 h-fit">
              <h2 className="typo-card-heading text-[#172B46]">Quick Actions</h2>
              <div className="space-y-2">
                {canCompose ? (
                  <button
                    type="button"
                    onClick={() => onSelectSub('compose')}
                    className="w-full px-3 py-2.5 text-left rounded-md border border-slate-200 hover:border-[#1265C8] hover:bg-[#E9F2FF]/40 typo-meta font-medium text-[#172B46]"
                  >
                    Compose Individual or Group Email
                  </button>
                ) : null}
                {canSendBulk ? (
                  <button
                    type="button"
                    onClick={() => onSelectSub('campaigns')}
                    className="w-full px-3 py-2.5 text-left rounded-md border border-slate-200 hover:border-[#1265C8] hover:bg-[#E9F2FF]/40 typo-meta font-medium text-[#172B46]"
                  >
                    Launch Bulk Announcement Campaign
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onSelectSub('templates')}
                  className="w-full px-3 py-2.5 text-left rounded-md border border-slate-200 hover:border-[#1265C8] hover:bg-[#E9F2FF]/40 typo-meta font-medium text-[#172B46]"
                >
                  Browse Templates ({scopedTemplates.length})
                </button>
                <button
                  type="button"
                  onClick={() => onSelectSub('failed')}
                  className="w-full px-3 py-2.5 text-left rounded-md border border-slate-200 hover:border-[#1265C8] hover:bg-[#E9F2FF]/40 typo-meta font-medium text-[#172B46]"
                >
                  Inspect Failed & Retries ({dashboardMetrics.failed})
                </button>
              </div>
              <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 typo-small text-[#75869D]">
                Live eligible recipients in scope:{' '}
                <strong className="text-[#172B46]">{recipients.length}</strong>
              </div>
            </div>
          </div>
        </div>
      ) : subId === 'compose' ? (
        /* 2. COMPOSE EMAIL */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="typo-card-heading text-[#172B46]">Email Composer</h2>
              <div className="flex items-center gap-2">
                <select
                  value={selectedTemplateId}
                  onChange={(e) => {
                    const tpl = scopedTemplates.find((t) => t.templateId === e.target.value);
                    setSelectedTemplateId(e.target.value);
                    if (tpl) openTemplateInComposer(tpl);
                  }}
                  className="px-2.5 py-1.5 typo-meta border border-slate-300 rounded-md bg-white"
                >
                  <option value="">Insert Saved Template...</option>
                  {scopedTemplates.map((t) => (
                    <option key={t.templateId} value={t.templateId}>
                      [{t.category}] {t.name}
                    </option>
                  ))}
                </select>
                {!scopedDepartment && isSuperAdmin ? (
                  <select
                    value={composerDept}
                    onChange={(e) => setComposerDept(e.target.value)}
                    className="px-2.5 py-1.5 typo-meta border border-slate-300 rounded-md bg-white"
                  >
                    <option value="all">Scope: All Departments</option>
                    {EIGHT_DEPARTMENTS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>

            {/* Selected Recipients Chips + Custom Email Input */}
            <div className="space-y-2">
              <label className="block typo-label text-[#172B46]">
                To Recipients ({combinedComposerRecipients.length})
              </label>
              <div className="flex flex-wrap gap-1.5 min-h-[38px] p-2 rounded-md border border-slate-300 bg-[#F3F6FA]">
                {selectedRecipients.map((r) => (
                  <span
                    key={r.email}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#E9F2FF] border border-[#1265C8]/30 typo-small text-[#172B46]"
                  >
                    <span>
                      {r.name} &lt;{r.email}&gt;
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedRecipients((prev) => prev.filter((item) => item.email !== r.email))
                      }
                      aria-label={`Remove ${r.email}`}
                    >
                      <X className="w-3 h-3 text-[#75869D] hover:text-[#D34552]" />
                    </button>
                  </span>
                ))}
                {customEmails.map((em) => (
                  <span
                    key={em}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-300 typo-small text-[#172B46]"
                  >
                    <span>{em}</span>
                    <button
                      type="button"
                      onClick={() => setCustomEmails((prev) => prev.filter((item) => item !== em))}
                      aria-label={`Remove ${em}`}
                    >
                      <X className="w-3 h-3 text-[#75869D] hover:text-[#D34552]" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customEmailInput}
                  onChange={(e) => setCustomEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomEmail();
                    }
                  }}
                  placeholder="Add external email(s), comma-separated, then press Add"
                  className="flex-1 px-3 py-1.5 typo-input border border-slate-300 rounded-md"
                />
                <button
                  type="button"
                  onClick={handleAddCustomEmail}
                  className="px-3 py-1.5 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] hover:bg-slate-200 border border-slate-200 rounded-md"
                >
                  Add Email
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">CC (Optional)</label>
                <input
                  type="text"
                  value={ccInput}
                  onChange={(e) => setCcInput(e.target.value)}
                  placeholder="cc1@domain.com, cc2@domain.com"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">BCC (Optional)</label>
                <input
                  type="text"
                  value={bccInput}
                  onChange={(e) => setBccInput(e.target.value)}
                  placeholder="bcc@domain.com"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">Email Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="SWAS TASKS – Official Notice"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>

            {/* Rich Text Toolbar & Sanitized Editor */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <label className="typo-label text-[#172B46]">Email Content</label>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => applyRichCommand('bold')}
                    className="p-1.5 rounded border border-slate-200 hover:bg-[#F3F6FA]"
                    title="Bold"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRichCommand('italic')}
                    className="p-1.5 rounded border border-slate-200 hover:bg-[#F3F6FA]"
                    title="Italic"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRichCommand('underline')}
                    className="p-1.5 rounded border border-slate-200 hover:bg-[#F3F6FA]"
                    title="Underline"
                  >
                    <Underline className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRichCommand('insertUnorderedList')}
                    className="p-1.5 rounded border border-slate-200 hover:bg-[#F3F6FA]"
                    title="Bullet List"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRichCommand('formatBlock', 'h3')}
                    className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 hover:bg-[#F3F6FA]"
                    title="Heading"
                  >
                    H3
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = window.prompt('Enter https:// link URL:');
                      if (url && /^https?:\/\//i.test(url.trim())) {
                        applyRichCommand('createLink', url.trim());
                      }
                    }}
                    className="p-1.5 rounded border border-slate-200 hover:bg-[#F3F6FA]"
                    title="Insert Link"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => setBodyHtml(sanitizeClientHtml(e.currentTarget.innerHTML))}
                className="min-h-[180px] max-h-[340px] overflow-y-auto p-3 border border-slate-300 rounded-md typo-body text-[#172B46] bg-white focus:outline-none focus:border-[#1265C8]"
              />

              <div className="flex flex-wrap gap-1.5 mt-2">
                {PERSONALIZATION_VARIABLES.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() => insertTokenIntoComposer(v.token)}
                    className="px-2 py-0.5 text-[11px] font-mono bg-[#F3F6FA] hover:bg-[#E9F2FF] text-[#1265C8] border border-slate-200 rounded"
                    title={`Insert ${v.label}`}
                  >
                    {v.token}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">CTA Label (Optional)</label>
                <input
                  type="text"
                  value={ctaLabel}
                  onChange={(e) => setCtaLabel(e.target.value)}
                  placeholder="View in SWAS TASKS"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">CTA URL (Optional)</label>
                <input
                  type="url"
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                  placeholder="https://swastasks.example.com/..."
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] hover:bg-slate-200 border border-slate-200 rounded-md cursor-pointer">
                  <FileUp className="w-3.5 h-3.5 text-[#1265C8]" />
                  {uploadingAtt ? 'Uploading...' : 'Attach File'}
                  <input
                    type="file"
                    accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
                    onChange={(e) => void handleAttachmentUpload(e)}
                    disabled={uploadingAtt}
                    className="hidden"
                  />
                </label>

                <label className="inline-flex items-center gap-1.5 typo-meta text-[#172B46]">
                  <input
                    type="checkbox"
                    checked={includeSignature}
                    onChange={(e) => setIncludeSignature(e.target.checked)}
                  />
                  <span>Official Signature</span>
                </label>

                {canSchedule ? (
                  <label className="inline-flex items-center gap-1.5 typo-meta text-[#172B46]">
                    <input
                      type="checkbox"
                      checked={scheduleEnabled}
                      onChange={(e) => setScheduleEnabled(e.target.checked)}
                    />
                    <CalendarClock className="w-3.5 h-3.5 text-[#1265C8]" />
                    <span>Schedule</span>
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
            </div>

            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att, idx) => (
                  <span
                    key={`${att.name}_${idx}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#F3F6FA] border border-slate-200 typo-small text-[#172B46]"
                  >
                    <span>{att.name}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label="Remove attachment"
                    >
                      <X className="w-3 h-3 text-[#D34552]" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={composerBusy}
                  onClick={() => void handleSaveDraft()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] hover:bg-slate-200 border border-slate-200 rounded-md"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 typo-meta font-medium text-[#1265C8] border border-[#1265C8]/30 hover:bg-[#E9F2FF] rounded-md"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview
                </button>
                <button
                  type="button"
                  disabled={composerBusy}
                  onClick={() => void handleSendTestFromComposer()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 typo-meta font-medium text-[#172B46] border border-slate-300 hover:bg-slate-100 rounded-md"
                >
                  <Send className="w-3.5 h-3.5" />
                  Test to Myself
                </button>
              </div>

              <button
                type="button"
                disabled={!canSend || composerBusy || combinedComposerRecipients.length === 0 || !subject.trim()}
                onClick={() => setSendConfirmOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {scheduleEnabled ? 'Review & Schedule' : 'Review & Send'}
              </button>
            </div>
          </div>

          {/* Right Column: Live Platform Recipient Picker */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-3 h-fit">
            <div className="flex items-center justify-between gap-2">
              <h3 className="typo-card-heading text-[#172B46]">Platform Recipients</h3>
              <span className="typo-small font-semibold text-[#1265C8]">
                {recipients.length} live
              </span>
            </div>
            <input
              type="text"
              value={recipientPickerSearch}
              onChange={(e) => setRecipientPickerSearch(e.target.value)}
              placeholder="Search workers, clients, staff..."
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
            />
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {filteredPickerRecipients.length === 0 ? (
                <p className="typo-meta text-[#75869D] py-4 text-center">
                  No matching live recipients available.
                </p>
              ) : (
                filteredPickerRecipients.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRecipients((prev) => [...prev, r])}
                    className="w-full py-2.5 text-left hover:bg-[#F3F6FA] px-2 rounded flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="typo-meta font-medium text-[#172B46] truncate">{r.name}</p>
                      <p className="typo-small text-[#75869D] truncate">{r.email}</p>
                      <p className="typo-small text-[#1265C8] uppercase">{r.recipientType}</p>
                    </div>
                    <Plus className="w-4 h-4 text-[#1265C8] shrink-0 mt-1" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : subId === 'recipients' ? (
        /* 3. RECIPIENTS DIRECTORY */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="typo-card-heading text-[#172B46]">Live Recipient Directory</h2>
              <p className="typo-meta text-[#75869D]">
                Synchronized directly from Firestore workers, clients, users, and authorized staff.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#75869D] absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={recSearch}
                  onChange={(e) => {
                    setRecSearch(e.target.value);
                    setRecPage(1);
                  }}
                  placeholder="Search name, email, company..."
                  className="pl-8 pr-3 py-1.5 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <select
                value={recTypeFilter}
                onChange={(e) => {
                  setRecTypeFilter(e.target.value as 'all' | 'worker' | 'client' | 'user' | 'admin');
                  setRecPage(1);
                }}
                className="px-2.5 py-1.5 typo-meta border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Types</option>
                <option value="worker">Workers</option>
                <option value="client">Clients</option>
                <option value="user">Users</option>
                <option value="admin">Admins & Staff</option>
              </select>
              <select
                value={recStatusFilter}
                onChange={(e) => {
                  setRecStatusFilter(e.target.value);
                  setRecPage(1);
                }}
                className="px-2.5 py-1.5 typo-meta border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="suspended">Suspended</option>
                <option value="restricted">Restricted</option>
              </select>
              {canCompose && selectedRecipients.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onSelectSub('compose')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-white bg-[#1265C8] rounded-md"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Compose to Selected ({selectedRecipients.length})
                </button>
              ) : null}
            </div>
          </div>

          {pagedRecipients.length === 0 ? (
            <EmptyState
              title="No Matching Recipients"
              description="Adjust your search filter or wait for platform accounts to register."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Select</th>
                      <th className="px-4 py-3 font-medium">Name & Company</th>
                      <th className="px-4 py-3 font-medium">Email & Phone</th>
                      <th className="px-4 py-3 font-medium">Role / Type</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagedRecipients.map((r) => {
                      const isChecked = selectedRecipients.some(
                        (s) => s.email.toLowerCase() === r.email.toLowerCase()
                      );
                      return (
                        <tr key={r.id} className="hover:bg-[#F3F6FA]/60">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                setSelectedRecipients((prev) =>
                                  e.target.checked
                                    ? [...prev, r]
                                    : prev.filter((item) => item.email !== r.email)
                                );
                              }}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-[#172B46]">{r.name}</p>
                            <p className="typo-small text-[#75869D]">{r.companyName || r.contextLabel || 'SWAS TASKS'}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-mono typo-meta text-[#172B46]">{r.email}</p>
                            {r.phone ? (
                              <p className="typo-small tabular-nums text-[#75869D]">{r.phone}</p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 uppercase typo-small font-semibold text-[#1265C8]">
                            {r.recipientType}
                          </td>
                          <td className="px-4 py-3">
                            <StatusText status={r.status} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            {canCompose ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedRecipients([r]);
                                  onSelectSub('compose');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 typo-small font-medium text-[#1265C8] border border-[#1265C8]/30 hover:bg-[#E9F2FF] rounded"
                              >
                                <Mail className="w-3 h-3" />
                                Email
                              </button>
                            ) : (
                              <span className="typo-small text-[#75869D]">View Only</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination
                page={recPage}
                pageSize={recPageSize}
                totalItems={totalRecItems}
                totalPages={totalRecPages}
                onPageChange={setRecPage}
                onPageSizeChange={setRecPageSize}
              />
            </>
          )}
        </div>
      ) : subId === 'templates' ? (
        /* 4. EMAIL TEMPLATES */
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="typo-card-heading text-[#172B46]">Reusable Email Templates</h2>
              <p className="typo-meta text-[#75869D]">
                Create, duplicate, preview, and reuse official branded templates with variable placeholders.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={tplCategoryFilter}
                onChange={(e) => setTplCategoryFilter(e.target.value)}
                className="px-3 py-1.5 typo-meta border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Categories</option>
                {TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {canManageTemplates ? (
                <button
                  type="button"
                  onClick={() => {
                    setTplEditingId(undefined);
                    setTplName('');
                    setTplCategory('General Announcements');
                    setTplDept(scopedDepartment || 'all');
                    setTplSubject('');
                    setTplHtmlBody('<p>Hello {{client_name}},</p><p>Write your template message here.</p>');
                    setTplCtaLabel('');
                    setTplCtaUrl('');
                    setTplModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
                >
                  <Plus className="w-4 h-4" />
                  New Template
                </button>
              ) : null}
            </div>
          </div>

          {scopedTemplates.filter((t) => tplCategoryFilter === 'all' || t.category === tplCategoryFilter)
            .length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg">
              <EmptyState
                title="No Saved Templates"
                description="Create reusable templates for announcements, account updates, payment notifications, or policy notices."
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {scopedTemplates
                .filter((t) => tplCategoryFilter === 'all' || t.category === tplCategoryFilter)
                .map((tpl) => (
                  <div
                    key={tpl.templateId}
                    className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="typo-small font-semibold text-[#1265C8]">
                          {tpl.category}
                        </span>
                        <span className="font-mono typo-small text-[#75869D]">
                          {tpl.department}
                        </span>
                      </div>
                      <h3 className="typo-card-heading text-[#172B46]">{tpl.name}</h3>
                      <p className="typo-meta font-medium text-[#172B46] truncate">
                        Subject: {tpl.subject}
                      </p>
                      <p className="typo-small text-[#75869D] line-clamp-3">
                        {tpl.textBody || htmlToPlainText(tpl.htmlBody)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                      <span className="typo-small text-[#75869D]">
                        Used {tpl.usageCount || 0}×
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {canCompose ? (
                          <button
                            type="button"
                            onClick={() => openTemplateInComposer(tpl)}
                            className="px-2.5 py-1 typo-small font-medium text-white bg-[#1265C8] rounded"
                          >
                            Use Template
                          </button>
                        ) : null}
                        {canManageTemplates ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setTplEditingId(tpl.templateId);
                                setTplName(tpl.name);
                                setTplCategory(tpl.category);
                                setTplDept(tpl.department);
                                setTplSubject(tpl.subject);
                                setTplHtmlBody(tpl.htmlBody);
                                setTplCtaLabel(tpl.ctaLabel || '');
                                setTplCtaUrl(tpl.ctaUrl || '');
                                setTplModalOpen(true);
                              }}
                              className="px-2 py-1 typo-small font-medium text-[#172B46] border border-slate-300 rounded"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setTplEditingId(undefined);
                                setTplName(`${tpl.name} (Copy)`);
                                setTplCategory(tpl.category);
                                setTplDept(tpl.department);
                                setTplSubject(tpl.subject);
                                setTplHtmlBody(tpl.htmlBody);
                                setTplCtaLabel(tpl.ctaLabel || '');
                                setTplCtaUrl(tpl.ctaUrl || '');
                                setTplModalOpen(true);
                              }}
                              className="p-1 text-[#75869D] hover:text-[#172B46]"
                              title="Duplicate"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  title: 'Delete Email Template',
                                  description: `Delete "${tpl.name}" permanently from Firestore email_templates?`,
                                  confirmLabel: 'Delete Template',
                                  danger: true,
                                  onConfirm: async () => {
                                    await deleteEmailTemplate(tpl.templateId);
                                    setConfirmModal(null);
                                  },
                                })
                              }
                              className="p-1 text-[#D34552]"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : subId === 'campaigns' ? (
        /* 5. BULK CAMPAIGNS */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form
            onSubmit={handleLaunchBulkCampaign}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4 h-fit"
          >
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#1265C8]" />
              <h2 className="typo-card-heading text-[#172B46]">Create Bulk Campaign</h2>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">Campaign Title</label>
              <input
                type="text"
                required
                value={campName}
                onChange={(e) => setCampName(e.target.value)}
                placeholder="May Policy & Payout Notice"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">Audience Segment</label>
              <select
                value={campAudience}
                onChange={(e) =>
                  setCampAudience(
                    e.target.value as 'selected' | 'all_workers' | 'all_clients' | 'all_users'
                  )
                }
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
              >
                <option value="all_workers">
                  All Workers ({recipients.filter((r) => r.recipientType === 'worker').length})
                </option>
                <option value="all_clients">
                  All Clients ({recipients.filter((r) => r.recipientType === 'client').length})
                </option>
                <option value="all_users">All Platform Accounts ({recipients.length})</option>
                <option value="selected">
                  Currently Selected Recipients ({combinedComposerRecipients.length})
                </option>
              </select>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">Subject Line</label>
              <input
                type="text"
                required
                value={campSubject}
                onChange={(e) => setCampSubject(e.target.value)}
                placeholder="SWAS TASKS – Important Platform Announcement"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Campaign Body (Supports {'{{client_name}}'}, {'{{email}}'})
              </label>
              <textarea
                rows={5}
                required
                value={campBodyHtml}
                onChange={(e) => setCampBodyHtml(e.target.value)}
                placeholder="<p>Hello {{client_name}},</p><p>Share your official update here.</p>"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>

            {canSchedule ? (
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Schedule Send Time (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={campScheduledFor}
                  onChange={(e) => setCampScheduledFor(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!canSendBulk || campBusy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {campBusy
                ? 'Dispatching Campaign...'
                : campScheduledFor
                ? 'Schedule Bulk Campaign'
                : 'Send Bulk Campaign'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="typo-card-heading text-[#172B46]">Bulk Campaign Ledger</h2>
            </div>
            {scopedCampaigns.length === 0 ? (
              <EmptyState
                title="No Bulk Campaigns Sent"
                description="Use the bulk campaign builder to dispatch segmented platform notices."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Campaign</th>
                      <th className="px-4 py-3 font-medium">Progress</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {scopedCampaigns.map((camp) => (
                      <tr key={camp.campaignId} className="hover:bg-[#F3F6FA]/60">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{camp.name}</p>
                          <p className="typo-small text-[#75869D] truncate max-w-xs">
                            {camp.subject}
                          </p>
                        </td>
                        <td className="px-4 py-3 tabular-nums typo-meta text-[#172B46]">
                          {camp.sentCount}/{camp.totalRecipients} sent · {camp.failedCount} failed
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={camp.status} />
                        </td>
                        <td className="px-4 py-3 typo-small tabular-nums text-[#75869D]">
                          {new Date(camp.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {camp.failedCount > 0 && canRetryFailed ? (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  title: 'Confirm Campaign Retry',
                                  description: `Retry ${camp.failedCount} failed recipient(s) for campaign "${camp.name}" via ${OFFICIAL_PLATFORM_EMAIL}?`,
                                  confirmLabel: 'Retry Failed Emails',
                                  danger: false,
                                  onConfirm: async () => {
                                    try {
                                      await retryEmailCampaign(camp.campaignId);
                                      setFeedback({
                                        type: 'ok',
                                        text: `Retried failed emails for campaign "${camp.name}".`,
                                      });
                                    } catch (err) {
                                      setFeedback({
                                        type: 'err',
                                        text: err instanceof Error ? err.message : 'Campaign retry failed.',
                                      });
                                    } finally {
                                      setConfirmModal(null);
                                    }
                                  },
                                })
                              }
                              className="text-xs font-medium text-[#1265C8] hover:underline"
                            >
                              Retry Failed
                            </button>
                          ) : null}
                          {camp.status === 'scheduled' || camp.status === 'queued' ? (
                            <button
                              type="button"
                              onClick={() => void cancelEmailCampaign(camp.campaignId)}
                              className="text-xs font-medium text-[#D34552] hover:underline"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : subId === 'drafts' ? (
        /* 8. DRAFTS */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">Saved Email Drafts</h2>
          </div>
          {scopedDrafts.length === 0 ? (
            <EmptyState
              title="No Saved Drafts"
              description="Save any in-progress email from the Compose tab to resume editing later."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {scopedDrafts.map((d) => (
                <div
                  key={d.draftId}
                  className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F3F6FA]/50"
                >
                  <div className="min-w-0">
                    <p className="typo-body font-semibold text-[#172B46] truncate">{d.subject}</p>
                    <p className="typo-small text-[#75869D]">
                      Recipients: {(d.recipientEmails || []).join(', ') || 'None selected'} · Updated{' '}
                      {new Date(d.updatedAt || d.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canCompose ? (
                      <button
                        type="button"
                        onClick={() => openDraftInComposer(d)}
                        className="px-3 py-1.5 typo-small font-medium text-white bg-[#1265C8] rounded"
                      >
                        Resume Draft
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          title: 'Delete Email Draft',
                          description: `Delete draft "${d.subject}"?`,
                          confirmLabel: 'Delete Draft',
                          danger: true,
                          onConfirm: async () => {
                            await deleteEmailDraft(d.draftId);
                            setConfirmModal(null);
                          },
                        })
                      }
                      className="px-2.5 py-1.5 typo-small font-medium text-[#D34552] border border-[#D34552]/30 rounded"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : subId === 'reports' ? (
        /* 9. ANALYTICS & REPORTS */
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="typo-card-heading text-[#172B46]">Email Analytics & Delivery Reports</h2>
              <p className="typo-meta text-[#75869D]">
                Aggregated strictly from verified Firestore <span className="font-mono">email_logs</span> and{' '}
                <span className="font-mono">email_campaigns</span>.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void loadReports()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] border border-slate-200 rounded-md"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingReports ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={handleExportLogsCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-meta font-medium text-white bg-[#102B50] rounded-md"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>
          </div>

          {reportsData ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-lg p-4">
                  <p className="typo-meta text-[#75869D]">Delivery Success Rate</p>
                  <p className="typo-page-heading text-[#15966B] tabular-nums mt-1">
                    {reportsData.metrics.deliverySuccessRate}%
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-4">
                  <p className="typo-meta text-[#75869D]">Bounce Rate</p>
                  <p className="typo-page-heading text-[#D34552] tabular-nums mt-1">
                    {reportsData.metrics.bounceRate}%
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-4">
                  <p className="typo-meta text-[#75869D]">Confirmed Delivered</p>
                  <p className="typo-page-heading text-[#172B46] tabular-nums mt-1">
                    {reportsData.metrics.confirmedDelivered}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-4">
                  <p className="typo-meta text-[#75869D]">Active Templates</p>
                  <p className="typo-page-heading text-[#1265C8] tabular-nums mt-1">
                    {reportsData.metrics.templateCount}
                  </p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="typo-card-heading text-[#172B46]">Daily Send Volume (Last 14 Days)</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full typo-table">
                    <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Date</th>
                        <th className="px-4 py-2.5 font-medium">Sent / Accepted</th>
                        <th className="px-4 py-2.5 font-medium">Failed / Unconfigured</th>
                        <th className="px-4 py-2.5 font-medium">Scheduled</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportsData.volumeByDay.map((row) => (
                        <tr key={row.date}>
                          <td className="px-4 py-2 font-mono typo-meta text-[#172B46]">{row.date}</td>
                          <td className="px-4 py-2 tabular-nums text-[#15966B] font-semibold">
                            {row.sent}
                          </td>
                          <td className="px-4 py-2 tabular-nums text-[#D34552]">{row.failed}</td>
                          <td className="px-4 py-2 tabular-nums text-[#1265C8]">{row.scheduled}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center typo-meta text-[#75869D]">
              {loadingReports ? 'Loading analytics...' : 'Analytics ready on refresh.'}
            </div>
          )}
        </div>
      ) : subId === 'settings' ? (
        /* 10. EMAIL SETTINGS */
        <CentralEmailSettingsPanel
          adminProfile={adminProfile}
          canEdit={canManageSettings}
          settingsDocs={settingsDocs}
          emailLogs={scopedLogs}
        />
      ) : subId === 'permissions' ? (
        /* 11. PERMISSIONS MATRIX */
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#1265C8]" />
            <div>
              <h2 className="typo-card-heading text-[#172B46]">Email Communication Permissions Matrix</h2>
              <p className="typo-meta text-[#75869D]">
                Your current account capabilities enforced server-side and in Firestore rules.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {EMAIL_GRANULAR_PERMISSIONS.map((perm) => {
              const allowed = hasEmailPermission(perm.id);
              return (
                <div
                  key={perm.id}
                  className={`p-3.5 rounded-md border ${
                    allowed ? 'bg-emerald-50/40 border-emerald-200' : 'bg-[#F3F6FA] border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-[#172B46]">
                      {perm.label}
                    </span>
                    <StatusText
                      status={allowed ? 'active' : 'inactive'}
                      label={allowed ? 'Granted' : 'Restricted'}
                    />
                  </div>
                  <p className="typo-small text-[#75869D] mt-1">{perm.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* 6 & 7. SCHEDULED / SENT HISTORY / FAILED & RETRIES */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="typo-card-heading text-[#172B46]">{activeTabLabel}</h2>
              <p className="typo-meta text-[#75869D]">
                Click any row to inspect rendered email content, provider diagnostics, and timestamps.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#75869D] absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => {
                    setLogSearch(e.target.value);
                    setLogPage(1);
                  }}
                  placeholder="Search recipient, subject..."
                  className="pl-8 pr-3 py-1.5 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <select
                value={logKindFilter}
                onChange={(e) => {
                  setLogKindFilter(e.target.value as 'all' | 'automatic' | 'manual' | 'scheduled' | 'bulk');
                  setLogPage(1);
                }}
                className="px-2.5 py-1.5 typo-meta border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Types</option>
                <option value="automatic">Automatic Workflow</option>
                <option value="manual">Manual Dispatch</option>
                <option value="scheduled">Scheduled</option>
                <option value="bulk">Bulk Campaign</option>
              </select>
              {!scopedDepartment ? (
                <select
                  value={logDeptFilter}
                  onChange={(e) => {
                    setLogDeptFilter(e.target.value);
                    setLogPage(1);
                  }}
                  className="px-2.5 py-1.5 typo-meta border border-slate-300 rounded-md bg-white"
                >
                  <option value="all">All Departments</option>
                  {EIGHT_DEPARTMENTS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {subId === 'scheduled' && canSchedule ? (
                <button
                  type="button"
                  onClick={() => void processDueScheduledEmailsNow()}
                  className="px-3 py-1.5 typo-meta font-medium text-white bg-[#1265C8] rounded-md"
                >
                  Process Due Now
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleExportLogsCsv}
                className="inline-flex items-center gap-1 px-3 py-1.5 typo-meta font-medium text-[#172B46] bg-[#F3F6FA] border border-slate-200 rounded-md"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            </div>
          </div>

          {pagedLogs.length === 0 ? (
            <EmptyState
              title={`No Records in ${activeTabLabel}`}
              description="No email logs matched the active filter criteria."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Recipient</th>
                      <th className="px-4 py-3 font-medium">Subject & Type</th>
                      <th className="px-4 py-3 font-medium">Department</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Time / Scheduled</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagedLogs.map((log) => (
                      <tr
                        key={log.emailLogId}
                        onClick={() => setInspectingLog(log)}
                        className="hover:bg-[#F3F6FA]/60 cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{log.recipientEmail}</p>
                          {log.recipientName ? (
                            <p className="typo-small text-[#75869D]">{log.recipientName}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{log.subject}</p>
                          <p className="typo-small text-[#75869D]">
                            {log.kind || 'automatic'} · <span className="font-mono">{log.eventType}</span>
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono typo-small text-[#172B46]">
                          {log.department || 'all'}
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
                          {log.errorDetail ? (
                            <p className="typo-small text-[#D34552] line-clamp-1 max-w-xs">
                              {log.errorDetail}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 typo-small tabular-nums text-[#75869D]">
                          {log.status === 'scheduled' && log.scheduledFor
                            ? `Due: ${new Date(log.scheduledFor).toLocaleString()}`
                            : new Date(log.sentAt || log.createdAt).toLocaleString()}
                        </td>
                        <td
                          className="px-4 py-3 text-right space-x-2 whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {log.status === 'scheduled' && canSchedule ? (
                            <button
                              type="button"
                              onClick={() => void cancelScheduledEmail(log.emailLogId)}
                              className="text-xs font-medium text-[#D34552] hover:underline"
                            >
                              Cancel
                            </button>
                          ) : null}
                          {['failed', 'bounced', 'rejected', 'deferred', 'not_configured'].includes(
                            log.status
                          ) && canRetryFailed ? (
                            <button
                              type="button"
                              disabled={retryingLogId === log.emailLogId}
                              onClick={() => handleRetryLogClick(log)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#1265C8] hover:underline disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" />
                              {retryingLogId === log.emailLogId ? 'Retrying...' : 'Retry'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                page={logPage}
                pageSize={logPageSize}
                totalItems={totalLogItems}
                totalPages={totalLogPages}
                onPageChange={setLogPage}
                onPageSizeChange={setLogPageSize}
              />
            </>
          )}
        </div>
      )}

      {/* Composer Preview Modal */}
      {previewOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="typo-card-heading text-[#172B46]">Official SWAS TASKS Email Preview</h3>
              <button type="button" onClick={() => setPreviewOpen(false)}>
                <X className="w-4 h-4 text-[#75869D]" />
              </button>
            </div>
            <iframe
              title="Composer Email Preview"
              sandbox=""
              srcDoc={composerPreviewSrcDoc}
              className="w-full h-[420px] border border-slate-200 rounded"
            />
          </div>
        </div>
      ) : null}

      {/* Composer Send Confirmation Modal */}
      {sendConfirmOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-[#1265C8]" />
              <h3 className="typo-card-heading text-[#172B46]">
                {scheduleEnabled ? 'Confirm Scheduled Email' : 'Confirm Email Dispatch'}
              </h3>
            </div>
            <div className="typo-meta text-[#172B46] space-y-1 bg-[#F3F6FA] p-3 rounded border border-slate-200">
              <p>
                <strong>From:</strong> <span className="font-mono">{OFFICIAL_PLATFORM_EMAIL}</span>
              </p>
              <p>
                <strong>Recipients:</strong> {combinedComposerRecipients.length}
              </p>
              <p>
                <strong>Subject:</strong> {subject}
              </p>
              {scheduleEnabled && scheduledFor ? (
                <p>
                  <strong>Scheduled For:</strong> {new Date(scheduledFor).toLocaleString()}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSendConfirmOpen(false)}
                className="px-4 py-2 typo-button text-[#172B46] bg-slate-100 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={composerBusy}
                onClick={() => void handleDispatchFromComposer()}
                className="px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
              >
                {composerBusy ? 'Processing...' : scheduleEnabled ? 'Confirm Schedule' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Template Create/Edit Modal */}
      {tplModalOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveTemplateForm}
            className="bg-white border border-slate-200 rounded-lg max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="typo-card-heading text-[#172B46]">
                {tplEditingId ? 'Edit Email Template' : 'Create Email Template'}
              </h3>
              <button type="button" onClick={() => setTplModalOpen(false)}>
                <X className="w-4 h-4 text-[#75869D]" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">Template Name</label>
                <input
                  type="text"
                  required
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">Category</label>
                <select
                  value={tplCategory}
                  onChange={(e) => setTplCategory(e.target.value as EmailTemplateCategory)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
                >
                  {TEMPLATE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">Department Scope</label>
                <select
                  value={tplDept}
                  disabled={Boolean(scopedDepartment)}
                  onChange={(e) => setTplDept(e.target.value as 'all' | EightDepartmentId)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
                >
                  <option value="all">All Departments</option>
                  {EIGHT_DEPARTMENTS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">Default Subject</label>
                <input
                  type="text"
                  required
                  value={tplSubject}
                  onChange={(e) => setTplSubject(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">HTML Content</label>
              <textarea
                rows={6}
                required
                value={tplHtmlBody}
                onChange={(e) => setTplHtmlBody(e.target.value)}
                className="w-full px-3 py-2 typo-input font-mono text-xs border border-slate-300 rounded-md"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">CTA Label (Optional)</label>
                <input
                  type="text"
                  value={tplCtaLabel}
                  onChange={(e) => setTplCtaLabel(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">CTA URL (Optional)</label>
                <input
                  type="url"
                  value={tplCtaUrl}
                  onChange={(e) => setTplCtaUrl(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setTplModalOpen(false)}
                className="px-4 py-2 typo-button text-[#172B46] bg-slate-100 rounded-md"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={tplBusy}
                className="px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
              >
                {tplBusy ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Email Log Detail Drawer */}
      {inspectingLog ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex justify-end">
          <div className="bg-white w-full max-w-lg h-full overflow-y-auto p-6 space-y-4 border-l border-slate-200">
            <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <p className="font-mono typo-small text-[#75869D]">{inspectingLog.emailLogId}</p>
                <h3 className="typo-card-heading text-[#172B46]">{inspectingLog.subject}</h3>
              </div>
              <button type="button" onClick={() => setInspectingLog(null)}>
                <X className="w-4 h-4 text-[#75869D]" />
              </button>
            </div>
            <div className="space-y-2 typo-meta bg-[#F3F6FA] p-3 rounded border border-slate-200">
              <div className="flex justify-between">
                <span className="text-[#75869D]">Status</span>
                <StatusText status={inspectingLog.status} />
              </div>
              <div className="flex justify-between">
                <span className="text-[#75869D]">Recipient</span>
                <span className="font-mono text-[#172B46]">{inspectingLog.recipientEmail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#75869D]">Sender</span>
                <span className="font-mono text-[#172B46]">{inspectingLog.fromAddress}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#75869D]">Provider</span>
                <span className="text-[#172B46]">{inspectingLog.provider}</span>
              </div>
              {inspectingLog.errorDetail ? (
                <div className="pt-1 border-t border-slate-200 text-[#D34552]">
                  {inspectingLog.errorDetail}
                </div>
              ) : null}
            </div>
            <iframe
              title="Logged Email Content"
              sandbox=""
              srcDoc={buildEmailPreviewSrcDoc({
                subject: inspectingLog.subject,
                bodyHtml: inspectingLog.htmlBody || `<p>${inspectingLog.bodyPreview || ''}</p>`,
                ctaLabel: inspectingLog.ctaLabel,
                ctaUrl: inspectingLog.ctaUrl,
              })}
              className="w-full h-96 border border-slate-200 rounded"
            />
          </div>
        </div>
      ) : null}

      {confirmModal ? (
        <ConfirmModal
          open
          title={confirmModal.title}
          description={confirmModal.description}
          confirmLabel={confirmModal.confirmLabel || 'Confirm'}
          danger={confirmModal.danger ?? false}
          onCancel={() => setConfirmModal(null)}
          onConfirm={confirmModal.onConfirm}
        />
      ) : null}
    </div>
  );
}
