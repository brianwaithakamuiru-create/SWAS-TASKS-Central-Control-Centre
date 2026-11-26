import React, { useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  HardDrive,
  HelpCircle,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  MessageSquare,
  Search,
  Settings,
  ShieldAlert,
  User,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  EIGHT_DEPARTMENTS,
  EMAIL_CENTRE_SUBDEPARTMENTS,
  ROLE_DEFINITIONS,
  STAFF_MANAGEMENT_SUBDEPARTMENTS,
} from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import { markNotificationRead } from '../../services/firestoreService';
import type { AdminNotification, DepartmentId } from '../../types/admin';
import type { WorkplaceTab } from '../departments/DepartmentWorkplacePanels';

const DEPT_ICONS = {
  Users,
  Building2,
  ClipboardList,
  Briefcase,
  Wallet,
  KeyRound,
  ShieldAlert,
  Settings,
};

interface AdminShellProps {
  activeDept: DepartmentId;
  activeSubId: string;
  workplaceTab: WorkplaceTab;
  onSelectWorkplaceTab: (tab: WorkplaceTab) => void;
  onNavigate: (dept: DepartmentId, subId?: string) => void;
  onOpenSearch: () => void;
  notifications: AdminNotification[];
  pendingVerificationCount?: number;
  children: React.ReactNode;
}

export function AdminShell({
  activeDept,
  activeSubId,
  workplaceTab,
  onSelectWorkplaceTab,
  onNavigate,
  onOpenSearch,
  notifications,
  pendingVerificationCount = 0,
  children,
}: AdminShellProps) {
  const {
    adminProfile,
    isSuperAdmin,
    canManageStaff,
    primaryDepartment,
    logout,
    hasDepartment,
    hasEmailPermission,
  } = useAuth();
  const canViewEmailCentre = isSuperAdmin || hasEmailPermission('email.view');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [navSearch, setNavSearch] = useState('');
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({
    [activeDept]: true,
  });
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const visibleDepartments = useMemo(() => {
    const q = navSearch.trim().toLowerCase();
    return EIGHT_DEPARTMENTS.filter((dept) => hasDepartment(dept.id))
      .map((dept) => {
        if (!q) return dept;
        const deptMatch = dept.label.toLowerCase().includes(q);
        const matchedSubs = dept.subdepartments.filter((s) =>
          s.label.toLowerCase().includes(q)
        );
        if (!deptMatch && matchedSubs.length === 0) return null;
        return {
          ...dept,
          subdepartments: deptMatch ? dept.subdepartments : matchedSubs,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  }, [hasDepartment, navSearch]);

  const activeDepartmentConfig = EIGHT_DEPARTMENTS.find((d) => d.id === activeDept);
  const activeSubConfig =
    activeDept === 'staff_management'
      ? STAFF_MANAGEMENT_SUBDEPARTMENTS.find((s) => s.id === activeSubId)
      : activeDept === 'email_centre'
      ? EMAIL_CENTRE_SUBDEPARTMENTS.find((s) => s.id === activeSubId)
      : activeDepartmentConfig?.subdepartments.find((s) => s.id === activeSubId);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const toggleDept = (deptId: DepartmentId) => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      setExpandedDepts((prev) => ({ ...prev, [deptId]: true }));
      return;
    }
    setExpandedDepts((prev) => ({ ...prev, [deptId]: !prev[deptId] }));
  };

  const handleSelectNav = (dept: DepartmentId, subId?: string) => {
    setExpandedDepts((prev) => ({ ...prev, [dept]: true }));
    onSelectWorkplaceTab('operations');
    onNavigate(dept, subId);
    setMobileOpen(false);
  };

  const breadcrumbLabel = useMemo(() => {
    const rootLabel = isSuperAdmin
      ? 'Control Centre'
      : activeDepartmentConfig?.label || 'Department Workplace';
    if (activeDept === 'overview') return ['Control Centre', 'Central Dashboard'];
    if (activeDept === 'staff_management') {
      return activeSubConfig
        ? ['Control Centre', 'Staff Management', activeSubConfig.label]
        : ['Control Centre', 'Staff Management'];
    }
    if (activeDept === 'email_centre') {
      return activeSubConfig
        ? ['Control Centre', 'Email Centre', activeSubConfig.label]
        : ['Control Centre', 'Email Centre'];
    }
    if (activeDept === 'google_drive') return ['Control Centre', 'Google Drive'];
    if (activeDept === 'system_health') return ['Control Centre', 'System Status'];
    if (activeDept === 'support_announcements') return ['Control Centre', 'Support & Notices'];
    if (activeDepartmentConfig && activeSubConfig) {
      return isSuperAdmin
        ? [rootLabel, activeDepartmentConfig.label, activeSubConfig.label]
        : [activeDepartmentConfig.label, activeSubConfig.label];
    }
    if (activeDepartmentConfig) {
      return [activeDepartmentConfig.label];
    }
    return [rootLabel];
  }, [isSuperAdmin, activeDept, activeDepartmentConfig, activeSubConfig]);

  const roleLabel =
    (adminProfile && ROLE_DEFINITIONS[adminProfile.role]?.label) ||
    adminProfile?.role ||
    'Department Staff';

  const brandTargetDept: DepartmentId = isSuperAdmin
    ? 'overview'
    : primaryDepartment || 'user_management';

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#102B50] text-white select-none">
      {/* Brand Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-white/10 shrink-0">
        <button
          type="button"
          onClick={() => handleSelectNav(brandTargetDept)}
          className="flex items-center gap-2.5 min-w-0 text-left"
        >
          <div className="w-8 h-8 rounded bg-white p-1 shrink-0 flex items-center justify-center">
            <img
              src="/src/assets/images/swas_control_emblem_1795473644381.jpg"
              alt="SWAS TASKS"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          </div>
          {!sidebarCollapsed ? (
            <div className="min-w-0">
              <span className="typo-card-heading tracking-tight text-white truncate block">
                SWAS TASKS
              </span>
              {!isSuperAdmin && activeDepartmentConfig ? (
                <span className="typo-small text-blue-200 truncate block">
                  {activeDepartmentConfig.label}
                </span>
              ) : null}
            </div>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => setSidebarCollapsed((c) => !c)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden lg:inline-flex p-1.5 rounded hover:bg-white/10 text-blue-200 hover:text-white transition-colors"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="lg:hidden p-1.5 rounded hover:bg-white/10 text-blue-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Sidebar Search */}
      {!sidebarCollapsed ? (
        <div className="px-3 py-3 border-b border-white/10 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-blue-200 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              placeholder={isSuperAdmin ? 'Filter departments...' : 'Filter workplace pages...'}
              className="w-full bg-white/10 border border-white/15 rounded-md pl-8 pr-2.5 py-1.5 text-xs text-white placeholder:text-blue-200/70 focus:outline-none focus:border-[#1265C8]"
            />
          </div>
        </div>
      ) : null}

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1">
        {isSuperAdmin ? (
          <>
            <button
              type="button"
              title={sidebarCollapsed ? 'Central Dashboard' : undefined}
              onClick={() => handleSelectNav('overview')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                activeDept === 'overview'
                  ? 'bg-[#1265C8] text-white'
                  : 'text-slate-100 hover:bg-white/10'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed ? <span className="truncate">Central Dashboard</span> : null}
            </button>

            {canManageStaff ? (
              <div className="space-y-0.5">
                <button
                  type="button"
                  title={sidebarCollapsed ? 'Staff Management' : undefined}
                  onClick={() => {
                    if (sidebarCollapsed) {
                      handleSelectNav('staff_management', 'all_staff');
                    } else {
                      toggleDept('staff_management');
                    }
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeDept === 'staff_management'
                      ? 'bg-[#1265C8]/90 text-white'
                      : 'text-slate-100 hover:bg-white/10'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <UserCheck className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed ? (
                      <span className="truncate flex items-center gap-2">
                        <span>Staff Management</span>
                        {pendingVerificationCount > 0 ? (
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-[#102B50] text-[10px] font-bold tabular-nums">
                            {pendingVerificationCount}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  {!sidebarCollapsed ? (
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
                        expandedDepts.staff_management ? 'rotate-180' : ''
                      }`}
                    />
                  ) : null}
                </button>
                {!sidebarCollapsed && expandedDepts.staff_management ? (
                  <div className="ml-4 pl-3 border-l border-white/15 space-y-0.5 py-1">
                    {STAFF_MANAGEMENT_SUBDEPARTMENTS.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => handleSelectNav('staff_management', sub.id)}
                        className={`w-full text-left px-2.5 py-1.5 rounded typo-nav transition-colors flex items-center justify-between gap-2 ${
                          activeDept === 'staff_management' && activeSubId === sub.id
                            ? 'bg-[#1265C8] text-white font-semibold'
                            : 'text-blue-100/85 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        <span className="truncate">{sub.label}</span>
                        {sub.id === 'staff_verification' && pendingVerificationCount > 0 ? (
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-[#102B50] text-[10px] font-bold tabular-nums shrink-0">
                            {pendingVerificationCount}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {canViewEmailCentre ? (
              <div className="space-y-0.5">
                <button
                  type="button"
                  title={sidebarCollapsed ? 'Email Centre' : undefined}
                  onClick={() => {
                    if (sidebarCollapsed) {
                      handleSelectNav('email_centre', EMAIL_CENTRE_SUBDEPARTMENTS[0].id);
                    } else {
                      toggleDept('email_centre');
                    }
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeDept === 'email_centre'
                      ? 'bg-[#1265C8]/90 text-white'
                      : 'text-slate-100 hover:bg-white/10'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Mail className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed ? <span className="truncate">Email Centre</span> : null}
                  </span>
                  {!sidebarCollapsed ? (
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
                        expandedDepts.email_centre ? 'rotate-180' : ''
                      }`}
                    />
                  ) : null}
                </button>
                {!sidebarCollapsed && expandedDepts.email_centre ? (
                  <div className="ml-4 pl-3 border-l border-white/15 space-y-0.5 py-1">
                    {EMAIL_CENTRE_SUBDEPARTMENTS.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => handleSelectNav('email_centre', sub.id)}
                        className={`w-full text-left px-2.5 py-1.5 rounded typo-nav transition-colors truncate ${
                          activeDept === 'email_centre' && activeSubId === sub.id
                            ? 'bg-[#1265C8] text-white font-semibold'
                            : 'text-blue-100/85 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              title={sidebarCollapsed ? 'Google Drive' : undefined}
              onClick={() => handleSelectNav('google_drive')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                activeDept === 'google_drive'
                  ? 'bg-[#1265C8] text-white'
                  : 'text-slate-100 hover:bg-white/10'
              }`}
            >
              <HardDrive className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed ? <span className="truncate">Google Drive</span> : null}
            </button>
          </>
        ) : null}

        <div className="pt-2 pb-1">
          {!sidebarCollapsed ? (
            <p className="px-3 typo-small text-blue-200/80 mb-1">
              {isSuperAdmin ? 'Administration Departments' : 'Assigned Department Workplace'}
            </p>
          ) : null}
        </div>

        {visibleDepartments.map((dept) => {
          const IconComponent = DEPT_ICONS[dept.iconName];
          const isDeptActive = activeDept === dept.id;
          const isExpanded = Boolean(
            !isSuperAdmin || expandedDepts[dept.id] || navSearch.trim()
          );

          return (
            <div key={dept.id} className="space-y-0.5">
              <button
                type="button"
                title={sidebarCollapsed ? dept.label : undefined}
                onClick={() => {
                  if (sidebarCollapsed) {
                    handleSelectNav(dept.id, dept.subdepartments[0]?.id);
                  } else if (isSuperAdmin) {
                    toggleDept(dept.id);
                  } else {
                    handleSelectNav(dept.id, dept.subdepartments[0]?.id);
                  }
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isDeptActive
                    ? 'bg-[#1265C8]/90 text-white'
                    : 'text-slate-100 hover:bg-white/10'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <IconComponent className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed ? <span className="truncate">{dept.label}</span> : null}
                </span>
                {!sidebarCollapsed && isSuperAdmin ? (
                  <ChevronDown
                    className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                ) : null}
              </button>

              {!sidebarCollapsed && isExpanded ? (
                <div className="ml-4 pl-3 border-l border-white/15 space-y-0.5 py-1">
                  {dept.subdepartments.map((sub) => {
                    const isSubActive =
                      isDeptActive && activeSubId === sub.id && workplaceTab === 'operations';
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => handleSelectNav(dept.id, sub.id)}
                        className={`w-full text-left px-2.5 py-1.5 rounded typo-nav transition-colors truncate ${
                          isSubActive
                            ? 'bg-[#1265C8] text-white font-semibold'
                            : 'text-blue-100/85 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {sub.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        {!isSuperAdmin && primaryDepartment ? (
          <div className="pt-3 border-t border-white/10 mt-3 space-y-1">
            {!sidebarCollapsed ? (
              <p className="px-3 typo-small text-blue-200/80 mb-1">
                Workplace Tools
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => {
                onSelectWorkplaceTab('notifications');
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                workplaceTab === 'notifications'
                  ? 'bg-[#1265C8] text-white'
                  : 'text-slate-100 hover:bg-white/10'
              }`}
            >
              <Bell className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed ? <span className="truncate">Notifications</span> : null}
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectWorkplaceTab('communication');
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                workplaceTab === 'communication'
                  ? 'bg-[#1265C8] text-white'
                  : 'text-slate-100 hover:bg-white/10'
              }`}
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed ? <span className="truncate">Messages</span> : null}
            </button>
            {canViewEmailCentre ? (
              <button
                type="button"
                onClick={() => handleSelectNav('email_centre', 'dashboard')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeDept === 'email_centre'
                    ? 'bg-[#1265C8] text-white'
                    : 'text-slate-100 hover:bg-white/10'
                }`}
              >
                <Mail className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed ? <span className="truncate">Email Centre</span> : null}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                onSelectWorkplaceTab('drive');
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                workplaceTab === 'drive'
                  ? 'bg-[#1265C8] text-white'
                  : 'text-slate-100 hover:bg-white/10'
              }`}
            >
              <HardDrive className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed ? <span className="truncate">Google Drive</span> : null}
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectWorkplaceTab('help');
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                workplaceTab === 'help'
                  ? 'bg-[#1265C8] text-white'
                  : 'text-slate-100 hover:bg-white/10'
              }`}
            >
              <HelpCircle className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed ? <span className="truncate">Help & Support</span> : null}
            </button>
          </div>
        ) : null}

        {isSuperAdmin ? (
          <div className="pt-3 border-t border-white/10 mt-3 space-y-1">
            <button
              type="button"
              title={sidebarCollapsed ? 'Support & Announcements' : undefined}
              onClick={() => handleSelectNav('support_announcements')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                activeDept === 'support_announcements'
                  ? 'bg-[#1265C8] text-white'
                  : 'text-slate-100 hover:bg-white/10'
              }`}
            >
              <Megaphone className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed ? <span className="truncate">Support & Notices</span> : null}
            </button>

            <button
              type="button"
              title={sidebarCollapsed ? 'System Status' : undefined}
              onClick={() => handleSelectNav('system_health')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                activeDept === 'system_health'
                  ? 'bg-[#1265C8] text-white'
                  : 'text-slate-100 hover:bg-white/10'
              }`}
            >
              <Activity className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed ? <span className="truncate">System Status</span> : null}
            </button>
          </div>
        ) : null}
      </nav>

      {/* Sidebar Account Footer */}
      <div className="p-3 border-t border-white/10 shrink-0">
        {!sidebarCollapsed ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                {adminProfile?.displayName}
              </p>
              <p className="text-[11px] text-blue-200 truncate">{roleLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              title="Secure Sign Out"
              aria-label="Secure Sign Out"
              className="p-2 rounded-md hover:bg-white/10 text-blue-200 hover:text-white transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void logout()}
            title="Secure Sign Out"
            aria-label="Secure Sign Out"
            className="w-full flex justify-center p-2 rounded-md hover:bg-white/10 text-blue-200 hover:text-white"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F3F6FA] flex">
      {/* Desktop Fixed Sidebar */}
      <aside
        className={`no-print hidden lg:block shrink-0 transition-all duration-150 ${
          sidebarCollapsed ? 'w-[72px]' : 'w-[272px]'
        }`}
      >
        <div
          className={`fixed top-0 left-0 bottom-0 z-30 transition-all duration-150 ${
            sidebarCollapsed ? 'w-[72px]' : 'w-[272px]'
          }`}
        >
          {sidebarContent}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[272px] h-full">{sidebarContent}</div>
          <div
            className="flex-1 bg-slate-900/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header */}
        <header className="no-print h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-md text-[#172B46] hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>

            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm min-w-0">
              {breadcrumbLabel.map((segment, index) => (
                <React.Fragment key={segment}>
                  {index > 0 ? <span className="text-[#75869D]">/</span> : null}
                  <span
                    className={`truncate ${
                      index === breadcrumbLabel.length - 1
                        ? 'font-semibold text-[#172B46]'
                        : 'text-[#75869D]'
                    }`}
                  >
                    {segment}
                  </span>
                </React.Fragment>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onOpenSearch}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[#75869D] bg-[#F3F6FA] hover:bg-[#E9F2FF] hover:text-[#1265C8] border border-slate-200 rounded-md transition-colors whitespace-nowrap"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Global Search</span>
              <span className="hidden md:inline font-mono text-[11px] text-[#75869D]">⌘K</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (activeDepartmentConfig) {
                  onSelectWorkplaceTab('communication');
                } else {
                  onNavigate('support_announcements');
                }
              }}
              aria-label="Messages"
              title="Messages & Internal Chat"
              className="p-2 rounded-md border border-slate-200 bg-white hover:bg-[#F3F6FA] text-[#172B46] transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((o) => !o);
                  setProfileMenuOpen(false);
                }}
                aria-label="Notification centre"
                className="relative p-2 rounded-md border border-slate-200 bg-white hover:bg-[#F3F6FA] text-[#172B46] transition-colors"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D34552] text-white typo-small tabular-nums font-semibold flex items-center justify-center">
                    {unreadCount}
                  </span>
                ) : null}
              </button>

              {notifOpen ? (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-lg z-40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                    <span className="typo-card-heading text-[#172B46]">
                      Notification Centre
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="typo-meta text-[#75869D] hover:text-[#172B46]"
                    >
                      Close
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <p className="p-4 typo-meta text-[#75869D] text-center">
                        No active notifications in Firestore.
                      </p>
                    ) : (
                      notifications.slice(0, 15).map((n) => (
                        <div
                          key={n.notificationId}
                          className={`p-3 typo-meta ${n.read ? 'bg-white' : 'bg-[#E9F2FF]/60'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-[#172B46]">{n.title}</p>
                            {!n.read ? (
                              <button
                                type="button"
                                onClick={() => void markNotificationRead(n.notificationId)}
                                className="typo-small text-[#1265C8] hover:underline shrink-0"
                              >
                                Mark read
                              </button>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[#75869D]">{n.message}</p>
                          <p className="mt-1 tabular-nums typo-small text-[#75869D]">
                            {new Date(n.createdAt).toLocaleString()}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Staff Avatar & Account Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen((o) => !o);
                  setNotifOpen(false);
                }}
                className="flex items-center gap-2 pl-2 pr-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-[#F3F6FA] transition-colors"
              >
                {adminProfile?.photoUrl ? (
                  <img
                    src={adminProfile.photoUrl}
                    alt={adminProfile.displayName}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full object-cover border border-slate-200"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-[#102B50] text-white text-xs font-semibold flex items-center justify-center">
                    {(adminProfile?.displayName || 'A').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="hidden md:block text-left max-w-[140px]">
                  <p className="text-xs font-semibold text-[#172B46] truncate leading-tight">
                    {adminProfile?.displayName}
                  </p>
                  <p className="text-[10px] text-[#75869D] truncate leading-tight">
                    {roleLabel}
                  </p>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-[#75869D]" />
              </button>

              {profileMenuOpen ? (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-40 py-1.5 text-xs">
                  <div className="px-3.5 py-2 border-b border-slate-100">
                    <p className="font-semibold text-[#172B46] truncate">
                      {adminProfile?.displayName}
                    </p>
                    <p className="text-[11px] text-[#75869D] truncate">{adminProfile?.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const targetDept = activeDepartmentConfig?.id || primaryDepartment || 'user_management';
                      handleSelectNav(targetDept, 'my_profile');
                      setProfileMenuOpen(false);
                    }}
                    className="w-full px-3.5 py-2 text-left text-[#172B46] hover:bg-[#F3F6FA] flex items-center gap-2"
                  >
                    <User className="w-3.5 h-3.5 text-[#75869D]" />
                    My Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeDepartmentConfig) {
                        if (activeDepartmentConfig.id === 'platform_settings') {
                          onSelectWorkplaceTab('account_security');
                        } else {
                          handleSelectNav(activeDepartmentConfig.id, 'settings');
                        }
                      } else if (primaryDepartment) {
                        handleSelectNav(primaryDepartment, 'settings');
                      } else {
                        onNavigate('platform_settings', 'general_settings');
                      }
                      setProfileMenuOpen(false);
                    }}
                    className="w-full px-3.5 py-2 text-left text-[#172B46] hover:bg-[#F3F6FA] flex items-center gap-2"
                  >
                    <Settings className="w-3.5 h-3.5 text-[#75869D]" />
                    Account Settings
                  </button>
                  {activeDepartmentConfig ? (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectWorkplaceTab('help');
                        setProfileMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2 text-left text-[#172B46] hover:bg-[#F3F6FA] flex items-center gap-2"
                    >
                      <HelpCircle className="w-3.5 h-3.5 text-[#75869D]" />
                      Help & Support
                    </button>
                  ) : null}
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void logout();
                    }}
                    className="w-full px-3.5 py-2 text-left text-[#D34552] hover:bg-red-50 flex items-center gap-2 font-medium"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {/* Workspace Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
