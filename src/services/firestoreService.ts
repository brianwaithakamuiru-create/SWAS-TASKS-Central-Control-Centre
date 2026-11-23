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
import type {
  AdminAction,
  AdminRoleId,
  AdminUser,
  DepartmentId,
  EightDepartmentId,
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

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
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
    const message =
      typeof json === 'object' && json !== null && 'error' in json
        ? String((json as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
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
  },
  actionLabel: string
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      ...updates,
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
}

export async function updateClientRecord(
  actor: AdminUser,
  clientId: string,
  updates: {
    status?: 'pending' | 'active' | 'restricted' | 'suspended';
    verificationStatus?: 'unverified' | 'pending' | 'verified' | 'rejected';
  },
  actionLabel: string
): Promise<void> {
  const path = `clients/${clientId}`;
  try {
    await updateDoc(doc(db, 'clients', clientId), {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    await logAdminAction({
      actor,
      category: 'client',
      action: actionLabel,
      affectedRecord: path,
      metadata: updates,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateTaskModeration(
  actor: AdminUser,
  taskId: string,
  updates: {
    status: 'pending' | 'published' | 'active' | 'completed' | 'rejected' | 'reported' | 'removed';
    moderationNotes?: string;
  },
  actionLabel: string
): Promise<void> {
  const path = `tasks/${taskId}`;
  try {
    await updateDoc(doc(db, 'tasks', taskId), {
      status: updates.status,
      moderationNotes: truncateStr(updates.moderationNotes || '', 1000),
      updatedAt: new Date().toISOString(),
    });
    await logAdminAction({
      actor,
      category: 'admin',
      action: actionLabel,
      affectedRecord: path,
      metadata: { status: updates.status },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
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
