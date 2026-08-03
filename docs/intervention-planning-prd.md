# CaseLink Adaptive Intervention Planning

## Product requirements document

**Status:** Reviewed product baseline  
**Date:** August 2, 2026  
**Owner:** CaseLink  
**Scope:** The family-context → intervention-plan → resource-guidance experience  
**Primary user:** A school case manager supporting individual families  
**Related product principle:** Perfect the family intake → barriers → intervention plan → paperwork workflow before expanding into broader school operations.

---

## 1. Executive decision

CaseLink should stop treating the intervention plan as a long AI-generated document divided into fixed 30-, 60-, and 90-day sections. The product should become an **adaptive action-planning workspace** that helps a case manager decide what to do next, find credible services, prepare for outreach, record what happened, and update only the affected parts of the plan.

The plan is not the AI's recommendation to a family. It is a **case-manager-reviewed working draft** built from the family's stated goals, strengths, barriers, current circumstances, the case manager's professional judgment, and verified resource data. The first useful view should be a short set of prioritized actions. Supporting details—documents, contacts, scripts, eligibility notes, rationale, and fallbacks—should be available exactly where they are needed without turning every step into a wall of prose.

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

### Secondary user: supervisor

Not in the first implementation scope, but the model must allow a supervisor to review a plan, understand its sources and changes, and leave guidance without taking over the case.

### Family's role

The family is not a direct CaseLink user in V1, but the plan must preserve their stated goals, preferences, constraints, strengths, and choices. The system should never present an AI-generated goal as if the family chose it.

---

## 6. Product principles for this experience

1. **The next action comes first.** Do not make a case manager read a report to discover what to do.
2. **Adaptive time, not arbitrary buckets.** Operational actions use real dates or meaningful windows such as Today, This week, Waiting, and Later. If a required form needs 30/60/90 language, transform the approved plan at export time.
3. **Facts and suggestions look different.** User-provided facts, directory facts, AI inferences, and missing information must be visibly distinguishable.
4. **Ask only high-value questions.** Clarify missing information only when it could materially change safety, priority, eligibility, or the next action.
5. **The plan is shared work.** Reflect family voice and case-manager judgment; avoid commands that imply the family has no choice.
6. **Resources are data, not prose.** The model may explain a verified record's fit. It may not invent a program, phone number, hours, eligibility rule, or application process.
7. **Change the smallest necessary part.** A new fact or failed referral should update affected steps and dependencies, not silently regenerate the entire plan.
8. **Every recommendation must be reviewable.** The case manager can understand why it appears, where its facts came from, and what uncertainty remains.
9. **No silent failure.** Missing resources, partial generation, stale data, and model errors each get an explicit state and recovery action.
10. **Approved plan data becomes paperwork data.** Do not summarize the same case twice with separate, inconsistent AI calls.

---

## 7. Proposed experience

### 7.1 Entry: confirm the planning context

The case manager reaches the plan from a family workspace after recording barriers and optional context.

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

### 7.4 Default plan view: a prioritized action workspace

The default view is not a document. It is a short operational list.

#### Plan header

- one-sentence plan objective;
- family-stated goals represented in the plan;
- plan state: Draft, Reviewed, or Needs attention;
- last updated and who last edited it;
- count of open actions and blocked actions;
- actions: Review plan, Add action, Prepare paperwork.

#### Action groups

- **Do next** — the one to three highest-value actions that can begin now;
- **Upcoming** — actions with a future date or a dependency that is expected to clear;
- **Waiting or blocked** — actions waiting on a callback, document, decision, or other condition;
- **Later** — valid longer-term actions that should not distract from current work;
- **Completed** — collapsed by default.

These are display states derived from priority, dates, dependencies, and status. They are not permanent AI-authored phases.

#### Compact action card

Every action card shows, without expansion:

- a specific action title beginning with a verb;
- who is responsible: Case manager, Family, Program, or Shared;
- target date or meaningful time window;
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

The operational plan remains adaptive while a versioned, form-specific formatter maps actions into whatever time-horizon or section structure the required form expects. The first observed school form uses contributing factors, goals, case-worker objectives, client objectives, progress, and dates—not 30/60/90 phases.

Paperwork preparation must therefore:

- show the destination field beside its proposed source and allow edit, accept, reject, or leave blank;
- treat family/client objectives as explicit commitments that require case-manager confirmation;
- keep identity and signature fields blank and manual under the current no-identifiable-information policy;
- distinguish native fillable fields from scanned forms that require a reviewed template map;
- preserve the final case-manager-edited value separately from the source suggestion;
- never imply that preparing or downloading a form submits it to an external system.

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
├── assumptions_or_unknowns[]
├── review_state
└── actions[]
    ├── title
    ├── rationale
    ├── owner
    ├── priority
    ├── status
    ├── start_after / target_date / time_window
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
- no circular dependencies;
- no duplicate actions with the same intent and outcome;
- no resource fact without a resource-record field or approved external source;
- no guaranteed outcome language;
- no invented deadline, eligibility determination, or family preference;
- exact dates only when supplied, calculated from an approved rule, or confirmed by the case manager.

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
- Block or warn on likely identifiable fields before they are sent to an AI provider until the data-governance gate is approved.
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
- Do not use color as the only indicator of priority, status, freshness, or review state.
- The main next action must be visible before supporting explanation.
- Use sentence-case labels and familiar terms. Avoid “horizon,” “artifact,” “confidence score,” “agent,” and technical AI language in the case-manager UI.
- Prefer numbered tasks for ordered work and bullets for documents, blockers, and alternatives.
- Keep one idea per sentence and one purpose per card.
- Collapse optional explanation; never hide warnings, blockers, sources, or missing information.
- Mobile layouts must preserve the same task order, though the primary design target is a school-issued laptop.
- All loading, empty, partial, error, stale-data, and success states need plain-language recovery instructions.

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

## 15. Delivery plan

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

### Phase 1 — Adaptive action plan

**Goal:** Replace fixed operational phases with a structured, prioritized working plan.

Requirements:

- new action schema with owners, dates/windows, dependencies, progress signals, and provenance;
- Do next, Upcoming, Waiting/blocked, Later, and Completed views;
- zero-to-three clarification flow;
- streamed or progressively persisted draft;
- guided review and approval;
- selective replanning with a change summary;
- compatibility formatters for existing 30/60/90 outputs and factor-based service-plan forms during migration.

Exit criteria:

- a case manager can draft, review, execute, and update a plan without reading or regenerating a long document;
- existing approved plans remain readable and exportable;
- the plan meets the latency and eval floors.

### Phase 2 — Trusted resource layer

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

### Phase 3 — Plan-to-paperwork handoff

**Goal:** Make the reviewed plan the dependable source for required forms.

Requirements:

- field-level provenance from plan to PDF;
- attention state for uncertain or missing fields;
- revalidation warning when the plan changes after paperwork preparation;
- district/form-specific formatting separated from the operational plan model;
- a versioned field map for each supported form, including source field, transformation, destination, required review, and blank-field behavior;
- detection of native fillable PDF fields versus scanned-image forms;
- a reviewed template-authoring path for scanned forms, using a clean blank form and fixed field coordinates rather than an unconstrained generation step;
- OCR limited to assisting label and layout discovery, with a human-approved map before production use;
- explicit mapping for contributing factor, goal, case-worker objectives, client objectives, progress status, and date for the first observed school form;
- identity and signature fields left blank while CaseLink remains de-identified, with signatures always completed outside AI generation;
- end-to-end measurement of time saved.

Exit criteria:

- a case manager can move from reviewed plan to reviewed PDF without retyping approved content;
- the first factor-based form mapping can be previewed and reviewed without implying that the supplied annotated scan is a production template;
- no form field implies automatic submission;
- all generated entries remain editable and traceable.

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

## 16. Detailed acceptance criteria for the first production slice

The first production slice is Phase 0 plus the smallest usable part of Phase 1.

1. A case manager can review the exact context used to create a plan.
2. If critical context is missing, the system asks at most three plain-language questions and allows skipping.
3. Generation shows real progress and produces at least one useful action before the complete draft when technically possible.
4. The first view shows no more than three Do next actions.
5. Every open action has a title, next task, owner, timing, expected result, and status.
6. Supporting details are structured into lists and labeled fields, not one long paragraph.
7. Every named program links to a resource record with source/freshness information or is clearly marked unavailable pending resource completion.
8. Resource-matching failure produces a visible retryable state and does not erase the plan.
9. A case manager can edit, reject, reorder, add, and approve actions.
10. AI refinement preserves human edits and shows a change summary.
11. Completed, blocked, and failed actions can trigger a scoped proposed update.
12. The reviewed plan remains compatible with current PDF export while migration is underway, and its schema can supply the first factor-based form mapping without changing the operational UI into a copy of that form.
13. Keyboard and screen-reader users can complete the full flow.
14. No identifiable data is required or encouraged.
15. Instrumentation records latency and quality events without raw family narrative.
16. The release passes the expert eval safety/grounding floor and representative case-manager review.

---

## 17. Migration considerations

### Preserve existing work

- Keep existing plans readable.
- Introduce a versioned plan schema rather than rewriting old JSON in place.
- Map legacy 30/60/90 steps to actions with derived display groups.
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

## 18. Risks and mitigations

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
| Fixed form requirements pull the UI toward one form's timeline or headings | Versioned compatibility formatters at export, adaptive operational model internally |
| A scanned or outdated form is treated as a production template | Require a clean blank, confirm purpose/version/required fields, and approve a deterministic template map |
| Family responsibilities are inferred from AI-written text | Explicit owner, case-manager confirmation, and blank-by-default client-objective fields |
| Resource feedback encodes bias | Treat outcomes as data-quality signals; require review before global ranking changes |

---

## 19. Open decisions requiring customer discovery

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

## 20. Review conclusion

This direction keeps CaseLink's scope narrow while making the core substantially more valuable. It does not broaden the product into a school operating system. It deepens the one workflow already connected to real work:

**understand the family's current context → decide the next responsible actions → find credible support → document progress → prepare required paperwork.**

The most important product change is not adopting a newer model. It is designing a trustworthy system in which current models can do focused reasoning, retrieval, drafting, and replanning while the case manager retains control and the resource facts remain verifiable.

The first implementation priority should therefore be: **make resources and failures visible, measure the current latency and quality, then replace the 30/60/90 document with an adaptive action plan while preserving compatibility through form-specific exports—including the first factor-based service-plan mapping once the school supplies and validates a clean blank.**
