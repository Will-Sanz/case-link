# Parent brand options and approved direction

October 25, 2026. The product owner asked to reuse the original CaseLink visual identity, use images, explore five imagegen mockups and implement a professional parent experience. After seeing the options, the owner **explicitly selected Option 2, Family Panorama**, and attached its screenshot. This supersedes the implementation agent's initial Option 1 preference.

All five explorations preserve the original navy/lavender/violet colorway, Newsreader/Geist pairing, linked CaseLink mark and factual ChatGPT Futures recognition. The images are design explorations, not evidence of working integrations or benefit outcomes. Their incidental mockup copy does not override the PRD or actual launch status.

| Option | Exploration | Decision |
| --- | --- | --- |
| [1 — The Calm Handoff](../.impeccable/mocks/parent-01-calm-handoff.webp) | Asymmetric text and one kitchen scene | Superseded by the owner's selection |
| [2 — Family Panorama](../.impeccable/mocks/parent-02-family-panorama.webp) | Editorial heading/action above a wide two-scene family illustration and one shared service-entry sheet | **Approved by the owner; implemented** |
| [3 — Guided Start](../.impeccable/mocks/parent-03-guided-start.webp) | Task choices beside a tall parent/child scene | Retained exploration |
| [4 — Welcome Home](../.impeccable/mocks/parent-04-welcome-home.webp) | Centered heading and broad family tableau | Retained exploration |
| [5 — Connected Neighborhood](../.impeccable/mocks/parent-05-connected-neighborhood.webp) | Philadelphia street scene and navy service band | Retained exploration |

## Implementation inventory

| Approved ingredient | Implementation |
| --- | --- |
| Original CaseLink identity | Existing semantic tokens in `tokens.css`; the competing parent palette is removed |
| Editorial heading, concise description and clear action | Semantic responsive HTML; self-hosted Newsreader display and Geist working copy |
| Family panorama | Original imagegen production artwork, generated separately from the mockup; optimized `public/marketing/caselink-parent-panorama.webp`. No UI text or proof of actual families/outcomes is embedded in the art |
| Shared food/utility entry surface | Two real links on one near-white sheet, with a modest overlap, functional icons, and a dividing rule; stacked on phones |
| Connected-loop logo | One shared SVG symbol and Newsreader wordmark, used across parent and existing public surfaces and favicon |
| ChatGPT Futures recognition | Shared compact linked text banner; official acknowledgment remains distinct from CaseLink's own logo |
| Direct urgent help | Inline official-help entry; an additional phone entry remains near the initial action |
| Operational, account and policy surfaces | Same shared colors/type/mark, preserving readable controls, necessary actions, permission/focus/error recovery, data policy, privacy, terms and original contact |

The selected mockup's `.webp.json` records approval; each exploration and the production asset retain their generation prompts. Raster imagery is not substituted for functional UI. The panorama crop preserves the family scene on small screens; input, help and policy content remain real text.

See [the UI/UX verification record](verification/parent-ui-ux-review.md) for actual rendered evidence and [production readiness](parent-production-readiness.md) for the distinction between local implementation and a live family service.
