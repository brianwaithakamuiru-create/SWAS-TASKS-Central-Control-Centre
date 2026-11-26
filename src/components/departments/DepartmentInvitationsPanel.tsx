import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Link2,
  Mail,
  MailPlus,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import {
  DEPARTMENT_ROLE_PRESETS,
  EIGHT_DEPARTMENTS,
  EMAIL_GRANULAR_PERMISSIONS,
  GRANULAR_PERMISSIONS,
} from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../services/firestoreService';
import type {
  AdminAction,
  EightDepartmentId,
  InvitationType,
  MessagingStatus,
  StaffInvitation,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';

interface DepartmentInvitationsPanelProps {
  mode: 'create' | 'list' | 'both';
  invitations: StaffInvitation[];
  lockedDepartment?: EightDepartmentId | null;
  onSuccessMessage?: (msg: string) => void;
  onErrorMessage?: (msg: string) => void;
}

const INVITATION_TYPE_OPTIONS: { id: InvitationType; label: string; hint: string }[] = [
  { id: 'staff_account', label: 'Staff Account', hint: 'Standard department staff onboarding' },
  { id: 'department_member', label: 'Department Member', hint: 'Operational member in selected department' },
  { id: 'department_admin', label: 'Department Admin', hint: 'Department lead with manage capabilities' },
];

export function buildShortInviteUrlFromCode(shortCode?: string): string {
  if (!shortCode) return '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/join/${shortCode}`;
}

export function buildWhatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function DepartmentInvitationsPanel({
  mode,
  invitations,
  lockedDepartment = null,
  onSuccessMessage,
  onErrorMessage,
}: DepartmentInvitationsPanelProps) {
  const { isSuperAdmin } = useAuth();
  const [messagingStatus, setMessagingStatus] = useState<MessagingStatus | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  const [issuedShare, setIssuedShare] = useState<{
    invitationId: string;
    shortCode: string;
    inviteUrl: string;
    shareMessage: string;
    departmentLabel: string;
    role: string;
    email: string;
    expiresAt: string;
    singleUse: boolean;
    deliveryStatus: string;
    deliveryDetail: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create Form State
  const [invType, setInvType] = useState<InvitationType>('staff_account');
  const [invFullName, setInvFullName] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invPhone, setInvPhone] = useState('');
  const [requiresPhone, setRequiresPhone] = useState(false);
  const [singleUse, setSingleUse] = useState(true);
  const [sendEmailImmediately, setSendEmailImmediately] = useState(true);
  const [customMessage, setCustomMessage] = useState('');
  const [invDepartment, setInvDepartment] = useState<EightDepartmentId>(
    lockedDepartment || 'user_management'
  );
  const [invRole, setInvRole] = useState(
    DEPARTMENT_ROLE_PRESETS[lockedDepartment || 'user_management'][0]
  );
  const [invPermissions, setInvPermissions] = useState<AdminAction[]>([
    'view',
    'create',
    'edit',
    'approve',
  ]);
  const [invExpiryHours, setInvExpiryHours] = useState<number>(48);
  const [invBusy, setInvBusy] = useState(false);

  // List Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>(lockedDepartment || 'all');

  // Share / Email Modal State
  const [shareModalInvite, setShareModalInvite] = useState<StaffInvitation | null>(null);
  const [shareEmailTo, setShareEmailTo] = useState('');
  const [shareEmailMsg, setShareEmailMsg] = useState('');
  const [shareBusy, setShareBusy] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    danger: boolean;
    onConfirm: (reason: string) => Promise<void>;
  } | null>(null);

  useEffect(() => {
    if (lockedDepartment) {
      setInvDepartment(lockedDepartment);
      setInvRole(DEPARTMENT_ROLE_PRESETS[lockedDepartment][0]);
      setDeptFilter(lockedDepartment);
    }
  }, [lockedDepartment]);

  useEffect(() => {
    fetch('/api/v1/system/messaging-status')
      .then((r) => r.json())
      .then((data: MessagingStatus) => setMessagingStatus(data))
      .catch(() => undefined);
  }, []);

  const reportError = (msg: string | null) => {
    setLocalError(msg);
    if (msg && onErrorMessage) onErrorMessage(msg);
  };

  const reportSuccess = (msg: string | null) => {
    setLocalSuccess(msg);
    if (msg && onSuccessMessage) onSuccessMessage(msg);
  };

  const deptLabel = (id?: string) =>
    EIGHT_DEPARTMENTS.find((d) => d.id === id)?.label || id || 'Unassigned';

  const getEffectiveInviteStatus = (inv: StaffInvitation): StaffInvitation['status'] => {
    if (
      (inv.status === 'pending' || inv.status === 'opened') &&
      new Date(inv.expiresAt).getTime() < Date.now()
    ) {
      return 'expired';
    }
    return inv.status;
  };

  const filteredInvitations = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return [...invitations]
      .filter((inv) => {
        if (lockedDepartment && inv.department !== lockedDepartment) return false;
        if (!lockedDepartment && deptFilter !== 'all' && inv.department !== deptFilter) return false;
        const effective = getEffectiveInviteStatus(inv);
        if (statusFilter !== 'all' && effective !== statusFilter) return false;
        if (!q) return true;
        return (
          (inv.fullName || '').toLowerCase().includes(q) ||
          (inv.email || '').toLowerCase().includes(q) ||
          inv.departmentRole.toLowerCase().includes(q) ||
          inv.invitationId.toLowerCase().includes(q) ||
          (inv.shortCode || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [invitations, lockedDepartment, deptFilter, statusFilter, searchTerm]);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2200);
    } catch {
      reportError('Clipboard access unavailable. Copy the short link manually.');
    }
  };

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    reportError(null);
    reportSuccess(null);
    if (invPermissions.length === 0) {
      reportError('Select at least one permission for this invitation.');
      return;
    }

    const effectiveDept = lockedDepartment || invDepartment;
    setInvBusy(true);
    try {
      const res = await apiFetch<{
        invitation: StaffInvitation;
        shortCode: string;
        inviteUrl: string;
        shareMessage: string;
        delivery: { sent: boolean; status: string; detail: string };
      }>('/api/v1/admin/invitations', {
        method: 'POST',
        body: JSON.stringify({
          invitationType: invType,
          fullName: invFullName.trim(),
          email: invEmail.trim(),
          phone: invPhone.trim(),
          requiresPhone,
          singleUse,
          department: effectiveDept,
          departmentRole: invRole.trim(),
          permissions: invPermissions,
          expiryHours: invExpiryHours,
          shareMessage: customMessage.trim(),
          sendEmail: Boolean(invEmail.trim()) && sendEmailImmediately,
        }),
      });

      const shortUrl = res.inviteUrl || buildShortInviteUrlFromCode(res.shortCode);
      setIssuedShare({
        invitationId: res.invitation.invitationId,
        shortCode: res.shortCode,
        inviteUrl: shortUrl,
        shareMessage:
          res.shareMessage ||
          `You're invited to join SWAS TASKS (${deptLabel(effectiveDept)} – ${invRole.trim()}). Register using your secure link: ${shortUrl}`,
        departmentLabel: deptLabel(res.invitation.department),
        role: res.invitation.departmentRole,
        email: res.invitation.email || '',
        expiresAt: res.invitation.expiresAt,
        singleUse: res.invitation.singleUse !== false,
        deliveryStatus: res.delivery.status,
        deliveryDetail: res.delivery.detail,
      });

      reportSuccess(
        res.invitation.email
          ? `Short invitation link generated for ${res.invitation.email} (${deptLabel(effectiveDept)}).`
          : `Shareable invitation link generated for ${deptLabel(effectiveDept)}.`
      );
      setInvFullName('');
      setInvEmail('');
      setInvPhone('');
      setCustomMessage('');
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Failed to create invitation link.');
    } finally {
      setInvBusy(false);
    }
  };

  const handleRegenerateInvite = async (inv: StaffInvitation) => {
    reportError(null);
    reportSuccess(null);
    try {
      const res = await apiFetch<{
        invitation: StaffInvitation;
        shortCode: string;
        inviteUrl: string;
        delivery: { sent: boolean; status: string; detail: string };
      }>(`/api/v1/admin/invitations/${inv.invitationId}/regenerate`, {
        method: 'POST',
      });

      const shortUrl = res.inviteUrl || buildShortInviteUrlFromCode(res.shortCode);
      setIssuedShare({
        invitationId: res.invitation.invitationId,
        shortCode: res.shortCode,
        inviteUrl: shortUrl,
        shareMessage:
          res.invitation.shareMessage ||
          `You're invited to join SWAS TASKS (${deptLabel(res.invitation.department)} – ${
            res.invitation.departmentRole
          }). Register using your secure link: ${shortUrl}`,
        departmentLabel: deptLabel(res.invitation.department),
        role: res.invitation.departmentRole,
        email: res.invitation.email || '',
        expiresAt: res.invitation.expiresAt,
        singleUse: res.invitation.singleUse !== false,
        deliveryStatus: res.delivery.status,
        deliveryDetail: res.delivery.detail,
      });
      reportSuccess(`New short invitation link generated and previous link invalidated.`);
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Failed to regenerate invitation.');
    }
  };

  const handleRevokeInvite = (inv: StaffInvitation) => {
    setConfirmState({
      open: true,
      title: 'Revoke Invitation Link',
      description: `Revoke ${inv.email || `invitation ${inv.shortCode || inv.invitationId}`} (${deptLabel(
        inv.department
      )})? The link will become permanently invalid.`,
      danger: true,
      onConfirm: async (reason) => {
        reportError(null);
        try {
          await apiFetch(`/api/v1/admin/invitations/${inv.invitationId}/revoke`, {
            method: 'POST',
            body: JSON.stringify({ reason: reason || 'Revoked by administrator' }),
          });
          reportSuccess(`Invitation revoked.`);
        } catch (err) {
          reportError(err instanceof Error ? err.message : 'Revoke failed.');
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const handleDeleteInvite = (inv: StaffInvitation) => {
    setConfirmState({
      open: true,
      title: 'Delete Invitation Record',
      description: `Permanently delete invitation record ${inv.invitationId}? This action removes the Firestore invitation and lookup record.`,
      danger: true,
      onConfirm: async () => {
        reportError(null);
        try {
          await apiFetch(`/api/v1/admin/invitations/${inv.invitationId}`, {
            method: 'DELETE',
          });
          reportSuccess(`Invitation record ${inv.invitationId} deleted.`);
        } catch (err) {
          reportError(err instanceof Error ? err.message : 'Delete failed.');
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const openShareModal = (inv: StaffInvitation) => {
    const shortUrl = buildShortInviteUrlFromCode(inv.shortCode);
    setShareModalInvite(inv);
    setShareEmailTo(inv.email || '');
    setShareEmailMsg(
      inv.shareMessage ||
        `You're invited to join SWAS TASKS (${deptLabel(inv.department)} – ${
          inv.departmentRole
        }). Register using your secure link: ${shortUrl}`
    );
  };

  const handleSendShareEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareModalInvite || !shareEmailTo.trim()) return;
    reportError(null);
    setShareBusy(true);
    try {
      const res = await apiFetch<{
        delivery: { sent: boolean; status: string; detail: string };
      }>(`/api/v1/admin/invitations/${shareModalInvite.invitationId}/send-email`, {
        method: 'POST',
        body: JSON.stringify({
          toEmail: shareEmailTo.trim(),
          shareMessage: shareEmailMsg.trim(),
        }),
      });
      if (res.delivery.sent) {
        reportSuccess(`Invitation email sent to ${shareEmailTo.trim()} via swastaskorg@gmail.com.`);
      } else {
        reportError(res.delivery.detail);
      }
      setShareModalInvite(null);
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Failed to dispatch invitation email.');
    } finally {
      setShareBusy(false);
    }
  };

  const showCreate = mode === 'create' || mode === 'both';
  const showList = mode === 'list' || mode === 'both';

  return (
    <div className="space-y-6">
      {localError ? (
        <div className="p-3 rounded-md bg-red-50 border border-red-200 typo-meta text-[#D34552]">
          {localError}
        </div>
      ) : null}
      {localSuccess ? (
        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 typo-meta text-[#15966B]">
          {localSuccess}
        </div>
      ) : null}

      {/* Shareable Short Link Banner after Generation */}
      {issuedShare ? (
        <div className="bg-white border-2 border-[#1265C8] rounded-lg p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="typo-card-heading text-[#172B46]">
                  Secure Short Invitation Link Ready
                </h3>
                <StatusText status={issuedShare.deliveryStatus} />
              </div>
              <p className="typo-meta text-[#75869D] mt-0.5">
                {issuedShare.departmentLabel} · {issuedShare.role}
                {issuedShare.email ? ` · Restricted to ${issuedShare.email}` : ' · Open Shareable Link'}
                {' · '}
                {issuedShare.singleUse ? 'Single-Use' : 'Reusable'} · Expires{' '}
                {new Date(issuedShare.expiresAt).toLocaleString()}
              </p>
              <p className="typo-small text-[#75869D] mt-1">{issuedShare.deliveryDetail}</p>
            </div>
            <button
              type="button"
              onClick={() => setIssuedShare(null)}
              className="p-1 text-[#75869D] hover:text-[#172B46]"
              aria-label="Dismiss invitation banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 bg-[#F3F6FA] border border-slate-200 rounded-md p-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Link2 className="w-4 h-4 text-[#1265C8] shrink-0" />
              <code className="typo-meta font-mono font-semibold text-[#102B50] break-all">
                {issuedShare.inviteUrl}
              </code>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleCopy(issuedShare.inviteUrl, 'banner_link')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
              >
                {copiedId === 'banner_link' ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedId === 'banner_link' ? 'Copied' : 'Copy Link'}
              </button>
              <a
                href={buildWhatsAppShareUrl(issuedShare.shareMessage)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-button text-white bg-[#15966B] hover:bg-[#102B50] rounded-md"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Share via WhatsApp
              </a>
              <button
                type="button"
                onClick={() => void handleCopy(issuedShare.shareMessage, 'banner_msg')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-button text-[#172B46] bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
              >
                {copiedId === 'banner_msg' ? (
                  <Check className="w-3.5 h-3.5 text-[#15966B]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedId === 'banner_msg' ? 'Message Copied' : 'Copy Invite Message'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create Short Invitation Form */}
      {showCreate ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleCreateInvitation}
            className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6 space-y-5"
          >
            <div>
              <h2 className="typo-card-heading text-[#172B46]">
                Generate Short Shareable Staff Invitation
              </h2>
              <p className="typo-meta text-[#75869D] mt-0.5">
                Creates a clean short link (<span className="font-mono">/join/CODE</span>) with zero
                sensitive data in the URL. Share via Copy, WhatsApp, or Email. All registered
                accounts enter <span className="font-semibold">Pending Verification</span> until
                approved by the Super Administrator.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {INVITATION_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setInvType(opt.id);
                    if (opt.id === 'department_admin' && !invPermissions.includes('manage')) {
                      setInvPermissions((prev) => [...prev, 'manage']);
                    }
                  }}
                  className={`p-3 rounded-md border text-left transition-colors ${
                    invType === opt.id
                      ? 'border-[#1265C8] bg-[#E9F2FF]/60'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <p className="typo-meta font-semibold text-[#172B46]">{opt.label}</p>
                  <p className="typo-small text-[#75869D] mt-0.5">{opt.hint}</p>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Recipient Name (Optional)
                </label>
                <input
                  type="text"
                  value={invFullName}
                  onChange={(e) => setInvFullName(e.target.value)}
                  placeholder="Jane Wanjiku"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
                />
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Recipient Email (Optional for WhatsApp/Copy)
                </label>
                <input
                  type="email"
                  value={invEmail}
                  onChange={(e) => setInvEmail(e.target.value)}
                  placeholder="Leave blank for open shareable link"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
                />
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Phone Number (Optional)
                </label>
                <input
                  type="tel"
                  value={invPhone}
                  onChange={(e) => setInvPhone(e.target.value)}
                  placeholder="+254712345678"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
                />
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Expiration Period
                </label>
                <select
                  value={invExpiryHours}
                  onChange={(e) => setInvExpiryHours(Number(e.target.value))}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
                >
                  <option value={12}>12 Hours</option>
                  <option value={24}>24 Hours</option>
                  <option value={48}>48 Hours (Recommended)</option>
                  <option value={72}>72 Hours</option>
                  <option value={168}>7 Days</option>
                  <option value={336}>14 Days</option>
                  <option value={720}>30 Days</option>
                </select>
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Assigned Department
                </label>
                <select
                  value={lockedDepartment || invDepartment}
                  disabled={Boolean(lockedDepartment)}
                  onChange={(e) => {
                    const nextDept = e.target.value as EightDepartmentId;
                    setInvDepartment(nextDept);
                    setInvRole(DEPARTMENT_ROLE_PRESETS[nextDept][0]);
                  }}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white disabled:bg-slate-100 disabled:text-[#75869D]"
                >
                  {EIGHT_DEPARTMENTS.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.label} — {dept.workplaceTitle}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Department Role
                </label>
                <select
                  value={invRole}
                  onChange={(e) => setInvRole(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
                >
                  {DEPARTMENT_ROLE_PRESETS[lockedDepartment || invDepartment].map((roleName) => (
                    <option key={roleName} value={roleName}>
                      {roleName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-md bg-[#F3F6FA] border border-slate-200 typo-meta">
              <label className="flex items-center gap-2 cursor-pointer text-[#172B46]">
                <input
                  type="checkbox"
                  checked={singleUse}
                  onChange={(e) => setSingleUse(e.target.checked)}
                />
                <span>Single-use link (Recommended)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#172B46]">
                <input
                  type="checkbox"
                  checked={requiresPhone}
                  onChange={(e) => setRequiresPhone(e.target.checked)}
                />
                <span>Require phone number</span>
              </label>
              <label
                className={`flex items-center gap-2 ${
                  invEmail.trim() ? 'cursor-pointer text-[#172B46]' : 'text-[#75869D]'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={!invEmail.trim()}
                  checked={Boolean(invEmail.trim()) && sendEmailImmediately}
                  onChange={(e) => setSendEmailImmediately(e.target.checked)}
                />
                <span>Email recipient immediately</span>
              </label>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Custom Share Message (Optional)
              </label>
              <input
                type="text"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="Auto-generated if left blank — included in WhatsApp & Email shares"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
              />
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-2">
                Granular Workplace Permissions
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {GRANULAR_PERMISSIONS.map((perm) => {
                  const checked = invPermissions.includes(perm.id);
                  return (
                    <label
                      key={perm.id}
                      className={`flex items-start gap-2 p-2.5 rounded-md border typo-meta cursor-pointer ${
                        checked
                          ? 'bg-[#E9F2FF]/60 border-[#1265C8] text-[#172B46]'
                          : 'bg-white border-slate-200 text-[#75869D]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setInvPermissions((prev) =>
                            e.target.checked
                              ? [...prev, perm.id]
                              : prev.filter((p) => p !== perm.id)
                          );
                        }}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-semibold text-[#172B46] block">{perm.label}</span>
                        <span className="typo-small text-[#75869D]">{perm.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-2">
                Email Communication Centre Permissions
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {EMAIL_GRANULAR_PERMISSIONS.map((perm) => {
                  const checked = invPermissions.includes(perm.id);
                  return (
                    <label
                      key={perm.id}
                      className={`flex items-start gap-2 p-2.5 rounded-md border typo-meta cursor-pointer ${
                        checked
                          ? 'bg-[#E9F2FF]/60 border-[#1265C8] text-[#172B46]'
                          : 'bg-white border-slate-200 text-[#75869D]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setInvPermissions((prev) =>
                            e.target.checked
                              ? [...prev, perm.id]
                              : prev.filter((p) => p !== perm.id)
                          );
                        }}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-mono text-xs font-semibold text-[#172B46] block">
                          {perm.label}
                        </span>
                        <span className="typo-small text-[#75869D]">{perm.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="submit"
                disabled={invBusy}
                className="inline-flex items-center gap-2 px-5 py-2.5 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-60"
              >
                <MailPlus className="w-4 h-4" />
                {invBusy ? 'Generating Invitation Link...' : 'Generate Invitation Link'}
              </button>
            </div>
          </form>

          {/* Delivery & Verification Enforcement Info Card */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 h-fit">
            <h3 className="typo-card-heading text-[#172B46]">
              Security & Delivery Architecture
            </h3>
            <div className="space-y-3 typo-meta">
              <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[#172B46]">Email Invitation Dispatch</span>
                  <StatusText
                    status={messagingStatus?.emailConfigured ? 'connected' : 'not_configured'}
                    label={messagingStatus?.emailConfigured ? 'Configured' : 'Not Configured'}
                  />
                </div>
                <p className="text-[#75869D]">
                  Sender:{' '}
                  <span className="font-mono text-[#172B46]">
                    {messagingStatus?.officialEmail || 'swastaskorg@gmail.com'}
                  </span>
                </p>
              </div>

              <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#172B46]">SMS Phone OTP</span>
                  <StatusText
                    status={messagingStatus?.smsConfigured ? 'connected' : 'not_configured'}
                    label={messagingStatus?.smsConfigured ? 'Configured' : 'Optional / Off'}
                  />
                </div>
                <p className="text-[#75869D]">
                  {messagingStatus?.smsConfigured
                    ? 'Twilio SMS OTP enabled when phone numbers are collected.'
                    : 'Email verification is enforced for every registration.'}
                </p>
              </div>

              <div className="p-3 rounded-md bg-blue-50 border border-blue-200 space-y-1">
                <p className="font-semibold text-[#102B50]">Two-Step Admin Verification Gate</p>
                <p className="text-[#172B46]">
                  Invited staff who complete registration are held in{' '}
                  <span className="font-semibold">Pending Verification</span>. Only the Super
                  Administrator can approve and activate workplace access.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Invitations Lifecycle Table */}
      {showList ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <h2 className="typo-card-heading text-[#172B46]">
                Generated Invitation Links & Lifecycle
              </h2>
              <p className="typo-meta text-[#75869D]">
                Copy, share via WhatsApp or Email, regenerate, or revoke invitations.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#75869D] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search email, name, code..."
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
                />
              </div>
              {!lockedDepartment ? (
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="all">All Departments</option>
                  {EIGHT_DEPARTMENTS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              ) : null}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="opened">Opened</option>
                <option value="accepted">Accepted</option>
                <option value="expired">Expired</option>
                <option value="revoked">Revoked</option>
              </select>
            </div>
          </div>

          {filteredInvitations.length === 0 ? (
            <EmptyState
              title="No Matching Invitations"
              description="Generate a short shareable invitation link to onboard staff into this department."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Invitee / Link</th>
                    <th className="px-4 py-3 font-medium">Department & Role</th>
                    <th className="px-4 py-3 font-medium">Delivery</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Expires</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvitations.map((inv) => {
                    const effectiveStatus = getEffectiveInviteStatus(inv);
                    const shortUrl = buildShortInviteUrlFromCode(inv.shortCode);
                    const isUsable =
                      effectiveStatus === 'pending' || effectiveStatus === 'opened';
                    const waText =
                      inv.shareMessage ||
                      `You're invited to join SWAS TASKS (${deptLabel(inv.department)} – ${
                        inv.departmentRole
                      }). Register here: ${shortUrl}`;

                    return (
                      <tr key={inv.invitationId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">
                            {inv.fullName || (inv.email ? inv.email : 'Open Shareable Link')}
                          </p>
                          <p className="typo-meta text-[#75869D]">
                            {inv.email || 'Any verified work email'}
                          </p>
                          {inv.shortCode ? (
                            <p className="typo-small font-mono text-[#1265C8] mt-0.5">
                              /join/{inv.shortCode}{' '}
                              <span className="text-[#75869D] font-sans">
                                · {inv.singleUse !== false ? 'Single-use' : 'Reusable'}
                              </span>
                            </p>
                          ) : (
                            <p className="typo-small font-mono text-[#75869D] mt-0.5">
                              Legacy link ({inv.invitationId})
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{deptLabel(inv.department)}</p>
                          <p className="typo-meta text-[#75869D]">{inv.departmentRole}</p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={inv.emailDeliveryStatus || 'not_sent'} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={effectiveStatus} />
                          {inv.acceptedByEmail ? (
                            <p className="typo-small text-[#75869D] mt-0.5">
                              By {inv.acceptedByEmail}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 tabular-nums typo-meta text-[#75869D]">
                          {new Date(inv.expiresAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {shortUrl && isUsable ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleCopy(shortUrl, inv.invitationId)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#1265C8] hover:underline"
                              >
                                {copiedId === inv.invitationId ? (
                                  <Check className="w-3 h-3 text-[#15966B]" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                {copiedId === inv.invitationId ? 'Copied' : 'Copy'}
                              </button>
                              <a
                                href={buildWhatsAppShareUrl(waText)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#15966B] hover:underline"
                              >
                                <MessageCircle className="w-3 h-3" />
                                WhatsApp
                              </a>
                              <button
                                type="button"
                                onClick={() => openShareModal(inv)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#172B46] hover:underline"
                              >
                                <Share2 className="w-3 h-3" />
                                Email / Share
                              </button>
                            </>
                          ) : null}

                          {effectiveStatus !== 'accepted' ? (
                            <button
                              type="button"
                              onClick={() => void handleRegenerateInvite(inv)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#1265C8] hover:underline"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Regenerate
                            </button>
                          ) : null}

                          {isUsable ? (
                            <button
                              type="button"
                              onClick={() => handleRevokeInvite(inv)}
                              className="text-xs font-medium text-[#D34552] hover:underline"
                            >
                              Revoke
                            </button>
                          ) : null}

                          {isSuperAdmin && !isUsable ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteInvite(inv)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#75869D] hover:text-[#D34552]"
                            >
                              <Trash2 className="w-3 h-3" />
                              Delete
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {/* Share & Send Email Modal */}
      {shareModalInvite ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Share2 className="w-5 h-5 text-[#1265C8]" />
                <h3 className="typo-section-heading text-[#172B46]">
                  Share Department Invitation Link
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShareModalInvite(null)}
                className="text-[#75869D] hover:text-[#172B46]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-2">
              <p className="typo-small text-[#75869D]">
                {deptLabel(shareModalInvite.department)} · {shareModalInvite.departmentRole}
              </p>
              <div className="flex items-center gap-2">
                <code className="typo-meta font-mono text-[#102B50] break-all flex-1">
                  {buildShortInviteUrlFromCode(shareModalInvite.shortCode)}
                </code>
                <button
                  type="button"
                  onClick={() =>
                    void handleCopy(
                      buildShortInviteUrlFromCode(shareModalInvite.shortCode),
                      'modal_link'
                    )
                  }
                  className="px-2.5 py-1 text-xs font-semibold text-white bg-[#1265C8] rounded"
                >
                  {copiedId === 'modal_link' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="pt-1 flex gap-2">
                <a
                  href={buildWhatsAppShareUrl(shareEmailMsg)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#15966B] rounded-md"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  Share via WhatsApp
                </a>
              </div>
            </div>

            <form onSubmit={handleSendShareEmail} className="space-y-3 border-t border-slate-200 pt-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#172B46]">
                <Mail className="w-4 h-4 text-[#1265C8]" />
                <span>Send via Official Email (swastaskorg@gmail.com)</span>
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Recipient Email Address
                </label>
                <input
                  type="email"
                  required
                  value={shareEmailTo}
                  onChange={(e) => setShareEmailTo(e.target.value)}
                  placeholder="staff.member@company.com"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Personal Note / Share Message
                </label>
                <textarea
                  rows={3}
                  value={shareEmailMsg}
                  onChange={(e) => setShareEmailMsg(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShareModalInvite(null)}
                  className="px-4 py-2 typo-button text-[#172B46] bg-slate-100 rounded-md"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={shareBusy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5" />
                  {shareBusy ? 'Sending Email...' : 'Send Email Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {confirmState ? (
        <ConfirmModal
          open={confirmState.open}
          title={confirmState.title}
          description={confirmState.description}
          danger={confirmState.danger}
          onCancel={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
        />
      ) : null}
    </div>
  );
}
