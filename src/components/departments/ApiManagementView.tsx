import React, { useEffect, useState } from 'react';
import {
  Activity,
  Copy,
  ExternalLink,
  Gauge,
  Globe,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { EIGHT_DEPARTMENTS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  apiFetch,
  deleteWebhookConfig,
  saveConnectedApp,
  saveWebhookConfig,
} from '../../services/firestoreService';
import type {
  ApiKeyRecord,
  ApiLogRecord,
  ConnectedApp,
  EmailTemplateRecord,
  WebhookConfig,
} from '../../types/admin';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';
import { TablePagination, usePaginatedList } from '../common/TablePagination';
import { DepartmentEmailModal } from './DepartmentEmailModal';

interface ApiManagementViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  apiKeys: ApiKeyRecord[];
  connectedApps: ConnectedApp[];
  webhooks: WebhookConfig[];
  apiLogs: ApiLogRecord[];
  emailTemplates?: EmailTemplateRecord[];
}

const AVAILABLE_SCOPES = [
  'public:config:read',
  'tasks:read',
  'tasks:write',
  'users:read',
  'clients:read',
  'bids:read',
  'assignments:read',
  'finance:read',
  'webhooks:write',
];

export function ApiManagementView({
  subId,
  onSelectSub,
  apiKeys,
  connectedApps,
  webhooks,
  apiLogs,
  emailTemplates = [],
}: ApiManagementViewProps) {
  const { adminProfile, hasAction, hasEmailPermission } = useAuth();
  const canEmail = hasEmailPermission('email.send') || hasEmailPermission('email.send_bulk');
  const subdepartments =
    EIGHT_DEPARTMENTS.find((d) => d.id === 'api_management')?.subdepartments || [];

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailDefaults, setEmailDefaults] = useState<{ subject: string; body: string }>({
    subject: '',
    body: '',
  });

  const [keyName, setKeyName] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>(['public:config:read', 'tasks:read']);
  const [rateLimit, setRateLimit] = useState('120');
  const [expiresAt, setExpiresAt] = useState('');
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [appName, setAppName] = useState('SWAS TASKS Public Website');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState(window.location.origin);
  const [allowedOriginsText, setAllowedOriginsText] = useState('');

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEventsText, setWebhookEventsText] = useState('task.published, withdrawal.approved');

  const [openApiJson, setOpenApiJson] = useState<Record<string, unknown> | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (subId === 'api_documentation' && !openApiJson) {
      fetch('/api/v1/openapi.json')
        .then((r) => r.json())
        .then((data) => setOpenApiJson(data as Record<string, unknown>))
        .catch(() => undefined);
    }
  }, [subId, openApiJson]);

  const activeKeys = apiKeys.filter((k) => k.status === 'active');
  const failedLogs = apiLogs.filter((l) => l.statusCode >= 400);
  const displayedLogs = subId === 'failed_requests' ? failedLogs : apiLogs;
  const logsPagination = usePaginatedList(displayedLogs, 15);
  const keysPagination = usePaginatedList(apiKeys, 15);

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setOneTimeSecret(null);
    try {
      const res = await apiFetch<{ apiKey: ApiKeyRecord; plaintextSecretOnce: string }>(
        '/api/v1/admin/api-keys/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            name: keyName.trim(),
            scopes: keyScopes,
            rateLimitPerMin: Number(rateLimit || 120),
            expiresAt: expiresAt || undefined,
          }),
        }
      );
      setOneTimeSecret(res.plaintextSecretOnce);
      setKeyName('');
      setFeedback({ type: 'ok', text: `Generated API key "${res.apiKey.name}".` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to generate key',
      });
    }
  };

  const handleRotateKey = async (keyId: string) => {
    setFeedback(null);
    setOneTimeSecret(null);
    try {
      const res = await apiFetch<{ plaintextSecretOnce: string }>(
        `/api/v1/admin/api-keys/${keyId}/rotate`,
        { method: 'POST' }
      );
      setOneTimeSecret(res.plaintextSecretOnce);
      setFeedback({ type: 'ok', text: 'API key rotated. Copy the new secret immediately.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Rotate failed' });
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/v1/admin/api-keys/${keyId}/revoke`, { method: 'POST' });
      setFeedback({ type: 'ok', text: 'API key revoked immediately.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Revoke failed' });
    }
  };

  const handleSaveConnectedApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminProfile) return;
    setFeedback(null);
    const origins = allowedOriginsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await saveConnectedApp(adminProfile, {
        appId: 'swas_public_website',
        name: appName.trim(),
        websiteUrl: websiteUrl.trim(),
        apiBaseUrl: apiBaseUrl.trim(),
        allowedOrigins: origins.length ? origins : [websiteUrl.trim()],
        status: 'connected',
      });
      setFeedback({ type: 'ok', text: 'Connected public website configuration saved.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminProfile) return;
    setFeedback(null);
    const events = webhookEventsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await saveWebhookConfig(adminProfile, {
        url: webhookUrl.trim(),
        events,
        active: true,
      });
      setWebhookUrl('');
      setFeedback({ type: 'ok', text: 'Webhook endpoint saved.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="typo-page-heading text-[#172B46]">
            API Management
          </h1>
          <p className="mt-1 typo-body text-[#75869D]">
            Cryptographic API credentials, public SWAS TASKS website integration, CORS origins, webhooks, and OpenAPI documentation.
          </p>
        </div>
        {canEmail ? (
          <button
            type="button"
            onClick={() => {
              setEmailDefaults({
                subject: 'SWAS TASKS API Integration Notice',
                body: 'Hello,\n\nPlease review the following API integration / security update from the SWAS TASKS Central Control Centre:\n\n',
              });
              setEmailModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 typo-button text-[#172B46] bg-white border border-slate-200 hover:bg-[#E9F2FF] rounded-md whitespace-nowrap self-start sm:self-auto"
          >
            <Mail className="w-3.5 h-3.5 text-[#1265C8]" />
            Notify Developer / Admin
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {subdepartments.map((sub) => (
          <button
            key={sub.id}
            type="button"
            onClick={() => onSelectSub(sub.id)}
            className={`px-3 py-1.5 typo-nav rounded-md whitespace-nowrap transition-colors shrink-0 ${
              subId === sub.id
                ? 'bg-[#1265C8] text-white'
                : 'bg-white border border-slate-200 text-[#172B46] hover:bg-[#E9F2FF]'
            }`}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {feedback ? (
        <div
          className={`p-3 rounded-md typo-meta border ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-[#15966B]'
              : 'bg-red-50 border-red-200 text-[#D34552]'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {oneTimeSecret ? (
        <div className="p-4 rounded-lg bg-[#E9F2FF] border border-[#1265C8] space-y-2">
          <div className="flex items-center justify-between">
            <p className="typo-label font-semibold text-[#102B50]">
              One-Time API Secret Key (Displayed Once Only)
            </p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(oneTimeSecret);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 typo-button bg-[#1265C8] text-white rounded"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied' : 'Copy Secret'}
            </button>
          </div>
          <p className="font-mono typo-meta break-all bg-white border border-slate-200 p-2.5 rounded text-[#172B46]">
            {oneTimeSecret}
          </p>
          <p className="typo-small text-[#75869D]">
            Store this credential in your public website server secrets. Only its HMAC-SHA256 hash
            is persisted in Firestore.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Active API Keys</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#172B46]">
            {activeKeys.length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Connected Websites</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#15966B]">
            {connectedApps.filter((a) => a.status === 'connected').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Active Webhooks</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#1265C8]">
            {webhooks.filter((w) => w.active).length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="typo-meta text-[#75869D]">Failed Requests (4xx/5xx)</p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-[#D34552]">
            {failedLogs.length}
          </p>
        </div>
      </div>

      {subId === 'dashboard' || subId === 'api_overview' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="typo-card-heading text-[#172B46]">
              Integration Controls & Quick Actions
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { id: 'create_api_key', label: 'Create API Key', sub: 'Issue scoped credential', icon: KeyRound },
                { id: 'connected_websites', label: 'Connected Websites', sub: `${connectedApps.length} registered`, icon: Globe },
                { id: 'webhooks', label: 'Webhooks', sub: `${webhooks.length} endpoints`, icon: Activity },
                { id: 'rate_limits', label: 'Rate Limits & Security', sub: 'Inspect policies', icon: Gauge },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => onSelectSub(card.id)}
                    className="p-4 rounded-md border border-slate-200 hover:border-[#1265C8] hover:bg-[#E9F2FF]/40 text-left flex items-center gap-3 transition-colors"
                  >
                    <Icon className="w-4 h-4 text-[#1265C8] shrink-0" />
                    <div>
                      <p className="typo-body font-medium text-[#172B46]">{card.label}</p>
                      <p className="typo-meta text-[#75869D]">{card.sub}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="typo-card-heading text-[#172B46]">
                Recent API Telemetry
              </h2>
              <button
                type="button"
                onClick={() => onSelectSub('api_logs')}
                className="typo-meta font-medium text-[#1265C8] hover:underline"
              >
                Full Logs
              </button>
            </div>
            {apiLogs.length === 0 ? (
              <p className="typo-meta text-[#75869D]">
                No API requests logged yet. Server-to-server requests from connected apps appear here.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {apiLogs.slice(0, 6).map((l) => (
                  <div key={l.logId} className="py-2 flex items-center justify-between typo-meta">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-semibold text-[#172B46]">{l.method}</span>
                      <span className="font-mono text-[#75869D] truncate">{l.path}</span>
                    </div>
                    <span className="font-mono tabular-nums text-[#172B46]">
                      {l.statusCode} · {l.durationMs || 0}ms
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : subId === 'api_documentation' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <h2 className="typo-card-heading text-[#172B46]">
                Swagger / OpenAPI 3.1 Reference
              </h2>
              <p className="typo-meta text-[#75869D]">
                Live REST API endpoints exposed by the Central Control Centre Express server.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/api/docs"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-button text-white bg-[#1265C8] rounded-md"
              >
                Open /api/docs
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <a
                href="/api/v1/openapi.json"
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 typo-meta font-medium text-[#172B46] bg-slate-100 rounded-md font-mono"
              >
                openapi.json
              </a>
            </div>
          </div>

          <div className="space-y-2.5">
            {openApiJson && typeof openApiJson.paths === 'object' && openApiJson.paths !== null
              ? Object.entries(openApiJson.paths as Record<string, Record<string, { summary?: string }>>).map(
                  ([routePath, methods]) =>
                    Object.entries(methods).map(([method, info]) => (
                      <div
                        key={`${method}_${routePath}`}
                        className="p-3 rounded-md border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`px-2 py-0.5 typo-small font-mono font-semibold uppercase rounded text-white ${
                              method === 'get' ? 'bg-[#1265C8]' : 'bg-[#15966B]'
                            }`}
                          >
                            {method}
                          </span>
                          <code className="typo-meta font-mono text-[#172B46]">
                            /api/v1{routePath}
                          </code>
                        </div>
                        <span className="typo-meta text-[#75869D]">{info.summary}</span>
                      </div>
                    ))
                )
              : null}
          </div>
        </div>
      ) : subId === 'api_permissions' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h2 className="typo-card-heading text-[#172B46]">
            API Scope & Permission Matrix
          </h2>
          <p className="typo-meta text-[#75869D]">
            Every cryptographic API key is constrained to its granted scopes. Keys without a required scope receive HTTP 403.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full typo-table">
              <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Scope Identifier</th>
                  <th className="px-4 py-3 font-medium">Active Keys Granting Scope</th>
                  <th className="px-4 py-3 font-medium">Authorized Operations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {AVAILABLE_SCOPES.map((sc) => {
                  const count = activeKeys.filter((k) => k.scopes.includes(sc)).length;
                  return (
                    <tr key={sc}>
                      <td className="px-4 py-3 font-mono text-xs text-[#172B46]">{sc}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-xs">{count}</td>
                      <td className="px-4 py-3 text-xs text-[#75869D]">
                        {sc.endsWith(':read')
                          ? 'Read-only REST query access'
                          : 'Mutating / webhook dispatch access'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : subId === 'rate_limits' || subId === 'api_security' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#1265C8] shrink-0 mt-0.5" />
            <div>
              <h2 className="typo-card-heading text-[#172B46]">
                {subId === 'rate_limits'
                  ? 'Per-Key & Global API Rate Limits'
                  : 'Cryptographic Hashing & API Security Controls'}
              </h2>
              <p className="typo-meta text-[#75869D] mt-1">
                Server middleware enforces Helmet security headers, strict CORS origin validation,
                HMAC-SHA256 secret hashing, and sliding-window rate limits per API credential.
              </p>
            </div>
          </div>

          {apiKeys.length === 0 ? (
            <EmptyState
              title="No API Keys Configured"
              description="Issue an API key to inspect active rate-limit quotas and rotation posture."
            />
          ) : (
            <table className="w-full typo-table">
              <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Key Name</th>
                  <th className="px-4 py-3 font-medium">Prefix</th>
                  <th className="px-4 py-3 font-medium">Configured Limit</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {apiKeys.map((k) => (
                  <tr key={k.keyId}>
                    <td className="px-4 py-3 font-medium text-[#172B46]">{k.name}</td>
                    <td className="px-4 py-3 font-mono typo-meta">{k.prefix}…</td>
                    <td className="px-4 py-3 font-mono tabular-nums typo-meta">
                      {k.rateLimitPerMin} req / min
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={k.status} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums typo-meta text-[#75869D]">
                      {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'No expiry'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : subId === 'connected_websites' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={handleSaveConnectedApp}
            className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
          >
            <h2 className="typo-card-heading text-[#172B46]">
              SWAS TASKS Public Website Connection
            </h2>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Application Name
              </label>
              <input
                type="text"
                required
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Public Website URL
              </label>
              <input
                type="url"
                required
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://swastasks.example.com"
                className="w-full px-3 py-2 typo-input font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Backend API Base URL
              </label>
              <input
                type="url"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Allowed CORS Origins (comma-separated)
              </label>
              <input
                type="text"
                value={allowedOriginsText}
                onChange={(e) => setAllowedOriginsText(e.target.value)}
                placeholder="https://swastasks.example.com"
                className="w-full px-3 py-2 typo-input font-mono border border-slate-300 rounded-md"
              />
            </div>
            <button
              type="submit"
              disabled={!hasAction('update')}
              className="px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
            >
              Save Connection Settings
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="typo-card-heading text-[#172B46] mb-4">
              Registered Applications
            </h2>
            {connectedApps.length === 0 ? (
              <EmptyState
                title="No Connected Websites Registered"
                description="Register your SWAS TASKS public website URL and allowed origins to track integration health."
              />
            ) : (
              <div className="space-y-3">
                {connectedApps.map((app) => (
                  <div key={app.appId} className="p-4 rounded-md border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold typo-body text-[#172B46]">{app.name}</p>
                      <StatusText status={app.status} />
                    </div>
                    <p className="typo-meta font-mono text-[#1265C8]">{app.websiteUrl}</p>
                    <p className="typo-meta text-[#75869D]">
                      Origins: <span className="font-mono">{app.allowedOrigins.join(', ')}</span>
                    </p>
                    {canEmail ? (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEmailDefaults({
                              subject: `Integration Update: ${app.name}`,
                              body: `Hello,\n\nRegarding connected application ${app.name} (${app.websiteUrl}):\n\n`,
                            });
                            setEmailModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#1265C8] hover:underline"
                        >
                          <Mail className="w-3 h-3" />
                          Email Integration Contact
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : subId === 'webhooks' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleSaveWebhook}
            className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 h-fit"
          >
            <h2 className="typo-card-heading text-[#172B46]">
              Configure Webhook
            </h2>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Endpoint URL (HTTPS)
              </label>
              <input
                type="url"
                required
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://swastasks.example.com/webhooks/admin"
                className="w-full px-3 py-2 typo-input font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Subscribed Events (comma-separated)
              </label>
              <input
                type="text"
                value={webhookEventsText}
                onChange={(e) => setWebhookEventsText(e.target.value)}
                className="w-full px-3 py-2 typo-input font-mono border border-slate-300 rounded-md"
              />
            </div>
            <button
              type="submit"
              disabled={!hasAction('update')}
              className="w-full px-4 py-2 typo-button text-white bg-[#1265C8] rounded-md disabled:opacity-50"
            >
              Add Webhook
            </button>
          </form>

          <div className="lg:col-span-2">
            {webhooks.length === 0 ? (
              <EmptyState
                title="No Webhooks Configured"
                description="Add an HTTPS webhook endpoint to notify your SWAS TASKS public website when tasks, withdrawals, or policies update."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
                {webhooks.map((w) => (
                  <div key={w.webhookId} className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-[#172B46] truncate">{w.url}</p>
                      <p className="text-xs text-[#75869D] mt-1">
                        Events: {w.events.join(', ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <StatusText status={w.active ? 'active' : 'inactive'} />
                      {adminProfile && hasAction('revoke') ? (
                        <button
                          type="button"
                          onClick={() => void deleteWebhookConfig(adminProfile, w.webhookId)}
                          className="text-[#D34552] hover:opacity-80 p-1"
                          aria-label="Delete webhook"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : subId === 'api_logs' || subId === 'api_requests' || subId === 'failed_requests' ? (
        displayedLogs.length === 0 ? (
          <EmptyState
            title="No API Request Logs Recorded"
            description="Verified API request telemetry and failed request diagnostics appear here."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full typo-table">
              <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Path</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Duration</th>
                  <th className="px-4 py-3 font-medium text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logsPagination.pagedItems.map((l) => (
                  <tr key={l.logId}>
                    <td className="px-4 py-3 font-mono font-semibold">{l.method}</td>
                    <td className="px-4 py-3 font-mono typo-meta">{l.path}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{l.statusCode}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {l.durationMs || 0} ms
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums typo-meta text-[#75869D]">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              page={logsPagination.page}
              pageSize={logsPagination.pageSize}
              totalItems={logsPagination.totalItems}
              totalPages={logsPagination.totalPages}
              onPageChange={logsPagination.setPage}
              onPageSizeChange={logsPagination.setPageSize}
            />
          </div>
        )
      ) : subId === 'key_rotation' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="typo-card-heading text-[#172B46]">
              Cryptographic Key Rotation Schedule
            </h2>
            <p className="typo-meta text-[#75869D]">
              Rotating an active API key immediately invalidates its previous hash and returns a new one-time secret.
            </p>
          </div>
          {activeKeys.length === 0 ? (
            <EmptyState
              title="No Active Keys Available for Rotation"
              description="Generate a cryptographic API key first."
            />
          ) : (
            <table className="w-full typo-table">
              <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Key Name</th>
                  <th className="px-4 py-3 font-medium">Prefix</th>
                  <th className="px-4 py-3 font-medium">Last Updated</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeKeys.map((k) => (
                  <tr key={k.keyId}>
                    <td className="px-4 py-3 font-medium text-[#172B46]">{k.name}</td>
                    <td className="px-4 py-3 font-mono typo-meta">{k.prefix}…</td>
                    <td className="px-4 py-3 tabular-nums typo-meta text-[#75869D]">
                      {new Date(k.updatedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {hasAction('update') ? (
                        <button
                          type="button"
                          onClick={() => void handleRotateKey(k.keyId)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#1265C8] hover:underline"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Rotate Secret Now
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        /* API Keys & Create API Key */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleGenerateKey}
            className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 h-fit"
          >
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#1265C8]" />
              <h2 className="typo-card-heading text-[#172B46]">
                Generate API Key
              </h2>
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">Key Label</label>
              <input
                type="text"
                required
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. SWAS Public Website Production"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Rate Limit (requests/min)
              </label>
              <input
                type="number"
                min={1}
                max={100000}
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md font-mono"
              />
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Expiration Date (optional)
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>

            <div>
              <label className="block typo-label text-[#172B46] mb-1.5">
                Authorized Scopes
              </label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-md p-2.5">
                {AVAILABLE_SCOPES.map((sc) => (
                  <label key={sc} className="flex items-center gap-2 typo-meta font-mono text-[#172B46]">
                    <input
                      type="checkbox"
                      checked={keyScopes.includes(sc)}
                      onChange={(e) => {
                        setKeyScopes((prev) =>
                          e.target.checked ? [...prev, sc] : prev.filter((item) => item !== sc)
                        );
                      }}
                    />
                    <span>{sc}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={!hasAction('create')}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Issue Cryptographic Key
            </button>
          </form>

          <div className="lg:col-span-2">
            {apiKeys.length === 0 ? (
              <EmptyState
                title="No API Credentials Issued"
                description="Generate a cryptographic API key to authorize server-to-server integration with the SWAS TASKS public website."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Key Name</th>
                      <th className="px-4 py-3 font-medium">Prefix</th>
                      <th className="px-4 py-3 font-medium">Rate Limit</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {keysPagination.pagedItems.map((k) => (
                      <tr key={k.keyId}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#172B46]">{k.name}</p>
                          <p className="text-[11px] font-mono text-[#75869D]">
                            {k.scopes.join(', ')}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{k.prefix}…</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-xs">
                          {k.rateLimitPerMin}/min
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={k.status} />
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {hasAction('update') && k.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() => void handleRotateKey(k.keyId)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#1265C8] hover:underline"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Rotate
                            </button>
                          ) : null}
                          {hasAction('revoke') && k.status !== 'revoked' ? (
                            <button
                              type="button"
                              onClick={() => void handleRevokeKey(k.keyId)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#D34552] hover:underline"
                            >
                              <ShieldAlert className="w-3 h-3" />
                              Revoke
                            </button>
                          ) : null}
                          {canEmail ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEmailDefaults({
                                  subject: `API Key Security Notice: ${k.name} (${k.prefix}...)`,
                                  body: `Hello,\n\nThis notice concerns API credential "${k.name}" (prefix: ${k.prefix}..., status: ${k.status}, rate limit: ${k.rateLimitPerMin}/min):\n\n`,
                                });
                                setEmailModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#1265C8] hover:underline"
                            >
                              <Mail className="w-3 h-3" />
                              Email
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination
                  page={keysPagination.page}
                  pageSize={keysPagination.pageSize}
                  totalItems={keysPagination.totalItems}
                  totalPages={keysPagination.totalPages}
                  onPageChange={keysPagination.setPage}
                  onPageSizeChange={keysPagination.setPageSize}
                />
              </div>
            )}
          </div>
        </div>
      )}
      <DepartmentEmailModal
        open={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        department="api_management"
        templates={emailTemplates}
        defaultSubject={emailDefaults.subject}
        defaultBody={emailDefaults.body}
      />
    </div>
  );
}
