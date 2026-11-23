import React, { useEffect, useState } from 'react';
import {
  Bell,
  Download,
  Globe,
  Lock,
  Mail,
  Palette,
  Save,
  Settings,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import { EIGHT_DEPARTMENTS } from '../../config/navigation';
import { OFFICIAL_PLATFORM_EMAIL } from '../../config/platformIdentity';
import { useAuth } from '../../context/AuthContext';
import {
  apiFetch,
  savePlatformSettingsSection,
  uploadPlatformLogo,
} from '../../services/firestoreService';
import type {
  ActivityLog,
  EmailLogRecord,
  MessagingStatus,
  PlatformSetting,
} from '../../types/admin';
import { ConfirmModal } from '../common/ConfirmModal';
import { StatusText } from '../common/StatusText';
import { CentralEmailSettingsPanel } from './CentralEmailSettingsPanel';

interface PlatformSettingsViewProps {
  subId: string;
  onSelectSub: (subId: string) => void;
  settingsDocs: PlatformSetting[];
  activityLogs: ActivityLog[];
  emailLogs: EmailLogRecord[];
}

export function PlatformSettingsView({
  subId,
  onSelectSub,
  settingsDocs,
  activityLogs,
  emailLogs,
}: PlatformSettingsViewProps) {
  const { adminProfile, hasAction } = useAuth();
  const subdepartments =
    EIGHT_DEPARTMENTS.find((d) => d.id === 'platform_settings')?.subdepartments || [];

  const publicDoc = settingsDocs.find((d) => d.sectionId === 'public');

  const [platformName, setPlatformName] = useState('SWAS TASKS');
  const [tagline, setTagline] = useState('Skilled Workforce & Task Marketplace');
  const [primaryColor, setPrimaryColor] = useState('#102B50');
  const [accentColor, setAccentColor] = useState('#1265C8');
  const [logoUrl, setLogoUrl] = useState('');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [platformFeePercent, setPlatformFeePercent] = useState('10');
  const [minWithdrawalKes, setMinWithdrawalKes] = useState('500');
  const [allowWorkerRegistration, setAllowWorkerRegistration] = useState(true);
  const [allowClientRegistration, setAllowClientRegistration] = useState(true);
  const [requireTaskModeration, setRequireTaskModeration] = useState(true);
  const [termsText, setTermsText] = useState('');
  const [privacyText, setPrivacyText] = useState('');

  // Structured section fields
  const [heroTitle, setHeroTitle] = useState('Find Verified Talent & Complete Tasks Safely');
  const [heroSubtitle, setHeroSubtitle] = useState('');
  const [heroCtaLabel, setHeroCtaLabel] = useState('Post a Task');
  const [navLinksText, setNavLinksText] = useState('Browse Tasks, How It Works, Become a Worker, Support');
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState('60');
  const [maxFailedAttempts, setMaxFailedAttempts] = useState('5');
  const [notifEmailEnabled, setNotifEmailEnabled] = useState(true);
  const [notifSmsEnabled, setNotifSmsEnabled] = useState(false);

  const [messagingStatus, setMessagingStatus] = useState<MessagingStatus | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  useEffect(() => {
    if (subId === 'email_configuration' || subId === 'notification_settings' || subId === 'dashboard') {
      apiFetch<{ messaging: MessagingStatus }>('/api/v1/system/gateway-status')
        .then((res) => setMessagingStatus(res.messaging))
        .catch(() => undefined);
    }
  }, [subId]);

  useEffect(() => {
    if (!publicDoc) return;
    if (publicDoc.platformName) setPlatformName(publicDoc.platformName);
    if (publicDoc.tagline) setTagline(publicDoc.tagline);
    if (publicDoc.primaryColor) setPrimaryColor(publicDoc.primaryColor);
    if (publicDoc.accentColor) setAccentColor(publicDoc.accentColor);
    if (publicDoc.logoUrl) setLogoUrl(publicDoc.logoUrl);
    if (typeof publicDoc.maintenanceMode === 'boolean') {
      setMaintenanceMode(publicDoc.maintenanceMode);
    }
    if (typeof publicDoc.platformFeePercent === 'number') {
      setPlatformFeePercent(String(publicDoc.platformFeePercent));
    }
    if (typeof publicDoc.minWithdrawalKes === 'number') {
      setMinWithdrawalKes(String(publicDoc.minWithdrawalKes));
    }
    if (typeof publicDoc.allowWorkerRegistration === 'boolean') {
      setAllowWorkerRegistration(publicDoc.allowWorkerRegistration);
    }
    if (typeof publicDoc.allowClientRegistration === 'boolean') {
      setAllowClientRegistration(publicDoc.allowClientRegistration);
    }
    if (typeof publicDoc.requireTaskModeration === 'boolean') {
      setRequireTaskModeration(publicDoc.requireTaskModeration);
    }
    if (publicDoc.termsText) setTermsText(publicDoc.termsText);
    if (publicDoc.privacyText) setPrivacyText(publicDoc.privacyText);
  }, [publicDoc]);

  useEffect(() => {
    const docData = settingsDocs.find((d) => d.sectionId === subId)?.config as
      | Record<string, unknown>
      | undefined;
    if (!docData) return;
    if (typeof docData.heroTitle === 'string') setHeroTitle(docData.heroTitle);
    if (typeof docData.heroSubtitle === 'string') setHeroSubtitle(docData.heroSubtitle);
    if (typeof docData.heroCtaLabel === 'string') setHeroCtaLabel(docData.heroCtaLabel);
    if (typeof docData.navLinksText === 'string') setNavLinksText(docData.navLinksText);
    if (docData.sessionTimeoutMinutes) setSessionTimeoutMinutes(String(docData.sessionTimeoutMinutes));
    if (docData.maxFailedAttempts) setMaxFailedAttempts(String(docData.maxFailedAttempts));
    if (typeof docData.notifEmailEnabled === 'boolean') setNotifEmailEnabled(docData.notifEmailEnabled);
    if (typeof docData.notifSmsEnabled === 'boolean') setNotifSmsEnabled(docData.notifSmsEnabled);
  }, [subId, settingsDocs]);

  const handleSavePublicConfig = async () => {
    if (!adminProfile) return;
    setFeedback(null);
    try {
      await savePlatformSettingsSection(adminProfile, 'public', {
        platformName: platformName.trim(),
        tagline: tagline.trim(),
        primaryColor,
        accentColor,
        logoUrl,
        maintenanceMode,
        platformFeePercent: Number(platformFeePercent || 10),
        minWithdrawalKes: Number(minWithdrawalKes || 500),
        allowWorkerRegistration,
        allowClientRegistration,
        requireTaskModeration,
        termsText,
        privacyText,
      });
      setFeedback({
        type: 'ok',
        text: 'Public platform settings saved to Firestore and published to /api/v1/config/public.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save settings',
      });
    }
  };

  const handleSaveStructuredSection = async (e: React.FormEvent, configPayload: Record<string, unknown>) => {
    e.preventDefault();
    if (!adminProfile) return;
    setFeedback(null);
    try {
      await savePlatformSettingsSection(adminProfile, subId, { config: configPayload });
      setFeedback({ type: 'ok', text: `Saved ${subId.replace(/_/g, ' ')} settings to Firestore.` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save section settings',
      });
    }
  };

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !adminProfile) return;
    setUploadingLogo(true);
    setFeedback(null);
    try {
      const url = await uploadPlatformLogo(adminProfile, file);
      setLogoUrl(url);
      setFeedback({ type: 'ok', text: 'Platform logo uploaded to Firebase Storage and saved.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Logo upload failed',
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleDownloadSettingsSnapshot = () => {
    const blob = new Blob([JSON.stringify(settingsDocs, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swas-tasks-settings-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const recentConfigLogs = activityLogs
    .filter((l) => l.affectedRecord.startsWith('platform_settings/'))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="typo-page-heading text-[#172B46]">
          Platform Settings
        </h1>
        <p className="mt-1 typo-body text-[#75869D]">
          Global platform configuration saved in Cloud Firestore and synchronized with the SWAS TASKS public website.
        </p>
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

      {subId === 'dashboard' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="typo-card-heading text-[#172B46]">
              Platform Configuration Overview
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { id: 'website_branding', label: 'Website Branding & Logo', sub: platformName, icon: Palette },
                { id: 'finance_settings', label: 'Commission & Withdrawals', sub: `${platformFeePercent}% fee · Min KES ${minWithdrawalKes}`, icon: Settings },
                { id: 'maintenance_mode', label: 'Maintenance Mode', sub: maintenanceMode ? 'Active' : 'Publicly Live', icon: ShieldAlert },
                {
                  id: 'email_configuration',
                  label: 'Central Email Settings',
                  sub: messagingStatus?.emailConfigured
                    ? `${OFFICIAL_PLATFORM_EMAIL} · ${messagingStatus.emailProvider}`
                    : `${OFFICIAL_PLATFORM_EMAIL} · EMAIL SERVICE NOT CONFIGURED`,
                  icon: Mail,
                },
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
            <h2 className="typo-card-heading text-[#172B46]">
              Recent Configuration Changes
            </h2>
            {recentConfigLogs.length === 0 ? (
              <p className="typo-meta text-[#75869D]">No settings modifications recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentConfigLogs.map((l) => (
                  <div key={l.eventId} className="py-2 typo-meta">
                    <p className="font-mono font-medium text-[#172B46]">{l.affectedRecord}</p>
                    <p className="text-[#75869D] tabular-nums">
                      {new Date(l.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : subId === 'general_settings' || subId === 'website_branding' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5 max-w-3xl">
          <h2 className="typo-card-heading text-[#172B46]">
            {subId === 'website_branding' ? 'Website Branding & Logo' : 'General Platform Settings'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Platform Name
              </label>
              <input
                type="text"
                value={platformName}
                onChange={(e) => setPlatformName(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">Tagline</label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Primary Navy Colour
              </label>
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Accent Royal Colour
              </label>
              <input
                type="text"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <label className="block typo-label text-[#172B46] mb-2">
              Upload Platform Logo (Firebase Storage · PNG/JPEG/WebP/SVG, max 2 MB)
            </label>
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 px-3.5 py-2 typo-button text-[#172B46] bg-[#E9F2FF] hover:bg-blue-100 rounded-md cursor-pointer">
                <Upload className="w-4 h-4 text-[#1265C8]" />
                <span>{uploadingLogo ? 'Uploading...' : 'Select Logo File'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleLogoFileChange}
                  className="hidden"
                />
              </label>
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Uploaded platform logo"
                  referrerPolicy="no-referrer"
                  className="h-10 w-10 rounded object-contain border border-slate-200"
                />
              ) : null}
            </div>
          </div>

          <button
            type="button"
            disabled={!hasAction('update')}
            onClick={() => void handleSavePublicConfig()}
            className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Save General & Branding Settings
          </button>
        </div>
      ) : subId === 'homepage_settings' ? (
        <form
          onSubmit={(e) =>
            void handleSaveStructuredSection(e, { heroTitle, heroSubtitle, heroCtaLabel })
          }
          className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 max-w-2xl"
        >
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#1265C8]" />
            <h2 className="typo-card-heading text-[#172B46]">
              Public Website Homepage Settings
            </h2>
          </div>
          <div>
            <label className="block typo-label text-[#172B46] mb-1">Hero Headline</label>
            <input
              type="text"
              value={heroTitle}
              onChange={(e) => setHeroTitle(e.target.value)}
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block typo-label text-[#172B46] mb-1">Hero Subtitle</label>
            <textarea
              rows={3}
              value={heroSubtitle}
              onChange={(e) => setHeroSubtitle(e.target.value)}
              placeholder="Connect skilled professionals with verified clients across Kenya..."
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block typo-label text-[#172B46] mb-1">Primary CTA Label</label>
            <input
              type="text"
              value={heroCtaLabel}
              onChange={(e) => setHeroCtaLabel(e.target.value)}
              className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
            />
          </div>
          <button
            type="submit"
            disabled={!hasAction('update')}
            className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] rounded-md disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Save Homepage Configuration
          </button>
        </form>
      ) : subId === 'navigation_settings' ? (
        <form
          onSubmit={(e) => void handleSaveStructuredSection(e, { navLinksText })}
          className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 max-w-2xl"
        >
          <h2 className="typo-card-heading text-[#172B46]">
            Public Website Navigation Links
          </h2>
          <p className="typo-meta text-[#75869D]">
            Comma-separated top-level public website menu items published via{' '}
            <span className="font-mono">platform_settings/navigation_settings</span>.
          </p>
          <input
            type="text"
            value={navLinksText}
            onChange={(e) => setNavLinksText(e.target.value)}
            className="w-full px-3 py-2 typo-input border border-slate-300 rounded-md"
          />
          <button
            type="submit"
            disabled={!hasAction('update')}
            className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] rounded-md disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Save Navigation Menu
          </button>
        </form>
      ) : subId === 'notification_settings' ? (
        <form
          onSubmit={(e) =>
            void handleSaveStructuredSection(e, { notifEmailEnabled, notifSmsEnabled })
          }
          className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 max-w-2xl"
        >
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#1265C8]" />
            <h2 className="typo-card-heading text-[#172B46]">
              Platform Notification Routing
            </h2>
          </div>
          <p className="typo-meta text-[#75869D]">
            All official platform email alerts dispatch from{' '}
            <span className="font-mono text-[#172B46]">{OFFICIAL_PLATFORM_EMAIL}</span>.
          </p>
          <label className="flex items-center justify-between p-3 rounded border border-slate-200 typo-body">
            <span>Transactional Email Notifications ({OFFICIAL_PLATFORM_EMAIL})</span>
            <input
              type="checkbox"
              checked={notifEmailEnabled}
              onChange={(e) => setNotifEmailEnabled(e.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between p-3 rounded border border-slate-200 typo-body">
            <span>SMS OTP & Urgent Alerts (Twilio)</span>
            <input
              type="checkbox"
              checked={notifSmsEnabled}
              onChange={(e) => setNotifSmsEnabled(e.target.checked)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!hasAction('update')}
              className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] rounded-md disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              Save Notification Rules
            </button>
            <button
              type="button"
              onClick={() => onSelectSub('email_configuration')}
              className="inline-flex items-center gap-2 px-4 py-2 typo-button text-[#1265C8] bg-[#E9F2FF] hover:bg-blue-100 rounded-md"
            >
              <Mail className="w-4 h-4" />
              Manage Email Templates & Logs
            </button>
          </div>
        </form>
      ) : subId === 'email_configuration' ? (
        <CentralEmailSettingsPanel
          adminProfile={adminProfile}
          canEdit={hasAction('update')}
          settingsDocs={settingsDocs}
          emailLogs={emailLogs}
        />
      ) : subId === 'security_settings' ? (
        <form
          onSubmit={(e) =>
            void handleSaveStructuredSection(e, {
              sessionTimeoutMinutes: Number(sessionTimeoutMinutes || 60),
              maxFailedAttempts: Number(maxFailedAttempts || 5),
            })
          }
          className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 max-w-2xl"
        >
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#1265C8]" />
            <h2 className="typo-card-heading text-[#172B46]">
              Administrator Security & Session Policy
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Idle Session Timeout (minutes)
              </label>
              <input
                type="number"
                min={5}
                max={480}
                value={sessionTimeoutMinutes}
                onChange={(e) => setSessionTimeoutMinutes(e.target.value)}
                className="w-full px-3 py-2 typo-input tabular-nums border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Max Failed Logins Before Lockout
              </label>
              <input
                type="number"
                min={3}
                max={20}
                value={maxFailedAttempts}
                onChange={(e) => setMaxFailedAttempts(e.target.value)}
                className="w-full px-3 py-2 typo-input tabular-nums border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={!hasAction('update')}
            className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] rounded-md disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Save Security Policy
          </button>
        </form>
      ) : subId === 'user_registration' ||
        subId === 'worker_settings' ||
        subId === 'client_settings' ||
        subId === 'task_settings' ||
        subId === 'finance_settings' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5 max-w-2xl">
          <h2 className="typo-card-heading text-[#172B46]">
            Registration, Task & KES Finance Rules
          </h2>
          <div className="space-y-3 typo-body">
            <label className="flex items-center justify-between p-3 rounded border border-slate-200">
              <span>Allow Public Worker Registration</span>
              <input
                type="checkbox"
                checked={allowWorkerRegistration}
                onChange={(e) => setAllowWorkerRegistration(e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between p-3 rounded border border-slate-200">
              <span>Allow Public Client Registration</span>
              <input
                type="checkbox"
                checked={allowClientRegistration}
                onChange={(e) => setAllowClientRegistration(e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between p-3 rounded border border-slate-200">
              <span>Require Task Moderation Before Publishing</span>
              <input
                type="checkbox"
                checked={requireTaskModeration}
                onChange={(e) => setRequireTaskModeration(e.target.checked)}
              />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Platform Commission (%)
              </label>
              <input
                type="number"
                min={0}
                max={50}
                value={platformFeePercent}
                onChange={(e) => setPlatformFeePercent(e.target.value)}
                className="w-full px-3 py-2 typo-input tabular-nums border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block typo-label text-[#172B46] mb-1">
                Minimum Withdrawal (KES)
              </label>
              <input
                type="number"
                min={100}
                value={minWithdrawalKes}
                onChange={(e) => setMinWithdrawalKes(e.target.value)}
                className="w-full px-3 py-2 typo-input tabular-nums border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={!hasAction('update')}
            onClick={() => void handleSavePublicConfig()}
            className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Save Operational Rules
          </button>
        </div>
      ) : subId === 'maintenance_mode' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 max-w-2xl">
          <h2 className="typo-card-heading text-[#172B46]">
            Public Website Maintenance Mode
          </h2>
          <p className="typo-body text-[#75869D]">
            Enabling Maintenance Mode sets <span className="font-mono">maintenanceMode: true</span>{' '}
            in <span className="font-mono">/api/v1/config/public</span> so the connected SWAS TASKS
            public website displays a maintenance notice immediately.
          </p>
          <div className="p-4 rounded-md border border-slate-200 flex items-center justify-between">
            <div>
              <p className="typo-body font-semibold text-[#172B46]">
                Current State: {maintenanceMode ? 'Maintenance Active' : 'Publicly Accessible'}
              </p>
              <p className="typo-meta text-[#75869D]">Confirmation required to toggle state.</p>
            </div>
            <button
              type="button"
              disabled={!hasAction('update')}
              onClick={() => setConfirmMaintenance(true)}
              className={`px-4 py-2 typo-button text-white rounded-md disabled:opacity-50 ${
                maintenanceMode ? 'bg-[#15966B]' : 'bg-[#D34552]'
              }`}
            >
              {maintenanceMode ? 'Disable Maintenance Mode' : 'Enable Maintenance Mode'}
            </button>
          </div>
        </div>
      ) : subId === 'terms_conditions' || subId === 'privacy_policy' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 max-w-3xl">
          <h2 className="typo-card-heading text-[#172B46]">
            {subId === 'terms_conditions' ? 'Terms & Conditions' : 'Privacy Policy'}
          </h2>
          <textarea
            rows={12}
            value={subId === 'terms_conditions' ? termsText : privacyText}
            onChange={(e) =>
              subId === 'terms_conditions'
                ? setTermsText(e.target.value)
                : setPrivacyText(e.target.value)
            }
            placeholder="Enter legal policy prose published to the SWAS TASKS public website..."
            className="w-full p-3 typo-input border border-slate-300 rounded-md focus:outline-none focus:border-[#1265C8]"
          />
          <button
            type="button"
            disabled={!hasAction('update')}
            onClick={() => void handleSavePublicConfig()}
            className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#1265C8] rounded-md disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Publish Policy Update
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 max-w-2xl">
          <h2 className="typo-card-heading text-[#172B46]">
            Backup & Recovery Procedures
          </h2>
          <p className="typo-body text-[#75869D]">
            Export a verified JSON snapshot of current Firestore platform configuration documents,
            and review documented Cloud Firestore Point-in-Time Recovery (PITR) and scheduled export
            commands in <span className="font-mono">SETUP_GUIDE.md</span>.
          </p>
          <button
            type="button"
            onClick={handleDownloadSettingsSnapshot}
            className="inline-flex items-center gap-2 px-4 py-2 typo-button text-white bg-[#102B50] hover:bg-[#172B46] rounded-md"
          >
            <Download className="w-4 h-4" />
            Download Configuration Snapshot (JSON)
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmMaintenance}
        title={maintenanceMode ? 'Disable Maintenance Mode?' : 'Enable Maintenance Mode?'}
        description="This immediately updates the public website configuration endpoint (/api/v1/config/public)."
        danger={!maintenanceMode}
        onCancel={() => setConfirmMaintenance(false)}
        onConfirm={async () => {
          const next = !maintenanceMode;
          setMaintenanceMode(next);
          if (adminProfile) {
            await savePlatformSettingsSection(adminProfile, 'public', {
              maintenanceMode: next,
            });
            setFeedback({
              type: 'ok',
              text: `Maintenance mode ${next ? 'enabled' : 'disabled'}.`,
            });
          }
          setConfirmMaintenance(false);
        }}
      />
    </div>
  );
}
