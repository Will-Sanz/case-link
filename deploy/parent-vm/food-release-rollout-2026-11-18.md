# Existing Azure host: exact food-source rollout

Prepared instructions only. No host operation, credential access, migration, model call or activation was performed by preparing this package. The final application merge SHA is not yet selected. Run these steps only after Root records the actual merged GitHub SHA and its green required checks, completed production-lineage migration rehearsal, the owner-account preservation checks below and independent rollout review. This is a code release under existing authority, not a new cohort, purpose, provider or family-launch approval.

## Existing target and preserved state

The target remains `caselink-dev-01` in `caselink-dev-rg`, Ubuntu24.04, Node24, one bounded worker, original Supabase `zpfypkizsapvsxeykmdq`, canonical `https://www.thecaselink.com`. Use the existing background Azure Run Command access. Do not create infrastructure, open ports, change DNS/Caddy, add credentials or move the school site.

Root's read-only21:47UTC metadata retained these per-unit release lineages:

| Units | Existing working directory under `/opt/caselink/releases/` |
| --- | --- |
| `caselink-parent@web.service` | `d6e9e9e19aed1d7421d6964cafca9409dd2d0b3c-www-20261117-ongoing-20261117` |
| `caselink-parent@worker.service` | `636373b4625b92780983ffa49cabfd7a7bbe4a23-worker-assistant-20261117-ongoing-20261117` |
| frontdoor, broker, review, independent retention units | `5900b9404b0ac8f20e8fe71c6d18327fc979f9ca-www-20261110-r3-ongoing-20261117` |
| sender | Preserve its existing directory and inactive state |

The old web build is `nyxPsJhgoIGCZaxbcfB2N`. All original profiles remain0600 in their original0700 role-owned directories, with explicit `approvedUntil:null`. Do not copy profiles into a source bundle, print their content, renew their dates or change flags. Database NULL approval remains closed; it is not host JSON's explicit ongoing convention.

At21:57:23UTC Root checked metadata only: review `controlledTest` and sender `emulator` are both absent. Review profile hash was `903a07fccf03b764fd68f273f5f4cffd7f25e2baa10e2331451233a95c23649c`; sender hash `6ebc90bc310d8c20af65244097c1d75138f76422f1a6daaa5733ebc8d3433bbb`. Thus those old schema fields are not an actual profile-compatibility blocker. Still preserve the production-only controlled-test SQL guard. Do not remove a newly discovered restriction to make startup pass: abort on drift. The sender stays on its old lineage and remains disabled/stopped.9.6GiB free was observed then, not guaranteed for staging. Both cleanup jobs had exit0 at21:46:44UTC with waiting schedules.

`activate-ongoing-host-2026-11-17.py` is historical, not an upgrade operator: it asserts former finite dates and rewrites profiles. Neither it, activation SQL, seed/roles files, `db reset`, blanket `db push` nor migration-history repair belongs in this rollout.

## Freeze, package and transfer source

1. Root records PR/merge SHA, tree, required CI/native/security URLs, affected visual/SQL/PDF/model evidence and remaining closed gates. Freshly verify GitHub's merge commit and fetch the real `origin/main`. A local tracking ref alone is not online GitHub proof. Later evidence-only commits may publish this source manifest without changing the chosen application SHA.
2. Run the packaging tests, then use the full40-character merged application SHA. The builder reads Git objects only; dirty/untracked files are irrelevant. It rejects a non-CaseLink origin or a commit outside local `origin/main`. It performs no network request.

```sh
python3 deploy/parent-vm/package-release.test.py
python3 deploy/parent-vm/package-release.py package \
  --repo /ABSOLUTE/CLEAN/REPOSITORY --commit EXACT_MERGED_40_HEX_SHA \
  --output /ABSOLUTE/NEW/RELEASE-SOURCE-DIRECTORY
```

The manifest pins commit/tree/main-tip, every selected blob/path/mode/size/SHA256, aggregate source hash, required EN/ES SNAP PDFs, PDF.js fallback, protected-page fonts and sanitized archive hash. Its full production-source selection includes `src`, the eight actual hosted/prebuild scripts, public assets, verified forms, sample resource seed, tokens and exact root build/lock configuration. Tests and their fixture-only helpers are omitted from the runtime artifact; full-source CI remains mandatory. No tsconfig or production source is rewritten. No local `.env`, credentials, household fixtures, `tmp`, outputs, `.git`, private profiles, database volumes or `node_modules` is transferred.

3. Publish the sanitized manifest as an evidence-only GitHub file or release asset. Record its exact publication commit/URL and raw SHA256 from local output. Record the packaging tool's own exact reviewed source SHA256. Never fetch a moving branch for code or evidence.
4. Preferred host transfer: download the public `https://codeload.github.com/Will-Sanz/case-link/tar.gz/EXACT_MERGED_40_HEX_SHA`, the separately pinned manifest and the reviewed tool into a new root-only staging directory. Verify the tool and manifest hashes before executing it. Use its `extract` mode with `--github-archive`: it verifies every selected source member, skips excluded public Git entries without extracting them and refuses traversal, links, duplicate selected entries, changed sizes/executable bits, hashes or missing source. It never calls tar's general extraction method. GitHub transport mode bits are normalized to Git's executable bit. Record the downloaded transport SHA separately; it is not the custom sanitized-tar hash.

```sh
python3 /ROOT-ONLY-STAGING/package-release.py extract \
  --manifest /ROOT-ONLY-STAGING/manifest.json --manifest-sha256 REVIEWED_MANIFEST_SHA256 \
  --archive /ROOT-ONLY-STAGING/github-commit.tar.gz --github-archive \
  --output /opt/caselink/releases/EXACT_MERGED_40_HEX_SHA-food-20261118
```

For a reviewed sanitized-tar transfer, omit `--github-archive`; its complete archive hash must then match too. Both modes require a new output directory and never overwrite an existing release. An interrupted/failed extraction is not ready to use; preserve its failure evidence and choose a new empty staging destination. The tool has no service, profile, database or network operation.

## Build while the old site remains healthy

Re-read disk, memory, Node/npm, original per-unit directories and profile metadata. Snapshot all eight profile SHA256/owner/mode values, actual unit/drop-in file hashes and public build marker. Keep exact prior drop-in bytes under a new root-only rollback directory; do not export environment blocks or profile contents to output. Verify actual ExecStart remains the approved profile-path launcher. Keep the existing Caddy configuration, role UIDs, systemd resource/privacy settings, worker-only Docker socket/image/daemon identity and all role permissions. Docker inputs have no change in this candidate lineage; do not build or replace the approved parser image by implication.

Use a bounded temporary build process as the existing `caselink-web` UID on the same host with Node24, one CPU and the previously tested2GiB ceiling. Only the new staging directory is temporarily writable by that UID; original releases remain root-owned and read-only. Give it only its existing web profile; all other role profiles stay unreadable. Do not grant sudo, another service's configuration or Docker access. Start from an empty inherited environment, preserve the existing private-home/proc/temporary-directory restrictions and verify staging ownership and cross-role denials before running. No new build identity or profile copy is required. A current build exceeding the ceiling is an unresolved build/resource failure, not permission to raise limits or resize the VM.

Install fresh Linux dependencies with `npm ci` from the pinned lockfile; do not reuse old release or macOS dependencies. Clear inherited environment with the existing launcher allowlist. No `.env*` files may be present. Run the actual hosted builder as the web profile's owner:

```sh
/usr/bin/node --import tsx scripts/parent-hosted-services.ts /etc/caselink/web/profile.json build
```

The launcher constructs only the approved public web environment and binds the resulting `.next/BUILD_ID` to its own public-configuration fingerprint in `tmp/parent-hosted-build.json`. It receives no worker/model/broker/sender/database/S3 secret. Do not substitute a localhost synthetic build or copy the old `.next` tree/marker. After success, record exact source-manifest hash, lockfile hash, Node/npm versions, new build ID, marker hash/fingerprint and a generated-build file inventory excluding writable caches. Reverify all production source bytes, remove staging write access, and make application/dependency/build files root-owned and read-only to services. Provision only the existing web-owned cache/state paths as writable; marker readability must pass as `caselink-web`. All profiles must still match their preflight hashes.

Before cutover, perform no-side-effect launcher/profile shape/readability checks as each actual role, including original cross-role denials. Do not start a second worker or bind a competing private service merely for configuration validation. The absent optional description project ID must stay absent; its purpose/approval/evaluation gates remain closed. Do not copy evaluation credentials, approved evaluation allowance or results into live runtime settings.

## Owner-approved account preservation

The owner’s later instruction supersedes the new-full-backup prerequisite for this rollout: there are no other users to launch to, and the existing owner account must remain intact. Existing October encrypted recovery points are historical; no fresh backup/restore or managed-backup coverage is claimed. Do not buy an upgrade, reset data, recreate Auth, change a password, remove accounts or expand the cohort.

Before the bounded writer window, confirm exactly one designated existing owner identity, confirmed email, active legacy/parent access, owned household and existing-owner eligibility. Retain only private server-side opaque fingerprints of the stable identity/credential fields, app/parent access and original cohort/cutoff/operating authorities. Return no raw password/hash, token, private profile or household content. Existing checks found one matching identity, both accesses active, one household/cohort member and the unchanged global model cap28; refresh these observations immediately before cutover.

After additive schema and runtime rollout, repeat the same read-only checks and compare the stable fingerprints exactly. Preserve all other existing records and controls, the original identity cutoff, passwords, grants, retention, source/provider limits and sender-off. Stop promotion and investigate any unexplained difference; do not overwrite a legitimate concurrent owner edit or recreate an account to make a checksum pass. Keep the compatible old application/configuration source and independent cleanup for recovery. This permission changes the full-backup prerequisite only; exact green CI/native checks, migration/source guards, account preservation and live verification remain required.

## Schema gate and bounded runtime cutover

Root and the database owner own the exact final ordered source-hash→installed-version map and transaction/account-preservation procedure in `docs/verification/parent-food-production-upgrade-2026-11-18.md`. Its current36-body inventory must match the final application manifest and fresh target metadata; it is not an activation command. Require fresh drift/owner/ACL/search-path checks, production-only history preservation, a production-lineage upgrade rehearsal and the owner-account preservation checks above. A source-only reset is insufficient.

Before any writer maintenance window, pin the successful build and migration receipts. Preserve ongoing login/global/SNAP authority, original cohort/identity cutoff, old model accounting, parent mandates, protected retention, school records/policies and disabled sending. Profile/WIC/description/utility/new processing switches remain closed. No old activation, provider verification or family deadline is renewed. The old/new claim and pre-Submit review compatibility repair must be installed before the matching new worker starts. Do not expose partially applied functions. Old cleanup stays independent unless the database owner proves a narrowly bounded interruption is unavoidable; any such pause needs immediate restoration and explicit elapsed/missed-run evidence.

Use the existing per-unit working-directory overrides, not the shared current symlink. A new lexically-last, dated override is permitted only after checking the existing drop-in ordering and saving its exact baseline. Change `WorkingDirectory` only; preserve ExecStart, UID/group, resource limits, rootless cleanup hooks and all hardening. One reviewed release directory may serve web/frontdoor/broker/review/worker and both cleanup units. Do not change the sender override.

The affected unit names are:

```text
caselink-parent@web.service
caselink-parent@frontdoor.service
caselink-parent@broker.service
caselink-parent@review.service
caselink-parent@worker.service
caselink-parent-retention.service
caselink-parent-ordinary-retention.service
```

Within Root's recorded writer/worker maintenance window, stop/drain the original worker using its existing SIGTERM/cgroup/parser cleanup safeguards. Complete the database-owner sequence and verify its invariants, then reload the reviewed unit overrides and start broker/review before worker. Restart web/frontdoor against the matching built source in the smallest bound that preserves routing. Confirm readiness before ending maintenance. Do not blindly reset all systemd failures; address only actual affected failed units. Both existing independent cleanup timers remain enabled and resume their actual schedules against the corresponding reviewed cleanup code after its schema is installed. Record each effective working directory; a successful daemon-reload alone does not prove cutover.

## Live verification and recovery

Before allowing a new write, verify profile hashes/modes/owners, sender inactivity, original restricted role identities, web fingerprint/build ID, exact source/build hashes and effective unit paths. Check HTTPS/apex/recovery origins, HSTS/no-store/private and anonymous-denial behavior, representative English/Spanish public mobile/desktop states and safe service errors. Check the actual owned Auth→API→SQL/Storage/private-service path using only the already-approved existing identity and known fictional smoke data; no new signup, SMS/phone experiment, filing or model call is implied. Preserve explicit document consent and exact retry/body/key/version semantics. Mark fictional reports as software evidence; never report real food received or provider acceptance from a listing or smoke event.

Observe at least two independent cleanup cycles and an interval covering the existing five-minute directory backoff, without inventing an outage or enabling provider fixtures in production. Verify actual cleanup exit0/time and timer state; record due-job/lease/health progression without logging household content. New description health must remain unavailable while its live gates/project are closed, independent of the existing assistant health. Keep old model caps/reservations unchanged; any naturally authorized worker charge requires actual accounting, not a reset. Inspect bounded resource/error summaries and the final deployed UI. This proves only the observed release scope, not indefinite stability or capacity for thousands.

If cutover fails before new writes, stop the affected worker/writers, remove only the newly installed dated overrides, restore the saved exact previous drop-ins, daemon-reload and restart the prior compatible units. Reverify effective old directories, original profile hashes, old build ID/health and sender-off. Keep database migrations/data, immutable receipts, backups and independently required cleanup. Do not restore private profiles to historical finite dates or blindly reverse schema.

After a new-format write, historical code is not automatically safe: for example, old worker/review code may not understand an immutable Spanish source. Use only a separately rehearsed schema/data-compatible component rollback. Otherwise pause affected writes/execution, retain the new compatible private viewer/cleanup and apply a forward reviewed repair. Never overwrite new packets/receipts, recreate unknown operations or restore stale permissions to make the old application run.

Root records merge/CI URLs, source/build and per-service revisions, final migration map, profile/config hash preservation, backup/rollback references, maintenance timestamps, real-path smoke/visual/operating evidence and remaining provider/purpose/observation gates in the tracked status. A green web deployment does not close the broader food, booking, real-outcome or family-release requirements.
