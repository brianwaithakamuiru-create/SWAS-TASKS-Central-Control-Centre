import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Eye,
  KeyRound,
  MailPlus,
  Shield,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import {
  EIGHT_DEPARTMENTS,
  EMAIL_GRANULAR_PERMISSIONS,
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
  StaffInvitation,
  StaffLoginHistory,
  StaffVerificationAudit,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { DepartmentInvitationsPanel } from './DepartmentInvitationsPanel';

interface StaffManagementViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  adminUsers: AdminUser[];
  invitations: StaffInvitation[];
  loginHistory: StaffLoginHistory[];
  activityLogs: ActivityLog[];
  verificationAudits?: StaffVerificationAudit[];
}

export function StaffManagementView({
  subId,
  onSelectSub,
  adminUsers,
  invitations,
  loginHistory,
  activityLogs,
  verificationAudits = [],
}: StaffManagementViewProps) {
  const { adminProfile, isSuperAdmin } = useAuth();

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [verificationFilter, setVerificationFilter] = useState<
    'pending_verification' | 'rejected' | 'reviewed'
  >('pending_verification');

  // Review / Approve Staff Verification Modal
  const [reviewingStaff, setReviewingStaff] = useState<AdminUser | null>(null);
  const [reviewDept, setReviewDept] = useState<EightDepartmentId>('user_management');
  const [reviewRole, setReviewRole] = useState('');
  const [reviewActions, setReviewActions] = useState<AdminAction[]>(['view']);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  // Edit / Transfer Staff Modal State
  const [editingStaff, setEditingStaff] = useState<AdminUser | null>(null);
  const [editDept, setEditDept] = useState<EightDepartmentId>('user_management');
  const [editRole, setEditRole] = useState('');
  const [editActions, setEditActions] = useState<AdminAction[]>(['view']);
  const [editStatus, setEditStatus] = useState<
    'active' | 'suspended' | 'deactivated' | 'revoked'
  >('active');
  const [editBusy, setEditBusy] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    danger: boolean;
    requireReason?: boolean;
    reasonLabel?: string;
    onConfirm: (reason: string) => Promise<void>;
  } | null>(null);

  const getEffectiveInviteStatus = (inv: StaffInvitation): StaffInvitation['status'] => {
    if (
      (inv.status === 'pending' || inv.status === 'opened') &&
      new Date(inv.expiresAt).getTime() < Date.now()
    ) {
      return 'expired';
    }
    return inv.status;
  };

  const departmentStaffList = useMemo(() => {
    return [...adminUsers].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [adminUsers]);

  const pendingVerificationStaff = useMemo(() => {
    return [...adminUsers]
      .filter((s) => s.status === 'pending_verification')
      .sort((a, b) => (b.registeredAt || b.createdAt).localeCompare(a.registeredAt || a.createdAt));
  }, [adminUsers]);

  const verificationQueueList = useMemo(() => {
    if (verificationFilter === 'pending_verification') {
      return pendingVerificationStaff;
    }
    if (verificationFilter === 'rejected') {
      return [...adminUsers]
        .filter((s) => s.status === 'rejected')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return [...adminUsers]
      .filter((s) => s.role !== 'SUPER_ADMIN' && s.status !== 'pending_verification')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [adminUsers, pendingVerificationStaff, verificationFilter]);

  const filteredStaff = useMemo(() => {
    if (subId === 'active_staff') return departmentStaffList.filter((s) => s.status === 'active');
    if (subId === 'suspended_staff')
      return departmentStaffList.filter((s) => s.status === 'suspended');
    if (subId === 'deactivated_staff')
      return departmentStaffList.filter(
        (s) => s.status === 'deactivated' || s.status === 'revoked' || s.status === 'rejected'
      );
    return departmentStaffList;
  }, [departmentStaffList, subId]);

  const sortedLoginHistory = useMemo(() => {
    return [...loginHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [loginHistory]);

  const sortedVerificationAudits = useMemo(() => {
    return [...verificationAudits].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [verificationAudits]);

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

  const openVerificationModal = (staff: AdminUser) => {
    const primary =
      staff.primaryDepartment && staff.primaryDepartment !== 'all'
        ? staff.primaryDepartment
        : (staff.departments.find((d) =>
            EIGHT_DEPARTMENTS.some((ed) => ed.id === d)
          ) as EightDepartmentId) || 'user_management';

    setReviewingStaff(staff);
    setReviewDept(primary);
    setReviewRole(staff.role);
    setReviewActions(staff.actions?.length ? staff.actions : ['view']);
    setReviewNote('');
  };

  const handleQuickApprove = (staff: AdminUser) => {
    if (!isSuperAdmin) return;
    setConfirmState({
      open: true,
      title: 'Approve & Activate Staff Account',
      description: `Verify ${staff.displayName} (${staff.email}) and activate access to ${deptLabel(
        staff.primaryDepartment || staff.departments[0]
      )} as ${staff.role}?`,
      confirmLabel: 'Approve & Activate',
      danger: false,
      onConfirm: async () => {
        setActionError(null);
        setActionSuccess(null);
        try {
          await apiFetch(`/api/v1/admin/staff/${staff.uid}/verify-approve`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          setActionSuccess(
            `${staff.displayName} verified and activated for ${deptLabel(
              staff.primaryDepartment || staff.departments[0]
            )}.`
          );
        } catch (err) {
          setActionError(err instanceof Error ? err.message : 'Approval failed.');
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const handleModalApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingStaff || !isSuperAdmin) return;
    setActionError(null);
    setActionSuccess(null);
    setReviewBusy(true);
    try {
      await apiFetch(`/api/v1/admin/staff/${reviewingStaff.uid}/verify-approve`, {
        method: 'POST',
        body: JSON.stringify({
          department: reviewDept,
          role: reviewRole.trim(),
          actions: reviewActions,
          note: reviewNote.trim(),
        }),
      });
      setActionSuccess(
        `${reviewingStaff.displayName} verified and activated for ${deptLabel(reviewDept)}.`
      );
      setReviewingStaff(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve staff account.');
    } finally {
      setReviewBusy(false);
    }
  };

  const handleRejectStaff = (staff: AdminUser) => {
    if (!isSuperAdmin) return;
    setConfirmState({
      open: true,
      title: 'Reject Staff Account Registration',
      description: `Reject registration for ${staff.displayName} (${staff.email})? They will remain blocked from accessing any Control Centre workplace.`,
      confirmLabel: 'Reject Account',
      danger: true,
      requireReason: true,
      reasonLabel: 'Rejection Reason (Required — Recorded in Verification Audit & Email)',
      onConfirm: async (reason) => {
        setActionError(null);
        setActionSuccess(null);
        try {
          await apiFetch(`/api/v1/admin/staff/${staff.uid}/verify-reject`, {
            method: 'POST',
            body: JSON.stringify({ reason, notifyEmail: true }),
          });
          setActionSuccess(`Staff registration for ${staff.email} rejected.`);
          setReviewingStaff(null);
        } catch (err) {
          setActionError(err instanceof Error ? err.message : 'Rejection failed.');
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
    setEditStatus(
      staff.status === 'pending_verification' || staff.status === 'rejected'
        ? 'active'
        : staff.status
    );
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

  const activeInvitationsCount = invitations.filter((i) => {
    const st = getEffectiveInviteStatus(i);
    return st === 'pending' || st === 'opened';
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46]">
            Staff Management, Invitations & Verification
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Short shareable invitation links, strict department isolation, and mandatory Super Admin
            account verification before workplace activation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {pendingVerificationStaff.length > 0 ? (
            <button
              type="button"
              onClick={() => onSelectSub('staff_verification')}
              className="inline-flex items-center gap-2 px-3.5 py-2 typo-button text-[#172B46] bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md transition-colors whitespace-nowrap"
            >
              <Clock className="w-4 h-4 text-[#B7791F]" />
              Review Pending ({pendingVerificationStaff.length})
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onSelectSub('invite_staff')}
            className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md transition-colors whitespace-nowrap"
          >
            <MailPlus className="w-4 h-4" />
            Invite Department Staff
          </button>
        </div>
      </div>

      {/* Subpage Selector */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {STAFF_MANAGEMENT_SUBDEPARTMENTS.map((sub) => (
          <button
            key={sub.id}
            type="button"
            onClick={() => onSelectSub(sub.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 typo-nav rounded-md whitespace-nowrap transition-colors shrink-0 ${
              subId === sub.id
                ? 'bg-[#1265C8] text-white font-semibold'
                : 'bg-white border border-slate-200 text-[#172B46] hover:bg-[#E9F2FF]'
            }`}
          >
            <span>{sub.label}</span>
            {sub.id === 'staff_verification' && pendingVerificationStaff.length > 0 ? (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                  subId === sub.id
                    ? 'bg-white text-[#1265C8]'
                    : 'bg-amber-100 text-[#B7791F]'
                }`}
              >
                {pendingVerificationStaff.length}
              </span>
            ) : null}
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

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Total Staff Accounts</p>
          <p className="mt-1 font-sans tabular-nums text-[20px] font-semibold text-[#172B46]">
            {departmentStaffList.length}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelectSub('staff_verification')}
          className="text-left bg-white border border-slate-200 hover:border-amber-400 rounded-lg p-4 transition-colors"
        >
          <p className="typo-meta text-[#75869D]">Pending Verification</p>
          <p className="mt-1 font-sans tabular-nums text-[20px] font-semibold text-[#B7791F]">
            {pendingVerificationStaff.length}
          </p>
        </button>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Active Staff</p>
          <p className="mt-1 font-sans tabular-nums text-[20px] font-semibold text-[#15966B]">
            {departmentStaffList.filter((s) => s.status === 'active').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Active Invitations</p>
          <p className="mt-1 font-sans tabular-nums text-[20px] font-semibold text-[#1265C8]">
            {activeInvitationsCount}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Suspended / Rejected</p>
          <p className="mt-1 font-sans tabular-nums text-[20px] font-semibold text-[#D34552]">
            {
              departmentStaffList.filter(
                (s) => s.status !== 'active' && s.status !== 'pending_verification'
              ).length
            }
          </p>
        </div>
      </div>

      {/* Subpage: Staff Verification Queue & Audit Trail */}
      {subId === 'staff_verification' ? (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="typo-card-heading text-[#172B46]">
                  Super Admin Staff Verification Queue
                </h2>
                <p className="typo-meta text-[#75869D]">
                  Newly registered staff accounts remain blocked until reviewed and approved by the
                  Super Administrator.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { id: 'pending_verification', label: `Pending (${pendingVerificationStaff.length})` },
                    {
                      id: 'rejected',
                      label: `Rejected (${adminUsers.filter((u) => u.status === 'rejected').length})`,
                    },
                    { id: 'reviewed', label: 'All Reviewed' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setVerificationFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      verificationFilter === tab.id
                        ? 'bg-[#102B50] text-white'
                        : 'bg-[#F3F6FA] text-[#172B46] hover:bg-[#E9F2FF]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {verificationQueueList.length === 0 ? (
              <EmptyState
                title={
                  verificationFilter === 'pending_verification'
                    ? 'No Staff Accounts Pending Verification'
                    : 'No Matching Verification Records'
                }
                description="When an invited staff member completes registration via a /join/ link, their account appears here for Super Admin verification."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Staff Applicant</th>
                      <th className="px-4 py-3 font-medium">Invited Department & Role</th>
                      <th className="px-4 py-3 font-medium">Checks</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Registered</th>
                      <th className="px-4 py-3 font-medium text-right">Verification Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {verificationQueueList.map((staff) => (
                      <tr key={staff.uid} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{staff.displayName}</p>
                          <p className="typo-meta text-[#75869D]">{staff.email}</p>
                          {staff.phone ? (
                            <p className="typo-small tabular-nums text-[#75869D]">{staff.phone}</p>
                          ) : null}
                          {staff.invitationId ? (
                            <p className="typo-small font-mono text-[#75869D] mt-0.5">
                              {staff.invitationId}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">
                            {deptLabel(staff.primaryDepartment || staff.departments[0])}
                          </p>
                          <p className="typo-meta text-[#1265C8] font-medium">{staff.role}</p>
                          <p className="typo-small text-[#75869D] max-w-xs truncate">
                            {(staff.actions || []).join(', ')}
                          </p>
                        </td>
                        <td className="px-4 py-3 typo-small space-y-0.5">
                          <p className={staff.emailVerified ? 'text-[#15966B]' : 'text-[#B7791F]'}>
                            Email: {staff.emailVerified ? 'Verified' : 'Unverified'}
                          </p>
                          <p className={staff.phoneVerified ? 'text-[#15966B]' : 'text-[#75869D]'}>
                            Phone: {staff.phoneVerified ? 'OTP Verified' : staff.phone ? 'Provided' : 'N/A'}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={staff.status} />
                          {staff.rejectionReason ? (
                            <p className="typo-small text-[#D34552] mt-0.5 max-w-[200px] truncate">
                              {staff.rejectionReason}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 tabular-nums typo-meta text-[#75869D]">
                          {new Date(staff.registeredAt || staff.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {isSuperAdmin ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openVerificationModal(staff)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#172B46] hover:text-[#1265C8]"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Inspect
                              </button>
                              {staff.status !== 'active' ? (
                                <button
                                  type="button"
                                  onClick={() => handleQuickApprove(staff)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-[#15966B] hover:bg-[#102B50] rounded"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Approve & Activate
                                </button>
                              ) : null}
                              {staff.status === 'pending_verification' ? (
                                <button
                                  type="button"
                                  onClick={() => handleRejectStaff(staff)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-[#D34552] hover:bg-[#b53743] rounded"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  Reject
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-xs text-[#75869D]">Super Admin Only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Immutable Staff Verification Audit Trail */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#1265C8]" />
              <div>
                <h3 className="typo-card-heading text-[#172B46]">
                  Staff Verification Audit Trail
                </h3>
                <p className="typo-meta text-[#75869D]">
                  Immutable record of every registration, Super Admin approval, rejection, and
                  account activation decision.
                </p>
              </div>
            </div>
            {sortedVerificationAudits.length === 0 ? (
              <EmptyState
                title="No Verification Audits Yet"
                description="Registration submissions and Super Admin approval/rejection decisions will appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Staff Member</th>
                      <th className="px-4 py-3 font-medium">Department & Role</th>
                      <th className="px-4 py-3 font-medium">Decision</th>
                      <th className="px-4 py-3 font-medium">Decided By</th>
                      <th className="px-4 py-3 font-medium">Reason / Note</th>
                      <th className="px-4 py-3 font-medium text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedVerificationAudits.map((audit) => (
                      <tr key={audit.auditId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{audit.staffName}</p>
                          <p className="typo-meta text-[#75869D]">{audit.staffEmail}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">
                            {deptLabel(audit.department)}
                          </p>
                          <p className="typo-meta text-[#75869D]">{audit.assignedRole}</p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={audit.decision} />
                        </td>
                        <td className="px-4 py-3 typo-meta text-[#172B46]">
                          {audit.decidedByName || audit.decidedByUid}
                        </td>
                        <td className="px-4 py-3 typo-meta text-[#75869D] max-w-xs">
                          {audit.decisionReason || '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums typo-meta text-[#75869D]">
                          {new Date(audit.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : subId === 'invite_staff' ? (
        <DepartmentInvitationsPanel
          mode="create"
          invitations={invitations}
          onSuccessMessage={(m) => setActionSuccess(m)}
          onErrorMessage={(m) => setActionError(m)}
        />
      ) : subId === 'pending_invitations' ? (
        <DepartmentInvitationsPanel
          mode="list"
          invitations={invitations}
          onSuccessMessage={(m) => setActionSuccess(m)}
          onErrorMessage={(m) => setActionError(m)}
        />
      ) : subId === 'department_assignments' ? (
        /* Subpage: Department Assignments Matrix */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {EIGHT_DEPARTMENTS.map((dept) => {
            const members = departmentStaffList.filter(
              (s) => s.primaryDepartment === dept.id || s.departments.includes(dept.id)
            );
            return (
              <div key={dept.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="typo-card-heading text-[#172B46]">{dept.label}</h3>
                    <p className="typo-meta text-[#75869D]">{dept.workplaceTitle}</p>
                  </div>
                  <span className="tabular-nums typo-meta font-semibold text-[#1265C8]">
                    {members.length} staff
                  </span>
                </div>
                {members.length === 0 ? (
                  <p className="text-xs text-[#75869D] py-2">
                    No dedicated staff assigned yet. Only Super Administrator accesses this
                    workplace.
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
                          {isSuperAdmin && m.status === 'pending_verification' ? (
                            <button
                              type="button"
                              onClick={() => openVerificationModal(m)}
                              className="text-[#B7791F] font-semibold hover:underline"
                            >
                              Verify
                            </button>
                          ) : isSuperAdmin && m.role !== 'SUPER_ADMIN' ? (
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
        /* Subpage: Staff Roles Matrix */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">
              Department Staff Roles & Authority Matrix
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {Object.values(ROLE_DEFINITIONS).map((r) => (
              <div
                key={r.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
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
        /* Subpage: Granular Permissions Reference */
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
                <p className="typo-meta font-semibold text-[#1265C8] uppercase">{perm.label}</p>
                <p className="typo-meta text-[#172B46] mt-1">{perm.description}</p>
              </div>
            ))}
          </div>
          <div className="pt-3 border-t border-slate-200">
            <h3 className="typo-card-heading text-[#172B46] mb-3">
              Email Communication Centre Permissions
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {EMAIL_GRANULAR_PERMISSIONS.map((perm) => (
                <div key={perm.id} className="p-3.5 rounded-md border border-slate-200 bg-[#F3F6FA]">
                  <p className="typo-meta font-mono font-semibold text-[#1265C8]">{perm.label}</p>
                  <p className="typo-meta text-[#172B46] mt-1">{perm.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : subId === 'login_history' ? (
        /* Subpage: Staff Login History */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">Staff Login & Session History</h2>
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
        /* Subpage: Staff Activity Logs */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">
              Staff Governance & Security Audit Trail
            </h2>
          </div>
          {staffLogs.length === 0 ? (
            <EmptyState
              title="No Staff Governance Events"
              description="Invitations, verification approvals, permission updates, and session revocations are logged here."
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
        /* Subpages: All Staff / Active / Suspended / Deactivated */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">
              {STAFF_MANAGEMENT_SUBDEPARTMENTS.find((s) => s.id === subId)?.label || 'All Staff'}
            </h2>
          </div>
          {filteredStaff.length === 0 ? (
            <EmptyState
              title="No Matching Staff Accounts"
              description="No staff accounts match this status filter yet."
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
                          <p className="typo-small text-[#75869D] max-w-xs truncate">
                            {(staff.actions || []).join(', ')}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={staff.status} />
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {isSuperAdmin && staff.role !== 'SUPER_ADMIN' ? (
                            staff.status === 'pending_verification' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openVerificationModal(staff)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#15966B] hover:underline"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Verify & Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRejectStaff(staff)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-[#D34552] hover:underline"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  Reject
                                </button>
                              </>
                            ) : (
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
                            )
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

      {/* Super Admin Staff Verification Review Modal */}
      {reviewingStaff ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleModalApproveSubmit}
            className="bg-white border border-slate-200 rounded-lg max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#15966B]" />
                <h3 className="typo-section-heading text-[#172B46]">
                  Verify & Activate Staff Registration
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReviewingStaff(null)}
                className="text-[#75869D] hover:text-[#172B46]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="typo-meta bg-[#F3F6FA] p-3.5 rounded-md border border-slate-200 space-y-1">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-[#172B46]">{reviewingStaff.displayName}</p>
                <StatusText status={reviewingStaff.status} />
              </div>
              <p className="text-[#75869D]">
                {reviewingStaff.email} {reviewingStaff.phone ? `· ${reviewingStaff.phone}` : ''}
              </p>
              <p className="text-[#75869D]">
                Registered:{' '}
                {new Date(reviewingStaff.registeredAt || reviewingStaff.createdAt).toLocaleString()}
                {reviewingStaff.invitationId ? ` · Invite: ${reviewingStaff.invitationId}` : ''}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Assigned Department
                </label>
                <select
                  value={reviewDept}
                  onChange={(e) => setReviewDept(e.target.value as EightDepartmentId)}
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
                <label className="block typo-label text-[#172B46] mb-1">Department Role</label>
                <input
                  type="text"
                  required
                  value={reviewRole}
                  onChange={(e) => setReviewRole(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-2">
                Confirm Workplace Permissions
              </label>
              <div className="grid grid-cols-3 gap-2">
                {GRANULAR_PERMISSIONS.map((perm) => {
                  const checked = reviewActions.includes(perm.id);
                  return (
                    <label key={perm.id} className="flex items-center gap-2 typo-meta text-[#172B46]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setReviewActions((prev) =>
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

            <div>
              <label className="block typo-label text-[#172B46] mb-2">
                Email Communication Centre Permissions
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {EMAIL_GRANULAR_PERMISSIONS.map((perm) => {
                  const checked = reviewActions.includes(perm.id);
                  return (
                    <label key={perm.id} className="flex items-center gap-2 typo-meta text-[#172B46]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setReviewActions((prev) =>
                            e.target.checked
                              ? [...prev, perm.id]
                              : prev.filter((item) => item !== perm.id)
                          )
                        }
                      />
                      <span className="font-mono text-xs">{perm.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Verification Audit Note (Optional)
              </label>
              <input
                type="text"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Verified staff identity and department assignment."
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>

            <div className="flex flex-wrap justify-between gap-3 pt-2 border-t border-slate-200">
              {reviewingStaff.status === 'pending_verification' ? (
                <button
                  type="button"
                  onClick={() => handleRejectStaff(reviewingStaff)}
                  className="px-4 py-2 typo-button text-white bg-[#D34552] hover:bg-[#b53743] rounded-md"
                >
                  Reject Registration
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setReviewingStaff(null)}
                  className="px-4 py-2 typo-button text-[#172B46] bg-slate-100 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reviewBusy || reviewActions.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 typo-button text-white bg-[#15966B] hover:bg-[#102B50] rounded-md disabled:opacity-60"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {reviewBusy ? 'Activating...' : 'Approve & Activate Staff'}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

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
                <label className="block typo-label text-[#172B46] mb-1">Department Role</label>
                <input
                  type="text"
                  required
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label className="block typo-label text-[#172B46] mb-1">Account Status</label>
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

            <div>
              <label className="block typo-label text-[#172B46] mb-2">
                Email Communication Centre Permissions
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {EMAIL_GRANULAR_PERMISSIONS.map((perm) => {
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
                      <span className="font-mono text-xs">{perm.label}</span>
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
          confirmLabel={confirmState.confirmLabel}
          danger={confirmState.danger}
          requireReason={confirmState.requireReason}
          reasonLabel={confirmState.reasonLabel}
          onCancel={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
        />
      ) : null}
    </div>
  );
}
