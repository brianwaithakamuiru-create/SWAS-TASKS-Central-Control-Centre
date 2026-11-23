import React, { useMemo, useState } from 'react';
import { Printer, RefreshCw, Search } from 'lucide-react';
import { EIGHT_DEPARTMENTS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import type {
  ActivityLog,
  AssignmentRecord,
  BidRecord,
  ClientAccount,
  DepartmentId,
  SecurityEvent,
  TaskRecord,
  TransactionRecord,
  UserAccount,
  WithdrawalRequest,
} from '../../types/admin';
import { StatusText } from '../common/StatusText';

interface MainDashboardProps {
  users: UserAccount[];
  clients: ClientAccount[];
  tasks: TaskRecord[];
  bids: BidRecord[];
  assignments: AssignmentRecord[];
  transactions: TransactionRecord[];
  withdrawals: WithdrawalRequest[];
  activityLogs: ActivityLog[];
  securityEvents: SecurityEvent[];
  apiStatus: { status: string; latencyMs: number; firestoreReachable: boolean } | null;
  onRefresh: () => Promise<void>;
  onNavigate: (dept: DepartmentId, subId?: string) => void;
}

type DateRangeKey = 'all' | '24h' | '7d' | '30d';

function isWithinRange(iso: string | undefined, range: DateRangeKey): boolean {
  if (range === 'all' || !iso) return true;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return true;
  const now = Date.now();
  const days = range === '24h' ? 1 : range === '7d' ? 7 : 30;
  return now - ts <= days * 24 * 60 * 60 * 1000;
}

export function MainDashboard({
  users,
  clients,
  tasks,
  bids,
  assignments,
  transactions,
  withdrawals,
  activityLogs,
  securityEvents,
  apiStatus,
  onRefresh,
  onNavigate,
}: MainDashboardProps) {
  const { adminProfile, hasDepartment } = useAuth();
  const [range, setRange] = useState<DateRangeKey>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const stats = useMemo(() => {
    const fUsers = users.filter((u) => isWithinRange(u.createdAt, range));
    const fClients = clients.filter((c) => isWithinRange(c.createdAt, range));
    const fTasks = tasks.filter((t) => isWithinRange(t.createdAt, range));
    const fBids = bids.filter((b) => isWithinRange(b.createdAt, range));
    const fAssignments = assignments.filter((a) => isWithinRange(a.createdAt, range));
    const fTransactions = transactions.filter((t) => isWithinRange(t.createdAt, range));
    const fWithdrawals = withdrawals.filter((w) => isWithinRange(w.createdAt, range));

    const verifiedPaymentsKes = fTransactions
      .filter((t) => t.status === 'verified')
      .reduce((sum, t) => sum + Number(t.amountKes || 0), 0);

    return {
      totalUsers: fUsers.length,
      totalWorkers: fUsers.filter((u) => u.accountType === 'worker' || u.accountType === 'hybrid')
        .length,
      totalClients: fClients.length,
      activeAccounts:
        fUsers.filter((u) => u.status === 'active').length +
        fClients.filter((c) => c.status === 'active').length,
      suspendedAccounts:
        fUsers.filter((u) => u.status === 'suspended').length +
        fClients.filter((c) => c.status === 'suspended').length,
      publishedTasks: fTasks.filter((t) => t.status === 'published').length,
      pendingTasks: fTasks.filter((t) => t.status === 'pending').length,
      activeAssignments: fAssignments.filter(
        (a) => a.status === 'active' || a.status === 'submitted'
      ).length,
      completedAssignments: fAssignments.filter(
        (a) => a.status === 'completed' || a.status === 'approved'
      ).length,
      pendingBids: fBids.filter((b) => b.status === 'pending').length,
      verifiedPaymentsKes,
      pendingWithdrawals: fWithdrawals.filter((w) => w.status === 'pending').length,
    };
  }, [users, clients, tasks, bids, assignments, transactions, withdrawals, range]);

  const filteredActivity = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...activityLogs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter(
        (log) =>
          isWithinRange(log.createdAt, range) &&
          (!q ||
            log.action.toLowerCase().includes(q) ||
            (log.actorEmail || '').toLowerCase().includes(q) ||
            log.affectedRecord.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [activityLogs, range, searchQuery]);

  const filteredSecurity = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...securityEvents]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter(
        (ev) =>
          isWithinRange(ev.createdAt, range) &&
          (!q ||
            ev.eventType.toLowerCase().includes(q) ||
            ev.detail.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [securityEvents, range, searchQuery]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const kpiCards = [
    { label: 'Total Registered Users', value: stats.totalUsers.toLocaleString(), dept: 'user_management' as DepartmentId },
    { label: 'Total Workers', value: stats.totalWorkers.toLocaleString(), dept: 'user_management' as DepartmentId },
    { label: 'Total Clients', value: stats.totalClients.toLocaleString(), dept: 'client_management' as DepartmentId },
    { label: 'Active Accounts', value: stats.activeAccounts.toLocaleString(), dept: 'user_management' as DepartmentId },
    { label: 'Suspended Accounts', value: stats.suspendedAccounts.toLocaleString(), dept: 'user_management' as DepartmentId },
    { label: 'Published Tasks', value: stats.publishedTasks.toLocaleString(), dept: 'task_monitoring' as DepartmentId },
    { label: 'Pending Tasks', value: stats.pendingTasks.toLocaleString(), dept: 'task_monitoring' as DepartmentId },
    { label: 'Active Assignments', value: stats.activeAssignments.toLocaleString(), dept: 'bids_assignments' as DepartmentId },
    { label: 'Completed Assignments', value: stats.completedAssignments.toLocaleString(), dept: 'bids_assignments' as DepartmentId },
    { label: 'Pending Bids', value: stats.pendingBids.toLocaleString(), dept: 'bids_assignments' as DepartmentId },
    {
      label: 'Verified Payments',
      value: `KES ${stats.verifiedPaymentsKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      dept: 'finance_control' as DepartmentId,
    },
    { label: 'Pending Withdrawals', value: stats.pendingWithdrawals.toLocaleString(), dept: 'finance_control' as DepartmentId },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="typo-dashboard-heading text-[#172B46]">
            Central Control Overview
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Live Firestore operational metrics for {adminProfile?.displayName} · All figures reflect
            verified database records.
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center bg-white border border-slate-200 rounded-md p-1">
            {(
              [
                { key: 'all', label: 'All Time' },
                { key: '24h', label: '24h' },
                { key: '7d', label: '7d' },
                { key: '30d', label: '30d' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRange(opt.key)}
                className={`px-2.5 py-1 typo-meta font-medium rounded transition-colors whitespace-nowrap ${
                  range === opt.key
                    ? 'bg-[#1265C8] text-white'
                    : 'text-[#75869D] hover:text-[#172B46]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleRefresh()}
            className="inline-flex items-center gap-1.5 px-3 py-2 typo-button text-[#172B46] bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => onNavigate('staff_management', 'invite_staff')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md transition-colors whitespace-nowrap"
          >
            Invite Staff
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 typo-button text-white bg-[#102B50] hover:bg-[#172B46] rounded-md transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Report
          </button>
        </div>
      </div>

      {/* Live Metrics Grid */}
      <section aria-label="Platform Statistics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiCards.map((card) => (
            <button
              key={card.label}
              type="button"
              disabled={!hasDepartment(card.dept)}
              onClick={() => onNavigate(card.dept)}
              className="bg-white border border-slate-200 rounded-lg p-4 text-left hover:border-[#1265C8] transition-colors disabled:opacity-60 disabled:cursor-default"
            >
              <p className="typo-meta font-medium text-[#75869D]">{card.label}</p>
              <p className="mt-2 font-sans tabular-nums text-[20px] font-semibold text-[#172B46] leading-snug">
                {card.value}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* API Connection Status & Department Shortcuts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <h2 className="typo-card-heading text-[#172B46]">
              System & API Health
            </h2>
            <StatusText status={apiStatus?.status || 'degraded'} />
          </div>
          <dl className="mt-4 space-y-2.5 typo-table">
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <dt className="text-[#75869D]">REST API Server</dt>
              <dd className="font-mono text-[#172B46]">
                {apiStatus ? `${apiStatus.latencyMs} ms` : 'Checking...'}
              </dd>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <dt className="text-[#75869D]">Firestore Connection</dt>
              <dd>
                <StatusText
                  status={apiStatus?.firestoreReachable ? 'connected' : 'error'}
                  label={apiStatus?.firestoreReachable ? 'Connected' : 'Unreachable'}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-[#75869D]">Auth Enforcement</dt>
              <dd className="font-medium text-[#15966B]">Verified RBAC</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => onNavigate('system_health')}
            className="mt-4 typo-meta font-medium text-[#1265C8] hover:underline"
          >
            Inspect full technical diagnostics →
          </button>
        </div>

        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="typo-card-heading text-[#172B46]">
            Department Workspaces
          </h2>
          <p className="mt-1 typo-meta text-[#75869D]">
            Direct access to authorized Central Control Centre departments.
          </p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {EIGHT_DEPARTMENTS.filter((d) => hasDepartment(d.id)).map((dept) => (
              <button
                key={dept.id}
                type="button"
                onClick={() => onNavigate(dept.id, dept.subdepartments[0]?.id)}
                className="flex items-center justify-between px-3.5 py-2.5 rounded-md border border-slate-200 hover:border-[#1265C8] hover:bg-[#E9F2FF]/40 text-left transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-[#172B46]">{dept.label}</p>
                  <p className="text-xs text-[#75869D]">
                    {dept.subdepartments.length} subdepartments
                  </p>
                </div>
                <span className="text-xs font-medium text-[#1265C8]">Open</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Search Bar for Activity & Security Tables */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#75869D] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter recent administrative actions or security events..."
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-[#1265C8]"
          />
        </div>
        <span className="text-xs text-[#75869D]">
          Showing live records from <span className="font-mono">activity_logs</span> &{' '}
          <span className="font-mono">security_events</span>
        </span>
      </div>

      {/* Recent Activity & Security Events Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="typo-card-heading text-[#172B46]">
              Recent Administrative Activity
            </h2>
            {hasDepartment('activity_logs') ? (
              <button
                type="button"
                onClick={() => onNavigate('activity_logs', 'admin_activity')}
                className="typo-meta font-medium text-[#1265C8] hover:underline"
              >
                View all
              </button>
            ) : null}
          </div>
          {filteredActivity.length === 0 ? (
            <p className="p-6 typo-body text-[#75869D] text-center">
              No administrative activity recorded in this window yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Action</th>
                    <th className="px-4 py-2.5 font-medium">Actor</th>
                    <th className="px-4 py-2.5 font-medium">Result</th>
                    <th className="px-4 py-2.5 font-medium text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredActivity.map((log) => (
                    <tr key={log.eventId} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-[#172B46]">
                        {log.action}
                        <div className="typo-small font-mono text-[#75869D]">
                          {log.affectedRecord}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[#75869D]">{log.actorEmail || log.actorId}</td>
                      <td className="px-4 py-2.5">
                        <StatusText status={log.result} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums typo-meta text-[#75869D] whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="typo-card-heading text-[#172B46]">
              Recent Security Events
            </h2>
            {hasDepartment('activity_logs') ? (
              <button
                type="button"
                onClick={() => onNavigate('activity_logs', 'security_logs')}
                className="typo-meta font-medium text-[#1265C8] hover:underline"
              >
                View all
              </button>
            ) : null}
          </div>
          {filteredSecurity.length === 0 ? (
            <p className="p-6 typo-body text-[#75869D] text-center">
              No security alerts recorded in Firestore.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Event</th>
                    <th className="px-4 py-2.5 font-medium">Severity</th>
                    <th className="px-4 py-2.5 font-medium text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSecurity.map((ev) => (
                    <tr key={ev.eventId} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-[#172B46]">
                        <p className="font-medium">{ev.eventType}</p>
                        <p className="typo-meta text-[#75869D]">{ev.detail}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusText status={ev.severity} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums typo-meta text-[#75869D] whitespace-nowrap">
                        {new Date(ev.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
