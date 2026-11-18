# Food release: database upgrade preparation — 2026-11-18

Read-only audit of source `743dee37d33c4342d99917ec0d30fd21c725cb4b`, followed by a separately isolated compatibility implementation on `758899b`. Production target: `zpfypkizsapvsxeykmdq`. No production data/settings/secret reads, DDL, role changes, service changes, provider/model calls or deployment were performed. The function bodies, owner/ACL/search-path metadata and migration declaration/hash queries are schema evidence only. This is not launch or processing permission.

## Required compatibility repair

Production migration `20261110161631_parent_snap_review_continuation` installed a two-argument claim that admits a current, verified, prepared protected SNAP packet before Submit: `not snap_submission_authorized(o.id) or personal_acts_complete(o)`. This permits the service to prepare the mandatory exact parent review; it does not permit dispatch.

Pending `20261114013506_parent_utility_deterministic_preparation.sql` replaces that two-argument function with a delegate and installs a four-argument implementation requiring both completed personal acts and Submit. All later food/mixed/post-lock migrations inherit that stricter clause. Verbatim pending-file deployment would remove the installed pre-Submit review continuation. Reapplying the old two-argument body would discard the new public/mixed delegate, so it is not a safe repair.

The narrow forward repair must replace that one clause in **both** the final four-argument candidate scan and its copied post-lock eligibility check (exact expected count: two). Preserve current-grant, bounded lease/48 attempts, exact program/packet/hash/source, sender-availability, public-food/mixed scope and parked-recovery checks. The existing runtime selector needs the same one-line prepared-packet predicate so the claimed turn can create the required review without a model key. Personal acts and Submit remain mandatory at dispatch. This repair is frozen in the six-path review manifest SHA256 `179bdfcd9b5f32c5b881d87d69c2e76cf9801b5549cff19e3e100f7d427edfbb`. Root independently passed338 cases across three affected SQL/runtime suites. It has not been applied to production.

## Other production-only history

Exact version comparison finds five production versions absent from the checkout, not just the one same-name mapping:

- `20261110141330 parent_controlled_snap_test`: separate controlled-test table/column/triggers/functions and an extra fictional-test guard in `snap_direct_acquisition_authority`. Preserve these installed guards and closed sending. The Spanish-source migration edits the existing definition in place; do not replace it with the historical source definition. Do not replay controlled-test configuration or infer a new purpose/provider permission.
- `20261110161631 parent_snap_review_continuation`: predicate repair above.
- `20261117183830 parent_assistant_account_context`: installed definition omits `intake_reuse`. Apply source `20261117184500_parent_assistant_account_context.sql` as a real forward body after routing dependencies; matching names are not evidence that the corrected body is installed. Keep original production history.
- `20261117190812 bounded_existing_assistant_worker_restore_20261117`: no function declarations; changes the existing worker login expiry. Do not replay its finite operating window.
- `20261118004147 parent_existing_services_ongoing_operation_20261117`: no function declarations; existing restricted login/SNAP approval deadlines. Preserve the already-approved ongoing values, passwords, role attributes and memberships.

The current production `processing_enabled()` already accepts PostgreSQL infinity; `parent_authorization_window()` still supplies a bounded 30-day family mandate. The 29 pending files do not replace either function or update the existing global/SNAP operating approvals. Do not reapply old activation scripts: `enable-ongoing-existing-services.sql` deliberately expects the former finite deadlines and is not a repeatable upgrade step. Host JSON `approvedUntil:null` means explicit ongoing operation; database NULL approval remains closed, not ongoing.

## Minimum dependency sequence

`production-schema-compatibility-inventory-20261118.json` pins the 30 existing source bodies in timestamp order (29 name-missing files plus the corrected assistant body). Keep historical files unchanged.

1. `20261113182609` routing/reuse, including renamed original intake/cleanup/assistant helpers.
2. `20261113192838` through `20261114014202`: WIC plus closed utility schema/private-document/protected/preparation dependencies. These utility objects are needed by shared claims, profile reuse, operation projections and strict PT409 signature guards. Omitting them requires a separate tested dependency reduction; it is not safe simply to skip them. Installation must not enable their purposes, protected policies, providers, new login or runtime service.
3. `20261117175206` profile, `175622` application reuse, corrected `184500` assistant, `185443` text guards. All new collection switches remain off without their separate approval.
4. `20261118035851` WIC reaffirmation, `043549` observation ordering, `043758` deliberate PT409 conflicts. PT409 has exact function/count guards and depends on all earlier utility/profile definitions; keep genuine PostgreSQL serialization failures and legacy school behavior.
5. `050422` public-food contract, `080328` mixed SNAP continuation, `080954` profile propagation.
6. `095752` description purpose/accounting, `113250` clarification/start, `121535` document recovery, `121715` official SNAP source choice, `121854` locked-row claim recheck, `164420` cache accounting. Description/profile/WIC purpose switches, new model allowance and Spanish protected-method evidence are not activated by installing schema. Avoid calls into partially installed functions between these steps.
7. The newly generated compatibility forward migration after the final listed source file, with its matching reviewed worker runtime. It must preserve all intervening function changes, including both final claim guards.

## Release checks before any production DDL

- Pin the exact final reviewed source, migration body hashes, actual target, installed function/ACL fingerprints and matching web/worker/broker/review/cleanup revisions. Re-read schema metadata immediately before deployment; abort on drift.
- Rehearse an upgrade from the **production schema lineage**, including the five production-only records/guards, using synthetic records. A fresh source-only reset does not prove this upgrade. Cover old pre-Submit review, later genuine Submit/dispatch denial, delivery-unknown reconciliation, two-connection lease exclusion/recheck, public/mixed work, correction/cancel/revocation and old six-argument document registration/recovery.
- Compare every existing operating control and model ledger before/after without printing private values. Global/SNAP infinity, original cohort/identity cutoff, restricted login attributes/memberships, family mandates, existing private retention, school policy/function hashes and disabled sender must remain exact. New utility detail switches/policies/providers must stay off; profile/WIC/description remain off unless independently authorized. Existing item/source/provider deadlines are separate and must not be renewed by this upgrade.
- Keep existing controlled-test authority closed; verify its fictional-test guard still exists after the Spanish-source in-place edits. No seed/config/roles-file replay and no blanket `db push`, reset, squash or migration-history repair to hide mismatches. The installed CLI help confirms `--include-all` admits old missing versions and ordinary push can update Vault unless `--skip-vault`; neither is a reviewed plan by itself.
- Resolve the five remote-only records with exact retained schema/history evidence before a CLI rollout. Never mark an unapplied corrected body as applied. A tool assigning new version IDs needs an explicit source-hash→actual-version mapping; preserve historical rows. The deployment mechanism and reconciliation must be reviewed together.
- Use one deployment owner and a bounded writer/worker maintenance window. Preserve old public demo until the full compatible schema and matching runtime are ready. Start neither utilities nor sending. New cleanup code must follow its schema; retain both existing cleanup schedules and actual exit/health evidence.
- Keep a verified compatible application/configuration rollback point and backups. On migration failure retain committed evidence and stop dependent rollout; do not reverse data/schema blindly or retry an uncertain provider effect. Confirm real owned HTTPS/Auth/API/Storage, read/retry/receipt/worker/cleanup behavior after deployment without filing or new processing.

## Evidence and limits

- `production-migrations-readonly-20261118.json`: provided 100-version metadata inventory.
- `production-schema-functions-readonly-20261118.json`: 17 actual relevant definitions plus owners/ACL/search paths, no household content.
- `production-only-migration-structure-readonly-20261118.json`: stored source SQL hashes and lexical identifier metadata. The identifier extraction is not a SQL parser.
- `production-schema-compatibility-inventory-20261118.json`: source body SHA-256 and production function SHA-256 map.

No complete upgrade rehearsal, native concurrent run, live upgrade, new processing activation, provider receipt or family outcome is established by this audit. Normal review found the concrete claim/runtime compatibility gap above. Separate Ponytail pass retains the existing engine, queue, strict guards and native function replacement; it proposes no migration platform, new queue or permission reset.

## Portable source inventory

These31 bodies are reviewed upgrade inputs, not a command to apply them or an activation record. Reconcile actual target drift, complete the production-lineage/native rehearsal and backup/rollback checks above before rollout. Preserve each original source version and record its actual installed history version if the deployment tool assigns another one.

| Source migration | SHA-256 |
| --- | --- |
| `20261113182609_parent_reusable_routing_information.sql` | `1531392d2b946edd860800e2f775a99dee1243b2ce09985015cf3d8da18569ef` |
| `20261113192838_parent_wic_private_application_details.sql` | `74df78bd73fa48d69bf491cc41b7ab3c3716fecc2075e27d2fa641dfaf38a433` |
| `20261113200717_parent_peco_private_application_details.sql` | `64fab6022b2eaf86b1502fabdb0b5593b10839e4d338e67b733adafda537c86f` |
| `20261113201714_parent_wic_document_boundary.sql` | `566da84f7d5ce903d78fec5c793de46e80d11600e3b7c9600e15ee5949db1dcc` |
| `20261113204551_parent_peco_private_document_boundary.sql` | `f994470497c31d0ab613f3ac0b5dab8aa6ac58eba0f1d0172b8f4bd553b845e4` |
| `20261113220718_parent_utility_preparation_document_scope.sql` | `cfe8837a6530b3dc6e598ca825a1fc51cccb3b459fbf1033f784ff80b84df4b3` |
| `20261113220747_parent_utility_protected_inputs.sql` | `fce24baa251ef0455ae73ac81d44e019eb58d9bd807c3b2bb647c74ebfac24f8` |
| `20261113221224_parent_water_private_application_details.sql` | `6e0f02c0fe10dce258ec4cd584b4c123c58720ac74f52c1af96f01851d16ef69` |
| `20261113222134_parent_pgw_private_application_details.sql` | `25d7fa64be55476b891d03520446b06eba4a1231475cc77499f159d1124b61f6` |
| `20261113231523_parent_utility_prepared_artifacts.sql` | `bf85f48f5c349cde3d6ea15801d8d2fd30d41bf8f3e0dc56c3f6bf08d1742d46` |
| `20261113231943_parent_utility_private_document_boundary.sql` | `7f25ee8afeea9b844dc1bb159f816bd7cb4cc05a2fb9be8e8748e7c7c1c3edc8` |
| `20261113234059_parent_utility_protected_reuse.sql` | `a411ad6f425156d60f6988ad83c42678ec062f2c68fea00eb0b0ab0d97244722` |
| `20261114013506_parent_utility_deterministic_preparation.sql` | `51c4da125abbe0e1450aa0b1d92edacef3676c1eb655bd06e6c528b453d62a89` |
| `20261114014202_parent_pgw_identifier_replacement.sql` | `9fa84a4d5e7761de64eeb33e1260e90664a106fba3d77ccd356565c502390f12` |
| `20261117175206_parent_family_profile.sql` | `3642496bba06ea5aef36bc321ebec897cceb67cdda689b40c86c2ed95b9e8c7a` |
| `20261117175622_parent_family_profile_application_reuse.sql` | `70c94d14316e097aef873e0d641fa3fd782bf25044a1fbdf3d3cc74f05042a1c` |
| `20261117184500_parent_assistant_account_context.sql` | `68f71e42c96d9f0b133e1c9e7ae9a92fa0388aa701fab3bbe3ce3cce6d7e64bf` |
| `20261117185443_parent_ordinary_private_text_guard.sql` | `6647ed462240bb781c497f2464097929666b0d88abab12096c09bb1b8bb010e4` |
| `20261118035851_parent_wic_application_reaffirmation.sql` | `704fba3644aea0b219b0748bcb537d72b8b489f4f3e37166e24c918def503a23` |
| `20261118043549_parent_job_plan_agency_observation_order.sql` | `47e8932513212640ba945dd2944f73fb420a33561c2e1a8f93806a9f7896e21e` |
| `20261118043758_parent_business_conflict_http_status.sql` | `640d10a250043e8cb81088c428b9a9d1bf26c517623ca7576d3882b09c3f988e` |
| `20261118050422_parent_public_food_access.sql` | `bff804ca443c08f42ca83eb8f6a05545c58265ab00214806a504ace8e21c8882` |
| `20261118080328_parent_public_food_snap_continuation.sql` | `493ddbdcec095d1ef84ec22d601826e13c54f510d87167bb21a9dbffa81f34ca` |
| `20261118080954_parent_snap_food_profile_sync.sql` | `9f77e4004f1a982b610ebc919cfaae6a57104dd1b9e0514f6345b3531074182b` |
| `20261118095752_parent_food_description_drafts.sql` | `cec6c82530c392a9b875b6fd5b8eb18445f6519d41b6da15a0a2cc26e7566a17` |
| `20261118113250_parent_food_description_resolution_and_start.sql` | `6a8e4e49542071a55d31ae6a3823ec0afac69b88449552cce5630d57b94607b5` |
| `20261118121535_parent_document_upload_recovery.sql` | `ebf036092ce0160e1702b686f153734b4412dbd2578f54d102072bc321991ed1` |
| `20261118121715_parent_snap_document_sources.sql` | `389881b7c7a4e1072f0420d211083957b47b38f5dcb0f3843c472789b14abf37` |
| `20261118121854_parent_job_claim_recheck.sql` | `4667244aee8882c6f4f0b13d7ba9de991150d213e69602e176fd28785a286129` |
| `20261118164420_parent_food_description_cache_usage.sql` | `2cd28b2525d96f7e08b064b6e63704aa48a808f188615790bc68f03cd5ed58e8` |
| `20261118185641_parent_preserve_snap_review_continuation.sql` | `a25ac127259e0e5ae297d3da357b684c0ea3ee0e4f205cf696c82e9c8fc2fb6b` |

Read-only preflight definition fingerprints (November18;17 functions) provide drift checks. Actual owners, security-definer flags, ACLs and search paths were also inspected in the ignored metadata artifact. Re-fetch and compare all metadata at rollout; a matching body alone does not prove matching grants or ongoing control values.

| Installed function signature | Definition SHA-256 |
| --- | --- |
| `parent_authorization_window()` | `d783e5374c185eb5851ca3b952a053043c55f46dfa6a0f90668ceab32a277874` |
| `parent_capability_summary()` | `bc234addbc152961f736758ebaadffdde1daad86b68fc48c4ba74c453a26611a` |
| `parent_private.current_grant(uuid,integer)` | `980b7378df01201e5e20fc732b2b3d5a6a308e060d1c24414d01f4e01bb48b52` |
| `parent_private.parent_authorize_storage(uuid,uuid,text,text,text)` | `518e0dcc51e3e92bb9e602b09e06b5b4e2d1a5020b1439905826034f26222cf3` |
| `parent_private.parent_claim_assistant()` | `604830fdbdd8722364eb85c04588abac2ca4d6a2d0971aa6c6101272b70bdf70` |
| `parent_private.parent_claim_cleanup(integer)` | `c92bec2ed042cf9d3d8ed7a8dc41c3a5883e48c143b37dc2a5e941d3874fe290` |
| `parent_private.parent_claim_job(integer,boolean)` | `848ca32203567f00983f88a5c6081530f35418d1af47b2d8a10d35260790c35f` |
| `parent_private.parent_claim_job(integer)` | `7d596f8a49981fbbe34176a8847a280241c67c923d909f5735778f7412494d53` |
| `parent_private.parent_get_operations(uuid,uuid)` | `863ad3f463506574353ed49f095f3fabb4ebced1315798dbc327fe98e0bd731d` |
| `parent_private.parent_reserve_snap_delivery(jsonb)` | `25e8b99c127bafaf27a6e35217eb9f00e60db9be4d3d81d222c45e3e2d6c3b76` |
| `parent_private.processing_enabled()` | `dbeb3d0fe73d420aa7685a4ccc74b14e1d509cbc9ec73e0d52d8a89bbc47f410` |
| `parent_private.request_progress(uuid)` | `28e803e32c5d5be35d984298ddb9567316b5d69f173ef64ffe6535a35dba16ce` |
| `parent_private.reserve_model_capacity()` | `b8221b5b3cb35a6e63399786a180ccba32371e7ce937f317c76c77f9bf7e2226` |
| `parent_private.snap_delivery_check_route(parent_operations,parent_private.snap_delivery_intents)` | `736c594dd2fee11224330d670a60295f2314c0e1b8ad2875e91ccf7db3137238` |
| `parent_private.snap_details_collection_enabled()` | `6b3d1ed4ba05d4e1f6af007574852437993cbf534af4c08e8ff90d96e1258815` |
| `parent_private.snap_direct_acquisition_authority(uuid,uuid,integer,uuid,text)` | `0b719a0a7e5f5fc2a7fb6abd10129fd648462d18a36206a1aaaeb2c5f837a850` |
| `parent_snap_application_collection()` | `8990151c32a30b68bfecbdcb406dedda14d67ae03f5d3d0c1678f3fc57da08ff` |
