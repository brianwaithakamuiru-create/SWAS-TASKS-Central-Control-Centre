import React, { useMemo, useState } from 'react';
import {
  Briefcase,
  CheckCircle2,
  Download,
  ExternalLink,
  FileBarChart2,
  FileCheck2,
  Gavel,
  Search,
} from 'lucide-react';
import { EIGHT_DEPARTMENTS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  exportRecordsToCsv,
  resolveDisputeRecord,
  reviewBidDecision,
  reviewWorkSubmission,
  updateAssignmentStatus,
} from '../../services/firestoreService';
import type {
  AssignmentRecord,
  BidRecord,
  DisputeRecord,
  WorkSubmission,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { TablePagination, usePaginatedList } from '../common/TablePagination';

interface BidsAssignmentsViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  bids: BidRecord[];
  assignments: AssignmentRecord[];
  workSubmissions: WorkSubmission[];
  disputes: DisputeRecord[];
}

export function BidsAssignmentsView({
  subId,
  onSelectSub,
  bids,
  assignments,
  workSubmissions,
  disputes,
}: BidsAssignmentsViewProps) {
  const { adminProfile, hasAction } = useAuth();
  const subdepartments =
    EIGHT_DEPARTMENTS.find((d) => d.id === 'bids_assignments')?.subdepartments || [];

  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    danger: boolean;
    requireReason: boolean;
    onConfirm: (reason: string) => Promise<void>;
  } | null>(null);

  const isBidView = [
    'all_bids',
    'pending_bids',
    'accepted_bids',
    'rejected_bids',
    'withdrawn_bids',
  ].includes(subId);

  const filteredBids = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bids.filter((b) => {
      if (subId === 'pending_bids' && b.status !== 'pending') return false;
      if (subId === 'accepted_bids' && b.status !== 'accepted') return false;
      if (subId === 'rejected_bids' && b.status !== 'rejected') return false;
      if (subId === 'withdrawn_bids' && b.status !== 'withdrawn') return false;
      if (!q) return true;
      return (
        (b.taskTitle || b.taskId).toLowerCase().includes(q) ||
        (b.workerName || b.workerUid).toLowerCase().includes(q)
      );
    });
  }, [bids, subId, search]);

  const filteredAssignments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignments.filter((a) => {
      if (subId === 'active_assignments' && a.status !== 'active') return false;
      if (subId === 'work_submissions' && a.status !== 'submitted') return false;
      if (subId === 'revision_requests' && a.status !== 'revision_requested') return false;
      if (subId === 'assignment_approvals' && a.status !== 'approved' && a.status !== 'completed') {
        return false;
      }
      if (subId === 'dispute_management' && a.status !== 'disputed') return false;
      if (!q) return true;
      return (
        (a.taskTitle || a.taskId).toLowerCase().includes(q) ||
        (a.workerName || a.workerUid).toLowerCase().includes(q)
      );
    });
  }, [assignments, subId, search]);

  const filteredSubmissions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workSubmissions.filter((s) => {
      if (!q) return true;
      return (
        (s.taskTitle || s.taskId).toLowerCase().includes(q) ||
        (s.workerName || s.workerUid).toLowerCase().includes(q)
      );
    });
  }, [workSubmissions, search]);

  const filteredDisputes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return disputes.filter((d) => {
      if (!q) return true;
      return (
        (d.taskTitle || d.taskId).toLowerCase().includes(q) ||
        d.reason.toLowerCase().includes(q) ||
        d.openedByUid.toLowerCase().includes(q)
      );
    });
  }, [disputes, search]);

  const workerPerformanceRows = useMemo(() => {
    const map = new Map<
      string,
      { workerName: string; total: number; completed: number; disputed: number; totalKes: number }
    >();
    for (const a of assignments) {
      const existing = map.get(a.workerUid) || {
        workerName: a.workerName || a.workerUid,
        total: 0,
        completed: 0,
        disputed: 0,
        totalKes: 0,
      };
      existing.total += 1;
      if (a.status === 'completed' || a.status === 'approved') {
        existing.completed += 1;
        existing.totalKes += Number(a.agreedAmountKes || 0);
      }
      if (a.status === 'disputed') existing.disputed += 1;
      map.set(a.workerUid, existing);
    }
    return Array.from(map.entries()).map(([uid, row]) => ({ uid, ...row }));
  }, [assignments]);

  const bidsPagination = usePaginatedList(filteredBids, 15);
  const assignmentsPagination = usePaginatedList(filteredAssignments, 15);
  const submissionsPagination = usePaginatedList(filteredSubmissions, 15);
  const disputesPagination = usePaginatedList(filteredDisputes, 15);
  const perfPagination = usePaginatedList(workerPerformanceRows, 15);

  const handleAssignmentAction = (
    assignment: AssignmentRecord,
    nextStatus: AssignmentRecord['status'],
    label: string,
    danger = false
  ) => {
    if (!adminProfile) return;
    setConfirmState({
      open: true,
      title: `${label} · ${assignment.taskTitle || assignment.assignmentId}`,
      description:
        'Agreed task price remains locked. This status change and your mandatory justification note will be permanently logged.',
      danger,
      requireReason: true,
      onConfirm: async (reason) => {
        setFeedback(null);
        try {
          await updateAssignmentStatus(adminProfile, assignment.assignmentId, nextStatus, reason);
          setFeedback({ type: 'ok', text: `Assignment ${assignment.assignmentId} updated to ${nextStatus}.` });
        } catch (err) {
          setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Update failed' });
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const handleBidReview = (bid: BidRecord, decision: 'accepted' | 'rejected') => {
    setConfirmState({
      open: true,
      title: `${decision === 'accepted' ? 'Accept' : 'Reject'} Bid · KES ${Number(bid.amountKes).toLocaleString()}`,
      description: `Confirm ${decision} decision for bid ${bid.bidId} on "${bid.taskTitle || bid.taskId}".`,
      danger: decision === 'rejected',
      requireReason: false,
      onConfirm: async () => {
        setFeedback(null);
        try {
          await reviewBidDecision(bid.bidId, decision);
          setFeedback({ type: 'ok', text: `Bid ${bid.bidId} marked ${decision}.` });
        } catch (err) {
          setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Bid review failed' });
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const handleSubmissionReview = (
    sub: WorkSubmission,
    nextStatus: WorkSubmission['status'],
    label: string,
    danger = false
  ) => {
    if (!adminProfile) return;
    setConfirmState({
      open: true,
      title: `${label} · ${sub.taskTitle || sub.submissionId}`,
      description: 'Update work submission status and notify the assignment lifecycle.',
      danger,
      requireReason: true,
      onConfirm: async (reason) => {
        setFeedback(null);
        try {
          await reviewWorkSubmission(adminProfile, sub.submissionId, nextStatus, reason);
          setFeedback({ type: 'ok', text: `Submission ${sub.submissionId} updated to ${nextStatus}.` });
        } catch (err) {
          setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Submission review failed' });
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const handleDisputeDecision = (
    dispute: DisputeRecord,
    nextStatus: 'under_review' | 'resolved_client' | 'resolved_worker' | 'dismissed',
    label: string
  ) => {
    setConfirmState({
      open: true,
      title: `${label} · ${dispute.taskTitle || dispute.disputeId}`,
      description: 'Record official administrative dispute resolution in Cloud Firestore.',
      danger: nextStatus === 'dismissed',
      requireReason: true,
      onConfirm: async (reason) => {
        setFeedback(null);
        try {
          await resolveDisputeRecord(dispute.disputeId, nextStatus, reason);
          setFeedback({ type: 'ok', text: `Dispute ${dispute.disputeId} updated to ${nextStatus}.` });
        } catch (err) {
          setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Dispute update failed' });
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const handleExportReport = () => {
    exportRecordsToCsv(
      `swas-bids-assignments-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Assignment ID', 'Task Title', 'Worker', 'Agreed KES', 'Status', 'Created At'],
      assignments.map((a) => [
        a.assignmentId,
        a.taskTitle || a.taskId,
        a.workerName || a.workerUid,
        a.agreedAmountKes,
        a.status,
        a.createdAt,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46]">
            Bids & Assignments
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Workforce operations for bids, active assignments, work submissions, revisions, disputes, and worker performance.
          </p>
        </div>
        {hasAction('export') ? (
          <button
            type="button"
            onClick={handleExportReport}
            className="inline-flex items-center gap-1.5 px-3 py-2 typo-button text-[#172B46] bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap self-start sm:self-auto"
          >
            <Download className="w-3.5 h-3.5" />
            Export Assignments CSV
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
          <p className="typo-meta text-[#75869D]">Total Bids</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#172B46]">
            {bids.length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Active Assignments</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#1265C8]">
            {assignments.filter((a) => a.status === 'active').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Work Submissions</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#E6A23C]">
            {workSubmissions.length || assignments.filter((a) => a.status === 'submitted').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Open Disputes</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#D34552]">
            {
              disputes.filter((d) => d.status === 'open' || d.status === 'under_review').length ||
              assignments.filter((a) => a.status === 'disputed').length
            }
          </p>
        </div>
      </div>

      {subId === 'dashboard' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="typo-card-heading text-[#172B46]">
              Workforce Operational Queues
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  id: 'pending_bids',
                  label: 'Pending Bids',
                  count: bids.filter((b) => b.status === 'pending').length,
                  icon: Briefcase,
                },
                {
                  id: 'work_submissions',
                  label: 'Submissions Review',
                  count: workSubmissions.filter((s) => s.status === 'submitted').length,
                  icon: FileCheck2,
                },
                {
                  id: 'dispute_management',
                  label: 'Dispute Resolution',
                  count: disputes.filter((d) => d.status === 'open' || d.status === 'under_review').length,
                  icon: Gavel,
                },
                {
                  id: 'assignment_approvals',
                  label: 'Completed Approvals',
                  count: assignments.filter((a) => a.status === 'approved' || a.status === 'completed').length,
                  icon: CheckCircle2,
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
                Active Disputes Summary
              </h2>
              <button
                type="button"
                onClick={() => onSelectSub('dispute_management')}
                className="typo-meta font-medium text-[#1265C8] hover:underline"
              >
                Manage Disputes
              </button>
            </div>
            {disputes.length === 0 ? (
              <p className="typo-meta text-[#75869D]">No disputes recorded in Cloud Firestore.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {disputes.slice(0, 5).map((d) => (
                  <div key={d.disputeId} className="py-2.5 flex items-center justify-between gap-2 typo-meta">
                    <div className="min-w-0">
                      <p className="font-medium text-[#172B46] truncate">
                        {d.taskTitle || d.assignmentId}
                      </p>
                      <p className="text-[#75869D] truncate">{d.reason}</p>
                    </div>
                    <StatusText status={d.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : subId === 'reports' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FileBarChart2 className="w-5 h-5 text-[#1265C8]" />
              <div>
                <h2 className="typo-card-heading text-[#172B46]">
                  Workforce Completion & Dispute Report
                </h2>
                <p className="typo-meta text-[#75869D]">
                  Calculated from verified Firestore bids, assignments, submissions, and disputes.
                </p>
              </div>
            </div>
            {hasAction('export') ? (
              <button
                type="button"
                onClick={handleExportReport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-button text-white bg-[#1265C8] rounded-md"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 typo-body">
            <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA]">
              <p className="typo-meta text-[#75869D]">Bid Acceptance Rate</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#172B46]">
                {bids.length
                  ? `${Math.round((bids.filter((b) => b.status === 'accepted').length / bids.length) * 100)}%`
                  : '0%'}
              </p>
            </div>
            <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA]">
              <p className="typo-meta text-[#75869D]">Completed / Approved Assignments</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#15966B]">
                {assignments.filter((a) => a.status === 'completed' || a.status === 'approved').length} /{' '}
                {assignments.length}
              </p>
            </div>
            <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA]">
              <p className="typo-meta text-[#75869D]">Total Agreed Escrow Value</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#172B46]">
                KES{' '}
                {assignments
                  .reduce((acc, a) => acc + Number(a.agreedAmountKes || 0), 0)
                  .toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
            <Search className="w-4 h-4 text-[#75869D]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by task title, worker name, or ID..."
              className="flex-1 typo-input text-[#172B46] focus:outline-none"
            />
          </div>

          {subId === 'worker_performance' ? (
            workerPerformanceRows.length === 0 ? (
              <EmptyState
                title="No Worker Performance Data Yet"
                description="Performance summaries are calculated strictly from completed and disputed Firestore assignments."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Worker</th>
                      <th className="px-4 py-3 font-medium text-right">Assignments</th>
                      <th className="px-4 py-3 font-medium text-right">Completed</th>
                      <th className="px-4 py-3 font-medium text-right">Disputes</th>
                      <th className="px-4 py-3 font-medium text-right">Completed Value (KES)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {perfPagination.pagedItems.map((row) => (
                      <tr key={row.uid}>
                        <td className="px-4 py-3 font-medium text-[#172B46]">{row.workerName}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.total}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#15966B]">
                          {row.completed}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#D34552]">
                          {row.disputed}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          KES {row.totalKes.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination
                  page={perfPagination.page}
                  pageSize={perfPagination.pageSize}
                  totalItems={perfPagination.totalItems}
                  totalPages={perfPagination.totalPages}
                  onPageChange={perfPagination.setPage}
                  onPageSizeChange={perfPagination.setPageSize}
                />
              </div>
            )
          ) : subId === 'work_submissions' ? (
            filteredSubmissions.length === 0 && filteredAssignments.length === 0 ? (
              <EmptyState
                title="No Work Submissions Recorded"
                description="Deliverables submitted by workers via the public website appear here for review."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Task / Assignment</th>
                      <th className="px-4 py-3 font-medium">Worker</th>
                      <th className="px-4 py-3 font-medium">Deliverable</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {submissionsPagination.pagedItems.map((s) => (
                      <tr key={s.submissionId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{s.taskTitle || s.assignmentId}</p>
                          {s.summary ? <p className="text-xs text-[#75869D] line-clamp-1">{s.summary}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-[#75869D]">{s.workerName || s.workerUid}</td>
                        <td className="px-4 py-3 text-xs">
                          {s.deliverableUrl ? (
                            <a
                              href={s.deliverableUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#1265C8] hover:underline font-mono"
                            >
                              Deliverable
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-[#75869D]">No file link</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={s.status} />
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {hasAction('approve') && s.status !== 'approved' ? (
                            <button
                              type="button"
                              onClick={() => handleSubmissionReview(s, 'approved', 'Approve Submission')}
                              className="text-xs font-medium text-[#15966B] hover:underline"
                            >
                              Approve
                            </button>
                          ) : null}
                          {hasAction('edit') && s.status === 'submitted' ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleSubmissionReview(s, 'revision_requested', 'Request Revision')
                              }
                              className="text-xs font-medium text-[#E6A23C] hover:underline"
                            >
                              Request Revision
                            </button>
                          ) : null}
                          {hasAction('reject') && s.status !== 'rejected' ? (
                            <button
                              type="button"
                              onClick={() => handleSubmissionReview(s, 'rejected', 'Reject Submission', true)}
                              className="text-xs font-medium text-[#D34552] hover:underline"
                            >
                              Reject
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {filteredSubmissions.length === 0 &&
                      assignmentsPagination.pagedItems.map((a) => (
                        <tr key={a.assignmentId} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-[#172B46]">
                            {a.taskTitle || a.assignmentId}
                          </td>
                          <td className="px-4 py-3 text-[#75869D]">{a.workerName || a.workerUid}</td>
                          <td className="px-4 py-3 text-xs text-[#75869D]">
                            {a.submissionUrl || 'Submitted assignment'}
                          </td>
                          <td className="px-4 py-3">
                            <StatusText status={a.status} />
                          </td>
                          <td className="px-4 py-3 text-right space-x-2">
                            {hasAction('approve') ? (
                              <button
                                type="button"
                                onClick={() => handleAssignmentAction(a, 'approved', 'Approve Outcome')}
                                className="text-xs font-medium text-[#15966B] hover:underline"
                              >
                                Approve
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <TablePagination
                  page={submissionsPagination.page}
                  pageSize={submissionsPagination.pageSize}
                  totalItems={submissionsPagination.totalItems}
                  totalPages={submissionsPagination.totalPages}
                  onPageChange={submissionsPagination.setPage}
                  onPageSizeChange={submissionsPagination.setPageSize}
                />
              </div>
            )
          ) : subId === 'dispute_management' ? (
            filteredDisputes.length === 0 && filteredAssignments.length === 0 ? (
              <EmptyState
                title="No Disputes in Queue"
                description="Disputes escalated by clients or workers appear here for evidence review and binding resolution."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Dispute / Task</th>
                      <th className="px-4 py-3 font-medium">Opened By</th>
                      <th className="px-4 py-3 font-medium">Reason</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Resolution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {disputesPagination.pagedItems.map((d) => (
                      <tr key={d.disputeId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{d.taskTitle || d.assignmentId}</p>
                          <p className="typo-small font-mono text-[#75869D]">{d.disputeId}</p>
                        </td>
                        <td className="px-4 py-3 capitalize typo-meta text-[#75869D]">
                          {d.openedByRole} ({d.openedByUid})
                        </td>
                        <td className="px-4 py-3 typo-meta text-[#172B46] max-w-xs truncate">
                          {d.reason}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={d.status} />
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {hasAction('edit') && d.status === 'open' ? (
                            <button
                              type="button"
                              onClick={() => handleDisputeDecision(d, 'under_review', 'Mark Under Review')}
                              className="text-xs font-medium text-[#1265C8] hover:underline"
                            >
                              Review
                            </button>
                          ) : null}
                          {hasAction('approve') && (d.status === 'open' || d.status === 'under_review') ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDisputeDecision(d, 'resolved_worker', 'Resolve for Worker')}
                                className="text-xs font-medium text-[#15966B] hover:underline"
                              >
                                Worker Wins
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDisputeDecision(d, 'resolved_client', 'Resolve for Client')}
                                className="text-xs font-medium text-[#E6A23C] hover:underline"
                              >
                                Client Wins
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDisputeDecision(d, 'dismissed', 'Dismiss Dispute')}
                                className="text-xs font-medium text-[#D34552] hover:underline"
                              >
                                Dismiss
                              </button>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination
                  page={disputesPagination.page}
                  pageSize={disputesPagination.pageSize}
                  totalItems={disputesPagination.totalItems}
                  totalPages={disputesPagination.totalPages}
                  onPageChange={disputesPagination.setPage}
                  onPageSizeChange={disputesPagination.setPageSize}
                />
              </div>
            )
          ) : isBidView ? (
            filteredBids.length === 0 ? (
              <EmptyState
                title="No Bids Found"
                description="Worker bids submitted on published SWAS TASKS will appear here in real time."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Task</th>
                      <th className="px-4 py-3 font-medium">Worker</th>
                      <th className="px-4 py-3 font-medium text-right">Bid Amount</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Submitted / Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bidsPagination.pagedItems.map((b) => (
                      <tr key={b.bidId} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-[#172B46]">
                          {b.taskTitle || b.taskId}
                        </td>
                        <td className="px-4 py-3 text-[#75869D]">{b.workerName || b.workerUid}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          KES {Number(b.amountKes).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={b.status} />
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {hasAction('approve') && b.status === 'pending' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleBidReview(b, 'accepted')}
                                className="text-xs font-medium text-[#15966B] hover:underline"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => handleBidReview(b, 'rejected')}
                                className="text-xs font-medium text-[#D34552] hover:underline"
                              >
                                Reject
                              </button>
                            </>
                          ) : (
                            <span className="tabular-nums typo-meta text-[#75869D]">
                              {new Date(b.createdAt).toLocaleDateString()}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination
                  page={bidsPagination.page}
                  pageSize={bidsPagination.pageSize}
                  totalItems={bidsPagination.totalItems}
                  totalPages={bidsPagination.totalPages}
                  onPageChange={bidsPagination.setPage}
                  onPageSizeChange={bidsPagination.setPageSize}
                />
              </div>
            )
          ) : filteredAssignments.length === 0 ? (
            <EmptyState
              title="No Assignments in This View"
              description="Awarded assignments, work submissions, and dispute resolutions stored in Firestore will appear here."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Assignment / Task</th>
                    <th className="px-4 py-3 font-medium">Worker</th>
                    <th className="px-4 py-3 font-medium text-right">Agreed Price</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Governance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignmentsPagination.pagedItems.map((a) => (
                    <tr key={a.assignmentId} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#172B46]">{a.taskTitle || a.assignmentId}</p>
                        {a.disputeReason ? (
                          <p className="typo-meta text-[#D34552] mt-0.5">{a.disputeReason}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-[#75869D]">{a.workerName || a.workerUid}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        KES {Number(a.agreedAmountKes).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={a.status} />
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        {hasAction('approve') && (a.status === 'submitted' || a.status === 'disputed') ? (
                          <button
                            type="button"
                            onClick={() => handleAssignmentAction(a, 'approved', 'Approve Outcome')}
                            className="text-xs font-medium text-[#15966B] hover:underline"
                          >
                            Approve
                          </button>
                        ) : null}
                        {hasAction('update') && a.status === 'submitted' ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleAssignmentAction(a, 'revision_requested', 'Request Revision')
                            }
                            className="text-xs font-medium text-[#E6A23C] hover:underline"
                          >
                            Request Revision
                          </button>
                        ) : null}
                        {hasAction('update') && a.status === 'disputed' ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleAssignmentAction(a, 'cancelled', 'Resolve & Cancel', true)
                            }
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
              <TablePagination
                page={assignmentsPagination.page}
                pageSize={assignmentsPagination.pageSize}
                totalItems={assignmentsPagination.totalItems}
                totalPages={assignmentsPagination.totalPages}
                onPageChange={assignmentsPagination.setPage}
                onPageSizeChange={assignmentsPagination.setPageSize}
              />
            </div>
          )}
        </>
      )}

      {confirmState ? (
        <ConfirmModal
          open={confirmState.open}
          title={confirmState.title}
          description={confirmState.description}
          danger={confirmState.danger}
          requireReason={confirmState.requireReason}
          reasonLabel="Audited authorization note"
          onCancel={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
        />
      ) : null}
    </div>
  );
}
