import React, { useCallback, useEffect, useState } from 'react';
import { InviteRegisterView } from './components/auth/InviteRegisterView';
import { LoginView } from './components/auth/LoginView';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ActivityLogsView } from './components/departments/ActivityLogsView';
import { ApiManagementView } from './components/departments/ApiManagementView';
import { BidsAssignmentsView } from './components/departments/BidsAssignmentsView';
import { ClientManagementView } from './components/departments/ClientManagementView';
import {
  DepartmentWorkplacePanels,
  type WorkplaceTab,
} from './components/departments/DepartmentWorkplacePanels';
import { FinanceControlView } from './components/departments/FinanceControlView';
import { MainDashboard } from './components/departments/MainDashboard';
import { PlatformSettingsView } from './components/departments/PlatformSettingsView';
import { StaffManagementView } from './components/departments/StaffManagementView';
import { SupportAnnouncementsView } from './components/departments/SupportAnnouncementsView';
import { SystemHealthView } from './components/departments/SystemHealthView';
import { TaskMonitoringView } from './components/departments/TaskMonitoringView';
import { UserManagementView } from './components/departments/UserManagementView';
import { AdminShell } from './components/layout/AdminShell';
import { GlobalSearchModal } from './components/layout/GlobalSearchModal';
import { EIGHT_DEPARTMENTS, STAFF_MANAGEMENT_SUBDEPARTMENTS } from './config/navigation';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  subscribeCollection,
  subscribeDepartmentMessages,
  subscribeOwnLoginHistory,
} from './services/firestoreService';
import type {
  ActivityLog,
  AdminNotification,
  AdminUser,
  Announcement,
  ApiKeyRecord,
  ApiLogRecord,
  AssignmentRecord,
  BidRecord,
  ClientAccount,
  ConnectedApp,
  DepartmentId,
  DepartmentMessage,
  DisputeRecord,
  EightDepartmentId,
  EmailLogRecord,
  PlatformSetting,
  SecurityEvent,
  StaffInvitation,
  StaffLoginHistory,
  SupportTicket,
  TaskCategory,
  TaskRecord,
  TransactionRecord,
  UserAccount,
  WalletRecord,
  WebhookConfig,
  WithdrawalRequest,
  WorkSubmission,
} from './types/admin';

const LAST_ROUTE_STORAGE_KEY = 'swas_admin_last_route';

function extractInviteTokenFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  const qToken = params.get('invite');
  if (qToken && qToken.trim()) return qToken.trim();
  const hash = window.location.hash;
  if (hash.startsWith('#/invite/')) {
    const raw = hash.slice('#/invite/'.length).trim();
    return raw ? decodeURIComponent(raw) : null;
  }
  return null;
}

function parseHashRoute(): { dept: DepartmentId; subId: string } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [deptPart, subPart] = raw.split('/');
  const validDepts: DepartmentId[] = [
    'overview',
    'staff_management',
    'user_management',
    'client_management',
    'task_monitoring',
    'bids_assignments',
    'finance_control',
    'api_management',
    'activity_logs',
    'platform_settings',
    'system_health',
    'support_announcements',
  ];
  if (deptPart && validDepts.includes(deptPart as DepartmentId)) {
    const dept = deptPart as DepartmentId;
    if (dept === 'staff_management') {
      const subId =
        subPart && STAFF_MANAGEMENT_SUBDEPARTMENTS.some((s) => s.id === subPart)
          ? subPart
          : STAFF_MANAGEMENT_SUBDEPARTMENTS[0].id;
      return { dept, subId };
    }
    const deptCfg = EIGHT_DEPARTMENTS.find((d) => d.id === dept);
    const subId =
      subPart && deptCfg?.subdepartments.some((s) => s.id === subPart)
        ? subPart
        : deptCfg?.subdepartments[0]?.id || '';
    return { dept, subId };
  }
  return { dept: 'overview', subId: '' };
}

function ControlCentreWorkspace() {
  const {
    firebaseUser,
    adminProfile,
    isSuperAdmin,
    canManageStaff,
    primaryDepartment,
    loading,
    hasDepartment,
  } = useAuth();

  const [inviteToken, setInviteToken] = useState<string | null>(() =>
    extractInviteTokenFromLocation()
  );

  const [route, setRoute] = useState<{ dept: DepartmentId; subId: string }>(() => {
    if (window.location.hash) {
      return parseHashRoute();
    }
    try {
      const saved = localStorage.getItem(LAST_ROUTE_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved) as { dept: DepartmentId; subId: string };
      }
    } catch {
      // ignore storage errors
    }
    return { dept: 'overview', subId: '' };
  });

  const [workplaceTab, setWorkplaceTab] = useState<WorkplaceTab>('operations');
  const [searchOpen, setSearchOpen] = useState(false);

  // Real-time Firestore State
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<StaffInvitation[]>([]);
  const [loginHistory, setLoginHistory] = useState<StaffLoginHistory[]>([]);
  const [departmentMessages, setDepartmentMessages] = useState<DepartmentMessage[]>([]);
  const [clients, setClients] = useState<ClientAccount[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [bids, setBids] = useState<BidRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [workSubmissions, setWorkSubmissions] = useState<WorkSubmission[]>([]);
  const [disputes, setDisputes] = useState<DisputeRecord[]>([]);
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [apiLogs, setApiLogs] = useState<ApiLogRecord[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [settingsDocs, setSettingsDocs] = useState<PlatformSetting[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLogRecord[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [apiStatus, setApiStatus] = useState<{
    status: string;
    latencyMs: number;
    firestoreReachable: boolean;
  } | null>(null);

  // Watch URL for invitation token removal/changes
  useEffect(() => {
    const syncInvite = () => setInviteToken(extractInviteTokenFromLocation());
    window.addEventListener('popstate', syncInvite);
    window.addEventListener('hashchange', syncInvite);
    return () => {
      window.removeEventListener('popstate', syncInvite);
      window.removeEventListener('hashchange', syncInvite);
    };
  }, []);

  const exitInviteToLogin = useCallback(() => {
    window.history.replaceState({}, '', window.location.pathname);
    setInviteToken(null);
  }, []);

  const resolveAllowedDept = useCallback(
    (requested: DepartmentId): DepartmentId => {
      if (requested === 'staff_management') {
        return canManageStaff ? 'staff_management' : primaryDepartment || 'overview';
      }
      if (hasDepartment(requested)) return requested;
      if (!isSuperAdmin && primaryDepartment) return primaryDepartment;
      return 'overview';
    },
    [canManageStaff, hasDepartment, isSuperAdmin, primaryDepartment]
  );

  const navigate = useCallback(
    (dept: DepartmentId, subId?: string) => {
      if (dept === 'staff_management') {
        if (!canManageStaff) return;
        const resolvedSub = subId || STAFF_MANAGEMENT_SUBDEPARTMENTS[0].id;
        const next = { dept: 'staff_management' as DepartmentId, subId: resolvedSub };
        setRoute(next);
        setWorkplaceTab('operations');
        const hash = `#/staff_management/${resolvedSub}`;
        if (window.location.hash !== hash) {
          window.history.pushState(next, '', hash);
        }
        return;
      }

      if (!hasDepartment(dept)) {
        return;
      }
      const deptCfg = EIGHT_DEPARTMENTS.find((d) => d.id === dept);
      const resolvedSub = subId || deptCfg?.subdepartments[0]?.id || '';
      const next = { dept, subId: resolvedSub };
      setRoute(next);
      setWorkplaceTab('operations');
      const hash = resolvedSub ? `#/${dept}/${resolvedSub}` : `#/${dept}`;
      if (window.location.hash !== hash) {
        window.history.pushState(next, '', hash);
      }
      try {
        localStorage.setItem(LAST_ROUTE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
    },
    [canManageStaff, hasDepartment]
  );

  // Immediately lock department staff to their assigned workplace after sign-in or URL hash edit
  useEffect(() => {
    if (!adminProfile) return;
    if (!isSuperAdmin && primaryDepartment) {
      if (route.dept !== primaryDepartment) {
        const defaultSub =
          EIGHT_DEPARTMENTS.find((d) => d.id === primaryDepartment)?.subdepartments[0]?.id || '';
        const locked = { dept: primaryDepartment as DepartmentId, subId: defaultSub };
        setRoute(locked);
        setWorkplaceTab('operations');
        window.history.replaceState(locked, '', `#/${primaryDepartment}/${defaultSub}`);
      }
    }
  }, [adminProfile, isSuperAdmin, primaryDepartment, route.dept]);

  // Sync browser back/forward navigation with strict department guard
  useEffect(() => {
    const onPopOrHash = () => {
      const parsed = parseHashRoute();
      const targetDept = resolveAllowedDept(parsed.dept);
      if (targetDept === parsed.dept) {
        setRoute(parsed);
      } else {
        const fallbackCfg = EIGHT_DEPARTMENTS.find((d) => d.id === targetDept);
        const fallbackSub = fallbackCfg?.subdepartments[0]?.id || '';
        setRoute({ dept: targetDept, subId: fallbackSub });
        window.history.replaceState(
          null,
          '',
          fallbackSub ? `#/${targetDept}/${fallbackSub}` : `#/${targetDept}`
        );
      }
    };
    window.addEventListener('hashchange', onPopOrHash);
    window.addEventListener('popstate', onPopOrHash);
    return () => {
      window.removeEventListener('hashchange', onPopOrHash);
      window.removeEventListener('popstate', onPopOrHash);
    };
  }, [resolveAllowedDept]);

  // Global Search keyboard shortcut (Cmd/Ctrl + K)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/platform/status');
      const data = (await res.json()) as {
        status: string;
        latencyMs: number;
        firebase: { firestoreReachable: boolean };
      };
      setApiStatus({
        status: data.status,
        latencyMs: data.latencyMs,
        firestoreReachable: data.firebase.firestoreReachable,
      });
    } catch {
      setApiStatus({ status: 'degraded', latencyMs: 0, firestoreReachable: false });
    }
  }, []);

  // Attach Firestore real-time listeners strictly after authentication + RBAC verification
  useEffect(() => {
    if (!firebaseUser || !adminProfile) return;

    void refreshStatus();
    const unsubs: (() => void)[] = [];
    const safeSub = <T,>(
      cond: boolean,
      col: string,
      setter: React.Dispatch<React.SetStateAction<T[]>>
    ) => {
      if (!cond) return;
      unsubs.push(
        subscribeCollection<T>(col, setter, (err) => {
          console.warn(`Listener warning on ${col}:`, err.message);
        })
      );
    };

    const isSuper = isSuperAdmin;
    safeSub(
      isSuper ||
        hasDepartment('user_management') ||
        hasDepartment('bids_assignments') ||
        hasDepartment('finance_control'),
      'users',
      setUsers
    );
    safeSub(isSuper || canManageStaff, 'admin_users', setAdminUsers);
    safeSub(isSuper || canManageStaff, 'staff_invitations', setInvitations);
    if (isSuper || canManageStaff) {
      safeSub(true, 'staff_login_history', setLoginHistory);
    } else {
      unsubs.push(
        subscribeOwnLoginHistory<StaffLoginHistory>(
          firebaseUser.uid,
          setLoginHistory,
          (err) => console.warn('Listener warning on staff_login_history:', err.message)
        )
      );
    }
    safeSub(
      isSuper ||
        hasDepartment('client_management') ||
        hasDepartment('task_monitoring') ||
        hasDepartment('bids_assignments') ||
        hasDepartment('finance_control'),
      'clients',
      setClients
    );
    safeSub(
      isSuper ||
        hasDepartment('task_monitoring') ||
        hasDepartment('bids_assignments') ||
        hasDepartment('client_management'),
      'tasks',
      setTasks
    );
    safeSub(true, 'task_categories', setCategories);
    safeSub(isSuper || hasDepartment('bids_assignments') || hasDepartment('task_monitoring'), 'bids', setBids);
    safeSub(isSuper || hasDepartment('bids_assignments') || hasDepartment('finance_control'), 'assignments', setAssignments);
    safeSub(isSuper || hasDepartment('bids_assignments') || hasDepartment('finance_control'), 'work_submissions', setWorkSubmissions);
    safeSub(isSuper || hasDepartment('bids_assignments') || hasDepartment('finance_control'), 'disputes', setDisputes);
    safeSub(isSuper || hasDepartment('finance_control'), 'wallets', setWallets);
    safeSub(isSuper || hasDepartment('finance_control'), 'transactions', setTransactions);
    safeSub(isSuper || hasDepartment('finance_control'), 'withdrawals', setWithdrawals);
    safeSub(isSuper || hasDepartment('api_management'), 'api_keys', setApiKeys);
    safeSub(isSuper || hasDepartment('api_management'), 'connected_apps', setConnectedApps);
    safeSub(isSuper || hasDepartment('api_management'), 'webhooks', setWebhooks);
    safeSub(isSuper || hasDepartment('api_management') || hasDepartment('activity_logs'), 'api_logs', setApiLogs);
    safeSub(true, 'activity_logs', setActivityLogs);
    safeSub(true, 'security_events', setSecurityEvents);
    safeSub(isSuper || hasDepartment('platform_settings'), 'platform_settings', setSettingsDocs);
    safeSub(
      isSuper || hasDepartment('platform_settings') || hasDepartment('activity_logs'),
      'email_logs',
      setEmailLogs
    );
    safeSub(true, 'announcements', setAnnouncements);
    safeSub(isSuper || hasDepartment('client_management') || hasDepartment('user_management'), 'support_tickets', setTickets);
    safeSub(true, 'notifications', setNotifications);

    if (isSuper || primaryDepartment) {
      unsubs.push(
        subscribeDepartmentMessages<DepartmentMessage>(
          primaryDepartment,
          isSuper,
          setDepartmentMessages,
          (err) => {
            console.warn('Listener warning on department_messages:', err.message);
          }
        )
      );
    }

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [firebaseUser, adminProfile, isSuperAdmin, canManageStaff, primaryDepartment, hasDepartment, refreshStatus]);

  // Invitation Registration Flow (?invite=<token> or #/invite/<token>)
  if (inviteToken && !adminProfile) {
    return <InviteRegisterView token={inviteToken} onExitToLogin={exitInviteToLogin} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F3F6FA] flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-[#1265C8] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[#75869D]">Verifying administrator authorization...</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !adminProfile) {
    return <LoginView />;
  }

  const activeDept = resolveAllowedDept(route.dept);

  const renderEightDepartmentWorkplace = (dept: EightDepartmentId, inner: React.ReactNode) => (
    <DepartmentWorkplacePanels
      department={dept}
      subId={route.subId || 'dashboard'}
      activeTab={workplaceTab}
      onSelectTab={setWorkplaceTab}
      onNavigateSub={(subId) => navigate(dept, subId)}
      users={users}
      clients={clients}
      tasks={tasks}
      assignments={assignments}
      transactions={transactions}
      withdrawals={withdrawals}
      connectedApps={connectedApps}
      securityEvents={securityEvents}
      tickets={tickets}
      activityLogs={activityLogs}
      loginHistory={loginHistory}
      notifications={notifications}
      departmentMessages={departmentMessages}
    >
      {inner}
    </DepartmentWorkplacePanels>
  );

  return (
    <AdminShell
      activeDept={activeDept}
      activeSubId={route.subId}
      workplaceTab={workplaceTab}
      onSelectWorkplaceTab={setWorkplaceTab}
      onNavigate={navigate}
      onOpenSearch={() => setSearchOpen(true)}
      notifications={notifications}
    >
      {activeDept === 'overview' && isSuperAdmin ? (
        <MainDashboard
          users={users}
          clients={clients}
          tasks={tasks}
          bids={bids}
          assignments={assignments}
          transactions={transactions}
          withdrawals={withdrawals}
          activityLogs={activityLogs}
          securityEvents={securityEvents}
          apiStatus={apiStatus}
          onRefresh={refreshStatus}
          onNavigate={navigate}
        />
      ) : null}

      {activeDept === 'staff_management' && canManageStaff ? (
        <StaffManagementView
          subId={route.subId || 'all_staff'}
          onSelectSub={(s) => navigate('staff_management', s)}
          adminUsers={adminUsers}
          invitations={invitations}
          loginHistory={loginHistory}
          activityLogs={activityLogs}
        />
      ) : null}

      {activeDept === 'user_management'
        ? renderEightDepartmentWorkplace(
            'user_management',
            <UserManagementView
              subId={route.subId || 'dashboard'}
              onSelectSub={(s) => navigate('user_management', s)}
              users={users}
              adminUsers={adminUsers}
              activityLogs={activityLogs}
              securityEvents={securityEvents}
            />
          )
        : null}

      {activeDept === 'client_management'
        ? renderEightDepartmentWorkplace(
            'client_management',
            <ClientManagementView
              subId={route.subId || 'dashboard'}
              onSelectSub={(s) => navigate('client_management', s)}
              clients={clients}
              tasks={tasks}
              tickets={tickets}
              activityLogs={activityLogs}
            />
          )
        : null}

      {activeDept === 'task_monitoring'
        ? renderEightDepartmentWorkplace(
            'task_monitoring',
            <TaskMonitoringView
              subId={route.subId || 'dashboard'}
              onSelectSub={(s) => navigate('task_monitoring', s)}
              tasks={tasks}
              categories={categories}
              activityLogs={activityLogs}
            />
          )
        : null}

      {activeDept === 'bids_assignments'
        ? renderEightDepartmentWorkplace(
            'bids_assignments',
            <BidsAssignmentsView
              subId={route.subId || 'dashboard'}
              onSelectSub={(s) => navigate('bids_assignments', s)}
              bids={bids}
              assignments={assignments}
              workSubmissions={workSubmissions}
              disputes={disputes}
            />
          )
        : null}

      {activeDept === 'finance_control'
        ? renderEightDepartmentWorkplace(
            'finance_control',
            <FinanceControlView
              subId={route.subId || 'dashboard'}
              onSelectSub={(s) => navigate('finance_control', s)}
              wallets={wallets}
              transactions={transactions}
              withdrawals={withdrawals}
              activityLogs={activityLogs}
            />
          )
        : null}

      {activeDept === 'api_management'
        ? renderEightDepartmentWorkplace(
            'api_management',
            <ApiManagementView
              subId={route.subId || 'dashboard'}
              onSelectSub={(s) => navigate('api_management', s)}
              apiKeys={apiKeys}
              connectedApps={connectedApps}
              webhooks={webhooks}
              apiLogs={apiLogs}
            />
          )
        : null}

      {activeDept === 'activity_logs'
        ? renderEightDepartmentWorkplace(
            'activity_logs',
            <ActivityLogsView
              subId={route.subId || 'dashboard'}
              onSelectSub={(s) => navigate('activity_logs', s)}
              activityLogs={activityLogs}
              securityEvents={securityEvents}
            />
          )
        : null}

      {activeDept === 'platform_settings'
        ? renderEightDepartmentWorkplace(
            'platform_settings',
            <PlatformSettingsView
              subId={route.subId || 'dashboard'}
              onSelectSub={(s) => navigate('platform_settings', s)}
              settingsDocs={settingsDocs}
              activityLogs={activityLogs}
              emailLogs={emailLogs}
            />
          )
        : null}

      {activeDept === 'system_health' && isSuperAdmin ? <SystemHealthView /> : null}

      {activeDept === 'support_announcements' && isSuperAdmin ? (
        <SupportAnnouncementsView announcements={announcements} tickets={tickets} />
      ) : null}

      <GlobalSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={navigate}
        users={users}
        clients={clients}
        tasks={tasks}
        assignments={assignments}
      />
    </AdminShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ControlCentreWorkspace />
      </AuthProvider>
    </ErrorBoundary>
  );
}
