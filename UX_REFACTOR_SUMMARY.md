# Calendar & Family Page UX Refactor Summary

## Calendar Page Changes

### Layout (Google Calendar–style)
- **Left sidebar** (~224px): Mini month calendar, Today button, prev/next controls, month label, view switcher (Month / Week / Agenda), workload summary (due today, overdue, blocked, families count)
- **Main area**: Large central calendar grid that dominates the page
- **Right panel**: Contextual drawer that appears only when an event is selected; no reserved space when empty

### Improvements
- Calendar uses full viewport width (MainContent applies `max-w-none` for `/calendar`)
- Mini month in sidebar: click a date to navigate
- Navigation: Today, ‹ ›, view tabs in one place
- Event detail shown in a slide-over panel (lg:w-96) instead of a permanently visible column
- Month grid: larger cells (min-h 80px), more room for event chips
- Event chips: clearer styling, better truncation

### Responsive
- On small screens: sidebar stacks above calendar (flex-col)
- Left nav becomes horizontal tabs

---

## Family Page Changes

### Workspace Layout
- **Internal sidebar** (lg:w-52): Section navigation (Overview, Open work, Plan, Members, Goals, Barriers, Notes, Activity, Resources)
- **Main content**: Scrollable area showing the active section only
- **Compact header**: Sticky; family name, status, urgency, next action, metadata, and primary actions (Close/Reopen case, Delete)

### Section Navigation
- Clicking a section switches the main content; no long scrolling
- Active section highlighted with `bg-blue-50/70`
- Default section: **Open work** when there are needs-attention items; otherwise **Overview**

### Sections
1. **Overview** – UpdateFamilyForm, goals, barriers in a two-column layout
2. **Open work** – CaseCommandCenter + PlanPanel (primary work)
3. **Plan** – PlanPanel only
4. **Members** – Household members
5. **Goals** – Goals
6. **Barriers** – Barriers
7. **Notes** – AddCaseNoteForm + case notes list
8. **Activity** – CaseActivityTimeline
9. **Resources** – ResourceMatchesPanel, PhasePlaceholder, CaseAssistantPanel

### Visual Changes
- Fewer heavy cards; sections use lighter borders and spacing
- Replaced stacked cards with structured section layouts
- Consistent section headers and descriptions
- Full-width layout for family detail (`/families/[id]`)

---

## Shared Layout Updates

### MainContent Component
- Client component using `usePathname()`
- **Full-width routes**: `/calendar`, `/families/[id]` (excluding `/families` and `/families/new`)
- **Standard routes**: `max-w-5xl` with padding (dashboard, families list, resources, etc.)

---

## Assumptions

1. **Calendar**: `compact` prop kept for compatibility but layout no longer depends on it
2. **Family**: CaseAssistantPanel placed under Resources; could be moved if desired
3. **Plan**: Shown in both “Open work” and “Plan” for different workflows
4. **Routing**: Unchanged; no new routes
5. **Data model**: Unchanged; no schema or API updates
