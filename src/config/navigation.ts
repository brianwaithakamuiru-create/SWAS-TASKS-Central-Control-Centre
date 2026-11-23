import type { AdminAction, AdminRoleId, DepartmentId, EightDepartmentId } from '../types/admin';

export interface SubDepartmentItem {
  id: string;
  label: string;
}

export interface DepartmentNavConfig {
  id: EightDepartmentId;
  label: string;
  workplaceTitle: string;
  workplaceDescription: string;
  iconName:
    | 'Users'
    | 'Building2'
    | 'ClipboardList'
    | 'Briefcase'
    | 'Wallet'
    | 'KeyRound'
    | 'ShieldAlert'
    | 'Settings';
  subdepartments: SubDepartmentItem[];
}

export const STAFF_MANAGEMENT_SUBDEPARTMENTS: SubDepartmentItem[] = [
  { id: 'all_staff', label: 'All Staff' },
  { id: 'invite_staff', label: 'Invite Staff' },
  { id: 'department_assignments', label: 'Department Assignments' },
  { id: 'pending_invitations', label: 'Pending Invitations' },
  { id: 'active_staff', label: 'Active Staff' },
  { id: 'suspended_staff', label: 'Suspended Staff' },
  { id: 'deactivated_staff', label: 'Deactivated Staff' },
  { id: 'staff_roles', label: 'Staff Roles' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'login_history', label: 'Login History' },
  { id: 'staff_activity_logs', label: 'Staff Activity Logs' },
];

export const GRANULAR_PERMISSIONS: { id: AdminAction; label: string; description: string }[] = [
  { id: 'view', label: 'View', description: 'Inspect records and read department dashboards' },
  { id: 'create', label: 'Create', description: 'Create new records, categories, or credentials' },
  { id: 'edit', label: 'Edit', description: 'Modify existing records and settings' },
  { id: 'approve', label: 'Approve', description: 'Approve verifications, tasks, submissions, or payouts' },
  { id: 'reject', label: 'Reject', description: 'Reject non-compliant submissions or requests' },
  { id: 'suspend', label: 'Suspend', description: 'Suspend or restrict accounts under policy' },
  { id: 'revoke', label: 'Revoke', description: 'Revoke credentials, sessions, or access' },
  { id: 'export', label: 'Export', description: 'Export financial or audit reports' },
  { id: 'manage', label: 'Manage', description: 'Full operational management within assigned department' },
];

export const DEPARTMENT_ROLE_PRESETS: Record<EightDepartmentId, string[]> = {
  user_management: ['User Operations Officer', 'Verification Specialist', 'Trust & Safety Reviewer', 'User Management Admin'],
  client_management: ['Client Onboarding Officer', 'Enterprise Client Manager', 'Client Support Lead', 'Client Management Admin'],
  task_monitoring: ['Task Quality Moderator', 'Category Curator', 'Policy Compliance Reviewer', 'Task Moderator'],
  bids_assignments: ['Workforce Operations Coordinator', 'Dispute Resolution Officer', 'Submission Auditor', 'Workforce Operations Admin'],
  finance_control: ['Finance Analyst', 'Withdrawal Review Officer', 'Reconciliation Specialist', 'Finance Admin'],
  api_management: ['Integration Engineer', 'Webhook Operator', 'API Security Specialist', 'API Administrator'],
  activity_logs: ['Compliance Auditor', 'Security Analyst', 'Audit Trail Reviewer', 'Audit Administrator'],
  platform_settings: ['Platform Operations Specialist', 'Policy & Legal Editor', 'Configuration Lead', 'Platform Configuration Admin'],
};

export const EIGHT_DEPARTMENTS: DepartmentNavConfig[] = [
  {
    id: 'user_management',
    label: 'User Management',
    workplaceTitle: 'User Accounts & Security Workplace',
    workplaceDescription: 'Dedicated staff workspace for worker onboarding, identity verification, account recovery, and standing.',
    iconName: 'Users',
    subdepartments: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'all_users', label: 'All Users' },
      { id: 'worker_accounts', label: 'Worker Accounts' },
      { id: 'user_verification', label: 'User Verification' },
      { id: 'account_approvals', label: 'Account Approvals' },
      { id: 'suspended_accounts', label: 'Suspended Accounts' },
      { id: 'banned_accounts', label: 'Banned Accounts' },
      { id: 'user_roles_permissions', label: 'User Roles & Permissions' },
      { id: 'login_security', label: 'Login & Security' },
      { id: 'user_reports', label: 'User Reports' },
      { id: 'account_recovery', label: 'Account Recovery' },
      { id: 'activity_history', label: 'Activity History' },
      { id: 'my_profile', label: 'My Profile' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'client_management',
    label: 'Client Management',
    workplaceTitle: 'Client Profiles & Approvals Workplace',
    workplaceDescription: 'Dedicated staff workspace for client verifications, business accounts, support tickets, and complaints.',
    iconName: 'Building2',
    subdepartments: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'all_clients', label: 'All Clients' },
      { id: 'client_profiles', label: 'Client Profiles' },
      { id: 'business_accounts', label: 'Business Accounts' },
      { id: 'client_verification', label: 'Client Verification' },
      { id: 'client_approvals', label: 'Client Approvals' },
      { id: 'client_activity', label: 'Client Activity' },
      { id: 'client_projects', label: 'Client Projects' },
      { id: 'client_complaints', label: 'Client Complaints' },
      { id: 'client_support', label: 'Client Support' },
      { id: 'client_restrictions', label: 'Client Restrictions' },
      { id: 'client_reports', label: 'Client Reports' },
      { id: 'my_profile', label: 'My Profile' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'task_monitoring',
    label: 'Task Monitoring',
    workplaceTitle: 'Task Review & Moderation Workplace',
    workplaceDescription: 'Dedicated staff workspace for reviewing pending tasks, category curation, reports, and deadline monitoring.',
    iconName: 'ClipboardList',
    subdepartments: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'all_tasks', label: 'All Tasks' },
      { id: 'published_tasks', label: 'Published Tasks' },
      { id: 'pending_tasks', label: 'Pending Tasks' },
      { id: 'active_tasks', label: 'Active Tasks' },
      { id: 'completed_tasks', label: 'Completed Tasks' },
      { id: 'rejected_tasks', label: 'Rejected Tasks' },
      { id: 'reported_tasks', label: 'Reported Tasks' },
      { id: 'task_categories', label: 'Task Categories' },
      { id: 'task_moderation', label: 'Task Moderation' },
      { id: 'task_deadlines', label: 'Task Deadlines' },
      { id: 'task_reports', label: 'Task Reports' },
      { id: 'my_profile', label: 'My Profile' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'bids_assignments',
    label: 'Bids & Assignments',
    workplaceTitle: 'Bids, Submissions & Disputes Workplace',
    workplaceDescription: 'Dedicated staff workspace for active assignments, deliverable approvals, revisions, and dispute resolution.',
    iconName: 'Briefcase',
    subdepartments: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'all_bids', label: 'All Bids' },
      { id: 'pending_bids', label: 'Pending Bids' },
      { id: 'accepted_bids', label: 'Accepted Bids' },
      { id: 'rejected_bids', label: 'Rejected Bids' },
      { id: 'withdrawn_bids', label: 'Withdrawn Bids' },
      { id: 'assignment_management', label: 'Assignment Management' },
      { id: 'active_assignments', label: 'Active Assignments' },
      { id: 'work_submissions', label: 'Work Submissions' },
      { id: 'revision_requests', label: 'Revision Requests' },
      { id: 'assignment_approvals', label: 'Assignment Approvals' },
      { id: 'dispute_management', label: 'Dispute Management' },
      { id: 'worker_performance', label: 'Worker Performance' },
      { id: 'reports', label: 'Reports' },
      { id: 'my_profile', label: 'My Profile' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'finance_control',
    label: 'Finance Control',
    workplaceTitle: 'Payments & Withdrawals Workplace',
    workplaceDescription: 'Dedicated staff workspace for KES wallets, verified payments, worker payouts, and financial reconciliation.',
    iconName: 'Wallet',
    subdepartments: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'financial_overview', label: 'Financial Overview' },
      { id: 'worker_wallets', label: 'Worker Wallets' },
      { id: 'client_payments', label: 'Client Payments' },
      { id: 'deposits', label: 'Deposits' },
      { id: 'transactions', label: 'Transactions' },
      { id: 'withdrawal_requests', label: 'Withdrawal Requests' },
      { id: 'pending_withdrawals', label: 'Pending Withdrawals' },
      { id: 'approved_withdrawals', label: 'Approved Withdrawals' },
      { id: 'rejected_withdrawals', label: 'Rejected Withdrawals' },
      { id: 'platform_earnings', label: 'Platform Earnings' },
      { id: 'payment_gateway', label: 'Payment Gateway' },
      { id: 'reconciliation', label: 'Reconciliation' },
      { id: 'financial_reports', label: 'Financial Reports' },
      { id: 'my_profile', label: 'My Profile' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'api_management',
    label: 'API Management',
    workplaceTitle: 'API Keys & Integrations Workplace',
    workplaceDescription: 'Dedicated staff workspace for connected websites, cryptographic keys, webhooks, and request telemetry.',
    iconName: 'KeyRound',
    subdepartments: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'api_overview', label: 'API Overview' },
      { id: 'api_keys', label: 'API Keys' },
      { id: 'create_api_key', label: 'Create API Key' },
      { id: 'api_permissions', label: 'API Permissions' },
      { id: 'connected_websites', label: 'Connected Websites' },
      { id: 'api_requests', label: 'API Requests' },
      { id: 'api_logs', label: 'API Logs' },
      { id: 'failed_requests', label: 'Failed Requests' },
      { id: 'rate_limits', label: 'Rate Limits' },
      { id: 'webhooks', label: 'Webhooks' },
      { id: 'api_security', label: 'API Security' },
      { id: 'key_rotation', label: 'Key Rotation' },
      { id: 'api_documentation', label: 'API Documentation' },
      { id: 'my_profile', label: 'My Profile' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'activity_logs',
    label: 'Activity Logs',
    workplaceTitle: 'Monitoring & Audit Records Workplace',
    workplaceDescription: 'Dedicated staff workspace for immutable audit trails, security alerts, and compliance exports.',
    iconName: 'ShieldAlert',
    subdepartments: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'system_activity', label: 'System Activity' },
      { id: 'admin_activity', label: 'Admin Activity' },
      { id: 'user_activity', label: 'User Activity' },
      { id: 'worker_activity', label: 'Worker Activity' },
      { id: 'client_activity', label: 'Client Activity' },
      { id: 'login_history', label: 'Login History' },
      { id: 'security_logs', label: 'Security Logs' },
      { id: 'api_activity', label: 'API Activity' },
      { id: 'financial_activity', label: 'Financial Activity' },
      { id: 'account_changes', label: 'Account Changes' },
      { id: 'audit_trail', label: 'Audit Trail' },
      { id: 'export_reports', label: 'Export Reports' },
      { id: 'my_profile', label: 'My Profile' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'platform_settings',
    label: 'Platform Settings',
    workplaceTitle: 'Platform Configuration Workplace',
    workplaceDescription: 'Dedicated staff workspace for website branding, commission rules, maintenance mode, and legal policies.',
    iconName: 'Settings',
    subdepartments: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'general_settings', label: 'General Settings' },
      { id: 'website_branding', label: 'Website Branding' },
      { id: 'homepage_settings', label: 'Homepage Settings' },
      { id: 'navigation_settings', label: 'Navigation Settings' },
      { id: 'user_registration', label: 'User Registration' },
      { id: 'worker_settings', label: 'Worker Settings' },
      { id: 'client_settings', label: 'Client Settings' },
      { id: 'task_settings', label: 'Task Settings' },
      { id: 'finance_settings', label: 'Finance Settings' },
      { id: 'notification_settings', label: 'Notification Settings' },
      { id: 'email_configuration', label: 'Email Configuration' },
      { id: 'security_settings', label: 'Security Settings' },
      { id: 'maintenance_mode', label: 'Maintenance Mode' },
      { id: 'terms_conditions', label: 'Terms & Conditions' },
      { id: 'privacy_policy', label: 'Privacy Policy' },
      { id: 'backup_recovery', label: 'Backup & Recovery' },
      { id: 'my_profile', label: 'My Profile' },
    ],
  },
];

export interface RoleDefinition {
  id: AdminRoleId;
  label: string;
  description: string;
  departments: DepartmentId[];
  actions: AdminAction[];
}

export const ROLE_DEFINITIONS: Record<string, RoleDefinition> = {
  SUPER_ADMIN: {
    id: 'SUPER_ADMIN',
    label: 'Super Administrator',
    description: 'Full control across all 8 departments, staff invitations, role governance, API keys, and platform settings.',
    departments: [
      'staff_management',
      'user_management',
      'client_management',
      'task_monitoring',
      'bids_assignments',
      'finance_control',
      'api_management',
      'activity_logs',
      'platform_settings',
    ],
    actions: ['view', 'create', 'edit', 'approve', 'reject', 'suspend', 'revoke', 'export', 'manage'],
  },
  USER_MANAGEMENT_ADMIN: {
    id: 'USER_MANAGEMENT_ADMIN',
    label: 'User Management Admin',
    description: 'Manage registered worker & user accounts, verification, suspensions, and recovery.',
    departments: ['user_management'],
    actions: ['view', 'create', 'edit', 'approve', 'reject', 'suspend'],
  },
  CLIENT_MANAGEMENT_ADMIN: {
    id: 'CLIENT_MANAGEMENT_ADMIN',
    label: 'Client Management Admin',
    description: 'Manage client profiles, business verifications, complaints, and support cases.',
    departments: ['client_management'],
    actions: ['view', 'create', 'edit', 'approve', 'reject', 'suspend'],
  },
  TASK_MODERATOR: {
    id: 'TASK_MODERATOR',
    label: 'Task Moderator',
    description: 'Monitor tasks, enforce moderation policies, manage categories, and review reports.',
    departments: ['task_monitoring'],
    actions: ['view', 'edit', 'approve', 'reject', 'suspend'],
  },
  WORKFORCE_OPERATIONS_ADMIN: {
    id: 'WORKFORCE_OPERATIONS_ADMIN',
    label: 'Workforce Operations Admin',
    description: 'Oversee bids, assignments, work submissions, revisions, and dispute resolution.',
    departments: ['bids_assignments'],
    actions: ['view', 'edit', 'approve', 'reject'],
  },
  FINANCE_ADMIN: {
    id: 'FINANCE_ADMIN',
    label: 'Finance Admin',
    description: 'Review verified KES transactions, wallets, withdrawals, and financial reconciliation.',
    departments: ['finance_control'],
    actions: ['view', 'edit', 'approve', 'reject', 'export'],
  },
  API_ADMINISTRATOR: {
    id: 'API_ADMINISTRATOR',
    label: 'API Administrator',
    description: 'Issue, rotate, and revoke API credentials, manage connected websites, and monitor API telemetry.',
    departments: ['api_management'],
    actions: ['view', 'create', 'edit', 'revoke'],
  },
  AUDIT_ADMINISTRATOR: {
    id: 'AUDIT_ADMINISTRATOR',
    label: 'Audit Administrator',
    description: 'Inspect immutable activity logs, security events, login history, and export audit reports.',
    departments: ['activity_logs'],
    actions: ['view', 'export'],
  },
  PLATFORM_CONFIGURATION_ADMIN: {
    id: 'PLATFORM_CONFIGURATION_ADMIN',
    label: 'Platform Configuration Admin',
    description: 'Configure branding, fees, registration rules, maintenance mode, and legal policies.',
    departments: ['platform_settings'],
    actions: ['view', 'edit'],
  },
};
