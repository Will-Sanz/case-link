# CaseLink

**CaseLink** is a production-minded case management workspace for teams supporting families through structured **30 / 60 / 90-day plans**, resource matching, calendars, and lightweight AI assistance—all scoped per authenticated user with **Supabase Auth + Row Level Security**.

---

## Why this exists

Case managers juggle fragile timelines, referrals, and documentation. CaseLink concentrates **family context**, **actionable plans**, and a **curated resource directory** in one place, and uses AI **only where it adds clear execution value** (drafting plans, step refinements, and in-context Q&A)—not as a black box replacement for professional judgment.

---

## What the product does

- **Families & intake** — Create households, goals, barriers, members, and case notes with validation on the server.
- **Resource directory** — Searchable programs (seeded via CSV import); deterministic matching scores suggestions without embeddings.
- **Matched resources** — Accept, dismiss, or manually attach programs to a family; activity is logged.
- **30 / 60 / 90 plans** — Generate from rules or (when configured) OpenAI; edit steps, checklists, and action items; PDF-oriented client display fields.
- **Case assistant** — Chat grounded in the family’s live plan, barriers, and matches.
- **Step helpers** — Call scripts, emails, prep checklists, troubleshooting, etc., generated on demand.
- **Dashboard & calendar** — Queue and calendar views driven by plan steps and due dates.

---

## System architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Browser (React 19, Tailwind)                                │
│  Supabase JS (anon key) + cookie session                    │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js 16 (App Router)                                     │
│  • Node proxy: session refresh + route guard (src/proxy.ts) │
│  • Server Components + Server Actions                        │
│  • Zod validation on inputs                                  │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌────────────────────────────┐
│  Supabase Postgres         │   │  OpenAI API (optional)      │
│  RLS per family access     │   │  Server-only key            │
│  RPC for safe family create│   │  Rate limit + size caps     │
└───────────────────────────┘   └────────────────────────────┘
```

- **User-scoped data** — PostgREST queries use the end-user JWT; RLS policies use `can_access_family()` (creator, assignee, or admin).
- **No service role in the browser** — `SUPABASE_SERVICE_ROLE_KEY` is only for trusted scripts (e.g. CSV import), not the web app.

---

## AI in the product

- **Plans** — Full or phased generation can call OpenAI with strict JSON-shaped outputs and Zod validation; **rules-based fallback** remains when the key is absent or the model fails.
- **Refinement** — Single-step and full-draft preview refinements use structured outputs where possible.
- **Assistant & helpers** — Shorter completions for execution support (scripts, checklists, Q&A).

**Guardrails (server-side):**

- API key and model overrides are **server-only**; model IDs are validated at startup against an allowlist pattern (`src/lib/ai/model-allowlist.ts`).
- **Per-user rate limiting** (in-memory per process; configurable via env) applies to all OpenAI-backed actions together; optional **per-IP** cap via `OPENAI_RATE_LIMIT_PER_IP_MAX`.
- **Prompt size** and **max output tokens** caps reduce runaway cost.
- **429-style** messaging when rate limited; generic client errors in production unless `OPENAI_DEBUG=1`.
- Lightweight **`[openai-usage]`** logs (user id, route label, model, tokens when available, timing)—no prompt body in those lines.

---

## Security & privacy approach

| Area | Approach |
|------|-----------|
| **Secrets** | Only `NEXT_PUBLIC_*` for Supabase URL + anon key; OpenAI and service role never exposed to the client. |
| **Auth** | Supabase Auth; server actions require `requireAppUserWithClient()` where appropriate. |
| **RLS** | Families, plans, steps, matches, notes, activity log, barrier records, referrals, tasks—scoped to accessible families (see `supabase/migrations/`). |
| **Input** | Zod schemas on server actions; lengths and UUIDs enforced for AI entry points (`src/lib/validations/ai-actions.ts`). |
| **Errors** | Supabase errors mapped to safe messages (`src/lib/errors/public-action-error.ts`); AI errors sanitized for clients in production; `error.tsx` / `global-error.tsx` avoid implying misconfiguration to end users. |
| **Headers** | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` via `next.config.ts`. |
| **Markdown** | Case assistant renders model output as Markdown; links only allow `http:`, `https:`, and `mailto:`. |

**Manual steps you still own:** lock down Supabase **Auth** settings, **Site URL** / redirect URLs, and ensure **RLS is enabled** on all exposed tables in hosted projects. Review **Vercel** env scopes (Production vs Preview).

See **[SECURITY.md](./SECURITY.md)** for a concise public-facing security overview.

---

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript  
- **UI:** Tailwind CSS 4  
- **Data:** Supabase (Postgres + Auth)  
- **Validation:** Zod  
- **AI:** OpenAI (optional), routed in `src/lib/ai/`  
- **PDF:** `@react-pdf/renderer` (exports)

---

## Local development

```bash
npm install
cp .env.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_* (and optionally OPENAI_API_KEY)
npm run dev
```

Scripts (optional):

- `npm run db:import` — Import resources CSV (requires `SUPABASE_SERVICE_ROLE_KEY`).
- `npm run db:create-test-user` — Local test user (service role; **not for production passwords**).

Quality gates:

```bash
npm run ci
```

---

## Environment variables

| Variable | Required | Notes |
|----------|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public anon key (RLS enforced) |
| `NEXT_PUBLIC_SITE_URL` | Recommended (prod) | Canonical origin for auth redirects |
| `NEXT_PUBLIC_APP_URL` | Optional | Legacy alias for site URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Scripts only | **Never** client or `NEXT_PUBLIC_*` |
| `OPENAI_API_KEY` | Optional | Enables AI plans & helpers |
| `OPENAI_*_MODEL` / `OPENAI_MODEL_OVERRIDE` | Optional | Must pass model allowlist validation |
| `OPENAI_RATE_LIMIT_MAX_PER_MINUTE` | Optional | Default 30 per user per window |
| `OPENAI_RATE_LIMIT_WINDOW_MS` | Optional | Default 60000 |
| `OPENAI_RATE_LIMIT_PER_IP_MAX` | Optional | Per-IP OpenAI request cap (same window; unset = disabled) |
| `OPENAI_MAX_INPUT_CHARS` | Optional | Default 120000 |
| `OPENAI_MAX_OUTPUT_TOKENS` | Optional | Hard cap per request (default 8192) |
| `OPENAI_DEBUG` | Optional | Verbose **server** logs |
| `OPENAI_PAYLOAD_DEBUG` / `PLAN_REGENERATE_DEBUG` / `PLAN_REFINE_DEBUG` | Optional | Extra server logging for AI payloads / plan flows (never exposed to the client) |

See `.env.example` for the full list and comments.

---

## Database & migrations

Apply SQL files in **`supabase/migrations/`** in filename order on your Supabase project (`supabase db push` or SQL Editor). Notable files:

- `20260321000000_init_schema.sql` — Core schema + initial RLS stubs  
- `20260321120000_family_rls.sql` — `can_access_family`, family domain policies  
- `20260321170000_plans_rls.sql` — Plans & steps  
- `20260405120000_referrals_tasks_rls.sql` — Referrals & tasks (family-scoped)  
- `20260406120000_rls_policy_hardening.sql` — Tightens `barrier_plan_records` to `authenticated`, binds `plan_step_activity` inserts to `actor_user_id`, explicit deny on `resource_import_runs` for JWT roles  

**Do not reorder** migrations that are already applied in production.

---

## Production deployment (Vercel)

1. Run all migrations on Supabase.  
2. Set env vars on Vercel (at least both `NEXT_PUBLIC_SUPABASE_*`, plus `NEXT_PUBLIC_SITE_URL` for auth).  
3. Configure Supabase **Authentication → URL Configuration** (Site URL + redirect URLs including `/auth/callback`).  
4. **Root directory** on Vercel must be the **repository root** (not `src`).  
5. This app uses a **Node `proxy`** (`src/proxy.ts`) for Supabase session refresh—not Edge middleware—for compatibility with the current Supabase + Next.js combination.

Operational notes live in `DEPLOYMENT_NOTES.md` (Vercel 404 troubleshooting, no secrets).

---

## Known limitations & future work

- **Rate limiting** is in-process; horizontal scale needs a shared limiter (e.g. Redis / Upstash).  
- **Multi-instance** deployments should treat in-memory limits as best-effort.  
- **Referrals / tasks** tables are secured and ready for product use; UI coverage may vary.  
- **Embeddings** are not used for matching today—weights are explicit and tunable in `src/lib/matching/engine.ts`.

---

## Public repository checklist

- [ ] No `.env.local` or keys committed (`.gitignore` includes `.env*`; `!.env.example` is tracked).  
- [ ] `SECURITY.md` reviewed for your deployment context.  
- [ ] Supabase production project has RLS verified (no broad `USING (true)` on user tables).  
- [ ] Vercel env vars set per environment; Preview URLs added to Supabase redirect allowlist if used.  
- [ ] `OPENAI_API_KEY` rotated if it was ever exposed.  
- [ ] Optional: lower `OPENAI_RATE_LIMIT_MAX_PER_MINUTE` for demos.

---

## License / competition context

This repository is suitable for technical review (e.g. competition or grant submissions): it emphasizes **clear architecture**, **defense in depth** (RLS + server validation + AI guardrails), and **honest scope**—what ships today vs. what remains roadmap.
