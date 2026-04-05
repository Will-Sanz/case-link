# CaseLink

CaseLink is a case management workspace for teams supporting families through **30 / 60 / 90-day plans**, resource matching, calendars, and optional AI assistance. Data access is **per authenticated user**, enforced with **Supabase Auth** and **Row Level Security (RLS)** on Postgres.

---

## Why it exists

Case managers coordinate fragile timelines, referrals, and documentation. CaseLink brings **family context**, **actionable plans**, and a **resource directory** into one place. AI is used **only where it clearly helps execution** (drafting plans, refinements, in-context Q&A)—not as a substitute for professional judgment.

---

## What ships today

- **Families and intake** — Households, goals, barriers, members, and case notes with server-side validation.
- **Resource directory** — Searchable programs (seeded via CSV import); deterministic matching without embeddings.
- **Matched resources** — Accept, dismiss, or attach programs; activity is logged.
- **Plans** — Rules-based generation with optional OpenAI; editable steps, checklists, and action items; PDF-oriented client display fields.
- **Case assistant** — Chat grounded in the family’s plan, barriers, and matches.
- **Step helpers** — On-demand scripts, checklists, and similar artifacts.
- **Dashboard and calendar** — Views driven by plan steps and due dates.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Browser (React, Tailwind)                                   │
│  Supabase JS (anon key) + cookie session                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js (App Router)                                        │
│  • Node proxy: session refresh + route guard (`src/proxy.ts`)│
│  • Server Components + Server Actions                        │
│  • Zod validation on server inputs                           │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌────────────────────────────┐
│  Supabase Postgres         │   │  OpenAI API (optional)     │
│  RLS (`can_access_family`) │   │  Server-only API key         │
│  User JWT on each query    │   │  Rate limits + size caps    │
└───────────────────────────┘   └────────────────────────────┘
```

- **Data access** — PostgREST uses the end-user JWT. RLS uses `can_access_family()` (creator, assignee, or admin) on shared family data.
- **Service role** — `SUPABASE_SERVICE_ROLE_KEY` is for trusted scripts (for example `npm run db:import`), not for the web app or browser.

---

## AI guardrails (server)

- OpenAI credentials and model overrides are **server-only**. Model IDs are validated at startup (`src/lib/ai/model-allowlist.ts`).
- **Per-user** rate limiting (in-memory per instance) applies across OpenAI-backed actions; optional **per-IP** cap: `OPENAI_RATE_LIMIT_PER_IP_MAX`.
- **Input size** and **max output tokens** caps limit cost and abuse.
- User-visible failures are **generic in production**; richer detail is confined to **server logs** (and local development). Optional `OPENAI_DEBUG=1` increases server logging only—it does not expose stack traces to the browser by itself.

---

## Security and privacy

| Topic | Approach |
|--------|-----------|
| **Secrets** | Only `NEXT_PUBLIC_*` for Supabase URL and anon key; OpenAI and service role never ship to the client. |
| **Auth** | Supabase Auth; sensitive actions use `requireAppUserWithClient()` with the same client used for writes. |
| **RLS** | Family-scoped tables use `can_access_family()`; see `supabase/migrations/`. |
| **Input** | Zod on server actions; AI entry points use dedicated schemas (`src/lib/validations/ai-actions.ts`). |
| **Errors** | `src/lib/errors/public-action-error.ts` maps many database errors to safe strings; auth forms use client sanitization in production. |
| **Headers** | `next.config.ts` sets `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. |
| **Markdown** | Assistant output allows only `http:`, `https:`, and `mailto:` links. |

**Operator-owned setup:** Supabase Auth URLs, Site URL, redirect allowlist, and Vercel environment scoping (Production vs Preview). Details: **[SECURITY.md](./SECURITY.md)**.

---

## Tech stack

- **Framework:** Next.js (App Router), React, TypeScript  
- **UI:** Tailwind CSS  
- **Data:** Supabase (Postgres + Auth)  
- **Validation:** Zod  
- **AI:** OpenAI (optional), `src/lib/ai/`  
- **PDF:** `@react-pdf/renderer`

---

## Local setup

```bash
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).
# Optional: OPENAI_API_KEY for AI-backed flows.
npm run dev
```

**Optional scripts**

| Command | Purpose |
|---------|---------|
| `npm run db:import` | Import resources CSV (`SUPABASE_SERVICE_ROLE_KEY` required). |
| `npm run db:create-test-user` | Local test user helper (service role; not for production passwords). |

**Quality gate (matches typical CI):**

```bash
npm run ci
```

---

## Environment variables

Required for the app UI:

| Variable | Required | Role |
|----------|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Anon key (RLS enforced) |

Strongly recommended in production:

| Variable | Notes |
|----------|--------|
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for auth redirects |
| `NEXT_PUBLIC_APP_URL` | Legacy alias if `NEXT_PUBLIC_SITE_URL` is unset |

Server-only (optional unless you use the feature):

| Variable | Notes |
|----------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` | Import / admin scripts only |
| `OPENAI_API_KEY` | Enables AI plans and helpers |
| `OPENAI_*_MODEL`, `OPENAI_MODEL_OVERRIDE` | Must pass allowlist validation |
| `OPENAI_RATE_LIMIT_*`, `OPENAI_MAX_*` | Throttling and caps |
| `OPENAI_DEBUG`, `OPENAI_PAYLOAD_DEBUG`, `PLAN_*_DEBUG` | Server logging only |

Full comments: **`.env.example`**. Parsing and defaults: **`src/lib/env.ts`**.

---

## Database migrations

Apply files in **`supabase/migrations/`** in lexicographic filename order (`supabase db push` or SQL Editor). Do not reorder files already applied in production.

| File | Purpose |
|------|---------|
| `20260321000000_init_schema.sql` | Core tables and RLS enabled |
| `20260321120000_family_rls.sql` | `can_access_family`, family domain |
| `20260321170000_plans_rls.sql` | Plans and steps |
| `20260405120000_referrals_tasks_rls.sql` | Referrals and tasks |
| `20260406120000_rls_policy_hardening.sql` | Barrier workflow records, step activity insert binding, import-run JWT deny |

---

## Deploying on Vercel

1. Apply all migrations to the target Supabase project.  
2. Set environment variables (at minimum both `NEXT_PUBLIC_SUPABASE_*`; set `NEXT_PUBLIC_SITE_URL` for auth in production).  
3. In Supabase: **Authentication → URL Configuration** — Site URL and redirect URLs including `/auth/callback`.  
4. Vercel **Root Directory** = repository root (**never** `src` — wrong root often yields **404** or broken builds).  
5. **Framework preset:** Next.js. **Build:** `npm run build`. **Output:** leave default (`.next`); do not point Output Directory at a custom path unless you know you need it.  
6. Session refresh uses the Node **`proxy`** (`src/proxy.ts`), not Edge middleware, for compatibility with the current Supabase + Next.js stack.

**If you see 404 after deploy:** confirm root directory and framework preset first; then confirm env vars are set for that environment. This app intentionally avoids fragile `middleware.ts` + Supabase patterns on Edge; use `src/proxy.ts` as shipped.

---

## Limitations and roadmap

- OpenAI rate limits are **in-process**; multiple instances need a shared limiter (for example Redis) for strict global caps.  
- Referrals and tasks are secured at the database layer; product UI may not expose every table.  
- Resource matching is **not** embedding-based; weights live in `src/lib/matching/engine.ts`.

---

## Public launch checklist (ordered)

Use this as a single pass before opening the repo or pointing a production domain here.

1. Confirm **no secrets** in git history or working tree (`.env.local` untracked; rotate any key that was ever exposed).  
2. **Supabase:** run all migrations; verify RLS on user tables; configure Auth URLs and email templates as needed.  
3. **Vercel:** set env vars per environment; redeploy; add Preview URLs to Supabase redirect allowlist if you use Preview deployments.  
4. **GitHub:** enable private security reporting; add branch protection if collaborators push to `main`.  
5. Smoke-test: sign-in, create family, plan flow, and (if enabled) one AI action.  
6. Read **SECURITY.md** once for your deployment context.

---

## License and review context

The repository is structured for **technical review**: clear boundaries between client and server, RLS-backed data access, validated inputs, and documented operator responsibilities. Scope is described honestly above versus future work.
