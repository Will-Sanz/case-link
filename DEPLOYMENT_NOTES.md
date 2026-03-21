# Vercel Deployment Notes — Fixing 404 NOT_FOUND

## Framework Detected

- **Framework**: Next.js 16.2.1 (App Router)
- **Router**: App Router (`src/app/`)
- **Proxy**: Next.js 16 `proxy.ts` (Node runtime) at `src/proxy.ts` — replaces legacy `middleware.ts`

## Correct Configuration

| Setting | Value |
|--------|--------|
| **Root Directory** | Empty or `.` (repository root). **Never** `src` |
| **Build Command** | `npm run build` |
| **Output Directory** | `.next` (default; do not override) |
| **Framework Preset** | Next.js |

## Required Environment Variables

Set in Vercel → Project → Settings → Environment Variables (Production and Preview):

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Browser + server user-scoped client |
| `NEXT_PUBLIC_APP_URL` | **Yes** (production) | Production URL (e.g. `https://homelessness-project.vercel.app`) — used for email confirmation redirects so users land on dashboard after verifying |
| `SUPABASE_SERVICE_ROLE_KEY` | No (web app) | Server-only; for `db:import` script only |
| `OPENAI_API_KEY` | No | Plan generation |

## Root Cause of 404 NOT_FOUND

The most likely causes (in order):

1. **Wrong Root Directory** — If set to `src`, Vercel looks for `package.json` in `src/` (it does not exist there). Build may fail or deploy from the wrong context, resulting in 404.
2. **Wrong Framework Preset** — If set to "Other" or a non-Next.js preset, Vercel may not run the Next.js build pipeline correctly.
3. **Missing env vars** — `getEnv()` throws if `NEXT_PUBLIC_SUPABASE_*` are missing. The root page now handles this gracefully (redirects to /login), but the login page may still throw until vars are set.

## Known Pitfalls That Caused 404

- **Root Directory = `src`** — Always use repo root.
- **Proxy header override** — `NextResponse.next({ request: { headers } })` with a partial header list can break routing on Vercel. This repo uses `NextResponse.next()` only.
- **Edge middleware** — A root `middleware.ts` on Edge previously caused `MIDDLEWARE_INVOCATION_FAILED` with Supabase. Use `src/proxy.ts` (Node) instead.

## Route Map After Fix

| Path | Handler |
|------|---------|
| `/` | Redirects to `/dashboard` (if logged in) or `/login` |
| `/login` | Case manager sign-in |
| `/signup` | Create account |
| `/auth/callback` | Email confirmation / OAuth |
| `/dashboard` | Stats, recent families (authenticated) |
| `/families` | List/search families (authenticated) |
| `/families/new` | Intake form (authenticated) |
| `/families/[id]` | Family workspace (authenticated) |
| `/resources` | Resource directory (authenticated) |
| `/resources/[id]` | Resource detail (authenticated) |
