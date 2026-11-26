import React from 'react';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<Tone, string> = {
  success: 'text-[#15966B]',
  warning: 'text-[#B7791F]',
  danger: 'text-[#D34552]',
  info: 'text-[#1265C8]',
  neutral: 'text-[#75869D]',
};

const STATUS_TONE_MAP: Record<string, Tone> = {
  active: 'success',
  approved: 'success',
  completed: 'success',
  verified: 'success',
  published: 'success',
  connected: 'success',
  paid: 'success',
  resolved: 'success',
  success: 'success',
  healthy: 'success',
  operational: 'success',
  accepted: 'success',
  sent: 'success',
  delivered: 'success',
  scheduled: 'info',
  queued: 'info',
  sending: 'info',
  duplicate_blocked: 'warning',
  deferred: 'warning',
  partially_failed: 'warning',
  cancelled: 'neutral',
  draft: 'neutral',
  pending: 'warning',
  pending_verification: 'warning',
  opened: 'info',
  in_progress: 'warning',
  revision_requested: 'warning',
  submitted: 'info',
  info: 'info',
  warning: 'warning',
  restricted: 'warning',
  degraded: 'warning',
  not_configured: 'warning',
  not_sent: 'neutral',
  suspended: 'danger',
  deactivated: 'danger',
  banned: 'danger',
  rejected: 'danger',
  bounced: 'danger',
  revoked: 'danger',
  expired: 'danger',
  locked: 'danger',
  session_revoked: 'danger',
  failed: 'danger',
  denied: 'danger',
  disputed: 'danger',
  reported: 'danger',
  removed: 'danger',
  critical: 'danger',
  error: 'danger',
  down: 'danger',
  withdrawn: 'neutral',
  inactive: 'neutral',
  unverified: 'neutral',
  closed: 'neutral',
  paused: 'neutral',
};

export function StatusText({ status, label }: { status: string; label?: string }) {
  const normalized = (status || 'unknown').toLowerCase();
  const tone = STATUS_TONE_MAP[normalized] || 'neutral';
  const display =
    label ||
    normalized
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={`inline-flex items-center gap-1.5 font-sans text-[12px] font-semibold ${TONE_CLASSES[tone]}`}>
      <span className="w-1.5 h-1.5 rounded-sm bg-current shrink-0" aria-hidden="true" />
      <span>{display}</span>
    </span>
  );
}
