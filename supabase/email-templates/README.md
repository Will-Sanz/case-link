# CaseLink — Supabase Email Templates

Branded HTML templates for Supabase Auth emails. These match the CaseLink website design (teal accent, slate text, clean card layout).

## How to use

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **Email Templates**
2. Select each template (Confirm signup, Invite user, etc.)
3. Copy the corresponding HTML from the files below into the **Message body** field
4. Update the **Subject** line if desired

## Template mapping & suggested subjects

| Supabase Template           | File                                  | Suggested subject line              |
|-----------------------------|---------------------------------------|-------------------------------------|
| Confirm signup              | `confirmation.html`                   | Confirm your email — CaseLink       |
| Invite user                 | `invite.html`                         | You're invited to CaseLink          |
| Magic Link                  | `magic_link.html`                     | Sign in — CaseLink                  |
| Change Email Address        | `email_change.html`                   | Confirm email change — CaseLink     |
| Reset Password              | `recovery.html`                       | Reset your password — CaseLink      |
| Reauthentication            | `reauthentication.html`               | Verify your identity — CaseLink     |
| Password changed            | `password_changed_notification.html`  | Password changed — CaseLink         |
| Email changed               | `email_changed_notification.html`     | Email address changed — CaseLink    |
| Phone changed               | `phone_changed_notification.html`     | Phone number changed — CaseLink     |
| MFA factor enrolled         | `mfa_factor_enrolled_notification.html`   | MFA method added — CaseLink    |
| MFA factor unenrolled       | `mfa_factor_unenrolled_notification.html` | MFA method removed — CaseLink  |
| Identity linked             | `identity_linked_notification.html`   | New identity linked — CaseLink      |
| Identity unlinked           | `identity_unlinked_notification.html` | Identity unlinked — CaseLink        |

Security notifications (password changed, email changed, etc.) must be enabled in **Authentication** → **Settings** → **Security and Auth** or via the Email Templates page.

## Template variables (Supabase Go templating)

- `{{ .ConfirmationURL }}` — Verification link
- `{{ .Token }}` — 6-digit OTP (reauthentication)
- `{{ .Email }}` — User's email
- `{{ .NewEmail }}` — New email (email change)
- `{{ .OldEmail }}` — Previous email (email changed notification)
- `{{ .SiteURL }}` — Your app's site URL
- `{{ .RedirectTo }}` — Redirect URL passed at sign-in

Do not remove these variables — they are replaced by Supabase when sending.
