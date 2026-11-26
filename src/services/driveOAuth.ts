import { useEffect, useState } from 'react';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  initializeAuth,
  inMemoryPersistence,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import { firebaseRuntimeConfig } from '../lib/firebase';

const DRIVE_CONNECTOR_APP_NAME = 'swas-drive-connector';

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.apps.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.install',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export interface DriveStorageQuota {
  limitBytes: number | null;
  usageBytes: number;
  usageInDriveBytes: number;
  usageInTrashBytes: number;
}

export interface DriveConnectionSnapshot {
  connected: boolean;
  accessToken: string | null;
  connectedEmail: string | null;
  displayName: string | null;
  photoUrl: string | null;
  storageQuota: DriveStorageQuota | null;
  grantedScopes: string[];
  grantedAtMs: number | null;
  expiresAtMs: number | null;
  lastError: string | null;
  checking: boolean;
}

const INITIAL_STATE: DriveConnectionSnapshot = {
  connected: false,
  accessToken: null,
  connectedEmail: null,
  displayName: null,
  photoUrl: null,
  storageQuota: null,
  grantedScopes: [],
  grantedAtMs: null,
  expiresAtMs: null,
  lastError: null,
  checking: false,
};

// Strictly in-memory OAuth state (never persisted to localStorage or sessionStorage).
let state: DriveConnectionSnapshot = { ...INITIAL_STATE };
const listeners = new Set<(snapshot: DriveConnectionSnapshot) => void>();

let connectorApp: FirebaseApp | null = null;
let connectorAuth: Auth | null = null;

function getDriveConnectorAuth(): Auth {
  if (connectorAuth) return connectorAuth;
  const existing = getApps().find((a) => a.name === DRIVE_CONNECTOR_APP_NAME);
  if (existing) {
    connectorApp = existing;
  } else {
    connectorApp = initializeApp(firebaseRuntimeConfig, DRIVE_CONNECTOR_APP_NAME);
  }
  connectorAuth = initializeAuth(connectorApp, {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  return connectorAuth;
}

function emit(): void {
  const snapshot = getDriveConnectionSnapshot();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function setState(patch: Partial<DriveConnectionSnapshot>): void {
  state = { ...state, ...patch };
  emit();
}

export function getDriveConnectionSnapshot(): DriveConnectionSnapshot {
  if (state.expiresAtMs && Date.now() >= state.expiresAtMs && state.accessToken) {
    state = {
      ...state,
      connected: false,
      accessToken: null,
      lastError: 'Google Drive session expired. Sign in with Google to reconnect.',
    };
  }
  return { ...state };
}

export function getActiveDriveAccessToken(): string | null {
  const snap = getDriveConnectionSnapshot();
  if (!snap.connected || !snap.accessToken) return null;
  return snap.accessToken;
}

export function subscribeDriveConnection(
  listener: (snapshot: DriveConnectionSnapshot) => void
): () => void {
  listeners.add(listener);
  listener(getDriveConnectionSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function clearDriveConnection(errorMessage?: string): void {
  state = {
    ...INITIAL_STATE,
    lastError: errorMessage || null,
  };
  emit();
}

export async function refreshDriveConnectionProfile(
  tokenOverride?: string | null
): Promise<DriveConnectionSnapshot> {
  const token = tokenOverride !== undefined ? tokenOverride : state.accessToken;
  if (!token) {
    clearDriveConnection();
    return getDriveConnectionSnapshot();
  }

  setState({ checking: true, lastError: null });
  try {
    const aboutRes = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (aboutRes.status === 401) {
      clearDriveConnection('Google Drive authorization expired. Please sign in with Google again.');
      throw new Error('Google Drive authorization expired. Please sign in with Google again.');
    }

    if (!aboutRes.ok) {
      const errBody = (await aboutRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new Error(
        errBody.error?.message || `Failed to verify Google Drive access (${aboutRes.status}).`
      );
    }

    const aboutData = (await aboutRes.json()) as {
      user?: { displayName?: string; emailAddress?: string; photoLink?: string };
      storageQuota?: {
        limit?: string;
        usage?: string;
        usageInDrive?: string;
        usageInDriveTrash?: string;
      };
    };

    // Inspect granted scopes and TTL via tokeninfo when available
    let grantedScopes: string[] = [];
    let ttlMs = 55 * 60 * 1000;
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: token }),
      });
      if (infoRes.ok) {
        const infoData = (await infoRes.json()) as {
          scope?: string;
          expires_in?: string | number;
        };
        if (typeof infoData.scope === 'string') {
          grantedScopes = infoData.scope.split(/\s+/).filter(Boolean);
        }
        const exp = Number(infoData.expires_in);
        if (Number.isFinite(exp) && exp > 0) {
          ttlMs = exp * 1000;
        }
      }
    } catch {
      // Non-fatal if tokeninfo cannot be reached from browser
    }

    const quota: DriveStorageQuota | null = aboutData.storageQuota
      ? {
          limitBytes: aboutData.storageQuota.limit ? Number(aboutData.storageQuota.limit) : null,
          usageBytes: Number(aboutData.storageQuota.usage || 0),
          usageInDriveBytes: Number(aboutData.storageQuota.usageInDrive || 0),
          usageInTrashBytes: Number(aboutData.storageQuota.usageInDriveTrash || 0),
        }
      : null;

    setState({
      connected: true,
      accessToken: token,
      connectedEmail: aboutData.user?.emailAddress || state.connectedEmail,
      displayName: aboutData.user?.displayName || state.displayName,
      photoUrl: aboutData.user?.photoLink || state.photoUrl,
      storageQuota: quota,
      grantedScopes,
      expiresAtMs: Date.now() + ttlMs,
      lastError: null,
      checking: false,
    });

    return getDriveConnectionSnapshot();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unable to verify Google Drive connection.';
    setState({
      checking: false,
      lastError: message,
    });
    throw err;
  }
}

export async function connectGoogleDriveAccount(): Promise<DriveConnectionSnapshot> {
  setState({ checking: true, lastError: null });
  try {
    const dAuth = getDriveConnectorAuth();
    const provider = new GoogleAuthProvider();
    for (const scope of GOOGLE_DRIVE_SCOPES) {
      provider.addScope(scope);
    }
    provider.setCustomParameters({
      prompt: 'select_account consent',
    });

    const result = await signInWithPopup(dAuth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken || null;

    if (!accessToken) {
      throw new Error(
        'Google sign-in completed without returning a Google Drive access token. Please grant Drive permissions and try again.'
      );
    }

    setState({
      accessToken,
      connectedEmail: result.user.email || null,
      displayName: result.user.displayName || null,
      photoUrl: result.user.photoURL || null,
      grantedAtMs: Date.now(),
      expiresAtMs: Date.now() + 55 * 60 * 1000,
    });

    return await refreshDriveConnectionProfile(accessToken);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Failed to connect Google Drive.';
    const friendly = rawMsg.includes('popup-closed-by-user')
      ? 'Google sign-in popup was closed before completing authorization.'
      : rawMsg.includes('popup-blocked')
      ? 'Browser blocked the Google sign-in popup. Allow popups for this site and try again.'
      : rawMsg;
    setState({
      checking: false,
      connected: false,
      lastError: friendly,
    });
    throw new Error(friendly);
  }
}

export async function disconnectGoogleDriveAccount(): Promise<void> {
  clearDriveConnection();
  try {
    if (connectorAuth) {
      await signOut(connectorAuth);
    }
  } catch {
    // Ignore secondary connector signOut errors
  }
}

export function useDriveConnection(): DriveConnectionSnapshot {
  const [snapshot, setSnapshot] = useState<DriveConnectionSnapshot>(() =>
    getDriveConnectionSnapshot()
  );

  useEffect(() => {
    return subscribeDriveConnection(setSnapshot);
  }, []);

  return snapshot;
}
