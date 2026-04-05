# Security

How CaseLink handles secrets, access control, AI usage, and error disclosure. Intended for reviewers and operators.

## Secrets and configuration

- Do not commit `.env.local`, the Supabase **service role** key, or **OpenAI** keys. Use `.env.example` as the only tracked template.
- Values exposed to the browser are limited to `NEXT_PUBLIC_*` entries that are safe by design (Supabase project URL and anon key). All other variables are server-only.
- Server code validates environment variables through `getEnv()` in `src/lib/env.ts`. Missing or invalid required public variables fail fast when that path runs (including typical CI and production boot paths).

## Authentication and data isolation

- End users authenticate with **Supabase Auth**. Routine data access uses the user’s JWT through the Supabase client, not the service role.
- **Row Level Security (RLS)** in Postgres limits rows according to policies (see `supabase/migrations/`, including `can_access_family()`). Apply migrations in filename order on every environment.
- The **service role** is for trusted server-side operations only (for example the CSV import script), not for browser traffic.

## AI usage and abuse controls

- OpenAI is invoked **only on the server**. Model identifiers are validated at startup against an allowlist (`src/lib/ai/model-allowlist.ts`).
- **Per-user** rate limits apply to OpenAI-backed work, with optional **per-IP** limits (`OPENAI_RATE_LIMIT_PER_IP_MAX`). Input size and output token caps limit cost and oversized payloads.
- Structured logs (for example `[openai-usage]`) record operational metadata such as route label, model, and timing—not full prompt text.

## Errors and client-visible messages

- Server actions and API paths aim to return **generic** messages to browsers in **production**. Detailed errors and stack traces are intended for **server logs** only (for example `[server-error]` in development, or without stack details in production logging).
- **Development** mode may surface more detail (including some Supabase messages and auth flows) to speed local debugging.
- Auth callback and sign-in/sign-up forms sanitize obvious infrastructure-style wording in production before showing messages in the UI or query string.

## Reporting vulnerabilities

Do not open a public issue with exploit details. Report security issues **privately** to the maintainers (for example via [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) if enabled for the repository). Valid reports will be handled in good faith.

## Disclaimer

Operators remain responsible for their own Supabase, hosting, and OpenAI account security, key rotation, and compliance obligations. This document is not legal advice.
