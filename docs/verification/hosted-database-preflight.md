# Hosted database and staging preparation — October 14, 2026

CL-38, CL-36 and CL-41 remain open. The restored project is reachable; it is not yet compatible with this release. All hosted inspection below was read-only. No hosted migration, account, case, resource, Auth setting or secret was changed.

## Restored project

The user restored `zpfypkizsapvsxeykmdq` (display name `Will-Sanz's Project`) in organization `homelessness-project` / `esnufmvikgpxzgoosqnw`. Direct inspection reports `ACTIVE_HEALTHY`, Free plan, `us-east-1`, Postgres 17.6.1.084. The broad project-list tool omitted this project while direct access worked; its unrelated inactive result is not the pilot target.

[Inspection metadata](2026-10-14-hosted-preflight.json) contains only aggregate counts and schema/advisor metadata: 13 Auth accounts, 11 application accounts, 44 family records and 54 resource records. No identities or case narratives were read. Treat existing records as potentially real and preserve them; do not replace the directory or import demo rows over it.

All 20 observed public tables have RLS enabled, but the current release's private access/session controls are absent and no migrations are recorded. Column inspection confirms `app_users.is_active` is absent. Function inspection finds only five application functions and no current `mark_plan_reviewed` or `is_reviewed_plan_revision` function. `case_progress_updates` exists while `demo_requests` does not, so a chronological migration cutoff must not be inferred from the latest-looking table. The repo has 37 migrations through `20261014012912_contact_provenance.sql`; a clean reset passing locally does not prove this legacy database can be upgraded safely.

Security advisors flag a mutable search path on `public.set_updated_at`, three anonymous-executable privileged functions (`can_access_family`, `create_family_intake_row`, `is_app_admin`), and disabled leaked-password protection. The corresponding authenticated-function warnings require reviewing each intended RPC's authorization rather than blanket revocation. These are configuration/code review findings, not a claim that a data exposure was demonstrated. The public Auth settings also report signup enabled; see the account-email evidence in CL-16.

## Separate test project: prepared, not created

| Setting | Prepared value |
| --- | --- |
| Organization | `homelessness-project` (`esnufmvikgpxzgoosqnw`), same as restored project |
| Name | `caselink-staging` |
| Region | `us-east-1` |
| Data | New synthetic accounts and families only; never clone the existing family records |
| Initial plan | Free, only if the dashboard confirms $0 and an available slot |
| Database administrator credential | Generate and save directly in the operator's password vault; never chat, source, build logs or the web app |
| Web connection | New project's URL and public publishable/anon key; no service-role or database password |
| Auth | Invite-only; no anonymous signup; email confirmation, short token lifetime, secure changes, MFA and exact staging redirects per the local tested policy |
| AI | Separate restricted OpenAI test-project key and budget; no production key shared with previews |
| Vercel | Preview-only connection; explicit preview marker, production-project marker, HTTPS origin, invite/tenancy/HSTS posture and protected access |

The user authorized preparing this separate project. Supabase's connected `get_cost` workflow returns unavailable; the dashboard is at sign-in. No cost-confirmation ID was fabricated and no project was created. The official Free tier lists $0/month and two active projects; available capacity for this organization still needs dashboard confirmation. If the creation screen requires a paid plan, stop and present its actual quote. Pro starts at $25/month, with additional projects from $10/month; no purchase is authorized by this preparation. Free also pauses after inactivity and lacks automatic backups and some Auth protections, so its suitability for synthetic testing is distinct from real pilot hosting. [Supabase pricing, checked October 14](https://supabase.com/pricing).

After access and cost confirmation, record the new project ID, URL, region, plan and owner. Apply all repository migrations to that **new empty project**, install the reviewed email templates and exact Auth policy, then run bounded synthetic hosted account/access/casework/PDF checks. Do not use local reset, restore or security-test scripts against a hosted database without first reviewing their destructive setup assumptions. The existing local runners deliberately target local test infrastructure.

## Preserve and upgrade the legacy database

1. Establish an approved encrypted backup and recovery owner before changes. Include public/private schema, migration history, Auth/account relationships and provider settings; rehearse restoration separately. A metadata inventory is not a backup.
2. Export schema definitions only for a precise comparison with repository migrations: columns, types, indexes, constraints, policies, grants, functions, triggers and extensions. Match actual definitions, not table names alone. Keep production row data out of development.
3. Build an isolated rehearsal of that legacy schema with synthetic existing accounts, cases, plans and resources. Prepare the additive reconciliation and migration-history repair from that comparison; do not blindly replay the initial migration or mark unproven migrations applied.
4. Prove row/ownership preservation, expected account effects, revision invalidation, least-privilege grants, retained-token denial, MFA, review/export, resource contact provenance, rollback boundaries and recovery on the rehearsal. Review any records that would fail new privacy/consistency constraints without printing their contents.
5. Present the exact change set, backup verification, expected interruption/account effects and recovery procedure before seeking authorization to apply it to the restored project. Run the hosted synthetic role matrix and account-to-PDF journey afterward. Record the one-school boundary and named administrators.

No live upgrade is prepared for execution yet: schema/definition comparison and data-compatibility rehearsal are still required. Until those pass, keep the current preview blocked and do not promote the new application against the legacy database.
