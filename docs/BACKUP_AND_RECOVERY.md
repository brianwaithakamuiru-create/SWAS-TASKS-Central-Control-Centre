# Backup & Recovery Guide – SWAS TASKS Central Control Centre

## 1. Cloud Firestore Scheduled Exports
Configure automated daily Firestore exports to a dedicated Cloud Storage bucket in the same region:
```bash
gcloud firestore export gs://<BACKUP_BUCKET>/firestore-backups/$(date +%Y-%m-%d) \
  --database='ai-studio-e41d3646-20c3-4c30-9e77-8d17cbf0b157'
```

## 2. Point-in-Time Recovery (PITR)
Enable Firestore PITR on the production database so documents can be restored to any minute within the retention window.

## 3. Configuration Snapshot Export
Authorized Platform Configuration Administrators can download an immediate JSON snapshot of `platform_settings` from **Platform Settings → Backup & Recovery**.

## 4. Incident & Compromised Key Recovery
1. Immediately revoke any compromised key under **API Management → API Keys → Revoke**.
2. Issue a replacement key via **Key Rotation** and update the public website server secret.
3. Review **Activity Logs → Security Logs** and **Audit Trail** for unauthorized access patterns.
