# CaseLink Design System

Design tokens and patterns for a clean, smooth, professional interface with controlled blue accents.

## Design Tokens

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#f4f6f8` | Page background (soft grey, slightly warm) |
| `--foreground` | `#334155` | Primary text (dark grey, not black) |
| `--surface` | `#ffffff` | Card backgrounds |
| `--border` | `#e2e8f0` | Default borders |
| `--muted` | `#64748b` | Secondary text, metadata |
| `--muted-bg` | `#f1f5f9` | Muted backgrounds |
| `--primary` | `#2563eb` (blue-600) | Primary buttons, key actions |
| `--primary-hover` | `#1d4ed8` (blue-700) | Primary button hover |
| `--primary-bg` | `#eff6ff` (blue-50) | Light blue backgrounds, active states |
| `--success` | `#059669` | Complete (muted) |
| `--warning` | `#d97706` | In progress, escalation |
| `--error` | `#dc2626` | Blocked, overdue, errors |

**Rules:**
- Background: soft grey (#f4f6f8), cards: white
- Primary accent: muted blue for buttons, active nav, key highlights
- Light blue tints (blue-50) for: hover states, active cards, "Action Needed Now"
- Status colors: success (emerald), warning (amber), error (red) — muted and consistent

### Typography

| Element | Size | Weight | Usage |
|---------|------|--------|-------|
| Page title | 1.25–1.5rem (xl–2xl) | Semibold | Page headers |
| Section title | 1rem (base) | Semibold | Section headers |
| Body | 0.875rem (sm) | Regular | Body text |
| Small | 0.75rem (xs) | Regular/Medium | Labels, metadata |
| XS | 0.6875rem | Medium | Compact labels |

**Font:** Inter (system-ui fallback)

**Rules:**
- No uppercase + letter-spacing for section labels; use `font-medium` instead
- Consistent line heights: tight (1.25), normal (1.5), relaxed (1.625)

### Spacing

4px grid: `space-1` (4px) through `space-10` (40px)

- Card padding: `p-5` (20px) or `p-4` (16px)
- Section gaps: `gap-4` to `gap-6`
- Form field spacing: `mt-1.5` between label and input

### Border Radius

- `rounded-lg` (8px): cards, inputs, buttons, modals
- `rounded-md` (6px): badges, small elements

### Shadows

Minimal. Most surfaces use borders instead of shadows.

- Cards: no shadow, subtle border
- Modals: no heavy shadow

## Component Hierarchy

### Buttons

| Variant | Styling |
|---------|---------|
| Primary | Blue background, white text, 150ms transition |
| Secondary | Light grey/blue-50 bg, blue hover tint |
| Outline | White bg, grey border |
| Ghost | Minimal, slate hover |

### Status Badges

| Status | Colors |
|--------|--------|
| Pending / Not started | `border-slate-200 bg-slate-50 text-slate-700` |
| In progress | `border-blue-200 bg-blue-50 text-blue-800` |
| Complete | `border-emerald-200 bg-emerald-50 text-emerald-800` |
| Blocked | `border-red-200 bg-red-50 text-red-800` |

### Cards

- `rounded-lg border border-slate-200 bg-white p-5`
- Hover: `hover:bg-blue-50/50` (light blue tint, 150ms transition)
- Active/selected: `bg-blue-50/30` with `border-blue-200`

### Inputs

- `rounded-lg border border-slate-200`
- Focus: `focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15`

## Files Updated

- `src/app/globals.css` — Design tokens, body styles
- `src/app/layout.tsx` — Inter font
- `src/components/ui/*` — Button, Card, Input, Badge, Label, PageHeader, SectionHeader, StatCard, EmptyState
- `src/components/layout/*` — AppShell, NavLink, AuthShell
- `src/lib/ui/form-classes.ts` — Form input, alert, checkbox classes
- `src/features/dashboard/*` — Dashboard sections
- `src/features/families/*` — Plan panel, plan-step-modal, urgency/step badges, family workspace, case panels
- `src/features/resources/*` — Resource detail view
- `src/features/calendar/*` — Calendar view, loading
- `src/app/(workspace)/*` — Dashboard, families, resources, calendar pages
- `src/app/login/page.tsx`, `src/app/signup/page.tsx`

## Consistency Rules

1. **No decorative typography** — Use `font-medium` for labels
2. **Blue as primary accent** — Muted blue for primary actions, active states, highlights
3. **Layered backgrounds** — Soft grey page, white cards, blue-50 tints for active/hover
4. **Smooth transitions** — 150–200ms on interactive elements
5. **Status colors** — Blue = in progress, emerald = complete, amber = warning, red = blocked, gray = pending
