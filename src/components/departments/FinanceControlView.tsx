import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileBarChart2,
  Printer,
  Search,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { EIGHT_DEPARTMENTS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  apiFetch,
  exportRecordsToCsv,
  reviewWithdrawalRequest,
  toggleTransactionReconciled,
} from '../../services/firestoreService';
import type {
  ActivityLog,
  PaymentGatewayStatus,
  TransactionRecord,
  WalletRecord,
  WithdrawalRequest,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { TablePagination, usePaginatedList } from '../common/TablePagination';

interface FinanceControlViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  wallets: WalletRecord[];
  transactions: TransactionRecord[];
  withdrawals: WithdrawalRequest[];
  activityLogs: ActivityLog[];
}

function formatKes(value: number): string {
  return `KES ${Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function FinanceControlView({
  subId,
  onSelectSub,
  wallets,
  transactions,
  withdrawals,
  activityLogs,
}: FinanceControlViewProps) {
  const { adminProfile, hasAction } = useAuth();
  const subdepartments =
    EIGHT_DEPARTMENTS.find((d) => d.id === 'finance_control')?.subdepartments || [];

  const [search, setSearch] = useState('');
  const [gatewayStatus, setGatewayStatus] = useState<PaymentGatewayStatus | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    danger: boolean;
    onConfirm: (reason: string) => Promise<void>;
  } | null>(null);

  useEffect(() => {
    if (subId === 'payment_gateway' || subId === 'dashboard') {
      apiFetch<{ paymentGateway: PaymentGatewayStatus }>('/api/v1/system/gateway-status')
        .then((res) => setGatewayStatus(res.paymentGateway))
        .catch(() => undefined);
    }
  }, [subId]);

  const summary = useMemo(() => {
    const verifiedTx = transactions.filter((t) => t.status === 'verified');
    const verifiedVolume = verifiedTx.reduce((acc, t) => acc + Number(t.amountKes || 0), 0);
    const platformFees = verifiedTx.reduce((acc, t) => acc + Number(t.platformFeeKes || 0), 0);
    const pendingWithdrawalKes = withdrawals
      .filter((w) => w.status === 'pending')
      .reduce((acc, w) => acc + Number(w.amountKes || 0), 0);
    const approvedWithdrawalKes = withdrawals
      .filter((w) => w.status === 'approved' || w.status === 'paid')
      .reduce((acc, w) => acc + Number(w.amountKes || 0), 0);
    const totalWalletBalances = wallets.reduce(
      (acc, w) => acc + Number(w.availableBalanceKes || 0),
      0
    );
    const unreconciledCount = verifiedTx.filter((t) => !t.reconciled).length;
    return {
      verifiedVolume,
      platformFees,
      pendingWithdrawalKes,
      approvedWithdrawalKes,
      totalWalletBalances,
      unreconciledCount,
    };
  }, [transactions, withdrawals, wallets]);

  const filteredTransactions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (subId === 'client_payments' && t.type !== 'client_payment') return false;
      if (subId === 'deposits' && t.type !== 'deposit') return false;
      if (subId === 'platform_earnings' && t.type !== 'platform_fee' && !t.platformFeeKes) {
        return false;
      }
      if (subId === 'reconciliation' && t.status !== 'verified') return false;
      if (!q) return true;
      return (
        t.transactionId.toLowerCase().includes(q) ||
        t.userId.toLowerCase().includes(q) ||
        (t.providerRef || '').toLowerCase().includes(q)
      );
    });
  }, [transactions, subId, search]);

  const filteredWithdrawals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withdrawals.filter((w) => {
      if (subId === 'approved_withdrawals' && w.status !== 'approved' && w.status !== 'paid') {
        return false;
      }
      if (subId === 'pending_withdrawals' && w.status !== 'pending') return false;
      if (subId === 'rejected_withdrawals' && w.status !== 'rejected') return false;
      if (!q) return true;
      return (
        w.withdrawalId.toLowerCase().includes(q) ||
        (w.workerName || w.workerUid).toLowerCase().includes(q)
      );
    });
  }, [withdrawals, subId, search]);

  const financeLogs = useMemo(
    () =>
      [...activityLogs]
        .filter((l) => l.category === 'financial')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6),
    [activityLogs]
  );

  const txPagination = usePaginatedList(filteredTransactions, 15);
  const wdPagination = usePaginatedList(filteredWithdrawals, 15);
  const walletPagination = usePaginatedList(wallets, 15);

  const handleWithdrawalDecision = (
    wd: WithdrawalRequest,
    decision: 'approved' | 'rejected'
  ) => {
    if (!adminProfile) return;
    setConfirmState({
      open: true,
      title: `${decision === 'approved' ? 'Approve' : 'Reject'} Withdrawal · ${formatKes(wd.amountKes)}`,
      description: `Confirm ${decision} decision for ${wd.workerName || wd.workerUid}. Server-side idempotency prevents duplicate processing and records an immutable financial audit entry.`,
      danger: decision === 'rejected',
      onConfirm: async (reason) => {
        setFeedback(null);
        try {
          await reviewWithdrawalRequest(adminProfile, wd.withdrawalId, decision, reason);
          setFeedback({
            type: 'ok',
            text: `Withdrawal ${wd.withdrawalId} processed (${decision}).`,
          });
        } catch (err) {
          setFeedback({
            type: 'err',
            text: err instanceof Error ? err.message : 'Failed to process withdrawal',
          });
        } finally {
          setConfirmState(null);
        }
      },
    });
  };

  const handleExportCsv = () => {
    exportRecordsToCsv(
      `swas-tasks-financial-report-${new Date().toISOString().slice(0, 10)}.csv`,
      ['TransactionID', 'UserID', 'Type', 'AmountKES', 'FeeKES', 'Status', 'ProviderRef', 'Reconciled', 'CreatedAt'],
      transactions.map((t) => [
        t.transactionId,
        t.userId,
        t.type,
        t.amountKes,
        t.platformFeeKes || 0,
        t.status,
        t.providerRef || '',
        Boolean(t.reconciled),
        t.createdAt,
      ])
    );
  };

  const isWithdrawalView = [
    'withdrawal_requests',
    'approved_withdrawals',
    'pending_withdrawals',
    'rejected_withdrawals',
  ].includes(subId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46]">
            Finance Control (KES)
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Verified KES ledger, read-only worker wallets, idempotent withdrawal approvals, platform fees, and reconciliation.
          </p>
        </div>

        <div className="no-print flex items-center gap-2">
          {hasAction('export') ? (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 typo-button text-[#172B46] bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 typo-button text-white bg-[#102B50] hover:bg-[#172B46] rounded-md whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Financial Report
          </button>
        </div>
      </div>

      <div className="no-print flex items-center gap-1.5 overflow-x-auto pb-1">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Verified Payment Volume</p>
          <p className="mt-1 tabular-nums text-lg font-semibold text-[#172B46]">
            {formatKes(summary.verifiedVolume)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Platform Fees Earned</p>
          <p className="mt-1 tabular-nums text-lg font-semibold text-[#15966B]">
            {formatKes(summary.platformFees)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Worker Wallet Balances</p>
          <p className="mt-1 tabular-nums text-lg font-semibold text-[#172B46]">
            {formatKes(summary.totalWalletBalances)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Pending Withdrawals</p>
          <p className="mt-1 tabular-nums text-lg font-semibold text-[#E6A23C]">
            {formatKes(summary.pendingWithdrawalKes)}
          </p>
        </div>
      </div>

      {subId === 'dashboard' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="typo-card-heading text-[#172B46]">
              Treasury & Payout Review Queues
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  id: 'pending_withdrawals',
                  label: 'Pending Withdrawals',
                  value: `${withdrawals.filter((w) => w.status === 'pending').length}`,
                  icon: Clock,
                },
                {
                  id: 'reconciliation',
                  label: 'Unreconciled Verified Tx',
                  value: `${summary.unreconciledCount}`,
                  icon: CheckCircle2,
                },
                {
                  id: 'worker_wallets',
                  label: 'Active Worker Wallets',
                  value: `${wallets.length}`,
                  icon: Wallet,
                },
                {
                  id: 'payment_gateway',
                  label: 'M-Pesa Daraja Gateway',
                  value: gatewayStatus?.mpesaConfigured ? 'Configured' : 'Not Configured',
                  icon: CreditCard,
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
                        <p className="typo-meta text-[#75869D]">Open panel</p>
                      </div>
                    </div>
                    <span className="tabular-nums typo-body font-semibold text-[#172B46]">
                      {card.value}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <h2 className="typo-card-heading text-[#172B46]">
              Recent Financial Audits
            </h2>
            {financeLogs.length === 0 ? (
              <p className="typo-meta text-[#75869D]">No financial review audits recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {financeLogs.map((l) => (
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
      ) : subId === 'financial_reports' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <FileBarChart2 className="w-5 h-5 text-[#1265C8]" />
              <div>
                <h2 className="typo-card-heading text-[#172B46]">
                  KES Financial & Reconciliation Report
                </h2>
                <p className="typo-meta text-[#75869D]">
                  Verified ledger totals computed strictly from Cloud Firestore records.
                </p>
              </div>
            </div>
            <div className="no-print flex items-center gap-2">
              {hasAction('export') ? (
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-button text-white bg-[#1265C8] rounded-md"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Ledger CSV
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 typo-body">
            <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA]">
              <p className="typo-meta text-[#75869D]">Verified Inflow Volume</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#172B46]">
                {formatKes(summary.verifiedVolume)}
              </p>
            </div>
            <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA]">
              <p className="typo-meta text-[#75869D]">Approved / Paid Withdrawals</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#15966B]">
                {formatKes(summary.approvedWithdrawalKes)}
              </p>
            </div>
            <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA]">
              <p className="typo-meta text-[#75869D]">Unreconciled Verified Entries</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-[#E6A23C]">
                {summary.unreconciledCount}
              </p>
            </div>
          </div>
        </div>
      ) : subId === 'payment_gateway' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-[#1265C8] shrink-0 mt-0.5" />
              <div>
                <h2 className="typo-card-heading text-[#172B46]">
                  Payment Gateway Integration (Safaricom M-Pesa Daraja)
                </h2>
                <p className="mt-1 typo-body text-[#75869D]">
                  Unverified payments are never marked successful. Daraja Consumer Key, Consumer Secret,
                  Shortcode, Passkey, and Callback URL must be set in server-side environment variables
                  before enabling live STK Push or B2C disbursements.
                </p>
              </div>
            </div>
            <StatusText
              status={gatewayStatus?.mpesaConfigured ? 'active' : 'warning'}
              label={gatewayStatus?.mpesaConfigured ? 'Configured' : 'Not Configured'}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-200 typo-meta">
            <div className="p-3.5 rounded-md bg-[#F3F6FA] border border-slate-200">
              <p className="font-semibold text-[#172B46]">Provider & Environment</p>
              <p className="mt-1 text-[#75869D]">
                {gatewayStatus?.mpesaProvider || 'Safaricom M-Pesa Daraja'} (
                <span className="font-mono">{gatewayStatus?.mpesaEnvironment || 'sandbox'}</span>)
              </p>
            </div>
            <div className="p-3.5 rounded-md bg-[#F3F6FA] border border-slate-200">
              <p className="font-semibold text-[#172B46]">Settlement Currency</p>
              <p className="mt-1 text-[#75869D]">
                {gatewayStatus?.currency || 'KES'} (Kenyan Shillings)
              </p>
            </div>
            <div className="p-3.5 rounded-md bg-[#F3F6FA] border border-slate-200">
              <p className="font-semibold text-[#172B46]">Wallet Mutation Protection</p>
              <p className="mt-1 text-[#15966B] font-medium">
                Direct admin balance editing blocked by Firestore rules
              </p>
            </div>
          </div>
        </div>
      ) : subId === 'worker_wallets' ? (
        wallets.length === 0 ? (
          <EmptyState
            title="No Worker Wallets Recorded"
            description="Worker KES wallet ledgers appear automatically when workers register and earn verified escrow payouts."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full typo-table">
              <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Worker</th>
                  <th className="px-4 py-3 font-medium text-right">Available (KES)</th>
                  <th className="px-4 py-3 font-medium text-right">Pending Escrow (KES)</th>
                  <th className="px-4 py-3 font-medium text-right">Total Earned (KES)</th>
                  <th className="px-4 py-3 font-medium text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {walletPagination.pagedItems.map((w) => (
                  <tr key={w.walletId}>
                    <td className="px-4 py-3 font-medium text-[#172B46]">
                      {w.ownerName || w.ownerUid}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatKes(w.availableBalanceKes)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#75869D]">
                      {formatKes(w.pendingEscrowKes)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#15966B]">
                      {formatKes(w.totalEarnedKes)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums typo-meta text-[#75869D]">
                      {new Date(w.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              page={walletPagination.page}
              pageSize={walletPagination.pageSize}
              totalItems={walletPagination.totalItems}
              totalPages={walletPagination.totalPages}
              onPageChange={walletPagination.setPage}
              onPageSizeChange={walletPagination.setPageSize}
            />
          </div>
        )
      ) : isWithdrawalView ? (
        <div className="space-y-4">
          <div className="no-print bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
            <Search className="w-4 h-4 text-[#75869D]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search withdrawals by ID or worker..."
              className="flex-1 typo-input text-[#172B46] focus:outline-none"
            />
          </div>
          {filteredWithdrawals.length === 0 ? (
            <EmptyState
              title="No Withdrawal Requests"
              description="Worker KES withdrawal requests matching this filter will appear here for authorized review."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Request ID</th>
                    <th className="px-4 py-3 font-medium">Worker</th>
                    <th className="px-4 py-3 font-medium">Destination</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {wdPagination.pagedItems.map((wd) => (
                    <tr key={wd.withdrawalId}>
                      <td className="px-4 py-3 font-mono typo-meta text-[#172B46]">
                        {wd.withdrawalId}
                      </td>
                      <td className="px-4 py-3 font-medium text-[#172B46]">
                        {wd.workerName || wd.workerUid}
                      </td>
                      <td className="px-4 py-3 typo-meta text-[#75869D] uppercase">
                        {wd.destinationType} {wd.destinationMasked ? `· ${wd.destinationMasked}` : ''}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatKes(wd.amountKes)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={wd.status} />
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        {hasAction('approve') && wd.status === 'pending' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleWithdrawalDecision(wd, 'approved')}
                              className="text-xs font-medium text-[#15966B] hover:underline"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleWithdrawalDecision(wd, 'rejected')}
                              className="text-xs font-medium text-[#D34552] hover:underline"
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <span className="typo-meta text-[#75869D]">
                            {wd.reviewedBy ? 'Reviewed' : 'Locked'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination
                page={wdPagination.page}
                pageSize={wdPagination.pageSize}
                totalItems={wdPagination.totalItems}
                totalPages={wdPagination.totalPages}
                onPageChange={wdPagination.setPage}
                onPageSizeChange={wdPagination.setPageSize}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="no-print bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
            <Search className="w-4 h-4 text-[#75869D]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search KES transactions by ID, user, or provider reference..."
              className="flex-1 typo-input text-[#172B46] focus:outline-none"
            />
          </div>
          {filteredTransactions.length === 0 ? (
            <EmptyState
              title="No Financial Transactions Recorded"
              description="Verified KES client payments, escrow releases, and deposits will appear here."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full typo-table">
                <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Transaction ID</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Provider Ref</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Reconciled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {txPagination.pagedItems.map((t) => (
                    <tr key={t.transactionId}>
                      <td className="px-4 py-3 font-mono typo-meta text-[#172B46]">
                        {t.transactionId}
                      </td>
                      <td className="px-4 py-3 capitalize text-[#172B46]">
                        {t.type.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 font-mono typo-meta text-[#75869D]">
                        {t.providerRef || '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatKes(t.amountKes)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={t.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {adminProfile && hasAction('update') && t.status === 'verified' ? (
                          <button
                            type="button"
                            onClick={() =>
                              void toggleTransactionReconciled(
                                adminProfile,
                                t.transactionId,
                                !t.reconciled
                              )
                            }
                            className={`text-xs font-medium hover:underline ${
                              t.reconciled ? 'text-[#15966B]' : 'text-[#1265C8]'
                            }`}
                          >
                            {t.reconciled ? 'Reconciled' : 'Mark Reconciled'}
                          </button>
                        ) : (
                          <span className="text-xs text-[#75869D]">
                            {t.reconciled ? 'Yes' : 'No'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination
                page={txPagination.page}
                pageSize={txPagination.pageSize}
                totalItems={txPagination.totalItems}
                totalPages={txPagination.totalPages}
                onPageChange={txPagination.setPage}
                onPageSizeChange={txPagination.setPageSize}
              />
            </div>
          )}
        </div>
      )}

      {confirmState ? (
        <ConfirmModal
          open={confirmState.open}
          title={confirmState.title}
          description={confirmState.description}
          danger={confirmState.danger}
          requireReason
          reasonLabel="Financial review note"
          onCancel={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
        />
      ) : null}
    </div>
  );
}
