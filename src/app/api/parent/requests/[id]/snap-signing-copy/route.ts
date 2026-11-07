import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getSnapCaptureContext } from "@/lib/parent/snap-capture-data";
import { snapCaptureQuery } from "@/lib/parent/snap-capture-context";
import { getSnapApplicationDetails } from "@/lib/parent/snap-application-data";
import { assessSnapApplicationSnapshot } from "@/lib/parent/snap-application-snapshot";
import { renderSnapSigningCopy } from "@/lib/parent/snap-signing-copy";
import { parentError, parentJson, requireSameOrigin, uuidSchema } from "@/lib/parent/http";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let bytes: Uint8Array | undefined;
  try {
    if (request.headers.has("origin")) requireSameOrigin(request);
    if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) throw new Error("parent_origin_denied");
    const id = uuidSchema.parse((await params).id).toLowerCase(), scope = snapCaptureQuery(new URL(request.url));
    const context = await getSnapCaptureContext(id, scope);
    const snapshot = await getSnapApplicationDetails(id, context.snapshotId), now = new Date();
    if (!snapshot || snapshot.request_id !== id || snapshot.id !== context.snapshotId || snapshot.request_version > context.requestVersion)
      throw new Error("This request changed. Reload it before using the prepared application.");
    const preparedAt = new Date(snapshot.created_at);
    if (!Number.isFinite(preparedAt.getTime()) || preparedAt > now)
      throw new Error("This request changed. Reload it before using the prepared application.");
    const assessment = assessSnapApplicationSnapshot(snapshot, now);
    if (snapshot.details.household?.filter(person => person.requestingSnap).map(person => person.id.toLowerCase()).sort().join() !== [...context.applyingSubjectIds].sort().join())
      throw new Error("This request changed. Reload it before using the prepared application.");
    if (!assessment.readiness.nonProtectedDataReadyForReview)
      return parentJson({ ok: false, error: "Your application needs an answer or correction before the official signing copy can be prepared." }, 409);
    const result = await renderSnapSigningCopy(await readFile(join(process.cwd(), "data/verified-forms/snap-pa600fs-2019.pdf")), assessment.snapshot.details, preparedAt);
    bytes = result.bytes ?? undefined;
    if (!bytes || !result.readiness.nonProtectedDataReadyForReview)
      return parentJson({ ok: false, error: "CaseLink needs to resolve the official form layout before preparing this signing copy." }, 409);
    const latest = await getSnapCaptureContext(id, scope);
    if (latest.snapshotHash !== context.snapshotHash) throw new Error("This request changed. Reload it before using the prepared application.");
    // These headers describe the unsigned preparation; they grant no protected capture or submission authority.
    return new Response(Uint8Array.from(bytes), { headers: {
      "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Content-Disposition": 'attachment; filename="caselink-snap-signing-copy.pdf"',
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "X-CaseLink-SNAP-Unsigned-Byte-Length": String(bytes.length),
      "X-CaseLink-SNAP-Prepared-At": preparedAt.toISOString(), "X-CaseLink-SNAP-Unsigned-SHA256": createHash("sha256").update(bytes).digest("hex"),
    } });
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
  finally { bytes?.fill(0); }
}
