import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { serverConfig } from '../config.ts';
import { verifyFirebaseIdToken } from '../firebaseAuth.ts';
import { firestoreGetDoc, firestoreSetDoc } from '../firestoreRest.ts';

export interface AdminPrincipal {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  primaryDepartment: string;
  role: string;
  status: string;
  verificationStatus?: string;
  accessStatus?: string;
  departments: string[];
  actions: string[];
  sessionRevokedAt?: string;
  lastLoginAt?: string;
  photoUrl?: string;
  notificationPrefs?: Record<string, unknown>;
  idToken: string;
}

export interface AuthenticatedRequest extends Request {
  admin?: AdminPrincipal;
  correlationId?: string;
}

const ALL_DEPARTMENTS = [
  'user_management',
  'client_management',
  'task_monitoring',
  'bids_assignments',
  'finance_control',
  'api_management',
  'activity_logs',
  'platform_settings',
];

export const EMAIL_PERMISSIONS = [
  'email.view',
  'email.compose',
  'email.send',
  'email.send_bulk',
  'email.schedule',
  'email.manage_templates',
  'email.view_reports',
  'email.retry_failed',
  'email.manage_settings',
] as const;

export type EmailPermissionKey = (typeof EMAIL_PERMISSIONS)[number];

const ALL_ACTIONS = [
  'view',
  'read',
  'create',
  'edit',
  'update',
  'approve',
  'reject',
  'suspend',
  'revoke',
  'export',
  'manage',
  ...EMAIL_PERMISSIONS,
];

interface AttemptState {
  count: number;
  lockedUntilMs: number;
  lastAttemptAt: string;
}

const loginAttempts = new Map<string, AttemptState>();

export function recordFailedAttempt(email: string): {
  locked: boolean;
  attempts: number;
  lockedUntil?: string;
} {
  const normalized = email.toLowerCase().trim();
  const prev = loginAttempts.get(normalized) || { count: 0, lockedUntilMs: 0, lastAttemptAt: '' };
  const nextCount = prev.count + 1;
  const now = Date.now();
  const lockedUntilMs = nextCount >= 5 ? now + 15 * 60 * 1000 : prev.lockedUntilMs;
  loginAttempts.set(normalized, {
    count: nextCount,
    lockedUntilMs,
    lastAttemptAt: new Date().toISOString(),
  });
  return {
    locked: lockedUntilMs > now,
    attempts: nextCount,
    lockedUntil: lockedUntilMs > now ? new Date(lockedUntilMs).toISOString() : undefined,
  };
}

export function clearFailedAttempts(email: string): void {
  loginAttempts.delete(email.toLowerCase().trim());
}

export function isEmailLocked(email: string): { locked: boolean; lockedUntil?: string } {
  const state = loginAttempts.get(email.toLowerCase().trim());
  if (!state) return { locked: false };
  if (state.lockedUntilMs > Date.now()) {
    return { locked: true, lockedUntil: new Date(state.lockedUntilMs).toISOString() };
  }
  return { locked: false };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHmac('sha256', serverConfig.apiKeyHmacSecret).update(rawKey).digest('hex');
}

export function hashInvitationToken(rawToken: string): string {
  return crypto
    .createHmac('sha256', serverConfig.invitationSigningSecret)
    .update(rawToken)
    .digest('hex');
}

const ACTION_ALIASES: Record<string, string[]> = {
  read: ['read', 'view'],
  view: ['view', 'read'],
  update: ['update', 'edit'],
  edit: ['edit', 'update'],
};

function hasNormalizedAction(actions: string[], required: string): boolean {
  if (actions.includes('manage')) return true;
  const aliases = ACTION_ALIASES[required] || [required];
  return aliases.some((a) => actions.includes(a));
}

export async function requireAdminAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  req.correlationId =
    (typeof req.headers['x-correlation-id'] === 'string' && req.headers['x-correlation-id']) ||
    crypto.randomUUID();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer authorization token.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Empty authorization token.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseIdToken(token);
    if (!decoded.email || decoded.email_verified !== true) {
      res.status(403).json({
        error: 'Verified email address is required for administrator and staff access.',
      });
      return;
    }

    const email = decoded.email.toLowerCase();
    let adminDoc = await firestoreGetDoc('admin_users', decoded.uid, token);

    if (!adminDoc && email === serverConfig.bootstrapSuperAdminEmail) {
      const now = new Date().toISOString();
      const newSuperAdmin = {
        uid: decoded.uid,
        email,
        displayName: decoded.name || 'Platform Super Administrator',
        emailVerified: true,
        phoneVerified: false,
        primaryDepartment: 'all',
        role: 'SUPER_ADMIN',
        status: 'active',
        departments: ALL_DEPARTMENTS,
        actions: ALL_ACTIONS,
        mfaEnabled: false,
        failedAttempts: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: 'system_bootstrap',
      };
      adminDoc = await firestoreSetDoc('admin_users', decoded.uid, newSuperAdmin, token);
    }

    if (!adminDoc) {
      res.status(403).json({
        error:
          'Access denied. Staff registration is invitation-only and requires Super Administrator authorization.',
      });
      return;
    }

    if (adminDoc.status === 'pending_verification' || adminDoc.accessStatus === 'inactive') {
      res.status(403).json({
        error:
          'Your staff account registration is complete and currently awaiting Super Administrator verification.',
        accountStatus: 'pending_verification',
        verificationStatus: String(adminDoc.verificationStatus || 'pending_verification'),
        accessStatus: String(adminDoc.accessStatus || 'inactive'),
        department: String(adminDoc.primaryDepartment || ''),
        role: String(adminDoc.role || ''),
      });
      return;
    }

    if (adminDoc.status === 'rejected') {
      res.status(403).json({
        error: 'Your staff account registration was rejected by the Super Administrator.',
        accountStatus: 'rejected',
        verificationStatus: 'rejected',
        accessStatus: String(adminDoc.accessStatus || 'blocked'),
        rejectionReason:
          typeof adminDoc.rejectionReason === 'string' ? adminDoc.rejectionReason : '',
        department: String(adminDoc.primaryDepartment || ''),
        role: String(adminDoc.role || ''),
      });
      return;
    }

    if (adminDoc.status !== 'active' || adminDoc.accessStatus === 'blocked') {
      res.status(403).json({
        error: `Staff account status is '${String(adminDoc.status)}'. Access blocked.`,
        accountStatus: String(adminDoc.status),
      });
      return;
    }

    if (typeof adminDoc.sessionRevokedAt === 'string' && adminDoc.sessionRevokedAt) {
      const revokedMs = new Date(adminDoc.sessionRevokedAt).getTime();
      const authTimeMs = Number(decoded.auth_time || 0) * 1000;
      if (authTimeMs > 0 && authTimeMs < revokedMs) {
        res.status(401).json({
          error: 'Your session was revoked by the Super Administrator. Please sign in again.',
        });
        return;
      }
    }

    clearFailedAttempts(email);

    const departments = Array.isArray(adminDoc.departments)
      ? (adminDoc.departments as string[])
      : [];

    req.admin = {
      uid: decoded.uid,
      email,
      displayName: String(adminDoc.displayName || decoded.name || email),
      phone: typeof adminDoc.phone === 'string' ? adminDoc.phone : undefined,
      emailVerified: Boolean(decoded.email_verified),
      phoneVerified: Boolean(adminDoc.phoneVerified),
      primaryDepartment: String(
        adminDoc.primaryDepartment || (adminDoc.role === 'SUPER_ADMIN' ? 'all' : departments[0] || '')
      ),
      role: String(adminDoc.role || ''),
      status: String(adminDoc.status || ''),
      verificationStatus:
        typeof adminDoc.verificationStatus === 'string' ? adminDoc.verificationStatus : undefined,
      accessStatus:
        typeof adminDoc.accessStatus === 'string' ? adminDoc.accessStatus : undefined,
      departments,
      actions: Array.isArray(adminDoc.actions) ? (adminDoc.actions as string[]) : [],
      sessionRevokedAt:
        typeof adminDoc.sessionRevokedAt === 'string' ? adminDoc.sessionRevokedAt : undefined,
      lastLoginAt:
        typeof adminDoc.lastLoginAt === 'string' ? adminDoc.lastLoginAt : undefined,
      photoUrl: typeof adminDoc.photoUrl === 'string' ? adminDoc.photoUrl : undefined,
      notificationPrefs:
        adminDoc.notificationPrefs && typeof adminDoc.notificationPrefs === 'object'
          ? (adminDoc.notificationPrefs as Record<string, unknown>)
          : undefined,
      idToken: token,
    };
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token verification failed';
    res.status(401).json({ error: `Unauthorized: ${message}` });
  }
}

export function requirePermission(department: string, action: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const admin = req.admin;
    if (!admin) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (admin.role === 'SUPER_ADMIN') {
      next();
      return;
    }
    if (!admin.departments.includes(department) || !hasNormalizedAction(admin.actions, action)) {
      res.status(403).json({
        error: `Insufficient permissions: requires '${department}:${action}'.`,
      });
      return;
    }
    next();
  };
}

export function requireSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const admin = req.admin;
  if (!admin) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (admin.role !== 'SUPER_ADMIN') {
    res.status(403).json({
      error: 'Only the Super Administrator is authorized to perform staff verification or governance actions.',
    });
    return;
  }
  next();
}

export function requireStaffManager(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const admin = req.admin;
  if (!admin) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (
    admin.role === 'SUPER_ADMIN' ||
    (admin.departments.includes('user_management') && admin.actions.includes('manage'))
  ) {
    next();
    return;
  }
  res.status(403).json({
    error: 'Only the Super Administrator or authorized Staff Manager can perform this operation.',
  });
}

export function requireDeptInvitationManager(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const admin = req.admin;
  if (!admin) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (admin.role === 'SUPER_ADMIN' || admin.actions.includes('manage')) {
    next();
    return;
  }
  res.status(403).json({
    error: 'Only the Super Administrator or an authorized department manager can generate invitations.',
  });
}

export function hasEmailPermission(admin: AdminPrincipal, permission: EmailPermissionKey): boolean {
  if (admin.role === 'SUPER_ADMIN') return true;
  if (admin.actions.includes(permission)) return true;
  // Backward-compatible fallback for legacy staff invited before explicit email.* grants
  const hasExplicitEmailGrant = admin.actions.some((a) => a.startsWith('email.'));
  if (!hasExplicitEmailGrant) {
    if (permission === 'email.view' || permission === 'email.view_reports') {
      return hasNormalizedAction(admin.actions, 'view') || admin.actions.includes('manage');
    }
    if (permission === 'email.compose' || permission === 'email.send') {
      return (
        hasNormalizedAction(admin.actions, 'edit') ||
        hasNormalizedAction(admin.actions, 'create') ||
        admin.actions.includes('manage')
      );
    }
    if (
      (permission === 'email.manage_settings' ||
        permission === 'email.manage_templates' ||
        permission === 'email.retry_failed') &&
      admin.departments.includes('platform_settings')
    ) {
      return hasNormalizedAction(admin.actions, 'edit') || admin.actions.includes('manage');
    }
  }
  return false;
}

export function requireEmailPermission(...permissions: EmailPermissionKey[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const admin = req.admin;
    if (!admin) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const allowed = permissions.some((p) => hasEmailPermission(admin, p));
    if (!allowed) {
      res.status(403).json({
        error: `Insufficient Email Centre permissions: requires ${permissions.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}

export function resolveScopedDepartment(admin: AdminPrincipal, requestedDept?: string): string {
  if (admin.role === 'SUPER_ADMIN') {
    if (requestedDept && ALL_DEPARTMENTS.includes(requestedDept)) return requestedDept;
    return requestedDept === 'all' ? 'all' : 'all';
  }
  if (requestedDept && admin.departments.includes(requestedDept)) {
    return requestedDept;
  }
  return admin.primaryDepartment && admin.primaryDepartment !== 'all'
    ? admin.primaryDepartment
    : admin.departments[0] || 'platform_settings';
}

