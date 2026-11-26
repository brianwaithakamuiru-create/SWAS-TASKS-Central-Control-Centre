import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  FileBarChart2,
  Mail,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { EIGHT_DEPARTMENTS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  exportRecordsToCsv,
  saveTaskCategory,
  updateTaskModeration,
} from '../../services/firestoreService';
import type {
  ActivityLog,
  ClientAccount,
  EmailTemplateRecord,
  TaskCategory,
  TaskRecord,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { TablePagination, usePaginatedList } from '../common/TablePagination';
import { DepartmentEmailModal, type DepartmentEmailTarget } from './DepartmentEmailModal';

interface TaskMonitoringViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  tasks: TaskRecord[];
  categories: TaskCategory[];
  activityLogs: ActivityLog[];
  clients?: ClientAccount[];
  emailTemplates?: EmailTemplateRecord[];
}

type TaskSortKey = 'budgetKes' | 'deadline' | 'createdAt';

export function TaskMonitoringView({
  subId,
  onSelectSub,
  tasks,
  categories,
  activityLogs,
  clients = [],
  emailTemplates = [],
}: TaskMonitoringViewProps) {
  const { adminProfile, hasAction, hasEmailPermission } = useAuth();
  const canEmail = hasEmailPermission('email.compose');
  const subdepartments =
    EIGHT_DEPARTMENTS.find((d) => d.id === 'task_monitoring')?.subdepartments || [];

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<TaskSortKey>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskRecord | null>(null);
  const [emailTarget, setEmailTarget] = useState<DepartmentEmailTarget | null>(null);
  const [emailSubjectDefault, setEmailSubjectDefault] = useState('');
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catMinBudget, setCatMinBudget] = useState('500');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    danger: boolean;
    requireReason: boolean;
    onConfirm: (reason: string) => Promise<void>;
  } | null>(null);

  const taskStats = useMemo(() => {
    const pending = tasks.filter((t) => t.status === 'pending').length;
    const published = tasks.filter((t) => t.status === 'published').length;
    const active = tasks.filter((t) => t.status === 'active').length;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const reported = tasks.filter((t) => t.status === 'reported').length;
    const rejected = tasks.filter((t) => t.status === 'rejected').length;
    const totalBudgetKes = tasks.reduce((acc, t) => acc + Number(t.budgetKes || 0), 0);
    return {
      total: tasks.length,
      pending,
      published,
      active,
      completed,
      reported,
      rejected,
      totalBudgetKes,
    };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tasks.filter((t) => {
      if (subId === 'published_tasks' && t.status !== 'published') return false;
      if (subId === 'pending_tasks' && t.status !== 'pending') return false;
      if (subId === 'active_tasks' && t.status !== 'active') return false;
      if (subId === 'completed_tasks' && t.status !== 'completed') return false;
      if (subId === 'rejected_tasks' && t.status !== 'rejected') return false;
      if (subId === 'reported_tasks' && t.status !== 'reported') return false;
      if (subId === 'task_moderation' && t.status !== 'pending' && t.status !== 'reported') {
        return false;
      }
      if (subId === 'task_deadlines' && !t.deadline) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        (t.clientName || t.clientId).toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'budgetKes') {
        cmp = Number(a.budgetKes || 0) - Number(b.budgetKes || 0);
      } else if (sortKey === 'deadline') {
        cmp = (a.deadline || '9999').localeCompare(b.deadline || '9999');
      } else {
        cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [tasks, subId, search, sortKey, sortAsc]);

  const taskPagination = usePaginatedList(filteredTasks, 15);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; totalBudgetKes: number }>();
    for (const t of tasks) {
      const key = t.category || 'Uncategorized';
      const cur = map.get(key) || { count: 0, totalBudgetKes: 0 };
      cur.count += 1;
      cur.totalBudgetKes += Number(t.budgetKes || 0);
      map.set(key, cur);
    }
    return Array.from(map.entries()).map(([category, data]) => ({ category, ...data }));
  }, [tasks]);

  const taskModerationLogs = useMemo(
    () =>
      [...activityLogs]
        .filter((l) => l.action.startsWith('TASK_') || l.affectedRecord.startsWith('tasks/'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6),
    [activityLogs]
  );

  const toggleSort = (key: TaskSortKey) => {
    if (sortKey === key) setSortAsc((prev) => !prev);
    else {
      setSortKey(key);
      setSortAsc(key === 'deadline');
    }
  };

  const handleModerate = (
    task: TaskRecord,
    nextStatus: TaskRecord['status'],
    label: string,
    danger = false
  ) => {
    if (!adminProfile) return;
    setConfirmState({
      open: true,
      title: `${label}: ${task.title}`,
      description: `Change task status from '${task.status}' to '${nextStatus}' in Cloud Firestore?`,
      danger,
      requireReason: danger,
      onConfirm: async (reason) => {
        await updateTaskModeration(
          adminProfile,
          task.taskId,
          { status: nextStatus, moderationNotes: reason },
          `TASK_${nextStatus.toUpperCase()}`
        );
        setFeedback(`Task "${task.title}" updated to ${nextStatus}.`);
        if (selectedTask?.taskId === task.taskId) {
          setSelectedTask({ ...task, status: nextStatus, moderationNotes: reason });
        }
        setConfirmState(null);
      },
    });
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminProfile || !catName.trim()) return;
    const slug = catName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    await saveTaskCategory(adminProfile, {
      name: catName.trim(),
      slug: slug || 'general',
      description: catDesc.trim(),
      active: true,
      minBudgetKes: Number(catMinBudget || 0),
    });
    setCatName('');
    setCatDesc('');
    setFeedback(`Category "${catName.trim()}" saved to Firestore.`);
  };

  const handleToggleCategoryActive = async (cat: TaskCategory) => {
    if (!adminProfile) return;
    await saveTaskCategory(adminProfile, {
      categoryId: cat.categoryId,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      active: !cat.active,
      minBudgetKes: cat.minBudgetKes,
    });
    setFeedback(`Category "${cat.name}" marked ${cat.active ? 'inactive' : 'active'}.`);
  };

  const handleExportTasksCsv = () => {
    exportRecordsToCsv(
      `swas-tasks-${subId}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Task ID', 'Title', 'Category', 'Client', 'Budget KES', 'Status', 'Deadline', 'Created At'],
      filteredTasks.map((t) => [
        t.taskId,
        t.title,
        t.category,
        t.clientName || t.clientId,
        t.budgetKes,
        t.status,
        t.deadline || '',
        t.createdAt,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46]">
            Task Monitoring
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Monitor posted tasks, deadlines, moderation queues, reported tasks, and categories.
          </p>
        </div>
        {hasAction('export') ? (
          <button
            type="button"
            onClick={handleExportTasksCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 typo-button text-[#172B46] bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap self-start sm:self-auto"
          >
            <Download className="w-3.5 h-3.5" />
            Export Tasks CSV
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
        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 typo-meta text-[#15966B]">
          {feedback}
        </div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Total Tasks</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#172B46]">
            {taskStats.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Published / Active</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#15966B]">
            {taskStats.published + taskStats.active}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Pending Review</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#E6A23C]">
            {taskStats.pending}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Reported Tasks</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#D34552]">
            {taskStats.reported}
          </p>
        </div>
      </div>

      {subId === 'dashboard' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="typo-card-heading text-[#172B46]">
              Task Moderation & Operations Queues
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { id: 'pending_tasks', label: 'Pending Approval', count: taskStats.pending, icon: Clock },
                { id: 'reported_tasks', label: 'Reported Tasks', count: taskStats.reported, icon: AlertTriangle },
                { id: 'completed_tasks', label: 'Completed Tasks', count: taskStats.completed, icon: CheckCircle2 },
                { id: 'task_categories', label: 'Active Categories', count: categories.filter((c) => c.active).length, icon: ClipboardList },
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
            <h2 className="typo-card-heading text-[#172B46]">
              Recent Moderation Activity
            </h2>
            {taskModerationLogs.length === 0 ? (
              <p className="typo-meta text-[#75869D]">No task moderation decisions logged yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {taskModerationLogs.map((l) => (
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
      ) : subId === 'task_reports' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FileBarChart2 className="w-5 h-5 text-[#1265C8]" />
              <div>
                <h2 className="typo-card-heading text-[#172B46]">
                  Task Category & Budget Analytics
                </h2>
                <p className="typo-meta text-[#75869D]">
                  Total task value in Firestore:{' '}
                  <span className="tabular-nums font-semibold text-[#172B46]">
                    KES {taskStats.totalBudgetKes.toLocaleString()}
                  </span>
                </p>
              </div>
            </div>
            {hasAction('export') ? (
              <button
                type="button"
                onClick={handleExportTasksCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-button text-white bg-[#1265C8] rounded-md"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            ) : null}
          </div>

          {categoryBreakdown.length === 0 ? (
            <EmptyState
              title="No Task Analytics Available"
              description="Category and budget breakdowns populate automatically as tasks are posted."
            />
          ) : (
            <table className="w-full typo-table">
              <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium text-right">Task Count</th>
                  <th className="px-4 py-3 font-medium text-right">Total Budget (KES)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categoryBreakdown.map((row) => (
                  <tr key={row.category}>
                    <td className="px-4 py-3 font-medium text-[#172B46]">{row.category}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.count}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      KES {row.totalBudgetKes.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : subId === 'task_categories' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleCreateCategory}
            className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 h-fit"
          >
            <h2 className="typo-card-heading text-[#172B46]">
              Add Task Category
            </h2>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Category Name
              </label>
              <input
                type="text"
                required
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="e.g. Data Annotation"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Minimum Budget (KES)
              </label>
              <input
                type="number"
                min={0}
                value={catMinBudget}
                onChange={(e) => setCatMinBudget(e.target.value)}
                className="w-full px-3 py-2 typo-input tabular-nums border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Description
              </label>
              <textarea
                rows={3}
                value={catDesc}
                onChange={(e) => setCatDesc(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <button
              type="submit"
              disabled={!hasAction('update')}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Save Category
            </button>
          </form>

          <div className="lg:col-span-2">
            {categories.length === 0 ? (
              <EmptyState
                title="No Task Categories Configured"
                description="Add your first task category using the form to publish it to the SWAS TASKS marketplace."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium">Slug</th>
                      <th className="px-4 py-3 font-medium">Min Budget</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Toggle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {categories.map((cat) => (
                      <tr key={cat.categoryId}>
                        <td className="px-4 py-3 font-medium text-[#172B46]">{cat.name}</td>
                        <td className="px-4 py-3 font-mono typo-meta text-[#75869D]">{cat.slug}</td>
                        <td className="px-4 py-3 tabular-nums">
                          KES {Number(cat.minBudgetKes || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={cat.active ? 'active' : 'inactive'} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {hasAction('update') ? (
                            <button
                              type="button"
                              onClick={() => void handleToggleCategoryActive(cat)}
                              className="typo-meta font-medium text-[#1265C8] hover:underline"
                            >
                              {cat.active ? 'Disable' : 'Enable'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
            <Search className="w-4 h-4 text-[#75869D]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks by title, category, or client..."
              className="flex-1 typo-input text-[#172B46] focus:outline-none"
            />
          </div>

          {filteredTasks.length === 0 ? (
            <EmptyState
              title="No Tasks in This Queue"
              description="No tasks stored in Cloud Firestore match this status filter."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Task Title</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium">Client</th>
                      <th className="px-4 py-3 font-medium text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort('budgetKes')}
                          className="inline-flex items-center gap-1 hover:text-[#172B46]"
                        >
                          <span>Budget (KES)</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => toggleSort('deadline')}
                          className="inline-flex items-center gap-1 hover:text-[#172B46]"
                        >
                          <span>Deadline</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Moderation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {taskPagination.pagedItems.map((t) => (
                      <tr key={t.taskId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedTask(t)}
                            className="font-medium text-[#172B46] hover:text-[#1265C8] text-left"
                          >
                            {t.title}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-[#75869D]">{t.category}</td>
                        <td className="px-4 py-3 text-[#75869D]">{t.clientName || t.clientId}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          KES {Number(t.budgetKes).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 tabular-nums typo-meta text-[#75869D]">
                          {t.deadline ? new Date(t.deadline).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={t.status} />
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {hasAction('approve') && (t.status === 'pending' || t.status === 'reported') ? (
                            <button
                              type="button"
                              onClick={() => handleModerate(t, 'published', 'Approve & Publish')}
                              className="text-xs font-medium text-[#15966B] hover:underline"
                            >
                              Approve
                            </button>
                          ) : null}
                          {hasAction('update') && t.status !== 'rejected' && t.status !== 'removed' ? (
                            <button
                              type="button"
                              onClick={() => handleModerate(t, 'rejected', 'Reject Task', true)}
                              className="text-xs font-medium text-[#E6A23C] hover:underline"
                            >
                              Reject
                            </button>
                          ) : null}
                          {hasAction('update') && t.status !== 'removed' ? (
                            <button
                              type="button"
                              onClick={() => handleModerate(t, 'removed', 'Remove Task', true)}
                              className="text-xs font-medium text-[#D34552] hover:underline"
                            >
                              Remove
                            </button>
                          ) : null}
                          {canEmail ? (() => {
                            const clientRec = clients.find(
                              (c) => c.clientId === t.clientId || c.ownerUid === t.clientId
                            );
                            if (!clientRec?.email) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  setEmailSubjectDefault(`SWAS TASKS – Task Update: ${t.title}`);
                                  setEmailTarget({
                                    name: clientRec.name,
                                    email: clientRec.email,
                                    uid: clientRec.ownerUid || clientRec.clientId,
                                    recipientType: 'client',
                                    sourceRecord: `tasks/${t.taskId}`,
                                    vars: {
                                      client_name: clientRec.name,
                                      first_name: clientRec.name.split(' ')[0] || clientRec.name,
                                      email: clientRec.email,
                                      account_id: clientRec.clientId,
                                    },
                                  });
                                }}
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#1265C8] hover:underline"
                              >
                                <Mail className="w-3 h-3" />
                                Email
                              </button>
                            );
                          })() : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                page={taskPagination.page}
                pageSize={taskPagination.pageSize}
                totalItems={taskPagination.totalItems}
                totalPages={taskPagination.totalPages}
                onPageChange={taskPagination.setPage}
                onPageSizeChange={taskPagination.setPageSize}
              />
            </div>
          )}
        </div>
      )}

      {selectedTask ? (
        <div className="fixed inset-0 z-40 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-lg h-full overflow-y-auto p-6 border-l border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between border-b border-slate-200 pb-4">
                <div>
                  <h3 className="typo-section-heading text-[#172B46]">
                    {selectedTask.title}
                  </h3>
                  <p className="typo-meta font-mono text-[#75869D]">{selectedTask.taskId}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTask(null)}
                  className="p-1 text-[#75869D] hover:text-[#172B46]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <dl className="mt-4 space-y-2 typo-meta border-b border-slate-100 pb-4">
                <div className="flex justify-between">
                  <dt className="text-[#75869D]">Category</dt>
                  <dd className="font-medium text-[#172B46]">{selectedTask.category}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#75869D]">Budget</dt>
                  <dd className="tabular-nums font-medium text-[#172B46]">
                    KES {Number(selectedTask.budgetKes).toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#75869D]">Status</dt>
                  <dd>
                    <StatusText status={selectedTask.status} />
                  </dd>
                </div>
              </dl>
              <div className="mt-4 space-y-3 typo-body">
                <p className="text-[#172B46] whitespace-pre-wrap">
                  {selectedTask.description || 'No description provided.'}
                </p>
                {selectedTask.reportReason ? (
                  <div className="p-3 rounded bg-red-50 border border-red-200 typo-meta text-[#D34552]">
                    Report Reason: {selectedTask.reportReason}
                  </div>
                ) : null}
                {selectedTask.moderationNotes ? (
                  <div className="p-3 rounded bg-[#F3F6FA] border border-slate-200 typo-meta text-[#172B46]">
                    Moderation Note: {selectedTask.moderationNotes}
                  </div>
                ) : null}
              </div>
            </div>

            {hasAction('approve') || hasAction('update') ? (
              <div className="pt-4 mt-6 border-t border-slate-200 flex items-center gap-2">
                {hasAction('approve') && selectedTask.status !== 'published' ? (
                  <button
                    type="button"
                    onClick={() => handleModerate(selectedTask, 'published', 'Approve & Publish')}
                    className="px-3 py-2 typo-button text-white bg-[#15966B] rounded-md"
                  >
                    Approve & Publish
                  </button>
                ) : null}
                {hasAction('update') && selectedTask.status !== 'rejected' ? (
                  <button
                    type="button"
                    onClick={() => handleModerate(selectedTask, 'rejected', 'Reject Task', true)}
                    className="px-3 py-2 typo-button text-white bg-[#E6A23C] rounded-md"
                  >
                    Reject
                  </button>
                ) : null}
                {hasAction('update') && selectedTask.status !== 'removed' ? (
                  <button
                    type="button"
                    onClick={() => handleModerate(selectedTask, 'removed', 'Remove Task', true)}
                    className="px-3 py-2 typo-button text-white bg-[#D34552] rounded-md"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {confirmState ? (
        <ConfirmModal
          open={confirmState.open}
          title={confirmState.title}
          description={confirmState.description}
          danger={confirmState.danger}
          requireReason={confirmState.requireReason}
          onCancel={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
        />
      ) : null}

      <DepartmentEmailModal
        open={Boolean(emailTarget)}
        onClose={() => setEmailTarget(null)}
        department="task_monitoring"
        initialRecipient={emailTarget}
        defaultSubject={emailSubjectDefault}
        templates={emailTemplates}
      />
    </div>
  );
}
