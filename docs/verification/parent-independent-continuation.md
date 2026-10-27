# Partner-independent continuation

October 27, 2026. Work continues on `main` without new partner access, family intake, hosted changes, outside contact or renewal of the expired existing-account preview. This record supplements the [shared-data checkpoint](parent-shared-data-authority.md); it does not complete L1, R1 or a provider connection. The [owner-needs list](../parent-owner-needs.md) remains the source of outstanding external inputs.

## Piece 1 — genuine renewal of exact-packet personal-step evidence

The existing recorder returned success after an expired verification was replayed, requeued work, and retained the expired row. An isolated regression reproduced that dead end. Forward migration `20261027170820_parent_personal_act_renewal.sql` keeps separate private evidence records keyed by exact operation, act, packet and verification reference. The existing readers and final execution guard continue to require current evidence for that exact immutable operation.

Only the currently scoped trusted verifier can record a new, strictly later observation with a new reference. The operation must remain prepared under its current mandate, provider permission, exact source eligibility and valid form artifact. Observation time must be current; validity is anchored to the observation, capped by the verifier's deadline. A read, duplicate retry or changed timestamp on an old reference cannot extend expiry. Exact retries return before job/event writes. Old provenance remains private and follows the existing operation/request deletion cascade. New request versions, changed packets/artifacts and cancelled work do not inherit verification.

Verification: the 22-case baseline had **11 meaningful failures**; the completed expanded suite passed **28 cases**. Independent normal security/privacy/correctness/regression review and a separate Ponytail pass cleared the piece; **127 focused tests** and the final 28-case suite passed independently. The embedded security script passed **170 assertions plus budget checks**; it does not emulate real Auth/Storage or concurrency. After a dry run verified exactly this migration, it was applied only to isolated native PostgreSQL on `127.0.0.1:55322`. Its security suite passed **165 assertions plus budget and concurrent cancellation/dispatch checks**, restoring processing controls and role memberships exactly. TypeScript, scoped lint and whitespace checks passed.

Autonomy: a genuine necessary personal act can now resume unchanged prepared work rather than strand the family. No routine final review, parent checkbox, new signing channel or operator task was introduced. This is preserved PECO/R2 recovery work, required for R1 only if its actual selected route requires such evidence. Accepted signing, protected inputs and provider delivery/status remain external gates.

## Piece 2 — source-safe saved answers and immediate-food lookup

Necessary-answer defaults now use the existing current-source projection for ZIP, household size and the paired income amount/frequency. Initial render and explicit conflict recovery each take one consistent snapshot; zero remains valid. Another need's mirror, expired source or excluded permission cannot prefill these fields. Typed drafts and their original optimistic version survive background refresh. Other existing field behavior is unchanged.

The request's food directory uses only the current permitted `food_now` ZIP. When none is usable, its existing manual search remains available; a directory query neither persists a new household fact nor claims food is allocated. Four old planner calls in the visual/UX runners were updated to the provenance-bearing request signature; the UX runner now supports a loopback-only test origin so it can run against an isolated copy without replacing the owner's preview.

The test writer reproduced **12 failures across 34 UI cases** before the fix. Root's affected UI run passed **40 cases** and independent normal/Ponytail/React/Impeccable review passed **106 UI/projection cases**. A final hidden responsive/browser pass follows the remaining UI piece. No new category, field, policy purpose, model call or provider action was introduced.

Autonomy: lawful current answers stay reusable without presenting another program's or expired information as current. Only an actually missing required answer needs input; urgent public food search remains accessible. This closes UI consumers of the four-field source boundary, not a food reservation or new private profile.

## Next independent pieces

- Keep My support progress current while the page is visible, with manual refresh and truthful failure recovery.
- Investigate grouped-answer saving and preserve unrelated exact-need answers before adding any atomic bundle path. Keep optimistic concurrency and existing strict fields; do not collect speculative route data.
