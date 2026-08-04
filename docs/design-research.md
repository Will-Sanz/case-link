# CaseLink Design Research and Component Policy

**Status:** Step 1 design input  
**Audience:** Product, design, and engineering

## What the reference set establishes

The five supplied interface references point to a consistent product standard: a compact left navigation, a quiet top utility bar, strong page titles, thin borders, cool off-white surfaces, restrained accent color, legible status chips, and dense information arranged in a stable grid. Their value is not the specific sales charts or widgets. It is the sense of control created by consistent alignment, predictable controls, and clear hierarchy.

CaseLink should carry forward:

- A sidebar that recedes visually while making location obvious
- One clear title and purpose per page
- Tables and work queues as first-class operating surfaces
- Small summary cards only when each leads to an action
- Restrained semantic colors for priority, status, and review state
- Product previews that show real operational structure rather than decorative illustration
- Generous page-level spacing paired with compact component-level spacing

CaseLink should not carry forward:

- Revenue-dashboard metaphors that do not fit student support
- Charts added only to make a screen appear sophisticated
- Excessive cards, floating panels, gradients, or decorative AI effects
- Student names or other identifiable student or family information in the first release
- Invented testimonials, outcomes, certifications, district counts, or procurement claims

## Product research implications

Mature enterprise products use a consistent shell and interaction grammar so users do not need to relearn controls from page to page. The navigation should be familiar, the system should remain usable at high information density, and common actions should use established patterns.

District evaluation is also a workflow. The public site and demo should help a nontechnical administrator answer, in order:

1. What operational problem does CaseLink solve?
2. Who uses it and what changes in their day?
3. What information is required, and what is deliberately not collected?
4. How much work is implementation?
5. What would a limited pilot include, and how would success be judged?
6. How does a human remain accountable for AI-prepared work?

This supports a demo-led, pilot-first acquisition path instead of public self-service signup.

## Official component policy

Use established, accessible primitives before creating any CaseLink-specific behavior. The initial implementation standard is shadcn/ui's `new-york` style with Radix primitives, Lucide icons, and the existing Tailwind stack. CaseLink-specific components should be compositions of these primitives, not new interaction models.

| Product need | Approved primitive or pattern |
| --- | --- |
| Application shell | Sidebar, Breadcrumb, Avatar, Dropdown Menu, Sheet |
| Search and keyboard access | Command, Input, Dialog |
| Work queues and caseloads | Data Table/Table, Checkbox, Badge, Dropdown Menu, Pagination |
| Filtering | Select, Popover, Command, Button |
| Onboarding | Field, Input, Select, Checkbox, Progress, Card, Alert |
| AI review | Tabs, Sheet or Dialog, Badge, Alert, Button |
| Confirmations | Alert Dialog |
| Feedback | Sonner, Alert, Progress |
| Loading and empty states | Skeleton, Spinner, Empty |
| Aggregate reporting | shadcn Chart/Recharts only when the data supports a decision |

If an official primitive does not cover a need, first compose existing primitives. A custom interaction requires an explicit product reason, accessibility behavior, keyboard behavior, responsive behavior, and review before implementation.

## Role and surface separation

- **District or school administrator:** public evaluation and request-a-demo journey. Private administration is deferred until a pilot requires it.
- **Case manager:** Families list and one family workspace for Profile, Barriers, Intervention Plan, and Paperwork.
- **Supervisor:** team coordination is deferred and must not displace the case manager's focused workflow.

The default authenticated route is Families. CaseLink should add no private top-level destination unless a validated workflow cannot live inside the family workspace.

## Current visual system direction

- **Character:** focused family casework and document-preparation workspace
- **Surfaces:** porcelain and cool-neutral backgrounds, white working surfaces, 1px borders
- **Typography:** practical grotesk/workhorse type with compact labels and decisive headings
- **Primary:** cobalt blue reserved for location, progress, and primary action
- **Semantic color:** quiet red, amber, green, and violet used with text labels rather than as the only signal
- **Density:** compact enough for daily operations, never cramped
- **Motion:** limited to existing component transitions and functional feedback
- **AI:** presented as drafts and review states, not spectacle

## Source foundation

- Linear's 2026 interface refresh emphasizes consistency across navigation and view controls while retaining high information density.
- Atlassian Design System provides mature foundations for accessible, responsive enterprise interaction patterns.
- shadcn/ui provides official dashboard, sidebar, table, dialog, form, and feedback primitives that remain owned and composable within the product codebase.
- U.S. Web Design System provides a public-sector accessibility and plain-language quality bar.
- Digital Promise's edtech procurement framework supports needs-driven evaluation and pilot planning before scaling.
- The U.S. Department of Education's student-privacy guidance reinforces making data collection, use, and transmission understandable during technology evaluation.
