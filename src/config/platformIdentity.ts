export const OFFICIAL_PLATFORM_NAME = 'SWAS TASKS';
export const OFFICIAL_PLATFORM_EMAIL = 'swastaskorg@gmail.com';
export const OFFICIAL_SENDER_DISPLAY_NAME = 'SWAS TASKS';
export const OFFICIAL_REPLY_TO_EMAIL = 'swastaskorg@gmail.com';

export type EmailScope = 'public_website' | 'control_centre';

export interface EmailEventDefinition {
  id: string;
  scope: EmailScope;
  label: string;
  description: string;
  defaultSubject: string;
  defaultBody: string;
  defaultEnabled: boolean;
}

export const PUBLIC_EMAIL_NOTIFICATION_TYPES: EmailEventDefinition[] = [
  {
    id: 'client_registration',
    scope: 'public_website',
    label: 'Client Registration Notifications',
    description: 'Welcome and onboarding guidance sent to newly registered SWAS TASKS clients.',
    defaultSubject: 'Welcome to SWAS TASKS – Your Client Account Is Ready',
    defaultBody:
      'Your SWAS TASKS client profile has been created. You can now post tasks, review qualified worker bids, and manage milestones securely.',
    defaultEnabled: true,
  },
  {
    id: 'worker_registration',
    scope: 'public_website',
    label: 'Worker Registration Notifications',
    description: 'Onboarding confirmation and verification instructions for new platform workers.',
    defaultSubject: 'Welcome to SWAS TASKS – Complete Your Worker Profile',
    defaultBody:
      'Your SWAS TASKS worker registration has been received. Complete your profile verification to begin bidding on published client tasks.',
    defaultEnabled: true,
  },
  {
    id: 'account_verification',
    scope: 'public_website',
    label: 'Account Verification Emails',
    description: 'Verification confirmations and identity review updates for workers and clients.',
    defaultSubject: 'SWAS TASKS – Verify Your Account Email',
    defaultBody:
      'Please verify your email address to activate full SWAS TASKS marketplace features and protect your account.',
    defaultEnabled: true,
  },
  {
    id: 'password_reset',
    scope: 'public_website',
    label: 'Password Reset Emails',
    description: 'Security confirmation and recovery instructions for public user password resets.',
    defaultSubject: 'SWAS TASKS – Password Reset Instructions',
    defaultBody:
      'A password reset request was received for your SWAS TASKS account. If you did not initiate this request, contact swastaskorg@gmail.com immediately.',
    defaultEnabled: true,
  },
  {
    id: 'login_security',
    scope: 'public_website',
    label: 'Login Security Notifications',
    description: 'Alerts for unrecognized sign-ins, lockouts, or security changes on user accounts.',
    defaultSubject: 'SWAS TASKS Security Alert – New Sign-In Activity',
    defaultBody:
      'We detected new sign-in activity on your SWAS TASKS account. Review your account security settings if this activity looks unfamiliar.',
    defaultEnabled: true,
  },
  {
    id: 'task_notification',
    scope: 'public_website',
    label: 'Task Notifications',
    description: 'Task moderation approvals, publication updates, and deadline reminders.',
    defaultSubject: 'SWAS TASKS – Task Status Update',
    defaultBody:
      'There is a status update on your SWAS TASKS task listing. Sign in to your dashboard to inspect moderation notes and next steps.',
    defaultEnabled: true,
  },
  {
    id: 'bid_assignment',
    scope: 'public_website',
    label: 'Bid & Assignment Notifications',
    description: 'New bid alerts, bid acceptances, deliverable submissions, and dispute updates.',
    defaultSubject: 'SWAS TASKS – Bid & Assignment Update',
    defaultBody:
      'Your task bid or active assignment has received a new update on SWAS TASKS. Log in to review submissions or messages.',
    defaultEnabled: true,
  },
  {
    id: 'payment_notification',
    scope: 'public_website',
    label: 'Payment Notifications',
    description: 'Client escrow deposit receipts and verified KES transaction confirmations.',
    defaultSubject: 'SWAS TASKS – KES Payment Confirmation',
    defaultBody:
      'Your KES payment transaction has been recorded by SWAS TASKS Finance Control. Keep your transaction reference for your records.',
    defaultEnabled: true,
  },
  {
    id: 'withdrawal_notification',
    scope: 'public_website',
    label: 'Withdrawal Notifications',
    description: 'Worker KES withdrawal approval, payout completion, and rejection notices.',
    defaultSubject: 'SWAS TASKS – Withdrawal Request Update',
    defaultBody:
      'Your KES withdrawal request status has been updated by SWAS TASKS Finance Control.',
    defaultEnabled: true,
  },
  {
    id: 'customer_support',
    scope: 'public_website',
    label: 'Customer Support Communications',
    description: 'Support ticket acknowledgements and official responses from SWAS TASKS Support.',
    defaultSubject: 'SWAS TASKS Support – Update on Your Request',
    defaultBody:
      'Our support team has reviewed your inquiry. Reply directly to swastaskorg@gmail.com if you need additional assistance.',
    defaultEnabled: true,
  },
  {
    id: 'platform_announcement',
    scope: 'public_website',
    label: 'General Platform Announcements',
    description: 'Scheduled maintenance notices, policy updates, and platform-wide announcements.',
    defaultSubject: 'SWAS TASKS – Platform Announcement',
    defaultBody:
      'Please review the latest platform announcement from the SWAS TASKS administration team.',
    defaultEnabled: true,
  },
];

export const CONTROL_CENTRE_EMAIL_NOTIFICATION_TYPES: EmailEventDefinition[] = [
  {
    id: 'staff_invitation',
    scope: 'control_centre',
    label: 'Department Staff Invitations',
    description: 'Single-use, department-locked staff invitation links sent by the Super Admin.',
    defaultSubject: 'SWAS TASKS Central Control Centre – Staff Invitation',
    defaultBody:
      'You have been invited by the Super Administrator to activate your department workplace in the SWAS TASKS Central Control Centre.',
    defaultEnabled: true,
  },
  {
    id: 'staff_registration',
    scope: 'control_centre',
    label: 'Staff Registration Notifications',
    description: 'Confirmation dispatched when an invited staff member completes verification and activates.',
    defaultSubject: 'SWAS TASKS Central Control Centre – Workplace Activated',
    defaultBody:
      'Your SWAS TASKS Central Control Centre staff account is now verified and active for your assigned department.',
    defaultEnabled: true,
  },
  {
    id: 'admin_notification',
    scope: 'control_centre',
    label: 'Administrator Notifications',
    description: 'Operational escalations and governance notices sent to authorized administrators.',
    defaultSubject: 'SWAS TASKS Control Centre – Administrator Notice',
    defaultBody:
      'An administrative action or governance item requires your review in the SWAS TASKS Central Control Centre.',
    defaultEnabled: true,
  },
  {
    id: 'security_alert',
    scope: 'control_centre',
    label: 'Security Alerts',
    description: 'High-priority security events, repeated failed login lockouts, and RBAC alerts.',
    defaultSubject: 'SWAS TASKS Security Alert – Immediate Review Required',
    defaultBody:
      'The SWAS TASKS Central Control Centre logged a security event that requires administrator verification.',
    defaultEnabled: true,
  },
  {
    id: 'admin_account_verification',
    scope: 'control_centre',
    label: 'Account Verification Emails',
    description: 'Staff email verification guidance and account status verification notices.',
    defaultSubject: 'SWAS TASKS Control Centre – Verify Staff Email',
    defaultBody:
      'Verify your staff email address to confirm eligibility for SWAS TASKS Central Control Centre access.',
    defaultEnabled: true,
  },
  {
    id: 'admin_password_reset',
    scope: 'control_centre',
    label: 'Password Reset Emails',
    description: 'Administrator and staff password reset notices and recovery confirmations.',
    defaultSubject: 'SWAS TASKS Control Centre – Password Reset Notice',
    defaultBody:
      'A password reset was requested for your SWAS TASKS Central Control Centre account. Contact swastaskorg@gmail.com if unauthorized.',
    defaultEnabled: true,
  },
  {
    id: 'login_alert',
    scope: 'control_centre',
    label: 'Login Alerts',
    description: 'Staff sign-in alerts, revoked-session notices, and suspicious IP/origin warnings.',
    defaultSubject: 'SWAS TASKS Control Centre – Staff Sign-In Alert',
    defaultBody:
      'A sign-in or session governance event was recorded on your SWAS TASKS Central Control Centre account.',
    defaultEnabled: true,
  },
  {
    id: 'department_notification',
    scope: 'control_centre',
    label: 'Department Notifications',
    description: 'Department-specific escalations for moderation, disputes, payouts, and API incidents.',
    defaultSubject: 'SWAS TASKS Department Alert – Action Required',
    defaultBody:
      'Your assigned SWAS TASKS department workplace has an item awaiting review.',
    defaultEnabled: true,
  },
  {
    id: 'system_announcement',
    scope: 'control_centre',
    label: 'Important System Announcements',
    description: 'Internal infrastructure, maintenance, and policy notices sent to Control Centre staff.',
    defaultSubject: 'SWAS TASKS Control Centre – Important System Announcement',
    defaultBody:
      'An important system announcement has been issued by the SWAS TASKS Super Administrator.',
    defaultEnabled: true,
  },
  {
    id: 'admin_communication',
    scope: 'control_centre',
    label: 'Administrative Communications',
    description: 'Direct administrative emails sent from the SWAS TASKS Central Control Centre.',
    defaultSubject: 'SWAS TASKS – Official Administrative Communication',
    defaultBody:
      'Official administrative message from the SWAS TASKS Central Control Centre (swastaskorg@gmail.com).',
    defaultEnabled: true,
  },
];

export const ALL_EMAIL_NOTIFICATION_TYPES: EmailEventDefinition[] = [
  ...PUBLIC_EMAIL_NOTIFICATION_TYPES,
  ...CONTROL_CENTRE_EMAIL_NOTIFICATION_TYPES,
];
