import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  KeyRound,
  MailPlus,
  RefreshCw,
  Shield,
  ShieldOff,
  UserCheck,
  UserMinus,
  UserX,
  X,
} from 'lucide-react';
import {
  DEPARTMENT_ROLE_PRESETS,
  EIGHT_DEPARTMENTS,
  GRANULAR_PERMISSIONS,
  ROLE_DEFINITIONS,
  STAFF_MANAGEMENT_SUBDEPARTMENTS,
} from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../services/firestoreService';
import type {
  ActivityLog,
  AdminAction,
  AdminUser,
  EightDepartmentId,
  MessagingStatus,
  StaffInvitation,
  StaffLoginHistory,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';

interface StaffManagementViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  adminUsers: AdminUser[];
  invitations: StaffInvitation[];
  loginHistory: StaffLoginHistory[];
  activityLogs: ActivityLog[];
}

export function StaffManagementView({
  subId,
  onSelectSub,
  adminUsers,
  invitations,
  loginHistory,
  activityLogs,
}: StaffManagementViewProps) {
  const { adminProfile, isSuperAdmin } = useAuth();

  const [messagingStatus, setMessagingStatus] = useState<MessagingStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [issuedLinkBanner, setIssuedLinkBanner] = useState<{
    email: string;
    departmentLabel: string;
    inviteUrl: string;
    deliveryStatus: string;
    deliveryDetail: string;
  } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Invite Staff Form State
  const [invFullName, setInvFullName] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invPhone, setInvPhone] = useState('');
  const [invDepartment, setInvDepartment] = useState<EightDepartmentId>('user_management');
  const [invRole, setInvRole] = useState(DEPARTMENT_ROLE_PRESETS.user_management[0]);
  const [invPermissions, setInvPermissions] = useState<AdminAction[]>([
    'view',
    'create',
    'edit',
    'approve',
  ]);
  const [invExpiryHours, setInvExpiryHours] = useState<number>(48);
  const [invBusy, setInvBusy] = useState(false);

  // Edit / Transfer Staff Modal State
  const [editingStaff, setEditingStaff] = useState<AdminUser | null>(null);
  const [editDept, setEditDept] = useState<EightDepartmentId>('user_management');
  const [editRole, setEditRole] = useState('');
  const [editActions, setEditActions] = useState<AdminAction[]>(['view']);
  const [editStatus, setEditStatus] = useState<'active' | 'suspended' | 'deactivated' | 'revoked'>(
    'active'
  );
  const [editBusy, setEditBusy] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    danger: boolean;
    onConfirm: (reason: string) => Promise<void>;
  } | null>(null);

  useEffect(() => {
    fetch('/api/v1/system/messaging-status')
      .then((r) => r.json())
      .then((data: MessagingStatus) => setMessagingStatus(data))
      .catch(() => undefined);
  }, []);

  const getEffectiveInviteStatus = (inv: StaffInvitation): StaffInvitation['status'] => {
    if (inv.status === 'pending' && new Date(inv.expiresAt).getTime() < Date.now()) {
      return 'expired';
    }
    return inv.status;
  };

  const departmentStaffList = useMemo(() => {
    return [...adminUsers].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [adminUsers]);

  const filteredStaff = useMemo(() => {
    if (subId === 'active_staff') return departmentStaffList.filter((s) => s.status === 'active');
    if (subId === 'suspended_staff')
      return departmentStaffList.filter((s) => s.status === 'suspended');
    if (subId === 'deactivated_staff')
      return departmentStaffList.filter(
        (s) => s.status === 'deactivated' || s.status === 'revoked'
      );
    return departmentStaffList;
  }, [departmentStaffList, subId]);

  const sortedInvitations = useMemo(() => {
    return [...invitations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [invitations]);

  const sortedLoginHistory = useMemo(() => {
    return [...loginHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [loginHistory]);

  const staffLogs = useMemo(() => {
    return [...activityLogs]
      .filter(
        (l) =>
          l.category === 'account_change' ||
          l.category === 'security' ||
          l.action.includes('STAFF') ||
          l.action.includes('INVITATION')
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [activityLogs]);

  const deptLabel = (id?: string) =>
    id === 'all'
      ? 'All Departments (Super Admin)'
      : EIGHT_DEPARTMENTS.find((d) => d.id === id)?.label || id || 'Unassigned';

  const handleCopyInviteUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      setActionError('Clipboard access unavailable. Copy the URL manually from the box above.');
    }
  };

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);
    if (invPermissions.length === 0) {
      setActionError('Select at least one permission for the invited staff member.');
      return;
    }
    setInvBusy(true);
    try {
      const res = await apiFetch<{
        invitation: StaffInvitation;
        inviteUrl: string;
        delivery: { sent: boolean; status: string; detail: string };
      }>('/api/v1/admin/invitations', {
        method: 'POST',
        body: JSON.stringify({
          fullName: invFullName.trim(),
          email: invEmail.trim(),
          phone: invPhone.trim(),
          department: invDepartment,
          departmentRole: invRole.trim(),
          permissions: invPermissions,
          expiryHours: invExpiryHours,
        }),
      });

      setIssuedLinkBanner({
        email: res.invitation.email,
        departmentLabel: deptLabel(res.invitation.department),
        inviteUrl: res.inviteUrl,
        deliveryStatus: res.delivery.status,
        deliveryDetail: res.delivery.detail,
      });
      setActionSuccess(
        `Single-use invitation created for ${res.invitation.email} (${deptLabel(
          res.invitation.department
        )}).`
      );
      setInvFullName('');
      setInvEmail('');
      setInvPhone('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create invitation.');
    } finally {
      setInvBusy(false);
    }
  };

  const handleResendInvite = async (inv: StaffInvitation) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await apiFetch<{
        invitation: StaffInvitation;
        inviteUrl: string;
        delivery: { sent: boolean; status: string; detail: string };
      }>(`/api/v1/admin/invitations/${inv.invitationId}/resend`, {
        method: 'POST',
      });
      setIssuedLinkBanner({
        email: res.invitation.email,
        departmentLabel: deptLabel(res.invitation.department),
        inviteUrl: res.inviteUrl,
        deliveryStatus: res.delivery.status,
        deliveryDetail: res.delivery.detail,
      });
      setActionSuccess(
        `Previous invitation replaced and new single-use link generated for ${inv.email}.`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to resend invitation.');
    }
  };

  const handleRevokeInvite = (inv: StaffInvitation) => {
    setConfirmState({
      open: true,
      title: 'Revoke Staff Invitation',
      description: `Revoke the pending invitation for ${inv.email} (${deptLabel(
        inv.department
      )})? The link will become permanently invalid.`,
      danger: true,
      onConfirm: async () => {
        setActionError(null);
        try {
          await apiFetch(`/api/v1/admin/invitations/${inv.invitationId}/revoke`, {
            method: 'POST',
          });
          setActionSuccess(`Invitation for ${inv.email} revoked.`);
        } catch (err) {
          setActionError(err instanceof Error ? err.message : 'Revoke failed.');
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const openEditStaffModal = (staff: AdminUser) => {
    const primary =
      staff.primaryDepartment && staff.primaryDepartment !== 'all'
        ? staff.primaryDepartment
        : (staff.departments.find((d) =>
            EIGHT_DEPARTMENTS.some((ed) => ed.id === d)
          ) as EightDepartmentId) || 'user_management';

    setEditingStaff(staff);
    setEditDept(primary);
    setEditRole(staff.role);
    setEditActions(staff.actions || ['view']);
    setEditStatus(staff.status);
  };

  const handleSaveStaffEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;
    setActionError(null);
    setActionSuccess(null);
    setEditBusy(true);
    try {
      await apiFetch(`/api/v1/admin/staff/${editingStaff.uid}/update`, {
        method: 'POST',
        body: JSON.stringify({
          primaryDepartment: editDept,
          role: editRole.trim(),
          actions: editActions,
          status: editStatus,
        }),
      });
      setActionSuccess(`Updated department assignment and permissions for ${editingStaff.email}.`);
      setEditingStaff(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update staff account.');
    } finally {
      setEditBusy(false);
    }
  };

  const handleQuickStatusChange = (
    staff: AdminUser,
    nextStatus: 'active' | 'suspended' | 'deactivated',
    title: string,
    description: string,
    danger: boolean
  ) => {
    setConfirmState({
      open: true,
      title,
      description,
      danger,
      onConfirm: async (reason) => {
        setActionError(null);
        try {
          await apiFetch(`/api/v1/admin/staff/${staff.uid}/update`, {
            method: 'POST',
            body: JSON.stringify({ status: nextStatus, reason }),
          });
          setActionSuccess(`${staff.displayName} is now ${nextStatus}.`);
        } catch (err) {
          setActionError(err instanceof Error ? err.message : 'Status update failed.');
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const handleRevokeSession = (staff: AdminUser) => {
    setConfirmState({
      open: true,
      title: 'Revoke Active Staff Session',
      description: `Force-invalidate current login sessions for ${staff.displayName} (${staff.email})? They will be required to re-authenticate.`,
      danger: true,
      onConfirm: async () => {
        setActionError(null);
        try {
          await apiFetch(`/api/v1/admin/staff/${staff.uid}/revoke-session`, {
            method: 'POST',
          });
          setActionSuccess(`Active sessions revoked for ${staff.email}.`);
        } catch (err) {
          setActionError(err instanceof Error ? err.message : 'Session revocation failed.');
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46]">
            Staff Management & Invitations
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Invitation-only staff provisioning, strict department isolation, permission control, and
            session governance.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onSelectSub('invite_staff')}
          className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <MailPlus className="w-4 h-4" />
          Invite Department Staff
        </button>
      </div>

      {/* Subpage Selector */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {STAFF_MANAGEMENT_SUBDEPARTMENTS.map((sub) => (
          <button
            key={sub.id}
            type="button"
            onClick={() => onSelectSub(sub.id)}
            className={`px-3 py-1.5 typo-nav rounded-md whitespace-nowrap transition-colors shrink-0 ${
              subId === sub.id
                ? 'bg-[#1265C8] text-white font-semibold'
                : 'bg-white border border-slate-200 text-[#172B46] hover:bg-[#E9F2FF]'
            }`}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {actionError ? (
        <div className="p-3 rounded-md bg-red-50 border border-red-200 typo-meta text-[#D34552]">
          {actionError}
        </div>
      ) : null}
      {actionSuccess ? (
        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 typo-meta text-[#15966B]">
          {actionSuccess}
        </div>
      ) : null}

      {/* Issued Single-Use Invitation Link Banner */}
      {issuedLinkBanner ? (
        <div className="bg-white border-2 border-[#1265C8] rounded-lg p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="typo-card-heading text-[#172B46]">
                Single-Use Invitation Link Issued for {issuedLinkBanner.email}
              </h3>
              <p className="typo-meta text-[#75869D] mt-0.5">
                Department: <span className="font-medium text-[#172B46]">{issuedLinkBanner.departmentLabel}</span>{' '}
                · Email Delivery: <StatusText status={issuedLinkBanner.deliveryStatus} />
              </p>
              <p className="typo-meta text-[#75869D] mt-1">{issuedLinkBanner.deliveryDetail}</p>
            </div>
            <button
              type="button"
              onClick={() => setIssuedLinkBanner(null)}
              className="p-1 text-[#75869D] hover:text-[#172B46]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 bg-[#F3F6FA] border border-slate-200 rounded-md p-2.5">
            <code className="typo-meta font-mono text-[#102B50] break-all flex-1">
              {issuedLinkBanner.inviteUrl}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyInviteUrl(issuedLinkBanner.inviteUrl)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md shrink-0"
            >
              {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedUrl ? 'Copied' : 'Copy Link'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Total Staff Accounts</p>
          <p className="mt-1 font-sans tabular-nums text-[20px] font-semibold text-[#172B46]">
            {departmentStaffList.length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Active Staff</p>
          <p className="mt-1 font-sans tabular-nums text-[20px] font-semibold text-[#15966B]">
            {departmentStaffList.filter((s) => s.status === 'active').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Pending Invitations</p>
          <p className="mt-1 font-sans tabular-nums text-[20px] font-semibold text-[#B7791F]">
            {invitations.filter((i) => getEffectiveInviteStatus(i) === 'pending').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Suspended / Deactivated</p>
          <p className="mt-1 font-sans tabular-nums text-[20px] font-semibold text-[#D34552]">
            {departmentStaffList.filter((s) => s.status !== 'active').length}
          </p>
        </div>
      </div>

      {/* Subpage 2: Invite Staff */}
      {subId === 'invite_staff' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleCreateInvitation}
            className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6 space-y-5"
          >
            <div>
              <h2 className="typo-card-heading text-[#172B46]">
                Send Private Department Staff Invitation
              </h2>
              <p className="typo-meta text-[#75869D] mt-0.5">
                Generates a cryptographically signed single-use token hashed in Firestore. Staff
                cannot alter their assigned department during registration.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Staff Full Name
                </label>
                <input
                  type="text"
                  required
                  value={invFullName}
                  onChange={(e) => setInvFullName(e.target.value)}
                  placeholder="Jane Wanjiku"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
                />
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Staff Email Address
                </label>
                <input
                  type="email"
                  required
                  value={invEmail}
                  onChange={(e) => setInvEmail(e.target.value)}
                  placeholder="staff.member@swastasks.com"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
                />
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  required
                  value={invPhone}
                  onChange={(e) => setInvPhone(e.target.value)}
                  placeholder="+254712345678"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
                />
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Invitation Expiry Period
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
                  value={invDepartment}
                  onChange={(e) => {
                    const nextDept = e.target.value as EightDepartmentId;
                    setInvDepartment(nextDept);
                    setInvRole(DEPARTMENT_ROLE_PRESETS[nextDept][0]);
                  }}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
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
                  {DEPARTMENT_ROLE_PRESETS[invDepartment].map((roleName) => (
                    <option key={roleName} value={roleName}>
                      {roleName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-2">
                Granular Permissions
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

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="submit"
                disabled={invBusy}
                className="inline-flex items-center gap-2 px-5 py-2.5 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-60"
              >
                <MailPlus className="w-4 h-4" />
                {invBusy ? 'Generating Secure Invitation...' : 'Generate & Send Invitation'}
              </button>
            </div>
          </form>

          {/* Delivery Service Configuration Card */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 h-fit">
            <h3 className="typo-card-heading text-[#172B46]">
              Verification & Delivery Services
            </h3>
            <div className="space-y-3 typo-meta">
              <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[#172B46]">Email Invitation Delivery</span>
                  <StatusText
                    status={messagingStatus?.emailConfigured ? 'connected' : 'not_configured'}
                    label={
                      messagingStatus?.emailConfigured
                        ? 'Configured'
                        : 'EMAIL SERVICE NOT CONFIGURED'
                    }
                  />
                </div>
                <p className="text-[#75869D]">
                  Sender:{' '}
                  <span className="font-mono text-[#172B46]">
                    SWAS TASKS &lt;{messagingStatus?.officialEmail || 'swastaskorg@gmail.com'}&gt;
                  </span>
                </p>
                <p className="text-[#75869D]">
                  Provider:{' '}
                  <span className="font-medium text-[#172B46]">
                    {messagingStatus?.emailProvider || 'EMAIL SERVICE NOT CONFIGURED'}
                  </span>
                  .{' '}
                  {messagingStatus?.emailConfigured
                    ? 'Invitations are dispatched automatically by email.'
                    : 'Set GMAIL_SMTP_USER & GMAIL_APP_PASSWORD (or SMTP/Resend env vars) to dispatch automatically; until then, copy the one-time link directly after creation.'}
                </p>
              </div>

              <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#172B46]">SMS Phone OTP</span>
                  <StatusText
                    status={messagingStatus?.smsConfigured ? 'connected' : 'not_configured'}
                    label={messagingStatus?.smsConfigured ? 'Configured' : 'Not Configured'}
                  />
                </div>
                <p className="text-[#75869D]">
                  Provider: <span className="font-medium text-[#172B46]">{messagingStatus?.smsProvider || 'Twilio'}</span>.{' '}
                  {messagingStatus?.smsConfigured
                    ? 'Invited staff must pass SMS OTP alongside Firebase Email Verification.'
                    : 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to require SMS OTP.'}
                </p>
              </div>

              <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#172B46]">Firebase Email Verification</span>
                  <StatusText status="operational" label="Active" />
                </div>
                <p className="text-[#75869D]">
                  Enforced server-side before any invited staff member can activate their workplace.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : subId === 'pending_invitations' ? (
        /* Subpage 4: Invitations Lifecycle */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="font-heading text-base font-semibold text-[#172B46]">
              Staff Invitations (Pending, Accepted, Expired & Revoked)
            </h2>
            <p className="text-xs text-[#75869D]">
              Only SHA-256 HMAC hashes of invitation tokens are stored in Firestore{' '}
              <span className="font-mono">staff_invitations</span>.
            </p>
          </div>
          {sortedInvitations.length === 0 ? (
            <EmptyState
              title="No Staff Invitations Issued"
              description="Use Invite Staff to issue a single-use, department-locked invitation link."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Invitee</th>
                    <th className="px-4 py-3 font-medium">Department & Role</th>
                    <th className="px-4 py-3 font-medium">Permissions</th>
                    <th className="px-4 py-3 font-medium">Delivery</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Expires</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedInvitations.map((inv) => {
                    const effectiveStatus = getEffectiveInviteStatus(inv);
                    return (
                      <tr key={inv.invitationId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{inv.fullName}</p>
                          <p className="typo-meta text-[#75869D]">{inv.email}</p>
                          <p className="typo-small tabular-nums text-[#75869D]">{inv.phone}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{deptLabel(inv.department)}</p>
                          <p className="typo-meta text-[#75869D]">{inv.departmentRole}</p>
                        </td>
                        <td className="px-4 py-3 typo-meta text-[#75869D]">
                          {inv.permissions.join(', ')}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={inv.emailDeliveryStatus || 'not_configured'} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={effectiveStatus} />
                        </td>
                        <td className="px-4 py-3 tabular-nums typo-meta text-[#75869D]">
                          {new Date(inv.expiresAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {effectiveStatus !== 'accepted' ? (
                            <button
                              type="button"
                              onClick={() => void handleResendInvite(inv)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#1265C8] hover:underline"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Resend
                            </button>
                          ) : null}
                          {effectiveStatus === 'pending' ? (
                            <button
                              type="button"
                              onClick={() => handleRevokeInvite(inv)}
                              className="text-xs font-medium text-[#D34552] hover:underline"
                            >
                              Revoke
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
      ) : subId === 'department_assignments' ? (
        /* Subpage 3: Department Assignments Matrix */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {EIGHT_DEPARTMENTS.map((dept) => {
            const members = departmentStaffList.filter(
              (s) => s.primaryDepartment === dept.id || s.departments.includes(dept.id)
            );
            return (
              <div key={dept.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="typo-card-heading text-[#172B46]">
                      {dept.label}
                    </h3>
                    <p className="typo-meta text-[#75869D]">{dept.workplaceTitle}</p>
                  </div>
                  <span className="tabular-nums typo-meta font-semibold text-[#1265C8]">
                    {members.length} staff
                  </span>
                </div>
                {members.length === 0 ? (
                  <p className="text-xs text-[#75869D] py-2">
                    No dedicated staff assigned yet. Only Super Administrator accesses this workplace.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 border-t border-slate-100">
                    {members.map((m) => (
                      <div key={m.uid} className="py-2 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <p className="font-medium text-[#172B46] truncate">{m.displayName}</p>
                          <p className="text-[#75869D] truncate">
                            {m.role} · {m.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <StatusText status={m.status} />
                          {isSuperAdmin && m.role !== 'SUPER_ADMIN' ? (
                            <button
                              type="button"
                              onClick={() => openEditStaffModal(m)}
                              className="text-[#1265C8] font-medium hover:underline"
                            >
                              Transfer / Edit
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : subId === 'staff_roles' ? (
        /* Subpage 8: Staff Roles Matrix */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">
              Department Staff Roles & Authority Matrix
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {Object.values(ROLE_DEFINITIONS).map((r) => (
              <div key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="typo-body font-semibold text-[#172B46]">{r.label}</p>
                  <p className="typo-meta text-[#75869D] mt-0.5">{r.description}</p>
                </div>
                <div className="typo-meta font-medium text-[#102B50] sm:text-right">
                  {r.actions.join(', ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : subId === 'permissions' ? (
        /* Subpage 9: Granular Permissions Reference */
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div>
            <h2 className="typo-card-heading text-[#172B46]">
              Granular RBAC Permissions Reference
            </h2>
            <p className="typo-meta text-[#75869D]">
              Enforced on both the Express REST API and Cloud Firestore security rules.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {GRANULAR_PERMISSIONS.map((perm) => (
              <div key={perm.id} className="p-3.5 rounded-md border border-slate-200 bg-[#F3F6FA]">
                <p className="typo-meta font-semibold text-[#1265C8] uppercase">
                  {perm.label}
                </p>
                <p className="typo-meta text-[#172B46] mt-1">{perm.description}</p>
              </div>
            ))}
          </div>
        </div>
      ) : subId === 'login_history' ? (
        /* Subpage 10: Staff Login History */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">
              Staff Login & Session History
            </h2>
          </div>
          {sortedLoginHistory.length === 0 ? (
            <EmptyState
              title="No Login History Recorded"
              description="Verified staff logins, denied attempts, and forced session revocations will appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Staff Email</th>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Outcome</th>
                    <th className="px-4 py-3 font-medium">Detail</th>
                    <th className="px-4 py-3 font-medium text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedLoginHistory.map((item) => (
                    <tr key={item.loginId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-[#172B46]">{item.email}</td>
                      <td className="px-4 py-3 text-xs text-[#75869D]">
                        {deptLabel(item.department)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={item.outcome} />
                      </td>
                      <td className="px-4 py-3 text-xs text-[#75869D]">{item.detail || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums typo-meta text-[#75869D]">
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : subId === 'staff_activity_logs' ? (
        /* Subpage 11: Staff Activity Logs */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">
              Staff Governance & Security Audit Trail
            </h2>
          </div>
          {staffLogs.length === 0 ? (
            <EmptyState
              title="No Staff Governance Events"
              description="Invitations, permission updates, department transfers, and session revocations are logged here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Actor</th>
                    <th className="px-4 py-3 font-medium">Record</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                    <th className="px-4 py-3 font-medium text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffLogs.map((log) => (
                    <tr key={log.eventId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-[#172B46]">{log.action}</td>
                      <td className="px-4 py-3 typo-meta text-[#75869D]">
                        {log.actorEmail || log.actorId}
                      </td>
                      <td className="px-4 py-3 font-mono typo-meta text-[#75869D]">
                        {log.affectedRecord}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={log.result} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums typo-meta text-[#75869D]">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Subpages 1, 5, 6, 7: All Staff / Active / Suspended / Deactivated */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">
              {STAFF_MANAGEMENT_SUBDEPARTMENTS.find((s) => s.id === subId)?.label || 'All Staff'}
            </h2>
          </div>
          {filteredStaff.length === 0 ? (
            <EmptyState
              title="No Matching Staff Accounts"
              description="No authorized staff accounts match this status filter yet."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Staff Member</th>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Role & Permissions</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Governance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStaff.map((staff) => {
                    const isSelfSuper =
                      staff.role === 'SUPER_ADMIN' && staff.uid === adminProfile?.uid;
                    return (
                      <tr key={staff.uid} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{staff.displayName}</p>
                          <p className="typo-meta text-[#75869D]">{staff.email}</p>
                          {staff.phone ? (
                            <p className="typo-small tabular-nums text-[#75869D]">{staff.phone}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">
                            {deptLabel(staff.primaryDepartment || staff.departments[0])}
                          </p>
                          {staff.emailVerified ? (
                            <p className="typo-small text-[#15966B]">Email Verified</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <p className="typo-meta font-medium text-[#102B50]">{staff.role}</p>
                          <p className="typo-small text-[#75869D]">
                            {(staff.actions || []).join(', ')}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={staff.status} />
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {isSuperAdmin && staff.role !== 'SUPER_ADMIN' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditStaffModal(staff)}
                                className="text-xs font-medium text-[#1265C8] hover:underline"
                              >
                                Edit / Transfer
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRevokeSession(staff)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#75869D] hover:text-[#172B46]"
                              >
                                <KeyRound className="w-3 h-3" />
                                Revoke Session
                              </button>
                              {staff.status === 'active' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleQuickStatusChange(
                                        staff,
                                        'suspended',
                                        'Suspend Department Staff',
                                        `Suspend ${staff.displayName}? Their active session will be revoked immediately.`,
                                        true
                                      )
                                    }
                                    className="inline-flex items-center gap-1 text-xs font-medium text-[#B7791F] hover:underline"
                                  >
                                    <UserMinus className="w-3 h-3" />
                                    Suspend
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleQuickStatusChange(
                                        staff,
                                        'deactivated',
                                        'Deactivate Department Staff',
                                        `Deactivate ${staff.displayName}? They will no longer be permitted to open their workplace.`,
                                        true
                                      )
                                    }
                                    className="inline-flex items-center gap-1 text-xs font-medium text-[#D34552] hover:underline"
                                  >
                                    <UserX className="w-3 h-3" />
                                    Deactivate
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleQuickStatusChange(
                                      staff,
                                      'active',
                                      'Reactivate Department Staff',
                                      `Restore active access for ${staff.displayName} in ${deptLabel(
                                        staff.primaryDepartment || staff.departments[0]
                                      )}?`,
                                      false
                                    )
                                  }
                                  className="inline-flex items-center gap-1 text-xs font-medium text-[#15966B] hover:underline"
                                >
                                  <UserCheck className="w-3 h-3" />
                                  Activate
                                </button>
                              )}
                            </>
                          ) : isSelfSuper ? (
                            <span className="text-xs text-[#75869D]">Primary Super Admin</span>
                          ) : (
                            <span className="text-xs text-[#75869D]">Super Admin Only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit Staff / Controlled Department Transfer Modal */}
      {editingStaff ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveStaffEdit}
            className="bg-white border border-slate-200 rounded-lg max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#1265C8]" />
                <h3 className="typo-section-heading text-[#172B46]">
                  Edit Staff Permissions & Department Transfer
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingStaff(null)}
                className="text-[#75869D] hover:text-[#172B46]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="typo-meta bg-[#F3F6FA] p-3 rounded-md border border-slate-200">
              <p className="font-semibold text-[#172B46]">{editingStaff.displayName}</p>
              <p className="text-[#75869D]">{editingStaff.email}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Assigned Department Workplace
                </label>
                <select
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value as EightDepartmentId)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
                >
                  {EIGHT_DEPARTMENTS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Department Role
                </label>
                <input
                  type="text"
                  required
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Account Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) =>
                    setEditStatus(
                      e.target.value as 'active' | 'suspended' | 'deactivated' | 'revoked'
                    )
                  }
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="deactivated">Deactivated</option>
                  <option value="revoked">Revoked</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-2">
                Permitted Operations
              </label>
              <div className="grid grid-cols-3 gap-2">
                {GRANULAR_PERMISSIONS.map((perm) => {
                  const checked = editActions.includes(perm.id);
                  return (
                    <label key={perm.id} className="flex items-center gap-2 typo-meta text-[#172B46]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setEditActions((prev) =>
                            e.target.checked
                              ? [...prev, perm.id]
                              : prev.filter((item) => item !== perm.id)
                          )
                        }
                      />
                      <span>{perm.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditingStaff(null)}
                className="px-4 py-2 typo-button text-[#172B46] bg-slate-100 rounded-md"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editBusy || editActions.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-60"
              >
                <ShieldOff className="w-4 h-4 hidden" />
                {editBusy ? 'Saving...' : 'Save Department Assignment'}
              </button>
            </div>
          </form>
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
