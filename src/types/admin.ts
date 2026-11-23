export type EightDepartmentId =
  | 'user_management'
  | 'client_management'
  | 'task_monitoring'
  | 'bids_assignments'
  | 'finance_control'
  | 'api_management'
  | 'activity_logs'
  | 'platform_settings';

export type DepartmentId =
  | 'overview'
  | 'staff_management'
  | EightDepartmentId
  | 'system_health'
  | 'support_announcements';

export type AdminRoleId =
  | 'SUPER_ADMIN'
  | 'USER_MANAGEMENT_ADMIN'
  | 'CLIENT_MANAGEMENT_ADMIN'
  | 'TASK_MODERATOR'
  | 'WORKFORCE_OPERATIONS_ADMIN'
  | 'FINANCE_ADMIN'
  | 'API_ADMINISTRATOR'
  | 'AUDIT_ADMINISTRATOR'
  | 'PLATFORM_CONFIGURATION_ADMIN'
  | (string & {});

export type AdminAction =
  | 'view'
  | 'read'
  | 'create'
  | 'edit'
  | 'update'
  | 'approve'
  | 'reject'
  | 'suspend'
  | 'revoke'
  | 'export'
  | 'manage';

export interface AdminUser {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  primaryDepartment?: 'all' | EightDepartmentId;
  role: AdminRoleId;
  status: 'active' | 'suspended' | 'deactivated' | 'revoked';
  departments: DepartmentId[];
  actions: AdminAction[];
  invitationId?: string;
  sessionRevokedAt?: string;
  lastLoginAt?: string;
  mfaEnabled?: boolean;
  failedAttempts?: number;
  lockedUntil?: string;
  photoUrl?: string;
  notificationPrefs?: {
    emailAlerts?: boolean;
    securityAlerts?: boolean;
    departmentMentions?: boolean;
    dailyDigest?: boolean;
  };
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface StaffInvitation {
  invitationId: string;
  tokenHash: string;
  fullName: string;
  email: string;
  phone: string;
  department: EightDepartmentId;
  departmentRole: string;
  permissions: AdminAction[];
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: string;
  emailDeliveryStatus?: 'sent' | 'not_configured' | 'failed';
  acceptedByUid?: string;
  acceptedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentMessage {
  messageId: string;
  department: EightDepartmentId;
  senderUid: string;
  senderName: string;
  senderRole?: string;
  body: string;
  createdAt: string;
}

export interface StaffLoginHistory {
  loginId: string;
  uid?: string;
  email: string;
  department?: string;
  outcome: 'success' | 'denied' | 'locked' | 'session_revoked';
  detail?: string;
  createdAt: string;
}

export interface MessagingStatus {
  emailConfigured: boolean;
  emailProvider: string;
  emailProviderType?: 'gmail_smtp' | 'smtp' | 'resend' | 'none';
  emailStatusLabel?: string;
  officialEmail?: string;
  senderDisplayName?: string;
  replyToEmail?: string;
  smsConfigured: boolean;
  smsProvider: string;
}

export interface EmailVerificationStatus {
  officialEmail: string;
  domain: string;
  providerConnected: boolean;
  providerType: string;
  providerName: string;
  spfStatus: 'verified' | 'missing' | 'unknown';
  spfRecord: string;
  dmarcStatus: 'verified' | 'missing' | 'unknown';
  dmarcRecord: string;
  dkimStatus: 'managed_by_gmail' | 'selector_required' | 'unknown';
  dkimNote: string;
  checkedAt: string;
}

export interface EmailLogRecord {
  emailLogId: string;
  scope: 'public_website' | 'control_centre';
  eventType: string;
  recipientEmail: string;
  subject: string;
  bodyPreview?: string;
  fromAddress: string;
  replyToAddress: string;
  provider: string;
  providerMessageId?: string;
  status: 'sent' | 'failed' | 'not_configured';
  errorDetail?: string;
  retryCount?: number;
  triggeredByUid?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserAccount {
  uid: string;
  email: string;
  fullName: string;
  phone?: string;
  accountType: 'worker' | 'client' | 'hybrid';
  status: 'pending' | 'active' | 'suspended' | 'banned' | 'recovery_requested';
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected';
  role?: string;
  skills?: string[];
  reportCount?: number;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientAccount {
  clientId: string;
  ownerUid: string;
  name: string;
  companyName?: string;
  email: string;
  accountTier: 'individual' | 'business' | 'enterprise';
  status: 'pending' | 'active' | 'restricted' | 'suspended';
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected';
  totalProjects?: number;
  openComplaints?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  taskId: string;
  clientId: string;
  clientName?: string;
  title: string;
  description?: string;
  category: string;
  budgetKes: number;
  status: 'pending' | 'published' | 'active' | 'completed' | 'rejected' | 'reported' | 'removed';
  deadline?: string;
  reportReason?: string;
  moderationNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCategory {
  categoryId: string;
  name: string;
  slug: string;
  description?: string;
  active: boolean;
  minBudgetKes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BidRecord {
  bidId: string;
  taskId: string;
  taskTitle?: string;
  workerUid: string;
  workerName?: string;
  clientId: string;
  amountKes: number;
  proposal?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentRecord {
  assignmentId: string;
  taskId: string;
  taskTitle?: string;
  bidId?: string;
  workerUid: string;
  workerName?: string;
  clientId: string;
  agreedAmountKes: number;
  status:
    | 'active'
    | 'submitted'
    | 'revision_requested'
    | 'approved'
    | 'completed'
    | 'disputed'
    | 'cancelled';
  deadline?: string;
  submissionUrl?: string;
  disputeReason?: string;
  adminResolutionNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkSubmission {
  submissionId: string;
  assignmentId: string;
  taskId: string;
  taskTitle?: string;
  workerUid: string;
  workerName?: string;
  clientId: string;
  summary?: string;
  deliverableUrl?: string;
  revisionCount?: number;
  status: 'submitted' | 'revision_requested' | 'approved' | 'rejected';
  reviewerNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DisputeRecord {
  disputeId: string;
  assignmentId: string;
  taskId: string;
  taskTitle?: string;
  openedByUid: string;
  openedByRole: 'client' | 'worker';
  againstUid?: string;
  reason: string;
  evidenceUrl?: string;
  status: 'open' | 'under_review' | 'resolved_client' | 'resolved_worker' | 'dismissed';
  resolutionNote?: string;
  resolvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentGatewayStatus {
  mpesaConfigured: boolean;
  mpesaEnvironment: string;
  mpesaProvider: string;
  currency: string;
}

export interface WalletRecord {
  walletId: string;
  ownerUid: string;
  ownerName?: string;
  currency: 'KES';
  availableBalanceKes: number;
  pendingEscrowKes: number;
  totalEarnedKes: number;
  updatedAt: string;
}

export interface TransactionRecord {
  transactionId: string;
  userId: string;
  type:
    | 'client_payment'
    | 'deposit'
    | 'escrow_release'
    | 'platform_fee'
    | 'withdrawal_payout'
    | 'refund';
  amountKes: number;
  platformFeeKes?: number;
  currency: 'KES';
  provider?: string;
  providerRef?: string;
  status: 'pending' | 'verified' | 'failed' | 'reversed';
  reconciled?: boolean;
  createdAt: string;
}

export interface WithdrawalRequest {
  withdrawalId: string;
  workerUid: string;
  workerName?: string;
  amountKes: number;
  currency: 'KES';
  destinationType: 'mpesa' | 'bank';
  destinationMasked?: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  reviewedBy?: string;
  reviewNote?: string;
  idempotencyKey?: string;
  providerRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord {
  keyId: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
  status: 'active' | 'inactive' | 'revoked' | 'expired';
  rateLimitPerMin: number;
  expiresAt?: string;
  lastUsedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectedApp {
  appId: string;
  name: string;
  websiteUrl: string;
  apiBaseUrl?: string;
  allowedOrigins: string[];
  status: 'connected' | 'paused' | 'error';
  lastSuccessAt?: string;
  lastFailureAt?: string;
  updatedAt: string;
}

export interface WebhookConfig {
  webhookId: string;
  url: string;
  events: string[];
  active: boolean;
  secretHint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiLogRecord {
  logId: string;
  method: string;
  path: string;
  statusCode: number;
  keyId?: string;
  origin?: string;
  durationMs?: number;
  correlationId?: string;
  createdAt: string;
}

export interface ActivityLog {
  eventId: string;
  category:
    | 'system'
    | 'admin'
    | 'user'
    | 'worker'
    | 'client'
    | 'login'
    | 'security'
    | 'api'
    | 'financial'
    | 'account_change';
  actorId: string;
  actorEmail?: string;
  actorRole: string;
  action: string;
  affectedRecord: string;
  result: 'success' | 'denied' | 'failed';
  correlationId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface SecurityEvent {
  eventId: string;
  severity: 'info' | 'warning' | 'critical';
  eventType: string;
  actorEmail?: string;
  detail: string;
  resolved?: boolean;
  createdAt: string;
}

export interface PlatformSetting {
  sectionId: string;
  platformName?: string;
  tagline?: string;
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  maintenanceMode?: boolean;
  platformFeePercent?: number;
  minWithdrawalKes?: number;
  allowWorkerRegistration?: boolean;
  allowClientRegistration?: boolean;
  requireTaskModeration?: boolean;
  termsText?: string;
  privacyText?: string;
  officialEmail?: string;
  senderDisplayName?: string;
  replyToEmail?: string;
  config?: Record<string, unknown>;
  updatedBy?: string;
  updatedAt: string;
}

export interface Announcement {
  announcementId: string;
  title: string;
  body: string;
  audience: 'all' | 'workers' | 'clients' | 'admins';
  active: boolean;
  createdBy: string;
  createdAt: string;
}

export interface SupportTicket {
  ticketId: string;
  requesterUid?: string;
  requesterType: 'client' | 'worker';
  requesterName?: string;
  subject: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  assignedAdmin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminNotification {
  notificationId: string;
  type:
    | 'user_registration'
    | 'client_registration'
    | 'new_task'
    | 'reported_account'
    | 'dispute'
    | 'withdrawal'
    | 'failed_payment'
    | 'api_failure'
    | 'security_alert'
    | 'system_error'
    | 'staff_invitation';
  department?: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}
