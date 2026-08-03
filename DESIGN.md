---
name: CaseLink
description: A calm, credible family-support workspace that carries reviewed work into review-ready paperwork.
colors:
  primary: "#276221"
  primary-hover: "#1f531b"
  focus-green: "#46923c"
  forest-ink: "#173a15"
  body-ink: "#365134"
  muted-ink: "#5d705a"
  soft-ink: "#778874"
  paper: "#f6f8f4"
  surface: "#ffffff"
  green-wash: "#edf4eb"
  green-mist: "#e7f1e4"
  border: "#dce6d9"
  control-border: "#cfdccc"
  soft-leaf: "#cce7c9"
  review-bg: "#fff5da"
  review-ink: "#765a16"
  error-bg: "#fef2f2"
  error-ink: "#a32929"
  print-ink: "#000000"
  print-muted: "#333333"
typography:
  display:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.8rem, 6vw, 5.65rem)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.12em"
  micro:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
  caption:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
  compact:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
  reading:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
  brand:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.05rem"
  legal:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
  legal-compact:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
  print:
    fontFamily: "Helvetica, Arial, sans-serif"
    fontSize: "10px"
rounded:
  sm: "0.375rem"
  control: "0.5rem"
  card: "0.75rem"
  feature: "1rem"
  pill: "9999px"
spacing:
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  5: "1.25rem"
  6: "1.5rem"
  8: "2rem"
  10: "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  button-secondary:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.body-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.75rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.body-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.625rem 0.75rem"
    width: "100%"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.forest-ink}"
    rounded: "{rounded.card}"
    padding: "1.25rem"
  chip-review:
    backgroundColor: "{colors.review-bg}"
    textColor: "{colors.review-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.75rem"
---

# Design System: CaseLink

## Overview

**Creative North Star: "The Calm Handoff"**

CaseLink should feel like a well-prepared folder passed between trusted colleagues: ordered, legible, and ready for the next responsible action. The interface uses warm paper fields, crisp white working surfaces, quiet green structure, and concise language so a school case manager can move from family intake to reviewed plan to paperwork without needing software expertise.

Polish comes from proportion, steady alignment, and visible review boundaries—not visual spectacle. Public surfaces are spacious and reassuring; the authenticated workspace is denser and more operational. Both share the same restrained green palette, Geist Sans, gently curved geometry, and explicit human-control cues.

**Key Characteristics:**

- Calm, credible, and institutionally polished
- Warm paper surroundings with white working surfaces
- Deep green reserved for action, location, and completion
- Compact controls inside generous page-level spacing
- Clear provenance, review state, and manual handoff language
- Motion that confirms interaction without turning AI into spectacle

## Colors

The palette moves from Forest Action Green through Soft Leaf, supported by paper whites and green-gray inks; amber and red appear only for states that require attention.

### Primary

- **Forest Action Green** (`#276221`): Primary actions, active navigation, key icons, and deliberate high-emphasis public bands.
- **Deep Forest Hover** (`#1f531b`): Hover state for primary actions and linked emphasis.
- **Focused Leaf** (`#46923c`): Keyboard focus borders and translucent focus rings.

### Neutral

- **Forest Ink** (`#173a15`): Headings, wordmark text, and the highest-emphasis instructional copy.
- **Service Ink** (`#365134`): Form labels, navigation, and compact operational text.
- **Muted Moss** (`#5d705a`): Supporting copy, descriptions, and noncritical metadata.
- **Soft Moss** (`#778874`): Placeholders, timestamps, and tertiary labels.
- **Warm Paper** (`#f6f8f4`): Default page field and workspace background.
- **Clean Sheet** (`#ffffff`): Forms, cards, navigation rails, and document-review surfaces.
- **Quiet Green Wash** (`#edf4eb`): Secondary controls, guidance callouts, empty states, and selected context.
- **Open Green Mist** (`#e7f1e4`): Large public hero and explanatory bands.
- **Quiet Rule** (`#dce6d9`): Section borders, card outlines, and shell dividers.
- **Control Rule** (`#cfdccc`): Inputs and outlined controls that need a clearer boundary.
- **Soft Leaf** (`#cce7c9`): Supporting text on dark green, selection color, and gentle connective detail.

### Tertiary

- **Review Amber** (`#fff5da` / `#765a16`): Fields and chips that need explicit human attention.
- **Plain Error** (`#fef2f2` / `#a32929`): Recoverable validation and processing failures.

### Named Rules

**The Verdant Restraint Rule.** Forest Action Green marks the next action, current location, or a purposeful public emphasis; it does not flood routine working surfaces.

**The Written State Rule.** Review, success, and error colors always travel with plain-language labels or icons; color is never the only signal.

## Typography

**Display Font:** Geist Sans (with `ui-sans-serif`, `system-ui`, `sans-serif` fallbacks)
**Body Font:** Geist Sans (with `ui-sans-serif`, `system-ui`, `sans-serif` fallbacks)

**Character:** Geist Sans keeps the product contemporary without feeling technical. Tight, confident display tracking gives the public site authority; compact body and label styles keep daily casework readable and efficient.

### Hierarchy

- **Display** (600, `clamp(2.8rem, 6vw, 5.65rem)`, 0.98): Public hero statements only; keep copy short enough to preserve the broad, editorial silhouette.
- **Headline** (600, `3rem`, 1.25): Major public section statements at wide breakpoints; step down to `1.875rem` on small screens.
- **Title** (600, `1.5rem`, 1.25): Workspace page titles, family names, and form completion states.
- **Body** (400, `0.875rem`, 1.6): Default workspace copy; public explanatory copy may step up to `1rem`, `1.125rem`, or `1.25rem` with relaxed leading.
- **Label** (600, `0.75rem`, 0.12em tracking): Sparse uppercase wayfinding labels such as Workspace and Open family. Ordinary form labels stay sentence case.
- **Compact UI** (`10px`, `11px`, `13px`, `15px`): Deliberate dense-workspace steps for micro indicators, provenance, metadata, and editable plan text; never use the smallest steps for primary instructions.
- **Brand** (`1.05rem`): Wordmark text only.
- **Legal** (`0.8125rem`, `0.9375rem`): Long-form legal metadata and reading copy.
- **Print** (Helvetica, `10px` base): PDF-only fallback chosen for reliable embedded rendering; print ink may use `#000000` and `#333333` for monochrome legibility.

### Named Rules

**The Plainspoken Hierarchy Rule.** Type communicates order without jargon: one decisive heading, direct supporting copy, and labels written for school staff rather than software specialists.

## Layout

The system uses a 4px spacing grid with compact component padding and generous page intervals. Public pages sit in centered containers up to `80rem`, using `1.25rem`, `2rem`, and `2.5rem` horizontal gutters as the viewport grows; large sections typically use `5rem` to `7rem` vertical padding. Marketing layouts collapse from asymmetric two-column compositions into a single readable column.

The authenticated product uses a fixed `244px` desktop rail and a full-height scrollable work area. At widths below `64rem`, the rail becomes a `64px` mobile header with a contained navigation menu. Families and paperwork content center within `72rem`; form-review rows become multi-column only when labels, editable values, and provenance can remain comfortably legible.

**The Room Around the Work Rule.** Give the page generous breathing room, then make controls and review rows compact enough for daily operations; do not solve density by stacking decorative cards.

## Elevation & Depth

CaseLink uses a hybrid of tonal layering, thin borders, and restrained ambient shadows. Most workspace surfaces are flat and bordered. Shadows appear on primary actions, menus, prominent public product previews, and completed interaction states where a small amount of lift clarifies hierarchy.

### Shadow Vocabulary

- **Action Lift** (`0 5px 14px rgba(39,98,33,0.14)`): Default primary button elevation; strengthens slightly on hover.
- **Working Surface** (`0 10px 30px rgba(30,70,27,0.06)`): Low ambient depth for the main paperwork panels.
- **Decision Surface** (`0 24px 60px rgba(30,70,27,0.12)`): Demo forms and completion states that need focused attention.
- **Product Proof** (`0 30px 80px rgba(30,70,27,0.16)`): Large public product-preview compositions only.

### Named Rules

**The Lift With Purpose Rule.** A shadow must explain hierarchy or response; routine cards rely on paper contrast and a one-pixel border.

## Shapes

Controls use gently curved `0.5rem` corners, content cards use `0.75rem`, and featured marketing or empty-state panels use `1rem`. Pills are reserved for short statuses. Borders stay thin and low contrast; dashed outlines signal an available upload or empty-state action. The repeated rounded square behind icons acts as a quiet CaseLink signature without becoming ornamental.

**The Quiet Curve Rule.** Corners soften institutional workflows without making them playful; preserve the control, card, feature, and pill hierarchy instead of rounding every element to the maximum.

## Components

### Buttons

- **Shape:** Gently curved (`0.5rem`) with compact `0.5rem 1rem` workspace padding; public conversion buttons use a `3rem` minimum height.
- **Primary:** Forest Action Green with white semibold text and a low green shadow.
- **Hover / Focus:** Darken to Deep Forest Hover, lift by one or two pixels, and show a visible Focused Leaf ring. Active state returns to the baseline. Disabled state keeps its label visible at reduced opacity.
- **Secondary / Outline / Ghost:** Secondary buttons use Quiet Green Wash; outlines use Clean Sheet plus Control Rule; ghost actions preserve the paper background until hover.

### Chips

- **Style:** Compact semibold text in a pill. Green communicates active or ready states; Review Amber communicates attention.
- **State:** Every chip includes a concrete label such as “Ready to download” or “2 to review.”

### Cards / Containers

- **Corner Style:** Working cards use `0.75rem`; feature panels use `1rem`.
- **Background:** Clean Sheet on Warm Paper, with Quiet Green Wash used for nested guidance or selected context.
- **Shadow Strategy:** Flat by default; use Working Surface depth only for the primary task container.
- **Border:** One-pixel Quiet Rule; dashed green-gray borders for upload and empty states.
- **Internal Padding:** `1.25rem` for compact cards, growing to `1.5rem` or `1.75rem` for primary workflow panels.

### Inputs / Fields

- **Style:** Clean Sheet, Control Rule border, `0.5rem` corners, and compact body text. Placeholders use Soft Moss.
- **Focus:** Shift the border to Focused Leaf and add a broad, translucent four-pixel ring.
- **Error / Disabled:** Errors sit in Plain Error with a readable message. Disabled inputs use a quiet green-gray fill and preserve legible text.

### Navigation

The desktop rail is white on Warm Paper with one-pixel dividers. Navigation items use compact sentence-case labels, restrained line icons, and a green-tinted active row. Mobile navigation keeps the same order and labels in a bordered floating menu; it does not introduce a second information architecture.

### Paperwork Review

Paperwork review is the signature expression of The Calm Handoff. Each field row keeps the PDF field name, editable proposed value, provenance, and review state in one scan path. The final action says “Download completed PDF,” and nearby copy makes the manual CitySpan handoff explicit.

**The Visible Handoff Rule.** AI-prepared values remain editable and traceable, attention states remain visible, and no completion treatment implies automatic submission.

## Do's and Don'ts

### Do:

- **Do** reserve Forest Action Green for primary actions, active location, and meaningful completion.
- **Do** place white working surfaces on Warm Paper or green-tinted page fields.
- **Do** keep provenance, review status, and the next human action visible in paperwork flows.
- **Do** use plain labels, readable focus rings, and words or icons alongside semantic color.
- **Do** pair generous page spacing with compact operational controls.

### Don't:

- **Don't** reintroduce blue or slate as a competing primary visual system; migrate remaining legacy primitives into the green palette when touched.
- **Don't** use gradients, decorative AI glow, or excessive floating cards to imply sophistication.
- **Don't** turn the Families workspace into an analytics dashboard or add charts without a decision-making need.
- **Don't** imply direct CitySpan integration, automatic submission, or AI authority over case-manager judgment.
- **Don't** use identifiable family details in public previews or demonstration fixtures.
