# Secret isolation and recovery — October 14, 2026

CL-42 remains open. The application safeguards below pass locally; current hosted scope and live rotation do not.

## Observed hosted configuration

Read-only inspection confirmed Vercel project `case-link` (`prj_1zxzzKu8eljHJvPd6gFY3LhyxwWc`) in team `team_wwXXIa3JR9qMrIBopTUBsG5J`. The connected environment-list API returned 403. The already authenticated CLI then returned names, types and target environments only; no values were decrypted, pulled, printed or changed.

| Name | Observed targets | Intended consumer and storage |
| --- | --- | --- |
| `OPENAI_API_KEY` | Production, Preview, Development in one entry | Server only; separate approved OpenAI project/key per environment; managed Secret variable |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview, Development in one entry | Remove from web hosting; restricted operator vault/job only for invitations, offboarding and MFA recovery |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Development in each entry | Public connection information; separate projects and corresponding publishable/anon keys; database policies enforce access |
| `NEXT_PUBLIC_SITE_URL` | Production, Preview, Development in one entry | Exact environment-specific HTTPS origin; match Auth redirects and school-approved domain |
| `CASELINK_TENANCY_MODE`, `CASELINK_INVITE_ONLY`, `CASELINK_HSTS` | Production only | Required posture in each hosted environment |
| `CASELINK_PDF_MODE` | Production only | Obsolete flag; remove during reviewed settings cleanup |
| `CASELINK_ENVIRONMENT`, `CASELINK_PRODUCTION_SUPABASE_URL` | Not listed | Explicit target and non-secret approved production-project marker required by the new guard |
| Direct database credentials, vendor recovery/MFA material | Not listed in this metadata response | Restricted operator vault; never application or ordinary CI variables |

The CLI labels stored entries “Encrypted”; that is not evidence of the current write-only Secret setting. Verify managed Secret type, Production-only scope, operator access/MFA and recovery ownership in the provider. The user has restored the configured production-intended Supabase project `zpfypkizsapvsxeykmdq`; [its legacy schema and separate staging preparation](hosted-database-preflight.md) still block release. Owners, staging creation, provider retention and actual key provenance remain pending. The shared entry targets are sufficient to block release; no comparison of secret values was needed or performed.

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

Use modern Supabase publishable/secret keys when the project supports them and verify every consumer before retiring legacy keys. Do not rotate the shared legacy JWT signing secret as a casual API-key replacement: it affects Auth and legacy clients. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) and [signing-key migration](https://supabase.com/docs/guides/auth/signing-keys). Vercel documents [sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables). No live rotation, hosted settings change or production promotion occurred in this work.
