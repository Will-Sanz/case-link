> Superseded October 14, 2026: the user removed all CaseLink 2FA from pilot scope. Do not implement passkeys or a replacement second factor. The research below is historical; CL-11 tracks password-only accounts. Hosting-provider operator MFA remains unchanged.

# Device verification assessment — October 14, 2026

The user prefers Face ID or fingerprint verification and does not want staff to be forced to install a dedicated authenticator app. This is tracked as CL-43. No passkey setting, application authorization rule, or production account was changed during this assessment.

## Verified current behavior

The existing flow uses six-digit authenticator codes. Apple Passwords can handle this kind of code, so the QR opening Passwords is expected. This is separate from a passkey sign-in. Current CaseLink rules require MFA for administrators and for case managers who enroll a factor; ordinary case managers without an enrolled factor can use password sign-in. The approved temporary administrator test redirected Families to verification. The account was restored to `case_manager`, and the Families page loaded again. Hosted enrollment/challenge remains incomplete because the user stopped to reconsider the experience.

Supabase documents passkey sign-in using biometrics, a device PIN, or a security key, but labels it experimental. Its sign-in API requires supabase-js 2.105.0 or later; this repo currently pins 2.99.3. The staging dashboard exposes Passkeys BETA, currently off. Registration requires a confirmed existing account and a stable relying-party domain. [Provider guide](https://supabase.com/docs/guides/auth/passkeys).

Supabase separately describes WebAuthn as an experimental second factor. The installed client includes `auth.mfa.webauthn`, but the inspected hosted MFA page exposes only TOTP and paid SMS controls. Client methods alone do not prove that the hosted second-factor feature is available. [Provider MFA reference](https://supabase.com/docs/reference/swift/auth-mfa-api), [configuration reference](https://supabase.com/docs/guides/local-development/cli/config).

A background capability probe using a disposable confirmed Auth account independently found `passkeys_enabled=false`. The current hosted service rejected WebAuthn enrollment with HTTP 422 / `mfa_webauthn_enroll_not_enabled`. The account's sessions were revoked and the account removed. No application role, provider setting, email or biometric prompt was involved. This establishes that the current configuration does not support the proposed flow; it does not establish whether the provider can enable it or under which terms. [Exact probe evidence](2026-10-14-device-feature-probe.json).

## Smallest safe implementation to establish

First establish whether the hosted service supports a device-backed second factor with the existing password login, current verified-factor checks, and AAL2 session. That would preserve more of the existing authorization and recovery model. Do not present a WebAuthn control based only on SDK types.

If using passwordless passkey sign-in instead, explicitly revise and test the current password-session boundary. `has_password_session` currently denies invitation/recovery-only sessions; simply removing that predicate would reopen case access before secure account setup. Independently verify the provider's signed authentication claims, device-verification requirement, credential removal behavior, offboarding, and retained-token denial. A successful operating-system prompt alone does not prove those properties.

Use the device's normal secure prompt, with a supported fallback for devices without biometrics. CaseLink must never collect face or fingerprint data. Keep staging and production relying-party domains separate and stable. Avoid registering school credentials against disposable preview hostnames or a shared `vercel.app` domain.

## Acceptance evidence still required

- Confirm provider availability, plan, experimental limitations and the chosen password-plus-device or passwordless flow before enabling it.
- Exercise registration, returning sign-in, cancel, unsupported device/browser, lost device, removal and recovery. Preserve invitation-only access and prevent email recovery from bypassing stronger verification.
- Prove server and database authorization using real hosted sessions, including administrator and standard staff access, revocation, and stale tokens.
- Add small regression tests for the new branches, plus headless browser coverage and a separately authorized real Face ID/Touch ID/Windows Hello check. A virtual authenticator cannot certify the actual school device experience.
- Record the supported fallback and school/device acceptance. No paid provider migration, weakened access check, or production enablement is implied.

This assessment establishes feasibility and remaining work, not a tested passkey implementation. The user now requires background-only work: no visible tab, preview, file, app focus, or biometric prompt without an explicit request or screen handoff permission.
