# CaseLink: From Scattered Case Details to Clear, Time-Bound Plans

**CaseLink** is a case management workspace that helps teams turn family context—barriers, notes, and matched programs—into **structured 30 / 60 / 90-day plans**, trackable work, and optional AI-assisted drafting. It is built for **speed, clarity, and professional judgment**, not for replacing the case manager.

---

## The problem

Case managers juggle fragile timelines, referrals, documentation, and constant context-switching. Information lives in **notes, spreadsheets, email threads, and separate directories**—easy to lose, hard to hand off, expensive to reconstruct for every family.

The cost is not only time. It is **cognitive load**: deciding what matters *this week*, what can wait, and which community resources actually fit the case. When that work is fragmented, plans drift, steps duplicate, and families wait longer for coherent support.

CaseLink exists to **reduce that fragmentation** and make the path from intake to action **visible, editable, and accountable**.

---

## The solution

CaseLink brings **family records**, **resource intelligence**, and **planning** into one application. A case manager captures barriers, goals, household context, and notes in structured forms. The system **matches programs** from an internal directory (deterministic scoring—no opaque “black box” retrieval). When enabled, **OpenAI** turns that context into **phased plans** with concrete steps, checklists, and action items.

Everything downstream is **editable**. Plans are not static PDFs in a folder—they are living records the team can adjust, refine per step, export when needed, and connect to **timelines**, **tasks**, and a **case assistant** that answers in the context of *this* family’s plan.

---

## Key features

- **Phased plans (30 / 60 / 90)** — AI-assisted or rules-based generation; steps, priorities, and client-facing display fields suitable for export.
- **Resource directory & matching** — Searchable programs; scoring-based suggestions; accept, dismiss, or attach matches with activity logged.
- **Editable structured plans** — Update steps, checklists, and action items; per-step refinement without regenerating the whole plan.
- **Timeline & task tracking** — Calendar-oriented views tied to plan work and due dates.
- **Case assistant** — Chat grounded in the family’s barriers, plan, and matches; markdown output with **sanitized links** (only `http`, `https`, `mailto`).
- **Intake & families** — Households, members, goals, barriers, and case notes with **server-side validation**.
- **Dashboard** — Operational view across families and upcoming work.

---

## How it works (high level)

**Input → processing → output**, end to end:

```
Case manager enters barriers, goals, notes, and household context
        ↓
System scores and surfaces relevant programs from the directory
        ↓
(Optional) AI generates phased plan steps + structured fields (JSON schema, validated)
        ↓
Team edits, tracks, and exports; assistant answers using the same scoped context
```

The loop is intentional: **capture → suggest → draft → human edit → track**. AI accelerates drafting; **people retain control** over what ships to the case file.

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
