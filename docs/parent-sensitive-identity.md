# Conditional sensitive identity handling

**Decision date:** October 26, 2026 (America/New_York)
**Status:** Product requirement and implementation design; protected identity capture, a token vault, Plaid and sensitive-field submission are **not implemented or connected**. This document does not expand the approved localhost pilot to SSN collection or transmission.
**Authority:** [Parent PRD, sections 10–11](parent-support-mvp-prd.md), [implementation plan](parent-support-implementation-plan.md), and [privacy applicability review](parent-privacy-regulatory-review.md).

## Product decision

CaseLink must support an SSN or another sensitive identity field when a verified application actually requires it and the parent has authority to supply it. A value that passes that field’s program-specific validation is accepted; merely resembling an SSN is not a reason to reject it. Preserve the actual recipient’s distinction between SSN, ITIN and other accepted identifiers. Omit optional identifiers. Do not collect one speculatively during intake, infer it from a phone number, or require bank linking or identity verification simply to receive food/utility help.

A required identifier belongs in a protected, purpose-specific field or the official provider's secure flow. It does not belong in chat, model context, ordinary household facts, logs or general operation JSON. Preserve current guards until the protected path and actual recipient channel exist. This is a conditional collection requirement, not a permanent ban on completing forms that need identity information.

## Current implementation and the affected flow

The current intake/answer/packet inventories do not contain an SSN field or identifier consent category. `forms.ts` rejects SSN field mappings along with personal declarations. Chat rejects detected identifiers before saving or model dispatch. No external application capability is enabled. Raw private uploads can already contain identifiers; isolation and financial-line selection minimize model input but do not erase identifiers from the original file. Current ordinary packet/PDF/JSON exports serialize recorded fields, so adding a plaintext `ssn` property would spread it into stored history and exports.

| Boundary | Existing files to preserve or extend when implementing |
| --- | --- |
| Exact field requirement, authority and permission | `src/lib/parent/domain.ts`, `answers.ts`, `policy.ts`, `service.ts`, `mutations.ts`; parent intake/permission/necessary-answer components; SQL intake/packet/provider/mandate validators |
| Acquisition and protected use | New narrow capture/tokenization boundary and its actual provider adapter; `execution.ts`, `worker-runtime.ts`, `forms.ts`, reviewed form templates/capabilities and operation grants |
| Accidental chat disclosure | `assistant-contract.ts`, `assistant-data.ts`, `assistant.ts`, the assistant API/component and database question guard |
| Original files and final artifacts | `upload.ts`, `documents.ts`, `document-processing.ts`, `storage-broker.ts`, document/form routes, private Storage policies and template/artifact migrations |
| Inspection, rights, cleanup and operations | `data.ts`, `export.tsx`, account/operation/form exports, retention worker/migrations, private runtime configuration, logging/secret checks, backup/restore and incident procedures |

These are an implementation change map, not a direction to add raw identifiers to every file. Keep existing school identifier/session/authorization protection intact. Reuse the scoped mandate, immutable operation, idempotency and source-validation patterns. Do not turn the general Storage broker's privileged credential or the backup-archive helper into an identity vault.

## Smallest complete parent experience

1. The verified current form/recipient contract determines the exact required field, whose identity is involved, why it is required, accepted delivery route and any actual personal act. Optional SSN/ITIN fields stay blank. Missing submission access is a connection issue, not a reason to collect the identifier early.
2. CaseLink prepares the remaining application independently. If necessary, it offers one focused secure step: enter the required value directly with the provider, use a reviewed hosted capture field, or use a supported optional prefill connection. Manual secure entry remains available when prefill is declined or unavailable.
3. Before acquisition, show the named source and recipient, exact purpose/fields, retention and any third-party processing. Obtain the necessary acquisition consent and confirm the required parental/representative authority for another household member's data, including any program-required child field. Never infer a child's identifier from an adult profile or make adult prefill availability an eligibility gate. A phone number or possession of a CaseLink account alone does not establish that authority.
4. The coordinator receives only an opaque, purpose-bound reference and whether the required field is available. A deterministic submitter supplies the actual value only to the tested required field/recipient after checking the current mandate, request/packet version, consent, supported-route applicability and provider permission. The agency determines benefit eligibility; optional preparation or identity checks must not delay a valid minimum filing. The model never receives the plaintext identifier.
5. Routine permitted reuse, correction delivery and follow-up within that recorded scope do not require repeated parent approval. A new source, recipient/purpose, expanded data scope or provider-required personal authentication/signature requires only the genuinely necessary step. Withdrawal, cancellation, expiry, offboarding or superseded facts stop future affected access.

Do not invent an SSN, signature or verification result. A prefilled value retains its source and verification status; an editable submitted profile is not independent identity proof. Only an actual provider receipt advances application status.

## Protected storage, delivery and retention requirements

Prefer provider-hosted entry or a managed tokenization service so CaseLink avoids holding raw identifiers. If delegated execution genuinely requires CaseLink persistence, use authenticated field encryption with managed envelope keys: encrypted values/storage and key-management permissions are separate, with narrowly scoped capture and just-in-time submission identities. Keys must not live beside ciphertext, in the general web runtime, or in model-worker configuration. RLS remains necessary but does not replace this separation. A bare hash of an SSN is unsuitable for storage protection or reusable form filling; its small possible-value space also makes an unkeyed digest unsafe as an identifier commitment.

Bind a handle to the exact subject/acting authority, request, purpose, named recipient, field, allowed operation, version and expiry. No general parent/partner/staff decryption API, browser storage, session replay, analytics payload, URL/query value, error echo or content-bearing security log. Authenticate narrowly scoped rights access; show presence/masked values in routine views. Record content-free access and delivery evidence. Key failure, revoked consent, changed fields and uncertain delivery fail safely without losing non-sensitive preparation or blindly resubmitting.

Set retention for the particular action before capture. Prefer no raw persistence; otherwise use the shortest justified collection-to-submission/reconciliation window, with actual cleanup, failure alerts and backup/restore handling. Do not inherit the general active-plus-90-day household retention or create an indefinite identity vault. CaseLink deletion does not establish vendor/recipient deletion; document their terms and evidence separately.

A final form and an authorized original attachment may necessarily contain the required identifier. Validate attachments against the actual recipient's requirements, redact optional/unrelated identifiers where appropriate, and prevent raw pages from entering AI context. Prefer assembling sensitive final bytes in the isolated submitter and transmitting without ordinary disk/cache copies. If the exact canonical attempted/submitted packet must be retained for evidence or family rights, store it separately encrypted with restricted retrieval, explicit expiry/retention justification and a secure authenticated access/export path. Keep routine previews/exports redacted, while preserving the immutable authoritative version and accurate receipt linkage. Do not silently redact the actual required submitted field or falsely call a redacted preview the exact full packet.

## Accidental identifiers in chat

The intended improvement is to preserve the family's question rather than reject the whole conversation. Before persistence or model dispatch, detect and remove the sensitive span, show a clear sanitized preview/notice, and continue with the remaining useful question. Repeat protection at the server/database boundary; a client-only regex is insufficient. Never echo the detected value in validation errors, notifications or logs. Detection is a safeguard, not proof that all possible identifiers are recognized.

Do not silently save a pasted SSN into a vault or application: that changes purpose without explaining the channel. If the current verified application needs it, offer the actual secure field; otherwise save no identifier. If the message contains only the identifier, explain that nothing was saved and offer the appropriate secure step instead of spending a model call. A legitimate application reference or other reviewed structured field is handled according to its field contract, not rejected merely for resembling an SSN. This sanitizing chat behavior is a requirement; the current implemented behavior still rejects detected input.

## Optional Plaid prefill: researched, unconnected

Plaid Layer is a candidate for reducing entry, not an arbitrary identity lookup by phone. Its phone-first experience is for eligible remembered profiles, uses authentication/risk checks and user sharing; additional information or manual fallback may be needed. Bank connection must not become a prerequisite for assistance. [Plaid Layer overview](https://plaid.com/docs/layer/).

Its integration uses a server-created session/Link token, the parent's completed Link flow, then server redemption of the returned token. Bind that session to the authenticated CaseLink parent and exact acquisition purpose; verify server state/authenticated webhooks rather than trust an unsigned browser callback. [Layer integration guide](https://plaid.com/docs/layer/add-to-app/).

The Layer session response can return nullable full `identity.ssn` and last-four fields. The identity is editable user-submitted information and is explicitly unverified; it is not a token-only or verified-identity guarantee. Restrict requested/retained fields and route any returned identifier straight into the protected boundary, never a model prompt or general profile. [Layer API](https://plaid.com/docs/api/products/layer/).

Before integration, verify CaseLink's actual product access, permitted benefits-form purpose and onward sharing, agreement, pricing, retention/redaction, subprocessors and failure behavior. Plaid's public Developer Policy restricts distribution of end-user data without its prior written permission; public API documentation alone does not establish the permission needed for CaseLink's proposed recipient use. [Plaid Developer Policy](https://plaid.com/legal/#developer-policy). No Plaid account, credential, contract or production access has been established in this work. Keep manual/direct-provider entry and do not guess missing values or introduce unnecessary financial/identity checks.

## Delivery phases and acceptance

1. **Verify one actual required-field route.** Establish the accepted form/version, required versus optional identifier, secure capture/delivery permission, subject authority, necessary personal acts, receipt/reconciliation and data/processor decision. Continue other MVP work independently.
2. **Implement that narrow protected path.** Add actual capture/token handling, minimal purpose records, deterministic field injection, final-artifact/export treatment and monitored deletion. Preserve existing guards elsewhere. Do not enable a placeholder collector or create a generic vault before an accepted recipient channel exists.
3. **Add optional approved prefill if it reduces family effort.** Prove sandbox field/identity/consent and callback handling, manual fallbacks, minimized retrieval and deletion; then obtain the actual live-use/operating evidence. Measure family effort and completion rather than mandate a new provider.

Required runnable checks include:

- A provider-required valid identifier is accepted in the protected field; optional values are not requested; wrong subject/recipient/purpose/version and direct API/RPC bypasses are denied.
- Model payloads, chat, normal request/operation tables, routine exports, logs/errors, browser caches and analytics contain no raw identifier; accidental-chat questions survive safe sanitization, including formatted/Unicode variants and identifier-only messages.
- Keys and ciphertext have separate access; token theft/replay, cross-household access, revoked consent, concurrent cancellation, offboarding, expiry, rotation/key outage and ambiguous delivery cannot authorize reuse or duplicate submission.
- Required form bytes contain the correct value only at the permitted field; unrelated/personal signature fields remain protected. Canonical packet integrity, routine redaction, secure rights retrieval, attachment validation and actual deletion/restore controls work end to end.
- Optional Plaid prefill, if selected, verifies the server-bound completed session, handles absent/unverified/edited values honestly, provides manual fallback and never treats phone knowledge, client success or bank connection as blanket identity/application authority.

Extend the existing parent policy/forms/assistant/document/worker/SQL/API, PDF rendering, real Auth/Storage, retention/backup and secret-canary checks. Keep legacy isolation regressions. Review correctness, privacy/security, accessibility, performance and regressions, then run the separate Ponytail reuse/deletion pass. These requirements and synthetic tests do not establish legal compliance, processor erasure or zero breach risk.
