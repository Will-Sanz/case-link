---
name: CaseLink
description: The original CaseLink identity, carried into clear parent food and utility support.
colors:
  primary: "oklch(44.93% 0.2146 280.43)"
  primary-hover: "oklch(38.54% 0.1952 279.25)"
  primary-soft: "oklch(94.64% 0.0284 294.59)"
  primary-rule: "oklch(73.31% 0.1105 291.16)"
  focus: "oklch(51.18% 0.2133 282.31)"
  paper: "oklch(98.73% 0.0067 295.45)"
  paper-secondary: "oklch(96.26% 0.0204 298.2)"
  paper-selected: "oklch(93.51% 0.0286 296.74)"
  paper-hero: "oklch(97.72% 0.0121 296.36)"
  surface: "oklch(99.78% 0.0011 17.18)"
  ink: "oklch(26.48% 0.0939 266.47)"
  ink-hover: "oklch(31.3% 0.1083 266.72)"
  ink-strong: "oklch(36.58% 0.0789 271.66)"
  ink-muted: "oklch(45.68% 0.0619 272.15)"
  ink-faint: "oklch(53.26% 0.0516 272.35)"
  rule: "oklch(89.55% 0.0385 295.43)"
  rule-strong: "oklch(82.37% 0.0606 295.7)"
  positive: "oklch(48.05% 0.0686 163.64)"
  positive-bg: "oklch(95.2% 0.0132 159.91)"
  attention: "oklch(47.66% 0.085 81.02)"
  attention-bg: "oklch(97.07% 0.0381 90.65)"
  error: "oklch(47.59% 0.1586 25.61)"
  error-bg: "oklch(97.05% 0.0129 17.38)"
typography:
  display:
    fontFamily: '"Newsreader Variable", Georgia, serif'
    fontSize: "clamp(2rem, 4.5vw, 3.5rem)"
    fontWeight: 560
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline:
    fontFamily: '"Newsreader Variable", Georgia, serif'
    fontSize: "clamp(1.5rem, 3vw, 2.2rem)"
    fontWeight: 560
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif'
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  body:
    fontFamily: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.9375rem"
    fontWeight: 600
rounded:
  control: "0.625rem"
  card: "0.875rem"
  feature: "1rem"
  pill: "9999px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2.5rem"
  2xl: "4rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0.75rem 1.2rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.75rem 1.2rem"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.7rem 0.8rem"
  task-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.feature}"
    padding: "2rem"
  outcome-badge:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
---

# Design System: CaseLink

## Overview

**Creative North Star: "One familiar CaseLink service"**

The original CaseLink identity carries through the parent product: lavender paper, deep navy text, restrained violet actions, Newsreader headings and Geist controls. This refresh follows the owner's request to recover the established brand and the explicit selection of imagegen Option 2, Family Panorama. The palette and shared identity are durable; that public-entry composition is a surface choice.

The public experience is welcoming and editorial, using original family illustration and generous space to introduce food and utility support. Operational screens use the same identity with calmer, readable task surfaces, direct controls and necessary information. The product should feel composed, welcoming and capable, as recorded in [PRODUCT.md](PRODUCT.md).

This is an as-built record of [the shared tokens](tokens.css), [parent styles](src/features/parent/parent.module.css), shared CaseLink wordmark/favicon, linked ChatGPT Futures banner and parent entry. It replaces the superseded teal/lemon parent record. The [historical school design](docs/legacy/school-design.md) remains unchanged; its original visual identity is deliberately reused here.

**Key Characteristics:**

- One CaseLink mark, wordmark, palette and type pairing across public, operational and policy pages.
- Original family imagery on public entry, with readable forms and clear actions inside the service.
- Restrained violet emphasis, explicit state labels and visible keyboard focus.
- Parent-owned actions are prominent; detailed service history and waiting remain secondary.

## Colors

The normative values above preserve the source's OKLCH format. New UI uses semantic properties from the root token file; existing compatibility aliases resolve to that same palette.

### Primary

Violet supplies primary actions, active navigation, selected choices, links and the chain mark. Its darker hover and pale lavender support tint remain part of the same family. Focus has its own established violet tone.

### Secondary

Sage supports positive feedback, amber supports attention and red supports errors or destructive actions. Each status includes words or an icon and words; hue does not establish an outcome by itself.

### Neutral

Lavender paper separates the page from the near-white surface. Navy ink supplies headings and body structure; muted ink supplies supporting text. Violet-tinted boundaries separate fields, tasks and rows without adding a competing neutral palette. The darker navy recognition strip sits above the near-white header.

## Typography

**Display Font:** Newsreader Variable, with Georgia and serif fallbacks.

**Body Font:** self-hosted Geist Sans through the existing font variable, with native sans-serif fallbacks.

The serif/sans pairing is shared with the old site. Newsreader supplies warmth and editorial hierarchy; Geist keeps forms, choices, account details and progress easy to scan.

### Hierarchy

- **Display:** the shared parent page heading follows the frontmatter role. The public panorama heading grows separately to its implemented entry-page scale, with tighter leading and balanced wrapping; this is not the size for every form.
- **Headline:** shared section headings use the serif role. Task surfaces intentionally reduce headings to a compact local size.
- **Title:** functional subsection headings use Geist with semibold emphasis.
- **Body:** the parent shell explicitly uses the body role above. The legacy global body remains smaller; do not inherit that legacy size into parent forms.
- **Label:** field labels and controls use clear sentence case. Smaller hints, metadata and badges support the main reading order rather than becoming the primary explanation.
- **Wordmark:** Newsreader accompanies the shared chain mark; use the shared component rather than rebuilding its text treatment.

## Layout

Ordinary parent content has a centered maximum width (1160px), with narrower intake/account surfaces (800px) and legal reading surfaces (780px). Desktop content gutters are generous (2.5rem); phone gutters tighten (1.25rem). Related fields sit in rows where space permits and reflow to one column.

Public entry places the editorial heading and action above the wide family panorama, followed by one overlapping food/utility entry sheet. The illustration is a real optimized image with descriptive alternative text. Its crop adapts to the viewport; it is not a testimonial or a decorative background behind important text. This composition belongs to the entry surface, while the illustration treatment and brand continuity can carry into other suitable public pages.

The detail workspace has a main task column and a secondary column, reflowing at the implemented tablet boundary (900px). At the phone boundary (760px), the header uses a native expandable menu, the entry sheet stacks, forms become single-column and footers wrap. A separate phone hero scale preserves its hierarchy without forcing desktop dimensions onto a small screen.

A 4px spacing vocabulary underlies the shared tokens; the built form uses purposeful local gaps. Preserve grouping, label association and wrapping rather than forcing every gap onto one scale step.

## Elevation & Depth

The system combines pale tonal layers and thin boundaries with restrained soft shadows. The primary action uses the shared action shadow. Task surfaces are flat at rest; the mobile navigation uses a soft menu shadow. Global shadow tokens remain available to the existing public surfaces, but ordinary parent rows do not need a raised-card treatment.

Depth does not stand in for service progress. A changed state stays legible through its label, content and evidence. Motion is limited to short control transitions and the small directional arrow response.

The parent shell respects reduced-motion preferences by removing animated transitions and smooth scrolling while retaining visible focus and state changes.

## Shapes

Controls have gently curved corners using the control radius. Request cards use the card radius; larger task surfaces and the public entry sheet use the feature radius. Status badges are fully rounded. Thin solid boundaries and soft fills organize most work; the document drop area uses an established dashed border.

The CaseLink chain symbol is a single shared vector asset, reused in header, footer and browser icon. Its paired open links remain distinct from OpenAI's marks.

## Components

### Buttons

The primary violet action has light text, a soft action shadow and the darker violet hover. Secondary actions retain a surface fill and visible boundary. Quiet actions are violet and underlined; destructive actions use the error color with a visible boundary and pale error hover. Controls have a minimum height (48px), explicit pending/disabled treatment and a shared focus outline (3px, offset 4px).

### Cards and task surfaces

Task surfaces use a near-white fill, thin rule, generous padding and the feature radius. Clickable request cards use the smaller card radius and a violet-tinted hover boundary. The parent's necessary step remains above service-owned waiting. The current summary, immutable packets and attributed outcomes remain visually distinct pieces of content.

### Inputs and choices

Inputs, selects and textareas use the body size, near-white background, strong boundary and control radius. Labels precede controls; hints and errors sit with the field. Selected radio/checkbox choices use a violet boundary and pale lavender fill, retaining the native selection control. Invalid fields also change their boundary and provide a written error.

### Status and progress

Badges pair a soft semantic fill with explicit text. Waiting uses the quieter paper and muted ink. Attention and error states use their corresponding semantics. Timelines and the intake step indicator combine shape, text and current-step semantics, rather than suggesting completion through decoration.

### Navigation and brand

The header and footer share `CaseLinkWordmark` and the same favicon source. Signed-in navigation leads to support and account tasks; signed-out navigation explains the service and sign-in. Current pages have a semantic active state. The mobile menu closes when a destination is selected.

`ChatGptFuturesBanner` preserves the original linked, text-based recognition above the header, visually separate from the CaseLink identity. It links to the official announcement and does not merge an OpenAI mark into the product logo. Footer policy and contact links stay part of the same branded shell.

### Public illustration and service entry

The family panorama uses an original gouache-style illustration in the established palette. The food/utility sheet is one coherent entry surface: two columns with a divider on larger screens, then stacked rows on phones. Outlined functional icons, simple arrows, a pale accent field and readable descriptions make both routes recognizable.

## Do's and Don'ts

### Do

- Do use the original shared lavender, navy and violet tokens across parent pages.
- Do reuse the shared CaseLink mark and Newsreader/Geist pairing.
- Do keep parent body copy and inputs at the readable body role, with visible focus and explicit labels.
- Do use original illustrative imagery where it supports the public story and preserve its alternative text and responsive crop.
- Do keep necessary parent actions ahead of secondary waiting and preserve honest outcome labels.

### Don't

- Don't reintroduce the superseded standalone teal/lemon parent identity.
- Don't redraw the CaseLink logo differently for individual screens or combine it with OpenAI's marks.
- Don't present generated people as testimonials or proof that a family received assistance.
- Don't use color or a decorative change as the only indication of service status.
