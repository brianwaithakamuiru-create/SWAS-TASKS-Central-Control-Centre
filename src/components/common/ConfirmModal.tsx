import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm Action',
  danger = false,
  requireReason = false,
  reasonLabel = 'Administrative justification',
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleConfirm = async () => {
    if (requireReason && !reason.trim()) return;
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
      setReason('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              className={`w-5 h-5 shrink-0 ${danger ? 'text-[#D34552]' : 'text-[#E6A23C]'}`}
            />
            <h3 className="typo-card-heading text-[#172B46]">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close modal"
            className="text-[#75869D] hover:text-[#172B46] p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-3 typo-body text-[#75869D]">{description}</p>

        {requireReason ? (
          <div className="mt-4">
            <label className="block typo-label text-[#172B46] mb-1.5">
              {reasonLabel}
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter mandatory audit note..."
              className="w-full rounded-md border border-slate-300 px-3 py-2 typo-input text-[#172B46] focus:outline-none focus:border-[#1265C8]"
            />
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 typo-button text-[#172B46] bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || (requireReason && !reason.trim())}
            onClick={handleConfirm}
            className={`px-4 py-2 typo-button text-white rounded-md transition-colors disabled:opacity-50 ${
              danger
                ? 'bg-[#D34552] hover:bg-[#b53743]'
                : 'bg-[#1265C8] hover:bg-[#102B50]'
            }`}
          >
            {submitting ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
