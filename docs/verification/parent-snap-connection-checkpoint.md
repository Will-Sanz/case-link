# SNAP milestone B: connection verification

Checked October 26, 2026 (America/New_York). This checkpoint covers one bounded piece: actual family authentication and household isolation through the existing private browser service to the public COMPASS verification boundary. It is not application filling or filing. The original account provider, pilot expiry/cutoff, parent web profile and school records were not changed.

## Acceptance and implementation

The acceptance criteria were: real local sign-ins; a correct owned request; foreign-household and retained-session denial; the actual private HTTP boundary; a real, uncached browser frame; an honestly classified provider stop; and complete local fixture/control cleanup. The owner required a separate review before dependent work.

`browser-server.ts` extracts the existing native HTTP handler so the real handler can be exercised against isolated local services on an ephemeral port. Its Host check matches the actual bound loopback port. The production launcher still binds only `127.0.0.1:3330`, retains its exact connected-project/expiry guards and has no test-mode bypass. No provider transport, applicant input/control endpoint, schema change, new dependency or protected-data collector was added.

`test-parent-browser-connection.ts` verifies the isolated API at port 55321 and database at 55322 before using local fixture administration. It creates two marked synthetic identities, uses real password sessions and Data API RLS, starts preparation-only requests and checks the production authorizer/runner/HTTP handler together. An advisory lock prevents two copies of this test from modifying controls concurrently. The test temporarily enables only the isolated synthetic processing window, restores the original settings and timestamp precision, signs out and removes only its exact verified fixtures. It never changes the hosted identity cutoff to admit a test account.

## Results

- Main-agent default run: **51 assertions passed** before the final retained-JWT case was added.
- Independent final default rerun: **52 actual Auth/RLS/HTTP assertions passed**, without launching a browser. Missing/invalid/foreign tokens, incorrect Host, browser Origin, unsupported methods, request bodies/chunked input, frames before start, paused/cancelled requests, closed processing and retained tokens after sign-out were denied.
- Explicit live run: **105 assertions passed**, including polling observations. This is not 105 separate application scenarios. One actual COMPASS context produced a real private JPEG, reached the exact provider-verification block, closed and erased its view. No applicant values, signature, CAPTCHA solution or filing was sent. This uses real local parent authentication and the real government public page; it is not a fixture page or intercepted provider response.
- The live pause/cancel checks followed the terminal provider stop. They prove real authority denial, not mid-navigation cancellation. Active screenshot/revocation races remain separately covered by runner unit tests.
- TypeScript, scoped lint and the **20 existing focused browser tests** passed. The independent reviewer separately reran **14 policy/authority/runner tests** and reviewed the live log.
- Normal correctness/security/privacy/regression review and a separate Ponytail deletion pass found no remaining blocker for this restricted connection-test piece.

Private test evidence stays under ignored `tmp/parent-verification/`. Only sanitized counts/outcomes are printed; keys, tokens, passwords and applicant records are excluded. The running existing-account app on port 3200 and private viewer on port 3330 were not stopped or reused by these tests.

## Provider contract and remaining gate

[Official-source research](parent-snap-provider-contract-research.md) verifies guest entry, genuine organizational registration/certification requirements and a potential account-free status tracker. It explicitly leaves automation agreements, current later fields, secure handoff/resumption, filing/receipt and live status behavior unresolved. Public partner guides do not establish permission for an unattended software submitter.

The status tracker returned HTTP 200 and its public title in headless inspection, but the visible document contained only a skip link, no labels and no embedded form; two CSS resources failed. No identity was entered and no lookup was sent. The cause and actual form behavior remain unverified; this does not prove a permanent tracker outage or a working integration.

**Review decision:** this connection-test piece may ship locally. Work package B remains open. The next dependent piece must prove an allowed parent-verification handoff and recognition of the next screen before collecting applicant information or implementing submission. Original-account web-to-viewer authentication remains separately unverified; the new integration evidence uses the isolated actual Auth service.
