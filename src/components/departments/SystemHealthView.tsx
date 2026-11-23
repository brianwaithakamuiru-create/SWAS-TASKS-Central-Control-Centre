import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { firebaseRuntimeConfig, testConnection } from '../../lib/firebase';
import { StatusText } from '../common/StatusText';

interface BackendStatusResponse {
  service: string;
  status: string;
  timestamp: string;
  uptimeSeconds: number;
  latencyMs: number;
  messaging?: {
    emailConfigured: boolean;
    emailProvider: string;
    emailStatusLabel?: string;
    officialEmail?: string;
  };
  firebase: {
    projectId: string;
    databaseId: string;
    storageBucket: string;
    firestoreReachable: boolean;
    firestoreError: string | null;
  };
}

export function SystemHealthView() {
  const [backendStatus, setBackendStatus] = useState<BackendStatusResponse | null>(null);
  const [clientFirestoreOk, setClientFirestoreOk] = useState<boolean | null>(null);
  const [clientFirestoreErr, setClientFirestoreErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const runHealthChecks = async () => {
    setChecking(true);
    try {
      const [apiRes, clientRes] = await Promise.all([
        fetch('/api/v1/platform/status').then((r) => r.json() as Promise<BackendStatusResponse>),
        testConnection(),
      ]);
      setBackendStatus(apiRes);
      setClientFirestoreOk(clientRes.ok);
      setClientFirestoreErr(clientRes.error || null);
    } catch (err) {
      setClientFirestoreErr(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void runHealthChecks();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46]">
            System Status & Technical Health
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Verified connectivity across Express REST API, Firebase Auth, Cloud Firestore, Firebase Storage, and Official Email Delivery.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void runHealthChecks()}
          disabled={checking}
          className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
          Verify Connectivity
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Backend API Server</p>
          <div className="mt-2">
            <StatusText status={backendStatus?.status || 'degraded'} />
          </div>
          <p className="mt-1 typo-meta font-mono text-[#75869D]">
            {backendStatus ? `Uptime: ${backendStatus.uptimeSeconds}s` : 'Checking...'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Client SDK Firestore</p>
          <div className="mt-2">
            <StatusText
              status={clientFirestoreOk ? 'connected' : clientFirestoreOk === false ? 'error' : 'pending'}
              label={clientFirestoreOk ? 'Connected' : clientFirestoreOk === false ? 'Error' : 'Checking'}
            />
          </div>
          <p className="mt-1 typo-meta font-mono text-[#75869D] truncate">
            {firebaseRuntimeConfig.firestoreDatabaseId}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Server Firestore REST</p>
          <div className="mt-2">
            <StatusText
              status={backendStatus?.firebase.firestoreReachable ? 'connected' : 'error'}
              label={backendStatus?.firebase.firestoreReachable ? 'Reachable' : 'Unavailable'}
            />
          </div>
          <p className="mt-1 typo-meta font-mono text-[#75869D]">
            {backendStatus ? `${backendStatus.latencyMs} ms` : '—'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Firebase Storage</p>
          <div className="mt-2">
            <StatusText
              status={firebaseRuntimeConfig.storageBucket ? 'connected' : 'error'}
              label={firebaseRuntimeConfig.storageBucket ? 'Configured' : 'Missing'}
            />
          </div>
          <p className="mt-1 typo-meta font-mono text-[#75869D] truncate">
            {firebaseRuntimeConfig.storageBucket}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Official Email Service</p>
          <div className="mt-2">
            <StatusText
              status={backendStatus?.messaging?.emailConfigured ? 'connected' : 'not_configured'}
              label={
                backendStatus?.messaging?.emailConfigured
                  ? backendStatus.messaging.emailProvider
                  : 'EMAIL SERVICE NOT CONFIGURED'
              }
            />
          </div>
          <p className="mt-1 typo-meta font-mono text-[#75869D] truncate">
            {backendStatus?.messaging?.officialEmail || 'swastaskorg@gmail.com'}
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <h2 className="typo-card-heading text-[#172B46]">
          Environment & Diagnostic Details
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 typo-meta">
          <div className="p-3 rounded bg-[#F3F6FA] border border-slate-200">
            <dt className="text-[#75869D]">Firebase Project ID</dt>
            <dd className="mt-1 font-mono text-[#172B46]">{firebaseRuntimeConfig.projectId}</dd>
          </div>
          <div className="p-3 rounded bg-[#F3F6FA] border border-slate-200">
            <dt className="text-[#75869D]">Official Platform Email</dt>
            <dd className="mt-1 font-mono text-[#172B46]">
              {backendStatus?.messaging?.officialEmail || 'swastaskorg@gmail.com'}
            </dd>
          </div>
          <div className="p-3 rounded bg-[#F3F6FA] border border-slate-200">
            <dt className="text-[#75869D]">Last Verified Timestamp</dt>
            <dd className="mt-1 tabular-nums text-[#172B46]">
              {backendStatus ? new Date(backendStatus.timestamp).toLocaleString() : '—'}
            </dd>
          </div>
        </dl>
        {clientFirestoreErr || backendStatus?.firebase.firestoreError ? (
          <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-[#D34552]">
            {clientFirestoreErr || backendStatus?.firebase.firestoreError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
