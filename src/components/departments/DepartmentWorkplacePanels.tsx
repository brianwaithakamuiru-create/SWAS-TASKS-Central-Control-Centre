import React, { useMemo, useState } from 'react';
import {
  Bell,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardList,
  History,
  KeyRound,
  Lock,
  LogOut,
  MessageSquare,
  Send,
  Settings,
  ShieldAlert,
  Users,
  Wallet,
} from 'lucide-react';
import { EIGHT_DEPARTMENTS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import { markNotificationRead, sendDepartmentMessage } from '../../services/firestoreService';
import type {
  ActivityLog,
  AdminNotification,
  AssignmentRecord,
  ClientAccount,
  ConnectedApp,
  DepartmentMessage,
  EightDepartmentId,
  SecurityEvent,
  SupportTicket,
  TaskRecord,
  TransactionRecord,
  UserAccount,
  WithdrawalRequest,
} from '../../types/admin';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { DepartmentInvitationsPanel } from './DepartmentInvitationsPanel';
import { EmailCentreView } from './EmailCentreView';
import { GoogleDriveView } from './GoogleDriveView';
import { StaffProfileView } from './StaffProfileView';
import type {
  EmailCampaignRecord,
  EmailDraftRecord,
  EmailLogRecord,
  EmailTemplateRecord,
  PlatformSetting,
  StaffInvitation,
  StaffLoginHistory,
} from '../../types/admin';

export type WorkplaceTab =
  | 'operations'
  | 'email'
  | 'drive'
  | 'invitations'
  | 'pending_queue'
  | 'notifications'
  | 'communication'
  | 'activity_history'
  | 'account_security'
  | 'help';

const DEPT_ICON_MAP = {
  Users,
  Building2,
  ClipboardList,
  Briefcase,
  Wallet,
  KeyRound,
  ShieldAlert,
  Settings,
};

interface DepartmentWorkplacePanelsProps {
  department: EightDepartmentId;
  subId: string;
  activeTab: WorkplaceTab;
  onSelectTab: (tab: WorkplaceTab) => void;
  onNavigateSub: (subId: string) => void;
  users: UserAccount[];
  clients: ClientAccount[];
  tasks: TaskRecord[];
  assignments: AssignmentRecord[];
  transactions: TransactionRecord[];
  withdrawals: WithdrawalRequest[];
  connectedApps: ConnectedApp[];
  securityEvents: SecurityEvent[];
  tickets: SupportTicket[];
  activityLogs: ActivityLog[];
  loginHistory: StaffLoginHistory[];
  notifications: AdminNotification[];
  departmentMessages: DepartmentMessage[];
  settingsDocs?: PlatformSetting[];
  emailLogs?: EmailLogRecord[];
  emailTemplates?: EmailTemplateRecord[];
  emailDrafts?: EmailDraftRecord[];
  emailCampaigns?: EmailCampaignRecord[];
  invitations?: StaffInvitation[];
  children: React.ReactNode;
}

export function DepartmentWorkplacePanels({
  department,
  subId,
  activeTab,
  onSelectTab,
  onNavigateSub,
  users,
  clients,
  tasks,
  assignments,
  transactions,
  withdrawals,
  connectedApps,
  securityEvents,
  tickets,
  activityLogs,
  loginHistory,
  notifications,
  departmentMessages,
  settingsDocs = [],
  emailLogs = [],
  emailTemplates = [],
  emailDrafts = [],
  emailCampaigns = [],
  invitations = [],
  children,
}: DepartmentWorkplacePanelsProps) {
  const { adminProfile, isSuperAdmin, hasAction, hasEmailPermission } = useAuth();
  const canViewEmail = hasEmailPermission('email.view');
  const canManageDeptInvitations = isSuperAdmin || hasAction('manage');
  const [emailSubTab, setEmailSubTab] = useState('dashboard');
  const deptConfig = EIGHT_DEPARTMENTS.find((d) => d.id === department);
  const DeptIcon = deptConfig ? DEPT_ICON_MAP[deptConfig.iconName] : Users;

  const [msgText, setMsgText] = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const pendingItems = useMemo(() => {
    const items: { id: string; title: string; subtitle: string; status: string; subId: string }[] = [];
    if (department === 'user_management') {
      for (const u of users) {
        if (u.status === 'pending' || u.status === 'recovery_requested' || u.verificationStatus === 'pending') {
          items.push({
            id: u.uid,
            title: u.fullName,
            subtitle: `${u.email} · ${u.accountType}`,
            status: u.status === 'pending' ? 'pending' : u.verificationStatus,
            subId: u.status === 'recovery_requested' ? 'account_recovery' : 'user_verification',
          });
        }
      }
    } else if (department === 'client_management') {
      for (const c of clients) {
        if (c.status === 'pending' || c.verificationStatus === 'pending') {
          items.push({
            id: c.clientId,
            title: c.companyName || c.name,
            subtitle: `${c.email} · ${c.accountTier}`,
            status: c.status,
            subId: 'client_approvals',
          });
        }
      }
      for (const t of tickets) {
        if (t.status === 'open' || t.status === 'in_progress') {
          items.push({
            id: t.ticketId,
            title: t.subject,
            subtitle: `Ticket (${t.priority}) · ${t.requesterName || t.requesterType}`,
            status: t.status,
            subId: 'client_support',
          });
        }
      }
    } else if (department === 'task_monitoring') {
      for (const t of tasks) {
        if (t.status === 'pending' || t.status === 'reported') {
          items.push({
            id: t.taskId,
            title: t.title,
            subtitle: `${t.category} · KES ${Number(t.budgetKes).toLocaleString()}`,
            status: t.status,
            subId: t.status === 'reported' ? 'reported_tasks' : 'pending_tasks',
          });
        }
      }
    } else if (department === 'bids_assignments') {
      for (const a of assignments) {
        if (a.status === 'submitted' || a.status === 'disputed' || a.status === 'revision_requested') {
          items.push({
            id: a.assignmentId,
            title: a.taskTitle || a.assignmentId,
            subtitle: `Worker: ${a.workerName || a.workerUid} · KES ${Number(a.agreedAmountKes).toLocaleString()}`,
            status: a.status,
            subId: a.status === 'disputed' ? 'dispute_management' : 'work_submissions',
          });
        }
      }
    } else if (department === 'finance_control') {
      for (const w of withdrawals) {
        if (w.status === 'pending') {
          items.push({
            id: w.withdrawalId,
            title: `Withdrawal · KES ${Number(w.amountKes).toLocaleString()}`,
            subtitle: `${w.workerName || w.workerUid} · ${w.destinationType.toUpperCase()}`,
            status: w.status,
            subId: 'pending_withdrawals',
          });
        }
      }
      for (const tr of transactions) {
        if (tr.status === 'verified' && !tr.reconciled) {
          items.push({
            id: tr.transactionId,
            title: `Unreconciled ${tr.type.replace(/_/g, ' ')}`,
            subtitle: `KES ${Number(tr.amountKes).toLocaleString()} · ${tr.provider || 'Verified'}`,
            status: 'pending',
            subId: 'reconciliation',
          });
        }
      }
    } else if (department === 'api_management') {
      for (const app of connectedApps) {
        if (app.status === 'error') {
          items.push({
            id: app.appId,
            title: app.name,
            subtitle: app.websiteUrl,
            status: app.status,
            subId: 'connected_websites',
          });
        }
      }
    } else if (department === 'activity_logs') {
      for (const ev of securityEvents) {
        if (!ev.resolved) {
          items.push({
            id: ev.eventId,
            title: ev.eventType,
            subtitle: ev.detail,
            status: ev.severity,
            subId: 'security_logs',
          });
        }
      }
    }
    return items.slice(0, 25);
  }, [
    department,
    users,
    clients,
    tickets,
    tasks,
    assignments,
    withdrawals,
    transactions,
    connectedApps,
    securityEvents,
  ]);

  const deptNotifications = useMemo(() => {
    const typeFilter: Record<EightDepartmentId, string[]> = {
      user_management: ['user_registration', 'reported_account', 'security_alert'],
      client_management: ['client_registration'],
      task_monitoring: ['new_task'],
      bids_assignments: ['dispute'],
      finance_control: ['withdrawal', 'failed_payment'],
      api_management: ['api_failure'],
      activity_logs: ['security_alert', 'system_error'],
      platform_settings: ['system_error'],
    };
    return [...notifications]
      .filter((n) => typeFilter[department]?.includes(n.type))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [notifications, department]);

  const deptMessages = useMemo(() => {
    return [...departmentMessages]
      .filter((m) => m.department === department)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [departmentMessages, department]);

  const deptActivityHistory = useMemo(() => {
    return [...activityLogs]
      .filter(
        (l) =>
          l.actorId === adminProfile?.uid ||
          l.affectedRecord.includes(department) ||
          (department === 'user_management' && l.category === 'user') ||
          (department === 'client_management' && l.category === 'client') ||
          (department === 'finance_control' && l.category === 'financial') ||
          (department === 'api_management' && l.category === 'api')
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 40);
  }, [activityLogs, adminProfile?.uid, department]);

  const handleSendDeptMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminProfile || !msgText.trim()) return;
    setMsgError(null);
    setMsgSending(true);
    try {
      await sendDepartmentMessage(adminProfile, department, msgText.trim());
      setMsgText('');
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Failed to send internal message.');
    } finally {
      setMsgSending(false);
    }
  };

  const deptActiveInvitesCount = useMemo(() => {
    return invitations.filter(
      (i) =>
        i.department === department &&
        (i.status === 'pending' || i.status === 'opened') &&
        new Date(i.expiresAt).getTime() > Date.now()
    ).length;
  }, [invitations, department]);

  const tabs: { id: WorkplaceTab; label: string; count?: number }[] = [
    { id: 'operations', label: 'Department Operations' },
    ...(canViewEmail ? [{ id: 'email' as WorkplaceTab, label: 'Department Email' }] : []),
    { id: 'drive', label: 'Google Drive' },
    ...(canManageDeptInvitations
      ? [
          {
            id: 'invitations' as WorkplaceTab,
            label: 'Department Invitations',
            count: deptActiveInvitesCount,
          },
        ]
      : []),
    { id: 'pending_queue', label: 'Assigned Tasks & Reviews', count: pendingItems.length },
    { id: 'notifications', label: 'Department Notices', count: deptNotifications.filter((n) => !n.read).length },
    { id: 'communication', label: 'Internal Communication', count: deptMessages.length },
    { id: 'activity_history', label: 'Activity History' },
    { id: 'account_security', label: 'My Profile & Settings' },
    { id: 'help', label: 'Help & Support' },
  ];

  return (
    <div className="space-y-5">
      {/* Department Workplace Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-[#102B50] text-white flex items-center justify-center shrink-0">
              <DeptIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="typo-card-heading text-[#172B46]">
                  {deptConfig?.workplaceTitle || deptConfig?.label}
                </h2>
                <StatusText status="active" label="Restricted Workplace" />
              </div>
              <p className="typo-meta text-[#75869D] mt-0.5">{deptConfig?.workplaceDescription}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 typo-meta border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100">
            <div>
              <p className="text-[#75869D]">Staff Profile</p>
              <p className="font-semibold text-[#172B46]">
                {adminProfile?.displayName} · {adminProfile?.role}
              </p>
            </div>
            <div>
              <p className="text-[#75869D]">Granted Permissions</p>
              <p className="font-medium text-[#1265C8]">
                {(adminProfile?.actions || []).join(', ')}
              </p>
            </div>
          </div>
        </div>

        {/* Workplace Tab Bar */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 typo-nav rounded-md whitespace-nowrap transition-colors shrink-0 ${
                activeTab === tab.id
                  ? 'bg-[#102B50] text-white font-semibold'
                  : 'text-[#172B46] bg-[#F3F6FA] hover:bg-[#E9F2FF]'
              }`}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && tab.count > 0 ? (
                <span className="tabular-nums typo-small opacity-85">({tab.count})</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Active Workplace Panel */}
      {activeTab === 'operations' && subId === 'my_profile' ? (
        <StaffProfileView
          mode="profile"
          department={department}
          activityLogs={activityLogs}
          loginHistory={loginHistory}
        />
      ) : activeTab === 'operations' && subId === 'settings' ? (
        <StaffProfileView
          mode="settings"
          department={department}
          activityLogs={activityLogs}
          loginHistory={loginHistory}
        />
      ) : activeTab === 'operations' ? (
        children
      ) : activeTab === 'email' && canViewEmail ? (
        <EmailCentreView
          subId={emailSubTab}
          onSelectSub={setEmailSubTab}
          adminProfile={adminProfile}
          settingsDocs={settingsDocs}
          emailLogs={emailLogs}
          emailTemplates={emailTemplates}
          emailDrafts={emailDrafts}
          emailCampaigns={emailCampaigns}
          scopedDepartment={department}
        />
      ) : activeTab === 'drive' ? (
        <GoogleDriveView
          scopedDepartmentLabel={deptConfig?.label}
          settingsDocs={settingsDocs}
        />
      ) : activeTab === 'invitations' && canManageDeptInvitations ? (
        <DepartmentInvitationsPanel
          mode="both"
          invitations={invitations}
          lockedDepartment={department}
        />
      ) : activeTab === 'pending_queue' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="typo-card-heading text-[#172B46]">
              Assigned Tasks & Pending Reviews — {deptConfig?.label}
            </h3>
            <p className="typo-meta text-[#75869D]">
              Live Firestore items requiring review or resolution inside this department.
            </p>
          </div>
          {pendingItems.length === 0 ? (
            <EmptyState
              title="No Pending Reviews in Queue"
              description="All operational items in this department queue are up to date."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {pendingItems.map((item) => (
                <div
                  key={item.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50"
                >
                  <div>
                    <p className="typo-body font-medium text-[#172B46]">{item.title}</p>
                    <p className="typo-meta text-[#75869D]">{item.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <StatusText status={item.status} />
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTab('operations');
                        onNavigateSub(item.subId);
                      }}
                      className="typo-meta font-semibold text-[#1265C8] hover:underline"
                    >
                      Review in Queue →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'notifications' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#1265C8]" />
            <h3 className="typo-card-heading text-[#172B46]">
              {deptConfig?.label} Notifications
            </h3>
          </div>
          {deptNotifications.length === 0 ? (
            <EmptyState
              title="No Department Notifications"
              description="Operational alerts routed to this department will appear here in real time."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {deptNotifications.map((n) => (
                <div
                  key={n.notificationId}
                  className={`p-4 flex items-start justify-between gap-4 ${
                    n.read ? 'bg-white' : 'bg-[#E9F2FF]/40'
                  }`}
                >
                  <div>
                    <p className="typo-body font-semibold text-[#172B46]">{n.title}</p>
                    <p className="typo-meta text-[#75869D] mt-0.5">{n.message}</p>
                    <p className="typo-small tabular-nums text-[#75869D] mt-1">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {!n.read ? (
                    <button
                      type="button"
                      onClick={() => void markNotificationRead(n.notificationId)}
                      className="typo-meta font-semibold text-[#1265C8] hover:underline shrink-0"
                    >
                      Mark Read
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'communication' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#1265C8]" />
            <div>
              <h3 className="typo-card-heading text-[#172B46]">
                Internal Department Communication — {deptConfig?.label}
              </h3>
              <p className="typo-meta text-[#75869D]">
                Messages are strictly isolated to authorized staff in {deptConfig?.label} and the
                Super Administrator.
              </p>
            </div>
          </div>

          {msgError ? (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 typo-meta text-[#D34552]">
              {msgError}
            </div>
          ) : null}

          <form onSubmit={handleSendDeptMessage} className="flex gap-2">
            <input
              type="text"
              required
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder={`Post an internal handover note or escalation for ${deptConfig?.label}...`}
              className="flex-1 px-3 py-2 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
            />
            <button
              type="submit"
              disabled={msgSending || !msgText.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-60 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </form>

          {deptMessages.length === 0 ? (
            <EmptyState
              title="No Department Messages Yet"
              description="Start an internal thread with fellow staff members assigned to this department."
            />
          ) : (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {deptMessages.map((msg) => (
                <div key={msg.messageId} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 typo-meta">
                    <span className="font-semibold text-[#172B46]">
                      {msg.senderName}{' '}
                      <span className="font-normal text-[#75869D]">({msg.senderRole})</span>
                    </span>
                    <span className="tabular-nums typo-small text-[#75869D]">
                      {new Date(msg.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="typo-body text-[#172B46]">{msg.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'activity_history' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
            <History className="w-4 h-4 text-[#1265C8]" />
            <h3 className="typo-card-heading text-[#172B46]">
              Department Activity History
            </h3>
          </div>
          {deptActivityHistory.length === 0 ? (
            <EmptyState
              title="No Activity History Yet"
              description="Actions executed within this department workplace are recorded immutably."
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
                  {deptActivityHistory.map((log) => (
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
      ) : activeTab === 'help' ? (
        <StaffProfileView
          mode="help"
          department={department}
          activityLogs={activityLogs}
          loginHistory={loginHistory}
        />
      ) : (
        <StaffProfileView
          mode="profile"
          department={department}
          activityLogs={activityLogs}
          loginHistory={loginHistory}
        />
      )}
    </div>
  );
}
