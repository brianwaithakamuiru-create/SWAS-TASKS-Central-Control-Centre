import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Lock, Search, ShieldAlert, X } from 'lucide-react';
import { EIGHT_DEPARTMENTS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import { exportRecordsToCsv, resolveSecurityEvent } from '../../services/firestoreService';
import type { ActivityLog, SecurityEvent } from '../../types/admin';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { TablePagination, usePaginatedList } from '../common/TablePagination';

interface ActivityLogsViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  activityLogs: ActivityLog[];
  securityEvents: SecurityEvent[];
}

export function ActivityLogsView({
  subId,
  onSelectSub,
  activityLogs,
  securityEvents,
}: ActivityLogsViewProps) {
  const { adminProfile, hasAction } = useAuth();
  const subdepartments =
    EIGHT_DEPARTMENTS.find((d) => d.id === 'activity_logs')?.subdepartments || [];

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exportCategory, setExportCategory] = useState('all');
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of activityLogs) {
      counts.set(l.category, (counts.get(l.category) || 0) + 1);
    }
    return counts;
  }, [activityLogs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...activityLogs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((l) => {
        if (subId === 'system_activity' && l.category !== 'system') return false;
        if (subId === 'admin_activity' && l.category !== 'admin') return false;
        if (subId === 'user_activity' && l.category !== 'user') return false;
        if (subId === 'worker_activity' && l.category !== 'worker') return false;
        if (subId === 'client_activity' && l.category !== 'client') return false;
        if (subId === 'login_history' && l.category !== 'login') return false;
        if (subId === 'api_activity' && l.category !== 'api') return false;
        if (subId === 'financial_activity' && l.category !== 'financial') return false;
        if (subId === 'account_changes' && l.category !== 'account_change') return false;
        if (subId === 'export_reports' && exportCategory !== 'all' && l.category !== exportCategory) {
          return false;
        }
        if (dateFrom && l.createdAt.slice(0, 10) < dateFrom) return false;
        if (dateTo && l.createdAt.slice(0, 10) > dateTo) return false;
        if (!q) return true;
        return (
          l.action.toLowerCase().includes(q) ||
          l.affectedRecord.toLowerCase().includes(q) ||
          (l.actorEmail || l.actorId).toLowerCase().includes(q) ||
          (l.correlationId || '').toLowerCase().includes(q)
        );
      });
  }, [activityLogs, subId, search, dateFrom, dateTo, exportCategory]);

  const logsPagination = usePaginatedList(filteredLogs, 20);
  const secPagination = usePaginatedList(securityEvents, 15);

  const handleExportAuditCsv = () => {
    exportRecordsToCsv(
      `swas-tasks-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'EventID',
        'Category',
        'ActorID',
        'ActorEmail',
        'ActorRole',
        'Action',
        'AffectedRecord',
        'Result',
        'CorrelationID',
        'CreatedAt',
      ],
      filteredLogs.map((l) => [
        l.eventId,
        l.category,
        l.actorId,
        l.actorEmail || '',
        l.actorRole,
        l.action,
        l.affectedRecord,
        l.result,
        l.correlationId || '',
        l.createdAt,
      ])
    );
  };

  const handleExportAuditJson = () => {
    const blob = new Blob([JSON.stringify(filteredLogs, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swas-tasks-audit-trail-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46]">
            Activity Logs & Immutable Audit Trail
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Append-only forensic records protected against editing or deletion by Firestore security rules.
          </p>
        </div>

        {hasAction('export') ? (
          <button
            type="button"
            onClick={handleExportAuditCsv}
            className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#102B50] hover:bg-[#172B46] rounded-md whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Export Audit CSV
          </button>
        ) : null}
      </div>

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Total Immutable Events</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#172B46]">
            {activityLogs.length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Financial & Admin Audits</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#1265C8]">
            {(categoryCounts.get('financial') || 0) + (categoryCounts.get('admin') || 0)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Open Security Alerts</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#D34552]">
            {securityEvents.filter((s) => !s.resolved).length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Account & Role Changes</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#172B46]">
            {categoryCounts.get('account_change') || 0}
          </p>
        </div>
      </div>

      {subId === 'dashboard' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="typo-card-heading text-[#172B46]">
              Audit Stream Breakdown
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'admin_activity', label: 'Admin Activity', count: categoryCounts.get('admin') || 0 },
                { id: 'financial_activity', label: 'Financial Activity', count: categoryCounts.get('financial') || 0 },
                { id: 'api_activity', label: 'API Activity', count: categoryCounts.get('api') || 0 },
                { id: 'account_changes', label: 'Account Changes', count: categoryCounts.get('account_change') || 0 },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectSub(item.id)}
                  className="p-3.5 rounded-md border border-slate-200 hover:border-[#1265C8] text-left flex items-center justify-between"
                >
                  <span className="typo-meta font-medium text-[#172B46]">{item.label}</span>
                  <span className="tabular-nums text-base font-semibold text-[#172B46]">
                    {item.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#D34552]" />
                <h2 className="typo-card-heading text-[#172B46]">
                  Latest Security Alerts
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onSelectSub('security_logs')}
                className="typo-meta font-medium text-[#1265C8] hover:underline"
              >
                Inspect All
              </button>
            </div>
            {securityEvents.length === 0 ? (
              <p className="typo-meta text-[#75869D]">No security alerts recorded.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {securityEvents.slice(0, 5).map((ev) => (
                  <div key={ev.eventId} className="py-2.5 flex items-center justify-between gap-2 typo-meta">
                    <div className="min-w-0">
                      <p className="font-medium text-[#172B46] truncate">{ev.eventType}</p>
                      <p className="text-[#75869D] truncate">{ev.detail}</p>
                    </div>
                    <StatusText status={ev.severity} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : subId === 'export_reports' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5 max-w-2xl">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-[#1265C8]" />
            <div>
              <h2 className="typo-card-heading text-[#172B46]">
                Compliance Audit Export Builder
              </h2>
              <p className="typo-meta text-[#75869D]">
                Filter immutable audit logs by category and date range, then download as CSV or JSON.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Category</label>
              <select
                value={exportCategory}
                onChange={(e) => setExportCategory(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Categories</option>
                <option value="system">System</option>
                <option value="admin">Admin</option>
                <option value="user">User</option>
                <option value="worker">Worker</option>
                <option value="client">Client</option>
                <option value="login">Login</option>
                <option value="security">Security</option>
                <option value="api">API</option>
                <option value="financial">Financial</option>
                <option value="account_change">Account Changes</option>
              </select>
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 typo-meta text-[#172B46] tabular-nums">
            Matching immutable records ready for export: <span className="font-semibold">{filteredLogs.length}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!hasAction('export') || filteredLogs.length === 0}
              onClick={handleExportAuditCsv}
              className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              Download CSV Report
            </button>
            <button
              type="button"
              disabled={!hasAction('export') || filteredLogs.length === 0}
              onClick={handleExportAuditJson}
              className="inline-flex items-center gap-2 px-4 py-2 typo-button text-[#172B46] bg-white border border-slate-200 hover:bg-slate-50 rounded-md disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              Download JSON Bundle
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1">
              <Search className="w-4 h-4 text-[#75869D]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter audit trail by actor, action, correlation ID, or target record..."
                className="flex-1 typo-input text-[#172B46] focus:outline-none"
              />
            </div>
            <span className="hidden sm:inline-flex items-center gap-1.5 typo-meta text-[#15966B] font-medium">
              <Lock className="w-3.5 h-3.5" />
              Write-Once Immutable
            </span>
          </div>

          {subId === 'security_logs' ? (
            securityEvents.length === 0 ? (
              <EmptyState
                title="No Security Logs Recorded"
                description="Authentication anomalies, revoked API keys, and access control alerts appear here."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Event</th>
                      <th className="px-4 py-3 font-medium">Actor</th>
                      <th className="px-4 py-3 font-medium">Severity</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {secPagination.pagedItems.map((ev) => (
                      <tr key={ev.eventId}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{ev.eventType}</p>
                          <p className="text-xs text-[#75869D]">{ev.detail}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#75869D]">{ev.actorEmail || 'System'}</td>
                        <td className="px-4 py-3">
                          <StatusText status={ev.severity} />
                        </td>
                        <td className="px-4 py-3">
                          {ev.resolved ? (
                            <StatusText status="resolved" />
                          ) : adminProfile ? (
                            <button
                              type="button"
                              onClick={() => void resolveSecurityEvent(adminProfile, ev.eventId)}
                              className="text-xs font-medium text-[#1265C8] hover:underline"
                            >
                              Mark Resolved
                            </button>
                          ) : (
                            <StatusText status="pending" label="Open" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums typo-meta text-[#75869D]">
                          {new Date(ev.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination
                  page={secPagination.page}
                  pageSize={secPagination.pageSize}
                  totalItems={secPagination.totalItems}
                  totalPages={secPagination.totalPages}
                  onPageChange={secPagination.setPage}
                  onPageSizeChange={secPagination.setPageSize}
                />
              </div>
            )
          ) : filteredLogs.length === 0 ? (
            <EmptyState
              title="No Audit Records in This Category"
              description="Every administrative, financial, API, and user state change automatically records an immutable entry here."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Action</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium">Actor</th>
                      <th className="px-4 py-3 font-medium">Affected Record</th>
                      <th className="px-4 py-3 font-medium">Result</th>
                      <th className="px-4 py-3 font-medium text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logsPagination.pagedItems.map((l) => (
                      <tr
                        key={l.eventId}
                        onClick={() => setSelectedLog(l)}
                        className="hover:bg-slate-50 cursor-pointer"
                      >
                        <td className="px-4 py-3 font-medium text-[#172B46]">
                          {l.action}
                          {l.correlationId ? (
                            <div className="font-mono typo-small text-[#75869D]">
                              {l.correlationId}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 capitalize text-[#75869D]">
                          {l.category.replace(/_/g, ' ')}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[#172B46]">{l.actorEmail || l.actorId}</p>
                          <p className="typo-small font-mono text-[#75869D]">{l.actorRole}</p>
                        </td>
                        <td className="px-4 py-3 font-mono typo-meta text-[#75869D]">
                          {l.affectedRecord}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={l.result} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums typo-meta text-[#75869D] whitespace-nowrap">
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
        </>
      )}

      {selectedLog ? (
        <div className="fixed inset-0 z-40 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-md h-full overflow-y-auto p-6 border-l border-slate-200 space-y-4">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="typo-section-heading text-[#172B46]">
                  {selectedLog.action}
                </h3>
                <p className="typo-meta font-mono text-[#75869D]">{selectedLog.eventId}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="p-1 text-[#75869D] hover:text-[#172B46]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <dl className="space-y-2 typo-meta">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <dt className="text-[#75869D]">Actor</dt>
                <dd className="font-medium text-[#172B46]">
                  {selectedLog.actorEmail || selectedLog.actorId}
                </dd>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <dt className="text-[#75869D]">Affected Record</dt>
                <dd className="font-mono text-[#172B46]">{selectedLog.affectedRecord}</dd>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <dt className="text-[#75869D]">Correlation ID</dt>
                <dd className="font-mono text-[#75869D]">{selectedLog.correlationId || '—'}</dd>
              </div>
            </dl>
            <div>
              <p className="typo-label text-[#75869D] mb-1">Recorded Metadata</p>
              <pre className="p-3 rounded-md bg-[#F3F6FA] border border-slate-200 typo-tech overflow-x-auto text-[#172B46]">
                {JSON.stringify(selectedLog.metadata || {}, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
