"use client";
import type { SupportRequest } from "@/lib/parent/domain";
import type { SnapProtectedOperation } from "@/lib/parent/snap-protected-operation";
import { assessSnapApplicationSnapshot } from "@/lib/parent/snap-application-snapshot";
import { useParentResource } from "./use-parent-resource";
import styles from "./parent.module.css";

export function SnapDecisionSummary({ request, review }: { request: SupportRequest; review: SnapProtectedOperation }) {
  const ref = review.packet.protectedSnapPacket;
  const saved = useParentResource<{ snapshot: unknown }>(`/requests/${request.id}/snap-application?revision=${ref.snapshotId}&requestVersion=${request.version}`);
  let assessment: ReturnType<typeof assessSnapApplicationSnapshot> | undefined;
  try {
    if (!saved.loading && !saved.error) {
      const value = assessSnapApplicationSnapshot(saved.data?.snapshot, new Date());
      if (value.snapshot.id === ref.snapshotId && value.snapshot.request_id === request.id && value.snapshot.request_version <= request.version) assessment = value;
    }
  } catch { /* Only a validated revision bound to this exact packet may supply the summary. */ }
  const ready = assessment?.readiness.nonProtectedDataReadyForReview;
  const facts = ready ? assessment?.snapshot.details : undefined;
  const unresolved = request.required_actions.filter(action => !action.resolved && action.field !== "snap_final_submit");
  return <section className={styles.notice} aria-label="Application decision summary">
    <div>
    <h3>Before you decide</h3>
    <p>This summary uses the saved answers for application version {request.version}. Check the exact PDF below for every answer and personal page; this summary does not replace it.</p>
    {facts ? <dl className={styles.factList}>
      <dt>Household</dt><dd>{facts.household?.length} {facts.household?.length === 1 ? "person" : "people"}; {facts.household?.filter(person => person.requestingSnap).length} requesting SNAP</dd>
      <dt>Location</dt><dd>{facts.county} County · {facts.zip}</dd>
      <dt>Income period</dt><dd>{facts.income?.month}: {facts.income?.hasIncome ? "Income is listed in the application" : "No income reported"}</dd>
      <dt>Language</dt><dd>{facts.language === "es" ? "Spanish" : "English"}{facts.interpreter ? "; interpreter requested" : ""}</dd>
    </dl> : <p>{saved.loading ? "Checking the saved application facts…" : "The summary cannot verify the current application facts. Use the exact PDF and saved-answer controls; do not rely on an earlier summary."}</p>}
    <p><strong>Unresolved issues:</strong> {unresolved.length ? unresolved.map(action => action.title).join(" · ") : !ready || !review.protectedPacketCurrent || !review.protectedParentSubmitReady ? "Application readiness still needs checking." : "No additional issue is recorded. This does not establish eligibility or an agency decision."}</p>
    <p><strong>What Submit authorizes:</strong> {request.controlled_test ? "The fictional application goes only to the free fax emulator. It is not an agency filing." : "Send this exact application to Pennsylvania SNAP under your current permission. Submit records your decision and personal-step confirmation; it does not establish delivery, approval or benefits received."}</p>
    </div>
  </section>;
}
