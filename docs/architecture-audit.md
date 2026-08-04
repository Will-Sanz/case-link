# CaseLink Architecture Audit (Phase 0)

> Read-only audit of the current codebase. Produced before any redesign work. Confirm with user before starting Phase 1.

**Date:** 2026-05-06
**Branch:** `redesign`
**Scope:** Map current data model, server actions, frontend, auth, resource matching, and AI prompts so the redesign can preserve what works and replace what doesn't.

---

## TL;DR

- **Stack:** Next.js 16 (App Router, Server Actions), React 19, Supabase (Postgres + Auth + RLS), `@react-pdf/renderer` for PDFs, `@supabase/ssr` for sessions, OpenAI (Responses API + Chat Completions). No middleware.ts — auth is enforced inside server actions via `requireAppUser()` plus DB-level RLS.
- **Data model:** Family-centric. A `families` row is the case container; everything (`family_barriers`, `family_goals`, `case_notes`, `plans`, `plan_steps`, `referrals`, `tasks`, `activity_log`) hangs off it. Plans have versioned generations with rich JSONB on each step. There's also a parallel `barrier_plan_records` table that snapshots a barrier-workflow run.
- **Generation pipeline:** Barrier checkboxes → `generateBarrierWorkflowAction` → resource matching (rule-based keyword scoring) → OpenAI plan generation (system + user prompt, JSON-Schema-constrained output, 30/60/90 phases). Supports staged progressive generation (30 first, then 60, then 90).
- **Privacy posture today:** Family records carry a `name` field and free-text fields (`summary`, `household_notes`, member display names). The OpenAI prompt does receive these. **This is the central thing the redesign changes** — it must be replaced with anonymous-by-construction inputs.
- **What survives the redesign:** Supabase auth + RLS pattern, `createAiResponse` AI client, resource table + matching engine, `@react-pdf/renderer` infrastructure, server-action conventions.
- **What gets replaced:** Family-centric schema (replaced by anonymous `cases`), barriers taxonomy (replaced by Contributing Factors taxonomy), the plan generator prompt (replaced with FSP-shaped prompt), barrier workflow UI, barriers/plans/plan_steps/family_* tables (deprecated, not dropped, until Phase 5).

---

## 1. Supabase Schema

Migrations live in [supabase/migrations/](../supabase/migrations/). Schema is built incrementally across ~18 migration files dated 2026-03-21 through 2026-04-06.

### 1.1 Tables

#### Identity / users

- **`app_users`** — extension of `auth.users`. Columns: `id` (uuid, PK, FK→`auth.users.id` on delete cascade), `email`, `role` (enum: `admin` | `case_manager`), `display_name`, `job_title`, `organization`, `phone`, `pronouns`, `service_area`, `bio`, `preferred_contact_method`, `created_at`, `updated_at`. Profile fields added in [20260325200000_app_users_profile.sql](../supabase/migrations/20260325200000_app_users_profile.sql).

#### Family (case container — current model)

- **`families`** — `id`, `name` *(PII — current product asks case managers to type a real or pseudo name)*, `summary`, `urgency` (enum: `low` | `medium` | `high` | `crisis`), `household_notes`, `status` (enum: `active` | `on_hold` | `closed`), `created_by_id`, `archived_at`, `created_at`, `updated_at`.
- **`family_case_managers`** — M:M join (`family_id`, `user_id`), composite PK.
- **`family_members`** — `id`, `family_id`, `display_name`, `relationship`, `notes`, `age_approx`, `created_at`. *(PII risk — display_name is free text)*
- **`family_barriers`** — `id`, `family_id`, `preset_key` *(matches a hardcoded preset)*, `label` *(free text fallback)*, `sort_order`, `created_at`. The current "barriers dropdown" persists here.
- **`family_goals`** — same shape as `family_barriers`.
- **`case_notes`** — `id`, `family_id`, `author_id`, `body`, `created_at`. Free-text, no PII guard.
- **`activity_log`** — `id`, `family_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `details` (jsonb), `created_at`. Audit trail for the family.

#### Resources (Philadelphia directory)

- **`resources`** — master data, imported via CSV (see [scripts/import-resources.ts](../scripts/import-resources.ts)). Columns: `id`, `slug` (unique), `active`, `import_key` (unique), `office_or_department`, `program_name`, `description`, `category`, `tags` (text[]), `search_text`, six contact fields, four service flags (e.g., `recruit_for_grocery_giveaways`), `created_at`, `updated_at`. Read-only for authenticated users.
- **`resource_import_runs`** — log table for CSV imports. `started_at`, `finished_at`, `source_path`, `row_count`, `success_count`, `error_count`, `error_log` (jsonb). Service-role only.
- **`resource_matches`** — `id`, `family_id`, `resource_id`, `match_reason`, `score` (float), `status` (enum: `suggested` | `accepted` | `dismissed`), `plan_step_id` (nullable), `created_at`, `updated_at`. Cached output of the matching engine, optionally linked to a plan step.

#### Plans

- **`plans`** — `id`, `family_id`, `version` (int, unique with `family_id`), `summary`, `generation_source` (enum: `openai` | `rules` | `manual`), `ai_model`, `client_display` (jsonb: `{title, phaseSummaries: {30?, 60?, 90?}}`), `generation_state` (jsonb: progressive-generation state machine, see §1.3), `created_at`.
- **`plan_steps`** — `id`, `plan_id`, `phase` (enum: `30` | `60` | `90`), `title`, `description`, `status` (enum: `pending` | `in_progress` | `completed` | `blocked`), `priority` (text: `low`/`medium`/`high`/`urgent`), `due_date`, `assigned_to_id` (nullable), `sort_order`, `details` (jsonb — see §1.3), `workflow_data` (jsonb), `ai_helper_data` (jsonb), `created_at`, `updated_at`.
- **`plan_step_action_items`** — `id`, `plan_step_id`, `title`, `description`, `week_index` (1–12), `target_date`, `status`, `sort_order`, `outcome`, `notes`, `follow_up_date`, `created_at`, `updated_at`.
- **`plan_step_resources`** — M:M (`plan_step_id`, `resource_id`).
- **`plan_step_activity`** — `id`, `plan_step_id`, `family_id`, `actor_user_id`, `action`, `activity_type`, `notes`, `details` (jsonb), `created_at`.

#### Other

- **`referrals`** — `id`, `family_id`, `resource_id` (nullable), `organization_label`, `contact_person`, `contact_attempted_at`, `method`, `status` (enum: `planned`/`attempted`/`in_progress`/`connected`/`closed`), `outcome`, `next_follow_up_at`, `notes`, timestamps.
- **`tasks`** — `id`, `family_id`, `title`, `description`, `completed`, `completed_at`, `source` (enum: `manual` | `plan_step` | `ai`), `plan_step_id` (nullable), `created_by_id`, `due_date`, timestamps.
- **`barrier_plan_records`** — *the parallel "snapshot" path used by the current barrier workflow.* `id`, `owner_user_id`, `reference_id` (unique with owner), `family_id`, `selected_barriers` (jsonb array), `additional_details`, `generated_plan_json` (jsonb), `matched_resources_json` (jsonb), `status`, timestamps. Owner-only RLS. ([20260326120000_barrier_plan_records.sql](../supabase/migrations/20260326120000_barrier_plan_records.sql))

### 1.2 RLS

Defined across [20260321120000_family_rls.sql](../supabase/migrations/20260321120000_family_rls.sql), [20260321140000_resource_matches_rls.sql](../supabase/migrations/20260321140000_resource_matches_rls.sql), [20260321170000_plans_rls.sql](../supabase/migrations/20260321170000_plans_rls.sql), [20260405120000_referrals_tasks_rls.sql](../supabase/migrations/20260405120000_referrals_tasks_rls.sql), [20260406120000_rls_policy_hardening.sql](../supabase/migrations/20260406120000_rls_policy_hardening.sql).

Central helper:
```sql
can_access_family(family_id uuid) returns boolean security definer
-- true if user is admin OR family.created_by_id = auth.uid() OR row exists in family_case_managers
```
All family-scoped tables use this for SELECT/INSERT/UPDATE/DELETE. `barrier_plan_records` is owner-only (`owner_user_id = auth.uid()`). `resources` is `select using (true)` for authenticated. `resource_import_runs` denies authenticated/anon (service-role only).

**Implication for redesign:** Reuse this pattern. New `cases` table will scope by `case_manager_id = auth.uid()` (case managers see only their own cases — the plan calls this out explicitly in §5 Phase 1).

### 1.3 JSONB shapes worth knowing

`plan_steps.details` (most relevant for the redesign — shows the breadth of structured content the current model supports per step):

```
action_needed_now, rationale, detailed_instructions, checklist[],
required_documents[], contacts[{name, phone, email, notes}],
blockers[], fallback_options[], expected_outcome, timing_guidance,
priority, stage_goal, why_now, success_marker, depends_on,
milestone_type, contact_script
```

`plan_steps.workflow_data` — execution-side fields the case manager fills in (`outcome_notes`, `contact_attempted_at`, `outreach_result`, `documents_received`, `family_understood`, `case_manager_assisted`, `checklist_completed[]`, …).

`plan_steps.ai_helper_data` — outputs of on-demand AI helpers (`call_script`, `email_draft`, `prep_checklist`, `fallback_options`, `family_explanation`, `next_step_guidance`, `last_assisted_at`).

`plans.generation_state` — `{v: 1, status: running|complete|failed, pending_phase: 60|90|null, planning_brief, phases_complete: {30,60,90: bool}, models_used[], stage_timings_ms, ai_mode, error}`.

**Implication for redesign:** The new FSP shape (Goal / Strategy & Case-Worker Objectives / Client Objectives / Status / Date) is *much* simpler than the current `plan_steps.details` schema. Don't carry over the full kitchen sink — model `case_factors` minimally and let the redesign drive what fields earn their place.

---

## 2. Server Actions ("API routes")

This is a Server-Actions codebase, not a `route.ts` codebase. Files live under [src/app/actions/](../src/app/actions/). Cross-checked: no `src/app/api/` directory and no `src/pages/api/` directory.

| Action | File | What it does |
|---|---|---|
| `generatePlan` | [src/app/actions/plans.ts](../src/app/actions/plans.ts) | Full-plan generation. Calls `tryGeneratePlanStepsWithOpenAI`, runs `runResourceMatching`, ensures action items, writes a new `plans` row + `plan_steps` rows. Supports `regenerationFeedback` and `fullRegeneration`. |
| `startStagedLeanPlanGeneration` / `advanceStagedLeanPlanGeneration` | [src/app/actions/plans.ts](../src/app/actions/plans.ts) | Progressive generation: 30 first, then 60, then 90. Polled by client. |
| `generateBarrierWorkflowAction` | [src/app/actions/barrier-workflow.ts](../src/app/actions/barrier-workflow.ts) | Top-level action triggered from the barrier UI. Maps selected barrier preset keys → seeds a family + `family_barriers`, kicks off plan gen, runs resource matching, upserts `barrier_plan_records`. Returns a `BarrierWorkflowResult` shaped for direct rendering. |
| `runResourceMatching` / `updateMatchStatus` | [src/app/actions/resource-matches.ts](../src/app/actions/resource-matches.ts) | Score active resources against a family, persist top results. Status transitions for accept/dismiss. |
| `updatePlanStep`, `generateCaseNoteAction`, `logPlanStepActivityAction` | [src/app/actions/plans.ts](../src/app/actions/plans.ts) | CRUD-ish edit/log helpers. |
| `refineStepWithOpenAI` | [src/lib/plan-generator/openai-refine-step.ts](../src/lib/plan-generator/openai-refine-step.ts) | Per-step regeneration with case-manager feedback, via Chat Completions. |

The OpenAI client itself is [src/lib/ai/client.ts](../src/lib/ai/client.ts) — `createAiResponse` is the single chokepoint. Supports both Responses API (for reasoning models) and Chat Completions, enforces per-user + per-IP rate limits, char/token caps, structured-output JSON schemas, and timeout (180s).

**Implication for redesign:** A new `generateFamilyServicePlanAction` in `src/app/actions/` should follow the same pattern (server action returning a typed result, `requireAppUser()` at the top, `createAiResponse` for the OpenAI call). The barrier workflow action becomes the deprecation candidate.

---

## 3. Frontend Flow (Barrier Selection → Plan Output)

### 3.1 Barrier workflow

- [src/features/barrier-workflow/barrier-workflow-client.tsx](../src/features/barrier-workflow/barrier-workflow-client.tsx) — checkbox UI for the hardcoded barrier preset list; calls `generateBarrierWorkflowAction`. This is the primary entry point that needs replacement in Phase 2.
- [src/app/actions/barrier-workflow.ts](../src/app/actions/barrier-workflow.ts) — maps barriers to preset keys, creates/loads the family, runs matching, kicks off plan gen, returns a result shape consumed directly by the UI.

### 3.2 Family case workspace

- [src/features/families/family-lite-workspace.tsx](../src/features/families/family-lite-workspace.tsx) — single-family workspace shell.
- [src/features/families/family-overview-setup-canvas.tsx](../src/features/families/family-overview-setup-canvas.tsx) — intake form: family name, urgency, summary, household notes, members, barriers, goals.
- [src/features/families/intake-form.tsx](../src/features/families/intake-form.tsx) — alternate intake form path.
- [src/features/families/update-family-form.tsx](../src/features/families/update-family-form.tsx), [add-case-note-form.tsx](../src/features/families/add-case-note-form.tsx), [archive-family-from-list-control.tsx](../src/features/families/archive-family-from-list-control.tsx) — auxiliary edit/archive flows.

### 3.3 Plan rendering & step interactions

- [src/features/families/family-plan-panel.tsx](../src/features/families/family-plan-panel.tsx) — renders plan steps grouped by 30/60/90 phase with action items, checklist UI, status badges. The widest UI in the project.
- [src/features/families/plan-step-case-note.tsx](../src/features/families/plan-step-case-note.tsx), [plan-case-note-derive.ts](../src/features/families/plan-case-note-derive.ts) — case-note authoring tied to a step.
- [src/features/families/case-activity-timeline.tsx](../src/features/families/case-activity-timeline.tsx) — activity log timeline.
- [src/features/families/case-assistant-chat.tsx](../src/features/families/case-assistant-chat.tsx) — per-case AI chat assistant.
- [src/features/families/resource-matches-panel.tsx](../src/features/families/resource-matches-panel.tsx) — surfaces matched resources beside the plan.
- [src/features/families/step-status-badge.tsx](../src/features/families/step-status-badge.tsx), [urgency-status-badges.tsx](../src/features/families/urgency-status-badges.tsx) — status pill components.

### 3.4 Existing PDF export

- [src/features/families/plan-pdf-document.tsx](../src/features/families/plan-pdf-document.tsx) + [plan-pdf-export.tsx](../src/features/families/plan-pdf-export.tsx) — uses `@react-pdf/renderer` (already in `package.json`). **Worth knowing for Phase 4:** we already have PDF infrastructure. The redesign reuses the library; the document layout itself is bespoke and gets rewritten to match the FSP form.

**Implication for redesign:** The plan-panel UI is a pattern reference for the new FSP plan view (3 factor sections with inline-editable fields), but should not be reused as-is — its data shape is too rich for the FSP. Build a leaner `case-fsp-panel.tsx` rather than parameterizing the existing one.

---

## 4. Auth Flow

- **Provider:** Supabase Auth via [@supabase/ssr](https://supabase.com/docs/guides/auth/server-side/nextjs). Session lives in httpOnly cookies set by the SSR helper.
- **Pages:** [src/app/login/page.tsx](../src/app/login/page.tsx), [src/app/signup/page.tsx](../src/app/signup/page.tsx), callback at [src/app/auth/callback/page.tsx](../src/app/auth/callback/page.tsx).
- **App-user sync:** On login/callback, the app upserts an `app_users` row keyed to `auth.users.id`, defaulting `role` to `case_manager`.
- **Guard:** [src/lib/auth/session.ts](../src/lib/auth/session.ts) exposes `getSessionUser()`, `requireAppUser()`, `requireAppUserWithClient()` (returns a Supabase client bound to the user's session for RLS-safe queries), `requireAdmin()`. Server actions and pages call these directly.
- **No `src/middleware.ts` and no root `middleware.ts`.** Verified via `find`. Route protection is exclusively at the server-action / server-component level plus DB-level RLS.

**Implication for redesign:** Don't touch auth. Out of scope per the brief. New server actions just call `requireAppUser()` like the existing ones.

---

## 5. Resource Matching

### 5.1 Storage

`resources` table (see §1.1). Single source of truth for the Philadelphia directory. Imported from CSV via [scripts/import-resources.ts](../scripts/import-resources.ts). The redesign should not re-stage resource data anywhere else.

### 5.2 Matching engine

[src/lib/matching/engine.ts](../src/lib/matching/engine.ts) — pure rule-based, additive scoring. No embeddings, no semantic search.

Scoring inputs per family:
1. `preset_key` → category-hint match (e.g., `housing_instability` → category contains "housing" / "home" / "rent"): **+18** per hit.
2. `preset_key` → text-keyword match in `program_name`/`description`/`search_text` (e.g., `food_support` → "SNAP"): **+10** per hit.
3. Free-text overlap from family `summary` / `household_notes`: **+4 to +12** depending on overlap density (capped).
4. Service flags (e.g., family flagged `food_insecurity` AND resource has `recruit_for_grocery_giveaways = true`): **+8**.

Output: `rankResourcesForFamily(input, resources)` returns `RankedMatch[]` sorted by score desc, with a `reason` string describing why each matched. Top N (typically 10) are written into `resource_matches` and the top selection is also formatted via `formatMatchesForAiPrompt()` and injected into the OpenAI plan prompt as `MATCHED_COMMUNITY_RESOURCES`.

### 5.3 How resources reach the plan

- Pre-generation: `runResourceMatching(familyId)` populates `resource_matches`.
- During generation: the prompt's user message includes a formatted block of top matches (program name, contact, category) and the system prompt instructs *"Use MATCHED_COMMUNITY_RESOURCES when provided. Include program names and contact details."*
- Post-generation: steps can be linked to resources via `plan_step_resources` (M:M) and via `resource_matches.plan_step_id`.

**Implication for redesign:** The matching engine takes a "family input" today. Refactor it to take a generic input shape (selected factor codes + anonymous context), so it works for both the legacy family path and the new case path. The keyword/category rules themselves keep working — the trigger keys just change from barrier preset_keys to factor_codes. This is the single biggest "don't build a parallel system" risk in Phase 2.

---

## 6. OpenAI Prompts (full text)

### 6.1 Full-plan generation

File: [src/lib/plan-generator/openai-plan.ts](../src/lib/plan-generator/openai-plan.ts) (system prompt ~lines 116–190; user prompt assembled dynamically).

**System prompt** (verbatim):

> You are an experienced housing and social services case manager assistant in Philadelphia. Your job is to produce a PRIORITIZED 30, 60, and 90 day case plan ordered by importance and urgency, NOT strict dependency chains. Steps should be in the most logical sequence for a case worker, but do not need to depend on each other.
>
> ## GEOGRAPHIC CONTEXT
> *(injected from `lib/ai/prompt-geo.ts` `GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS`)*
>
> ## FIELD: action_needed_now (mandatory style)
> - This is a short directive for the case manager: what to do next, or a crisp factual cue (timelines, deadlines, eligibility notes), written as a **statement**, not an answer to a question.
> - Do **not** start with Yes, No, Sure, Correct, or similar. Do **not** phrase as Q&A.
> - Prefer imperative or neutral declarative voice: e.g. "Submit SNAP application; decisions often within 30 days; ask about expedited SNAP (often within ~5 days) if eligible." NOT "Yes, SNAP decisions take up to 30 days…"
>
> ## CORE GOAL: Prioritized Action Plan
> Generate a prioritized action plan, not a list of similar suggestions. The first step should be the most important action to take immediately. Each subsequent step should be clearly different and lower in urgency or impact. If two steps overlap significantly, combine them into one stronger step.
>
> ## PRIORITIZATION RULES (mandatory)
> Rank steps by: 1) Urgency, 2) Impact, 3) Time sensitivity. Step 1 = most urgent. Do NOT force dependency chains.
>
> ## DEDUPLICATION RULES (mandatory)
> Check for overlap in program names, intent verbs, outcome. Merge "Apply for SNAP" + "Contact food pantry for SNAP referral" if they overlap.
>
> ## STEP QUALITY RULES
> - Distinct titles, primary objective, specific action items.
> - 3 to 5 steps per phase max; 8 to 12 total ideal.
>
> ## PLANNING PHILOSOPHY
> Prioritize: (1) immediate stabilization, (2) urgent action in week 1, (3) concrete progress over passive assessment, (4) meaningful outcomes early.
>
> ## 30 day phase = URGENT ACTION, NOT ASSESSMENT
> Week 1: schedule appointments, submit applications, contact agencies, gather/send docs, enroll, confirm eligibility.
>
> ## ANTI-PATTERN
> AVOID: assess, explore, identify (without action). USE: call, schedule, apply, submit, confirm, register, request, book, gather, send, escalate, secure, enroll.
>
> ## URGENCY SCALING
> High/crisis cases: compress timelines; push actions into days 3–7.
>
> ## Schema and output
> - Return a single JSON object with top-level key "steps" only.
> - priority field: "high" for steps 1–2, "medium" for mid, "low" for later.
>
> ## Step count
> - Roughly 2–5 steps per phase. Max 5/phase, 15 total. Do not pad.
>
> ## Resource grounding
> - Use MATCHED_COMMUNITY_RESOURCES when provided. Include program names and contact details.
> - action_items[].title must be specific and calendar-ready.
> - action_items represent tasks; put document names into required_documents and contact info into contacts.

**User prompt** (templated): "Create a 30, 60, and 90 day case plan ordered by PRIORITY…" with the family's barriers, goals, summary, notes, and `MATCHED_COMMUNITY_RESOURCES` block appended.

**Response schema:** [src/lib/plan-generator/plan-step-openai-schema.ts](../src/lib/plan-generator/plan-step-openai-schema.ts) — JSON Schema (OpenAI Structured Outputs) + Zod validator. Each step requires `phase`, `title`, `description`, `action_needed_now`, `action_items[]`, `rationale`, `detailed_instructions`, `checklist[]`, `required_documents[]`, `contacts[]`, `blockers[]`, `fallback_options[]`, `expected_outcome`, `success_marker`, `stage_goal`, `why_now`, `timing_guidance`, `priority` (low|medium|high). Optional: `contact_script`, `depends_on`, `milestone_type`.

**Model config:** Temperature 0.35; max_output_tokens default 8192 (capped 32k); 180s timeout. Reasoning models pass `reasoning.effort` instead of temperature.

### 6.2 Other prompts in the codebase

- [src/lib/plan-generator/openai-refine-step.ts](../src/lib/plan-generator/openai-refine-step.ts) — single-step regeneration with feedback. Chat Completions.
- [src/lib/plan-generator/openai-plan-lean-phase.ts](../src/lib/plan-generator/openai-plan-lean-phase.ts) — lighter prompt for staged 30→60→90 generation.
- [src/lib/step-helper/ai-step-helper.ts](../src/lib/step-helper/ai-step-helper.ts) — task-specific prompts for `call_script`, `email_draft`, `prep_checklist`, `fallback_options`, `family_explanation`, `next_step_guidance`. Each writes into `plan_steps.ai_helper_data`.

**Implication for redesign:** This prompt is *good* — it carries hard-won deduplication logic, anti-pattern guidance, and resource-grounding rules. The redesign should not throw it away wholesale. Lift the deduplication / anti-pattern / resource-grounding sections into the new FSP prompt; replace the 30/60/90 schema/structure with `{factor_code, goal, strategy_objectives, client_objectives}` per the brief §5 Phase 2.

---

## 7. Reusability Assessment

| Piece | Verdict | Notes |
|---|---|---|
| Supabase auth + `requireAppUser()` | **Keep as-is** | Out of scope per brief §7. New cases scope to `case_manager_id = auth.uid()`. |
| RLS pattern (`can_access_family` style) | **Keep, adapt** | Build the analogous helper for `cases` (or just inline `case_manager_id = auth.uid()` since cases are owner-only, not shared). |
| `createAiResponse` AI client | **Keep as-is** | Already supports JSON-Schema structured output, rate limits, both Responses + Chat APIs. Use it for the new FSP prompt unchanged. |
| Resource table + matching engine | **Keep, refactor signature** | Replace family-shaped input with a generic shape so both the legacy path and the new case path share it. Keyword/category rules stay. |
| Plan generation prompt deduplication / anti-pattern guidance | **Keep, port into new prompt** | Lift the rules; replace the 30/60/90 schema with FSP shape. |
| `@react-pdf/renderer` + existing PDF infra | **Keep the library, rewrite the document** | New document mirrors the FSP form, not the 30/60/90 plan. |
| Server-action conventions, error shape (`ActionResult`) | **Keep** | Match the pattern for `generateFamilyServicePlanAction`, `updateCaseFactorAction`, etc. |
| `families` + `family_*` + `plans` + `plan_steps` + `plan_step_*` + `barrier_plan_records` | **Deprecate, do not drop** | Per brief §5 Phase 1: mark as deprecated in code comments, leave RLS in place, drop only in Phase 5 after data verification. |
| Barrier workflow UI ([barrier-workflow-client.tsx](../src/features/barrier-workflow/barrier-workflow-client.tsx)) | **Replace** | New intake UI in Phase 2. |
| Family workspace UI ([family-lite-workspace.tsx](../src/features/families/family-lite-workspace.tsx) and siblings) | **Replace** | New `cases/[id]` route and case-detail UI in Phase 3. |
| Plan-panel UI ([family-plan-panel.tsx](../src/features/families/family-plan-panel.tsx)) | **Reference, don't reuse** | Inline-editable status badges and section grouping are good patterns. The data shape is too rich; build a leaner panel for FSP. |
| `case-assistant-chat.tsx`, `plan-step-case-note.tsx`, step helper actions | **Out of scope for redesign** | Don't carry forward unless explicitly requested. |
| `step-helper/ai-step-helper.ts` (call scripts, emails) | **Defer** | Could be a v2 add-on to FSP factors. Not in the redesign critical path. |
| `staged-lean-plan-generation` (progressive 30→60→90) | **Drop for FSP path** | FSP has 3 factors, not 3 phases of an evolving plan. Single-shot generation is fine. |
| Activity log / referrals / tasks tables | **Don't touch** | Not in the FSP redesign critical path; leave alone. |

---

## 8. Files Inspected

**Supabase migrations** (full directory): [supabase/migrations/](../supabase/migrations/) — all 18 files.

**Server actions:**
- [src/app/actions/plans.ts](../src/app/actions/plans.ts)
- [src/app/actions/barrier-workflow.ts](../src/app/actions/barrier-workflow.ts)
- [src/app/actions/resource-matches.ts](../src/app/actions/resource-matches.ts)

**AI / plan generation:**
- [src/lib/ai/client.ts](../src/lib/ai/client.ts)
- [src/lib/plan-generator/openai-plan.ts](../src/lib/plan-generator/openai-plan.ts)
- [src/lib/plan-generator/plan-step-openai-schema.ts](../src/lib/plan-generator/plan-step-openai-schema.ts)
- [src/lib/plan-generator/openai-refine-step.ts](../src/lib/plan-generator/openai-refine-step.ts)
- [src/lib/step-helper/ai-step-helper.ts](../src/lib/step-helper/ai-step-helper.ts)
- [src/lib/matching/engine.ts](../src/lib/matching/engine.ts)
- [src/lib/auth/session.ts](../src/lib/auth/session.ts)

**Frontend:**
- [src/features/barrier-workflow/barrier-workflow-client.tsx](../src/features/barrier-workflow/barrier-workflow-client.tsx)
- [src/features/families/](../src/features/families/) — directory listing of all components.

**Config:**
- [package.json](../package.json) — confirms `@react-pdf/renderer` for PDFs, `@supabase/ssr` for sessions, `zod` v4, Next 16 / React 19.

---

## 9. Notable Gaps / Things Not Yet Verified

1. **Lean-phase prompt text** ([openai-plan-lean-phase.ts](../src/lib/plan-generator/openai-plan-lean-phase.ts)) was not opened in detail. Likely won't matter for the redesign (FSP doesn't use staged generation), but worth a glance if we ever want to port phrasing.
2. **Barrier preset list source.** The mapping from UI checkboxes to `preset_key` lives in the barrier workflow action (~line 25 of [barrier-workflow.ts](../src/app/actions/barrier-workflow.ts)), but the canonical UI option list / labels file wasn't located. Not load-bearing for the redesign — the new taxonomy comes from the FSP form, not from these.
3. **Existing PDF document layout** ([plan-pdf-document.tsx](../src/features/families/plan-pdf-document.tsx)) wasn't opened. Worth reading before Phase 4 to learn the `@react-pdf/renderer` patterns the codebase already uses.
4. **`case-assistant-chat.tsx`** functionality isn't fully understood — looks like a per-family AI chat. Out of scope, but useful to confirm it doesn't pull in PII paths we'd inadvertently keep alive.
5. **Geographic context constant** (`GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS` in [src/lib/ai/prompt-geo.ts](../src/lib/ai/prompt-geo.ts)) wasn't opened. It's reusable in the FSP prompt as-is — Philadelphia context is jurisdiction-shared.
6. **Resource seed data path / size.** `scripts/verify-resource-seed-paths.ts` runs as part of `npm run verify`, suggesting there's a CSV path expectation. Worth knowing if the redesign needs to invalidate caches, but no immediate action.

---

## 10. Recommended Next Steps (Phase 1 readiness)

Once user approves this audit:

1. **Add `contributing_factors` reference table + seed migration.** Source the taxonomy from the actual FSP form (PDF in project context). Include `factor_code` (stable string ID), `label`, `section` enum (`student` | `family_home` | `school` | `community` | `other`).
2. **Add `cases`, `case_factors`, `case_meeting_notes`, `case_anonymous_context` tables.** Owner-scoped RLS (`case_manager_id = auth.uid()`).
3. **Add migration that comment-tags deprecated tables.** Don't drop. Don't alter.
4. **Decide one open question with the user before Phase 1:** anonymous context as a one-to-one table vs. JSONB column on `cases`. The brief leaves it open; current codebase precedent favors JSONB columns (`plan_steps.details`, `plans.client_display`) for flexible structured fields, so JSONB is the lower-friction choice unless we expect to query individual sub-fields.

**Open questions still pending from the brief §4** (do not block Phase 1):
- Is the FSP PDF a CitySpan export or a separate paper form?
- CitySpan Family Service Plan entry-screen screenshots.
- Current time-to-enter-one-FSP into CitySpan.

These only matter for Phase 4 (export) — Phases 1–3 can proceed against the PDF as ground truth.
