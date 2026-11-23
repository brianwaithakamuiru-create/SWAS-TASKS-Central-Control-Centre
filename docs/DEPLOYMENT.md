# Deployment Guide – SWAS TASKS Central Control Centre

## 1. Environment Variables
Set the following server-side variables in your hosting environment (Cloud Run / Secret Manager):
- `NODE_ENV=production`
- `PORT=3000`
- `APP_URL=https://admin.swastasks.example.com`
- `PUBLIC_WEBSITE_URL=https://swastasks.example.com`
- `ALLOWED_ORIGINS=https://swastasks.example.com`
- `API_KEY_HMAC_SECRET=<64-hex-random-secret>`
- `BOOTSTRAP_SUPER_ADMIN_EMAIL=brianwaithakamuiru@gmail.com`

Never expose `API_KEY_HMAC_SECRET` or Firebase service credentials in frontend `VITE_*` variables.

## 2. Build & Start
```bash
npm install
npm run build
npm start
```

## 3. Firebase Rules & Indexes Deployment
Deploy `firestore.rules` and `firestore.indexes.json` to your Firebase project (`gen-lang-client-0631618971`):
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## 4. First-Time Super Administrator Provisioning
1. Sign in with the verified Super Administrator account (`BOOTSTRAP_SUPER_ADMIN_EMAIL`).
2. `GET /api/v1/admin/me` verifies the Firebase ID token and automatically creates the `SUPER_ADMIN` document in `admin_users/{uid}`.
3. From **User Management → User Roles & Permissions**, the Super Administrator can authorize additional department-scoped administrators.
4. To enable Email/Password login in addition to Google Sign-In, enable **Email/Password** under **Firebase Console → Authentication → Sign-in method**.
