export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'SWAS TASKS – Central Control Centre API',
    version: '1.0.0',
    description:
      'Private central administration REST API connecting the SWAS TASKS public website and Central Control Centre to Cloud Firestore.',
  },
  servers: [
    {
      url: '/api/v1',
      description: 'Central Control Centre API v1',
    },
  ],
  components: {
    securitySchemes: {
      FirebaseBearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Firebase ID Token (JWT)',
        description: 'Authenticated administrator Firebase ID token verified on the Express server.',
      },
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Cryptographic API key issued for server-to-server integration.',
      },
    },
  },
  paths: {
    '/platform/status': {
      get: {
        tags: ['System'],
        summary: 'Get real-time backend API and Firebase connectivity status',
        responses: {
          '200': { description: 'Backend and Firestore status verified' },
        },
      },
    },
    '/config/public': {
      get: {
        tags: ['Public Integration'],
        summary: 'Get public website configuration from Firestore platform_settings/public',
        responses: {
          '200': { description: 'Public branding, registration rules, maintenance status, and policies' },
        },
      },
    },
    '/admin/me': {
      get: {
        tags: ['Auth & RBAC'],
        summary: 'Verify administrator token and fetch RBAC role & permissions',
        security: [{ FirebaseBearerAuth: [] }],
        responses: {
          '200': { description: 'Authorized administrator profile' },
          '401': { description: 'Missing or invalid Firebase ID token' },
          '403': { description: 'Account not authorized for administration' },
        },
      },
    },
    '/admin/overview': {
      get: {
        tags: ['Dashboard'],
        summary: 'Compute live platform overview metrics from Firestore collections',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Aggregated platform metrics' } },
      },
    },
    '/admin/users': {
      get: {
        tags: ['User Management'],
        summary: 'List registered user and worker accounts',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Array of user records' } },
      },
    },
    '/admin/users/{id}/suspend': {
      post: {
        tags: ['User Management'],
        summary: 'Suspend a user account and append an immutable audit log',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'User account suspended' } },
      },
    },
    '/admin/users/{id}/activate': {
      post: {
        tags: ['User Management'],
        summary: 'Reactivate a suspended user account and append an immutable audit log',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'User account activated' } },
      },
    },
    '/admin/clients': {
      get: {
        tags: ['Client Management'],
        summary: 'List client accounts and business profiles',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Array of client records' } },
      },
    },
    '/admin/tasks': {
      get: {
        tags: ['Task Monitoring'],
        summary: 'List tasks posted on the platform',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Array of task records' } },
      },
    },
    '/admin/bids': {
      get: {
        tags: ['Bids & Assignments'],
        summary: 'List worker bids submitted on tasks',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Array of bid records' } },
      },
    },
    '/admin/assignments': {
      get: {
        tags: ['Bids & Assignments'],
        summary: 'List active, submitted, completed, and disputed assignments',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Array of assignment records' } },
      },
    },
    '/admin/transactions': {
      get: {
        tags: ['Finance Control'],
        summary: 'List KES financial transactions',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Array of transaction records in KES' } },
      },
    },
    '/admin/withdrawals': {
      get: {
        tags: ['Finance Control'],
        summary: 'List worker withdrawal requests in KES',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Array of withdrawal records' } },
      },
    },
    '/admin/activity-logs': {
      get: {
        tags: ['Activity Logs'],
        summary: 'List immutable audit logs',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Array of activity log entries' } },
      },
    },
    '/admin/announcements': {
      post: {
        tags: ['Global'],
        summary: 'Publish an administrative announcement to Firestore',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '201': { description: 'Announcement published' } },
      },
    },
    '/admin/api-keys/generate': {
      post: {
        tags: ['API Management'],
        summary: 'Generate a cryptographic API key (plaintext returned once, SHA-256 HMAC stored)',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '201': { description: 'API key generated' } },
      },
    },
    '/admin/api-keys/{id}/rotate': {
      post: {
        tags: ['API Management'],
        summary: 'Rotate an API key secret hash and return the new key once',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'API key rotated' } },
      },
    },
    '/system/messaging-status': {
      get: {
        tags: ['System'],
        summary: 'Inspect whether external Email and SMS verification providers are configured',
        responses: { '200': { description: 'Messaging configuration status (without secrets)' } },
      },
    },
    '/invitations/validate': {
      get: {
        tags: ['Staff Onboarding'],
        summary: 'Validate a single-use cryptographic staff invitation token',
        parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Invitation valid and locked department metadata returned' },
          '400': { description: 'Missing or invalid token' },
          '410': { description: 'Invitation expired, already accepted, or revoked' },
        },
      },
    },
    '/invitations/accept': {
      post: {
        tags: ['Staff Onboarding'],
        summary: 'Complete invitation-only staff registration after Firebase Email Verification',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '201': { description: 'Staff workplace account activated' } },
      },
    },
    '/admin/invitations': {
      post: {
        tags: ['Staff Management'],
        summary: 'Issue a single-use, department-locked staff invitation (Super Admin / Staff Manager)',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '201': { description: 'Invitation created and single-use URL issued' } },
      },
    },
    '/admin/invitations/{id}/resend': {
      post: {
        tags: ['Staff Management'],
        summary: 'Revoke previous invitation token and issue a fresh single-use invitation',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Replacement invitation issued' } },
      },
    },
    '/admin/invitations/{id}/revoke': {
      post: {
        tags: ['Staff Management'],
        summary: 'Permanently revoke a pending staff invitation',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Invitation revoked' } },
      },
    },
    '/admin/staff/{uid}/update': {
      post: {
        tags: ['Staff Management'],
        summary: 'Update staff permissions, department assignment (transfer), or active/suspended/deactivated status',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'uid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Staff record updated' } },
      },
    },
    '/admin/staff/{uid}/revoke-session': {
      post: {
        tags: ['Staff Management'],
        summary: 'Immediately invalidate active sessions for a department staff member',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'uid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Staff session revoked' } },
      },
    },
    '/admin/api-keys/{id}/revoke': {
      post: {
        tags: ['API Management'],
        summary: 'Revoke an API key immediately',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'API key revoked' } },
      },
    },
    '/system/gateway-status': {
      get: {
        tags: ['System'],
        summary: 'Inspect Messaging and M-Pesa Daraja payment gateway configuration status',
        responses: { '200': { description: 'Gateway readiness without exposing secrets' } },
      },
    },
    '/admin/me/profile': {
      patch: {
        tags: ['Staff Profile'],
        summary: 'Update authenticated staff display name, phone, avatar URL, and notification preferences',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Staff profile updated' } },
      },
    },
    '/admin/withdrawals/{id}/review': {
      post: {
        tags: ['Finance Control'],
        summary: 'Approve or reject a pending KES withdrawal with idempotency protection',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Withdrawal decision persisted' },
          '409': { description: 'Duplicate or already processed withdrawal blocked' },
        },
      },
    },
    '/admin/bids/{id}/review': {
      post: {
        tags: ['Bids & Assignments'],
        summary: 'Accept or reject a worker bid with audit logging',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Bid decision persisted' } },
      },
    },
    '/admin/disputes/{id}/resolve': {
      post: {
        tags: ['Bids & Assignments'],
        summary: 'Resolve or update a formal assignment dispute',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Dispute updated' } },
      },
    },
    '/admin/email/status': {
      get: {
        tags: ['Platform Settings', 'Email Service'],
        summary: 'Inspect email connection status, swastaskorg@gmail.com sender identity, and SPF/DKIM/DMARC domain checks',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Email service and DNS verification details (zero secrets)' } },
      },
    },
    '/admin/email/test': {
      post: {
        tags: ['Platform Settings', 'Email Service'],
        summary: 'Send a live verification test email from SWAS TASKS <swastaskorg@gmail.com> and log delivery status',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Delivery outcome and logged email_logs record' } },
      },
    },
    '/admin/email/dispatch': {
      post: {
        tags: ['Email Service'],
        summary: 'Send an official branded email from SWAS TASKS <swastaskorg@gmail.com> with audit logging',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Delivery outcome and email_logs entry' } },
      },
    },
    '/admin/email/logs/{id}/retry': {
      post: {
        tags: ['Platform Settings', 'Email Service'],
        summary: 'Retry a failed or unconfigured email delivery record',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated delivery outcome and email log record' } },
      },
    },
    '/public/email/dispatch': {
      post: {
        tags: ['Public Integration', 'Email Service'],
        summary: 'Dispatch a public SWAS TASKS notification email using swastaskorg@gmail.com',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Email dispatch status returned by provider' } },
      },
    },
    '/admin/users/{id}/status': {
      post: {
        tags: ['User Management'],
        summary: 'Update user status or verification status and trigger automatic email notification',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'User status updated' } },
      },
    },
    '/admin/clients/{id}/status': {
      post: {
        tags: ['Client Management'],
        summary: 'Update client status or verification status and trigger automatic email notification',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Client status updated' } },
      },
    },
    '/admin/tasks/{id}/moderate': {
      post: {
        tags: ['Task Monitoring'],
        summary: 'Moderate task (publish, reject, remove) and trigger automatic client notification',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Task moderated' } },
      },
    },
    '/admin/submissions/{id}/review': {
      post: {
        tags: ['Bids & Assignments'],
        summary: 'Approve, request revision, or reject work submission with automatic worker notification',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Submission reviewed' } },
      },
    },
    '/admin/email/recipients': {
      get: {
        tags: ['Email Centre'],
        summary: 'Fetch live department-scoped email recipients from platform records',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Recipient directory entries' } },
      },
    },
    '/admin/email/history': {
      get: {
        tags: ['Email Centre'],
        summary: 'Fetch department-scoped email delivery logs and sync webhook delivery events',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Email log records' } },
      },
    },
    '/admin/email/reports': {
      get: {
        tags: ['Email Centre'],
        summary: 'Compute live email analytics, delivery rates, bounce rates, and template usage',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Email analytics summary' } },
      },
    },
    '/admin/email/campaigns': {
      get: {
        tags: ['Email Centre'],
        summary: 'List bulk email campaigns scoped by department',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Campaign list' } },
      },
    },
    '/admin/email/send-bulk': {
      post: {
        tags: ['Email Centre'],
        summary: 'Execute an individualized bulk personalized email campaign',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '201': { description: 'Campaign queued/executed' } },
      },
    },
    '/admin/email/campaigns/{id}/retry': {
      post: {
        tags: ['Email Centre'],
        summary: 'Retry failed recipients within a bulk email campaign',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Failed recipients retried' } },
      },
    },
    '/admin/email/schedule': {
      post: {
        tags: ['Email Centre'],
        summary: 'Schedule single or multi-recipient personalized email delivery',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '201': { description: 'Scheduled email records persisted' } },
      },
    },
    '/admin/email/scheduled/{id}/cancel': {
      post: {
        tags: ['Email Centre'],
        summary: 'Cancel a pending scheduled email',
        security: [{ FirebaseBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Scheduled email cancelled' } },
      },
    },
    '/admin/email/process-scheduled': {
      post: {
        tags: ['Email Centre'],
        summary: 'Process due scheduled email jobs',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Due scheduled jobs processed' } },
      },
    },
    '/admin/email/templates': {
      get: {
        tags: ['Email Centre'],
        summary: 'List reusable email templates',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Template list' } },
      },
      post: {
        tags: ['Email Centre'],
        summary: 'Create or update a reusable email template',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '201': { description: 'Template saved' } },
      },
    },
    '/admin/email/drafts': {
      get: {
        tags: ['Email Centre'],
        summary: 'List saved email drafts',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '200': { description: 'Draft list' } },
      },
      post: {
        tags: ['Email Centre'],
        summary: 'Create or update an email draft',
        security: [{ FirebaseBearerAuth: [] }],
        responses: { '201': { description: 'Draft saved' } },
      },
    },
    '/webhooks/email-events': {
      post: {
        tags: ['Email Centre', 'Webhooks'],
        summary: 'HMAC/Svix verified provider webhook for delivered, bounced, opened, and clicked events',
        responses: {
          '200': { description: 'Webhook event recorded' },
          '401': { description: 'Missing signature' },
          '403': { description: 'Invalid HMAC signature' },
          '503': { description: 'Webhook secret not configured' },
        },
      },
    },
  },
};

export function renderSwaggerHtml(): string {
  const endpoints = Object.entries(openApiSpec.paths)
    .map(([routePath, methods]) => {
      return Object.entries(methods as Record<string, { summary?: string; tags?: string[] }>)
        .map(
          ([method, meta]) => `
        <div class="card">
          <div class="row">
            <span class="method ${method}">${method.toUpperCase()}</span>
            <code>/api/v1${routePath}</code>
          </div>
          <p class="summary">${meta.summary || ''}</p>
          <span class="tag">${(meta.tags || []).join(' · ')}</span>
        </div>`
        )
        .join('');
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SWAS TASKS – OpenAPI Documentation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Poppins:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; font-weight: 400; line-height: 1.5; background: #F3F6FA; color: #172B46; margin: 0; padding: 32px; -webkit-font-smoothing: antialiased; }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { font-family: 'Poppins', 'Inter', sans-serif; font-size: 28px; font-weight: 600; line-height: 1.25; color: #102B50; margin-bottom: 6px; letter-spacing: -0.02em; }
    p.lead { font-size: 14px; color: #75869D; margin-top: 0; margin-bottom: 24px; }
    .card { background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .row { display: flex; align-items: center; gap: 12px; }
    .method { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 4px; color: #fff; letter-spacing: 0.03em; }
    .get { background: #1265C8; }
    .post { background: #15966B; }
    .patch { background: #E6A23C; }
    code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; color: #102B50; }
    .summary { margin: 8px 0 4px; font-size: 14px; font-weight: 400; color: #172B46; }
    .tag { font-size: 12px; font-weight: 400; color: #75869D; }
    a { color: #1265C8; font-weight: 500; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>SWAS TASKS – Central Control Centre API v1</h1>
    <p class="lead">OpenAPI 3.1 Specification · <a href="/api/v1/openapi.json">Download openapi.json</a></p>
    ${endpoints}
  </div>
</body>
</html>`;
}
