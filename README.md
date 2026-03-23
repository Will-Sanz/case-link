# Case management MVP

Next.js (App Router) + TypeScript + Tailwind + **Supabase** (Auth + Postgres). Zod validates environment variables; React Hook Form is available for upcoming forms.

## Environment

Copy `.env.example` to `.env.local` and fill in values from the Supabase dashboard (**Project Settings → API**).

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser + server user-scoped client |
| `NEXT_PUBLIC_APP_URL` | Yes (production) | Production URL (e.g. `https://homelessness-project.vercel.app`) — ensures email confirmation links redirect to production dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | No (web app) | Server-only; required for `npm run db:import` only — bypasses RLS — never `NEXT_PUBLIC_*` or client code |
| `OPENAI_API_KEY` | No | Server-only; when set, plan generation and AI helpers use OpenAI |
| `OPENAI_PLAN_MODEL` | No | Overrides plan create/regenerate model (default: `o3`) |
| `OPENAI_UI_MODEL` | No | Overrides chat, UI helpers, refinements, and other non-plan AI (default: `gpt-4.1-mini`) |
| `OPENAI_MODEL_OVERRIDE` | No | Force one model for all AI tasks (overrides the two above) |
| `OPENAI_DEBUG` | No | Set to `1` to log AI requests, token usage, and verbose plan traces |
| `PLAN_REGENERATE_DEBUG` | No | Set to `1` for extra plan-generation/regeneration trace logs (or use `OPENAI_DEBUG=1`). Set `0` to force off if needed |

**AI model strategy:** **o3** for 30/60/90 plan generation and regeneration (`full_plan_generation`). **gpt-4.1-mini** for step refinement, case assistant, blocker help, call scripts, emails, checklists, and other UI helpers. See `src/lib/ai/models.ts` for routing.

## Deploying to Vercel

1. **Supabase first** — Create/link a project and run all migrations in `supabase/migrations/` in filename order (CLI `supabase db push` or SQL Editor). The app will not function without a matching schema + RLS.
2. **GitHub → Vercel** — Import the repo; framework preset **Next.js**. Build command `npm run build`, output default (`.next`). Session refresh and route protection run in **`src/proxy.ts`** (Next.js 16 **Node** proxy). A root `middleware.ts` on **Edge** previously caused `MIDDLEWARE_INVOCATION_FAILED` on Vercel with this Supabase setup; keep using `src/proxy.ts` next to `src/app`.
3. **Environment variables** — In Vercel → Project → Settings → Environment Variables, add at least:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_APP_URL` — your production URL (e.g. `https://homelessness-project.vercel.app`) so email confirmation links redirect to the dashboard  
   Use **Production** (and **Preview** if you use preview deploys). Redeploy after changing env vars.
4. **Auth URLs** — In Supabase → Authentication → URL Configuration, set **Site URL** to your production origin (e.g. `https://your-app.vercel.app`) and add **Redirect URLs**: `https://your-app.vercel.app/auth/callback` (and preview URLs if needed).
5. **Do not run CSV import on deploy** — `npm run db:import` is a **manual** script from your machine or CI with `SUPABASE_SERVICE_ROLE_KEY`; it is not part of the Next.js build. The app deploys fine without `data/resources-seed.csv` in the bundle.
6. **Post-deploy** — Sign up a user, promote to admin in SQL if needed (`update public.app_users set role = 'admin' where email = '…'`). Optionally run `npm run db:import` locally against production if you need resource rows.

**If every URL returns Vercel `404 NOT_FOUND`:** (1) In Vercel → Project → Settings → General, set **Root Directory** to the repository root (leave empty or `.`), not `src`. (2) The proxy must not call `NextResponse.next({ request: { headers: … } })` with a partial header list — Next.js then strips other `req` headers and routing can fail; this repo uses plain `NextResponse.next()` in `src/lib/supabase/proxy.ts` and relies on `response.cookies` for Supabase session updates.

**If logs show `ReferenceError: __dirname is not defined`:** The proxy must not import from `next/server` (that pulls in `ua-parser-js`). This repo imports `NextRequest` / `NextResponse` from `next/dist/server/web/spec-extension/*` in `src/proxy.ts` and `src/lib/supabase/proxy.ts` only.

## Database schema (Supabase SQL)

Schema lives in versioned migrations (apply in order):

- `supabase/migrations/20260321000000_init_schema.sql`
- `supabase/migrations/20260321120000_family_rls.sql`
- `supabase/migrations/20260321140000_resource_matches_rls.sql`
- `supabase/migrations/20260321160000_family_intake_rpc.sql` — `create_family_intake_row()` for new family rows (sets `created_by_id` from `auth.uid()` inside the DB)
- `supabase/migrations/20260321170000_plans_rls.sql` — RLS for plans, plan_steps, plan_step_resources
- `supabase/migrations/20260325200000_app_users_profile.sql` — case manager profile fields on `app_users` (name, contact prefs, etc.)

Apply it using either:

1. **Supabase CLI** (linked project):  
   `supabase db push`  
   or run migrations against your remote DB per [Supabase migration docs](https://supabase.com/docs/guides/cli/local-development#link-your-project).

2. **Dashboard**: SQL Editor → paste the migration file and run (acceptable for early prototyping).

The app uses **`public.app_users`** for roles (`admin` / `case_manager`) and **workspace profile** columns (display name, phone, preferences, etc.); each row’s `id` matches **`auth.users.id`**. On first authenticated request, `ensureAppUser` inserts or updates the row via the user’s JWT (RLS allows self-service on `app_users`). The **Profile** page (`/profile`) reads and updates those columns; sign-in **email** stays tied to Supabase Auth (synced to `app_users.email` on login).

**Promoting an admin:** after a user has signed up once, set their role in SQL:

```sql
update public.app_users set role = 'admin' where email = 'you@example.com';
```

## Data access

- **User session (RLS respected):** `createSupabaseServerClient()` from `src/lib/supabase/server.ts` — use in Server Components, Server Actions, and route handlers when acting as the logged-in user.
- **Trusted server-only (bypasses RLS):** `createServiceRoleClient()` from `src/lib/supabase/service-role.ts` — only after verifying the caller (e.g. admin server action) or in one-off scripts; requires `SUPABASE_SERVICE_ROLE_KEY`.

We are **not** using Prisma; Postgres is the source of truth and migrations are plain SQL under `supabase/migrations/`. **Do not delete or reorder** applied migration files: new environments rely on running them in filename order from scratch.

## Local dev

```bash
npm install
npm run dev
```

**Test user (local/staging):** With `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, run `npm run db:create-test-user` to create **`test@example.com`** / **`test`** as a `case_manager` (or pass `email` and `password` as args). **Do not use weak passwords in production.**

## TypeScript types for DB rows

Hand-maintained shapes live under `src/types/` (e.g. `database.ts`, `user-role.ts`). Optionally replace or augment with [generated types](https://supabase.com/docs/guides/api/generating-types) from your project.

## Phase 3 — Resource matching (current)

Apply **`20260321140000_resource_matches_rls.sql`** so case managers can read/write **`resource_matches`** for families they can access.

**Behavior:**

- **`src/lib/matching/engine.ts`** — Deterministic scorer: maps **preset goal/barrier keys** to category hints, text keywords, service flags, and light overlap between family narrative and resource `search_text` / program copy. **No embeddings, no OpenAI.**
- **Run / refresh matching** — Deletes only **`suggested`** rows, re-inserts top matches; **never** re-suggests **`dismissed`** programs; leaves **`accepted`** as-is.
- **Accept / dismiss** — Updates `match_status`; server actions also append rows to **`activity_log`** (`matching.run`, `matching.accepted`, `matching.dismissed`, `matching.manual_add`).
- **Manual add** — Search + **Add** upserts **`accepted`** (same `family_id` + `resource_id`); dismissed rows can be re-added this way. Search hides programs already linked as accepted or suggested.

UI: family workspace **Matched resources** panel (replaces the Phase 3 placeholder).

## Phase 4 — 30 / 60 / 90 day plan

**Migration:** `supabase/migrations/20260321170000_plans_rls.sql` — RLS for plans and related tables.

**Behavior:**

- **`src/lib/plan-generator/`** — Rules-based step templates: preset goal/barrier keys map to suggested steps (30-day, 60-day, 90-day phases). Used when OpenAI is unavailable or returns nothing.
- **Generate plan** — If `OPENAI_API_KEY` is set, tries **OpenAI** first (**o3** via Responses API for full plans); on failure or missing key, uses **rules** from goals/barriers. Regenerate creates a new version (regenerate requires AI when enabled).
- **Debug** — Set `OPENAI_DEBUG=1` in `.env.local` to log token usage and any rules fallback (see `[openai-plan]` / `[generatePlan]` in the terminal).
- **Edit steps** — Update title, description, status (pending, in_progress, completed, blocked).
- **Add manual step** — Add custom steps to any phase.
- **Delete step** — Remove steps from the plan.

UI: family workspace **30 / 60 / 90 day plan** panel.

## Phase 2 — Families

**Migration:** `supabase/migrations/20260321120000_family_rls.sql` — `can_access_family()` / `is_app_admin()`, families + related tables, extended **`app_users` read** for list/detail.

**Routes:** `/families`, `/families/new`, `/families/[id]` (overview, goals/barriers, household members, case notes, matched resources, plan; referrals placeholder for Phase 5).

## Phase 1

**Auth:** `/login` (sign in) and **`/signup`** (create account) use Supabase email + password. Under **Authentication → Providers**, enable **Email**. Under **Authentication → Sign In / Providers**, turn on **“Allow new users to sign up”** if you want open registration (or keep it off and only invite users from the dashboard).

For **email confirmation**, add your redirect URL under **Authentication → URL Configuration → Redirect URLs**, e.g. `http://localhost:3000/auth/callback` and your production URL with the same path. New users are sent through **`/auth/callback`** to exchange the confirmation code for a session.

**Routes:**

| Path | Purpose |
|------|---------|
| `/` | Redirects to `/dashboard` if signed in, else `/login` |
| `/login` | Case manager sign-in |
| `/signup` | Create account (email + password) |
| `/auth/callback` | Email confirmation / OAuth code exchange (no UI) |
| `/dashboard` | Today — date-bucketed action queue (overdue / today / upcoming) |
| `/calendar` | Case calendar (due dates & events) |
| `/profile` | Case manager profile, preferences, sign out |
| `/families` | List / search / filter families |
| `/families/new` | Intake (goals, barriers, members, notes) |
| `/families/[id]` | Family workspace (overview, case notes, matched resources, plan; referrals stubbed) |
| `/resources` | Search/filter/paginate active resources |
| `/resources/[id]` | Full resource / contact / service-flag detail |

**Resource CSV import**

1. Apply the DB migration (resources table must exist).
2. Put your export at `data/resources-seed.csv` or pass a path argument.
3. From the project root (`scripts/import-resources.ts` loads `.env.local` then `.env`):

```bash
npm run db:import
# or
npx tsx scripts/import-resources.ts /path/to/Resource\ Database.csv
```

The parser expects the **Google Sheets–style** header on row 2 (0-based index 1) and data from row 3 onward, with **21 columns** as in the partner fair export. Rows are **upserted** on `import_key` (hash of office + program + category). Junk trailing rows (empty org/program, only `TRUE`/`FALSE`) are skipped. Issues are printed to the console; each run appends a row to `resource_import_runs`.

**Layout / code organization**

- `src/app/(workspace)/` — authenticated shell (nav + `ensureAppUser`)
- `src/components/ui/` — small reusable UI primitives
- `src/features/` — auth, dashboard queue, calendar, resources, families (intake, workspace), profile
- `src/lib/services/` — Supabase query helpers (`resources.ts`, `families.ts`, `resources-picker.ts`)
- `src/lib/plan-generator/` — rules-based plan step templates from goals/barriers
- `src/lib/matching/` — deterministic resource matcher (no AI)
- `src/app/actions/` — server actions (`families.ts`, `resource-matches.ts`, `plans.ts`)
- `src/lib/db/resource-import/` — CSV parse/normalize/map → DB payload
- `src/lib/validations/` — Zod schemas for query params

**Referrals & tasks (Phase 5):** Placeholder remains on the family page.

**Phase 3 matching** is rules-based; tune presets and weights in `src/lib/matching/engine.ts`.
