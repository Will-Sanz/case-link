# Completed production demo-data upgrade

The user identified all 44 original families as old test/demo data. The user explicitly approved removal and upgrade. The rehearsed transaction committed on October 15, 2026 at 01:01:51 UTC.

- Removed those 44 demo families and their linked case data, including 66 plans, 726 plan steps, 1,696 action items, 961 resource matches and 283 demo activity entries. All are preserved in the encrypted recovery point.
- Preserved all 54 resources, the resource-import record, 11 application accounts with their existing roles/profile fields, and 13 authentication accounts with their existing credentials.
- Applied the 21 missing tested migrations, checked all 67 final constraints, and reconciled migration history to the 40 repository migrations. Before mutation, source schema fingerprints and all 20 public-table content hashes matched the backup. Retained account/resource/import fields and Auth identities were unchanged. The transaction used serializable isolation and a bounded lock timeout; failure would roll it back.
- Production application verification/promotion remains pending. No school staff were invited.

The encrypted backup was taken at 2026-10-15 00:43:58 UTC. The archive uses authenticated AES-256-GCM encryption with a private macOS Keychain recovery key. A fresh isolated database restored all 56 tables / 4,286 rows with exact content hashes. The source was untouched and all temporary databases were removed. The scratch restore retained application grants but excluded nine Supabase-managed default grants that the operator cannot change; it used postgres ownership. This proves logical data recovery, not recreation of the entire Supabase service, SMTP, external storage, or provider-owned permissions. Storage currently has no objects. A separate off-machine backup/key copy and an ongoing backup schedule are still operational follow-ups.

A second isolated restored copy successfully rehearsed the demo cleanup and all 21 upgrades in one transaction. All original account/resource/import fields were unchanged; 67 final constraints passed. The transaction was rolled back, then the scratch database removed. The first rehearsal rejected an attempted null family reference in demo activity; the approved proposal uses the existing cascade relationship and preserves that history in the encrypted archive.

Evidence: [backup](2026-10-15-hosted-backup.json), [restore](2026-10-15-hosted-restore.json), [upgrade rehearsal](2026-10-15-legacy-demo-rehearsal.json).

Independent read-back found zero families/plans, 54 resources, 11 application accounts, 13 Auth accounts, zero MFA factors, all 40 migration records through `20261014230221`, no public table without RLS, no anonymous execution of privileged public functions and no scratch databases. A separate real Auth/Data API test created two disposable standard staff accounts and two synthetic families. It proved ownership isolation, denied foreign writes, offboarding with preserved case history, immediate retained-token denial, rejected refresh/sign-in after offboarding, successful replacement access, and logout denial. All fixtures were removed and all pre-existing accounts preserved. Operator audit events remain.

Executed evidence: [transaction](2026-10-15-production-upgrade.json), [production access test](2026-10-15-production-access.json). The original pre-upgrade containment migration-history record is preserved in the encrypted archive. No existing password, live secret or resource was changed.
