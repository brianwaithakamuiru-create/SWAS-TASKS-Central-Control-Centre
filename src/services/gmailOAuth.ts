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
import { OFFICIAL_PLATFORM_EMAIL } from '../config/platformIdentity';
import { auth, firebaseRuntimeConfig } from '../lib/firebase';
import type { GmailAuthCheckResult } from '../types/admin';

const GMAIL_CONNECTOR_APP_NAME = 'swas-gmail-connector';
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export interface GmailConnectionSnapshot {
  connected: boolean;
  accessToken: string | null;
  connectedEmail: string | null;
  matchesOfficialEmail: boolean;
  hasGmailSendScope: boolean;
  grantedAtMs: number | null;
  expiresAtMs: number | null;
  lastCheck: GmailAuthCheckResult | null;
  lastError: string | null;
  checking: boolean;
}

const INITIAL_STATE: GmailConnectionSnapshot = {
  connected: false,
  accessToken: null,
  connectedEmail: null,
  matchesOfficialEmail: false,
  hasGmailSendScope: false,
  grantedAtMs: null,
  expiresAtMs: null,
  lastCheck: null,
  lastError: null,
  checking: false,
};

// Strictly in-memory OAuth state (never persisted to localStorage or sessionStorage).
let state: GmailConnectionSnapshot = { ...INITIAL_STATE };
const listeners = new Set<(snapshot: GmailConnectionSnapshot) => void>();

let connectorApp: FirebaseApp | null = null;
let connectorAuth: Auth | null = null;

function getConnectorAuth(): Auth {
  if (connectorAuth) return connectorAuth;
  const existing = getApps().find((a) => a.name === GMAIL_CONNECTOR_APP_NAME);
  if (existing) {
    connectorApp = existing;
  } else {
    connectorApp = initializeApp(firebaseRuntimeConfig, GMAIL_CONNECTOR_APP_NAME);
  }
  connectorAuth = initializeAuth(connectorApp, {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  return connectorAuth;
}

function emit(): void {
  const snapshot = getGmailConnectionSnapshot();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function setState(patch: Partial<GmailConnectionSnapshot>): void {
  state = { ...state, ...patch };
  emit();
}

export function getGmailConnectionSnapshot(): GmailConnectionSnapshot {
  if (state.expiresAtMs && Date.now() >= state.expiresAtMs && state.accessToken) {
    state = {
      ...state,
      connected: false,
      accessToken: null,
      lastError: 'Gmail authorization session expired. Reconnect swastaskorg@gmail.com to continue sending via Gmail.',
    };
  }
  return { ...state };
}

export function getActiveGmailAccessToken(): string | null {
  const snap = getGmailConnectionSnapshot();
  if (!snap.connected || !snap.accessToken) return null;
  if (!snap.matchesOfficialEmail) return null;
  return snap.accessToken;
}

export function subscribeGmailConnection(
  listener: (snapshot: GmailConnectionSnapshot) => void
): () => void {
  listeners.add(listener);
  listener(getGmailConnectionSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function clearGmailConnection(): void {
  state = { ...INITIAL_STATE };
  emit();
}

export async function verifyGmailConnectionWithBackend(
  tokenOverride?: string | null
): Promise<GmailAuthCheckResult> {
  const token = tokenOverride !== undefined ? tokenOverride : state.accessToken;
  setState({ checking: true });
  try {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }
    if (token) {
      headers['X-Gmail-Access-Token'] = token;
    }

    const res = await fetch('/api/v1/admin/email/gmail-auth-check', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const data = (await res.json().catch(() => ({}))) as GmailAuthCheckResult & { error?: string };
    if (!res.ok) {
      throw new Error(data.error || `Authorization check failed (${res.status}).`);
    }

    const validForSending =
      Boolean(token) &&
      data.authorized &&
      data.hasGmailSendScope &&
      data.matchesOfficialEmail;

    const ttlMs =
      typeof data.expiresInSeconds === 'number' && data.expiresInSeconds > 0
        ? data.expiresInSeconds * 1000
        : 55 * 60 * 1000;

    let derivedError: string | null = data.error || null;
    if (token && data.authorized && !data.matchesOfficialEmail) {
      derivedError = `Connected Google account (${data.connectedEmail || 'unknown'}) does not match the official organization email (${OFFICIAL_PLATFORM_EMAIL}). Reconnect and choose ${OFFICIAL_PLATFORM_EMAIL}.`;
    } else if (token && data.authorized && !data.hasGmailSendScope) {
      derivedError = 'Gmail sending permission was not granted during sign-in. Reconnect and allow Gmail send access.';
    }

    setState({
      connected: validForSending,
      accessToken: token || null,
      connectedEmail: data.connectedEmail || state.connectedEmail,
      matchesOfficialEmail: Boolean(data.matchesOfficialEmail),
      hasGmailSendScope: Boolean(data.hasGmailSendScope),
      expiresAtMs: token ? Date.now() + ttlMs : null,
      lastCheck: data,
      lastError: derivedError,
      checking: false,
    });

    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to verify Gmail authorization.';
    setState({
      checking: false,
      lastError: message,
    });
    throw err;
  }
}

export async function connectOfficialGmailAccount(): Promise<GmailConnectionSnapshot> {
  setState({ checking: true, lastError: null });
  try {
    const cAuth = getConnectorAuth();
    const provider = new GoogleAuthProvider();
    provider.addScope(GMAIL_SEND_SCOPE);
    provider.addScope(USERINFO_EMAIL_SCOPE);
    provider.setCustomParameters({
      login_hint: OFFICIAL_PLATFORM_EMAIL,
      prompt: 'select_account consent',
    });

    const result = await signInWithPopup(cAuth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken || null;
    const signedEmail = (result.user.email || '').trim().toLowerCase();

    if (!accessToken) {
      throw new Error(
        'Google sign-in completed without returning a Gmail access token. Please reconnect and grant Gmail sending permission.'
      );
    }

    setState({
      accessToken,
      connectedEmail: signedEmail || OFFICIAL_PLATFORM_EMAIL,
      grantedAtMs: Date.now(),
      expiresAtMs: Date.now() + 55 * 60 * 1000,
    });

    await verifyGmailConnectionWithBackend(accessToken);
    return getGmailConnectionSnapshot();
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Failed to connect Gmail account.';
    const friendly =
      rawMsg.includes('popup-closed-by-user')
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

export async function disconnectOfficialGmailAccount(): Promise<void> {
  clearGmailConnection();
  try {
    if (connectorAuth) {
      await signOut(connectorAuth);
    }
  } catch {
    // Ignore secondary connector signOut errors
  }
}

export function useGmailConnection(): GmailConnectionSnapshot {
  const [snapshot, setSnapshot] = useState<GmailConnectionSnapshot>(() =>
    getGmailConnectionSnapshot()
  );

  useEffect(() => {
    return subscribeGmailConnection(setSnapshot);
  }, []);

  return snapshot;
}
