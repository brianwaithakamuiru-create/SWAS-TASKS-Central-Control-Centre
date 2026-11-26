import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Download,
  FileBarChart2,
  Mail,
  Search,
  Ticket,
  X,
} from 'lucide-react';
import { EIGHT_DEPARTMENTS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  exportRecordsToCsv,
  updateClientRecord,
  updateSupportTicketStatus,
} from '../../services/firestoreService';
import type {
  ActivityLog,
  ClientAccount,
  EmailTemplateRecord,
  SupportTicket,
  TaskRecord,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { TablePagination, usePaginatedList } from '../common/TablePagination';
import { DepartmentEmailModal, type DepartmentEmailTarget } from './DepartmentEmailModal';

interface ClientManagementViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  clients: ClientAccount[];
  tasks: TaskRecord[];
  tickets: SupportTicket[];
  activityLogs: ActivityLog[];
  emailTemplates?: EmailTemplateRecord[];
}

export function ClientManagementView({
  subId,
  onSelectSub,
  clients,
  tasks,
  tickets,
  activityLogs,
  emailTemplates = [],
}: ClientManagementViewProps) {
  const { adminProfile, hasAction, hasEmailPermission } = useAuth();
  const canEmail = hasEmailPermission('email.compose');
  const subdepartments =
    EIGHT_DEPARTMENTS.find((d) => d.id === 'client_management')?.subdepartments || [];

  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientAccount | null>(null);
  const [emailTarget, setEmailTarget] = useState<DepartmentEmailTarget | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    danger: boolean;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (subId === 'business_accounts' && c.accountTier === 'individual') return false;
      if (subId === 'client_verification' && c.verificationStatus === 'verified') return false;
      if (subId === 'client_approvals' && c.status !== 'pending') return false;
      if (subId === 'client_complaints' && Number(c.openComplaints || 0) <= 0) return false;
      if (subId === 'client_restrictions' && c.status !== 'restricted' && c.status !== 'suspended') {
        return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.companyName || '').toLowerCase().includes(q)
      );
    });
  }, [clients, subId, search]);

  const clientTickets = useMemo(
    () => tickets.filter((t) => t.requesterType === 'client'),
    [tickets]
  );

  const clientLogs = useMemo(
    () =>
      [...activityLogs]
        .filter((l) => l.category === 'client')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [activityLogs]
  );

  const selectedClientTasks = useMemo(() => {
    if (!selectedClient) return [];
    return tasks.filter((t) => t.clientId === selectedClient.clientId);
  }, [selectedClient, tasks]);

  const clientPagination = usePaginatedList(filteredClients, 15);
  const ticketPagination = usePaginatedList(clientTickets, 15);
  const projectPagination = usePaginatedList(tasks, 15);
  const logPagination = usePaginatedList(clientLogs, 15);

  const reportSummary = useMemo(() => {
    const byTier = {
      individual: clients.filter((c) => c.accountTier === 'individual').length,
      business: clients.filter((c) => c.accountTier === 'business').length,
      enterprise: clients.filter((c) => c.accountTier === 'enterprise').length,
    };
    const verified = clients.filter((c) => c.verificationStatus === 'verified').length;
    const totalComplaints = clients.reduce((acc, c) => acc + Number(c.openComplaints || 0), 0);
    return { byTier, verified, totalComplaints };
  }, [clients]);

  const handleClientUpdate = (
    client: ClientAccount,
    updates: Parameters<typeof updateClientRecord>[2],
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
        setFeedback(null);
        try {
          await updateClientRecord(adminProfile, client.clientId, updates, actionLabel);
          setFeedback({ type: 'ok', text: `Updated client ${client.name} (${actionLabel}).` });
          setConfirmState(null);
          if (selectedClient?.clientId === client.clientId) {
            setSelectedClient({ ...client, ...updates });
          }
        } catch (err) {
          setFeedback({
            type: 'err',
            text: err instanceof Error ? err.message : 'Client update failed',
          });
          setConfirmState(null);
        }
      },
    });
  };

  const handleExportClientsCsv = () => {
    exportRecordsToCsv(
      `swas-clients-${subId}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Client ID', 'Name', 'Company', 'Email', 'Tier', 'Verification', 'Status', 'Open Complaints', 'Created At'],
      filteredClients.map((c) => [
        c.clientId,
        c.name,
        c.companyName || '',
        c.email,
        c.accountTier,
        c.verificationStatus,
        c.status,
        c.openComplaints || 0,
        c.createdAt,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46]">
            Client Management
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Dedicated client accounts, business verification, client-posted tasks, complaints, and support cases.
          </p>
        </div>
        {hasAction('export') ? (
          <button
            type="button"
            onClick={handleExportClientsCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 typo-button text-[#172B46] bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap self-start sm:self-auto"
          >
            <Download className="w-3.5 h-3.5" />
            Export Client CSV
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

      {feedback ? (
        <div
          className={`p-3 rounded-md typo-meta border ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-[#15966B]'
              : 'bg-red-50 border-red-200 text-[#D34552]'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Total Clients</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#172B46]">
            {clients.length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Business & Enterprise</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#172B46]">
            {reportSummary.byTier.business + reportSummary.byTier.enterprise}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Open Client Support</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#E6A23C]">
            {clientTickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Restricted / Suspended</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#D34552]">
            {clients.filter((c) => c.status === 'restricted' || c.status === 'suspended').length}
          </p>
        </div>
      </div>

      {subId === 'dashboard' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="typo-card-heading text-[#172B46]">
              Client Approval & Support Queues
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  id: 'client_approvals',
                  label: 'Pending Client Approvals',
                  count: clients.filter((c) => c.status === 'pending').length,
                  icon: CheckCircle2,
                },
                {
                  id: 'client_verification',
                  label: 'Unverified Clients',
                  count: clients.filter((c) => c.verificationStatus !== 'verified').length,
                  icon: Building2,
                },
                {
                  id: 'client_complaints',
                  label: 'Open Complaints',
                  count: reportSummary.totalComplaints,
                  icon: AlertCircle,
                },
                {
                  id: 'client_support',
                  label: 'Support Tickets',
                  count: clientTickets.length,
                  icon: Ticket,
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
                        <p className="typo-meta text-[#75869D]">Open queue</p>
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
                Recent Client Activity
              </h2>
              <button
                type="button"
                onClick={() => onSelectSub('client_activity')}
                className="typo-meta font-medium text-[#1265C8] hover:underline"
              >
                View All
              </button>
            </div>
            {clientLogs.length === 0 ? (
              <p className="typo-meta text-[#75869D]">No client administrative logs recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {clientLogs.slice(0, 6).map((l) => (
                  <div key={l.eventId} className="py-2.5 typo-meta">
                    <p className="font-medium text-[#172B46]">{l.action}</p>
                    <p className="font-mono text-[#75869D] truncate">{l.affectedRecord}</p>
                    <p className="typo-small tabular-nums text-[#75869D] mt-0.5">
                      {new Date(l.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : subId === 'client_reports' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FileBarChart2 className="w-5 h-5 text-[#1265C8]" />
              <div>
                <h2 className="typo-card-heading text-[#172B46]">
                  Client Portfolio & Compliance Summary
                </h2>
                <p className="typo-meta text-[#75869D]">
                  Live metrics derived from Cloud Firestore <span className="font-mono">clients</span> and{' '}
                  <span className="font-mono">tasks</span>.
                </p>
              </div>
            </div>
            {hasAction('export') ? (
              <button
                type="button"
                onClick={handleExportClientsCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-button text-white bg-[#1265C8] rounded-md"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 typo-body">
            <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA]">
              <p className="typo-meta text-[#75869D]">Individual Accounts</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#172B46]">
                {reportSummary.byTier.individual}
              </p>
            </div>
            <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA]">
              <p className="typo-meta text-[#75869D]">Business Accounts</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#172B46]">
                {reportSummary.byTier.business}
              </p>
            </div>
            <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA]">
              <p className="typo-meta text-[#75869D]">Enterprise Accounts</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#172B46]">
                {reportSummary.byTier.enterprise}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 typo-body">
            <div className="p-4 rounded-md border border-slate-200">
              <p className="typo-meta text-[#75869D]">Verified Clients</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#15966B]">
                {reportSummary.verified} / {clients.length}
              </p>
            </div>
            <div className="p-4 rounded-md border border-slate-200">
              <p className="typo-meta text-[#75869D]">Client-Posted Tasks</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#172B46]">
                {tasks.length}
              </p>
            </div>
            <div className="p-4 rounded-md border border-slate-200">
              <p className="typo-meta text-[#75869D]">Recorded Open Complaints</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#D34552]">
                {reportSummary.totalComplaints}
              </p>
            </div>
          </div>
        </div>
      ) : subId === 'client_support' ? (
        clientTickets.length === 0 ? (
          <EmptyState
            title="No Client Support Cases"
            description="Client support tickets created on the public platform will populate here."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full typo-table">
              <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ticketPagination.pagedItems.map((t) => (
                  <tr key={t.ticketId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-[#172B46]">{t.subject}</td>
                    <td className="px-4 py-3 text-[#75869D]">{t.requesterName || t.requesterUid}</td>
                    <td className="px-4 py-3 capitalize">{t.priority}</td>
                    <td className="px-4 py-3">
                      <StatusText status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {adminProfile && t.status !== 'resolved' ? (
                        <button
                          type="button"
                          onClick={() =>
                            void updateSupportTicketStatus(adminProfile, t.ticketId, 'resolved')
                          }
                          className="text-xs font-medium text-[#15966B] hover:underline"
                        >
                          Resolve
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              page={ticketPagination.page}
              pageSize={ticketPagination.pageSize}
              totalItems={ticketPagination.totalItems}
              totalPages={ticketPagination.totalPages}
              onPageChange={ticketPagination.setPage}
              onPageSizeChange={ticketPagination.setPageSize}
            />
          </div>
        )
      ) : subId === 'client_activity' ? (
        clientLogs.length === 0 ? (
          <EmptyState
            title="No Client Activity Logged"
            description="Client actions and administrative reviews appear here."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full typo-table">
              <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Record</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                  <th className="px-4 py-3 font-medium text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logPagination.pagedItems.map((l) => (
                  <tr key={l.eventId}>
                    <td className="px-4 py-3 font-medium text-[#172B46]">{l.action}</td>
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
            <TablePagination
              page={logPagination.page}
              pageSize={logPagination.pageSize}
              totalItems={logPagination.totalItems}
              totalPages={logPagination.totalPages}
              onPageChange={logPagination.setPage}
              onPageSizeChange={logPagination.setPageSize}
            />
          </div>
        )
      ) : subId === 'client_projects' ? (
        tasks.length === 0 ? (
          <EmptyState
            title="No Client Projects Found"
            description="Tasks posted by registered clients will appear here."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full typo-table">
              <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Project / Task</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Budget (KES)</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projectPagination.pagedItems.map((t) => (
                  <tr key={t.taskId}>
                    <td className="px-4 py-3 font-medium text-[#172B46]">{t.title}</td>
                    <td className="px-4 py-3 text-[#75869D]">{t.clientName || t.clientId}</td>
                    <td className="px-4 py-3 tabular-nums">
                      KES {Number(t.budgetKes).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              page={projectPagination.page}
              pageSize={projectPagination.pageSize}
              totalItems={projectPagination.totalItems}
              totalPages={projectPagination.totalPages}
              onPageChange={projectPagination.setPage}
              onPageSizeChange={projectPagination.setPageSize}
            />
          </div>
        )
      ) : subId === 'client_profiles' ? (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
            <Search className="w-4 h-4 text-[#75869D]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search client profiles by name, company, or email..."
              className="flex-1 typo-input text-[#172B46] focus:outline-none"
            />
          </div>
          {filteredClients.length === 0 ? (
            <EmptyState
              title="No Client Profiles Found"
              description="Registered client profiles appear here with company details and posted tasks."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clientPagination.pagedItems.map((c) => (
                <button
                  key={c.clientId}
                  type="button"
                  onClick={() => setSelectedClient(c)}
                  className="bg-white border border-slate-200 hover:border-[#1265C8] rounded-lg p-5 text-left transition-colors space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold typo-body text-[#172B46]">{c.name}</p>
                      <p className="typo-meta text-[#75869D]">{c.companyName || 'Individual Client'}</p>
                    </div>
                    <StatusText status={c.status} />
                  </div>
                  <p className="typo-meta text-[#75869D] truncate">{c.email}</p>
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between typo-meta">
                    <span className="capitalize text-[#75869D]">{c.accountTier}</span>
                    <StatusText status={c.verificationStatus} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
            <Search className="w-4 h-4 text-[#75869D]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search client accounts by name, company, or email..."
              className="flex-1 typo-input text-[#172B46] focus:outline-none"
            />
          </div>

          {filteredClients.length === 0 ? (
            <EmptyState
              title="No Client Records Found"
              description="No client profiles in Firestore match this view. Client registrations from the SWAS TASKS public website sync here automatically."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Client</th>
                      <th className="px-4 py-3 font-medium">Tier</th>
                      <th className="px-4 py-3 font-medium">Verification</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clientPagination.pagedItems.map((c) => (
                      <tr key={c.clientId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedClient(c)}
                            className="text-left group"
                          >
                            <p className="font-medium text-[#172B46] group-hover:text-[#1265C8]">
                              {c.name}
                            </p>
                            <p className="typo-meta text-[#75869D]">
                              {c.companyName ? `${c.companyName} · ` : ''}
                              {c.email}
                            </p>
                          </button>
                        </td>
                        <td className="px-4 py-3 capitalize">{c.accountTier}</td>
                        <td className="px-4 py-3">
                          <StatusText status={c.verificationStatus} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={c.status} />
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {hasAction('approve') && c.verificationStatus !== 'verified' ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleClientUpdate(
                                  c,
                                  { verificationStatus: 'verified', status: 'active' },
                                  'VERIFY_CLIENT',
                                  'Verify Client Account',
                                  `Approve and verify ${c.name}?`
                                )
                              }
                              className="text-xs font-medium text-[#15966B] hover:underline"
                            >
                              Verify
                            </button>
                          ) : null}
                          {hasAction('suspend') && c.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleClientUpdate(
                                  c,
                                  { status: 'suspended' },
                                  'SUSPEND_CLIENT',
                                  'Suspend Client Account',
                                  `Suspend client ${c.name}?`,
                                  true
                                )
                              }
                              className="text-xs font-medium text-[#D34552] hover:underline"
                            >
                              Suspend
                            </button>
                          ) : null}
                          {hasAction('update') && (c.status === 'suspended' || c.status === 'restricted') ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleClientUpdate(
                                  c,
                                  { status: 'active' },
                                  'REACTIVATE_CLIENT',
                                  'Reactivate Client',
                                  `Restore active status for ${c.name}?`
                                )
                              }
                              className="text-xs font-medium text-[#1265C8] hover:underline"
                            >
                              Reactivate
                            </button>
                          ) : null}
                          {canEmail && c.email ? (
                            <button
                              type="button"
                              onClick={() =>
                                setEmailTarget({
                                  name: c.name,
                                  email: c.email,
                                  uid: c.ownerUid || c.clientId,
                                  recipientType: 'client',
                                  sourceRecord: `clients/${c.clientId}`,
                                  vars: {
                                    client_name: c.name,
                                    first_name: c.name.split(' ')[0] || c.name,
                                    email: c.email,
                                    account_id: c.clientId,
                                    account_status: c.status,
                                    company_name: c.companyName || 'SWAS TASKS',
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
                page={clientPagination.page}
                pageSize={clientPagination.pageSize}
                totalItems={clientPagination.totalItems}
                totalPages={clientPagination.totalPages}
                onPageChange={clientPagination.setPage}
                onPageSizeChange={clientPagination.setPageSize}
              />
            </div>
          )}
        </div>
      )}

      {selectedClient ? (
        <div className="fixed inset-0 z-40 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-lg h-full overflow-y-auto p-6 border-l border-slate-200">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <h3 className="typo-section-heading text-[#172B46]">
                  {selectedClient.name}
                </h3>
                <p className="typo-meta font-mono text-[#75869D]">{selectedClient.clientId}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedClient(null)}
                className="p-1 text-[#75869D] hover:text-[#172B46]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <dl className="mt-4 space-y-2.5 typo-body">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <dt className="text-[#75869D]">Email</dt>
                <dd>{selectedClient.email}</dd>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <dt className="text-[#75869D]">Company</dt>
                <dd>{selectedClient.companyName || 'Individual'}</dd>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <dt className="text-[#75869D]">Tier</dt>
                <dd className="capitalize">{selectedClient.accountTier}</dd>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <dt className="text-[#75869D]">Verification</dt>
                <dd>
                  <StatusText status={selectedClient.verificationStatus} />
                </dd>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <dt className="text-[#75869D]">Status</dt>
                <dd>
                  <StatusText status={selectedClient.status} />
                </dd>
              </div>
            </dl>
            {canEmail && selectedClient.email ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() =>
                    setEmailTarget({
                      name: selectedClient.name,
                      email: selectedClient.email,
                      uid: selectedClient.ownerUid || selectedClient.clientId,
                      recipientType: 'client',
                      sourceRecord: `clients/${selectedClient.clientId}`,
                      vars: {
                        client_name: selectedClient.name,
                        first_name: selectedClient.name.split(' ')[0] || selectedClient.name,
                        email: selectedClient.email,
                        account_id: selectedClient.clientId,
                        account_status: selectedClient.status,
                        company_name: selectedClient.companyName || 'SWAS TASKS',
                      },
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
                >
                  <Mail className="w-4 h-4" />
                  Email Client
                </button>
              </div>
            ) : null}
            <div className="mt-6">
              <h4 className="typo-card-heading text-[#75869D] mb-2">
                Tasks Posted by Client ({selectedClientTasks.length})
              </h4>
              {selectedClientTasks.length === 0 ? (
                <p className="typo-meta text-[#75869D]">No tasks posted by this client.</p>
              ) : (
                <div className="space-y-2">
                  {selectedClientTasks.map((t) => (
                    <div key={t.taskId} className="p-3 rounded border border-slate-200 typo-meta">
                      <p className="font-medium text-[#172B46]">{t.title}</p>
                      <p className="mt-1 text-[#75869D] tabular-nums">
                        KES {Number(t.budgetKes).toLocaleString()} · {t.status}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
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

      <DepartmentEmailModal
        open={Boolean(emailTarget)}
        onClose={() => setEmailTarget(null)}
        department="client_management"
        initialRecipient={emailTarget}
        templates={emailTemplates}
      />
    </div>
  );
}
