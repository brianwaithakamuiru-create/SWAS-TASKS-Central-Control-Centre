import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Lock,
  LogOut,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react';
import { OFFICIAL_PLATFORM_EMAIL } from '../../config/platformIdentity';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../lib/firebase';
import type { EightDepartmentId, InvitationType, MessagingStatus } from '../../types/admin';

interface ValidatedInvitation {
  valid: boolean;
  invitationId: string;
  invitationType?: InvitationType;
  department: EightDepartmentId;
  departmentLabel: string;
  departmentRole: string;
  inviterName?: string;
  emailRestricted?: boolean;
  requiresPhone?: boolean;
  singleUse?: boolean;
  status?: string;
  expiresAt: string;
  messaging: MessagingStatus;
}

interface InviteRegisterViewProps {
  token: string;
  currentAdminEmail?: string | null;
  onExitToLogin: () => void;
}

const INVITATION_TYPE_LABELS: Record<InvitationType, string> = {
  staff_account: 'Staff Account',
  department_member: 'Department Member',
  department_admin: 'Department Admin',
};

export function InviteRegisterView({
  token,
  currentAdminEmail,
  onExitToLogin,
}: InviteRegisterViewProps) {
  const { refreshProfile, logout } = useAuth();

  const [validating, setValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [invite, setInvite] = useState<ValidatedInvitation | null>(null);

  // Registration Form State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Step 2 & 3 Verification State
  const [step, setStep] = useState<'form' | 'verify' | 'submitted'>('form');
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [smsCode, setSmsCode] = useState('');
  const [smsSent, setSmsSent] = useState(false);
  const [smsVerified, setSmsVerified] = useState(false);
  const [smsNotice, setSmsNotice] = useState<string | null>(null);
  const [existingAccountMode, setExistingAccountMode] = useState(false);
  const [registeredDeptLabel, setRegisteredDeptLabel] = useState('');
  const [registeredRole, setRegisteredRole] = useState('');
  const [statusCheckMsg, setStatusCheckMsg] = useState<string | null>(null);

  const isLegacyToken = token.includes('.');

  useEffect(() => {
    let active = true;
    async function checkInvite() {
      setValidating(true);
      setValidationError(null);
      try {
        const paramName = isLegacyToken ? 'token' : 'code';
        const res = await fetch(
          `/api/v1/invitations/validate?${paramName}=${encodeURIComponent(token)}`
        );
        const data = (await res.json()) as ValidatedInvitation & { error?: string };
        if (!active) return;
        if (!res.ok || !data.valid) {
          setValidationError(data.error || 'Invitation link is invalid, expired, or revoked.');
          setInvite(null);
        } else {
          setInvite(data);
        }
      } catch (err) {
        if (!active) return;
        setValidationError(
          err instanceof Error ? err.message : 'Unable to validate invitation link.'
        );
      } finally {
        if (active) setValidating(false);
      }
    }
    void checkInvite();
    return () => {
      active = false;
    };
  }, [token, isLegacyToken]);

  const passwordChecks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    match: password.length > 0 && password === confirmPassword,
  };

  const normalizedEmail = email.trim().toLowerCase();

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    setFormError(null);

    if (!fullName.trim()) {
      setFormError('Full name is required.');
      return;
    }
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (invite.requiresPhone && phone.trim().length < 6) {
      setFormError('A valid phone number is required for this invitation.');
      return;
    }
    if (!existingAccountMode) {
      if (
        !passwordChecks.length ||
        !passwordChecks.upper ||
        !passwordChecks.lower ||
        !passwordChecks.number
      ) {
        setFormError(
          'Password must be at least 8 characters and include uppercase, lowercase, and a number.'
        );
        return;
      }
      if (!passwordChecks.match) {
        setFormError('Password and confirmation password do not match.');
        return;
      }
    } else if (!password) {
      setFormError('Enter your existing account password to continue verification.');
      return;
    }

    setSubmitting(true);
    try {
      if (
        auth.currentUser &&
        auth.currentUser.email?.toLowerCase() !== normalizedEmail
      ) {
        await signOut(auth);
      }

      let user = auth.currentUser;
      if (existingAccountMode) {
        const cred = await signInWithEmailAndPassword(auth, normalizedEmail, password);
        user = cred.user;
      } else {
        const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        user = cred.user;
        await updateProfile(user, { displayName: fullName.trim() });
      }

      await user.reload();
      if (user.emailVerified) {
        setEmailVerified(true);
        setEmailNotice('Email address is already verified.');
      } else {
        await sendEmailVerification(user);
        setEmailVerified(false);
        setEmailNotice(
          `Verification link sent to ${normalizedEmail}. Open your inbox and click the link, then click "Check Verification Status".`
        );
      }
      setStep('verify');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('auth/email-already-in-use')) {
        setExistingAccountMode(true);
        setFormError(
          `An account already exists for ${normalizedEmail}. Enter that account's password below to verify ownership and link this department invitation.`
        );
      } else if (msg.includes('auth/operation-not-allowed')) {
        setFormError(
          'Email/Password sign-in is disabled in Firebase Console (Authentication → Sign-in method). Ask the Super Administrator to enable Email/Password authentication.'
        );
      } else {
        setFormError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckEmailVerification = async () => {
    setFormError(null);
    setSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('No active registration session found. Please sign in again.');
      }
      await user.reload();
      if (user.emailVerified) {
        setEmailVerified(true);
        setEmailNotice('Email address verified successfully.');
      } else {
        setEmailVerified(false);
        setEmailNotice(
          'Email verification is still pending. Please click the verification link in your inbox and try again.'
        );
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to check verification status.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerificationEmail = async () => {
    setFormError(null);
    setSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Session missing.');
      await sendEmailVerification(user);
      setEmailNotice(`Verification email re-sent to ${normalizedEmail}.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to send verification email.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendSmsOtp = async () => {
    setFormError(null);
    setSmsNotice(null);
    setSubmitting(true);
    try {
      const payload = isLegacyToken ? { token, phone } : { code: token, phone };
      const res = await fetch('/api/v1/invitations/send-sms-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { status?: string; detail?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send SMS OTP.');
      }
      setSmsSent(true);
      setSmsNotice(`Verification code sent to ${phone}.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'SMS verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifySmsOtp = async () => {
    setFormError(null);
    setSubmitting(true);
    try {
      const payload = isLegacyToken
        ? { token, otp: smsCode.trim() }
        : { code: token, otp: smsCode.trim() };
      const res = await fetch('/api/v1/invitations/verify-sms-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { verified?: boolean; error?: string };
      if (!res.ok || !data.verified) {
        throw new Error(data.error || 'Invalid SMS verification code.');
      }
      setSmsVerified(true);
      setSmsNotice('Phone number verified.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Code verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const smsRequired = Boolean(
    invite?.messaging.smsConfigured && (invite.requiresPhone || phone.trim().length > 0)
  );

  const handleCompleteRegistration = async () => {
    if (!invite) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Authenticated registration session missing.');
      await user.reload();
      if (!user.emailVerified) {
        setEmailVerified(false);
        throw new Error('Please verify your email address before submitting registration.');
      }
      if (smsRequired && !smsVerified) {
        throw new Error('Please complete SMS phone verification before submitting registration.');
      }

      const idToken = await user.getIdToken(true);
      const bodyPayload = {
        ...(isLegacyToken ? { token } : { code: token }),
        fullName: fullName.trim(),
        phone: phone.trim(),
      };

      const res = await fetch('/api/v1/invitations/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(bodyPayload),
      });
      const data = (await res.json()) as {
        registered?: boolean;
        pendingVerification?: boolean;
        departmentLabel?: string;
        departmentRole?: string;
        error?: string;
      };
      if (!res.ok || !data.registered) {
        throw new Error(data.error || 'Failed to submit staff account registration.');
      }

      setRegisteredDeptLabel(data.departmentLabel || invite.departmentLabel);
      setRegisteredRole(data.departmentRole || invite.departmentRole);
      setStep('submitted');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Account registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckApprovalStatus = async () => {
    setStatusCheckMsg(null);
    setSubmitting(true);
    try {
      await refreshProfile();
      setStatusCheckMsg(
        'Your account is still awaiting Super Administrator verification. You will receive an email once approved.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const inviteTypeLabel =
    INVITATION_TYPE_LABELS[invite?.invitationType || 'staff_account'] || 'Staff Account';

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
            <p className="typo-card-heading tracking-tight text-white">SWAS TASKS</p>
            <p className="typo-meta text-blue-200">Department Staff Onboarding</p>
          </div>
        </div>

        <div className="relative z-10 my-10 lg:my-0 max-w-md">
          <p className="typo-meta font-medium tracking-wide text-blue-200 mb-3">
            Invitation-Only Registration
          </p>
          <h1 className="typo-dashboard-heading text-white">
            Join Your Assigned SWAS TASKS Department
          </h1>
          <p className="mt-4 typo-body text-slate-200">
            Complete registration using this secure invitation link. Once submitted, the Super
            Administrator verifies your account before workplace access is activated.
          </p>

          {invite ? (
            <div className="mt-6 bg-white/10 border border-white/15 rounded-lg p-4 space-y-2 typo-meta">
              <div className="flex justify-between gap-3">
                <span className="text-blue-200">Invitation Type</span>
                <span className="font-semibold text-white">{inviteTypeLabel}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-blue-200">Assigned Department</span>
                <span className="font-semibold text-white">{invite.departmentLabel}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-blue-200">Assigned Role</span>
                <span className="font-semibold text-white">{invite.departmentRole}</span>
              </div>
              {invite.inviterName ? (
                <div className="flex justify-between gap-3">
                  <span className="text-blue-200">Invited By</span>
                  <span className="font-medium text-white">{invite.inviterName}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <span className="text-blue-200">Link Policy</span>
                <span className="text-white">
                  {invite.singleUse !== false ? 'Single-use secure link' : 'Reusable until expiry'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-blue-200">Link Expires</span>
                <span className="tabular-nums text-white">
                  {new Date(invite.expiresAt).toLocaleString()}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative z-10 border-t border-white/15 pt-5 typo-meta text-blue-200 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 text-blue-300" />
          <span>
            Two-step Super Admin verification enforced. Official notices:{' '}
            <span className="font-mono text-white">{OFFICIAL_PLATFORM_EMAIL}</span>
          </span>
        </div>
      </div>

      {/* Right Onboarding Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg p-7 sm:p-8">
          {currentAdminEmail ? (
            <div className="mb-5 p-4 rounded-md bg-amber-50 border border-amber-200 space-y-2.5">
              <p className="text-xs font-semibold text-amber-900">
                Currently signed in as {currentAdminEmail}
              </p>
              <p className="text-xs text-amber-800">
                To register a new staff member using this invitation link, sign out of your current
                session first or return to your Control Centre workspace.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#102B50] hover:bg-[#172B46] rounded-md"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out to Register
                </button>
                <button
                  type="button"
                  onClick={onExitToLogin}
                  className="px-3 py-1.5 text-xs font-medium text-[#172B46] bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Return to Control Centre
                </button>
              </div>
            </div>
          ) : null}

          {validating ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-7 h-7 border-2 border-[#1265C8] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-[#75869D]">Validating secure invitation link...</p>
            </div>
          ) : validationError || !invite ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 text-[#D34552]">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h2 className="typo-section-heading text-[#172B46]">
                  Invitation Link Invalid or Expired
                </h2>
              </div>
              <p className="typo-body text-[#75869D]">
                {validationError || 'This invitation link cannot be used.'}
              </p>
              <button
                type="button"
                onClick={onExitToLogin}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 typo-button text-white bg-[#102B50] hover:bg-[#172B46] rounded-md transition-colors"
              >
                Return to Administrator Sign In
              </button>
            </div>
          ) : step === 'submitted' ? (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 text-[#B7791F] flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="typo-section-heading text-[#172B46]">
                    Registration Submitted — Pending Verification
                  </h2>
                  <p className="typo-meta text-[#75869D]">
                    Your staff account has been created and locked pending approval.
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-md bg-[#F3F6FA] border border-slate-200 space-y-2 typo-meta">
                <div className="flex justify-between gap-3">
                  <span className="text-[#75869D]">Registered Account</span>
                  <span className="font-semibold text-[#172B46]">{normalizedEmail}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#75869D]">Assigned Department</span>
                  <span className="font-semibold text-[#172B46]">{registeredDeptLabel}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#75869D]">Department Role</span>
                  <span className="font-semibold text-[#172B46]">{registeredRole}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#75869D]">Verification Status</span>
                  <span className="font-semibold text-[#B7791F]">
                    Pending Super Admin Verification
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-md bg-blue-50 border border-blue-200 text-xs text-[#172B46] space-y-1">
                <p className="font-semibold text-[#102B50]">Next Step: Super Admin Review</p>
                <p>
                  For security, newly registered staff accounts cannot access any department
                  workplace until a Super Administrator verifies and activates them. Once approved,
                  you will receive an activation email from{' '}
                  <span className="font-mono">{OFFICIAL_PLATFORM_EMAIL}</span>.
                </p>
              </div>

              {statusCheckMsg ? (
                <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  {statusCheckMsg}
                </div>
              ) : null}

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleCheckApprovalStatus()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md transition-colors disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
                  {submitting ? 'Checking Approval Status...' : 'Check Approval Status'}
                </button>
                <button
                  type="button"
                  onClick={onExitToLogin}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 typo-button text-[#172B46] bg-[#F3F6FA] hover:bg-slate-200 border border-slate-200 rounded-md transition-colors"
                >
                  Go to Administrator Sign In
                </button>
              </div>
            </div>
          ) : step === 'form' ? (
            <div>
              <div className="mb-5">
                <h2 className="typo-page-heading text-[#172B46]">
                  Complete Staff Account Registration
                </h2>
                <p className="mt-1 typo-meta text-[#75869D]">
                  Invited to{' '}
                  <span className="font-semibold text-[#1265C8]">{invite.departmentLabel}</span> as{' '}
                  <span className="font-medium text-[#172B46]">{invite.departmentRole}</span>.
                </p>
              </div>

              {formError ? (
                <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-[#D34552] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              ) : null}

              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#172B46] mb-1">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#75869D] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Enter your full legal name"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md text-[#172B46] focus:outline-none focus:border-[#1265C8]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#172B46] mb-1">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#75869D] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={
                        invite.emailRestricted
                          ? 'Enter the exact email address that received this invite'
                          : 'name@company.com'
                      }
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md text-[#172B46] focus:outline-none focus:border-[#1265C8]"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-[#75869D]">
                    {invite.emailRestricted
                      ? 'This private invitation is restricted to the invited email address.'
                      : 'Open shareable invitation link — enter your official email address to register.'}
                  </p>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#172B46] mb-1">
                    Phone Number {invite.requiresPhone ? '(Required)' : '(Optional)'}
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-[#75869D] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      required={Boolean(invite.requiresPhone)}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+254712345678"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md text-[#172B46] focus:outline-none focus:border-[#1265C8]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#172B46] mb-1">
                    {existingAccountMode ? 'Existing Account Password' : 'Password'}
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#75869D] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        existingAccountMode
                          ? 'Enter existing Firebase password'
                          : 'Minimum 8 characters with upper, lower & digit'
                      }
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md text-[#172B46] focus:outline-none focus:border-[#1265C8]"
                    />
                  </div>
                </div>

                {!existingAccountMode ? (
                  <>
                    <div>
                      <label className="block text-[13px] font-medium text-[#172B46] mb-1">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-[#75869D] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="password"
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter password"
                          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md text-[#172B46] focus:outline-none focus:border-[#1265C8]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-[11px] bg-[#F3F6FA] p-3 rounded-md border border-slate-200">
                      <span
                        className={
                          passwordChecks.length ? 'text-[#15966B] font-medium' : 'text-[#75869D]'
                        }
                      >
                        8+ characters
                      </span>
                      <span
                        className={
                          passwordChecks.upper ? 'text-[#15966B] font-medium' : 'text-[#75869D]'
                        }
                      >
                        Uppercase letter
                      </span>
                      <span
                        className={
                          passwordChecks.lower ? 'text-[#15966B] font-medium' : 'text-[#75869D]'
                        }
                      >
                        Lowercase letter
                      </span>
                      <span
                        className={
                          passwordChecks.number ? 'text-[#15966B] font-medium' : 'text-[#75869D]'
                        }
                      >
                        Numeric digit
                      </span>
                      <span
                        className={
                          passwordChecks.match ? 'text-[#15966B] font-medium' : 'text-[#75869D]'
                        }
                      >
                        Passwords match
                      </span>
                    </div>
                  </>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 typo-button text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md transition-colors disabled:opacity-60"
                >
                  <span>
                    {submitting
                      ? 'Creating Account & Sending Verification...'
                      : 'Create Staff Account & Verify Email'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between typo-meta text-[#75869D]">
                <button
                  type="button"
                  onClick={onExitToLogin}
                  className="text-[#1265C8] font-medium hover:underline"
                >
                  Already registered? Sign in
                </button>
                <span className="font-mono text-[11px]">{invite.invitationId}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="typo-page-heading text-[#172B46]">
                  Verify Email & Submit for Approval
                </h2>
                <p className="mt-1 typo-meta text-[#75869D]">
                  Verify your email before submitting your {invite.departmentLabel} registration to
                  the Super Administrator.
                </p>
              </div>

              {formError ? (
                <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-[#D34552] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              ) : null}

              {/* Email Verification Card */}
              <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#172B46]">
                    1. Email Verification ({normalizedEmail})
                  </span>
                  {emailVerified ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#15966B]">
                      <CheckCircle2 className="w-4 h-4" />
                      Verified
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-[#B7791F]">Pending</span>
                  )}
                </div>
                {emailNotice ? <p className="text-xs text-[#75869D]">{emailNotice}</p> : null}
                {!emailVerified ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleCheckEmailVerification()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Check Verification Status
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleResendVerificationEmail()}
                      className="px-3 py-1.5 text-xs font-medium text-[#172B46] bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                    >
                      Resend Verification Email
                    </button>
                  </div>
                ) : null}
              </div>

              {/* SMS Verification Card */}
              <div className="p-4 rounded-md border border-slate-200 bg-[#F3F6FA] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#172B46]">
                    2. Phone SMS Verification ({phone || 'Not Provided'})
                  </span>
                  {!invite.messaging.smsConfigured ? (
                    <span className="text-xs font-semibold text-[#75869D]">Not Required</span>
                  ) : !smsRequired ? (
                    <span className="text-xs font-semibold text-[#75869D]">Optional</span>
                  ) : smsVerified ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#15966B]">
                      <CheckCircle2 className="w-4 h-4" />
                      Verified
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-[#B7791F]">Required</span>
                  )}
                </div>

                {!invite.messaging.smsConfigured ? (
                  <p className="text-xs text-[#75869D]">
                    SMS Verification Service is <span className="font-semibold">Not Configured</span>{' '}
                    on this server. Email verification suffices.
                  </p>
                ) : !smsRequired ? (
                  <p className="text-xs text-[#75869D]">
                    No phone number provided; SMS OTP is optional for this invitation.
                  </p>
                ) : smsVerified ? (
                  <p className="text-xs text-[#15966B]">{smsNotice || 'Phone verified.'}</p>
                ) : (
                  <div className="space-y-2">
                    {smsNotice ? <p className="text-xs text-[#75869D]">{smsNotice}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleSendSmsOtp()}
                        className="px-3 py-1.5 text-xs font-medium text-[#172B46] bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                      >
                        {smsSent ? 'Resend SMS Code' : 'Send SMS Verification Code'}
                      </button>
                      {smsSent ? (
                        <>
                          <input
                            type="text"
                            value={smsCode}
                            onChange={(e) => setSmsCode(e.target.value)}
                            placeholder="6-digit OTP"
                            className="w-28 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white"
                          />
                          <button
                            type="button"
                            disabled={submitting || !smsCode.trim()}
                            onClick={() => void handleVerifySmsOtp()}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md"
                          >
                            Verify Code
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={submitting || !emailVerified || (smsRequired && !smsVerified)}
                onClick={() => void handleCompleteRegistration()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 typo-button text-white bg-[#15966B] hover:bg-[#102B50] rounded-md transition-colors disabled:opacity-50"
              >
                <span>
                  {submitting
                    ? 'Submitting Staff Registration...'
                    : 'Complete Registration & Request Verification'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
