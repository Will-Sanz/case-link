# CaseLink — Supabase Email Templates

Branded HTML templates for Supabase Auth emails. These match the CaseLink website design (teal accent, slate text, clean card layout).

## Two different password emails

Supabase sends **different** emails for password flows:

| Email purpose | What it contains | Template in this folder |
|---------------|------------------|-------------------------|
| **Start** a reset | A link to the CaseLink confirmation screen, using `{{ .SiteURL }}` and `{{ .TokenHash }}` | **Reset Password** → `recovery.html` |
| **After** you changed password | “Your password has been changed” — **no** reset link | **Password changed** → `password_changed_notification.html` |

If someone expects a reset link but only sees “password changed,” they are looking at the **notification** email, not the **recovery** email. In the dashboard, confirm **Reset Password** uses `recovery.html`, not the password-changed template.

The pilot uses invitation/password sign-in. Install the invite, recovery, and reauthentication templates and enable password/email/MFA-change security notifications. The other templates are retained for provider events; their presence does not enable public signup or passwordless case access. The local configuration installs the pilot templates automatically; hosted installation is a separate release check.

Invitation and recovery links use the canonical `SiteURL` and carry their one-use token in the URL fragment, which is not sent in an HTTP request. The app removes it from browser history and waits for the person to choose **Continue to password setup** before verification. Opening a preview alone does not redeem the link. This also allows recovery in a different browser without a PKCE verifier from the requesting browser. Reopen the email if the page is refreshed before continuing. Do not add click tracking, analytics, or token logging to these links. Test the school's actual email filter: a scanner that actively clicks controls still needs a separate delivery assessment.

Set hosted email OTP expiry to **900 seconds (15 minutes)** and code length to **6**, matching `supabase/config.toml` and the templates. Set `SiteURL` to the exact canonical HTTPS origin (no path); allow only the exact production callback and isolated staging callbacks on their respective projects. Do not use production credentials in previews. Verify apex-to-canonical redirects preserve fragments. A setting in this repository does not configure the hosted service.

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
- `{{ .TokenHash }}` — One-use verification credential for the confirmation screen (never log it)
- `{{ .Token }}` — 6-digit OTP (reauthentication)
- `{{ .Email }}` — User's email
- `{{ .NewEmail }}` — New email (email change)
- `{{ .OldEmail }}` — Previous email (email changed notification)
- `{{ .SiteURL }}` — Your app's site URL
- `{{ .RedirectTo }}` — Redirect URL passed at sign-in

Do not remove these variables — they are replaced by Supabase when sending.

Run `npm run test:auth-security` against local Supabase to verify delivered invitation, expiry/resend, recovery in a separate client, security notification, and one-use behavior. The script refuses remote service/mailbox URLs and never prints email bodies, links, codes, or tokens. Record synthetic school-mailbox receipt and installed SMTP/template settings in the release evidence before inviting staff; local delivery cannot establish school delivery.
