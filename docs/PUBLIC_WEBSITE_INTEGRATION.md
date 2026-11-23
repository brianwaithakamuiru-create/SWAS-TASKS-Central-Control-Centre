# Public Website Integration Guide – SWAS TASKS

This guide connects your separate **SWAS TASKS Public Website** to **SWAS TASKS – Central Control Centre**.

## 1. Shared Firebase Project Configuration
Configure the public website's Firebase client SDK against the same Firebase project (`projectId` and `firestoreDatabaseId` from `firebase-applet-config.json`).

## 2. Register the Public Website in API Management
1. Sign in as Super Administrator or API Administrator.
2. Open **API Management → Connected Websites** and register your public website origin in `ALLOWED_ORIGINS`.
3. Open **API Management → API Keys** and generate a cryptographic key (`swas_live_...`). Copy the one-time secret into your public website server secrets (never commit it to browser JavaScript).

## 3. Reading Public Platform Settings & Maintenance State
Your public website should fetch live platform settings from:
```
GET <ADMIN_API_BASE_URL>/api/v1/config/public
```
This returns `platformName`, `tagline`, `primaryColor`, `accentColor`, `logoUrl`, `maintenanceMode`, `allowWorkerRegistration`, `allowClientRegistration`, `platformFeePercent`, `termsText`, and `privacyText`.

## 4. Authenticated User Requests
Public users (workers and clients) authenticate via Firebase Auth on the public website. Firestore Security Rules enforce:
- Public users can only read/create their own `users/{uid}`, `clients/{clientId}`, `bids/{bidId}`, and `tasks/{taskId}` records.
- Public users are strictly blocked from `admin_users`, `api_keys`, `activity_logs`, `security_events`, and administrative mutations.

## 5. OpenAPI / Swagger Reference
Inspect all v1 endpoints at `/api/docs` or `/api/v1/openapi.json`.
