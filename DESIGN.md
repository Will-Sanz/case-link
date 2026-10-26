---
name: CaseLink parent support
description: Clear family service wayfinding, bounded permission and honest progress.
colors:
  navy-ink: "#122c37"
  body-muted: "#4d646b"
  primary: "#086a63"
  primary-hover: "#04544f"
  paper: "#f7faf8"
  surface: "#ffffff"
  soft: "#eaf4f0"
  border: "#d6e1dc"
  support-lemon: "#eff4b9"
  error: "#962f29"
typography:
  display:
    fontFamily: "Geist Sans, sans-serif"
    fontSize: "clamp(3rem, 5.3vw, 4.6rem)"
    fontWeight: 650
    lineHeight: 1.05
  body:
    fontFamily: "Geist Sans, sans-serif"
    fontSize: "16px"
    lineHeight: 1.6
rounded:
  control: "9px"
  surface: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    typography: "{typography.body}"
---

# Parent experience design

## Overview

**Creative North Star: "Clear family service wayfinding"**

This describes the built parent surfaces in src/features/parent/parent.module.css. School context is preserved in [the legacy design record](docs/legacy/school-design.md); its globals remain scoped to the legacy product.

The parent may be reading a phone in ordinary daylight while managing household demands. Light, flat surfaces and readable sans-serif type support quick scanning. Dark navy carries structure; teal identifies actions and selections; soft lemon highlights support and necessary choices. Color never supplies the only state cue.

Public pages explain the service, offer food or utility entry, and expose urgent official help. The application prioritizes the family's task. No generic chat console or analytics dashboard sits between the need and useful action.

Use one primary action per task, progressive detail, clear labels and visible focus. The three intake stages preserve answers and retry identity. Required parent actions precede operator-owned waiting, which stays secondary. Show sources and detailed permission without forcing repetitive approval.

## Colors

Navy and muted ink carry readable structure. Teal is reserved for actions and selected states; soft green and lemon support task emphasis. Paper, white surfaces and thin boundaries keep long forms calm. Errors use the explicit error color with readable text.

## Typography

Type uses a 16px body with 1.6 line height. Headings use balanced wrapping. Large display is reserved for entry pages. Controls have generous tap targets, visible disabled/pending states and descriptive errors. Consistent spacing separates tasks while keeping related fields together.

## Layout

Phone navigation is a simple menu; larger screens use direct navigation. Forms reflow to one column, long content wraps, and essential actions remain usable at 320 CSS pixels and 200% zoom. Motion is restrained and disabled for reduced-motion preference.

## Elevation & Depth

Flat surfaces use a pale background, thin boundaries and tonal highlights. The action color identifies the next useful step; required-parent cards use a quiet lemon tint. No shadow is needed to suggest that a request advanced.

## Shapes

Controls use the control radius; larger task surfaces use the surface radius. Status pills combine a soft fill with explicit text. Avoid treating a color change alone as a state change.

## Components

Primary buttons use teal with white text and a darker hover. Inputs and selects use readable dark text, a visible border and an explicit focus outline. Navigation uses direct labels; phone navigation has an expanded state. Parent-required steps precede secondary service waiting, and exact packets remain separate from a current summary.

## Do's and Don'ts

- Do preserve one clear action, source attribution and honest progress.
- Do keep operator-owned waiting quieter than the family's necessary step.
- Do not introduce an agent transcript, analytics dashboard or fabricated receipt into the family journey.

Every screen includes purposeful loading, empty, waiting, error and recovery states. Dates and outcomes identify what is recorded; preparation never looks like submission or approval. Generic private email notices omit benefit and account details.

Verification: the initial headless batch covered six surfaces at 1440, 390 and 320 pixels with no detected axe AA violations or horizontal overflow. Independent visual review requested moving parent action before service waiting and reconciling design context; those changes are included. A further production-localhost review covers 28 desktop/phone workflow states and fixes consent readability, account context, explicit error recovery and keyboard navigation. This evidence does not establish family observation or full screen-reader testing.
