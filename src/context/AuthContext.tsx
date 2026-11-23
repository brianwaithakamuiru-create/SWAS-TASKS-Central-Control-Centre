import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { apiFetch } from '../services/firestoreService';
import type { AdminAction, AdminUser, DepartmentId, EightDepartmentId } from '../types/admin';

interface AuthContextValue {
  firebaseUser: User | null;
  adminProfile: AdminUser | null;
  isSuperAdmin: boolean;
  canManageStaff: boolean;
  primaryDepartment: EightDepartmentId | null;
  loading: boolean;
  authError: string | null;
  sessionExpired: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  sendResetEmail: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  hasDepartment: (dept: DepartmentId) => boolean;
  hasAction: (action: AdminAction) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_IDLE_MS = 60 * 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [adminProfile, setAdminProfile] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const verifyBackendAdmin = useCallback(async (user: User) => {
    try {
      const profile = await apiFetch<AdminUser>('/api/v1/admin/me');
      setAdminProfile(profile);
      setAuthError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // Do not fall back if the server explicitly revoked session or suspended the staff member
      if (
        msg.toLowerCase().includes('revoked') ||
        msg.toLowerCase().includes('suspended') ||
        msg.toLowerCase().includes('deactivated')
      ) {
        setAdminProfile(null);
        setAuthError(msg);
        return;
      }

      // Fallback check via Firestore directly if Express server restarted mid-request
      try {
        const snap = await getDoc(doc(db, 'admin_users', user.uid));
        if (snap.exists() && snap.data().status === 'active') {
          setAdminProfile(snap.data() as AdminUser);
          setAuthError(null);
          return;
        }
      } catch {
        // ignore fallback error, surface backend authorization message
      }
      setAdminProfile(null);
      setAuthError(
        msg || 'Your account is not authorized as a SWAS TASKS administrator.'
      );
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (auth.currentUser) {
      await verifyBackendAdmin(auth.currentUser);
    }
  }, [verifyBackendAdmin]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      setFirebaseUser(user);
      if (user) {
        setSessionExpired(false);
        await verifyBackendAdmin(user);
      } else {
        setAdminProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [verifyBackendAdmin]);

  // Idle session expiration monitor
  useEffect(() => {
    if (!firebaseUser) return;
    let timer = window.setTimeout(() => {
      setSessionExpired(true);
      void signOut(auth);
    }, SESSION_IDLE_MS);

    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setSessionExpired(true);
        void signOut(auth);
      }, SESSION_IDLE_MS);
    };

    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'click', 'scroll'];
    for (const evt of events) {
      window.addEventListener(evt, resetTimer, { passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const evt of events) {
        window.removeEventListener(evt, resetTimer);
      }
    };
  }, [firebaseUser]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    setSessionExpired(false);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setAuthError(msg);
      throw err;
    }
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    setSessionExpired(false);

    const lockCheck = await apiFetch<{ locked: boolean; lockedUntil?: string }>(
      '/api/v1/auth/log-attempt',
      {
        method: 'POST',
        body: JSON.stringify({ email, outcome: 'check' }),
      }
    ).catch(() => ({ locked: false, lockedUntil: undefined }));

    if (lockCheck.locked) {
      const msg = `Account verification temporarily locked due to repeated failed attempts until ${lockCheck.lockedUntil || 'later'}.`;
      setAuthError(msg);
      throw new Error(msg);
    }

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      await apiFetch('/api/v1/auth/log-attempt', {
        method: 'POST',
        body: JSON.stringify({ email, outcome: 'failed' }),
      }).catch(() => undefined);

      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes('auth/operation-not-allowed')) {
        const guidance =
          'Email/Password sign-in is not yet enabled in the Firebase Console (Authentication → Sign-in method). Use Google Sign-In or enable Email/Password in Firebase Console.';
        setAuthError(guidance);
        throw new Error(guidance);
      }
      setAuthError(raw);
      throw err;
    }
  }, []);

  const sendResetEmail = useCallback(async (email: string) => {
    setAuthError(null);
    await sendPasswordResetEmail(auth, email.trim());
  }, []);

  const logout = useCallback(async () => {
    setAuthError(null);
    setAdminProfile(null);
    await signOut(auth);
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const isSuperAdmin = Boolean(
    adminProfile && adminProfile.status === 'active' && adminProfile.role === 'SUPER_ADMIN'
  );

  const primaryDepartment: EightDepartmentId | null =
    adminProfile &&
    adminProfile.status === 'active' &&
    adminProfile.primaryDepartment &&
    adminProfile.primaryDepartment !== 'all'
      ? adminProfile.primaryDepartment
      : adminProfile &&
        adminProfile.status === 'active' &&
        adminProfile.role !== 'SUPER_ADMIN' &&
        adminProfile.departments[0] &&
        adminProfile.departments[0] !== 'overview' &&
        adminProfile.departments[0] !== 'staff_management' &&
        adminProfile.departments[0] !== 'system_health' &&
        adminProfile.departments[0] !== 'support_announcements'
      ? (adminProfile.departments[0] as EightDepartmentId)
      : null;

  const hasDepartment = useCallback(
    (dept: DepartmentId) => {
      if (!adminProfile || adminProfile.status !== 'active') return false;
      if (adminProfile.role === 'SUPER_ADMIN') return true;
      // Department staff are strictly isolated to their single assigned department workplace
      if (
        dept === 'overview' ||
        dept === 'staff_management' ||
        dept === 'system_health' ||
        dept === 'support_announcements'
      ) {
        return false;
      }
      if (primaryDepartment) {
        return dept === primaryDepartment;
      }
      return adminProfile.departments.includes(dept);
    },
    [adminProfile, primaryDepartment]
  );

  const hasAction = useCallback(
    (action: AdminAction) => {
      if (!adminProfile || adminProfile.status !== 'active') return false;
      if (adminProfile.role === 'SUPER_ADMIN') return true;
      const acts = adminProfile.actions || [];
      if (acts.includes('manage')) return true;
      if (action === 'view' || action === 'read') {
        return acts.includes('view') || acts.includes('read');
      }
      if (action === 'edit' || action === 'update') {
        return acts.includes('edit') || acts.includes('update');
      }
      return acts.includes(action);
    },
    [adminProfile]
  );

  const canManageStaff = Boolean(
    isSuperAdmin ||
      (adminProfile &&
        adminProfile.status === 'active' &&
        primaryDepartment === 'user_management' &&
        adminProfile.actions?.includes('manage'))
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        adminProfile,
        isSuperAdmin,
        canManageStaff,
        primaryDepartment,
        loading,
        authError,
        sessionExpired,
        signInWithGoogle,
        signInWithEmail,
        sendResetEmail,
        refreshProfile,
        logout,
        clearAuthError,
        hasDepartment,
        hasAction,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
