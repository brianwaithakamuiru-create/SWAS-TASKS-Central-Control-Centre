# SWAS TASKS – Central Control Centre Security Specification

## 1. Data Invariants
1. Public users cannot self-register as administrators (`admin_users`, `admin_roles`, `admin_permissions` writes restricted exclusively to verified Super Administrator).
2. Unverified emails (`request.auth.token.email_verified != true`) are rejected for all admin operations.
3. Audit logs (`activity_logs`) and security events (`security_events`) are strictly append-only; neither admins nor users may update or delete audit records.
4. Worker `wallets` balances cannot be arbitrarily overwritten by admins from client SDKs.
5. API keys (`api_keys`) never store plaintext secrets; `keyHash` must be a cryptographic hash (`>= 32` chars).
6. PII collections (`users`, `clients`, `messages`, `conversations`, `wallets`, `transactions`, `withdrawals`) deny blanket reads (`isSignedIn()`).
7. Document IDs must satisfy `^[a-zA-Z0-9_-]+$` and length `<= 128`.
8. Server timestamps (`request.time`) or immutable `createdAt` fields prevent backdating.

## 2. Dirty Dozen Adversarial Payloads
1. **Unauthenticated read of users**: `GET /users/u1` with `auth == null` -> `PERMISSION_DENIED`.
2. **Non-admin authenticated user self-escalating**: `CREATE /admin_users/attacker` by normal user `uid: attacker` with `role: "SUPER_ADMIN"` -> `PERMISSION_DENIED`.
3. **Spoofed admin email without verification**: `GET /admin_users/x` with `email: "brianwaithakamuiru@gmail.com", email_verified: false` -> `PERMISSION_DENIED`.
4. **Shadow field injection on task update**: `UPDATE /tasks/t1` adding ghost key `isVerifiedAdmin: true` -> `PERMISSION_DENIED`.
5. **Audit log tampering**: `UPDATE /activity_logs/log1` or `DELETE /activity_logs/log1` even by Super Admin -> `PERMISSION_DENIED`.
6. **Arbitrary wallet balance edit**: `UPDATE /wallets/w1` setting `availableBalanceKes: 999999` -> `PERMISSION_DENIED`.
7. **Unauthorized finance withdrawal approval**: `UPDATE /withdrawals/wd1` by `TASK_MODERATOR` -> `PERMISSION_DENIED`.
8. **Path ID poisoning**: `CREATE /tasks/../../../etc/passwd` or 500-char ID -> `PERMISSION_DENIED`.
9. **Blanket list query on PII**: `LIST /users` by non-admin authenticated user -> `PERMISSION_DENIED`.
10. **Role override by User Management Admin**: `UPDATE /admin_users/a2` by `USER_MANAGEMENT_ADMIN` changing role to `SUPER_ADMIN` -> `PERMISSION_DENIED`.
11. **Plaintext API key injection**: `CREATE /api_keys/k1` with missing or short `keyHash` (`"abc"`) -> `PERMISSION_DENIED`.
12. **PII exposure in messages**: `GET /messages/m1` by non-participant or non-authorized user -> `PERMISSION_DENIED`.
