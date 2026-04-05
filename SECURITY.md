# Security

This document describes how CaseLink handles secrets, data access, and AI usage. It is intended for reviewers and operators.

## Secrets and configuration

- **Never commit** `.env.local`, service role keys, or OpenAI keys. Use `.env.example` as the template only.
- **Client-exposed variables** are limited to `NEXT_PUBLIC_*` values that are safe by design (Supabase project URL and anon key). Everything else is server-only.
- **Canonical env validation** runs when server code loads `getEnv()` (`src/lib/env.ts`). Missing required public vars fail fast in development.

## Authentication and data isolation

- End users authenticate with **Supabase Auth**. Application data is accessed with the user’s JWT through the Supabase client, not the service role.
- **Row Level Security (RLS)** on Postgres restricts rows to families the user may access (see `supabase/migrations/`, including `can_access_family()` and per-table policies). Apply all migrations in order on every environment.
- The **service role** is reserved for trusted server-side scripts (for example CSV import), not for normal browser traffic.

## AI routes and abuse controls

- OpenAI calls are **server-only** and use an **allowlisted model** pattern at startup.
- **Per-user rate limits** apply to OpenAI-backed operations (configurable via environment variables). An optional **per-IP** limit can be enabled for unauthenticated or edge cases (`OPENAI_RATE_LIMIT_PER_IP_MAX`).
- **Input size**, **output token caps**, and **schema validation** reduce runaway cost and malformed payloads.
- Server logs may record high-level usage metadata (for example route label, model, timing). **Prompt text and PII are not logged** in those structured lines.

## Error handling

- API and server action errors return **generic messages** to clients in production. Detailed errors and stacks are logged **server-side only** where appropriate.

## Reporting vulnerabilities

If you believe you have found a security issue, please **do not** open a public GitHub issue with exploit details. Contact the maintainers privately with a description, affected component, and steps to reproduce. We will treat valid reports seriously and coordinate remediation.

## Disclaimer

This software is provided as-is. Operators are responsible for their own Supabase, Vercel, and OpenAI account security, key rotation, and compliance obligations.
