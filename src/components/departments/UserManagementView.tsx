import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Download,
  Mail,
  Plus,
  Search,
  Shield,
  UserCheck,
  UserCog,
  UserX,
  X,
} from 'lucide-react';
import { EIGHT_DEPARTMENTS, ROLE_DEFINITIONS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  exportRecordsToCsv,
  saveAdminAccount,
  updateUserStatus,
} from '../../services/firestoreService';
import type {
  ActivityLog,
  AdminAction,
  AdminRoleId,
  AdminUser,
  DepartmentId,
  EmailTemplateRecord,
  SecurityEvent,
  UserAccount,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { TablePagination, usePaginatedList } from '../common/TablePagination';
import { DepartmentEmailModal, type DepartmentEmailTarget } from './DepartmentEmailModal';

interface UserManagementViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  users: UserAccount[];
  adminUsers: AdminUser[];
  activityLogs: ActivityLog[];
  securityEvents: SecurityEvent[];
  emailTemplates?: EmailTemplateRecord[];
}

const ALL_ACTIONS: AdminAction[] = [
  'view',
  'create',
  'edit',
  'approve',
  'reject',
  'suspend',
  'revoke',
  'export',
  'manage',
];

type UserSortKey = 'fullName' | 'createdAt' | 'status';

export function UserManagementView({
  subId,
  onSelectSub,
  users,
  adminUsers,
  activityLogs,
  securityEvents,
  emailTemplates = [],
}: UserManagementViewProps) {
  const { adminProfile, hasAction, hasEmailPermission } = useAuth();
  const canEmail = hasEmailPermission('email.compose');
  const subdepartments =
    EIGHT_DEPARTMENTS.find((d) => d.id === 'user_management')?.subdepartments || [];

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<UserSortKey>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(null);
  const [emailTarget, setEmailTarget] = useState<DepartmentEmailTarget | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    danger: boolean;
    onConfirm: (reason: string) => Promise<void>;
  } | null>(null);

  // Admin Authorization Modal (Super Admin Only)
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [newAdminUid, setNewAdminUid] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<AdminRoleId>('USER_MANAGEMENT_ADMIN');
  const [newAdminDepts, setNewAdminDepts] = useState<DepartmentId[]>(['user_management']);
  const [newAdminActions, setNewAdminActions] = useState<AdminAction[]>(['view', 'edit']);
  const [newAdminStatus, setNewAdminStatus] = useState<
    'active' | 'suspended' | 'deactivated' | 'revoked'
  >('active');
  const [editingExistingAdmin, setEditingExistingAdmin] = useState(false);

  const isSuperAdmin = adminProfile?.role === 'SUPER_ADMIN';

  const metrics = useMemo(() => {
    const workers = users.filter((u) => u.accountType === 'worker' || u.accountType === 'hybrid').length;
    const pendingVerification = users.filter(
      (u) => u.verificationStatus === 'pending' || u.verificationStatus === 'unverified'
    ).length;
    const pendingApproval = users.filter((u) => u.status === 'pending').length;
    const recoveryRequests = users.filter((u) => u.status === 'recovery_requested').length;
    const suspendedOrBanned = users.filter(
      (u) => u.status === 'suspended' || u.status === 'banned'
    ).length;
    const reportedUsers = users.filter((u) => Number(u.reportCount || 0) > 0).length;
    return {
      total: users.length,
      workers,
      pendingVerification,
      pendingApproval,
      recoveryRequests,
      suspendedOrBanned,
      reportedUsers,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = users.filter((u) => {
      if (subId === 'worker_accounts' && u.accountType !== 'worker' && u.accountType !== 'hybrid') {
        return false;
      }
      if (
        subId === 'user_verification' &&
        u.verificationStatus !== 'pending' &&
        u.verificationStatus !== 'unverified'
      ) {
        return false;
      }
      if (subId === 'account_approvals' && u.status !== 'pending') return false;
      if (subId === 'suspended_accounts' && u.status !== 'suspended') return false;
      if (subId === 'banned_accounts' && u.status !== 'banned') return false;
      if (subId === 'user_reports' && Number(u.reportCount || 0) <= 0) return false;
      if (subId === 'account_recovery' && u.status !== 'recovery_requested') return false;

      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'fullName') cmp = a.fullName.localeCompare(b.fullName);
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status);
      else cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      return sortAsc ? cmp : -cmp;
    });
  }, [users, subId, search, sortKey, sortAsc]);

  const userLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...activityLogs]
      .filter((l) => l.category === 'user' || l.category === 'worker' || l.category === 'account_change')
      .filter((l) => {
        if (!q) return true;
        return (
          l.action.toLowerCase().includes(q) ||
          l.affectedRecord.toLowerCase().includes(q) ||
          (l.actorEmail || l.actorId).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [activityLogs, search]);

  const usersPagination = usePaginatedList(filteredUsers, 15);
  const logsPagination = usePaginatedList(userLogs, 15);
  const securityPagination = usePaginatedList(securityEvents, 15);

  const userActivityHistory = useMemo(() => {
    if (!selectedUser) return [];
    return activityLogs
      .filter(
        (l) =>
          l.actorId === selectedUser.uid ||
          l.affectedRecord.includes(selectedUser.uid)
      )
      .slice(0, 12);
  }, [activityLogs, selectedUser]);

  const toggleSort = (key: UserSortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(key === 'fullName');
    }
  };

  const triggerUserMutation = (
    user: UserAccount,
    updates: Parameters<typeof updateUserStatus>[2],
    actionLabel: string,
    title: string,
    description: string,
    danger = false
  ) => {
    if (!adminProfile) return;
    setConfirmState({
      open: true,
      title,
      description,
      danger,
      onConfirm: async () => {
        setActionError(null);
        setActionSuccess(null);
        try {
          await updateUserStatus(adminProfile, user.uid, updates, actionLabel);
          setActionSuccess(`Action ${actionLabel} applied to ${user.fullName}.`);
          setConfirmState(null);
          if (selectedUser?.uid === user.uid) {
            setSelectedUser({ ...user, ...updates });
          }
        } catch (err) {
          setActionError(err instanceof Error ? err.message : 'Update failed');
          setConfirmState(null);
        }
      },
    });
  };

  const handleOpenNewAdminModal = () => {
    const def = ROLE_DEFINITIONS.USER_MANAGEMENT_ADMIN;
    setEditingExistingAdmin(false);
    setNewAdminUid('');
    setNewAdminEmail('');
    setNewAdminName('');
    setNewAdminRole('USER_MANAGEMENT_ADMIN');
    setNewAdminDepts(def.departments);
    setNewAdminActions(def.actions);
    setNewAdminStatus('active');
    setAdminModalOpen(true);
  };

  const handleEditAdmin = (adm: AdminUser) => {
    setEditingExistingAdmin(true);
    setNewAdminUid(adm.uid);
    setNewAdminEmail(adm.email);
    setNewAdminName(adm.displayName);
    setNewAdminRole(adm.role);
    setNewAdminDepts(adm.departments);
    setNewAdminActions(adm.actions);
    setNewAdminStatus(
      adm.status === 'pending_verification' || adm.status === 'rejected'
        ? 'suspended'
        : adm.status
    );
    setAdminModalOpen(true);
  };

  const handleSaveAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminProfile || !isSuperAdmin) return;
    setActionError(null);
    setActionSuccess(null);
    try {
      await saveAdminAccount(adminProfile, {
        uid: newAdminUid.trim(),
        email: newAdminEmail.trim(),
        displayName: newAdminName.trim(),
        role: newAdminRole,
        status: newAdminStatus,
        departments: newAdminDepts,
        actions: newAdminActions,
        isNew: !editingExistingAdmin,
      });
      setActionSuccess(
        editingExistingAdmin
          ? `Updated administrator permissions for ${newAdminEmail}.`
          : `Authorized new administrator ${newAdminEmail}.`
      );
      setAdminModalOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save administrator account.');
    }
  };

  const handleRolePresetChange = (roleId: AdminRoleId) => {
    setNewAdminRole(roleId);
    const preset = ROLE_DEFINITIONS[roleId];
    if (preset) {
      setNewAdminDepts(preset.departments);
      setNewAdminActions(preset.actions);
    }
  };

  const handleExportUsersCsv = () => {
    exportRecordsToCsv(
      `swas-users-${subId}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['UID', 'Full Name', 'Email', 'Phone', 'Account Type', 'Verification', 'Status', 'Reports', 'Created At'],
      filteredUsers.map((u) => [
        u.uid,
        u.fullName,
        u.email,
        u.phone || '',
        u.accountType,
        u.verificationStatus,
        u.status,
        u.reportCount || 0,
        u.createdAt,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46]">
            User Management
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Manage platform workers, user verification, account standing, security, and admin RBAC.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasAction('export') ? (
            <button
              type="button"
              onClick={handleExportUsersCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 typo-button text-[#172B46] bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          ) : null}
          {isSuperAdmin ? (
            <button
              type="button"
              onClick={handleOpenNewAdminModal}
              className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Authorize Administrator
            </button>
          ) : null}
        </div>
      </div>

      {/* Subdepartment Selector Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {subdepartments.map((sub) => (
          <button
            key={sub.id}
            type="button"
            onClick={() => onSelectSub(sub.id)}
            className={`px-3 py-1.5 typo-nav rounded-md whitespace-nowrap transition-colors shrink-0 ${
              subId === sub.id
                ? 'bg-[#1265C8] text-white'
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

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Total Users</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#172B46]">
            {metrics.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Workers</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#172B46]">
            {metrics.workers}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Pending Verification</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#E6A23C]">
            {metrics.pendingVerification}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Suspended / Banned</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#D34552]">
            {metrics.suspendedOrBanned}
          </p>
        </div>
      </div>

      {subId === 'dashboard' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div>
              <h2 className="typo-card-heading text-[#172B46]">
                User Operations Queues & Quick Actions
              </h2>
              <p className="typo-meta text-[#75869D]">
                Live queue counts from Cloud Firestore <span className="font-mono">users</span>.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  id: 'user_verification',
                  label: 'Verification Queue',
                  count: metrics.pendingVerification,
                  icon: UserCheck,
                },
                {
                  id: 'account_approvals',
                  label: 'Pending Approvals',
                  count: metrics.pendingApproval,
                  icon: UserCog,
                },
                {
                  id: 'account_recovery',
                  label: 'Recovery Requests',
                  count: metrics.recoveryRequests,
                  icon: Shield,
                },
                {
                  id: 'user_reports',
                  label: 'Reported Accounts',
                  count: metrics.reportedUsers,
                  icon: UserX,
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => onSelectSub(card.id)}
                    className="p-4 rounded-md border border-slate-200 hover:border-[#1265C8] hover:bg-[#E9F2FF]/40 text-left flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-[#1265C8]" />
                      <div>
                        <p className="typo-body font-medium text-[#172B46]">{card.label}</p>
                        <p className="typo-meta text-[#75869D]">Review records</p>
                      </div>
                    </div>
                    <span className="tabular-nums text-lg font-semibold text-[#172B46]">
                      {card.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="typo-card-heading text-[#172B46]">
                Recent User Audits
              </h2>
              <button
                type="button"
                onClick={() => onSelectSub('activity_history')}
                className="typo-meta font-medium text-[#1265C8] hover:underline"
              >
                View All
              </button>
            </div>
            {userLogs.length === 0 ? (
              <p className="typo-meta text-[#75869D]">
                No user management audit logs recorded yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {userLogs.slice(0, 6).map((l) => (
                  <div key={l.eventId} className="py-2.5 typo-meta">
                    <p className="font-medium text-[#172B46]">{l.action}</p>
                    <p className="text-[#75869D] font-mono truncate">{l.affectedRecord}</p>
                    <p className="typo-small tabular-nums text-[#75869D] mt-0.5">
                      {new Date(l.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : subId === 'user_roles_permissions' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="typo-card-heading text-[#172B46]">
                Authorized Administrators & Department Permissions
              </h2>
              <p className="typo-meta text-[#75869D]">
                Backend-enforced RBAC accounts stored in Firestore <span className="font-mono">admin_users</span>.
              </p>
            </div>
          </div>
          {adminUsers.length === 0 ? (
            <EmptyState
              title="No Secondary Administrators Visible"
              description="Super Administrators and Staff Managers can inspect and assign department permissions here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Administrator</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Departments</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {adminUsers.map((adm) => (
                    <tr key={adm.uid} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#172B46]">{adm.displayName}</p>
                        <p className="typo-meta text-[#75869D]">{adm.email}</p>
                      </td>
                      <td className="px-4 py-3 typo-meta font-medium text-[#102B50]">
                        {ROLE_DEFINITIONS[adm.role]?.label || adm.role}
                      </td>
                      <td className="px-4 py-3 typo-meta text-[#75869D]">
                        {adm.departments.join(', ')}
                      </td>
                      <td className="px-4 py-3 typo-meta text-[#75869D]">
                        {adm.actions.join(', ')}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={adm.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isSuperAdmin ? (
                          <button
                            type="button"
                            onClick={() => handleEditAdmin(adm)}
                            className="typo-meta font-medium text-[#1265C8] hover:underline"
                          >
                            Edit Permissions
                          </button>
                        ) : (
                          <span className="typo-meta text-[#75869D]">Super Admin Only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : subId === 'login_security' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">
              Login & Security Events
            </h2>
            <p className="typo-meta text-[#75869D]">
              Suspicious authentication attempts and security alerts from <span className="font-mono">security_events</span>.
            </p>
          </div>
          {securityEvents.length === 0 ? (
            <EmptyState
              title="No Security Anomalies Recorded"
              description="Failed login attempts, account lockouts, and suspicious access alerts will appear here automatically."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Event Type</th>
                      <th className="px-4 py-3 font-medium">Account</th>
                      <th className="px-4 py-3 font-medium">Detail</th>
                      <th className="px-4 py-3 font-medium">Severity</th>
                      <th className="px-4 py-3 font-medium text-right">Recorded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {securityPagination.pagedItems.map((ev) => (
                      <tr key={ev.eventId} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-[#172B46]">{ev.eventType}</td>
                        <td className="px-4 py-3 typo-meta text-[#75869D]">{ev.actorEmail || 'N/A'}</td>
                        <td className="px-4 py-3 typo-meta text-[#75869D]">{ev.detail}</td>
                        <td className="px-4 py-3">
                          <StatusText status={ev.severity} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums typo-meta text-[#75869D]">
                          {new Date(ev.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                page={securityPagination.page}
                pageSize={securityPagination.pageSize}
                totalItems={securityPagination.totalItems}
                totalPages={securityPagination.totalPages}
                onPageChange={securityPagination.setPage}
                onPageSizeChange={securityPagination.setPageSize}
              />
            </>
          )}
        </div>
      ) : subId === 'activity_history' ? (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
            <Search className="w-4 h-4 text-[#75869D]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter user management activity history by actor, action, or UID..."
              className="flex-1 typo-input text-[#172B46] focus:outline-none"
            />
          </div>
          {userLogs.length === 0 ? (
            <EmptyState
              title="No User Activity History Recorded"
              description="All user account verifications, status changes, and role updates are recorded immutably."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Action</th>
                      <th className="px-4 py-3 font-medium">Actor</th>
                      <th className="px-4 py-3 font-medium">Target Record</th>
                      <th className="px-4 py-3 font-medium">Result</th>
                      <th className="px-4 py-3 font-medium text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logsPagination.pagedItems.map((l) => (
                      <tr key={l.eventId} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-[#172B46]">{l.action}</td>
                        <td className="px-4 py-3 typo-meta text-[#75869D]">{l.actorEmail || l.actorId}</td>
                        <td className="px-4 py-3 font-mono typo-meta text-[#75869D]">{l.affectedRecord}</td>
                        <td className="px-4 py-3">
                          <StatusText status={l.result} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums typo-meta text-[#75869D]">
                          {new Date(l.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                page={logsPagination.page}
                pageSize={logsPagination.pageSize}
                totalItems={logsPagination.totalItems}
                totalPages={logsPagination.totalPages}
                onPageChange={logsPagination.setPage}
                onPageSizeChange={logsPagination.setPageSize}
              />
            </div>
          )}
        </div>
      ) : (
        /* User Directory Table */
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
            <Search className="w-4 h-4 text-[#75869D]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users by name, email, or UID..."
              className="flex-1 typo-input text-[#172B46] focus:outline-none"
            />
          </div>

          {filteredUsers.length === 0 ? (
            <EmptyState
              title="No Matching User Records"
              description="No accounts in Cloud Firestore match this subdepartment filter yet. Records created on the connected SWAS TASKS public website appear here in real time."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => toggleSort('fullName')}
                          className="inline-flex items-center gap-1 hover:text-[#172B46]"
                        >
                          <span>User</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Verification</th>
                      <th className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => toggleSort('status')}
                          className="inline-flex items-center gap-1 hover:text-[#172B46]"
                        >
                          <span>Status</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => toggleSort('createdAt')}
                          className="inline-flex items-center gap-1 hover:text-[#172B46]"
                        >
                          <span>Registered</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {usersPagination.pagedItems.map((u) => (
                      <tr key={u.uid} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedUser(u)}
                            className="text-left group"
                          >
                            <p className="font-medium text-[#172B46] group-hover:text-[#1265C8]">
                              {u.fullName}
                            </p>
                            <p className="typo-meta text-[#75869D]">{u.email}</p>
                          </button>
                        </td>
                        <td className="px-4 py-3 capitalize text-[#172B46]">{u.accountType}</td>
                        <td className="px-4 py-3">
                          <StatusText status={u.verificationStatus} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={u.status} />
                        </td>
                        <td className="px-4 py-3 tabular-nums typo-meta text-[#75869D]">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {hasAction('approve') && u.verificationStatus !== 'verified' ? (
                            <button
                              type="button"
                              onClick={() =>
                                triggerUserMutation(
                                  u,
                                  { verificationStatus: 'verified', status: 'active' },
                                  'VERIFY_USER_ACCOUNT',
                                  'Verify User Account',
                                  `Verify ${u.fullName} (${u.email}) and activate account access?`
                                )
                              }
                              className="text-xs font-medium text-[#15966B] hover:underline"
                            >
                              Verify
                            </button>
                          ) : null}

                          {hasAction('suspend') && u.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() =>
                                triggerUserMutation(
                                  u,
                                  { status: 'suspended' },
                                  'SUSPEND_USER_ACCOUNT',
                                  'Suspend User Account',
                                  `Suspend ${u.fullName} (${u.email})? They will lose platform access until reactivated.`,
                                  true
                                )
                              }
                              className="text-xs font-medium text-[#E6A23C] hover:underline"
                            >
                              Suspend
                            </button>
                          ) : null}

                          {hasAction('update') &&
                          (u.status === 'suspended' ||
                            u.status === 'pending' ||
                            u.status === 'recovery_requested') ? (
                            <button
                              type="button"
                              onClick={() =>
                                triggerUserMutation(
                                  u,
                                  { status: 'active' },
                                  'ACTIVATE_USER_ACCOUNT',
                                  'Activate User Account',
                                  `Restore active standing for ${u.fullName}?`
                                )
                              }
                              className="text-xs font-medium text-[#1265C8] hover:underline"
                            >
                              Activate
                            </button>
                          ) : null}

                          {hasAction('suspend') && u.status !== 'banned' ? (
                            <button
                              type="button"
                              onClick={() =>
                                triggerUserMutation(
                                  u,
                                  { status: 'banned' },
                                  'BAN_USER_ACCOUNT',
                                  'Ban User Account',
                                  `Permanently ban ${u.fullName} (${u.email}) under platform policy?`,
                                  true
                                )
                              }
                              className="text-xs font-medium text-[#D34552] hover:underline"
                            >
                              Ban
                            </button>
                          ) : null}

                          {canEmail && u.email ? (
                            <button
                              type="button"
                              onClick={() =>
                                setEmailTarget({
                                  name: u.fullName,
                                  email: u.email,
                                  uid: u.uid,
                                  recipientType: u.accountType === 'worker' ? 'worker' : 'user',
                                  sourceRecord: `users/${u.uid}`,
                                  vars: {
                                    client_name: u.fullName,
                                    first_name: u.fullName.split(' ')[0] || u.fullName,
                                    email: u.email,
                                    account_id: u.uid,
                                    account_status: u.status,
                                  },
                                })
                              }
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#1265C8] hover:underline"
                            >
                              <Mail className="w-3 h-3" />
                              Email
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                page={usersPagination.page}
                pageSize={usersPagination.pageSize}
                totalItems={usersPagination.totalItems}
                totalPages={usersPagination.totalPages}
                onPageChange={usersPagination.setPage}
                onPageSizeChange={usersPagination.setPageSize}
              />
            </div>
          )}
        </div>
      )}

      {/* User Profile Detail Drawer */}
      {selectedUser ? (
        <div className="fixed inset-0 z-40 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-lg h-full overflow-y-auto p-6 border-l border-slate-200">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h3 className="typo-section-heading text-[#172B46]">
                  {selectedUser.fullName}
                </h3>
                <p className="typo-meta font-mono text-[#75869D]">{selectedUser.uid}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="p-1 text-[#75869D] hover:text-[#172B46]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <dl className="mt-4 space-y-3 typo-body">
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <dt className="text-[#75869D]">Email</dt>
                <dd className="font-medium text-[#172B46]">{selectedUser.email}</dd>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <dt className="text-[#75869D]">Phone</dt>
                <dd className="tabular-nums typo-meta text-[#172B46]">{selectedUser.phone || 'Not provided'}</dd>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <dt className="text-[#75869D]">Account Type</dt>
                <dd className="capitalize text-[#172B46]">{selectedUser.accountType}</dd>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <dt className="text-[#75869D]">Status</dt>
                <dd>
                  <StatusText status={selectedUser.status} />
                </dd>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <dt className="text-[#75869D]">Verification</dt>
                <dd>
                  <StatusText status={selectedUser.verificationStatus} />
                </dd>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <dt className="text-[#75869D]">Registered</dt>
                <dd className="tabular-nums typo-meta text-[#172B46]">
                  {new Date(selectedUser.createdAt).toLocaleString()}
                </dd>
              </div>
            </dl>

            {canEmail && selectedUser.email ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() =>
                    setEmailTarget({
                      name: selectedUser.fullName,
                      email: selectedUser.email,
                      uid: selectedUser.uid,
                      recipientType: selectedUser.accountType === 'worker' ? 'worker' : 'user',
                      sourceRecord: `users/${selectedUser.uid}`,
                      vars: {
                        client_name: selectedUser.fullName,
                        first_name: selectedUser.fullName.split(' ')[0] || selectedUser.fullName,
                        email: selectedUser.email,
                        account_id: selectedUser.uid,
                        account_status: selectedUser.status,
                      },
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
                >
                  <Mail className="w-4 h-4" />
                  Email {selectedUser.fullName}
                </button>
              </div>
            ) : null}

            <div className="mt-6">
              <h4 className="typo-card-heading text-[#75869D] mb-2">
                Recent Audit History
              </h4>
              {userActivityHistory.length === 0 ? (
                <p className="typo-meta text-[#75869D]">No audit events linked to this user.</p>
              ) : (
                <div className="space-y-2">
                  {userActivityHistory.map((log) => (
                    <div key={log.eventId} className="p-2.5 rounded border border-slate-200 typo-meta">
                      <p className="font-medium text-[#172B46]">{log.action}</p>
                      <p className="text-[#75869D] tabular-nums mt-0.5">
                        {new Date(log.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Authorize / Edit Admin Modal (Super Admin Only) */}
      {adminModalOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAdmin}
            className="bg-white border border-slate-200 rounded-lg max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#1265C8]" />
                <h3 className="typo-section-heading text-[#172B46]">
                  {editingExistingAdmin ? 'Update Administrator Permissions' : 'Authorize Administrator'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAdminModalOpen(false)}
                className="text-[#75869D] hover:text-[#172B46]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Firebase User UID
                </label>
                <input
                  type="text"
                  required
                  disabled={editingExistingAdmin}
                  value={newAdminUid}
                  onChange={(e) => setNewAdminUid(e.target.value)}
                  placeholder="Firebase Auth UID"
                  className="w-full px-3 py-2 typo-input font-mono border border-slate-300 rounded-md disabled:bg-slate-100"
                />
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  placeholder="staff@swastasks.com"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={newAdminName}
                  onChange={(e) => setNewAdminName(e.target.value)}
                  placeholder="Administrator Name"
                  className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block typo-label text-[#172B46] mb-1">
                  Account Status
                </label>
                <select
                  value={newAdminStatus}
                  onChange={(e) =>
                    setNewAdminStatus(
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
              <label className="block typo-label text-[#172B46] mb-1">Role Preset</label>
              <select
                value={newAdminRole}
                onChange={(e) => handleRolePresetChange(e.target.value as AdminRoleId)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
              >
                {Object.values(ROLE_DEFINITIONS).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-2">
                Authorized Departments
              </label>
              <div className="grid grid-cols-2 gap-2">
                {EIGHT_DEPARTMENTS.map((d) => {
                  const checked = newAdminDepts.includes(d.id);
                  return (
                    <label key={d.id} className="flex items-center gap-2 typo-meta text-[#172B46]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setNewAdminDepts((prev) =>
                            e.target.checked
                              ? [...prev, d.id]
                              : prev.filter((item) => item !== d.id)
                          );
                        }}
                      />
                      <span>{d.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-2">
                Permitted Operations
              </label>
              <div className="flex flex-wrap gap-3">
                {ALL_ACTIONS.map((act) => {
                  const checked = newAdminActions.includes(act);
                  return (
                    <label key={act} className="flex items-center gap-1.5 typo-meta text-[#172B46]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setNewAdminActions((prev) =>
                            e.target.checked
                              ? [...prev, act]
                              : prev.filter((item) => item !== act)
                          );
                        }}
                      />
                      <span className="capitalize">{act}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setAdminModalOpen(false)}
                className="px-4 py-2 typo-button text-[#172B46] bg-slate-100 rounded-md"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
              >
                <UserCheck className="w-4 h-4" />
                Save Authorization
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

      <DepartmentEmailModal
        open={Boolean(emailTarget)}
        onClose={() => setEmailTarget(null)}
        department="user_management"
        initialRecipient={emailTarget}
        templates={emailTemplates}
      />
    </div>
  );
}
