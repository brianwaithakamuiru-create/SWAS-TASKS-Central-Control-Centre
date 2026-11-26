import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Clock,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { EIGHT_DEPARTMENTS } from '../../config/navigation';
import { OFFICIAL_PLATFORM_EMAIL } from '../../config/platformIdentity';
import { useAuth } from '../../context/AuthContext';

export function LoginView() {
  const {
    firebaseUser,
    adminProfile,
    accountStatusInfo,
    authError,
    sessionExpired,
    signInWithGoogle,
    signInWithEmail,
    sendResetEmail,
    refreshProfile,
    logout,
    clearAuthError,
  } = useAuth();
  const [refreshingStatus, setRefreshingStatus] = useState(false);

  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState<string | null>(null);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || (mode === 'login' && !password)) return;
    setBusy(true);
    setResetSent(null);
    clearAuthError();
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        await sendResetEmail(email);
        setResetSent(`Password reset link sent to ${email.trim()} if an account exists.`);
      }
    } catch {
      // authError state is populated by AuthContext
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setResetSent(null);
    clearAuthError();
    try {
      await signInWithGoogle();
    } catch {
      // handled by context
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F6FA] flex flex-col lg:flex-row items-stretch">
      {/* Left Architectural Panel */}
      <div className="relative lg:w-5/12 bg-[#102B50] text-white flex flex-col justify-between p-8 lg:p-12 overflow-hidden">
        <img
          src="/src/assets/images/swas_login_backdrop_1795473645357.jpg"
          alt="SWAS TASKS infrastructure backdrop"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none"
        />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white p-1.5 shrink-0 flex items-center justify-center">
            <img
              src="/src/assets/images/swas_control_emblem_1795473644381.jpg"
              alt="SWAS TASKS Control Emblem"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <p className="typo-card-heading tracking-tight text-white">
              SWAS TASKS
            </p>
            <p className="typo-meta text-blue-200">Central Control Centre</p>
          </div>
        </div>

        <div className="relative z-10 my-10 lg:my-0 max-w-md">
          <p className="typo-meta font-medium tracking-wide text-blue-200 mb-3">
            Private Administration Infrastructure
          </p>
          <h1 className="typo-dashboard-heading text-white">
            Centralized Operations, Finance & API Control
          </h1>
          <p className="mt-4 typo-body text-slate-200">
            Authorized administrators govern platform users, client accounts, task moderation,
            KES financial payouts, API credentials, and immutable audit trails from one verified
            console.
          </p>
        </div>

        <div className="relative z-10 border-t border-white/15 pt-5 typo-meta text-blue-200 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 text-blue-300" />
          <span>
            Public visitor registration is disabled. Official communications:{' '}
            <span className="font-mono text-white">{OFFICIAL_PLATFORM_EMAIL}</span>
          </span>
        </div>
      </div>

      {/* Right Authentication Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-7 sm:p-8">
          {firebaseUser && !adminProfile ? (
            accountStatusInfo?.status === 'pending_verification' ? (
              <div>
                <div className="flex items-center gap-2.5 text-[#B7791F] mb-3">
                  <Clock className="w-5 h-5 shrink-0" />
                  <h2 className="typo-section-heading text-[#172B46]">
                    Account Pending Verification
                  </h2>
                </div>
                <p className="typo-body text-[#75869D]">
                  Your staff account (<span className="font-medium text-[#172B46]">{firebaseUser.email}</span>) has been registered successfully and is awaiting{' '}
                  <span className="font-semibold text-[#172B46]">Super Administrator verification</span>{' '}
                  before workplace access is enabled.
                </p>
                <div className="mt-4 p-3.5 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-1.5 typo-meta">
                  <div className="flex justify-between gap-2">
                    <span className="text-[#75869D]">Assigned Department</span>
                    <span className="font-semibold text-[#172B46]">
                      {EIGHT_DEPARTMENTS.find((d) => d.id === accountStatusInfo.department)?.label ||
                        accountStatusInfo.department ||
                        'Pending Assignment'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#75869D]">Assigned Role</span>
                    <span className="font-semibold text-[#172B46]">
                      {accountStatusInfo.role || 'Staff Member'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#75869D]">Verification Status</span>
                    <span className="font-semibold text-[#B7791F]">Pending Super Admin Approval</span>
                  </div>
                </div>
                <p className="mt-3 typo-meta text-[#75869D]">
                  Once verified by the Super Administrator, you will receive an approval email from{' '}
                  <span className="font-mono text-[#172B46]">{OFFICIAL_PLATFORM_EMAIL}</span>.
                </p>
                <div className="mt-5 space-y-2.5">
                  <button
                    type="button"
                    disabled={refreshingStatus}
                    onClick={async () => {
                      setRefreshingStatus(true);
                      try {
                        await refreshProfile();
                      } finally {
                        setRefreshingStatus(false);
                      }
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md transition-colors disabled:opacity-60"
                  >
                    <RefreshCw className={`w-4 h-4 ${refreshingStatus ? 'animate-spin' : ''}`} />
                    {refreshingStatus ? 'Checking Status...' : 'Refresh Verification Status'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 typo-button text-[#172B46] bg-[#F3F6FA] hover:bg-slate-200 border border-slate-200 rounded-md transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out and Switch Account
                  </button>
                </div>
              </div>
            ) : accountStatusInfo?.status === 'rejected' ? (
              <div>
                <div className="flex items-center gap-2.5 text-[#D34552] mb-3">
                  <XCircle className="w-5 h-5 shrink-0" />
                  <h2 className="typo-section-heading text-[#172B46]">
                    Staff Account Not Approved
                  </h2>
                </div>
                <p className="typo-body text-[#75869D]">
                  Signed in as <span className="font-medium text-[#172B46]">{firebaseUser.email}</span>.
                  Your staff registration was rejected during Super Administrator verification.
                </p>
                {accountStatusInfo.rejectionReason ? (
                  <div className="mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-[#D34552]">
                    <p className="font-semibold mb-0.5">Recorded Reason</p>
                    <p>{accountStatusInfo.rejectionReason}</p>
                  </div>
                ) : null}
                <p className="mt-3 typo-meta text-[#75869D]">
                  Contact your department administrator or Super Administrator at{' '}
                  <span className="font-mono text-[#172B46]">{OFFICIAL_PLATFORM_EMAIL}</span> if you
                  require a new invitation.
                </p>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 typo-button text-white bg-[#102B50] hover:bg-[#172B46] rounded-md transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out and Switch Account
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2.5 text-[#D34552] mb-3">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <h2 className="typo-section-heading text-[#172B46]">
                    Administrator Authorization Required
                  </h2>
                </div>
                <p className="typo-body text-[#75869D]">
                  Signed in as <span className="font-medium text-[#172B46]">{firebaseUser.email}</span>.
                  {authError
                    ? ` ${authError}`
                    : ' This account does not have active administrator privileges.'}
                </p>
                <p className="mt-3 typo-meta text-[#75869D]">
                  Only the Super Administrator can provision and authorize additional administrator
                  accounts.
                </p>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 typo-button text-white bg-[#102B50] hover:bg-[#172B46] rounded-md transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out and Switch Account
                </button>
              </div>
            )
          ) : (
            <div>
              <div className="mb-6">
                <h2 className="typo-page-heading text-[#172B46]">
                  {mode === 'login' ? 'Administrator Sign In' : 'Reset Administrator Password'}
                </h2>
                <p className="mt-1 typo-body text-[#75869D]">
                  {mode === 'login'
                    ? 'Verify your identity to access the Central Control Centre.'
                    : 'Enter your authorized administrator email to receive a reset link.'}
                </p>
              </div>

              {sessionExpired ? (
                <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  Your previous session expired due to inactivity. Please re-authenticate.
                </div>
              ) : null}

              {authError ? (
                <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-[#D34552] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              ) : null}

              {resetSent ? (
                <div className="mb-4 p-3 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-[#15966B]">
                  {resetSent}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void handleGoogleSignIn()}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md transition-colors disabled:opacity-60"
              >
                <KeyRound className="w-4 h-4" />
                <span>Sign In with Authorized Google Account</span>
              </button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="typo-meta text-[#75869D]">or email credentials</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div>
                  <label className="block typo-label text-[#172B46] mb-1.5">
                    Administrator Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#75869D] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={OFFICIAL_PLATFORM_EMAIL}
                      className="w-full pl-9 pr-3 py-2 typo-input border border-slate-300 rounded-md text-[#172B46] focus:outline-none focus:border-[#1265C8]"
                    />
                  </div>
                </div>

                {mode === 'login' ? (
                  <div>
                    <label className="block typo-label text-[#172B46] mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#75869D] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full pl-9 pr-3 py-2 typo-input border border-slate-300 rounded-md text-[#172B46] focus:outline-none focus:border-[#1265C8]"
                      />
                    </div>
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 typo-button text-[#172B46] bg-[#E9F2FF] hover:bg-blue-100 rounded-md transition-colors disabled:opacity-60"
                >
                  <span>
                    {busy
                      ? 'Verifying...'
                      : mode === 'login'
                      ? 'Sign In with Email'
                      : 'Send Password Reset Link'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="mt-4 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    clearAuthError();
                    setResetSent(null);
                    setMode(mode === 'login' ? 'reset' : 'login');
                  }}
                  className="text-[#1265C8] hover:underline font-medium"
                >
                  {mode === 'login' ? 'Forgot password?' : 'Back to sign in'}
                </button>
                <span className="text-[#75869D]">Protected by RBAC & Audit Logging</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
