# Claude Instructions for This Codebase

You are working on a production-grade case management platform focused on helping case managers support families through structured plans (e.g., 30/60/90 day plans), resources, and timelines.

This is NOT a prototype or vibecoded project. All changes should move the product toward a polished, deployable, professional tool.

---

## CORE PRINCIPLES

### 1. Do not break existing functionality
- Always preserve current workflows unless explicitly told to change them
- New features should extend, not replace, existing systems
- If refactoring is needed, do it carefully and incrementally

---

### 2. Reuse existing architecture
Before writing any new code:
- Identify where similar logic already exists
- Reuse existing components, hooks, utilities, API routes, and patterns
- Do not introduce new frameworks or unnecessary abstractions

---

### 3. Think like a senior engineer, not a code generator
- Understand the full flow before making changes:
  - data model
  - backend logic
  - frontend rendering
  - user workflow
- Avoid patchwork fixes
- Prefer clean, maintainable, scalable solutions

---

### 4. Maintain a high UX/UI bar
The product should feel like:
- Notion
- Linear
- Modern SaaS dashboards

NOT:
- cluttered
- overly verbose
- inconsistent
- “AI-generated feeling”

Guidelines:
- clean layouts
- clear hierarchy
- minimal but powerful interactions
- no unnecessary buttons or noise

---

### 5. Prioritize workflow simplicity
The user (case manager) should:
- see everything important quickly
- take action with minimal clicks
- not need to navigate deeply to do basic tasks

Always ask:
> “Does this reduce friction or add friction?”

---

## DATA & SAFETY PRINCIPLES

This app handles sensitive real-world data.

### NEVER:
- Store raw highly sensitive personal data unless explicitly required
- Introduce unnecessary free-text fields for sensitive info
- Expose internal logic or system behavior in user-facing UI

### PREFER:
- Structured, abstracted data (e.g., flags instead of narratives)
- Minimal data storage
- Clear separation between display data and sensitive inputs

---

## AI USAGE GUIDELINES

AI is used to assist, not replace user control.

### When generating or modifying plans:
- Outputs must be:
  - specific
  - actionable
  - non-repetitive
  - logically ordered
- Do NOT produce vague or generic steps
- Do NOT repeat similar steps with slight wording changes

### For step-level edits:
- AI should only modify the specific step
- Do NOT regenerate entire plans
- Preserve context and important constraints

---

## FEATURE IMPLEMENTATION RULES

When implementing new features:

### ALWAYS:
1. Audit the current system first
2. Identify where the feature fits in the existing flow
3. Reuse existing patterns
4. Keep changes minimal but complete
5. Ensure persistence (data actually saves and reloads correctly)

### NEVER:
- Bolt on disconnected features
- Duplicate logic that already exists elsewhere
- Leave partial implementations

---

## PDF / EXPORT FEATURES

When generating exports (PDFs, etc.):
- Output must be professional and client-ready
- No UI artifacts (buttons, nav bars, etc.)
- Proper spacing, typography, and sectioning
- Handle long content gracefully (pagination, wrapping)

---

## EDITING & STATE MANAGEMENT

For any editable content:
- Support:
  - edit
  - save
  - cancel
- Prevent accidental data loss
- Ensure saved data persists across reloads
- Use consistent patterns across the app

---

## PERFORMANCE & CLEANUP

- Remove unused code, components, and dead logic
- Avoid overcomplication
- Keep the codebase clean and readable

---

## OUTPUT FORMAT (VERY IMPORTANT)

When you finish a task, ALWAYS include:

1. Summary of what you changed
2. Files modified
3. Any new files created
4. Any database or schema changes
5. How the feature works (end-to-end)
6. Any follow-up improvements or risks

---

## TONE & APPROACH

- Be decisive
- Do not ask unnecessary questions
- Make reasonable assumptions when needed
- Optimize for speed + correctness + product quality

---

## FINAL CHECK

Before finishing, ask yourself:
- Is this production-ready?
- Is this the simplest clean solution?
- Does this improve the user workflow?
- Does this match the quality of a top-tier SaaS tool?

If not, refine it.