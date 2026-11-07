"use client";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import { SNAP_APPLICATION_NOTICE_VERSION } from "@/lib/parent/constants";
import { assessSnapApplicationFields, snapApplicationFieldsValueSchema, type SnapApplicationFields } from "@/lib/parent/snap-application-fields";
import { assessSnapApplicationSnapshot, snapApplicationLeaves, type SnapApplicationSnapshot } from "@/lib/parent/snap-application-snapshot";
import { boundedParentApi, canCollectSnapApplication, displayDate, ParentApiError, type ParentAuthorizationWindow } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import { SnapApplicationFormFields, SnapApplicationSummary } from "./snap-application-form";
import { SnapProtectedApplication } from "./snap-protected-application";
import { isSnapFinalReviewAction } from "./support-activity";
import formSource from "../../../data/verified-forms/snap-pa600fs-2019.json";
import styles from "./parent.module.css";
import { usePermissionWindow } from "./use-permission-window";

export function SnapApplicationNotice() {
  return <div className={styles.notice}><p>
    These questions follow the <a className={styles.textLink} href={formSource.sourceUrl}>reviewed Pennsylvania SNAP form</a>.
    CaseLink saves your name, address, household members’ birth dates and application answers,
    including applicable income, medical and other expenses, citizenship and criminal-history or benefit-disqualification answers, for your Pennsylvania SNAP request.
    They stay separate from chat and ordinary support facts. CaseLink keeps application details while your request
    is active and for up to 90 days afterward under the <Link className={styles.textLink} href="/support/privacy#snap-application">SNAP data notice</Link>.
    Do not enter Social Security numbers, passwords, EBT PINs or signatures here. Required identifiers and genuine
    certifications need the protected official-program step. This does not appoint CaseLink as your representative or submit an application.
    CaseLink saves these answers when you authorize and start support or save a correction.
  </p></div>;
}

function questionPaths(paths: string[], value: SnapApplicationFields): string[] {
  const self = value.household?.[0];
  return [...new Set(paths.flatMap(path => {
    if (path === "householdSize" || path === "household.count_consistency" || path === `household.${self?.id}.relationship`) return [];
    if (path === "household") return ["household", "applicant"];
    if (path === "household.applicants") return value.household?.map(person => `household.${person.id}.requestingSnap`) ?? ["household"];
    if (self && ["firstName", "lastName", "middleInitial"].some(field => path === `household.${self.id}.${field}`)) return [`applicant.${path.split('.').at(-1)}`];
    if (path === "income.month") return ["income"];
    if (path === "income") return [value.income?.hasIncome === true ? "income.entries" : "income.hasIncome"];
    return [path];
  }))];
}
function editableDetails(value: SnapApplicationFields): SnapApplicationFields {
  const self = value.household?.[0];
  if (!self) return value;
  const applicant = { firstName: value.applicant?.firstName ?? self.firstName, lastName: value.applicant?.lastName ?? self.lastName,
    middleInitial: value.applicant?.middleInitial ?? self.middleInitial };
  return { ...value, applicant, household: [{ ...self, ...applicant, relationship: "SELF" }, ...value.household!.slice(1)],
    ...(value.householdSize !== undefined ? { householdSize: value.household!.length } : {}) };
}

export function SnapApplicationReview({ request, onChange, answerRequest = 0 }: { request: SupportRequest; onChange?: () => void; answerRequest?: number }) {
  const [readRevision,setReadRevision]=useState(0);
  const saved = useParentResource<{ snapshot: SnapApplicationSnapshot }>(`/requests/${request.id}/snap-application?requestVersion=${request.version}&read=${readRevision}`);
  const collection = useParentResource<ParentAuthorizationWindow>("/authorization-window");
  const [draft, setDraft] = useState<SnapApplicationFields | null>(null);
  const [base, setBase] = useState<{ id: string; version: number } | null>(null);
  const [pendingWork, setPendingWork] = useState<{ scope: string; controller: AbortController } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const [focused, setFocused] = useState(false);
  const [changingAddress, setChangingAddress] = useState(false);
  const [confirmedPaths, setConfirmedPaths] = useState<string[]>([]);
  const [handledAnswerRequest, setHandledAnswerRequest] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState<{ key: string; body: string } | null>(null);
  const work = useRef<AbortController | null>(null), running = useRef<AbortController | null>(null);
  const refreshSnapshot=()=>setReadRevision(current=>current+1);
  const record = saved.data?.snapshot;
  const mandateDeadline = Date.parse(request.mandate.expiresAt), mandateCurrent = usePermissionWindow(mandateDeadline);
  const scope = JSON.stringify({ id: request.id, version: request.version, status: request.status, needs: request.intake.needs, mandate: request.mandate, snapshotId: record?.id, mandateCurrent });
  const pending = pendingWork?.scope === scope && !pendingWork.controller.signal.aborted;
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    if (attempt) setUncertain(true);
  }
  useLayoutEffect(() => {
    const controller = new AbortController();work.current=controller;
    return()=>{controller.abort();if(work.current===controller)work.current=null;};
  },[scope]);
  let assessment: ReturnType<typeof assessSnapApplicationSnapshot> | undefined;
  try { if (record?.request_id === request.id) assessment = assessSnapApplicationSnapshot(record, new Date()); } catch { /* Invalid evidence cannot establish an editable revision. */ }
  const details = assessment?.snapshot.details;
  const valid = !!assessment;
  const current = valid && !!record && record.request_version <= request.version && !saved.error && !saved.loading;
  const permitted = canCollectSnapApplication(collection.data) && !collection.error && !blocked &&
    request.status === "active" && request.mandate.recipientIds.includes("snap-pa") &&
    request.mandate.allowedActions.includes("prepare") && request.mandate.allowedData.includes("household") &&
    request.mandate.allowedData.includes("income") && mandateCurrent;
  const editingCurrent = !!draft && !!base && base.id === record?.id && base.version === request.version && current;
  const preparedReview = current && permitted && !draft && assessment?.readiness.nonProtectedDataReadyForReview
    && !request.required_actions.some(isSnapFinalReviewAction);
  const originalLeaves = details ? snapApplicationLeaves(details) : {};
  const draftLeaves = draft ? snapApplicationLeaves(draft) : originalLeaves;
  let draftReadiness: ReturnType<typeof assessSnapApplicationFields> | undefined;
  try { if (draft) draftReadiness = assessSnapApplicationFields(draft, new Date()); } catch { /* Partial typing keeps the original questions visible. */ }
  const eligibleStale = (assessment?.readiness.staleFields ?? []).filter(path => Object.hasOwn(draftLeaves, path) &&
    JSON.stringify(draftLeaves[path]) === JSON.stringify(originalLeaves[path]) &&
    !(path.startsWith("income.") && assessment!.readiness.invalidCurrentFields.includes("income.month")));
  const confirmed = confirmedPaths.filter(path => eligibleStale.includes(path));
  const requested = [...(assessment?.readiness.missingFields ?? []), ...(assessment?.readiness.invalidCurrentFields ?? []),
    ...(draftReadiness?.missingFields ?? []), ...(draftReadiness?.invalidCurrentFields ?? [])];
  if (details && assessment?.readiness.serviceQuestions.includes("address_or_provider_accepted_alternative"))
    for (const field of ["street", "city", "state"] as const) if (!details.address?.[field]) requested.push(`address.${field}`);
  if (details && !details.zip) requested.push("zip");
  if (assessment?.readiness.serviceQuestions.includes("record_original_current_month_income_period")) requested.push("income.month");
  const staleQuestions = questionPaths(eligibleStale, draft ?? details ?? {});
  const paths = questionPaths(requested, draft ?? details ?? {});
  const hasQuestions = paths.length > 0;
  const questions = changingAddress ? { paths: ["address", "zip", "county"], stalePaths: [], confirmedPaths: [], onConfirm: () => undefined } : focused ? {
    paths, stalePaths: staleQuestions,
    confirmedPaths: staleQuestions.filter(path => eligibleStale.filter(stale => questionPaths([stale], draft ?? details ?? {}).includes(path)).every(stale => confirmed.includes(stale))),
    onConfirm: (path: string) => {
      const paths = eligibleStale.filter(stale => questionPaths([stale], draft ?? details ?? {}).includes(path));
      setConfirmedPaths(current => paths.every(stale => current.includes(stale)) ? current.filter(stale => !paths.includes(stale)) : [...new Set([...current, ...paths])]);
    },
  } : undefined;
  function edit(addressOnly = false) {
    if (!current || !permitted || !details || !record) return;
    setDraft(editableDetails(details));setBase({ id: record.id, version: request.version });setFocused(false);setChangingAddress(addressOnly);setConfirmedPaths([]);
    setConflict(false);setUncertain(false);setError(null);setMessage("");setAttempt(null);
  }
  if (answerRequest && handledAnswerRequest !== answerRequest && current && permitted && assessment && record) {
    setHandledAnswerRequest(answerRequest);
    setChangingAddress(false);setFocused(true);
    if (!draft) {
      if (!hasQuestions) {
        setMessage("No additional application answers are currently needed. CaseLink needs to recheck this saved step; you do not need to repeat fresh answers.");
      } else {
        setDraft(editableDetails(assessment.snapshot.details));setBase({ id: record.id, version: request.version });setConfirmedPaths([]);
        setConflict(false);setUncertain(false);setError(null);setMessage("");setAttempt(null);
      }
    }
  }
  useEffect(() => {
    if (!handledAnswerRequest) return;
    const target = form.current?.querySelector<HTMLElement>("input,select,button") ?? document.getElementById("application-answers");
    target?.focus();
  }, [handledAnswerRequest]);
  useEffect(() => {
    if (permitted && editingCurrent) form.current?.querySelector<HTMLElement>("input,select,button")?.focus();
    // Focus only when the editor opens; typing must retain the current control.
  }, [base?.id, permitted, editingCurrent]);
  async function recheckAccess() {
    const controller=work.current;
    if(!controller||controller.signal.aborted||running.current===controller||Date.now()>=mandateDeadline)return;
    running.current=controller;
    setPendingWork({ scope, controller });setError(null);
    try {
      const latest=await boundedParentApi("/authorization-window",{},controller.signal,request.mandate.expiresAt);
      if(controller.signal.aborted||work.current!==controller)return;
      const gate=z.object({authorization:z.object({issuedAt:z.string(),expiresAt:z.string(),snapApplication:z.object({collectionEnabled:z.boolean(),noticeVersion:z.string().nullable()}).optional()})}).safeParse(latest);
      if(!gate.success||!canCollectSnapApplication(gate.data))throw new Error("Private SNAP application changes are not available yet. Your unsaved draft is still on this page.");
      refreshSnapshot();collection.reload();setBlocked(false);onChange?.();
    }catch(err){if(!controller.signal.aborted&&work.current===controller){setBlocked(true);setError(err instanceof Error?err:new Error("Your access could not be checked. Your draft remains on this page."));}}
    finally{if(running.current===controller)running.current=null;if(!controller.signal.aborted&&work.current===controller)setPendingWork(null);}
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const controller=work.current;
    if (!draft || !base || !editingCurrent || !permitted || pending || conflict || Date.now()>=mandateDeadline || !controller || controller.signal.aborted || running.current===controller) return;
    running.current=controller;
    setError(null);setPendingWork({ scope, controller });
    try {
      let savedAttempt = attempt;
      if (!savedAttempt) {
        const value=snapApplicationFieldsValueSchema.safeParse(draft);
        if (!value.success) throw new ParentApiError("Check the application answers. Use only these fields’ requested information; protected identifiers and signatures cannot be saved here.",400);
        if (focused && !confirmed.length && JSON.stringify(snapApplicationLeaves(value.data)) === JSON.stringify(originalLeaves))
          throw new ParentApiError("Answer an application question or mark an outdated answer still correct before saving.",400);
        savedAttempt={key:crypto.randomUUID(),body:JSON.stringify({details:value.data,expectedVersion:base.version,noticeVersion:SNAP_APPLICATION_NOTICE_VERSION,...(confirmed.length ? {confirmedPaths:confirmed} : {})})};
        setAttempt(savedAttempt);
      }
      const result=await boundedParentApi(`/requests/${request.id}/snap-application`,{
        method:"POST",headers:{"Idempotency-Key":savedAttempt.key},body:savedAttempt.body,
      },controller.signal,request.mandate.expiresAt);
      if(controller.signal.aborted||work.current!==controller)return;
      if (!z.object({snapshotId:z.uuid()}).safeParse(result).success) throw new ParentApiError("We could not confirm the saved revision. Retry the same save before making another change.",0);
      setDraft(null);setBase(null);setAttempt(null);setUncertain(false);
      setMessage("Your application answers are saved as a new revision. Queued work must use the current revision; earlier submitted records remain in history.");
      refreshSnapshot();onChange?.();
    } catch (err) {
      if(controller.signal.aborted||work.current!==controller)return;
      const failure=err instanceof Error ? err : new Error("Your application answers could not be saved. Your draft remains on this page.");
      setError(failure);
      const status=err instanceof ParentApiError ? err.status : 0;
      setConflict(status===409);
      setUncertain(status<400||status>=500);
      if (status===401||status===403) {setBlocked(true);collection.reload();}
      if (status>=400&&status<500&&status!==409) setAttempt(null);
    } finally {if(running.current===controller)running.current=null;if(!controller.signal.aborted&&work.current===controller)setPendingWork(null);}
  }
  return <section className={styles.section} id="application-answers" aria-labelledby="application-answers-title" tabIndex={-1}>
    <h2 id="application-answers-title">Your SNAP application answers</h2>
    {!mandateCurrent && <p className={styles.notice} role="status">Your application permission has expired or could not be checked. Your unsaved draft remains on this page; saved answers stay readable.</p>}
    {saved.loading ? <ParentLoading label="Loading saved SNAP application"/> : saved.error ?
      saved.error instanceof ParentApiError && saved.error.status===404 ? <p className={styles.hint}>No full SNAP application answers are saved for this request. Your existing support and recorded history remain available.</p> :
      <ServiceError error={saved.error} retry={refreshSnapshot} returnTo={`/support/${request.id}`}/> : !valid || !details || !record ?
      <p className={styles.hint}>A verified saved application revision is unavailable. Check the saved record before using these answers for an application.</p> : <>
        <p className={styles.hint}>Saved revision {record.revision} · {displayDate(record.created_at,true)} · {current ? record.request_version===request.version ? "Matches your current request" : "Latest saved answers checked for this request" : "Updated request is loading"}</p>
        {current && record.request_version<request.version && <p className={styles.hint}>These are the latest saved application answers, checked after the request changed. Their original recorded dates stay unchanged; a correction uses the current request version.</p>}
        {!current && <p className={styles.notice}>This saved application belongs to a newer request version. Refresh the request before editing; your saved answers remain available.</p>}
        <p className={styles.hint}>CaseLink uses these answers to prepare your application. Check them below and correct anything that has changed. Saving answers does not submit an application.</p>
        {draft && !editingCurrent && <div className={styles.notice}><p>The request changed while you were editing. Your unsaved draft has not been applied to this revision. Loading the latest saved application replaces that unsaved draft.</p><button type="button" className={styles.secondary} onClick={()=>{setDraft(null);setBase(null);setError(null);setConflict(false);setUncertain(false);setAttempt(null);refreshSnapshot();onChange?.();}}>Load latest saved application</button></div>}
        {draft && permitted && editingCurrent ? <form className={styles.form} onSubmit={submit} ref={form} aria-label="Correct SNAP application answers">
          <SnapApplicationNotice/>
          {changingAddress && <p className={styles.hint}>Change your address below. Your other saved answers stay unchanged.</p>}
          {focused && <p className={styles.hint}>Only missing or outdated answers are requested here. Change an answer or choose “Still correct” for an outdated value that is unchanged. Fresh saved answers stay unchanged.</p>}
          <SnapApplicationFormFields value={draft} questions={questions} disabled={pending||conflict||uncertain} onChange={value=>{
            setDraft(value);setConfirmedPaths(current => current.filter(path => JSON.stringify(snapApplicationLeaves(value)[path]) === JSON.stringify(draftLeaves[path])));
            setError(null);setMessage("");setAttempt(null);
          }}/>
          {(focused || changingAddress) && <button type="button" className={styles.quiet} disabled={pending||conflict||uncertain} onClick={()=>{setFocused(false);setChangingAddress(false);}}>Change other saved answers</button>}
          <p className={styles.hint}>Saving a correction stops queued uses of superseded answers. Already delivered records stay unchanged. This saves your answers and does not submit an application.</p>
          <div className={styles.inline}>
            <button className={styles.button} disabled={pending||conflict}>{pending?"Saving application answers…":uncertain?"Retry the same save":"Save application changes"}</button>
            {!uncertain && <button className={styles.quiet} type="button" disabled={pending} onClick={()=>{setDraft(null);setBase(null);setError(null);setAttempt(null);}}>Cancel editing</button>}
          </div>
          {conflict && <div><p className={styles.hint}>The request changed. Your unsaved draft is still here. Loading the latest revision replaces this unsaved draft.</p><button type="button" className={styles.secondary} onClick={()=>{setDraft(null);setBase(null);setConflict(false);setError(null);setAttempt(null);refreshSnapshot();onChange?.();}}>Load latest saved application</button></div>}
        </form> : <>
          {preparedReview && <SnapProtectedApplication key={`${request.id}:${request.version}:${record.id}`} request={request} snapshot={record} onChange={onChange}/>}
          <SnapApplicationSummary value={details} onChangeAddress={current && permitted && !draft ? ()=>edit(true) : undefined}/>{current && permitted && !draft && <button type="button" className={styles.secondary} onClick={()=>edit()}>Correct application answers</button>}
          {current && !permitted && <p className={styles.hint}>Application changes are unavailable while the request or its collection permission is paused. Your saved answers stay readable.</p>}</>}
      </>}
    {error && <ServiceError error={error} returnTo={`/support/${request.id}`}/>}
    {(blocked || collection.error) && <button type="button" className={styles.secondary} disabled={pending} onClick={recheckAccess}>{pending?"Checking private application access…":"Check private application access again"}</button>}
    {message && <p className={styles.success} role="status">{message}</p>}
  </section>;
}
