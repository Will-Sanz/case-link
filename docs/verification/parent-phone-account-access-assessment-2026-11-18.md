# Parent account access without private email

Assessed November 18, 2026. Read-only account/provider investigation; no account, configuration, enrollment, message, purchase or provider contact was created. This is evidence and an implementation boundary, not an approved authentication change or a family-release claim.

## Confirmed family needs

- The intended first group needs English and Spanish.
- Some families cannot use private email. The owner confirmed that each of these families has a private mobile number that receives text messages.
- Whether these families can use an authenticator application is **unknown**. It has not been established that they have smartphones, an independent backup factor or a safe place for recovery material.
- Do not choose mandatory MFA for this group, infer authenticator ability from SMS access, or ask the same unanswered question again. Continue independent interface-language and service work. Account/recovery fit remains an explicit release dependency for the affected families.

## Existing implementation and actual provider evidence

The existing Supabase identity provider is the approved shared CaseLink project. A bounded read of its public `/auth/v1/settings` returned public signup disabled, email authentication enabled, phone authentication disabled, phone autoconfirm disabled and the provider label `twilio`. That label does **not** establish an SMS account connection, credential, sender, entitlement, delivery or approved charge. No SMS credential variable names were found in the inspected local environment file or agent environment; this does not inventory secrets held elsewhere.

The public health endpoint reported GoTrue `v2.198.0`. Connected metadata confirmed an active project and the organization's Free tier. Schema-only reads confirmed `auth.sessions.aal` and `factor_id`, and the identifiers/type/status metadata needed for native TOTP factors. No identity, household, factor secret or message rows were read. These metadata checks establish available structure, not successful enrollment or current enabled MFA configuration. The checked-in local configuration disables SMS signup and TOTP enrollment/verification.

Installed `@supabase/supabase-js` and `@supabase/auth-js` are version `2.99.3`. They already support phone OTP, phone/password sign-in, phone-change verification and native TOTP enrollment/challenge/verification. No new authentication library is required to investigate these paths. Current application entry is nevertheless email-only:

- `src/app/api/parent/auth/route.ts` accepts email/password or email-code actions; `src/features/parent/sign-in.tsx` presents those methods.
- `src/lib/parent/parent-session.ts` requires a confirmed email. Its required email type flows into the account API and intake/account presentation.
- `src/lib/parent/account-deletion.ts`, `browser-authority.ts` and the withdrawal path in `snap-direct-acquisition-data.ts` independently check email confirmation.
- The database's `parent_private.verified_identity()` and `public.parent_get_deletion_status()` require confirmed email. The existing account cutoff and pilot allowlist independently deny identities outside the approved cohort.
- Trusted referral access in `activity.ts` has a separate email/member contract. School password/session checks, trusted referral access and email-notification checks must not be mechanically broadened to phone identities.

The shared-identity rules in [parent-shared-accounts.md](../parent-shared-accounts.md) remain in force: separate parent cookies and owned household, no school-data copying or inherited staff access, live account/session checks, and preservation of the shared Auth identity during parent-purpose deletion. The retained [October 14 record](2026-10-14-password-only-accounts.json) documents the owner's earlier removal of CaseLink account MFA. A future phone-parent-only second-factor decision must be explicit and must preserve existing email/school behavior.

## Safe candidate and recovery limits

[Supabase phone login](https://supabase.com/docs/guides/auth/phone-login) can use the same Auth UUID and existing household ownership. A future implementation can add a default-off English/Spanish phone entry to the existing Auth API/UI, keep phone credentials out of request/model facts, and keep ordinary service updates in My support. Generic sign-in codes are a distinct channel purpose from food-status messages.

SMS possession alone does not distinguish an original parent from a later holder of a recycled number. A candidate independent control is Supabase TOTP with AAL2, **conditional on actual family usability and an explicit decision**. The [project TOTP guide](https://supabase.com/docs/guides/auth/auth-mfa/totp) states that its API is free. In the [matching deployed-version MFA source](https://github.com/supabase/auth/blob/v2.198.0/internal/api/mfa.go), a session below AAL2 cannot add a factor while a verified factor exists or remove a verified factor. The [matching user-update source](https://github.com/supabase/auth/blob/v2.198.0/internal/api/user.go) also blocks lower-assurance changes to password, email or phone when MFA exists. These are source-supported expectations requiring native tests before use.

If this candidate is selected, parent authorization must bind the trusted factor to the existing parent account and check signed assurance plus the live session's assurance/factor and its same-owner verified TOTP. Merely accepting any AAL2 session is insufficient. Removing the final trusted factor must close phone access; a later number holder must not regain old household access by enrolling a fresh factor. Factor replacement must prove the current trusted factor, verify its replacement, and update the binding before removing the old factor. Existing confirmed-email/school paths remain intact.

TOTP alone does not recover a permanently lost SMS number: it is a second factor, not the initial sign-in. One existing-provider candidate is a Supabase-managed recovery password plus a TOTP setup/backup kept outside the phone. After loss, old-number/password sign-in and the recovered TOTP could establish AAL2, then a verified change to a new phone could preserve the same UUID and household. This requires usable recovery material and exact native testing; it is not a settled requirement for families. If all credentials and trusted sessions are lost, the current product has no verified safe recovery procedure. Do not replace one with household-fact guesses, a shared staff login, automatic household merging or an invented PIN/OTP service.

Current provider schema/docs also mention [experimental native recovery codes](https://supabase.com/docs/reference/javascript/auth-mfa-recovery-codes-generate). The installed SDK has no recovery-code API, and enabled configuration/usable entitlement has not been proved. Their presence in schema or current documentation is not a working recovery path. Operator/dashboard recovery documentation is also not evidence of app-user recovery.

## Decisions and evidence still required

1. **Usable recovery:** resolve the unknown authenticator/backup capability through actual family-access work and select the supported recovery method. Do not silently add MFA, presume smartphone ownership or advertise loss/recycling protection from SMS alone.
2. **SMS connection and budget:** verify the actual supported sender/provider, permitted destinations, account entitlement, rate/abuse limits, message language, delivery failures and spending cap. The existing Sinch authorization concerns a fax emulator, not SMS authentication. [Twilio Verify's public pricing](https://www.twilio.com/en-us/verify/pricing) currently lists $0.05 per successful verification plus $0.0083 per US SMS; this is an example for a different provider mode, not the current account's quote or spending authorization.
3. **Cohort and identity admission:** preserve global signup closure, the original identity cutoff and the current allowlist. A phone UI must not open enrollment. Future admission needs a reviewed exact cohort and provider enrollment contract; application-only restrictions do not justify opening the shared provider's public signup endpoint.
4. **Purpose and processing:** approve the phone-auth processor/data flow, retention/security and understandable English/Spanish notices. Phone authentication does not grant provider disclosure, change official agency contact details, or expand an existing service mandate.
5. **Operational proof:** exercise actual authorized synthetic phone delivery, wrong/expired/reused codes, resend/rate limits, changed/lost/recycled-number cases, factor enrollment/replacement/removal, recovery, retained-token denial, cross-household isolation, purpose-closed deletion/withdrawal and reachable school regressions. Unit mocks or schema metadata cannot replace this proof.

The next independently useful work is the complete English/Spanish interface, with interface locale separate from preferred program contact language. Keep all current authentication/cohort guards until a selected protected phone path is operational, reviewed and tested.
