import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  HelpCircle,
  History,
  KeyRound,
  Lock,
  LogOut,
  Save,
  ShieldCheck,
  Upload,
  User,
} from 'lucide-react';
import { EIGHT_DEPARTMENTS, ROLE_DEFINITIONS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  updateMyStaffProfile,
  uploadStaffAvatar,
} from '../../services/firestoreService';
import type { ActivityLog, EightDepartmentId, StaffLoginHistory } from '../../types/admin';
import { StatusText } from '../common/StatusText';

interface StaffProfileViewProps {
  mode: 'profile' | 'settings' | 'help';
  department: EightDepartmentId;
  activityLogs: ActivityLog[];
  loginHistory: StaffLoginHistory[];
}

export function StaffProfileView({
  mode,
  department,
  activityLogs,
  loginHistory,
}: StaffProfileViewProps) {
  const {
    adminProfile,
    firebaseUser,
    refreshProfile,
    sendResetEmail,
    logout,
  } = useAuth();

  const deptConfig = EIGHT_DEPARTMENTS.find((d) => d.id === department);

  const [displayName, setDisplayName] = useState(adminProfile?.displayName || '');
  const [phone, setPhone] = useState(adminProfile?.phone || '');
  const [photoUrl, setPhotoUrl] = useState(adminProfile?.photoUrl || '');
  const [emailAlerts, setEmailAlerts] = useState(
    adminProfile?.notificationPrefs?.emailAlerts ?? true
  );
  const [securityAlerts, setSecurityAlerts] = useState(
    adminProfile?.notificationPrefs?.securityAlerts ?? true
  );
  const [departmentMentions, setDepartmentMentions] = useState(
    adminProfile?.notificationPrefs?.departmentMentions ?? true
  );
  const [dailyDigest, setDailyDigest] = useState(
    adminProfile?.notificationPrefs?.dailyDigest ?? false
  );

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!adminProfile) return;
    setDisplayName(adminProfile.displayName || '');
    setPhone(adminProfile.phone || '');
    setPhotoUrl(adminProfile.photoUrl || '');
    setEmailAlerts(adminProfile.notificationPrefs?.emailAlerts ?? true);
    setSecurityAlerts(adminProfile.notificationPrefs?.securityAlerts ?? true);
    setDepartmentMentions(adminProfile.notificationPrefs?.departmentMentions ?? true);
    setDailyDigest(adminProfile.notificationPrefs?.dailyDigest ?? false);
  }, [adminProfile]);

  const personalActivity = useMemo(() => {
    if (!adminProfile) return [];
    return [...activityLogs]
      .filter((l) => l.actorId === adminProfile.uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 15);
  }, [activityLogs, adminProfile]);

  const personalLogins = useMemo(() => {
    if (!adminProfile) return [];
    return [...loginHistory]
      .filter(
        (h) =>
          h.uid === adminProfile.uid ||
          h.email.toLowerCase() === adminProfile.email.toLowerCase()
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);
  }, [loginHistory, adminProfile]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminProfile) return;
    setSaving(true);
    setFeedback(null);
    try {
      await updateMyStaffProfile({
        displayName: displayName.trim(),
        phone: phone.trim(),
        photoUrl: photoUrl.trim(),
        notificationPrefs: {
          emailAlerts,
          securityAlerts,
          departmentMentions,
          dailyDigest,
        },
      });
      await refreshProfile();
      setFeedback({ type: 'ok', text: 'Your staff profile and notification preferences were saved.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save profile updates.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !adminProfile) return;
    setUploading(true);
    setFeedback(null);
    try {
      const url = await uploadStaffAvatar(adminProfile.uid, file);
      setPhotoUrl(url);
      await updateMyStaffProfile({ photoUrl: url });
      await refreshProfile();
      setFeedback({ type: 'ok', text: 'Profile photo uploaded to Firebase Storage and saved.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Avatar upload failed.',
      });
    } finally {
      setUploading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!adminProfile?.email) return;
    setFeedback(null);
    try {
      await sendResetEmail(adminProfile.email);
      setFeedback({
        type: 'ok',
        text: `Password reset email dispatched to ${adminProfile.email}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to send password reset email.',
      });
    }
  };

  if (mode === 'help') {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <HelpCircle className="w-5 h-5 text-[#1265C8]" />
            <h2 className="typo-section-heading text-[#172B46]">
              Department Help & Operational Support — {deptConfig?.label}
            </h2>
          </div>
          <p className="typo-body text-[#75869D]">
            This restricted workplace grants access exclusively to records and actions authorized for
            your assigned role. Every moderation, approval, financial review, or configuration change
            writes an immutable audit entry linked to your authenticated UID.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1.5">
              <p className="text-xs font-semibold text-[#172B46]">Role & Permission Requests</p>
              <p className="text-xs text-[#75869D]">
                Department staff cannot elevate roles or switch departments independently. Contact
                the Super Administrator to update permissions in Staff Management.
              </p>
            </div>
            <div className="p-4 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1.5">
              <p className="text-xs font-semibold text-[#172B46]">Security & Escalations</p>
              <p className="text-xs text-[#75869D]">
                Report suspicious accounts, disputed KES payouts, or API credential leaks via the
                Department Chat tab or escalate directly to Audit & Security Operations.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const roleLabel =
    (adminProfile && ROLE_DEFINITIONS[adminProfile.role]?.label) ||
    adminProfile?.role ||
    'Staff Member';

  return (
    <div className="space-y-6">
      {feedback ? (
        <div
          className={`p-3 rounded-md text-xs border ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-[#15966B]'
              : 'bg-red-50 border-red-200 text-[#D34552]'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Identity & Editable Profile Form */}
        <form
          onSubmit={handleSaveProfile}
          className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-4">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={adminProfile?.displayName || 'Staff Avatar'}
                  referrerPolicy="no-referrer"
                  className="w-14 h-14 rounded-full object-cover border border-slate-200"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-[#102B50] text-white flex items-center justify-center font-heading text-lg font-semibold">
                  {(adminProfile?.displayName || 'S').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <h2 className="typo-card-heading text-[#172B46]">
                  {mode === 'profile' ? 'My Staff Profile' : 'Account & Notification Settings'}
                </h2>
                <p className="typo-meta text-[#75869D]">
                  {deptConfig?.label} · {roleLabel}
                </p>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 px-3 py-1.5 typo-label text-[#172B46] bg-[#E9F2FF] hover:bg-blue-100 rounded-md cursor-pointer shrink-0">
              <Upload className="w-3.5 h-3.5 text-[#1265C8]" />
              <span>{uploading ? 'Uploading...' : 'Upload Photo'}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Full Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+2547..."
                className="w-full px-3 py-2 typo-input tabular-nums border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#75869D] mb-1">
                Verified Email (Locked)
              </label>
              <div className="px-3 py-2 typo-input bg-[#F3F6FA] border border-slate-200 rounded-md flex items-center justify-between text-[#172B46]">
                <span className="truncate">{adminProfile?.email}</span>
                {firebaseUser?.emailVerified ? (
                  <CheckCircle2 className="w-4 h-4 text-[#15966B] shrink-0" />
                ) : null}
              </div>
            </div>
            <div>
              <label className="block typo-label text-[#75869D] mb-1">
                Assigned Department & Role (Locked)
              </label>
              <div className="px-3 py-2 typo-input bg-[#F3F6FA] border border-slate-200 rounded-md text-[#172B46] truncate">
                {deptConfig?.label} · {adminProfile?.role}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#1265C8]" />
              <h3 className="text-xs font-semibold text-[#172B46]">Notification Preferences</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="flex items-center justify-between p-3 rounded border border-slate-200">
                <span>Department Queue Alerts</span>
                <input
                  type="checkbox"
                  checked={emailAlerts}
                  onChange={(e) => setEmailAlerts(e.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between p-3 rounded border border-slate-200">
                <span>Security & Session Alerts</span>
                <input
                  type="checkbox"
                  checked={securityAlerts}
                  onChange={(e) => setSecurityAlerts(e.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between p-3 rounded border border-slate-200">
                <span>Department Chat Mentions</span>
                <input
                  type="checkbox"
                  checked={departmentMentions}
                  onChange={(e) => setDepartmentMentions(e.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between p-3 rounded border border-slate-200">
                <span>Daily Summary Digest</span>
                <input
                  type="checkbox"
                  checked={dailyDigest}
                  onChange={(e) => setDailyDigest(e.target.checked)}
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
            <span className="typo-meta text-[#75869D]">
              Permissions: <span className="font-medium text-[#172B46]">{(adminProfile?.actions || []).join(', ')}</span>
            </span>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Profile & Preferences'}
            </button>
          </div>
        </form>

        {/* Security & Active Session Panel */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 h-fit">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#1265C8]" />
            <h3 className="typo-card-heading text-[#172B46]">
              Security & Session
            </h3>
          </div>

          <dl className="space-y-2.5 typo-meta">
            <div className="p-3 rounded bg-[#F3F6FA] border border-slate-200">
              <dt className="text-[#75869D]">Account Status</dt>
              <dd className="mt-1">
                <StatusText status={adminProfile?.status || 'active'} />
              </dd>
            </div>
            <div className="p-3 rounded bg-[#F3F6FA] border border-slate-200">
              <dt className="text-[#75869D]">Phone Verification</dt>
              <dd className="mt-1 font-medium text-[#172B46]">
                {adminProfile?.phoneVerified ? 'Verified' : 'Unverified / SMS Optional'}
              </dd>
            </div>
            <div className="p-3 rounded bg-[#F3F6FA] border border-slate-200">
              <dt className="text-[#75869D]">Last Verified Login</dt>
              <dd className="mt-1 tabular-nums text-[#172B46]">
                {adminProfile?.lastLoginAt
                  ? new Date(adminProfile.lastLoginAt).toLocaleString()
                  : 'Current Session'}
              </dd>
            </div>
            <div className="p-3 rounded bg-[#F3F6FA] border border-slate-200">
              <dt className="text-[#75869D]">Firebase UID</dt>
              <dd className="mt-1 font-mono typo-small text-[#75869D] break-all">
                {adminProfile?.uid}
              </dd>
            </div>
          </dl>

          <div className="space-y-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => void handlePasswordReset()}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 typo-button text-[#172B46] bg-[#E9F2FF] hover:bg-blue-100 rounded-md"
            >
              <KeyRound className="w-3.5 h-3.5 text-[#1265C8]" />
              Send Password Reset Email
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 typo-button text-white bg-[#102B50] hover:bg-[#172B46] rounded-md"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out Securely
            </button>
          </div>
        </div>
      </div>

      {/* Personal Login & Activity History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#1265C8]" />
            <h3 className="typo-card-heading text-[#172B46]">
              Personal Login History
            </h3>
          </div>
          {personalLogins.length === 0 ? (
            <p className="p-6 typo-meta text-[#75869D] text-center">
              No historical login events recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {personalLogins.map((item) => (
                <div key={item.loginId} className="px-4 py-3 flex items-center justify-between typo-meta">
                  <div>
                    <p className="font-medium text-[#172B46]">{item.detail || item.outcome}</p>
                    <p className="tabular-nums typo-small text-[#75869D]">
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <StatusText status={item.outcome === 'success' ? 'verified' : 'warning'} label={item.outcome} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
            <History className="w-4 h-4 text-[#1265C8]" />
            <h3 className="typo-card-heading text-[#172B46]">
              Personal Audit Activity ({personalActivity.length})
            </h3>
          </div>
          {personalActivity.length === 0 ? (
            <p className="p-6 typo-meta text-[#75869D] text-center">
              No administrative actions recorded under your UID yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {personalActivity.map((log) => (
                <div key={log.eventId} className="px-4 py-3 flex items-center justify-between typo-meta gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-[#172B46] truncate">{log.action}</p>
                    <p className="font-mono typo-small text-[#75869D] truncate">{log.affectedRecord}</p>
                  </div>
                  <span className="tabular-nums typo-small text-[#75869D] shrink-0">
                    {new Date(log.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
