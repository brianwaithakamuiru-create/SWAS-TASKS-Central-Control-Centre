import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import {
  EIGHT_DEPARTMENTS,
  EMAIL_CENTRE_SUBDEPARTMENTS,
  STAFF_MANAGEMENT_SUBDEPARTMENTS,
} from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import type {
  AssignmentRecord,
  ClientAccount,
  DepartmentId,
  TaskRecord,
  UserAccount,
} from '../../types/admin';

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (dept: DepartmentId, subId?: string) => void;
  users: UserAccount[];
  clients: ClientAccount[];
  tasks: TaskRecord[];
  assignments: AssignmentRecord[];
}

export function GlobalSearchModal({
  open,
  onClose,
  onNavigate,
  users,
  clients,
  tasks,
  assignments,
}: GlobalSearchModalProps) {
  const { hasDepartment, canManageStaff } = useAuth();
  const [queryText, setQueryText] = useState('');

  const results = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    const navMatches: { label: string; context: string; dept: DepartmentId; subId?: string }[] = [];

    if (canManageStaff) {
      for (const sub of STAFF_MANAGEMENT_SUBDEPARTMENTS) {
        if (!q || sub.label.toLowerCase().includes(q) || 'staff management'.includes(q)) {
          navMatches.push({
            label: sub.label,
            context: 'Staff Management',
            dept: 'staff_management',
            subId: sub.id,
          });
        }
      }
    }

    if (hasDepartment('email_centre')) {
      for (const sub of EMAIL_CENTRE_SUBDEPARTMENTS) {
        if (!q || sub.label.toLowerCase().includes(q) || 'email centre'.includes(q)) {
          navMatches.push({
            label: sub.label,
            context: 'Email Centre',
            dept: 'email_centre',
            subId: sub.id,
          });
        }
      }
    }

    if (hasDepartment('google_drive')) {
      if (!q || 'google drive workspace files'.includes(q)) {
        navMatches.push({
          label: 'Google Drive Workspace',
          context: 'Google Workspace',
          dept: 'google_drive',
        });
      }
    }

    for (const dept of EIGHT_DEPARTMENTS) {
      if (!hasDepartment(dept.id)) continue;
      if (!q || dept.label.toLowerCase().includes(q)) {
        navMatches.push({
          label: dept.label,
          context: 'Department',
          dept: dept.id,
          subId: dept.subdepartments[0]?.id,
        });
      }
      for (const sub of dept.subdepartments) {
        if (q && sub.label.toLowerCase().includes(q)) {
          navMatches.push({
            label: sub.label,
            context: dept.label,
            dept: dept.id,
            subId: sub.id,
          });
        }
      }
    }

    const userMatches =
      q && hasDepartment('user_management')
        ? users
            .filter(
              (u) =>
                u.fullName.toLowerCase().includes(q) ||
                u.email.toLowerCase().includes(q) ||
                u.uid.toLowerCase().includes(q)
            )
            .slice(0, 5)
        : [];

    const clientMatches =
      q && hasDepartment('client_management')
        ? clients
            .filter(
              (c) =>
                c.name.toLowerCase().includes(q) ||
                c.email.toLowerCase().includes(q) ||
                (c.companyName || '').toLowerCase().includes(q)
            )
            .slice(0, 5)
        : [];

    const taskMatches =
      q && hasDepartment('task_monitoring')
        ? tasks
            .filter(
              (t) =>
                t.title.toLowerCase().includes(q) ||
                t.category.toLowerCase().includes(q) ||
                t.taskId.toLowerCase().includes(q)
            )
            .slice(0, 5)
        : [];

    const assignmentMatches =
      q && hasDepartment('bids_assignments')
        ? assignments
            .filter(
              (a) =>
                (a.taskTitle || '').toLowerCase().includes(q) ||
                a.assignmentId.toLowerCase().includes(q)
            )
            .slice(0, 5)
        : [];

    return {
      navMatches: navMatches.slice(0, 8),
      userMatches,
      clientMatches,
      taskMatches,
      assignmentMatches,
    };
  }, [queryText, hasDepartment, canManageStaff, users, clients, tasks, assignments]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center pt-16 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          <Search className="w-4 h-4 text-[#75869D] shrink-0" />
          <input
            autoFocus
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Search departments, users, clients, tasks, or assignments..."
            className="flex-1 text-sm text-[#172B46] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="text-[#75869D] hover:text-[#172B46] p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-3 space-y-4">
          {results.navMatches.length > 0 ? (
            <div>
              <p className="px-2 text-xs font-semibold text-[#75869D] mb-1.5">
                Departments & Workspaces
              </p>
              <div className="space-y-0.5">
                {results.navMatches.map((item) => (
                  <button
                    key={`${item.dept}_${item.subId || ''}`}
                    type="button"
                    onClick={() => {
                      onNavigate(item.dept, item.subId);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-sm rounded-md hover:bg-[#E9F2FF] text-[#172B46]"
                  >
                    <span>
                      {item.label}{' '}
                      <span className="text-xs text-[#75869D]">· {item.context}</span>
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-[#1265C8]" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {results.userMatches.length > 0 ? (
            <div>
              <p className="px-2 text-xs font-semibold text-[#75869D] mb-1.5">Users</p>
              {results.userMatches.map((u) => (
                <button
                  key={u.uid}
                  type="button"
                  onClick={() => {
                    onNavigate('user_management', 'all_users');
                    onClose();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-sm rounded-md hover:bg-[#E9F2FF]"
                >
                  <span className="text-[#172B46]">
                    {u.fullName} <span className="typo-meta text-[#75869D]">· {u.email}</span>
                  </span>
                  <span className="typo-meta text-[#75869D] capitalize">{u.status}</span>
                </button>
              ))}
            </div>
          ) : null}

          {results.clientMatches.length > 0 ? (
            <div>
              <p className="px-2 text-xs font-semibold text-[#75869D] mb-1.5">Clients</p>
              {results.clientMatches.map((c) => (
                <button
                  key={c.clientId}
                  type="button"
                  onClick={() => {
                    onNavigate('client_management', 'all_clients');
                    onClose();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-sm rounded-md hover:bg-[#E9F2FF]"
                >
                  <span className="text-[#172B46]">
                    {c.name}{' '}
                    <span className="typo-meta text-[#75869D]">
                      · {c.companyName || c.email}
                    </span>
                  </span>
                  <span className="typo-meta text-[#75869D] capitalize">{c.status}</span>
                </button>
              ))}
            </div>
          ) : null}

          {results.taskMatches.length > 0 ? (
            <div>
              <p className="px-2 text-xs font-semibold text-[#75869D] mb-1.5">Tasks</p>
              {results.taskMatches.map((t) => (
                <button
                  key={t.taskId}
                  type="button"
                  onClick={() => {
                    onNavigate('task_monitoring', 'all_tasks');
                    onClose();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-sm rounded-md hover:bg-[#E9F2FF]"
                >
                  <span className="text-[#172B46]">
                    {t.title} <span className="typo-meta text-[#75869D]">· {t.category}</span>
                  </span>
                  <span className="typo-meta font-semibold tabular-nums text-[#1265C8]">
                    KES {Number(t.budgetKes).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {results.assignmentMatches.length > 0 ? (
            <div>
              <p className="px-2 typo-meta font-semibold text-[#75869D] mb-1.5">Assignments</p>
              {results.assignmentMatches.map((a) => (
                <button
                  key={a.assignmentId}
                  type="button"
                  onClick={() => {
                    onNavigate('bids_assignments', 'assignment_management');
                    onClose();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 text-left typo-body rounded-md hover:bg-[#E9F2FF]"
                >
                  <span className="text-[#172B46]">{a.taskTitle || a.assignmentId}</span>
                  <span className="typo-meta text-[#75869D] capitalize">{a.status}</span>
                </button>
              ))}
            </div>
          ) : null}

          {queryText.trim() &&
          results.navMatches.length === 0 &&
          results.userMatches.length === 0 &&
          results.clientMatches.length === 0 &&
          results.taskMatches.length === 0 &&
          results.assignmentMatches.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#75869D]">
              No authorized records matched "{queryText}".
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
