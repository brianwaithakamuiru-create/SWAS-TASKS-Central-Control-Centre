import React, { useState } from 'react';
import { Mail, Megaphone, Send } from 'lucide-react';
import {
  OFFICIAL_PLATFORM_EMAIL,
  OFFICIAL_SENDER_DISPLAY_NAME,
} from '../../config/platformIdentity';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, updateSupportTicketStatus } from '../../services/firestoreService';
import type { Announcement, SupportTicket } from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { EmptyState } from '../common/EmptyState';
import { StatusText } from '../common/StatusText';

interface SupportAnnouncementsViewProps {
  announcements: Announcement[];
  tickets: SupportTicket[];
}

export function SupportAnnouncementsView({
  announcements,
  tickets,
}: SupportAnnouncementsViewProps) {
  const { adminProfile } = useAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'all' | 'workers' | 'clients' | 'admins'>('all');

  const [emailTo, setEmailTo] = useState('');
  const [emailScope, setEmailScope] = useState<'public_website' | 'control_centre'>('public_website');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [confirmEmailOpen, setConfirmEmailOpen] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/api/v1/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), body: body.trim(), audience, active: true }),
      });
      setTitle('');
      setBody('');
      setFeedback({ type: 'ok', text: 'Announcement published to Firestore.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Publish failed',
      });
    }
  };

  const executeSendOfficialEmail = async () => {
    setSendingEmail(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{
        delivery: { sent: boolean; status: string; detail: string; error?: string };
      }>('/api/v1/admin/email/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          recipientEmail: emailTo.trim(),
          scope: emailScope,
          eventType:
            emailScope === 'public_website' ? 'customer_support' : 'admin_communication',
          subject: emailSubject.trim(),
          bodyText: emailBody.trim(),
        }),
      });
      if (res.delivery.sent) {
        setEmailTo('');
        setEmailSubject('');
        setEmailBody('');
        setFeedback({ type: 'ok', text: res.delivery.detail });
      } else {
        setFeedback({ type: 'err', text: res.delivery.error || res.delivery.detail });
      }
      setConfirmEmailOpen(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Email dispatch failed',
      });
      setConfirmEmailOpen(false);
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendOfficialEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) return;
    setConfirmEmailOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="typo-page-heading text-[#172B46]">
          Central Support & Announcements
        </h1>
        <p className="mt-1 typo-body text-[#75869D]">
          Publish platform-wide announcements, manage support tickets, and dispatch official communications from{' '}
          <span className="font-mono text-[#172B46]">{OFFICIAL_PLATFORM_EMAIL}</span>.
        </p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <form
            onSubmit={handlePublish}
            className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-[#1265C8]" />
              <h2 className="typo-card-heading text-[#172B46]">
                Publish Announcement
              </h2>
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Title</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Scheduled Maintenance or Policy Update"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Audience</label>
              <select
                value={audience}
                onChange={(e) =>
                  setAudience(e.target.value as 'all' | 'workers' | 'clients' | 'admins')
                }
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Platform Users</option>
                <option value="workers">Workers Only</option>
                <option value="clients">Clients Only</option>
                <option value="admins">Administrators Only</option>
              </select>
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Message</label>
              <textarea
                rows={4}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <button
              type="submit"
              className="w-full px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
            >
              Publish Notice
            </button>
          </form>

          <form
            onSubmit={handleSendOfficialEmail}
            className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-[#1265C8]" />
              <h2 className="typo-card-heading text-[#172B46]">
                Official Email Communication
              </h2>
            </div>
            <p className="typo-small text-[#75869D]">
              Sent as{' '}
              <span className="font-mono text-[#172B46]">
                {OFFICIAL_SENDER_DISPLAY_NAME} &lt;{OFFICIAL_PLATFORM_EMAIL}&gt;
              </span>
            </p>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Communication Scope</label>
              <select
                value={emailScope}
                onChange={(e) =>
                  setEmailScope(e.target.value as 'public_website' | 'control_centre')
                }
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md bg-white"
              >
                <option value="public_website">Customer Support Communication</option>
                <option value="control_centre">Administrative / Staff Communication</option>
              </select>
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Recipient Email</label>
              <input
                type="email"
                required
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Subject</label>
              <input
                type="text"
                required
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="SWAS TASKS Support Response"
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Message</label>
              <textarea
                rows={3}
                required
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <button
              type="submit"
              disabled={sendingEmail}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 typo-button text-white bg-[#102B50] hover:bg-[#172B46] rounded-md disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {sendingEmail ? 'Sending Email...' : 'Send Official Email'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div>
            <h2 className="typo-card-heading text-[#172B46] mb-3">
              Published Announcements ({announcements.length})
            </h2>
            {announcements.length === 0 ? (
              <EmptyState
                title="No Announcements Published"
                description="Use the form on the left to broadcast notices to the SWAS TASKS public platform."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
                {announcements.map((a) => (
                  <div key={a.announcementId} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold typo-body text-[#172B46]">{a.title}</p>
                      <span className="typo-small font-semibold text-[#75869D] uppercase">
                        {a.audience}
                      </span>
                    </div>
                    <p className="mt-1 typo-body text-[#75869D]">{a.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="typo-card-heading text-[#172B46] mb-3">
              Support Tickets ({tickets.length})
            </h2>
            {tickets.length === 0 ? (
              <EmptyState
                title="No Support Tickets"
                description="Support requests from workers and clients will appear here."
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full typo-table">
                  <thead className="bg-[#F3F6FA] text-[#75869D] text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Subject</th>
                      <th className="px-4 py-3 font-medium">Requester</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tickets.map((t) => (
                      <tr key={t.ticketId}>
                        <td className="px-4 py-3 font-medium text-[#172B46]">{t.subject}</td>
                        <td className="px-4 py-3 typo-meta text-[#75869D] capitalize">
                          {t.requesterType} · {t.requesterName || t.requesterUid}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={t.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {adminProfile && t.status !== 'resolved' ? (
                            <button
                              type="button"
                              onClick={() =>
                                void updateSupportTicketStatus(adminProfile, t.ticketId, 'resolved')
                              }
                              className="text-xs font-medium text-[#15966B] hover:underline"
                            >
                              Mark Resolved
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmModal
        open={confirmEmailOpen}
        title="Confirm Official Email Dispatch"
        description={`Send "${emailSubject.trim()}" from ${OFFICIAL_SENDER_DISPLAY_NAME} <${OFFICIAL_PLATFORM_EMAIL}> to ${emailTo.trim()}?`}
        confirmLabel={sendingEmail ? 'Sending...' : 'Confirm & Send'}
        onCancel={() => setConfirmEmailOpen(false)}
        onConfirm={() => void executeSendOfficialEmail()}
      />
    </div>
  );
}
