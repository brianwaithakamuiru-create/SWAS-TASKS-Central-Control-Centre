import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, handleFirestoreError, OperationType, storage } from '../lib/firebase';
import { getActiveGmailAccessToken } from './gmailOAuth';
import type {
  AdminAction,
  AdminRoleId,
  AdminUser,
  DepartmentId,
  EightDepartmentId,
  EmailAttachmentMeta,
  EmailCampaignRecord,
  EmailDraftRecord,
  EmailLogRecord,
  EmailRecipientOption,
  EmailTemplateCategory,
  EmailTemplateRecord,
} from '../types/admin';

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function truncateStr(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

export function subscribeCollection<T>(
  collectionName: string,
  onData: (items: T[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, collectionName));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, collectionName);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export function subscribeDepartmentMessages<T>(
  department: EightDepartmentId | null,
  isSuperAdmin: boolean,
  onData: (items: T[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = isSuperAdmin
    ? query(collection(db, 'department_messages'))
    : query(collection(db, 'department_messages'), where('department', '==', department || ''));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'department_messages');
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export function subscribeDepartmentInvitations<T>(
  department: EightDepartmentId | null,
  isGlobal: boolean,
  onData: (items: T[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = isGlobal
    ? query(collection(db, 'staff_invitations'))
    : query(collection(db, 'staff_invitations'), where('department', '==', department || ''));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'staff_invitations');
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export function subscribeOwnLoginHistory<T>(
  uid: string,
  onData: (items: T[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'staff_login_history'), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'staff_login_history');
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export function subscribeDepartmentEmailCollection<T>(
  collectionName: 'email_logs' | 'email_templates' | 'email_drafts' | 'email_campaigns',
  scopeMode: 'all' | 'dept' | 'templates_dept' | 'owner',
  scopeValue: string | null,
  onData: (items: T[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  let q = query(collection(db, collectionName));
  if (scopeMode === 'dept') {
    q = query(collection(db, collectionName), where('department', '==', scopeValue || ''));
  } else if (scopeMode === 'templates_dept') {
    q = query(
      collection(db, collectionName),
      where('department', 'in', scopeValue ? ['all', scopeValue] : ['all'])
    );
  } else if (scopeMode === 'owner') {
    q = query(collection(db, collectionName), where('createdByUid', '==', scopeValue || ''));
  }

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, collectionName);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (
    !headers.has('X-Gmail-Access-Token') &&
    (path.startsWith('/api/v1/admin/email') ||
      path.startsWith('/api/v1/admin/invitations') ||
      path.startsWith('/api/v1/admin/staff'))
  ) {
    const gmailToken = getActiveGmailAccessToken();
    if (gmailToken) {
      headers.set('X-Gmail-Access-Token', gmailToken);
    }
  }
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const text = await response.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }
  }
  if (!response.ok) {
    const obj = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
    const message = 'error' in obj ? String(obj.error) : `HTTP ${response.status}`;
    throw new ApiError(message, response.status, obj);
  }
  return json as T;
}

export async function logAdminAction(params: {
  actor: AdminUser;
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
  action: string;
  affectedRecord: string;
  result?: 'success' | 'denied' | 'failed';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const eventId = makeId('evt');
  const now = new Date().toISOString();
  const path = `activity_logs/${eventId}`;
  try {
    await setDoc(doc(db, 'activity_logs', eventId), {
      eventId,
      category: params.category,
      actorId: params.actor.uid,
      actorEmail: truncateStr(params.actor.email, 254),
      actorRole: params.actor.role,
      action: truncateStr(params.action, 160),
      affectedRecord: truncateStr(params.affectedRecord, 200),
      result: params.result || 'success',
      correlationId: makeId('cor'),
      metadata: params.metadata || {},
      createdAt: now,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateUserStatus(
  actor: AdminUser,
  uid: string,
  updates: {
    status?: 'pending' | 'active' | 'suspended' | 'banned' | 'recovery_requested';
    verificationStatus?: 'unverified' | 'pending' | 'verified' | 'rejected';
    role?: string;
    reason?: string;
  },
  actionLabel: string
): Promise<void> {
  if (updates.role && !updates.status && !updates.verificationStatus) {
    const path = `users/${uid}`;
    try {
      await updateDoc(doc(db, 'users', uid), {
        role: updates.role,
        updatedAt: new Date().toISOString(),
      });
      await logAdminAction({
        actor,
        category: 'user',
        action: actionLabel,
        affectedRecord: path,
        metadata: updates,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
    return;
  }

  if (updates.status === 'suspended' && !updates.verificationStatus && !updates.role) {
    await apiFetch(`/api/v1/admin/users/${uid}/suspend`, { method: 'POST' });
    return;
  }

  if (updates.status === 'active' && !updates.verificationStatus && !updates.role) {
    await apiFetch(`/api/v1/admin/users/${uid}/activate`, { method: 'POST' });
    return;
  }

  await apiFetch(`/api/v1/admin/users/${uid}/status`, {
    method: 'POST',
    body: JSON.stringify({
      status: updates.status,
      verificationStatus: updates.verificationStatus,
      reason: updates.reason,
    }),
  });
}

export async function updateClientRecord(
  _actor: AdminUser,
  clientId: string,
  updates: {
    status?: 'pending' | 'active' | 'restricted' | 'suspended';
    verificationStatus?: 'unverified' | 'pending' | 'verified' | 'rejected';
    reason?: string;
  },
  _actionLabel: string
): Promise<void> {
  await apiFetch(`/api/v1/admin/clients/${clientId}/status`, {
    method: 'POST',
    body: JSON.stringify({
      status: updates.status,
      verificationStatus: updates.verificationStatus,
      reason: updates.reason,
    }),
  });
}

export async function updateTaskModeration(
  _actor: AdminUser,
  taskId: string,
  updates: {
    status: 'pending' | 'published' | 'active' | 'completed' | 'rejected' | 'reported' | 'removed';
    moderationNotes?: string;
  },
  _actionLabel: string
): Promise<void> {
  await apiFetch(`/api/v1/admin/tasks/${taskId}/moderate`, {
    method: 'POST',
    body: JSON.stringify({
      status: updates.status,
      moderationNotes: updates.moderationNotes,
    }),
  });
}

export async function saveTaskCategory(
  actor: AdminUser,
  category: {
    categoryId?: string;
    name: string;
    slug: string;
    description?: string;
    active: boolean;
    minBudgetKes?: number;
  }
): Promise<void> {
  const categoryId = category.categoryId || makeId('cat');
  const now = new Date().toISOString();
  const path = `task_categories/${categoryId}`;
  try {
    await setDoc(
      doc(db, 'task_categories', categoryId),
      {
        categoryId,
        name: truncateStr(category.name, 80),
        slug: truncateStr(category.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'), 80),
        description: truncateStr(category.description || '', 500),
        active: Boolean(category.active),
        minBudgetKes: Number(category.minBudgetKes || 0),
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    await logAdminAction({
      actor,
      category: 'admin',
      action: category.categoryId ? 'UPDATE_TASK_CATEGORY' : 'CREATE_TASK_CATEGORY',
      affectedRecord: path,
      metadata: { name: category.name },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateAssignmentStatus(
  actor: AdminUser,
  assignmentId: string,
  status:
    | 'active'
    | 'submitted'
    | 'revision_requested'
    | 'approved'
    | 'completed'
    | 'disputed'
    | 'cancelled',
  adminResolutionNote?: string
): Promise<void> {
  const path = `assignments/${assignmentId}`;
  try {
    await updateDoc(doc(db, 'assignments', assignmentId), {
      status,
      adminResolutionNote: truncateStr(adminResolutionNote || '', 1000),
      updatedAt: new Date().toISOString(),
    });
    await logAdminAction({
      actor,
      category: 'admin',
      action: `ASSIGNMENT_${status.toUpperCase()}`,
      affectedRecord: path,
      metadata: { status, adminResolutionNote: adminResolutionNote || '' },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function reviewBidDecision(
  bidId: string,
  status: 'accepted' | 'rejected'
): Promise<void> {
  await apiFetch(`/api/v1/admin/bids/${bidId}/review`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export async function reviewWorkSubmission(
  actor: AdminUser,
  submissionId: string,
  status: 'submitted' | 'revision_requested' | 'approved' | 'rejected',
  reviewerNote?: string
): Promise<void> {
  if (status === 'submitted') {
    const path = `work_submissions/${submissionId}`;
    try {
      await updateDoc(doc(db, 'work_submissions', submissionId), {
        status,
        reviewerNote: truncateStr(reviewerNote || '', 1000),
        updatedAt: new Date().toISOString(),
      });
      await logAdminAction({
        actor,
        category: 'admin',
        action: `SUBMISSION_${status.toUpperCase()}`,
        affectedRecord: path,
        metadata: { status, reviewerNote: reviewerNote || '' },
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
    return;
  }

  await apiFetch(`/api/v1/admin/submissions/${submissionId}/review`, {
    method: 'POST',
    body: JSON.stringify({ status, reviewerNote: reviewerNote || '' }),
  });
}

export async function resolveDisputeRecord(
  disputeId: string,
  status: 'under_review' | 'resolved_client' | 'resolved_worker' | 'dismissed',
  resolutionNote: string
): Promise<void> {
  await apiFetch(`/api/v1/admin/disputes/${disputeId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status, resolutionNote }),
  });
}

export async function reviewWithdrawalRequest(
  _actor: AdminUser,
  withdrawalId: string,
  decision: 'approved' | 'rejected',
  reviewNote: string
): Promise<void> {
  const idempotencyKey = `wd_${withdrawalId}_${decision}`;
  await apiFetch(`/api/v1/admin/withdrawals/${withdrawalId}/review`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ decision, reviewNote }),
  });
}

export async function toggleTransactionReconciled(
  actor: AdminUser,
  transactionId: string,
  reconciled: boolean
): Promise<void> {
  const path = `transactions/${transactionId}`;
  try {
    await updateDoc(doc(db, 'transactions', transactionId), {
      reconciled,
    });
    await logAdminAction({
      actor,
      category: 'financial',
      action: reconciled ? 'MARK_TRANSACTION_RECONCILED' : 'UNMARK_TRANSACTION_RECONCILED',
      affectedRecord: path,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function saveAdminAccount(
  actor: AdminUser,
  payload: {
    uid: string;
    email: string;
    displayName: string;
    role: AdminRoleId;
    status: 'active' | 'suspended' | 'deactivated' | 'revoked';
    departments: DepartmentId[];
    actions: AdminAction[];
    isNew?: boolean;
  }
): Promise<void> {
  const path = `admin_users/${payload.uid}`;
  const now = new Date().toISOString();
  try {
    if (payload.isNew) {
      await setDoc(doc(db, 'admin_users', payload.uid), {
        uid: truncateStr(payload.uid, 128),
        email: truncateStr(payload.email.toLowerCase(), 254),
        displayName: truncateStr(payload.displayName, 120),
        role: payload.role,
        status: payload.status,
        departments: payload.departments,
        actions: payload.actions,
        mfaEnabled: false,
        failedAttempts: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.uid,
      });
    } else {
      await updateDoc(doc(db, 'admin_users', payload.uid), {
        email: truncateStr(payload.email.toLowerCase(), 254),
        displayName: truncateStr(payload.displayName, 120),
        role: payload.role,
        status: payload.status,
        departments: payload.departments,
        actions: payload.actions,
        updatedAt: now,
      });
    }
    await logAdminAction({
      actor,
      category: 'account_change',
      action: payload.isNew ? 'PROVISION_ADMIN_USER' : 'UPDATE_ADMIN_PERMISSIONS',
      affectedRecord: path,
      metadata: { role: payload.role, status: payload.status, departments: payload.departments },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function saveConnectedApp(
  actor: AdminUser,
  app: {
    appId?: string;
    name: string;
    websiteUrl: string;
    apiBaseUrl?: string;
    allowedOrigins: string[];
    status: 'connected' | 'paused' | 'error';
  }
): Promise<void> {
  const appId = app.appId || makeId('app');
  const path = `connected_apps/${appId}`;
  try {
    await setDoc(
      doc(db, 'connected_apps', appId),
      {
        appId,
        name: truncateStr(app.name, 120),
        websiteUrl: truncateStr(app.websiteUrl, 300),
        apiBaseUrl: truncateStr(app.apiBaseUrl || '', 300),
        allowedOrigins: app.allowedOrigins.slice(0, 25),
        status: app.status,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    await logAdminAction({
      actor,
      category: 'api',
      action: 'SAVE_CONNECTED_APP',
      affectedRecord: path,
      metadata: { websiteUrl: app.websiteUrl, status: app.status },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function saveWebhookConfig(
  actor: AdminUser,
  webhook: {
    webhookId?: string;
    url: string;
    events: string[];
    active: boolean;
  }
): Promise<void> {
  const webhookId = webhook.webhookId || makeId('whk');
  const now = new Date().toISOString();
  const path = `webhooks/${webhookId}`;
  try {
    await setDoc(
      doc(db, 'webhooks', webhookId),
      {
        webhookId,
        url: truncateStr(webhook.url, 300),
        events: webhook.events.slice(0, 25),
        active: Boolean(webhook.active),
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    await logAdminAction({
      actor,
      category: 'api',
      action: 'SAVE_WEBHOOK',
      affectedRecord: path,
      metadata: { url: webhook.url, active: webhook.active },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteWebhookConfig(actor: AdminUser, webhookId: string): Promise<void> {
  const path = `webhooks/${webhookId}`;
  try {
    await deleteDoc(doc(db, 'webhooks', webhookId));
    await logAdminAction({
      actor,
      category: 'api',
      action: 'DELETE_WEBHOOK',
      affectedRecord: path,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function savePlatformSettingsSection(
  actor: AdminUser,
  sectionId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const path = `platform_settings/${sectionId}`;
  try {
    await setDoc(
      doc(db, 'platform_settings', sectionId),
      {
        sectionId,
        ...payload,
        updatedBy: actor.uid,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    await logAdminAction({
      actor,
      category: 'admin',
      action: 'UPDATE_PLATFORM_SETTINGS',
      affectedRecord: path,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function uploadPlatformLogo(actor: AdminUser, file: File): Promise<string> {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Only PNG, JPEG, WebP, or SVG image files are permitted.');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('Logo file size must not exceed 2 MB.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageRef = ref(storage, `branding/platform_logo_${Date.now()}_${safeName}`);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  await savePlatformSettingsSection(actor, 'public', { logoUrl: url });
  return url;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const path = `notifications/${notificationId}`;
  try {
    await updateDoc(doc(db, 'notifications', notificationId), { read: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function resolveSecurityEvent(actor: AdminUser, eventId: string): Promise<void> {
  const path = `security_events/${eventId}`;
  try {
    await updateDoc(doc(db, 'security_events', eventId), { resolved: true });
    await logAdminAction({
      actor,
      category: 'security',
      action: 'RESOLVE_SECURITY_EVENT',
      affectedRecord: path,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateSupportTicketStatus(
  actor: AdminUser,
  ticketId: string,
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
): Promise<void> {
  const path = `support_tickets/${ticketId}`;
  try {
    await updateDoc(doc(db, 'support_tickets', ticketId), {
      status,
      assignedAdmin: actor.uid,
      updatedAt: new Date().toISOString(),
    });
    await logAdminAction({
      actor,
      category: 'client',
      action: `SUPPORT_TICKET_${status.toUpperCase()}`,
      affectedRecord: path,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function sendDepartmentMessage(
  actor: AdminUser,
  department: EightDepartmentId,
  body: string
): Promise<void> {
  const messageId = makeId('msg');
  const path = `department_messages/${messageId}`;
  try {
    await setDoc(doc(db, 'department_messages', messageId), {
      messageId,
      department,
      senderUid: actor.uid,
      senderName: truncateStr(actor.displayName || actor.email, 120),
      senderRole: truncateStr(actor.role, 80),
      body: truncateStr(body, 2000),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function uploadStaffAvatar(uid: string, file: File): Promise<string> {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Only PNG, JPEG, or WebP profile photos are permitted.');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('Profile photo size must not exceed 2 MB.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageRef = ref(storage, `avatars/${uid}/avatar_${Date.now()}_${safeName}`);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return getDownloadURL(storageRef);
}

export async function updateMyStaffProfile(payload: {
  displayName?: string;
  phone?: string;
  photoUrl?: string;
  notificationPrefs?: {
    emailAlerts?: boolean;
    securityAlerts?: boolean;
    departmentMentions?: boolean;
    dailyDigest?: boolean;
  };
}): Promise<void> {
  await apiFetch('/api/v1/admin/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function exportRecordsToCsv(
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): void {
  const escapeCell = (val: string | number | boolean | null | undefined): string => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
]);

export async function uploadEmailAttachment(uid: string, file: File): Promise<EmailAttachmentMeta> {
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
    throw new Error('Only PDF, DOCX, XLSX, PNG, and JPG email attachments are permitted.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Each email attachment must not exceed 5 MB.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `email_attachments/${uid}/att_${Date.now()}_${safeName}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const downloadUrl = await getDownloadURL(storageRef);
  return {
    name: file.name.slice(0, 120),
    contentType: file.type,
    sizeBytes: file.size,
    storagePath,
    downloadUrl,
  };
}

export function sanitizeClientHtml(rawHtml: string): string {
  if (typeof window === 'undefined' || !rawHtml) return '';
  const parser = new DOMParser();
  const docHtml = parser.parseFromString(rawHtml, 'text/html');
  const allowedTags = new Set([
    'P',
    'BR',
    'B',
    'STRONG',
    'I',
    'EM',
    'U',
    'S',
    'H1',
    'H2',
    'H3',
    'H4',
    'UL',
    'OL',
    'LI',
    'BLOCKQUOTE',
    'A',
    'SPAN',
    'DIV',
    'HR',
  ]);

  const walk = (node: Node): void => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!allowedTags.has(el.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'].includes(el.tagName)) {
            el.remove();
            continue;
          }
          const span = docHtml.createElement('span');
          span.textContent = el.textContent || '';
          el.replaceWith(span);
          continue;
        }
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          const name = attr.name.toLowerCase();
          if (el.tagName === 'A' && name === 'href') {
            const val = attr.value.trim();
            if (!/^https?:\/\//i.test(val) && !/^mailto:/i.test(val)) {
              el.removeAttribute(attr.name);
            } else {
              el.setAttribute('target', '_blank');
              el.setAttribute('rel', 'noopener noreferrer');
            }
          } else {
            el.removeAttribute(attr.name);
          }
        }
        walk(el);
      }
    }
  };
  walk(docHtml.body);
  return docHtml.body.innerHTML;
}

export function buildEmailPreviewSrcDoc(params: {
  subject: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  signatureHtml?: string;
  footerText?: string;
  includeSignature?: boolean;
}): string {
  const safeBody = sanitizeClientHtml(params.bodyHtml || '');
  const safeSig = params.includeSignature !== false && params.signatureHtml ? sanitizeClientHtml(params.signatureHtml) : '';
  const escapeTxt = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const safeCtaUrl =
    params.ctaUrl && /^https?:\/\//i.test(params.ctaUrl.trim()) ? params.ctaUrl.trim() : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; padding: 16px; background: #F3F6FA; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; color: #16243D; font-size: 14px; line-height: 1.6; }
  .card { max-width: 620px; margin: 0 auto; background: #FFFFFF; border: 1px solid #D8E2EF; border-radius: 6px; overflow: hidden; }
  .hdr { background: #102B50; padding: 18px 24px; color: #FFFFFF; }
  .brand { font-size: 15px; font-weight: 700; letter-spacing: 0.04em; }
  .sub { font-size: 11px; color: #BFD4F2; margin-top: 2px; }
  .content { padding: 24px; }
  .subject { font-size: 17px; font-weight: 600; color: #16243D; margin: 0 0 14px; }
  .cta { display: inline-block; margin-top: 16px; padding: 10px 18px; background: #1265C8; color: #FFFFFF; text-decoration: none; border-radius: 4px; font-weight: 600; font-size: 13px; }
  .sig { margin-top: 20px; padding-top: 14px; border-top: 1px solid #E5ECF5; color: #4A5B73; font-size: 13px; }
  .ftr { background: #F8FAFC; padding: 12px 24px; border-top: 1px solid #E5ECF5; font-size: 11px; color: #64748B; }
</style>
</head>
<body>
  <div class="card">
    <div class="hdr">
      <div class="brand">SWAS TASKS Organization</div>
      <div class="sub">Official Communication &middot; swastaskorg@gmail.com</div>
    </div>
    <div class="content">
      <div class="subject">${escapeTxt(params.subject || '(No Subject)')}</div>
      <div>${safeBody || '<p>No content yet.</p>'}</div>
      ${safeCtaUrl && params.ctaLabel ? `<a class="cta" href="${escapeTxt(safeCtaUrl)}" target="_blank" rel="noopener noreferrer">${escapeTxt(params.ctaLabel)}</a>` : ''}
      ${safeSig ? `<div class="sig">${safeSig}</div>` : ''}
    </div>
    <div class="ftr">${escapeTxt(params.footerText || 'Sent via SWAS TASKS Central Control Centre · Reply-To: swastaskorg@gmail.com')}</div>
  </div>
</body>
</html>`;
}

export async function fetchEmailRecipients(department?: string): Promise<EmailRecipientOption[]> {
  const qs = department ? `?department=${encodeURIComponent(department)}` : '';
  const data = await apiFetch<{ recipients: EmailRecipientOption[] }>(`/api/v1/admin/email/recipients${qs}`);
  return Array.isArray(data.recipients) ? data.recipients : [];
}

export interface EmailReportsResponse {
  metrics: {
    totalAttempted: number;
    sentOrAccepted: number;
    confirmedDelivered: number;
    failedCount: number;
    notConfiguredCount: number;
    bouncedCount: number;
    scheduledCount: number;
    cancelledCount: number;
    deliverySuccessRate: number;
    bounceRate: number;
    campaignCount: number;
    templateCount: number;
  };
  volumeByDay: Array<{ date: string; sent: number; failed: number; scheduled: number }>;
  recentCampaigns: EmailCampaignRecord[];
  templateUsage: Array<{ templateId: string; name: string; category: string; usageCount: number }>;
}

export async function fetchEmailReports(department?: string): Promise<EmailReportsResponse> {
  const qs = department ? `?department=${encodeURIComponent(department)}` : '';
  return apiFetch<EmailReportsResponse>(`/api/v1/admin/email/reports${qs}`);
}

export interface DispatchEmailPayload {
  recipientEmail?: string;
  recipientName?: string;
  recipientUid?: string;
  recipientType?: 'user' | 'worker' | 'client' | 'admin' | 'custom';
  recipients?: Array<{
    email: string;
    name?: string;
    uid?: string;
    recipientType?: 'user' | 'worker' | 'client' | 'admin' | 'custom';
    vars?: Record<string, string>;
  }>;
  ccEmails?: string[];
  bccEmails?: string[];
  scope?: 'public_website' | 'control_centre';
  department?: string;
  eventType?: string;
  subject: string;
  title?: string;
  greeting?: string;
  bodyText?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  attachments?: EmailAttachmentMeta[];
  includeSignature?: boolean;
  templateId?: string;
  sourceRecord?: string;
  personalizationVars?: Record<string, string>;
}

export async function dispatchPlatformEmail(payload: DispatchEmailPayload): Promise<{
  delivery: { sent?: boolean; status: string; provider: string; detail?: string; error?: string };
  emailLog?: EmailLogRecord;
  sentCount?: number;
  failedCount?: number;
  results?: Array<{ email: string; status: string; detail?: string; error?: string; emailLogId?: string }>;
}> {
  return apiFetch('/api/v1/admin/email/dispatch', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function schedulePlatformEmail(payload: {
  recipients: Array<{
    email: string;
    name?: string;
    uid?: string;
    recipientType?: 'user' | 'worker' | 'client' | 'admin' | 'custom';
  }>;
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  attachments?: EmailAttachmentMeta[];
  scheduledFor: string;
  department?: string;
  eventType?: string;
  sourceRecord?: string;
}): Promise<{ scheduledCount: number; logs: EmailLogRecord[] }> {
  return apiFetch('/api/v1/admin/email/schedule', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function cancelScheduledEmail(emailLogId: string): Promise<void> {
  await apiFetch(`/api/v1/admin/email/scheduled/${emailLogId}/cancel`, { method: 'POST' });
}

export async function processDueScheduledEmailsNow(): Promise<{ processed: number }> {
  return apiFetch('/api/v1/admin/email/process-scheduled', { method: 'POST' });
}

export async function sendBulkEmailCampaign(payload: {
  name: string;
  department?: string;
  audienceFilter?: string;
  recipients: Array<{
    email: string;
    name?: string;
    uid?: string;
    recipientType?: 'user' | 'worker' | 'client' | 'admin' | 'custom';
    vars?: Record<string, string>;
  }>;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  attachments?: EmailAttachmentMeta[];
  includeSignature?: boolean;
  templateId?: string;
  scheduledFor?: string;
}): Promise<{ campaign: EmailCampaignRecord; results?: unknown[] }> {
  return apiFetch('/api/v1/admin/email/send-bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function retryEmailCampaign(campaignId: string): Promise<{ campaign: EmailCampaignRecord; retriedCount: number }> {
  return apiFetch(`/api/v1/admin/email/campaigns/${campaignId}/retry`, { method: 'POST' });
}

export async function cancelEmailCampaign(campaignId: string): Promise<void> {
  await apiFetch(`/api/v1/admin/email/campaigns/${campaignId}/cancel`, { method: 'POST' });
}

export async function saveEmailTemplate(payload: {
  templateId?: string;
  name: string;
  category: EmailTemplateCategory;
  department: 'all' | EightDepartmentId;
  subject: string;
  htmlBody: string;
  textBody?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  variables?: string[];
  isActive?: boolean;
}): Promise<{ template: EmailTemplateRecord }> {
  return apiFetch('/api/v1/admin/email/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteEmailTemplate(templateId: string): Promise<void> {
  await apiFetch(`/api/v1/admin/email/templates/${templateId}`, { method: 'DELETE' });
}

export async function saveEmailDraft(payload: {
  draftId?: string;
  department?: string;
  recipientEmails?: string[];
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  templateId?: string;
  attachments?: EmailAttachmentMeta[];
  scheduledFor?: string;
}): Promise<{ draft: EmailDraftRecord }> {
  return apiFetch('/api/v1/admin/email/drafts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteEmailDraft(draftId: string): Promise<void> {
  await apiFetch(`/api/v1/admin/email/drafts/${draftId}`, { method: 'DELETE' });
}

export async function retryEmailLog(emailLogId: string): Promise<{
  delivery: { sent?: boolean; status: string; detail?: string; error?: string };
  emailLog: EmailLogRecord;
}> {
  return apiFetch(`/api/v1/admin/email/logs/${emailLogId}/retry`, { method: 'POST' });
}
