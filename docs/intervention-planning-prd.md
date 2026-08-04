# CaseLink Structured Intervention Planning and Agentic Paperwork

## Product requirements document

**Status:** Production-ready product baseline
**Date:** August 3, 2026
**Owner:** CaseLink  
**Scope:** The family-context → dated intervention-plan → agentic-paperwork experience
**Primary user:** A school case manager supporting individual families  
**Related product principle:** Perfect the family intake → barriers → intervention plan → paperwork workflow before expanding into broader school operations.

---

## 1. Executive decision

CaseLink should stop treating the intervention plan as a long AI-generated document divided into fixed 30-, 60-, and 90-day sections. The product should become a **structured goal-and-date planning workspace** that helps a case manager decide what to do, when to do it, find credible services, prepare for outreach, record what happened, and update only the affected parts of the plan.

The plan is not the AI's recommendation to a family. It is a **case-manager-reviewed working draft** built from the family's stated goals, strengths, barriers, current circumstances, the case manager's professional judgment, and verified resource data. The first useful view should show clear goals and the earliest target dates. Supporting details—documents, contacts, scripts, eligibility notes, rationale, and fallbacks—should be available exactly where they are needed without turning every step into a wall of prose.

The core product promise is:

> CaseLink turns the context a case manager already has into a practical, editable family action plan—and carries the approved facts and actions into required paperwork.

This is a focused product, not a generic chatbot and not an autonomous case-management system.

---

## 2. Why this needs to change

### Current experience

The current implementation works, but its structure limits both usefulness and trust:

- The application, database types, generation prompts, UI, calendar behavior, and PDF export all hard-code `30 | 60 | 90` phases.
- Generation makes three sequential model calls. The first phase must finish before the plan exists; the browser then polls and advances the next two phases one at a time.
- Fresh resource matching runs **after** the initial 30-day phase is generated. The most urgent section therefore cannot use newly matched resources.
- Resource matching is deliberately allowed to fail without failing the plan. The failure is written to server logs, while the case manager sees an empty resources area with no explanation or recovery action.
- The repository contains only a small synthetic two-resource demo seed. The matching engine uses keyword/category rules and does not model service areas, operating hours, eligibility detail, languages, accessibility, application methods, source provenance, or freshness.
- Generated steps contain useful fields, but the interface presents most of them as long prose inside large cards. Priority, next action, ownership, progress, dependencies, resources, and blockers do not form one clear scan path.
- Regeneration can produce another whole plan instead of helping the case manager update the smallest affected part while protecting prior manual edits.
- The system logs some model latency and token usage, but the product has no end-to-end service-level targets, plan-quality evaluation set, resource-quality measures, or case-manager usefulness measures.

### Consequence

The current output looks like a formatted answer from an AI model. The product CaseLink needs to sell is a **reliable working system around that answer**: the right context, a useful plan structure, credible source data, explicit uncertainty, human approval, execution support, and a clean handoff to paperwork.

---

## 3. Research basis

The product direction is grounded in current technical capabilities and authoritative service-design guidance. These sources are inputs, not substitutes for direct research with school case managers.

### Effective case plans are collaborative, individualized, and measurable

- HUD's housing-focused case-management guidance describes a case plan as a roadmap broken into attainable steps, with clear goals, responsibilities, client voice, strengths, and flexibility based on the person's circumstances. [HUD: Housing-Focused Case Management](https://files.hudexchange.info/resources/documents/CJS-Toolkit-Housing-Focused-Case-Management-for-People-Involved-with-the-CJS.pdf)
- Federal child-and-family practice material says coordinated plans should link to assessment results and include strengths, needs, goals, services, target dates, responsible people, and indicators of progress. [National Center on Substance Abuse and Child Welfare: Collaborative Capacity, Module 7](https://ncsacw.acf.hhs.gov/files/collaborative-capacity-module-7.pdf)
- SAMHSA's trauma-informed principles emphasize safety, trustworthiness, transparency, collaboration, and voice and choice. These principles argue against opaque recommendations and top-down language. [SAMHSA: Trauma-Informed Approaches](https://www.samhsa.gov/mental-health/trauma-violence/trauma-informed-approaches-programs)

### Resource information needs facts, provenance, and interoperability

- Open Referral's Human Services Data Specification models organizations, services, locations, schedules, service areas, required documents, languages, accessibility, contacts, and related attributes. It is designed for machine-readable exchange of community-resource data. [Open Referral: HSDS overview](https://docs.openreferral.org/en/3.1/hsds/overview.html)
- Open Referral's design principles prioritize simplicity, factuality, fidelity, provenance, and accessibility. Its guidance also makes clear that service eligibility is complex and should not be casually inferred from a generic taxonomy. [Open Referral design principles](https://openreferral.readthedocs.io/en/3.0/design_principles.html) and [eligibility FAQ](https://docs.openreferral.org/en/3.0/faq.html#how-does-open-referral-handle-eligibility-criteria)

### The interface must reduce cognitive load

- Federal plain-language guidance recommends putting the main message first, using active voice, and breaking information into logical chunks with headings and lists. [CDC plain-language checklist](https://www.cdc.gov/health-literacy/php/develop-materials/plain-language.html)
- Section 508 guidance recommends manageable sections, predictable navigation, labeled forms, clear feedback, and avoiding crowded screens for users with cognitive disabilities. [Section508.gov cognitive accessibility guidance](https://www.section508.gov/design/digital-content-users-with-cognitive-disabilities/)
- The U.S. Web Design System notes that complex forms can be stressful, especially during crisis or recovery from trauma, and recommends explaining purpose, needed information, time, privacy, and next steps in plain language. [USWDS: Establish trust](https://designsystem.digital.gov/patterns/complete-a-complex-form/establish-trust/)

### AI systems need structured outputs, fast feedback, and continuous evaluation

- OpenAI's Structured Outputs can constrain responses to a supplied JSON Schema; the application still needs semantic validation and explicit handling for insufficient or incompatible input. [OpenAI: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- Streaming lets the application begin processing useful output before the full response finishes. [OpenAI: Streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- OpenAI's latency guidance recommends generating fewer tokens, using fewer requests, parallelizing independent work, reducing perceived wait, and not defaulting every task to an LLM. [OpenAI: Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)
- Reused static prompt prefixes can reduce latency and cost through prompt caching, provided stable instructions precede variable case context and cache behavior is measured. [OpenAI: Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- OpenAI evals support repeatable comparisons against labeled test cases. CaseLink needs its own domain rubric and expert-reviewed cases rather than choosing models or prompts by intuition. [OpenAI: Working with evals](https://developers.openai.com/api/docs/guides/evals)
- NIST recommends explicitly defining human-AI roles, testing before deployment and during operation, documenting uncertainty, and using governance, mapping, measurement, and management as continuous functions. [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) and [human-AI interaction guidance](https://airc.nist.gov/airmf-resources/airmf/appendices/app-c-ai-risk-management-and-human-ai-interaction/)

### Student and family data requires a separate approval gate

The current product decision is to avoid identifiable family information. If that changes, vendor use and maintenance of education-record PII must be under school control and limited to authorized purposes, and district technology/privacy staff must be involved. [U.S. Department of Education FERPA guidance for education technology](https://studentprivacy.ed.gov/faq/i-want-use-online-tool-or-application-part-my-course-however-i-am-worried-it-violation-ferpa)

### First school-form evidence: Contributing Factors & Family Service Plan

The first school form available for product discovery is titled **Contributing Factors & Family Service Plan**. It appears to help a case manager identify factors affecting a student's attendance or participation, agree on a small set of service-plan goals, divide responsibilities between the case worker and family, and record progress. Its governing program, required workflow, system of record, and whether it is the school's only relevant form are not yet confirmed.

The form provides stronger workflow evidence than the current 30/60/90 implementation:

- three pages organize contributing factors into student-specific, family/home-specific, school-specific, community-specific, and other categories;
- the service-plan page supports up to three contributing factors;
- each factor has a goal, case-worker objectives, client objectives, progress status, and date;
- progress is expressed as Completed, No Progress, or In Progress rather than fixed time horizons;
- participant, site, case-manager, and signature fields are present, including youth, parent/guardian, additional parent/guardian, and case-manager signatures;
- the form has no dedicated fields for resources, required documents, rationale, fallbacks, or detailed expected outcomes.

This supports a **factor → goal → shared objectives → progress** form mapping, while CaseLink's internal plan remains richer and action-oriented:

| Form concept | CaseLink source | Mapping rule |
| --- | --- | --- |
| Contributing Factor | Reviewed barrier or contributing factor | The case manager selects up to three; AI must not silently decide which factors become official |
| Goal | Reviewed goal | Use concise, observable wording approved by the case manager |
| Strategy Case Worker Objectives | Actions owned by Case manager | Include only approved actions relevant to that factor |
| Client Objectives | Actions owned by Family, Student, or Shared | Populate only when the responsibility was explicitly discussed and approved; never infer a family commitment |
| Completed | Completed action or goal | Map only from an explicit completed state |
| In Progress | Active work | Map from explicitly reviewed in-progress work |
| No Progress | Case-manager-confirmed status | Never derive automatically from Pending, Waiting, Blocked, missing data, or elapsed time |
| Date | Reviewed progress date | Require case-manager confirmation before export |
| Identity and signatures | Manual completion | Leave blank under the current no-identifiable-information policy; signatures are never generated by AI |

The supplied copy is a scanned image rather than a fillable PDF and contains handwritten entries. It is evidence for requirements, not an implementation template. CaseLink needs a clean blank and the school must confirm the form's purpose and required fields before building the first production mapping. If a future blank remains non-fillable, the product will need a one-time reviewed coordinate map or an equivalent template-authoring process; OCR may assist with detecting labels, but it must not be trusted to place or approve form values autonomously.

The most important product implication is that **the operational plan should not mirror one form**. CaseLink should help the case manager develop a useful plan first, then translate only reviewed information into each required form's vocabulary and layout.

---

## 4. Product goals

### Primary goals

1. **Produce a usable first draft quickly.** A case manager should see the most important next actions before the complete plan and supporting detail finish loading.
2. **Improve plan depth without increasing reading burden.** The system should reason about urgency, dependencies, family preferences, strengths, documents, services, likely blockers, and fallbacks, then present only the right layer of detail at the right time.
3. **Make resources dependable.** Every named program must come from an approved data source and carry enough factual context for a case manager to judge whether it is worth pursuing.
4. **Support execution, not just generation.** The plan should help the case manager prepare, act, document an outcome, and adapt the next steps.
5. **Protect professional judgment.** Case managers must be able to accept, edit, reject, reorder, add, or replace any suggested action, and see what the AI changed.
6. **Create a clean input to paperwork.** Approved goals, actions, outcomes, and resource facts should map to forms without asking the model to rediscover the case.

### Non-goals

- Diagnosing a family, determining legal or clinical eligibility, or making child-safety decisions.
- Replacing emergency protocols, mandated reporting procedures, supervisors, or licensed professionals.
- Contacting programs, families, or external systems without an explicit future approval flow.
- Automatically submitting paperwork.
- Predicting family outcomes or ranking families by perceived worthiness, risk, or likelihood of success.
- Building a broad analytics dashboard.
- Holding identifiable student or family information before a separate privacy, security, contracting, and data-governance decision.

---

## 5. Users and jobs to be done

### Primary user: school case manager

The case manager has limited time, incomplete information, multiple concurrent families, and professional knowledge that the system does not have. They need to:

- turn notes and stated barriers into an organized starting point;
- identify the few actions that matter most now;
- know what to prepare before contacting a program;
- avoid wasting time on stale, irrelevant, or ineligible services;
- record outcomes and adjust the plan without starting over;
- reuse approved information in required paperwork.

Assume the primary user:

- is comfortable with ordinary websites but may not know AI or case-management software terminology;
- works from a school-issued laptop, often with many tabs and interruptions;
- may return to a case after hours or days and should not have to remember where they stopped;
- values time saved and accurate paperwork more than customization or novel AI features;
- may have inconsistent source notes and should be able to start without cleaning everything first;
- needs confidence that clicking the wrong thing will not erase work, contact anyone, or submit a form.

### Usability outcome

The user should experience one familiar sequence:

> **Choose a family → confirm what is happening → review a draft plan → prepare the required form.**

They should not need to understand prompts, models, agents, schemas, retrieval, generation jobs, or confidence scores. AI-specific controls appear only where they describe a concrete outcome, such as **Draft plan**, **Find another resource**, or **Rewrite this action**.

For the core flow, usability means:

- a first-time invited user can begin without a tutorial or configuration screen;
- an existing case can be entered gradually; only information needed for the next step is required;
- every screen has one visually dominant next action and a safe secondary exit;
- typed information is saved automatically and remains after refresh, timeout, or recoverable error;
- the user can undo or review AI-driven changes before they replace reviewed work;
- returning users land on the family list and can resume an unfinished case in one click;
- a case manager can distinguish Draft, Needs review, Ready, and Blocked without learning CaseLink-specific vocabulary.

### Secondary user: supervisor

Not in the first implementation scope, but the model must allow a supervisor to review a plan, understand its sources and changes, and leave guidance without taking over the case.

### Family's role

The family is not a direct CaseLink user in V1, but the plan must preserve their stated goals, preferences, constraints, strengths, and choices. The system should never present an AI-generated goal as if the family chose it.

---

## 6. Product principles for this experience

1. **The next action comes first.** Do not make a case manager read a report to discover what to do.
2. **Goals and dates provide the structure.** Organize the plan by reviewed goal and give every action a concrete target date. Status describes progress; it does not determine where the action lives. If a required form needs 30/60/90 language, transform the approved dated plan at export time.
3. **Facts and suggestions look different.** User-provided facts, directory facts, AI inferences, and missing information must be visibly distinguishable.
4. **Ask only high-value questions.** Clarify missing information only when it could materially change safety, priority, eligibility, or the next action.
5. **The plan is shared work.** Reflect family voice and case-manager judgment; avoid commands that imply the family has no choice.
6. **Resources are data, not prose.** The model may explain a verified record's fit. It may not invent a program, phone number, hours, eligibility rule, or application process.
7. **Change the smallest necessary part.** A new fact or failed referral should update affected steps and dependencies, not silently regenerate the entire plan.
8. **Every recommendation must be reviewable.** The case manager can understand why it appears, where its facts came from, and what uncertainty remains.
9. **No silent failure.** Missing resources, partial generation, stale data, and model errors each get an explicit state and recovery action.
10. **Approved plan data becomes paperwork data.** Do not summarize the same case twice with separate, inconsistent AI calls.
11. **The system carries the complexity.** Never ask the case manager to choose a model, configure a workflow, format a prompt, or understand why a technical stage exists.
12. **Work survives interruption.** Autosave, resumable generation, visible status, and safe retries are core behavior rather than convenience features.
13. **Start small and deepen later.** Let the case manager create a useful draft from the minimum responsible context, then add detail where it improves a decision or required form.

---

## 7. Proposed experience

### 7.0 First use and return use

CaseLink is invitation-based. The first authenticated screen is **Families**, not a setup wizard or analytics dashboard.

For a first-time user:

1. Show a brief welcome panel: “CaseLink helps you turn family context into a reviewed plan and prepared paperwork.”
2. Offer one primary action: **Add your first family**.
3. Explain beside the action that the MVP uses a non-identifying case label and does not submit anything to school systems.
4. Provide a short example case label without showing a real person’s name.
5. Do not require profile completion, AI preferences, integrations, notification settings, or a product tour before beginning.

For a returning user:

- list families by the case label the worker recognizes;
- show the next useful state in plain language: Add context, Draft plan, Review plan, Continue work, or Prepare paperwork;
- preserve the last relevant family and screen, but default navigation still returns to Families;
- allow search once the list exceeds ten families and keep recently updated cases first by default;
- show a clear empty search result with **Clear search** rather than an empty table;
- never use dashboard metrics as the primary way to resume work.

### 7.1 Entry: confirm the planning context

The case manager reaches the plan from a family workspace after recording barriers and optional context.

The minimum responsible starting context is:

- a non-identifying family case label;
- one or more case-manager-selected barriers or contributing factors.

A short description of the current situation is optional. Goals, strengths, constraints, prior attempts, deadlines, and supporting notes improve the plan but are not gates unless a configured safety or form requirement makes them necessary. The screen should allow a case manager to select multiple familiar factors from the school-form taxonomy, add Other in their own words, and optionally paste de-identified notes without forcing those notes into many fields. CaseLink may suggest structured fields from those notes, but nothing becomes case context until the case manager reviews it.

The screen first shows a compact **Planning context** summary:

- family case label;
- stated goals and strengths;
- selected barriers;
- urgency or time-sensitive facts entered by the case manager;
- known constraints and preferences;
- last update time.

The case manager can correct this summary before generation. The AI does not add facts at this stage.

### 7.2 Clarification: ask at most three consequential questions

Before drafting, a lightweight context check determines whether critical information is missing. Examples:

- “Is there a deadline or immediate safety concern we should plan around?”
- “Has the family already applied for rental assistance?”
- “What transportation or scheduling constraints should the plan respect?”

Requirements:

- Ask zero questions when existing context is sufficient.
- Ask no more than three in one round.
- Explain why an answer would change the plan.
- Offer **Not sure** and **Skip for now**.
- Never ask the model to infer protected or sensitive facts.
- Save answers as case-manager-provided context, not model-generated truth.

### 7.3 Generation: progressive, real status

After the case manager selects **Draft action plan**, the UI displays actual pipeline states:

1. Checking the case context
2. Finding relevant services
3. Drafting prioritized actions
4. Checking the plan for gaps and unsupported claims

The first actionable section should appear as soon as it is valid. Resource matching and lower-priority planning may continue in parallel. The interface must not display fake progress percentages.

### 7.4 Default plan view: a structured, dated service plan

The default view is not a long document and is not divided into Do next, Upcoming, Waiting, and Later buckets. It is a service plan organized by goals, with concrete actions ordered by target date.

#### Plan header

- one-sentence plan objective;
- family-stated goals represented in the plan;
- plan state: Draft, Reviewed, or Needs attention;
- last updated and who last edited it;
- count of open actions, overdue actions, and goals;
- actions: Review plan, Add action, Prepare paperwork.

#### Goal sections

Each goal section contains:

- the contributing barrier or factor;
- a concise, observable goal statement;
- the expected result;
- a progress summary;
- actions ordered by target date, earliest first;
- completed actions, visually secondary but available in context.

A compact **Next due** summary at the top may show the nearest three open target dates across all goals. It is a shortcut into the same goal-based plan, not a separate planning structure.

#### Compact action card

Every action card shows, without expansion:

- a specific action title beginning with a verb;
- who is responsible: Case manager, Family, Program, or Shared;
- an exact target date;
- status and priority;
- the immediate next task;
- a short expected result;
- linked resource, if any, with data-freshness state;
- number of preparation items or blockers.

Expanded content may show:

- why this action is recommended;
- numbered task checklist;
- required documents;
- resource facts and eligibility notes;
- outreach script or email draft;
- known dependencies;
- likely blockers and one or two fallback paths;
- progress indicator and outcome note;
- provenance for important facts.

Long narrative paragraphs are not the primary representation of a step.

Date requirements:

- CaseLink proposes a target date for every drafted action using supplied deadlines, dependencies, urgency, resource requirements, and the plan start date.
- A proposed date is visibly a suggestion until the case manager reviews it.
- The case manager can edit every date directly during review.
- Every reviewed open action must have an exact target date.
- Waiting or blocked actions retain a target date representing the next follow-up or review, so they do not disappear indefinitely.
- A target date structures work; it never represents a guaranteed family or service outcome.

### 7.5 Review and approval

The first draft enters a guided review mode:

- accept, edit, reject, or move each action;
- flag unsupported or incorrect content;
- confirm or change owners and dates;
- choose among resource alternatives;
- approve all reviewed actions;
- retain an audit-friendly version summary.

Requirements:

- Human edits are protected on later AI updates.
- Whole-plan refinement shows a before/after change summary.
- Step-level refinement changes only the selected action unless a dependency requires a second change, which must be disclosed.
- The system never labels a plan “approved by CaseLink.” It records that a case manager reviewed it.

### 7.6 Execution support

Once reviewed, the plan becomes a working tool:

- mark a task started, complete, blocked, or no longer relevant;
- record a contact attempt and outcome;
- note missing documents;
- schedule a follow-up date;
- create a call script, email draft, preparation checklist, or family-facing explanation for one action;
- report incorrect resource information;
- choose a fallback when the primary route fails.

AI help is invoked from the action where its context is clear. A generic “Refine plan with AI” control is secondary to specific actions such as **Make this step more realistic**, **Find a fallback**, or **Draft a call script**.

### 7.7 Adaptive replanning

A replan begins from a concrete event:

- the family provides new information;
- a deadline changes;
- a program is unavailable;
- an application is denied;
- a required document is missing;
- an action is completed;
- the case manager changes a goal or priority.

The system identifies affected actions, proposes a small patch, and shows:

- what changed;
- why it changed;
- what stayed untouched;
- whether a new resource is being suggested;
- whether paperwork fields may now be out of date.

### 7.8 Paperwork handoff

Only reviewed plan fields become the primary source for paperwork mapping. Each mapped form value should be traceable to:

- family context entered by the case manager;
- an approved action or outcome;
- a verified resource record;
- an explicit model-written narrative reviewed by the case manager.

The operational plan remains goal-based and date-driven while a versioned, form-specific formatter maps actions into whatever time-horizon or section structure the required form expects. The first observed school form uses contributing factors, goals, case-worker objectives, client objectives, progress, and dates—not 30/60/90 phases.

Paperwork preparation is part of the Core release, not an optional follow-on. The user uploads a clean blank PDF, and a document agent:

1. identifies pages, labels, native fields, writing areas, checkboxes, tables, and repeated sections;
2. proposes a structured field map between the form and reviewed CaseLink context, goals, actions, dates, and outcomes;
3. populates only mappings that meet the configured confidence and safety rules;
4. marks ambiguous, unsupported, or missing values for human attention;
5. renders a reviewable draft while preserving the original blank form;
6. produces a completed PDF only after field-by-field human review.

Known, versioned templates provide the most reliable path. Previously unseen forms may use agentic form analysis, but CaseLink must not promise that every PDF can be completed automatically. When a form cannot be mapped safely, the user keeps all detected fields and reviewed work, can enter or map remaining values manually, and receives a specific explanation rather than a failed blank screen.

Paperwork preparation must therefore:

- accept clean blank PDFs only while the no-PII policy is active and warn against uploading completed or signed forms;
- show the destination field beside its proposed source and allow edit, accept, reject, or leave blank;
- treat family/client objectives as explicit commitments that require case-manager confirmation;
- keep identity and signature fields blank and manual under the current no-identifiable-information policy;
- distinguish native fillable fields from scanned forms that require a reviewed template map;
- show the original page beside or directly behind the mapped review values so placement can be visually checked;
- preserve the final case-manager-edited value separately from the source suggestion;
- rerun only affected mappings when reviewed plan content changes and mark the prior paperwork fields Out of date;
- never imply that preparing or downloading a form submits it to an external system.

### 7.9 Critical path and screen contract

The production flow must preserve this order while allowing the user to go back without losing work:

| Step | Screen | User decision | Primary action | Success state |
| --- | --- | --- | --- | --- |
| 1 | Families | Which case am I working on? | Open family or Add family | Family workspace opens |
| 2 | Family context | Is the saved context accurate enough to plan from? | Continue to plan | Context is saved and summarized |
| 3 | Context check | Are any consequential facts missing? | Draft plan | Questions are answered, marked Not sure, or skipped |
| 4 | Drafting | Do I need to do anything while CaseLink works? | None; user may leave safely | First useful action appears and the job continues |
| 5 | Plan review | Is each proposed action appropriate? | Finish review | Plan is marked Reviewed by the case manager |
| 6 | Working plan | What should happen next? | Start/update the top action | Progress is saved without regenerating the plan |
| 7 | Paperwork | Which reviewed information belongs in this form? | Download completed PDF | Editable reviewed copy downloads for manual upload |

Navigation and persistence requirements:

- browser Back, in-product Back, refresh, and reopening the tab preserve committed work;
- leaving during generation does not cancel the job unless the user explicitly chooses Cancel;
- repeated clicks on a primary action cannot create duplicate families, plans, jobs, tasks, or downloads;
- every completed step communicates what was saved and what happens next;
- the interface warns before discarding unsaved local text, but ordinary navigation must not produce warnings after autosave completes;
- opening an old link routes to the closest valid screen with an explanation rather than a generic error page.

### 7.10 State language and recovery contract

The interface uses a small, consistent state vocabulary. Internal states may be more detailed, but case-manager labels must remain familiar.

| Object | User-visible states | Required behavior |
| --- | --- | --- |
| Family workflow | Add context, Draft plan, Review plan, Continue work, Prepare paperwork | Exactly one appears as the recommended next step on the Families page |
| Plan | Draft, Needs review, Reviewed, Needs attention | A plan becomes Reviewed only through an explicit case-manager action; later material changes return affected content to Needs review |
| Action | Not started, In progress, Waiting, Completed, No longer needed | Waiting requires a plain-language reason; Completed and No longer needed require explicit user action |
| AI job | Starting, Working, Partly ready, Ready, Could not finish | Partial output remains usable; retry resumes the failed stage without duplicating completed work |
| Resource result | Finding services, Matches found, No matches, Needs verification, Unavailable | Resource failure never makes the rest of the plan disappear |
| Paperwork | Not started, Needs review, Ready to download, Out of date | Any source-plan change marks only affected mappings Out of date |

#### Autosave and interruption

- Save field changes after a short idle period and on field blur; show quiet **Saving…**, **Saved**, or **Not saved** text near the working area.
- Keep the latest typed value in the browser until the server confirms it, so a recoverable request failure does not clear the field.
- If autosave fails, keep editing available, show **We couldn't save this yet**, and offer **Try again**. Do not replace the page with an error screen.
- If the session expires, preserve local edits, ask the user to sign in again, and restore them after successful authentication.
- If another session changed the same reviewed field, do not silently overwrite either value. Show the saved version and the current edit, then let the user choose.
- Every create, generation, retry, and download request uses an idempotency key or equivalent server-side duplicate protection.

#### Loading and long-running work

- Show the existing saved content immediately, then load secondary content such as resources and provenance independently.
- Use skeletons only when their shape matches the content. Prefer specific messages such as **Finding services** over a generic spinner.
- After 10 seconds, tell the user they may leave and CaseLink will continue. Do not show an estimated completion time unless it is based on measured job state.
- After 30 seconds, keep the job running and expose **Keep working elsewhere** plus a retry or support path if the job stops making progress.
- Refresh and navigation reconnect to the existing job rather than starting a new one.

#### Error and empty-state behavior

| Situation | Message intent | Recovery action |
| --- | --- | --- |
| No families | Explain that families will appear here after the first case is added | Add your first family |
| No plan yet | Explain the minimum context needed and what the draft will do | Review context |
| No resource matches | State that no verified match was found for the current filters—not that no help exists | Adjust details, Search all resources, or Add a resource |
| Resource service unavailable | Keep the action plan visible and say service matching can be retried separately | Retry resources |
| Plan generation partially fails | Keep validated actions and identify which portion is unfinished | Continue draft |
| Plan generation fully fails | Preserve context and explain that no draft was saved | Try again |
| Permission denied | Explain that the account cannot view or change this family and who to contact | Back to families |
| Family or plan not found | Avoid implying data loss; the item may have moved or access may have changed | Back to families |
| Offline | Keep confirmed saved content readable and clearly mark edits waiting to save | Retry when connected |
| PDF cannot be read | Preserve the upload and explain whether a clean, unlocked PDF is needed | Choose another PDF |
| PDF mapping fails | Preserve all reviewed mappings and isolate the failed field or render stage | Retry preparation or Download review copy |

Messages must say what happened, what was preserved, and what the user can do next. Do not expose stack traces, provider names, request IDs, status codes, or “contact your administrator” unless a real administrator action is required.

#### Safe changes and deletion

- AI suggestions never overwrite reviewed text without a visible before/after review.
- Rejecting an AI suggestion requires no confirmation; the user can undo it.
- Removing a family, plan, completed action, uploaded form, or reviewed paperwork draft requires a confirmation that names the exact item and explains the consequence.
- Prefer recoverable archive states over permanent deletion. Permanent deletion behavior belongs to the approved retention policy.
- Cancel closes a dialog without applying changes. Back returns to the prior workflow step without discarding saved work.

---

## 8. Resource intelligence requirements

### 8.1 Resource record

The directory should evolve toward an Open Referral-compatible model. A resource may include:

- organization and program names;
- service description and service taxonomy;
- physical, virtual, and phone locations;
- service area;
- contact channels and application URL;
- hours and schedule exceptions;
- languages and accessibility information;
- cost information;
- required documents;
- eligibility text, clearly marked as informational rather than a determination;
- referral or intake method;
- source URL or source organization;
- last imported, last checked, and checked-by metadata;
- active, temporarily unavailable, closed, or unknown state.

### 8.2 Matching pipeline

Matching should combine transparent stages:

1. **Hard filters** — active status, service area, delivery method, known age/household constraints, language/accessibility needs when provided.
2. **Need-to-service retrieval** — deterministic taxonomy/category matching plus semantic retrieval over approved resource descriptions.
3. **Fit ranking** — reason about stated barriers, goals, constraints, timing, and prior outcomes.
4. **Grounded explanation** — explain why the program may fit using only fields in the resource record.
5. **Diversity and fallback check** — avoid ten near-identical results; include credible alternatives when available.

The model never creates a missing resource fact. Missing facts stay missing.

### 8.3 Resource card

Every recommended resource shows:

- what it provides;
- why it may fit this family;
- what the case manager should verify;
- how to contact or apply;
- known service area, hours, documents, and eligibility information;
- source and last-checked date;
- an uncertainty or stale-data label when appropriate;
- actions: Link to plan, Use alternative, Report a problem.

### 8.4 Failure states

- **Directory unavailable:** “The plan is ready, but service matching is temporarily unavailable.” Offer Retry resources; do not show a blank card.
- **No matches:** explain which known constraints were applied and allow the case manager to broaden the search or add a resource manually.
- **Stale results only:** show them as leads to verify, never as confirmed availability.
- **Partial records:** make missing phone, hours, eligibility, or application information explicit.
- **Matching still running:** show real progress independently of plan drafting.

### 8.5 Feedback loop

Capture structured outcomes without blaming the case manager or family:

- reached / no response;
- intake scheduled;
- temporarily unavailable;
- not eligible, reason unknown or case-manager-entered;
- incorrect contact information;
- program closed;
- family chose not to pursue;
- alternative selected.

This data improves directory quality and future ranking. It must not automatically train a model or alter global ranking without a documented review process.

---

## 9. AI and system architecture

### 9.1 Principle: a pipeline, not a single prompt

The system should use the simplest reliable method for each stage:

1. **Context compiler — deterministic.** Assemble only approved family context, barriers, goals, strengths, constraints, prior actions, and case-manager notes.
2. **Missing-information check — fast model or rules.** Return zero to three high-value questions and a reason for each.
3. **Resource retrieval — database/search.** Run independently and in parallel; return factual structured records.
4. **Plan architect — reasoning model.** Produce goals, priorities, dependencies, owners, timing, and action structure using the context and retrieved records.
5. **Plan validator — schema plus deterministic checks.** Reject duplicate actions, impossible dates, unsupported resource facts, missing owners, missing next actions, and conflicting dependencies.
6. **Quality reviewer — model plus rules.** Score actionability, grounding, family voice, readability, resource coverage, and safety. Repair only failing fields.
7. **Presenter — application code.** Render structured records; do not ask a model to generate the UI's hierarchy.

### 9.2 Structured plan schema

The durable plan should separate goals, actions, tasks, resources, and evidence.

```text
Plan
├── objective
├── family_stated_goals[]
├── goals[]
│   ├── contributing_factor_ids[]
│   ├── statement
│   ├── expected_result
│   └── progress_summary
├── assumptions_or_unknowns[]
├── review_state
└── actions[]
    ├── goal_id
    ├── title
    ├── rationale
    ├── owner
    ├── priority
    ├── status
    ├── target_date
    ├── target_date_source
    ├── target_date_review_state
    ├── dependencies[]
    ├── tasks[]
    ├── required_documents[]
    ├── linked_resources[]
    ├── expected_result
    ├── progress_signal
    ├── blockers[]
    ├── fallback_actions[]
    ├── provenance[]
    └── human_edit_state
```

Required semantic checks:

- one primary objective per action;
- a concrete next task for every open action;
- a named owner or Shared;
- a goal association and exact target date for every reviewed open action;
- no circular dependencies;
- no duplicate actions with the same intent and outcome;
- no resource fact without a resource-record field or approved external source;
- no guaranteed outcome language;
- no invented deadline, eligibility determination, or family preference;
- AI-proposed target dates remain Suggested until confirmed or edited by the case manager;
- a target date cannot be described as a guaranteed completion or outcome date.

### 9.3 Model routing

Do not choose one model for every task.

- Use a low-latency model for context classification, clarification, extraction, short scripts, and narrowly scoped rewrites.
- Use a stronger reasoning model for the initial plan architecture and complex replanning.
- Use deterministic code for dates, filtering, deduplication where rules are sufficient, permission checks, and rendering.
- Select model and reasoning settings through CaseLink eval results, not model reputation alone.
- Maintain a fallback model or rules path only when its output meets a clearly lower but still safe product standard. Never silently substitute generic steps and label them equivalent.

Current OpenAI guidance should inform the first benchmark matrix, but model names must remain configuration rather than product requirements.

### 9.4 Latency strategy

The current three-phase sequential flow should be replaced.

- Generate one compact plan outline rather than three independent long sections.
- Run resource retrieval and context checks concurrently.
- Stream validated action objects or complete sections as they become available.
- Generate compact fields; create scripts and deep guidance on demand.
- Keep static instructions before variable family context to benefit from prompt caching where eligible.
- Avoid resending long prior outputs; send structured plan state and the smallest relevant patch context.
- Retry only the invalid or failed stage, not the whole workflow.
- Persist each validated stage so refreshes resume rather than restart.
- Log user-perceived and server-side timing separately.

### 9.5 Observability

For every run, capture privacy-preserving metadata:

- request and plan version IDs;
- pipeline stage and stage duration;
- model and reasoning configuration;
- input/output token counts and cache metrics;
- schema validation and repair counts;
- resource candidate/match counts;
- failure category;
- time to first useful action;
- time to complete draft;
- number of accepted, edited, and rejected actions.

Do not put raw family context or model prompts into routine analytics logs.

---

## 10. Performance requirements

These are product targets to validate in a pilot, not public promises.

| Measure | Target |
| --- | --- |
| Interaction acknowledgment | Visible response within 100 ms |
| Server accepts generation job | p95 within 1 second, excluding network loss |
| First real progress state | p95 within 2 seconds |
| First useful action visible | p75 ≤ 5 seconds; p95 ≤ 10 seconds |
| Complete initial draft | p75 ≤ 15 seconds; p95 ≤ 30 seconds |
| Resource state visible | At the same time as the first action or an explicit “still matching” state |
| Step-level rewrite | p75 ≤ 6 seconds |
| Resume after refresh | Existing progress restored without starting a second generation |
| Silent resource failure | 0% |

Performance acceptance requires at least 50 representative de-identified test cases across simple, typical, multi-barrier, sparse-context, and resource-poor scenarios.

---

## 11. Safety, privacy, and trust requirements

### Human authority

- AI output remains Draft until reviewed.
- The case manager is shown as the decision-maker and editor.
- The system records which fields came from a person, a resource record, deterministic logic, or AI.
- Consequential changes require explicit review before paperwork preparation.

### High-risk content

- The system must not determine abuse, neglect, suicidality, medical urgency, legal status, or program eligibility.
- If user-entered context contains a configured crisis indicator, CaseLink displays the district's approved protocol and tells the case manager to follow it. The generative model does not invent crisis instructions.
- Legal, clinical, and benefits information is labeled as general guidance unless it comes from a cited, approved source.

### Family voice and bias

- Preserve the family's stated goals and preferences verbatim where appropriate.
- Do not infer motivation, compliance, credibility, parenting quality, immigration status, disability, diagnosis, or protected characteristics.
- Avoid deficit-only framing; include stated strengths and existing supports.
- Evaluate outputs across varied family structures, languages, barrier combinations, and resource availability.

### Privacy

- Continue using de-identified case labels in the MVP.
- Do not provide name, student ID, date-of-birth, address, phone, email, or signature fields while the no-PII policy is active.
- Give a concrete case-label example such as “Family 104” and say “Do not use a student or family member's name.”
- Scan case labels, free text, uploads, and provider-bound content for likely identifiers. Flag the exact text in place, preserve the rest of the user's work, and require removal before saving disallowed content or sending it to an AI provider.
- Treat automated identifier detection as a usability safeguard, not proof of de-identification. Pilot procedures, training, access controls, and data review remain necessary.
- Define retention, deletion, encryption, audit, incident response, vendor terms, district control, and model-data handling before any pilot involving education-record PII.
- Do not use production case content for model training or prompt optimization without explicit authorization and a documented de-identification process.

### Resource trust

- Never state that a family is eligible unless a qualified person or authoritative system has confirmed it.
- Never state that a program is open, available, or accepting referrals unless the source supports that claim and its freshness policy allows the label.
- Show source and freshness for important resource facts.
- Provide a direct way to report bad data.

---

## 12. Accessibility and content requirements

- Meet WCAG 2.2 AA for the complete flow.
- Support full keyboard operation, visible focus, semantic headings, and screen-reader announcements for real generation progress.
- Move focus to the heading or first invalid field after navigation, dialog completion, validation, and recoverable errors; never drop focus to the document body.
- Associate every instruction and error with its field, summarize submission errors at the top, and preserve all valid entries.
- Use controls at least 24 by 24 CSS pixels and provide a larger 44-pixel target for primary actions on narrow screens.
- Use at least 16-pixel text for inputs on narrow screens; support browser zoom and text resizing to 200% without clipped controls or lost actions.
- Do not require hover, drag-and-drop, fine pointer control, or timed interaction. Reordering always has keyboard-accessible Move up and Move down alternatives.
- Announce job-stage changes politely without repeatedly interrupting screen-reader speech; announce terminal success and errors assertively once.
- Do not use color as the only indicator of priority, status, freshness, or review state.
- The main next action must be visible before supporting explanation.
- Use sentence-case labels and familiar terms. Avoid “horizon,” “artifact,” “confidence score,” “agent,” and technical AI language in the case-manager UI.
- Name buttons for their result: **Draft plan**, **Save changes**, **Retry resources**, and **Download completed PDF**. Avoid vague labels such as Continue when the destination is not already obvious.
- Prefer numbered tasks for ordered work and bullets for documents, blockers, and alternatives.
- Keep one idea per sentence and one purpose per card.
- Collapse optional explanation; never hide warnings, blockers, sources, or missing information.
- Mobile layouts must preserve the same task order, though the primary design target is a school-issued laptop.
- Allow long labels, resource names, and user-entered text to wrap without hiding the next action; design controls for at least 30% text expansion.
- Format dates and times with the user's locale and time zone while storing unambiguous timestamps. Never rely on numeric-only dates where month/day order could be misunderstood.
- All loading, empty, partial, error, stale-data, and success states need plain-language recovery instructions.

Content review should target plain language understandable on first reading, while preserving terms case managers are required to use. A user test—not an automated reading score alone—decides whether labels and instructions are clear.

Use this vocabulary consistently:

| Internal or technical term | Case-manager language |
| --- | --- |
| Generation job | Drafting your plan |
| Context compiler | Family context |
| Resource retrieval/matching | Finding services |
| Provenance | Source |
| Model output | Suggested draft |
| Patch or regeneration | Proposed changes |
| Schema validation failure | We couldn't finish this part |
| Version conflict | Newer changes were saved elsewhere |
| Terminal state | Finished or Could not finish |
| Artifact/export | Plan summary or Completed PDF |

---

## 13. Success metrics

### North-star product metric

**Median case-manager time from completed context to a reviewed, paperwork-ready plan.**

This measures the workflow CaseLink can reasonably influence. It does not claim that CaseLink caused a family outcome.

### Adoption and workflow measures

- percent of generated plans that reach Reviewed;
- median time to first useful action and complete draft;
- median time from draft to Reviewed;
- percent of actions accepted unchanged, edited, rejected, or added manually;
- step-level replan rate versus whole-plan regeneration rate;
- percent of reviewed plans used in paperwork preparation;
- case-manager weekly return rate during a pilot.

### Plan-quality measures

- actionability: every open action has a specific next task;
- grounding: important claims trace to approved context or resource data;
- completeness: owner, timing, expected result, and progress signal present;
- non-duplication;
- family-goal coverage;
- resource precision as rated by case managers;
- unsupported resource fact rate;
- unsafe or overconfident recommendation rate;
- reading-effort score and task-comprehension test results.

### Resource-quality measures

- percent of recommended resources with source and last-checked metadata;
- stale-resource rate;
- incorrect phone/link/hours report rate;
- no-match rate by barrier and service area;
- contacted, reached, intake-scheduled, unavailable, and not-eligible outcomes;
- time from reported bad data to review.

### User-reported measures

After meaningful use, ask no more than three short questions:

- “Did this plan help you decide what to do next?”
- “How much editing did it need before it was usable?”
- “Were the resource suggestions worth contacting?”

### Usability release measures

Before a broad pilot, observe at least five representative case managers completing a prepared de-identified scenario without coaching. Measure from the product UI rather than a facilitator's explanation.

| Measure | Pilot target |
| --- | --- |
| Start first family after sign-in | Median ≤ 60 seconds |
| Resume the correct unfinished case | At least 90% succeed on first attempt within 20 seconds |
| Reach Draft plan from prepared scenario notes | At least 80% succeed without assistance |
| Identify the top next action | At least 90% answer correctly after viewing the plan for 15 seconds |
| Recover from a forced resource failure | At least 80% continue the plan without assistance |
| Understand whether a downloaded form was submitted | 100% correctly answer “No” |
| Critical usability errors causing lost work or wrong-family action | 0 |

Record where participants hesitate, backtrack, request help, or misunderstand state. A faster task time does not compensate for incorrect context, lost edits, or false confidence.

---

## 14. Evaluation program

### Expert-reviewed evaluation set

Build a versioned set of de-identified planning scenarios with case-manager-authored reference criteria. Start with 50–100 cases covering:

- one straightforward barrier;
- multiple interacting barriers;
- urgent deadlines;
- sparse or ambiguous context;
- already-completed work;
- unavailable or stale resources;
- transportation, language, schedule, and accessibility constraints;
- cases where the correct behavior is to ask a question;
- cases where the correct behavior is not to recommend a program;
- adversarial or irrelevant input.

Do not require one “perfect plan.” Label required facts, prohibited claims, acceptable action families, essential dependencies, and resource-grounding rules.

### Rubric

Score each output on:

1. safety and scope;
2. factual grounding;
3. priority and sequencing;
4. actionability;
5. personalization to provided context;
6. family voice and strengths;
7. resource fit and provenance;
8. readability;
9. completeness without bloat;
10. preservation of human edits during replanning.

Safety, fabricated resource data, and loss of human edits are release blockers, not averageable quality dimensions.

### Release gate

A model, prompt, retrieval change, or schema change cannot ship solely because examples look better. It must:

- pass deterministic contract tests;
- meet the safety and grounding floor;
- avoid regression on representative eval cases;
- meet the latency budget for its route;
- be reviewed on at least a small blind sample by practicing case managers before broad rollout.

---

## 15. Production implementation contract

This section translates the product experience into implementation boundaries. It defines required behavior without prescribing a specific component tree or endpoint naming scheme.

### 15.1 Prioritized user stories

| ID | Release band | Story | Completion evidence |
| --- | --- | --- | --- |
| CW-01 | Core | As a case manager, I can add a family using a non-identifying label and minimum context so I can start without completing a long intake. | Family is saved, appears in Families, and can be reopened after refresh |
| CW-02 | Core | As a returning case manager, I can see the next useful step for every family so I can resume without reconstructing my work. | Each row has exactly one correct next-step label derived from durable state |
| CW-03 | Core | As a case manager, I can review the exact context that will be used before drafting so incorrect assumptions do not enter the plan. | Context summary contains only saved human-provided or human-approved information |
| CW-04 | Core | As a case manager, I can start a plan and leave the page while it runs so waiting does not block other work. | One durable job resumes after navigation or refresh and cannot be duplicated by repeat clicks |
| CW-05 | Core | As a case manager, I can use validated actions even if resources or later plan stages fail. | Partial success renders with a specific recovery action; validated work is retained |
| CW-06 | Core | As a case manager, I can accept, edit, reject, add, and reorder actions before marking the plan Reviewed. | Each decision persists with author, timestamp, source, and plan version |
| CW-07 | Core | As a case manager, I can update an action after outreach without regenerating the whole plan. | Status, outcome, note, and follow-up date save independently |
| CW-08 | Next | As a case manager, I can find a credible resource and see what I still need to verify before contacting it. | Resource facts show provenance/freshness and never contain model-invented operational data |
| CW-09 | Next | As a case manager, I can request a focused rewrite or fallback without losing my edits. | Proposed patch is scoped, diffed, and applied only after review |
| CW-10 | Core | As a case manager, I can upload a clean blank PDF and have CaseLink propose mappings from reviewed plan content without retyping it. | Detected and proposed fields remain editable, uncertain fields require attention, and the original blank is preserved |
| CW-11 | Core | As a case manager, I can review and download the prepared form knowing it has not been submitted anywhere. | Every mapped value has a source and review state; download completes and handoff copy explicitly states manual upload remains |
| CW-12 | Later | As a supervisor, I can review a plan and leave guidance within my permission scope. | Supervisor capability ships only after role and district-review discovery |

Core is the smallest production slice and includes the complete family → dated plan → reviewed paperwork → download workflow. The first release may support a bounded set of PDF structures and one validated school template, but it must include the agentic upload-and-review path rather than treating paperwork as a future add-on. Next deepens resource intelligence and focused replanning. Later is not authorized for implementation by this PRD.

### 15.2 Durable records

The implementation may use normalized tables or versioned structured documents, but it must represent these concepts independently:

| Record | Minimum durable fields |
| --- | --- |
| Family case | ID, organization/owner scope, non-identifying label, workflow state, created/updated timestamps, archived state |
| Context item | Type, value, provenance, human-review state, created/updated author, sensitivity flag |
| Barrier or contributing factor | Taxonomy ID or Other text, source, selected state, notes, review state |
| Plan version | ID, family ID, schema version, objective, review state, parent version, created by, timestamps |
| Action | ID, plan version, goal ID, title, owner, priority, status, next task, target date, date source/review state, expected result, order, human-edit state |
| Action detail | Tasks, documents, dependencies, blockers, fallbacks, progress signal, outcome note, provenance |
| Resource link | Action ID, resource-record version, match reason, verification state, case-manager disposition |
| Generation job | ID, family/plan scope, job type, idempotency key, stage, status, progress timestamps, safe error category, result version |
| Paperwork template | Template ID/version, district scope, source-file fingerprint, field map, required review rules, active state |
| Paperwork draft | ID, plan version, template version, mapping values, source references, review states, final edits, out-of-date fields |
| Audit event | Actor, action, object/version, timestamp, privacy-safe change metadata |

Required invariants:

- all family-scoped reads and writes enforce authenticated organization/user access on the server and in database policies;
- records are never joined or selected by a user-supplied organization ID without authorization checks;
- reviewed plan versions are immutable snapshots; later work creates a new version or explicit patch history;
- human-edited fields retain ownership and cannot be silently replaced by later model output;
- deleting or archiving a family cannot orphan an active generation job or downloadable paperwork draft;
- action ordering is deterministic and stable across refreshes;
- resource operational facts always reference a stored resource-record version;
- paperwork drafts pin both the plan version and template version that produced them;
- no production record requires a real student or family name while the no-PII policy is active.

### 15.3 Mutation and background-job contract

All state-changing operations must:

- validate input on the server with a versioned schema;
- enforce authentication, authorization, and record ownership before work begins;
- accept an idempotency key or otherwise prevent duplicate effects;
- return the updated record version and a typed, safe error category;
- use optimistic concurrency for reviewed content so stale tabs cannot overwrite newer work;
- preserve the user's submitted value when validation or a recoverable network request fails;
- write an audit event for review-state, source, owner, progress, and paperwork changes.

Plan generation, resource matching, scoped replanning, and PDF preparation are durable jobs rather than browser-owned requests. A job must:

1. persist before model or file processing begins;
2. expose a real stage and last-progress timestamp;
3. persist every validated partial result;
4. resume or retry from the smallest safe stage;
5. ignore or return the existing result for duplicate starts;
6. stop applying results if its source plan/context version is obsolete;
7. expose only safe user-facing failure categories while retaining diagnostic correlation in protected logs;
8. reach a terminal Ready, Partly ready, Could not finish, Cancelled, or Superseded state.

The client may receive updates through streaming, server-sent events, polling, or a platform-equivalent mechanism. The product requirement is resumable state, not a particular transport.

### 15.4 Analytics and privacy contract

Required events include family workflow step viewed, generation started/stage completed/finished, first action visible, review decision, action outcome, resource disposition, paperwork review completed, and PDF downloaded. Events include opaque record/version IDs, durations, state transitions, and error categories.

Analytics must not include raw family narrative, copied notes, generated plan prose, form values, resource-search free text that may identify a person, filenames supplied by the user, or signed download URLs. Product analytics and protected diagnostic logs require separate schemas and access rules.

### 15.5 Required test matrix

| Layer | Required coverage before Core release |
| --- | --- |
| Unit | Workflow-state derivation, goal/action ordering, required target dates, schema validation, provenance rules, date handling, field-map rules, stale-version rejection, no-PII checks |
| Database | Row-level access, cross-organization denial, immutable reviewed versions, template/version pinning, paperwork out-of-date behavior, archive behavior |
| Integration | Create/resume family, autosave recovery, durable job lifecycle, partial generation, resource failure isolation, protected human edits, PDF inspection/mapping/rendering |
| End to end | First-use happy path through downloaded PDF, returning-user resume, refresh during generation, expired session with unsaved text, review and action update |
| Accessibility | Keyboard-only critical path, focus restoration, semantic headings, live progress announcements, error association, 200% zoom, contrast |
| Adversarial input | Empty and very long text, special characters, duplicate clicks, outdated tab, malformed model output, unsupported/encrypted/rotated/scanned PDF, oversized allowed upload |
| AI evaluation | Safety, grounding, actionability, reading effort, family voice, resource-fact precision, edit preservation, latency |
| Visual regression | Families empty/list states, context form, dated goal plan, partial plan, review mode, PDF field review/render, each error state, laptop and narrow viewport |

Test fixtures must be synthetic and de-identified. At minimum, UI fixtures cover zero, one, ten, and one hundred families; one and many barriers; missing and 2,000-character optional descriptions; long resource names; every job terminal state; and fillable, scanned, rotated, multi-page, partially detected, unsupported, and password-protected blank PDFs. Paperwork tests must compare both extracted values and rendered page placement so a technically populated but visually unusable PDF cannot pass.

### 15.6 Definition of done

A story is not complete until:

- its success, loading, empty, partial, error, permission, and retry states are implemented where applicable;
- user-entered work survives refresh and recoverable failure;
- copy uses the approved plain-language vocabulary;
- keyboard and screen-reader behavior is verified, not inferred from component choice;
- server authorization, validation, idempotency, and audit behavior are tested;
- product analytics measure the intended outcome without storing case content;
- no public or in-product copy promises integration, automatic submission, eligibility, availability, or family outcomes;
- relevant unit, integration, end-to-end, accessibility, and eval gates pass in CI;
- a nontechnical reviewer can complete the story from the UI without developer instructions.

---

## 16. Delivery plan

### Phase 0 — Stabilize the current core

**Goal:** Make the existing product honest, observable, and recoverable before expanding capability.

Requirements:

- expose resource-matching errors and retry controls;
- ensure matching runs before or concurrently with planning;
- instrument end-to-end latency and time to first useful content;
- replace blank resources with loading, no-match, partial, and error states;
- condense the existing step cards around next action, owner, timing, result, and linked resource;
- protect manual edits on refinement;
- create the first 25-case internal eval set.

Exit criteria:

- no silent resource failure;
- resource records used by the model are visible in the UI;
- baseline latency and plan-quality metrics exist;
- current high-risk failure modes have automated tests.

### Phase 1 — Structured, dated service plan

**Goal:** Replace fixed 30/60/90 output with a goal-based working plan whose actions have reviewed target dates.

Requirements:

- new goal and action schema with owners, exact target dates, dependencies, progress signals, and provenance;
- goal sections with chronologically ordered actions and a compact Next due summary;
- zero-to-three clarification flow;
- streamed or progressively persisted draft;
- guided review including confirmation or editing of every proposed target date;
- selective replanning with a change summary;
- compatibility formatters for existing 30/60/90 outputs and factor-based service-plan forms during migration.

Exit criteria:

- a case manager can draft, review, execute, and update a dated plan without reading or regenerating a long document;
- every reviewed open action belongs to a goal and has an exact target date;
- existing approved plans remain readable and exportable;
- the plan meets the latency and eval floors.

### Phase 2 — Agentic paperwork handoff

**Goal:** Make blank-form upload, agent-assisted mapping, human review, and PDF download part of the Core product.

Requirements:

- clean blank PDF upload with no-PII guidance;
- native-field and scanned-layout inspection;
- agentic detection of labels, controls, writing regions, tables, and repeated sections;
- field-level provenance from plan to PDF;
- attention state for uncertain or missing fields;
- revalidation warning when the plan changes after paperwork preparation;
- district/form-specific formatting separated from the operational plan model;
- a versioned field map for each supported form, including source field, transformation, destination, required review, and blank-field behavior;
- a reviewed template-authoring path for known scanned forms using fixed field coordinates;
- a bounded agentic mapping path for previously unseen forms with manual completion when confidence is insufficient;
- OCR limited to assisting label and layout discovery, never final approval;
- explicit mapping for contributing factor, goal, case-worker objectives, client objectives, progress status, and date for the first observed school form;
- identity and signature fields left blank while CaseLink remains de-identified, with signatures always completed outside AI generation;
- automated tests over fillable, scanned, rotated, multi-page, partially detected, unsupported, and password-protected PDFs;
- end-to-end measurement of time saved.

Exit criteria:

- a case manager can move from reviewed plan to reviewed PDF without retyping approved content;
- the first factor-based form mapping can be previewed and reviewed without implying that the supplied annotated scan is a production template;
- an unseen but supported blank PDF either produces a reviewable mapping or a specific, recoverable manual-mapping state;
- no form field implies automatic submission;
- all generated entries remain editable and traceable;
- rendered placement and extracted-value tests pass for the supported PDF fixture set.

### Phase 3 — Trusted resource layer

**Goal:** Make resource guidance a defensible product capability.

Requirements:

- Open Referral-compatible data model or import adapter;
- provenance and freshness states;
- service-area, schedule, language, accessibility, document, and eligibility-text support;
- deterministic filters plus semantic retrieval and grounded ranking;
- structured outcome feedback and data-quality review queue;
- manual search and selection remain available.

Exit criteria:

- every recommended program traces to a visible approved record;
- stale and incomplete records are labeled;
- resource usefulness and incorrect-data rates are measurable;
- the product can operate in a new district without code-level category rewrites.

### Phase 4 — Pilot learning and governance

**Goal:** Prove usefulness before broader automation.

Requirements:

- observe at least 5–8 case managers using real de-identified scenarios;
- interview supervisors and district technology/privacy stakeholders;
- collect representative blank forms and current plan examples with authorization;
- establish model, resource, incident, and data-quality review ownership;
- decide whether identifiable data is necessary and, only then, open the separate governance gate.

Exit criteria:

- the north-star workflow metric improves against the documented baseline;
- case managers report that the plan helps decide and complete next actions;
- critical safety, grounding, and privacy issues have owners and response procedures;
- evidence supports the next product expansion.

---

## 17. Detailed acceptance criteria for the first production slice

The first production slice includes Phases 0–2 and every Core story in Section 15. Paperwork is part of the release gate. The criteria below are cumulative; all must pass.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| AC-01 | A first-time invited case manager with no families | They sign in | Families shows one explanation, one Add your first family action, and no required setup or dashboard |
| AC-02 | A valid non-identifying case label and one or more selected barriers, with no description | They add a family and refresh | One family exists, all selected barriers remain, and the next step is Draft plan |
| AC-03 | A likely identifying value while the no-PII policy is active | They attempt to save or send it for AI processing | The exact likely identifier is flagged in place, other work remains, saving/provider processing is blocked, and no disallowed value is persisted or transmitted |
| AC-04 | An existing unfinished family | They return to Families | The correct next-step label is visible and opens the exact valid workflow state in one click |
| AC-05 | Sufficient saved context | They open the planning context | The summary contains only saved human-provided or human-approved information and can be corrected before drafting |
| AC-06 | Consequential information is missing | They continue toward drafting | Zero to three plain-language questions appear, each allows Not sure or Skip for now, and answers save as case-manager context |
| AC-07 | A case manager starts drafting and rapidly activates the button repeatedly | The server receives the requests | Exactly one durable generation job and one draft result exist |
| AC-08 | A generation job is running | They refresh, close, or navigate away and later return | The same job and validated partial results resume without starting over |
| AC-09 | Resource matching fails while planning succeeds | The first actions validate | The actions remain visible, resources show a specific retry state, and no blank panel or whole-page error replaces the plan |
| AC-10 | A partially valid generation result | A later stage cannot finish | Validated actions persist, the plan is Partly ready, and Continue draft retries only unfinished work |
| AC-11 | A complete draft | The plan first renders | Actions are grouped by goal and ordered by exact target date; every open action has a title, next task, owner, target date, expected result, and status |
| AC-12 | A draft plan | The case manager edits, rejects, reorders, adds, and reviews actions | Every decision persists with actor and version; the plan becomes Reviewed only after the explicit Finish review action |
| AC-13 | Reviewed text owned by the case manager | They request a focused AI change | A before/after patch appears and no reviewed value changes until they apply it |
| AC-14 | A reviewed action | The case manager records Started, Waiting, Completed, or No longer needed | The selected action updates without whole-plan regeneration; Waiting retains a next follow-up date and dependent changes remain proposed until reviewed |
| AC-15 | An expired session during an unsaved edit | The case manager signs in again | The local edit is restored and can be saved without retyping |
| AC-16 | Two tabs edit the same reviewed field | The older tab attempts to save | Neither value is silently overwritten; the user receives a comparison and resolution choice |
| AC-17 | A keyboard or screen-reader user | They complete the Core critical path | Every operation is reachable, focus is managed, progress is announced, and errors are associated with their controls |
| AC-18 | Production analytics enabled | The workflow completes or fails | Required timing/state events exist without raw case narrative, plan prose, form values, or identifying filenames |
| AC-19 | An authenticated user outside the family record's permitted scope | They request it by URL or mutation | The server and database deny access without revealing whether the record exists |
| AC-20 | The release candidate | CI and the evaluation suite run | Contract tests pass, safety/grounding blockers are zero, latency targets are met, and representative case-manager review is recorded |
| AC-21 | A clean supported fillable or scanned PDF | The case manager uploads it | CaseLink preserves the original, detects its structure, and produces proposed fields or a specific manual-mapping state |
| AC-22 | A proposed paperwork mapping | The case manager reviews it | Every value shows its source and review state and can be accepted, edited, rejected, or left blank |
| AC-23 | A form field with missing or ambiguous source data | Agentic mapping runs | The field remains blank or Needs attention; the agent does not invent a value |
| AC-24 | Reviewed paperwork with no unresolved required fields | The case manager downloads it | The resulting PDF contains the reviewed values in usable visual positions and the UI states that no external submission occurred |
| AC-25 | A source plan changes after paperwork preparation | The case manager reopens the draft | Only affected mapped fields are Out of date and can be regenerated without losing unrelated manual edits |
| AC-26 | The supported PDF fixture suite | CI prepares and renders every fixture | Expected extracted values, page count, rotation, field placement, failure state, and downloadable-file integrity all pass |

---

## 18. Migration considerations

### Preserve existing work

- Keep existing plans readable.
- Introduce a versioned plan schema rather than rewriting old JSON in place.
- Map legacy 30/60/90 steps to reviewed goals and actions with proposed target dates.
- Preserve original phase as import metadata for export compatibility.
- Keep human edits and status history.

### Separate operational planning from form formatting

The database should no longer use a form-specific timeline or section layout as the core plan ontology. Required paperwork may request 30/60/90 fields, while the first observed school form requests up to three contributing factors with goals, shared objectives, progress, and dates. Both belong in versioned formatting/mapping layers.

For the first school form, legacy phases should migrate into adaptable actions before form mapping. The case manager then chooses the relevant factors and reviews which actions become case-worker or client objectives. Do not reverse-engineer family commitments, progress states, identity fields, or signatures from old narrative text.

### Avoid a big-bang model migration

- Establish evals using the current implementation.
- Benchmark candidate model routes on the same cases.
- change one stage at a time;
- compare quality, latency, and cost;
- keep rollback at the stage/configuration level.

---

## 19. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Plans sound authoritative despite missing context | Clarification gate, assumptions list, provenance, case-manager review |
| Better models produce more prose, not more utility | Compact schema, task-first UI, on-demand detail, reading-effort eval |
| Resource data is stale or incomplete | Source/freshness metadata, visible uncertainty, reporting and review workflow |
| AI invents resource facts | Retrieval-only resource fields, semantic validator, release-blocking groundedness eval |
| Faster model lowers plan quality | Route by task; benchmark latency and rubric together |
| Sequential stages remain slow | Parallel retrieval, compact outline, streaming, partial persistence, scoped retries |
| Replanning overwrites professional judgment | Field ownership, protected edits, diff review, patch-based updates |
| The product drifts into automated decision-making | Explicit non-goals, permission boundaries, human approval, NIST-aligned review |
| Pilot data expands beyond the current privacy posture | Keep de-identified MVP; separate approval gate before PII |
| Fixed form requirements pull the UI toward one form's timeline or headings | Versioned compatibility formatters at export, goal-and-date operational model internally |
| A scanned or outdated form is treated as a production template | Require a clean blank, confirm purpose/version/required fields, and approve a deterministic template map |
| Family responsibilities are inferred from AI-written text | Explicit owner, case-manager confirmation, and blank-by-default client-objective fields |
| Resource feedback encodes bias | Treat outcomes as data-quality signals; require review before global ranking changes |

---

## 20. Open decisions requiring customer discovery

These should not be guessed by engineering:

1. Which information case managers actually have before they write an intervention plan.
2. Which parts of a plan are created with the family and which are internal working notes.
3. Whether owner labels should include Family in the visible case-manager product and how consent/choice should be represented.
4. Is the observed Contributing Factors & Family Service Plan the only required form, what program governs it, when is it completed or updated, and where is it ultimately stored or re-entered?
5. What supervisors must review, and when.
6. Which local resource directory is authoritative for each pilot district.
7. Who is responsible for resource verification and how frequently different fields must be checked.
8. Which urgent situations require district-specific protocol messages.
9. What outcome states case managers already record in required systems.
10. What identifiable information, if any, is truly necessary to achieve the paperwork time saving.
11. Can the school provide a current clean blank form, completion instructions, required-field rules, and examples of acceptable goals and objectives?
12. Who agrees to Client Objectives with the family, and how should CaseLink record that agreement without implying consent?
13. When should Completed, In Progress, and No Progress be recorded, and may one contributing factor contain multiple actions with different statuses?
14. Which fields may be prepared before export under the no-identifiable-information policy, and how are identity fields and signatures completed afterward?
15. Are additional forms or external-system screens part of the same workflow, including any fixed 30/60/90 requirement not present in this form?

---

## 21. Review conclusion

This direction keeps CaseLink's scope narrow while making the core substantially more valuable. It does not broaden the product into a school operating system. It deepens the one workflow already connected to real work:

**understand the family's current context → decide the next responsible actions → find credible support → document progress → prepare required paperwork.**

The most important product change is not adopting a newer model. It is designing a trustworthy system in which current models can do focused reasoning, retrieval, drafting, and replanning while the case manager retains control and the resource facts remain verifiable.

The first implementation priority should therefore be: **make resources and failures visible, measure current latency and quality, replace the 30/60/90 document with a goal-based plan containing reviewed target dates, and complete the Core loop with agentic blank-PDF mapping, human review, and download. The first known school form becomes a validated template once the school supplies a clean blank; supported unseen forms use the bounded agentic mapping path.**
