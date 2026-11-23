# SWAS TASKS – Central Control Centre Setup & Operations Guide

This repository contains the private administration backend (**SWAS TASKS – Central Control Centre**) built with React, TypeScript, Tailwind CSS, Express, Firebase Authentication, Cloud Firestore, and Firebase Storage.

---

## 1. Architecture Overview

- **Frontend (Vite + React SPA)**: Dark-navy vertical sidebar (`#102B50`), Royal-blue active navigation (`#1265C8`), Super Administrator Global Control Centre, and 8 isolated Departmental Workplaces.
- **Backend (Express REST API on port 3000)**: Serves the SPA and exposes `/api/v1/*` endpoints, Swagger/OpenAPI documentation (`/api/docs` & `/api/v1/openapi.json`), cryptographic API key authentication, idempotent KES withdrawal review, and signed single-use staff invitation verification.
- **Database & Auth (Firebase)**:
  - Firebase Authentication (Google Sign-In & Email/Password).
  - Cloud Firestore (real-time listeners + `firestore.rules` RBAC enforcement).
  - Firebase Storage (platform logo & staff profile avatar uploads).

---

## 2. Environment Variables (`.env`)

Copy `.env.example` to `.env` (or configure secrets in your hosting environment). Never expose server-side secrets in browser JavaScript.

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_URL` | Yes | Base URL where the Control Centre is hosted (used to build invitation links) |
| `PUBLIC_WEBSITE_URL` | Recommended | Origin of the connected SWAS TASKS public website |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated CORS origins allowed to call public/API-key endpoints |
| `API_KEY_HMAC_SECRET` | Yes (Prod) | High-entropy secret used for HMAC-SHA256 hashing of API keys |
| `INVITATION_SIGNING_SECRET` | Yes (Prod) | High-entropy secret used to sign single-use staff invitation tokens |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | Yes | Initial Super Administrator email (`brianwaithakamuiru@gmail.com`) |
| `OFFICIAL_PLATFORM_EMAIL` | Yes | Official platform email across both websites (`swastaskorg@gmail.com`) |
| `EMAIL_SENDER_NAME` | Yes | Sender display name (`SWAS TASKS`) |
| `EMAIL_REPLY_TO` | Yes | Official reply-to email (`swastaskorg@gmail.com`) |
| `GMAIL_SMTP_USER` | Optional | Gmail account for SMTP delivery (`swastaskorg@gmail.com`, server-side only) |
| `GMAIL_APP_PASSWORD` | Optional | Google 16-character App Password for `swastaskorg@gmail.com` (never expose in frontend) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Optional | Custom authenticated SMTP relay (server-side only) |
| `RESEND_API_KEY` | Optional | Alternative Resend HTTPS API key for automated emails (displays `EMAIL SERVICE NOT CONFIGURED` if no email provider is set) |
| `EMAIL_FROM` | Optional | Optional Resend sender header override (defaults to `SWAS TASKS <swastaskorg@gmail.com>`) |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio Account SID for phone OTP SMS verification |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio Auth Token |
| `TWILIO_FROM_NUMBER` | Optional | Twilio SMS sender number (E.164 format) |
| `MPESA_ENV` | Optional | `sandbox` or `production` for Safaricom M-Pesa Daraja |
| `MPESA_CONSUMER_KEY` | Optional | Daraja Consumer Key (server-side only) |
| `MPESA_CONSUMER_SECRET` | Optional | Daraja Consumer Secret (server-side only) |
| `MPESA_SHORTCODE` | Optional | M-Pesa Paybill/Till Shortcode |
| `MPESA_PASSKEY` | Optional | Lipa Na M-Pesa Online Passkey |
| `MPESA_CALLBACK_URL` | Optional | Public HTTPS callback URL for M-Pesa payment confirmations |

---

## 3. Firebase Configuration & Security Rules

1. **Firebase Project Config**: `firebase-applet-config.json` stores the Firebase Web SDK configuration and Firestore `databaseId` (`ai-studio-e41d3646-20c3-4c30-9e77-8d17cbf0b157`).
2. **Authentication Providers**:
   - In the Firebase Console → **Authentication → Sign-in method**, enable **Google** and **Email/Password**.
3. **Firestore Security Rules (`firestore.rules`)**:
   - Validate syntax locally before deploying:
     ```bash
     npx eslint firestore.rules
     ```
   - Deploy `firestore.rules` via Firebase CLI or AI Studio Firebase deployment.
   - Rules strictly isolate each of the 8 departments (`user_management`, `client_management`, `task_monitoring`, `bids_assignments`, `finance_control`, `api_management`, `activity_logs`, `platform_settings`), protect `activity_logs` as write-once immutable, block direct admin edits to `wallets` and `transactions` balances, and restrict `admin_users` self-edits to profile fields (`displayName`, `phone`, `photoUrl`, `notificationPrefs`, `lastLoginAt`, `updatedAt`).
4. **Firebase Storage**:
   - Ensure authenticated admin write access is enabled for `avatars/{uid}/*` and `branding/*` (PNG/JPEG/WebP/SVG up to 2 MB).

---

## 4. Super Admin & Invitation-Only Staff Registration

There is **no public staff registration page**.

1. **Super Admin Bootstrap**:
   - Sign in with the configured `BOOTSTRAP_SUPER_ADMIN_EMAIL` (`brianwaithakamuiru@gmail.com`) via Google Sign-In or Email/Password.
   - On first verified sign-in, `/api/v1/admin/me` provisions the `SUPER_ADMIN` record in `admin_users`.
2. **Inviting Department Staff**:
   - Navigate to **Staff Management → Invite Staff**.
   - Select one of the 8 departments, enter full name, email, and phone number, pick a department role preset and granular permissions (`view`, `create`, `edit`, `approve`, `reject`, `suspend`, `revoke`, `export`, `manage`), and generate the single-use invitation link.
   - If `RESEND_API_KEY` is configured, the invitation is emailed automatically; otherwise the Super Admin can copy the secure link directly from the confirmation banner.
3. **Staff Activation**:
   - The invited staff member opens `?invite=<token>` (or `#/invite/<token>`), creates their password, completes verification, and is immediately locked into their assigned department workplace.

---

## 5. Connecting the SWAS TASKS Public Website

1. Open **API Management → Create API Key** to issue a scoped cryptographic API key (`public:config:read`, `tasks:read`, etc.). Copy the one-time secret immediately; only its HMAC-SHA256 hash is stored in Firestore.
2. Open **API Management → Connected Websites** to register the public website URL and allowed CORS origins.
3. Public website endpoints available on this backend:
   - `GET /api/v1/platform/status` — API & Firestore health probe.
   - `GET /api/v1/config/public` — Live branding, registration toggles, commission rate, minimum withdrawal KES, maintenance mode, and legal policies.
   - `GET /api/docs` & `GET /api/v1/openapi.json` — Interactive OpenAPI 3.1 reference.

---

## 6. Build & Production Startup

```bash
# Type-check & lint
npm run lint
npx eslint firestore.rules

# Build production frontend bundle
npm run build

# Start production Express server (port 3000)
npm start
```
