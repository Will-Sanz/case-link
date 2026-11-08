import { createHash } from "node:crypto";
import { SNAP_DRAFT_CONTRACT } from "./snap-draft";
import { SNAP_PERSONAL_PAGE_MAP } from "./snap-personal-pages";
import { renderSnapSigningCopy } from "./snap-signing-copy";
import { completeSnapDirectCompletionCopy, parseSnapDirectCompletionInputs, snapDirectCompletionUnavailable, type SnapDirectCompletionResult } from "./snap-direct-completion-core";

export { SNAP_DIRECT_COMPLETION_VERSION } from "./snap-direct-completion-core";
export type { SnapDirectCompletionContext, SnapDirectCompletion, SnapDirectCompletionResult } from "./snap-direct-completion-core";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Isolated caller only: obtain acquisition authority/current DB context and genuine fresh input before calling.
 * This pure renderer neither authenticates that caller nor establishes signature acceptance or human origin. */
export async function renderSnapDirectCompletion(template: Uint8Array, trustedInput: unknown, completionInput: unknown, now: Date): Promise<SnapDirectCompletionResult> {
  let templateCopy: Uint8Array | undefined, unsigned: Uint8Array | undefined;
  try {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !(template instanceof Uint8Array)
      || template.length !== SNAP_DRAFT_CONTRACT.byteLength) return snapDirectCompletionUnavailable("invalid_completion");
    templateCopy = Uint8Array.from(template);
    if (digest(templateCopy) !== SNAP_PERSONAL_PAGE_MAP.source.templateSha256) return snapDirectCompletionUnavailable("scope_changed");
    const at = new Date(now.getTime()), input = parseSnapDirectCompletionInputs(trustedInput, completionInput, at);
    if (!input.ok) return input.result;
    const copy = await renderSnapSigningCopy(templateCopy, input.snapshot.details, input.preparedAt);
    unsigned = copy.bytes ?? undefined;
    if (!unsigned || !copy.readiness.nonProtectedDataReadyForReview) return snapDirectCompletionUnavailable("unsupported_layout");
    if (digest(unsigned) !== input.trusted.unsignedContentSha256) return snapDirectCompletionUnavailable("scope_changed");
    return await completeSnapDirectCompletionCopy(unsigned, input.trusted, input.completion, at);
  } catch { return snapDirectCompletionUnavailable("invalid_completion"); }
  finally { templateCopy?.fill(0); unsigned?.fill(0); }
}
