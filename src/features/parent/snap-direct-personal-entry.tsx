"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import { assessSnapApplicationSnapshot, type SnapApplicationSnapshot } from "@/lib/parent/snap-application-snapshot";
import { snapCaptureContextSchema, type SnapCaptureContext } from "@/lib/parent/snap-capture-context";
import { snapCaptureProgressSchema } from "@/lib/parent/snap-capture-progress";
import { snapDirectAcquisitionResultSchema, type SnapDirectAcquisitionResult } from "@/lib/parent/snap-direct-acquisition-contract";
import { snapPacketAuthorizationResultSchema } from "@/lib/parent/snap-packet-contract";
import { completeSnapDirectCompletionInBrowser } from "@/lib/parent/snap-direct-completion-browser";
import { parseSnapDirectCompletionInputs, type SnapDirectCompletion } from "@/lib/parent/snap-direct-completion-core";
import { sendSnapDirectCompletion } from "@/lib/parent/snap-direct-completion-transport";
import { loadSnapSigningCopyFile } from "@/lib/parent/snap-signing-copy-file";
import { boundedParentApi } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { SnapPersonalDrawing } from "./snap-personal-drawing";
import { SnapPreparedApplication } from "./snap-prepared-application";
import { SnapReviewPdf } from "./snap-review-pdf";
import { isSnapFinalReviewAction } from "./support-activity";
import source from "../../../data/verified-forms/snap-pa600fs-2019.json";
import styles from "./parent.module.css";
import { permissionWindowCurrent, usePermissionWindow } from "./use-permission-window";

const captureReply = z.object({ ok: z.literal(true), capture: snapCaptureProgressSchema.nullable() }).strict();
const acquisitionReply = z.object({ ok: z.literal(true), acquisition: snapDirectAcquisitionResultSchema }).strict();
const packetReply = z.object({ ok: z.literal(true), authorization: snapPacketAuthorizationResultSchema.nullable() }).strict();
const errorText = "The personal steps need checking. Your saved application answers are unchanged. Check the current request before entering personal information again.";
const drawingActs = ["applicant_signature_printed_page_1", "rights_certification_printed_page_5"] as const;
type Drawing = SnapDirectCompletion["certifications"][number];
type SigningCopy = Awaited<ReturnType<typeof loadSnapSigningCopyFile>>;
function clearInputs(form: HTMLFormElement | null) {
  for (const input of form?.querySelectorAll("input") ?? []) { input.value = ""; input.defaultValue = ""; input.checked = false; input.defaultChecked = false; }
}

/** The caller must obtain informed acquisition permission first. This component cannot grant or expand it. */
export function SnapDirectPersonalEntry({ request: requestProp, snapshot: snapshotProp, context: contextProp, acquisition: acquisitionProp, onChange, onRecovery }: {
  request: SupportRequest; snapshot: SnapApplicationSnapshot; context: SnapCaptureContext;
  acquisition: SnapDirectAcquisitionResult; onChange?: () => void; onRecovery: () => void;
}) {
  const [revision, setRevision] = useState(0);
  // Status polling must not erase personal work when its actual authorization and application are unchanged.
  const serialized = JSON.stringify({ request: { id: requestProp.id, version: requestProp.version, status: requestProp.status,
    intake: { needs: requestProp.intake.needs }, mandate: requestProp.mandate, controlled_test: !!requestProp.controlled_test,
    required_actions: requestProp.required_actions.filter(isSnapFinalReviewAction) }, snapshot: snapshotProp, context: contextProp, acquisition: acquisitionProp, revision });
  const scope = useMemo(() => JSON.parse(serialized) as {
    request: Pick<SupportRequest, "id" | "version" | "status" | "mandate" | "required_actions" | "controlled_test"> & { intake: Pick<SupportRequest["intake"], "needs"> };
    snapshot: SnapApplicationSnapshot; context: SnapCaptureContext; acquisition: SnapDirectAcquisitionResult; revision: number;
  }, [serialized]);
  const { request, snapshot, context, acquisition } = scope;
  const form = useRef<HTMLFormElement>(null), work = useRef<AbortController | null>(null), finishing = useRef<AbortController | null>(null), attemptedVersion = useRef<string | null>(null);
  const versionKey = `${request.id}:${request.version}`;
  const bindForm = useCallback((node: HTMLFormElement | null) => {
    form.current = node;
    return () => { clearInputs(node); if (form.current === node) form.current = null; };
  }, []);
  const [ready, setReady] = useState<{ scope: typeof scope; copy: SigningCopy; blob: Blob } | null>(null);
  const [state, setState] = useState<{ scope: typeof scope; kind: "loading" | "existing" | "error" | "unsupported" } | null>(null);
  const [pending, setPending] = useState(false), [identifiers, setIdentifiers] = useState<Record<string, string>>({});
  const [deferredIdentifiers, setDeferredIdentifiers] = useState<Record<string, boolean>>({});
  const [drawings, setDrawings] = useState<Partial<Record<typeof drawingActs[number], Drawing>>>({});
  const [pages, setPages] = useState<Partial<Record<typeof drawingActs[number], boolean>>>({});
  const pageReady = useMemo(() => Object.fromEntries(drawingActs.map((act, index) => [act, (value: boolean, pageNumber?: number) => setPages(values => ({ ...values, [act]: values[act] || value && pageNumber === (index ? 7 : 3) }))])) as Record<typeof drawingActs[number], (value: boolean, pageNumber?: number) => void>, []);
  let permitted = false, deadline = 0, consentedAt = NaN;
  try {
    const grant = snapDirectAcquisitionResultSchema.parse(acquisition), current = snapCaptureContextSchema.parse(context);
    const assessment = assessSnapApplicationSnapshot(snapshot, new Date());
    const people = assessment.snapshot.details.household ?? [];
    permitted = grant.state === "authorized" && request.status === "active" && request.intake.needs.includes("snap_new")
      && !request.required_actions.some(isSnapFinalReviewAction)
      && request.mandate.recipientIds.includes("snap-pa") && request.mandate.allowedActions.includes("prepare")
      && request.mandate.allowedData.includes("household") && request.mandate.allowedData.includes("income")
      && grant.requestId === request.id && grant.requestVersion === request.version && grant.snapshotId === snapshot.id
      && grant.snapshotHash === current.snapshotHash && current.requestVersion === request.version && current.snapshotId === snapshot.id
      && snapshot.request_id === request.id && snapshot.request_version <= request.version && assessment.readiness.nonProtectedDataReadyForReview
      && JSON.stringify(grant.source) === JSON.stringify(current.source)
      && JSON.stringify(current.source) === JSON.stringify(snapCaptureContextSchema.shape.source.parse(snapshot.source))
      && [...grant.subjectIds].sort().join() === [...current.applyingSubjectIds].sort().join()
      && [...current.applyingSubjectIds].sort().join() === people.filter(person => person.requestingSnap).map(person => person.id.toLowerCase()).sort().join();
    consentedAt = grant.state === "authorized" ? Date.parse(grant.consentedAt) : NaN;
    deadline = Math.min(Date.parse(request.mandate.expiresAt), Date.parse(grant.expiresAt), Date.parse(source.verifiedUntil));
  } catch { /* No private input mounts from incomplete or changed permission metadata. */ }
  const timeCurrent = usePermissionWindow(deadline, consentedAt);
  permitted = permitted && timeCurrent;
  const people = snapshot?.details?.household ?? [], applicants = people.filter(person => person.requestingSnap);
  const suppliedNumbers = applicants.filter(person => !deferredIdentifiers[person.id]).map(person => identifiers[person.id] ?? "").filter(value => /^[0-9]{9}$/.test(value));
  const duplicateNumbers = new Set(suppliedNumbers).size !== suppliedNumbers.length;
  const supported = !snapshot?.details?.authorizedRepresentative && !applicants.some(person => person.citizen === false)
    && people.length <= source.limits.householdRows && (snapshot?.details?.income?.entries?.length ?? 0) <= source.limits.incomeRows;
  const expiresAt = Number.isFinite(deadline) && deadline > 0 ? new Date(deadline).toISOString() : "";
  const [previousSession, setPreviousSession] = useState({ scope, permitted, supported });
  if (previousSession.scope !== scope || previousSession.permitted !== permitted || previousSession.supported !== supported) {
    setPreviousSession({ scope, permitted, supported });
    setIdentifiers({});setDeferredIdentifiers({});setDrawings({});setPages({});setReady(null);setPending(false);setState(null);
  }
  const active = ready?.scope === scope && permitted && supported && (!state || state.scope !== scope || state.kind === "loading");

  useLayoutEffect(() => {
    const controller = new AbortController(); work.current = controller;
    let bytes: Uint8Array | undefined;
    const clear = () => { clearInputs(form.current); setIdentifiers({}); setDeferredIdentifiers({}); setDrawings({}); setPages({}); setReady(null); bytes?.fill(0); };
    if (!permitted || !supported || acquisition.state !== "authorized") return () => { controller.abort(); bytes?.fill(0); };
    const stop = () => { controller.abort(); clear(); setPending(false); setState({ scope, kind: "error" }); };
    const timer = setTimeout(stop, Math.max(0, Math.min(2147483647, deadline - Date.now())));
    const refresh = () => {
      if (attemptedVersion.current === versionKey) { clear(); setState({ scope, kind: "existing" }); }
      else setRevision(value => value + 1);
    };
    window.addEventListener("focus", refresh); window.addEventListener("pageshow", refresh);
    const api = async (path: string) => {
      const value = await boundedParentApi(path, {}, controller.signal, expiresAt);
      controller.signal.throwIfAborted(); return value;
    };
    void (async () => {
      try {
        const capture = captureReply.parse(await api(`/requests/${request.id}/snap-application/capture?expectedVersion=${request.version}`)).capture;
        if (capture || attemptedVersion.current === versionKey) { setState({ scope, kind: "existing" }); return; }
        const query = new URLSearchParams({ expectedVersion: String(request.version), snapshotId: snapshot.id, snapshotHash: context.snapshotHash });
        const fresh = acquisitionReply.parse(await api(`/requests/${request.id}/snap-acquisition?${query}`)).acquisition;
        if (JSON.stringify(fresh) !== JSON.stringify(snapDirectAcquisitionResultSchema.parse(acquisition))) throw new Error();
        const registered = packetReply.parse(await api(`/requests/${request.id}/snap-direct-packet?${query}`)).authorization;
        if (registered) { setState({ scope, kind: "existing" }); return; }
        const copy = await loadSnapSigningCopyFile({ requestId: request.id, requestVersion: request.version, status: request.status,
          mandate: request.mandate, context, snapshot }, controller.signal);
        bytes = copy.bytes;
        if (controller.signal.aborted || Date.now() >= deadline) { bytes.fill(0); return; }
        setReady({ scope, copy, blob: new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }) });
      } catch { if (!controller.signal.aborted) { clear(); setState({ scope, kind: "error" }); } }
    })();
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); bytes?.fill(0); };
  }, [scope, permitted, supported, acquisition, context, snapshot, request, deadline, expiresAt, versionKey]);

  function recover() {
    work.current?.abort(); ready?.copy.bytes.fill(0); clearInputs(form.current); setIdentifiers({}); setDeferredIdentifiers({}); setDrawings({}); setReady(null); setPending(false);
    setState({ scope, kind: "error" }); onRecovery();
  }
  async function finish(event: FormEvent) {
    event.preventDefault();
    if (!active || !ready || pending || acquisition.state !== "authorized" || !work.current || work.current.signal.aborted || finishing.current === work.current) return;
    const controller = work.current, copy = ready.copy;
    const completion: SnapDirectCompletion = { requestId: request.id, requestVersion: request.version, snapshotId: snapshot.id,
      snapshotHash: context.snapshotHash, source: context.source, unsignedContentSha256: copy.trusted.unsignedContentSha256,
      signingRoute: "applicant_name_handwriting", identifiers: applicants.map(person => request.controlled_test || deferredIdentifiers[person.id]
        ? { personId: person.id.toLowerCase(), kind: "provide_to_agency_later" } : { personId: person.id.toLowerCase(), kind: "ssn", value: identifiers[person.id] ?? "" }),
      certifications: drawingActs.map(act => drawings[act]!).filter(Boolean) };
    if (!drawingActs.every(act => pages[act]) || !parseSnapDirectCompletionInputs(copy.trusted, completion, new Date()).ok) return;
    finishing.current = controller; setPending(true);
    let candidate: Uint8Array | null = null, registeredAttempt = false;
    try {
      const result = await completeSnapDirectCompletionInBrowser(copy.bytes, copy.trusted, completion, new Date(), { signal: controller.signal });
      candidate = result.bytes;
      controller.signal.throwIfAborted();
      if (!result.bytes || !permissionWindowCurrent(deadline)) throw new Error();
      const packetId = crypto.randomUUID();
      const posted = { expectedVersion: request.version, snapshotId: snapshot.id, snapshotHash: context.snapshotHash, packetId,
        acquisitionId: acquisition.acquisitionId, contentSha256: result.contentSha256, byteLength: result.byteLength };
      registeredAttempt = true; attemptedVersion.current = versionKey;
      const value = packetReply.parse(await boundedParentApi(`/requests/${request.id}/snap-direct-packet`, {
        method: "POST", body: JSON.stringify(posted),
      }, controller.signal, expiresAt)).authorization;
      controller.signal.throwIfAborted();
      if (!value || value.intent.ownerId !== acquisition.ownerId || value.intent.requestId !== request.id || value.intent.requestVersion !== request.version
        || value.intent.packetId !== packetId || value.intent.snapshotId !== snapshot.id || value.intent.snapshotHash !== context.snapshotHash
        || value.intent.contentSha256 !== result.contentSha256 || value.intent.byteLength !== result.byteLength
        || value.intent.policyVersion !== acquisition.policyVersion || value.intent.retentionPolicyVersion !== acquisition.retentionPolicyVersion
        || value.consentedAt !== acquisition.consentedAt || Date.parse(value.authorizationExpiresAt) > deadline || !permissionWindowCurrent(Date.parse(value.authorizationExpiresAt))
        || [...value.subjectIds].sort().join() !== [...acquisition.subjectIds].sort().join()) throw new Error();
      await sendSnapDirectCompletion({ ownerId: acquisition.ownerId, requestId: request.id, expectedVersion: request.version, packetId,
        snapshotId: snapshot.id, snapshotHash: context.snapshotHash }, value, copy.trusted, completion, { signal: controller.signal });
      if (!controller.signal.aborted) { setState({ scope, kind: "existing" }); onChange?.(); }
    } catch { if (!controller.signal.aborted) { setState({ scope, kind: registeredAttempt ? "existing" : "error" }); if (registeredAttempt) onChange?.(); } }
    finally {
      if (finishing.current === controller) finishing.current = null;
      candidate?.fill(0); copy.bytes.fill(0);
      if (work.current === controller) { clearInputs(form.current); setIdentifiers({}); setDeferredIdentifiers({}); setDrawings({}); setReady(null); if (!controller.signal.aborted) setPending(false); }
    }
  }
  if (!permitted) return null;
  if (state?.scope === scope && state.kind === "existing") return <SnapPreparedApplication request={requestProp} snapshot={snapshot} onChange={onChange}/>;
  if (!supported || state?.scope === scope && state.kind === "unsupported") return <div className={styles.notice}><p>CaseLink needs to resolve this application’s personal steps before asking for protected information.</p><button type="button" className={styles.quiet} onClick={recover}>Get help with personal steps</button></div>;
  if (state?.scope === scope && state.kind === "error") return <div className={styles.space}><ServiceError error={new Error(errorText)} retry={() => setRevision(value => value + 1)} returnTo={`/support/${request.id}`}/><button type="button" className={styles.quiet} onClick={recover}>Get help with personal steps</button></div>;
  if (!active || !ready) return <ParentLoading label="Preparing the protected personal steps"/>;
  return <form ref={bindForm} className={styles.space} onSubmit={finish} autoComplete="off">
    <h3>Personal steps for your SNAP application</h3>
    <p className={styles.hint}>{request.controlled_test ? "Your saved fictional answers are already included. Draw test marks below to prepare a private test PDF, then review it and choose the free-emulator Submit separately." : "Your saved answers are already included. Add numbers only for people applying for SNAP, or choose to provide them to DHS later. Make your own certifications below. These entries stay out of chat, AI and ordinary household records. Finishing these steps stores the exact application privately; you review it and choose Submit separately."}</p>
    <fieldset disabled={pending} className={`${styles.fieldset} ${styles.space} ${styles.stack}`}>
      <legend className={styles.legend}>Applicant information</legend>
      {request.controlled_test && <p className={styles.notice}>Fictional test only. No Social Security numbers are collected. Draw test marks below; these do not certify a real application or represent anyone’s signature.</p>}
      {!request.controlled_test && applicants.map(person => <div className={styles.space} key={person.id}><label className={styles.field}>{person.firstName} {person.lastName} — Social Security number
        <input className={styles.input} type="password" inputMode="numeric" autoComplete="off" required={!deferredIdentifiers[person.id]} disabled={pending || deferredIdentifiers[person.id]} pattern="[0-9]{9}" maxLength={11}
          value={identifiers[person.id] ?? ""} onChange={event => setIdentifiers(values => ({ ...values, [person.id]: event.target.value.replace(/[ -]/g, "") }))}/>
      </label><label className={styles.checkbox}><input type="checkbox" checked={deferredIdentifiers[person.id] ?? false} onChange={event => {
        const deferred = event.currentTarget.checked;
        setDeferredIdentifiers(values => ({ ...values, [person.id]: deferred }));
        setIdentifiers(values => ({ ...values, [person.id]: "" }));
      }}/>Provide {person.firstName} {person.lastName}’s number to DHS later</label></div>)}
      <p className={styles.hint}>A missing number does not prevent an initial filing. A number left for later stays blank on the form; DHS may ask for missing information before deciding eligibility. Do not invent a number.</p>
      {duplicateNumbers && <p className={styles.notice} role="alert">The same number is entered for more than one applicant. Check the entries, or provide a number to DHS later.</p>}
      {drawingActs.map((act, index) => <div className={styles.space} key={act}>
        <h4>{index ? "Rights and responsibilities — printed page 5" : "Applicant certification — printed page 1"}</h4>
        <SnapReviewPdf source={ready.blob} initialPage={index ? 7 : 3} onReady={pageReady[act]}/>
        <SnapPersonalDrawing actId={act} label={index ? "Your rights and responsibilities certification" : "Your applicant certification"}
          instructions={request.controlled_test ? "Review this fictional example, then draw a simple test mark below. This is not a real signature or certification." : "Read the exact official page above, then write your own name below. CaseLink cannot sign for you."}
          expiresAt={expiresAt} disabled={pending || !pages[act]} onRecovery={recover}
          onChange={value => setDrawings(values => ({ ...values, [act]: value ?? undefined }))}/>
      </div>)}
      <button className={styles.button} type="submit" disabled={pending || duplicateNumbers || !applicants.every(person => request.controlled_test || deferredIdentifiers[person.id] || /^[0-9]{9}$/.test(identifiers[person.id] ?? "")) || !drawingActs.every(act => drawings[act] && pages[act])}>
        {pending ? "Preparing your exact application…" : "Finish personal steps"}
      </button>
      <button className={styles.quiet} type="button" onClick={recover}>Get help with personal steps</button>
    </fieldset>
  </form>;
}
