# Case management MVP

Next.js (App Router) + TypeScript + Tailwind + **Supabase** (Auth + Postgres). Zod validates environment variables; React Hook Form is available for upcoming forms.

## Environment

Copy `.env.example` to `.env.local` and fill in values from the Supabase dashboard (**Project Settings → API**).

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser + server user-scoped client |
| `SUPABASE_SERVICE_ROLE_KEY` | For imports / admin automation only | Server-only; bypasses RLS — never expose to the client |

## Database schema (Supabase SQL)

Schema lives in versioned migrations (apply in order):

- `supabase/migrations/20260321000000_init_schema.sql`
- `supabase/migrations/20260321120000_family_rls.sql`
- `supabase/migrations/20260321140000_resource_matches_rls.sql`
- `supabase/migrations/20260321160000_family_intake_rpc.sql` — `create_family_intake_row()` for new family rows (sets `created_by_id` from `auth.uid()` inside the DB)

Apply it using either:

1. **Supabase CLI** (linked project):  
   `supabase db push`  
   or run migrations against your remote DB per [Supabase migration docs](https://supabase.com/docs/guides/cli/local-development#link-your-project).

2. **Dashboard**: SQL Editor → paste the migration file and run (acceptable for early prototyping).

The app uses **`public.app_users`** for roles (`admin` / `case_manager`); each row’s `id` matches **`auth.users.id`**. On first authenticated request, `ensureAppUser` inserts or updates the row via the user’s JWT (RLS allows self-service on `app_users`).

**Promoting an admin:** after a user has signed up once, set their role in SQL:

```sql
update public.app_users set role = 'admin' where email = 'you@example.com';
```

## Data access

- **User session (RLS respected):** `createSupabaseServerClient()` from `src/lib/supabase/server.ts` — use in Server Components, Server Actions, and route handlers when acting as the logged-in user.
- **Trusted server-only (bypasses RLS):** `createServiceRoleClient()` from `src/lib/supabase/service-role.ts` — only after verifying the caller (e.g. admin server action) or in one-off scripts; requires `SUPABASE_SERVICE_ROLE_KEY`.

We are **not** using Prisma; Postgres is the source of truth and migrations are plain SQL under `supabase/migrations/`.

## Local dev

```bash
npm install
npm run dev
```

## TypeScript types for DB rows

Hand-maintained shapes live under `src/types/` (e.g. `database.ts`, `user-role.ts`). Optionally replace or augment with [generated types](https://supabase.com/docs/guides/api/generating-types) from your project.

## Phase 3 — Resource matching (current)

Apply **`20260321140000_resource_matches_rls.sql`** so case managers can read/write **`resource_matches`** for families they can access.

**Behavior:**

- **`src/lib/matching/engine.ts`** — Deterministic scorer: maps **preset goal/barrier keys** to category hints, text keywords, service flags, and light overlap between family narrative and resource `search_text` / program copy. **No embeddings, no OpenAI.**
- **Run / refresh matching** — Deletes only **`suggested`** rows, re-inserts top matches; **never** re-suggests **`dismissed`** programs; leaves **`accepted`** as-is.
- **Accept / dismiss** — Updates `match_status`; activity log events `matching.run`, `matching.accepted`, `matching.dismissed`, `matching.manual_add`.
- **Manual add** — Search + **Add** upserts **`accepted`** (same `family_id` + `resource_id`); dismissed rows can be re-added this way. Search hides programs already linked as accepted or suggested.

UI: family workspace **Matched resources** panel (replaces the Phase 3 placeholder).

## Phase 2 — Families

**Migration:** `supabase/migrations/20260321120000_family_rls.sql` — `can_access_family()` / `is_app_admin()`, families + related tables, extended **`app_users` read** for list/detail.

**Routes:** `/families`, `/families/new`, `/families/[id]` (overview, goals/barriers/members, notes, activity; plan/referrals placeholders remain for Phases 4–5).

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
| `/dashboard` | Stats, recent families, quick links |
| `/families` | List / search / filter families |
| `/families/new` | Intake (goals, barriers, members, notes) |
| `/families/[id]` | Family workspace (overview, notes, activity; Phase 3+ panels stubbed) |
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
- `src/features/` — auth, resources, families (intake, workspace)
- `src/lib/services/` — Supabase query helpers (`resources.ts`, `families.ts`, `resources-picker.ts`)
- `src/lib/matching/` — deterministic resource matcher (no AI)
- `src/app/actions/` — server actions (`families.ts`, `resource-matches.ts`)
- `src/lib/db/resource-import/` — CSV parse/normalize/map → DB payload
- `src/lib/validations/` — Zod schemas for query params

**Plans, referrals, tasks (Phases 4–5):** Placeholders remain on the family page.

**Phase 3 matching** is rules-based; tune presets and weights in `src/lib/matching/engine.ts`.
