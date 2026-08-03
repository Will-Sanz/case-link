# CaseLink: Family Support Planning and Paperwork

## Product north star

**CaseLink helps school case managers turn family needs into a structured intervention plan and reviewed, ready-to-submit paperwork.** A case manager creates a family profile, records barriers, generates and edits the plan, uploads a blank required form, reviews the AI-prepared draft, and downloads the completed PDF for their required school system.

The near-term product is deliberately narrow. It is built for **speed, clarity, and professional judgment**, not for replacing case managers or the school's required system of record. Broader school-operations automation remains a future possibility only after this core workflow proves useful.

The staged path from the current application to that north star is documented in the [Product Redesign Plan](docs/product-redesign-plan.md).

The product definition for CaseLink's core AI experience is documented in the [Adaptive Intervention Planning PRD](docs/intervention-planning-prd.md).

---

## The problem

Case managers juggle fragile timelines, referrals, documentation, and constant context-switching. Information lives in **notes, spreadsheets, email threads, and separate directories**—easy to lose, hard to hand off, expensive to reconstruct for every family.

The cost is not only time. It is **cognitive load**: deciding what matters *this week*, what can wait, and which community resources actually fit the case. When that work is fragmented, plans drift, steps duplicate, and families wait longer for coherent support.

CaseLink exists to **reduce that fragmentation** and make the path from intake to action **visible, editable, and accountable**.

---

## The solution

CaseLink brings **family intake**, **barrier assessment**, **intervention planning**, and **paperwork preparation** into one focused workflow. A case manager captures the approved family context and barriers in structured forms. When enabled, **OpenAI** turns that context into a structured plan and helps map reviewed information into an uploaded blank PDF.

Everything downstream is **editable**. Plans and populated form fields remain drafts until a case manager reviews them. CaseLink produces a completed PDF; it does not submit directly to external school systems in the initial scope.

---

## Key features

- **Families** — Create a family support case and reopen it from one simple list.
- **Barrier intake** — Record the needs and context that should shape the intervention.
- **Editable intervention plans** — Generate a structured plan, trace it to approved barriers, and edit it before approval.
- **Paperwork preparation (planned)** — Upload a blank required PDF, map approved information into a draft, review uncertain or missing fields, and download the completed form.
- **Human review** — Plans and forms remain drafts until the case manager approves them.

The repository still contains experimental resource, timeline, task, calendar, and case-assistant capabilities. They are not part of the newly narrowed V1 product promise and should not drive the redesign unless pilot evidence brings them back into scope.

---

## How it works (high level)

**Input → processing → output**, end to end:

```
Case manager creates a family and enters approved context and barriers
        ↓
AI drafts a structured intervention plan
        ↓
Case manager reviews and edits the plan
        ↓
Case manager uploads a blank PDF; CaseLink drafts form entries
        ↓
Case manager reviews, downloads, and manually submits the PDF to the required system
```

The loop is intentional: **capture → draft → human edit → prepare form → human review → download**. AI accelerates drafting; **the case manager controls what becomes official**.

---

## Technical architecture

| Layer | Choice | Why it’s there |
|--------|--------|----------------|
| **Frontend** | Next.js (App Router), React, TypeScript, Tailwind | Server Components where they help; cohesive UI; fast iteration without sacrificing type safety. |
| **Application server** | Next.js server actions, route handlers, Node **proxy** for session refresh | Keeps auth/session handling aligned with the current Supabase + Next stack; avoids fragile Edge + cookie patterns for this product. |
| **Database** | Supabase **Postgres** | Relational model fits families, plans, steps, referrals, and audit-style activity. |
| **Authorization** | **Row Level Security (RLS)** | Every data path uses the **end-user JWT**; policies gate rows (e.g. via `can_access_family`: creator, assignee, or admin). No “trust the client” for tenancy. |
| **Auth** | Supabase Auth | Hosted identity, email flows, and sessions integrated with the same project as the database. |
| **AI** | OpenAI API (**server-only** key) | Structured completions for plans and assistance; models restricted by an **allowlist** at startup. |
| **Hosting** | Vercel (typical) | Fits the Next.js deployment model; environment separation is an operator concern, not assumed in product code paths. |

**Data flow (simplified):** The browser holds a **Supabase anon key** and session; queries and mutations go through PostgREST **as the signed-in user**, so RLS is always in play. Privileged keys (e.g. service role) are **not** part of the web client—they exist only for trusted offline operations like bulk import scripts, not for interactive app traffic.

**Validation:** User input is checked with **Zod** on the server; AI-facing actions use **dedicated schemas** so prompts and payloads stay bounded.

---

## AI integration

OpenAI is used **where structured language generation clearly helps**:

- **Plan phases** — Context includes barriers, case notes, and **matched resources** (so suggestions can name real programs). Responses are expected as **JSON** matching strict shapes, then **validated** (with repair/retry paths where implemented).
- **Step-level refinement** — Adjust one step without throwing away the rest of the plan.
- **Case assistant & step helpers** — Short-form assistance grounded in family-scoped data.

Design principles:

- **Structured prompts and schemas** — Reduce rambling outputs and make downstream UI predictable.
- **Human-in-the-loop** — Outputs are **editable**; the product assumes review before reliance, especially for high-stakes decisions.
- **Support, not substitution** — CaseLink is a **tool for case managers**, not an autonomous agent making decisions for families.

Operational guardrails include **per-user (and optional per-IP) rate limiting**, **payload and output token caps**, and **generic user-facing errors in production** with detail confined to server logs.

---

## Security & privacy approach

- **Secrets stay server-side** — Only public Supabase URL + anon key belong in the browser; OpenAI and service-role credentials never ship to the client.
- **RLS by default** — Shared tables are family-scoped; access is enforced in Postgres, not only in UI checks.
- **Validated inputs** — Server actions and AI entry points reject malformed or oversized input early.
- **Throttled AI** — Rate limits and size caps limit abuse and runaway cost (limits are **per instance** today; strict global caps would need a shared store such as Redis).
- **No ads, no third-party analytics baked into the product narrative** — The app is built for case work, not ad profiles.
- **Sensitive data** — The model assumes **real-world sensitivity**; prompts are scoped to what the case manager already recorded, and operators remain responsible for Auth URLs, redirects, environments, and compliance in their own deployments.

HTTP security headers (e.g. frame options, content-type options, referrer and permissions policies) are set at the framework layer to reduce common browser-level risks.

---

## Design philosophy

The UI targets **usable density**: clear hierarchy, minimal noise, and flows that match how teams actually work—in the spirit of **modern productivity tools** (clean dashboards, structured documents) rather than cluttered “enterprise” forms. The goal is to **get to the next right action** with less hunting and less retyping.

---

## Limitations & future work

- **Account lifecycle** — Full self-service account deletion may not be available in-app; some flows are still evolving.
- **Dependence on third-party AI** — When OpenAI is enabled, content generation relies on vendor availability, policy, and pricing; the stack includes **rules-based** paths where AI is off or fails.
- **Rate limiting** — In-memory limits do not coordinate across multiple server instances; production hardening may require a shared limiter.
- **Resource matching** — Deliberately **not** embedding-based; weights and rules live in code for transparency and predictability, at the cost of semantic “nearest neighbor” search. The repo ships a **small synthetic CSV** for demos; full partner exports stay **local** (see `data/README.md`).
- **Early-stage product** — Scope is described honestly; the codebase is structured for review and iteration, not for claiming completeness.

---

## Legal

- **Privacy Policy:** `/privacy`
- **Terms of Service:** `/terms`
