# Secret isolation and recovery — October 14, 2026

CL-42 remains open for production AI use, provider key provenance/budgets, historical snapshots/exposure review and any authorized rotation. The current configuration below supersedes older observations.

## October 15 current configuration

Production now has eight verified Config values and one preserved write-only OpenAI Secret. The canonical origin is `https://www.thecaselink.com`; the database is `zpfypkizsapvsxeykmdq`. Production-only settings include single-tenant, invite-only, HSTS, explicit production environment and the approved project marker. `SUPABASE_SERVICE_ROLE_KEY` and `CASELINK_PDF_MODE` were removed from future web deployments. Preview remains branch-scoped to separate staging and its separate OpenAI Secret; Development has no remote credential entries. [Metadata/read-back](2026-10-15-production-environment.json).

The production candidate `dpl_2bGrr5VGVTrqdRtwRzGq2tu57zpi` is READY with those values. Its application code is the tested `7c9af9e` commit. It has not been promoted; the canonical live address still serves the older deployment and its historical environment snapshot. No live secret was rotated or exposed. Existing production SMTP works: a recovery email reached the authorized owner inbox with SPF/DKIM and the correct canonical fragment-only link. The existing account password was unchanged.

The short-lived development OIDC path used for staging did not authorize the protected production deployment. An official CLI test-access-cookie probe was rejected by automatic approval review before execution; it remains pending explicit approval. No new bypass credential or rule was created and protection remains enabled. A separate proposed synthetic production administrator was also rejected before execution; standard staff tests instead passed without granting administrator access. Do not silently reintroduce that administrator step into the final runner.

The latest full CI includes 686 unit/component tests, seven browser scenarios, database/Auth/restore/legacy/PDF checks and secret scanning. This does not establish removal of historical local keys, old deployment snapshots, or a restricted off-machine recovery vault. Those remain documented operating work, not a reason to rotate live credentials without authorization.

## Background hosted-test credential boundary

Metadata-only read-back confirmed no Vercel Development variables. The protected headless test uses a short-lived Vercel OIDC token scoped by request origin; it is never forwarded to Supabase or other origins. The first proposed token-only probe was rejected by automatic review because a generic environment command could load unrelated credentials. After verifying the empty remote scope, the actual guarded runner exposed a further CLI behavior: running from the repository also loads `.env.local`. Its explicit application/provider-key guard failed before browser startup, fixture creation or application requests. No value was printed or saved. Running the same reviewed test from a clean temporary directory, with explicit project/team, passes that guard and reaches the protected staging site. Do not run this verification from the repository, use `env pull`, or disable deployment protection. This does not remediate the pre-existing local production credentials or old deployment snapshots.

## Original hosted configuration (before isolation)

Read-only inspection confirmed Vercel project `case-link` (`prj_1zxzzKu8eljHJvPd6gFY3LhyxwWc`) in team `team_wwXXIa3JR9qMrIBopTUBsG5J`. The connected environment-list API returned 403. The already authenticated CLI then returned names, types and target environments only; no values were decrypted, pulled, printed or changed.

| Name | Observed targets | Intended consumer and storage |
| --- | --- | --- |
| `OPENAI_API_KEY` | Production, Preview, Development in one entry | Server only; separate approved OpenAI project/key per environment; managed Secret variable |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview, Development in one entry | Remove from web hosting; restricted operator vault/job only for invitations and offboarding |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Development in each entry | Public connection information; separate projects and corresponding publishable/anon keys; database policies enforce access |
| `NEXT_PUBLIC_SITE_URL` | Production, Preview, Development in one entry | Exact environment-specific HTTPS origin; match Auth redirects and school-approved domain |
| `CASELINK_TENANCY_MODE`, `CASELINK_INVITE_ONLY`, `CASELINK_HSTS` | Production only | Required posture in each hosted environment |
| `CASELINK_PDF_MODE` | Production only | Obsolete flag; remove during reviewed settings cleanup |
| `CASELINK_ENVIRONMENT`, `CASELINK_PRODUCTION_SUPABASE_URL` | Not listed | Explicit target and non-secret approved production-project marker required by the new guard |
| Direct database credentials, vendor recovery/MFA material | Not listed in this metadata response | Restricted operator vault; never application or ordinary CI variables |

The CLI labels stored entries “Encrypted”; that is not evidence of the current write-only Secret setting. Verify managed Secret type, Production-only scope, operator access/MFA and recovery ownership in the provider. The user has restored the configured production-intended Supabase project `zpfypkizsapvsxeykmdq`; [its legacy schema and separate staging preparation](hosted-database-preflight.md) still block release. The user-created Free staging project is `umnbyupudhunyccqhyrp`; its database and limited SQL role checks are complete. Owners, actual preview connection/credential separation, provider retention and key provenance remain pending. The shared entry targets are sufficient to block release; no comparison of secret values was needed or performed.

## Staging isolation applied later on October 14

The five original shared entries now target **Production only**, preserving their existing values without retrieving or printing them. The original OpenAI and service-role entries now use the provider's write-only Secret type. Preview and Development no longer inherit these entries. Eight non-secret settings are installed only for Preview branch `codex/school-pilot-readiness`: the staging URL and publishable key, its exact HTTPS branch origin, environment and production-project markers, and single-tenant/invite-only/HSTS posture. Other branches do not receive this approved staging configuration automatically.

Each mutation was read back with `decrypt=false` and checked for the intended ID, target, type and branch. The connected environment API was unavailable, so the already authenticated CLI was used after confirming the project/team. [Metadata-only before/after evidence](2026-10-14-preview-environment.json) contains no credentials. This changes future build configuration; existing production and historical preview snapshots remain unchanged.

The user saved the staging OpenAI key privately in the prepared Vercel form. Metadata verifies Secret type, Preview-only scope and the exact readiness branch; the value was never retrieved. OpenAI project provenance, budget and actual provider use still need verification. The first isolated preview, `dpl_5s8otL99maxH17n99NQBFnZVVifb` at `5a3e282`, built successfully. Authenticated Vercel HTTP checks returned health/login 200 and anonymous family access redirected to login, with CSP restricted to the staging database and the expected security headers. [Hosted smoke evidence](2026-10-14-hosted-preview-smoke.json). Full account/AI/export verification remains open.

The legacy service-role key remains Production-only until the protected operator-vault/release step removes it from web hosting. Production markers, old cache/preview exposure, key provenance/rotation, operator MFA, actual hosted sign-in and AI/export remain open. Do not claim all secret isolation or the production site is fixed from this preview evidence.

## Implemented controls and measured evidence

Build and runtime reject mislabelled hosted environments, a preview using the approved production Supabase URL, a production using another URL, missing posture, public service-role/secret keys, and privileged database keys in the web deployment. Messages contain setting names only. These checks prevent specific configuration mistakes; an operator must still verify that the approved project marker itself is correct and that OpenAI keys have separate project scope.

The browser runner supplies a fresh synthetic server-key canary and unusable administrative placeholders. It builds the production application, runs all seven real local Auth/database/browser workflows, and scans complete `.next` and browser artifacts plus captured build/test logs for the canary. Browser tracing is disabled. Binary/chunk-boundary scanner behavior has an automated regression test. The normal app works without a usable service-role or database-admin credential.

The first scan **failed**: Next 16.3.8's persistent Turbopack cache retained the synthetic server key in `.next/cache/turbopack/.../*.sst`. This was a build-cache finding, not evidence of public browser disclosure. The installed Next guide documents disabling persistent caches; both build and development caches are now disabled, and `prebuild`/`predev` remove the two obsolete compiler-cache directories. They leave database, user and unrelated project files intact. Existing hosted caches require an operator purge and exposure review before release.

The next attempt found the canary in a test-fixture assertion message that compared the old fixed fake key with the new random one. The fixture now asserts the synthetic shape without printing either value. The subsequent build, seven browser scenarios and all byte/log scans passed. The underlying assertion failure was preserved as a harness correction, not described as a product log leak.

A separate controlled provider test verifies: old credential works; provider revocation makes it fail safely without echoing response details; changing the environment alone does not replace the cached credential; a fresh application process adopts the new credential. This is a unit-level rotation/revocation rehearsal, **not** a live provider rotation. Invalid model configuration also no longer echoes a misplaced credential.

## Concrete hosted change and recovery procedure

1. Confirm the intended school production project, canonical origin, separate synthetic staging project and named operator/recovery owner. Record only identifiers and scopes. Confirm vendor/project retention, spend limits and access controls.
2. Review existing secret exposure, especially build caches, deployment access and any prior logs. Create replacement provider keys in the correct projects through their protected interfaces. Do not paste them into chat, source, terminal arguments or release evidence. Creating a replacement does not revoke the old key.
3. Put each application key in its environment's managed Secret variable. Keep privileged Supabase/database credentials only in a protected operator job or vault. Remove shared all-environment entries, obsolete flags and web-admin credentials; set the non-secret project marker and per-environment origins/posture. Purge old build caches.
4. Deploy an approved immutable **staging** candidate using only synthetic data. Verify login, scoped access, AI, reviewed export, safe failure and logs. Separately prove the production connection marker points to the approved project; a local synthetic test cannot establish this.
5. With release authorization, rebuild/redeploy production with the new credential, verify controlled synthetic requests, then revoke the old credential. Confirm the retired key fails without recording it. A rollback build must also receive the new key; do not revive the retired secret by promoting an old environment snapshot.
6. Record timestamps, provider key identifiers, deployment IDs, verification results and operator approval. Keep any recovery copy under the restricted vault policy, and remove retired access after the observation window. A failed rollout pauses invitations and AI as appropriate; it does not justify restoring a compromised key.

Use modern Supabase publishable/secret keys when the project supports them and verify every consumer before retiring legacy keys. Do not rotate the shared legacy JWT signing secret as a casual API-key replacement: it affects Auth and legacy clients. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) and [signing-key migration](https://supabase.com/docs/guides/auth/signing-keys). Vercel documents [sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables). No live rotation or production promotion occurred; the branch-specific staging settings described above were applied.

The later release-control preview `dpl_7oQ6x69KYmABzzopXfXNMEq7wDgH` at `7bdd0a7` is also READY and passed all required repository checks. The existing email-provider key is named `thecaselink-prod` and has full Resend access in a local environment file. It was used only for domain/API-key metadata. The user created and privately saved a separate staging SMTP key; actual invitation delivery passes, while final sending-domain scope read-back remains open. Review/removal of the broad local production email key belongs in the remaining inventory, with no unapproved rotation.

The user also completed official Supabase CLI operator sign-in for staging verification. The existing modern staging secret key was retrieved through that authenticated CLI only into the test process's memory; it was neither printed, saved by the test, nor installed in web hosting. Its project/key ID was checked before Auth operations. The CLI-managed operator login is a separate retained credential whose storage, access and eventual revocation belong in the operator inventory. It is not evidence of a completed restricted operator vault or job. No production build/promotion was requested.
