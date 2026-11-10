"use client";
import Link from "next/link";
import { z } from "zod";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Download,
  Lock,
  Pause,
  Play,
  ShieldCheck,
} from "iconoir-react";
import { NEED_LABELS, OUTCOME_LABELS, intakeSchema } from "@/lib/parent/domain";
import type {
  NecessaryAction,
  SupportIntake,
  SupportRequest,
} from "@/lib/parent/domain";
import { getProgram, PROGRAMS } from "@/lib/parent/programs";
import { currentIntakeFields } from "@/lib/parent/current-intake-fields";
import { boundedParentApi, displayDate, parentApi, ParentApiError } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { requestStatus } from "./my-support";
import { SupportDocuments } from "./support-documents";
import { SupportActivity, currentProtectedSnapAttempt, currentSnapReview, isSnapFinalReviewAction, recordedReceipt, type RecordedOperation } from "./support-activity";
import { sameSnapProtectedOperationBinding, snapProtectedDeliveryAttempt, type SnapProtectedOperation } from "@/lib/parent/snap-protected-operation";
import { FoodSites } from "./food-sites";
import { SupportPartners } from "./support-partners";
import { NecessaryAnswer } from "./necessary-answer";
import { NecessaryAnswers, isFactualQuestion } from "./necessary-answers";
import { SavedAccountAnswers } from "./saved-account-answers";
import { ANSWER_FIELDS } from "@/lib/parent/answers";
import { supportRouteLabel, supportRouteReceipt } from "@/lib/parent/application-readiness";
import {
  PermissionEditor,
  type PermissionEditorHandle,
} from "./permission-editor";
import { useParentResource } from "./use-parent-resource";
import type { SupportProgress } from "@/lib/parent/progress";
import { ProgressBadge, SupportProgressPanel } from "./support-progress";
import { ApplicationWorkspace, supportTitle } from "./application-workspace";
import workspace from "./application-workspace.module.css";
import { UrgentHelp } from "./landing";
import styles from "./parent.module.css";

function officialLink(value?: string): string | null {
  return value && PROGRAMS.some((program) => program.officialUrl === value)
    ? value
    : null;
}
function receiptNextStep(state: string): string {
  return state === "agency_submitted" ? "Agency response"
    : state === "assistance_approved" ? "Program follow-up"
      : state === "support_received" ? "No further step recorded"
        : state === "declined" ? "Review the recorded decision and follow-up"
          : "Program response";
}

function RequiredStep({
  action,
  request,
  onChange,
  onReviewPermission,
  onSnapDetails,
}: {
  action: NecessaryAction;
  request: SupportRequest;
  onChange: () => void;
  onReviewPermission: () => void;
  onSnapDetails: () => void;
}) {
  const snapDetails = action.need === "snap_new" && request.intake.needs.includes("snap_new") &&
    action.reason === "missing_fact" && action.field === "snap_application_details";
  const snapSubmit = action.need === "snap_new" && request.intake.needs.includes("snap_new") && action.reason === "submission_review" && action.field === "snap_final_submit";
  const url = officialLink(action.url);
  const canAnswer =
    (action.reason === "missing_fact" &&
      ANSWER_FIELDS.includes(action.field as (typeof ANSWER_FIELDS)[number])) ||
    action.field === "bookingPreference";
  return (
    <section
      className={styles.actionBox}
      aria-labelledby={snapSubmit ? `step-${action.id}` : `context-${action.id} step-${action.id}`}
    >
      {!snapSubmit && <p id={`context-${action.id}`} className={styles.small}>
        <strong>{NEED_LABELS[action.need]}</strong>
      </p>}
      <h2 id={`step-${action.id}`} tabIndex={-1}>
        {action.title}
      </h2>
      <p>{action.explanation}</p>
      {snapSubmit ? <a className={styles.button} href="#snap-final-review">Review application and Submit</a> : snapDetails ? <button className={styles.button} onClick={onSnapDetails}>Answer SNAP application questions</button> : canAnswer ? (
        <NecessaryAnswer
          action={action}
          request={request}
          onChange={onChange}
        />
      ) : (
        <div className={styles.space}>
          {action.reason === "expanded_permission" && (
            <>
              <p className={styles.small}>
                Choose the named programs and information for this step. We’ll
                resume only the work you authorize.
              </p>
              <button
                className={`${styles.button} ${styles.space}`}
                onClick={onReviewPermission}
              >
                Review permission
              </button>
            </>
          )}
          {url && (
            <a className={styles.secondary} href={url}>
              Open the official program{" "}
              <ArrowRight width={17} height={17} aria-hidden="true" />
            </a>
          )}
          <p className={`${styles.small} ${styles.space}`}>
            {action.reason === "personal_step"
              ? "Complete required personal steps directly with the program. Opening a link does not confirm completion; the program must record the required evidence."
              : "This step needs confirmed information or qualified help. We won’t mark it complete without evidence."}
          </p>
          <Link className={styles.textLink} href="/support/help">
            See help and direct program contacts
          </Link>
        </div>
      )}
    </section>
  );
}

function CorrectDetails({
  request,
  onChange,
}: {
  request: SupportRequest;
  onChange: () => void;
}) {
  const [intake, setIntake] = useState(request.intake);
  const [baseVersion, setBaseVersion] = useState(request.version);
  const [editing, setEditing] = useState(false);
  const [pendingWork, setPendingWork] = useState<{ scope: string; controller: AbortController } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const legacyPrivate = request.intake.childrenUnderFive !== null || request.intake.pregnantOrPostpartum !== null;
  const work=useRef<AbortController|null>(null),running=useRef<AbortController|null>(null);
  const scope=JSON.stringify({id:request.id,version:request.version,status:request.status,mandate:request.mandate,legacyPrivate});
  const pending = pendingWork?.scope === scope && !pendingWork.controller.signal.aborted;
  useLayoutEffect(()=>{
    const controller=new AbortController();work.current=controller;
    return()=>{controller.abort();if(work.current===controller)work.current=null;};
  },[scope]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const controller=work.current;
    if(legacyPrivate||pending||!controller||controller.signal.aborted||running.current===controller)return;
    setError("");
    setSaved(false);
    const parsed = intakeSchema.safeParse(intake);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your information.");
      return;
    }
    running.current=controller;setPendingWork({ scope, controller });
    try {
      const response = await boundedParentApi(
        `/requests/${request.id}`,
        {
          method: "POST",
          body: JSON.stringify({
            action: "correct",
            intake: parsed.data,
            version: baseVersion,
          }),
        },controller.signal,new Date(Date.now()+30000).toISOString(),
      );
      if(controller.signal.aborted||work.current!==controller)return;
      const result=z.object({request:z.object({id:z.uuid(),intake:intakeSchema,version:z.number().int().positive()})}).safeParse(response);
      if(!result.success||result.data.request.id!==request.id||result.data.request.version<=baseVersion)throw new Error();
      setIntake(result.data.request.intake);
      setBaseVersion(result.data.request.version);
      setSaved(true);
      onChange();
    } catch (err) {
      if(controller.signal.aborted||work.current!==controller)return;
      setError(err instanceof ParentApiError&&err.status>=400&&err.status<500?err.message:
        "The correction result is not confirmed. Your draft is still on this page. Check the current request before another save.");
    } finally {
      if(running.current===controller)running.current=null;
      if(!controller.signal.aborted&&work.current===controller)setPendingWork(null);
    }
  }
  function change<K extends keyof SupportIntake>(
    field: K,
    value: SupportIntake[K],
  ) {
    if(pending||running.current===work.current)return;
    setIntake((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }
  if(legacyPrivate)return <div className={styles.space}>
    <p className={styles.notice} role="status">CaseLink needs a safe update for your previously saved private WIC answers before household corrections can be made here. Your saved request and answers are unchanged. You can still pause or cancel work and use the <a className={styles.textLink} href={getProgram('wic-pa')!.officialUrl}>official WIC service</a>.</p>
    <dl className={styles.factList}><dt>Previously saved child-under-five answer</dt><dd>{request.intake.childrenUnderFive===null?'Not provided':request.intake.childrenUnderFive?'Yes':'No'}</dd>
      <dt>Previously saved pregnancy or postpartum answer</dt><dd>{request.intake.pregnantOrPostpartum===null?'Not provided':request.intake.pregnantOrPostpartum?'Yes':'No'}</dd></dl>
  </div>;
  return (
    <details className={styles.disclosure} open={editing}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          if(pending||running.current===work.current)return;
          if (!editing) {
            setIntake(request.intake);
            setBaseVersion(request.version);
            setSaved(false);
            setError("");
          }
          setEditing((current) => !current);
        }}
      >
        Correct household or bill information
      </summary>
      <div>
        <p className={`${styles.hint} ${styles.space}`}>
          We stop queued uses of changed facts and check whether already
          delivered information needs a correction. Submitted history stays
          intact.
        </p>
        <form className={`${styles.form} ${styles.space}`} onSubmit={submit}>
          <fieldset className={`${styles.fieldset} ${styles.form}`} aria-label="Household and bill corrections" disabled={pending}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="correct-zip">ZIP code</label>
              <input
                id="correct-zip"
                className={styles.input}
                required
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
                value={intake.zip}
                onChange={(e) => change("zip", e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="correct-size">Household size</label>
              <input
                id="correct-size"
                className={styles.input}
                type="number"
                min={1}
                max={30}
                value={intake.householdSize ?? ""}
                onChange={(e) =>
                  change(
                    "householdSize",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </div>
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="correct-income">Income before taxes ($)</label>
              <input
                id="correct-income"
                className={styles.input}
                type="number"
                min={0}
                max={1000000}
                step="0.01"
                value={intake.incomeAmount ?? ""}
                onChange={(e) =>
                  change(
                    "incomeAmount",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="correct-frequency">How often</label>
              <select
                id="correct-frequency"
                className={styles.select}
                value={intake.incomeFrequency}
                onChange={(e) =>
                  change(
                    "incomeFrequency",
                    e.target.value as SupportIntake["incomeFrequency"],
                  )
                }
              >
                <option value="unknown">Not sure / not provided</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option>
                <option value="twice_monthly">Twice a month</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          {intake.needs.some(need=>need.startsWith('wic_')) && <p className={styles.hint}>Private WIC questions are not available here yet. Ordinary routing changes do not collect those answers.</p>}
          {request.intake.needs.some((need) =>
            ["electricity", "gas", "water"].includes(need),
          ) && (
            <div className={styles.field}>
              <label htmlFor="correct-authority">
                Your authority for all selected utility accounts
              </label>
              <select
                id="correct-authority"
                className={styles.select}
                value={intake.accountAuthority}
                onChange={(e) =>
                  change(
                    "accountAuthority",
                    e.target.value as SupportIntake["accountAuthority"],
                  )
                }
              >
                <option value="self">
                  I hold every selected utility account
                </option>
                <option value="authorized_caregiver">
                  I hold or have permission to act for every selected utility
                  account
                </option>
                <option value="not_sure">Not sure</option>
              </select>
            </div>
          )}
          {intake.needs.filter((need) =>
            ["electricity", "gas", "water"].includes(need),
          ).length === 1 && (
            <div className={styles.field}>
              <label htmlFor="correct-shutoff">
                Shutoff date, if on a notice
              </label>
              <input
                id="correct-shutoff"
                className={styles.input}
                type="date"
                value={intake.shutoffDate ?? ""}
                onChange={(e) => change("shutoffDate", e.target.value || null)}
              />
            </div>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className={styles.success} role="status">
              Your correction is saved. We’re checking the affected work.
            </p>
          )}
          <button className={styles.button} disabled={pending} type="submit">
            {pending ? "Saving correction…" : "Save correction"}
          </button>
          </fieldset>
        </form>
      </div>
    </details>
  );
}

export function SupportDetail({ requestId }: { requestId: string }) {
  const { data, error, loading, reload, reloadIfIdle } = useParentResource<{
    request: SupportRequest;
    progress?: SupportProgress;
  }>(`/requests/${requestId}`);
  const history = useParentResource<{
    operations: RecordedOperation[];
    historyLimited: boolean;
  }>(`/requests/${requestId}/operations`);
  const reloadHistory = history.reload;
  const reloadHistoryIfIdle = history.reloadIfIdle;
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const [snapAnswerRequest, setSnapAnswerRequest] = useState(0);
  const [snapReview, setSnapReview] = useState<SnapProtectedOperation | null>(null);
  const [snapSubmissionDecision, setSnapSubmissionDecision] = useState<SnapProtectedOperation | null>(null);
  const permissionEditor = useRef<PermissionEditorHandle>(null);
  const request = data?.request;
  const requestState = request?.status;
  const pollEvery = !error && (data?.progress?.state === "queued" || data?.progress?.state === "running") ? 5000 : 30000;
  const requestVersion = request?.version;
  const requestUpdated = request?.updated_at;
  const snapRequested = request?.intake.needs.includes("snap_new") === true;
  const onSnapReviewChange = useCallback((input: SnapProtectedOperation | null) => {
    if (!snapRequested) return;
    const next = currentSnapReview({ id: requestId, version: requestVersion ?? 0 }, input);
    setSnapReview(next);
    // Preserve the decision separately so a newer delivery state is never hidden by its cache.
    if (next?.snapSubmissionAuthorized) setSnapSubmissionDecision(next);
  }, [requestId, requestVersion, snapRequested]);
  useEffect(() => {
    if (requestVersion !== undefined) reloadHistory();
  }, [requestVersion, requestUpdated, reloadHistory]);
  useEffect(() => {
    if (requestState !== "active") return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        reloadIfIdle();
        reloadHistoryIfIdle();
      }
    }, pollEvery);
    return () => clearInterval(interval);
  }, [requestState, pollEvery, reloadIfIdle, reloadHistoryIfIdle]);
  async function changeState(action: "pause" | "resume" | "cancel") {
    setPending(true);
    setActionError(null);
    setNotice("");
    try {
      await parentApi(`/requests/${requestId}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setCancelConfirm(false);
      setNotice(
        action === "pause"
          ? "Future work is paused. Already delivered information remains in the history."
          : action === "cancel"
            ? "Your request is cancelled. Future work has stopped; already delivered information may not be recallable."
            : "Your request can continue within its current permission and limits.",
      );
      reload();
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err
          : new Error("We couldn’t update your request. Please try again."),
      );
    } finally {
      setPending(false);
    }
  }
  if (loading)
    return (
      <div className={styles.container}>
        <ParentLoading />
      </div>
    );
  if (!request)
    return (
      <div className={styles.container}>
        <ServiceError
          error={
            error ??
            new Error(
              "This support request is unavailable. Check My support for your current requests.",
            )
          }
          retry={reload}
          returnTo={`/support/${requestId}`}
        />
      </div>
    );
  const inactive = ["cancelled", "closed"].includes(request.status);
  const acceptingActions = request.status === "active";
  const currentOperations = history.error
    ? []
    : (history.data?.operations ?? [])
        .filter((operation) => operation.request_version === request.version)
        .map((operation) => ({
          programId: operation.program_id,
          need: operation.need ?? undefined,
          state: operation.state,
          artifactId: operation.artifact_id,
          preparationOnly: operation.form?.preparation_only,
          action: operation.action,
          protectedPacket: operation.protected_packet,
          receipt: recordedReceipt(operation),
        }));
  const submittedNeeds = request.intake.needs.filter((need) =>
    currentOperations.some(
      (operation) =>
        operation.need === need &&
        operation.state === "agency_submitted" &&
        operation.receipt?.state === "agency_submitted" &&
        getProgram(operation.programId)?.needs.includes(need),
    ),
  );
  const ownedReview = snapRequested ? currentSnapReview(request, snapReview) : null;
  const knownDecision = snapRequested ? currentSnapReview(request, snapSubmissionDecision) : null;
  const decisionRecorded = ownedReview?.snapSubmissionAuthorized === true || (knownDecision?.snapSubmissionAuthorized === true && (!ownedReview || sameSnapProtectedOperationBinding(ownedReview, knownDecision)));
  const attemptRecorded = !!ownedReview && snapProtectedDeliveryAttempt(ownedReview.state) || !history.error && !history.loading && currentProtectedSnapAttempt(request, history.data?.operations ?? []);
  const reviewFinished = decisionRecorded || attemptRecorded;
  const currentSnapReceipt = snapRequested ? supportRouteReceipt({ need: "snap_new", programId: "snap-pa", state: "checking" }, currentOperations) : null;
  const preparedSnapReview = ownedReview?.state === "prepared" && ownedReview.protectedPacketCurrent ? ownedReview : null;
  const snapReviewRequired = acceptingActions && preparedSnapReview?.protectedParentSubmitReady === true && request.required_actions.some(action => !action.resolved && (!action.resolver || action.resolver === "parent") && isSnapFinalReviewAction(action));
  const showSnapProgress = !!currentSnapReceipt || reviewFinished || !!preparedSnapReview || !acceptingActions && snapRequested;
  const actions = request.required_actions.filter(
    (action) =>
      !action.resolved && (!action.resolver || action.resolver === "parent") && !(reviewFinished && isSnapFinalReviewAction(action)),
  );
  const outdatedParentWait = request.status === "active" && reviewFinished && !actions.length && data?.progress?.state === "needs_parent";
  const serviceActions = request.required_actions.filter(
    (action) =>
      !action.resolved && action.resolver && action.resolver !== "parent",
  );
  return (
    <div className={styles.container}>
      <Link
        className={`${styles.quiet} ${styles.hidePrint}`}
        href="/my-support"
      >
        <ArrowLeft width={17} height={17} aria-hidden="true" />
        My support
      </Link>
      {request.controlled_test && <aside className={`${styles.notice} ${styles.space}`} aria-label="Fictional signing and fax test">
        <strong>Fictional signing and fax test</strong>
        <p>This example uses test marks and Sinch’s free fax emulator. No application is sent to DHS or another real recipient. Any delivery result below describes the test only.</p>
      </aside>}
      <div className={`${styles.pageTop} ${styles.space}`}>
        <div>
          <h1>{supportTitle(request)}</h1>
          <p>
            Your saved information, the work actually completed, and your next
            step are together here.
          </p>
        </div>
        {outdatedParentWait ? <span className={styles.badge}>{submittedNeeds.includes("snap_new") ? "Application submitted" : attemptRecorded ? "Delivery check with CaseLink" : "Submit decision recorded"}</span> : data?.progress && !error ? (
          <ProgressBadge progress={data.progress} />
        ) : (
          <span
            className={`${styles.badge} ${actions.length ? styles.badgeAttention : request.status !== "active" ? styles.badgeWait : ""}`}
          >
            {requestStatus(request)}
          </span>
        )}
      </div>
      {notice && (
        <p className={`${styles.success} ${styles.space}`} role="status">
          {notice}
        </p>
      )}
      {actionError && <ServiceError error={actionError} />}
      {error && <ServiceError error={error} retry={reload} />}
      <ApplicationWorkspace
        snapAnswerRequest={snapAnswerRequest}
        request={request}
        progress={error ? undefined : data?.progress}
        history={history}
        snapReview={snapReview}
        snapSubmissionDecision={snapSubmissionDecision}
        onReviewChange={onSnapReviewChange}
        onChange={()=>{reload();reloadHistory();}}
      >
        {!outdatedParentWait && <SupportProgressPanel
          progress={error ? undefined : data?.progress}
          onRefresh={reload}
        />}
        {request.intake.urgency === "today" && (
          <div className={styles.space}>
            <UrgentHelp />
          </div>
        )}
        {request.status === "paused" && (
          <div className={styles.notice}>
            <Pause width={22} height={22} aria-hidden="true" />
            <p>
              <strong>Paused by you.</strong> No future actions will run while
              paused. Resume when you’re ready; expired permission may need
              renewal.
            </p>
          </div>
        )}
        <section
          id="your-next-steps"
          className={workspace.section}
          tabIndex={-1}
          aria-labelledby="your-steps-heading"
        >
          <h2 id="your-steps-heading" className={workspace.sectionHeading}>
            Your next steps
          </h2>
          {acceptingActions && actions.length > 0 && (
            <p className={styles.subtle}>
              These are the saved household steps for this request. Check the
              application window above for any website verification.
            </p>
          )}
          {(!actions.length || !acceptingActions) && (
            <p className={styles.subtle}>
              {!acceptingActions
                ? "No new personal steps are requested while this request is paused or finished."
                : reviewFinished && !submittedNeeds.includes("snap_new")
                  ? attemptRecorded
                    ? "CaseLink must confirm the recorded delivery attempt before any retry. No repeated review is requested."
                    : "Your Submit decision is saved. CaseLink owns the delivery check; you do not need to repeat the review."
                : submittedNeeds.length === request.intake.needs.length
                  ? "Use the recorded submission and any official notices above for your next step. No household update is currently requested."
                : "No household updates are requested in this section. Check the application window and work status above for any website verification or other next step."}
            </p>
          )}
          {acceptingActions && (
            <NecessaryAnswers key={request.id} request={request} onChange={reload} />
          )}
          {acceptingActions &&
            actions.filter((action) => !isFactualQuestion(action)).map((action) => (
              <RequiredStep
                key={action.id}
                action={action}
                request={request}
                onChange={reload}
                onReviewPermission={() => permissionEditor.current?.open()}
                onSnapDetails={() => setSnapAnswerRequest(current => current + 1)}
              />
            ))}
          {!inactive && serviceActions.length > 0 && (
            <details className={styles.disclosure}>
              <summary>A CaseLink service step is unresolved</summary>
              <div>
                <p className={`${styles.subtle} ${styles.small}`}>
                  These steps belong to CaseLink or the program. You don’t need
                  to resolve a service connection or repeat your information.
                </p>
                <ul className={`${styles.list} ${styles.space}`}>
                  {serviceActions.map((action) => (
                    <li key={action.id}>
                      <strong>{action.title}</strong>
                      <p className={`${styles.hint} ${styles.space}`}>
                        {action.explanation}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}
        </section>
        {request.intake.needs.includes("food_now") && (
          <FoodSites zip={currentIntakeFields(request, new Date(), "food_now").zip} />
        )}
        <section
          id="application-programs"
          className={`${styles.surface} ${workspace.section}`}
          tabIndex={-1}
        >
          <h2>Program progress</h2>
          {request.plan?.routes.length ? (
            request.plan.routes.map((route, i) => {
              const program = getProgram(route.programId);
              const receipt = supportRouteReceipt(route, currentOperations);
              const snapDeliveryCheck = !receipt && reviewFinished && route.need === "snap_new" && route.programId === "snap-pa";
              const state = receipt?.state ?? route.state;
              return (
                <article
                  className={styles.needRow}
                  key={`${route.need}-${route.programId}-${i}`}
                >
                  <div className={styles.between}>
                    <h3>{NEED_LABELS[route.need]}</h3>
                    <span
                      className={`${styles.badge} ${["checking", "unresolved"].includes(state) ? styles.badgeWait : ""}`}
                    >
                      {request.controlled_test ? receipt?.reference.startsWith("sinch-emulation:") ? "Test fax completed — no agency filing" : "Fictional test in progress" : receipt ? OUTCOME_LABELS[receipt.state] : snapDeliveryCheck ? attemptRecorded ? "Delivery result not confirmed" : "Submit decision recorded" : supportRouteLabel(route, currentOperations)}
                    </span>
                  </div>
                  <p>
                    <strong>{route.title}</strong>
                    {program && route.title !== program.name && (
                      <> · {program.name}</>
                    )}
                  </p>
                  <p>{receipt
                    ? `${OUTCOME_LABELS[receipt.state]} is recorded. Open Activity & receipts for the exact evidence and any program instructions.`
                    : snapDeliveryCheck
                      ? attemptRecorded ? "A delivery attempt is recorded. CaseLink must confirm its result before any retry." : "Your decision to send the exact SNAP application is recorded. CaseLink must check delivery and any agency confirmation."
                      : route.summary}</p>
                  {!receipt && !snapDeliveryCheck && route.limitation && <p>{route.limitation}</p>}
                  <p>
                    <strong>Next:</strong>{" "}
                    {receipt
                      ? receiptNextStep(state)
                      : snapDeliveryCheck || route.nextActor === "caselink"
                      ? "CaseLink"
                      : route.nextActor === "parent"
                        ? "Your personal step"
                        : route.nextActor === "agency"
                          ? "Agency response"
                          : "Program response"}
                  </p>
                  {!receipt && !snapDeliveryCheck && route.steps.length > 0 && (
                    <details className={styles.disclosure}>
                      <summary>See the planned steps</summary>
                      <div>
                        <ol>
                          {route.steps.map((step, index) => (
                            <li key={index} className={styles.small}>
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>
                    </details>
                  )}
                  {program && (
                    <a
                      className={`${styles.textLink} ${styles.small}`}
                      href={program.officialUrl}
                    >
                      Official program & direct access
                    </a>
                  )}
                </article>
              );
            })
          ) : (
            <div className={styles.stack}>
              <p className={styles.subtle}>Your selected needs are saved:</p>
              <ul>
                {request.intake.needs.map((need) => (
                  <li key={need}>
                    {NEED_LABELS[need]}
                    {need === "snap_new" && currentSnapReceipt ? ` · ${OUTCOME_LABELS[currentSnapReceipt.state]}` : submittedNeeds.includes(need) ? " · Application submitted" : need === "snap_new" && reviewFinished ? attemptRecorded ? " · Delivery result not confirmed" : " · Submit decision recorded" : need === "snap_new" && preparedSnapReview ? " · Application prepared" : ""}
                  </li>
                ))}
              </ul>
              {showSnapProgress && <div className={styles.trustLine}>
                <Clock width={21} height={21} aria-hidden="true" />
                <div>
                  <p>{currentSnapReceipt
                    ? `${OUTCOME_LABELS[currentSnapReceipt.state]} is recorded. Open Activity & receipts for the exact evidence and any program instructions.`
                    : !acceptingActions
                      ? "Future SNAP application work is stopped. Open Activity & receipts for anything already attempted or confirmed."
                      : attemptRecorded ? "A delivery attempt is recorded. CaseLink must confirm its result before any retry."
                        : decisionRecorded ? "Your decision to send the exact SNAP application is recorded. CaseLink must check delivery and any agency confirmation."
                          : snapReviewRequired ? "The exact SNAP application is prepared. Review it above before choosing Submit."
                            : "The exact SNAP application is prepared. CaseLink must resolve its remaining submission requirements before Submit can be offered."}</p>
                  {currentSnapReceipt?.state === "agency_submitted" && <p>A submission is separate from approval or receiving support.</p>}
                  <p><strong>Next:</strong>{" "}{currentSnapReceipt ? receiptNextStep(currentSnapReceipt.state) : !acceptingActions ? <a className={styles.textLink} href="#application-receipts">Activity &amp; receipts</a> : !reviewFinished && snapReviewRequired ? <a className={styles.textLink} href="#snap-final-review">Your application review</a> : "CaseLink"}</p>
                </div>
              </div>}
              {(!showSnapProgress || request.intake.needs.some(need => need !== "snap_new")) && <div className={styles.trustLine}>
                <Clock width={21} height={21} aria-hidden="true" />
                <p>
                  {submittedNeeds.some(need => need !== "snap_new" || !showSnapProgress)
                    ? "An agency submission is recorded for the support marked above. Open Activity & receipts for the exact application and any follow-up requirements. A submission is separate from approval or receiving support."
                    : showSnapProgress
                      ? "Preparation is pending for your other selected support. A saved request is not an application or a confirmed appointment. You can use official programs directly while you wait."
                    : "Preparation is pending. A saved request is not an application or a confirmed appointment. You can use official programs directly while you wait."}
                </p>
              </div>}
            </div>
          )}
        </section>
        <SupportPartners request={request} />
        <section
          id="application-receipts"
          className={`${styles.surface} ${workspace.section}`}
          tabIndex={-1}
        >
          <h2>Activity & receipts</h2>
          <p className={`${styles.subtle} ${styles.small}`}>
            Prepared, sent, received, approved and support actually received are
            different steps. We show only recorded evidence.
          </p>
          {request.events?.length ? (
            <ol className={`${styles.timeline} ${styles.space}`}>
              {request.events.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>{event.summary}</strong>
                    {event.kind === "parent.outcome_reported" &&
                      event.actor === "parent" && (
                        <>
                          {typeof event.evidence?.outcome === "string" &&
                            Object.hasOwn(
                              OUTCOME_LABELS,
                              event.evidence.outcome,
                            ) && (
                              <p>
                                Reported outcome:{" "}
                                {
                                  OUTCOME_LABELS[
                                    event.evidence
                                      .outcome as keyof typeof OUTCOME_LABELS
                                  ]
                                }
                              </p>
                            )}
                          {typeof event.evidence?.reference === "string" && (
                            <p>{event.evidence.reference}</p>
                          )}
                        </>
                      )}
                    <p>
                      {event.actor === "parent"
                        ? "Parent reported"
                        : event.actor === "operator"
                          ? "Operator confirmed"
                          : event.actor === "agency" ||
                              event.actor === "partner"
                            ? "Program update"
                            : "CaseLink activity"}
                    </p>
                    <time dateTime={event.created_at}>
                      {displayDate(event.created_at, true)}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className={`${styles.hint} ${styles.space}`}>
              No additional activity recorded yet. We won’t mark a request sent
              or received without evidence.
            </p>
          )}
          {request.events_truncated && (
            <p className={`${styles.hint} ${styles.space}`}>
              Showing the latest 200 updates.{" "}
              <a className={styles.textLink} href="/api/parent/account/export">
                Download your information
              </a>{" "}
              for retained earlier history.
            </p>
          )}
          <a
            className={`${styles.secondary} ${styles.space} ${styles.hidePrint}`}
            href={`/api/parent/requests/${requestId}/export`}
          >
            <Download width={18} height={18} aria-hidden="true" />
            Download current summary
          </a>
          <p className={`${styles.hint} ${styles.space}`}>
            Your download reflects the recorded state. Submitted packet versions
            and receipts are preserved when a permitted channel produces them.
          </p>
        </section>
        <SupportActivity
          request={request}
          onChange={reload}
          history={history}
        />
        <div
          id="application-documents"
          className={workspace.section}
          tabIndex={-1}
        >
          <SupportDocuments
            requestId={requestId}
            documents={request.documents ?? []}
            inactive={!acceptingActions}
            onChange={reload}
          />
        </div>
        <div
          id="application-controls"
          className={workspace.section}
          tabIndex={-1}
        >
          <section className={styles.surface}>
            <h2>Your details</h2>
            <dl className={styles.factList}>
              <dt>Household ZIP</dt>
              <dd>
                {request.intake.zip}
                <small>You provided</small>
              </dd>
              <dt>Household size</dt>
              <dd>{request.intake.householdSize ?? "Not provided"}</dd>
              <dt>Language preference</dt>
              <dd>
                {request.intake.language === "es" ? "Spanish" : "English"}
              </dd>
              <dt>Updates</dt>
              <dd>
                {request.intake.contactPreference === "email"
                  ? "Email & My support"
                  : "My support only"}
              </dd>
              {request.intake.incomeAmount !== null && (
                <>
                  <dt>Income before taxes</dt>
                  <dd>
                    ${request.intake.incomeAmount.toLocaleString("en-US")}
                    <small>
                      {request.intake.incomeFrequency.replaceAll("_", " ")} ·
                      You provided
                    </small>
                  </dd>
                </>
              )}
              {request.intake.shutoffDate && (
                <>
                  <dt>Reported shutoff date</dt>
                  <dd>{displayDate(request.intake.shutoffDate)}</dd>
                </>
              )}
            </dl>
            {!inactive && (
              <CorrectDetails request={request} onChange={reload} />
            )}
            {!inactive && (
              <SavedAccountAnswers request={request} onChange={reload} />
            )}
          </section>
          <section className={styles.surface}>
            <h2>Your permission</h2>
            <div className={`${styles.inline} ${styles.small}`}>
              <ShieldCheck width={22} height={22} aria-hidden="true" />
              <strong>
                {request.mandate.mode === "prepare_only"
                  ? "Research & preparation only"
                  : "Permitted actions within your limits"}
              </strong>
            </div>
            <p className={`${styles.hint} ${styles.space}`}>
              Expires {displayDate(request.mandate.expiresAt)} · Up to{" "}
              {request.mandate.maxAttempts} attempts ·{" "}
              {request.mandate.recipientIds.length} named program
              {request.mandate.recipientIds.length === 1 ? "" : "s"}
            </p>
            <ul className={styles.recipientList}>
              {request.mandate.recipientIds.map((id) => (
                <li key={id}>
                  {getProgram(id)?.name ?? "Named program unavailable"}
                </li>
              ))}
            </ul>
            <p className={`${styles.hint} ${styles.space}`}>
              No signatures, passwords, EBT PINs or binding financial
              commitments. Documents need their own processing consent.
            </p>
            {!inactive && (
              <PermissionEditor
                ref={permissionEditor}
                request={request}
                onChange={reload}
              />
            )}
            {!inactive && (
              <div
                className={`${styles.stack} ${styles.space} ${styles.hidePrint}`}
              >
                <button
                  className={styles.secondary}
                  disabled={pending}
                  onClick={() =>
                    changeState(
                      request.status === "paused" ? "resume" : "pause",
                    )
                  }
                >
                  {request.status === "paused" ? (
                    <Play width={18} height={18} aria-hidden="true" />
                  ) : (
                    <Pause width={18} height={18} aria-hidden="true" />
                  )}
                  {pending
                    ? "Updating…"
                    : request.status === "paused"
                      ? "Resume support"
                      : "Pause future work"}
                </button>
                {cancelConfirm ? (
                  <div className={styles.stack}>
                    <p className={styles.small}>
                      Cancel this request and stop future work? Already sent
                      information cannot always be recalled.
                    </p>
                    <button
                      className={styles.danger}
                      disabled={pending}
                      onClick={() => changeState("cancel")}
                    >
                      Yes, cancel this request
                    </button>
                    <button
                      className={styles.quiet}
                      disabled={pending}
                      onClick={() => setCancelConfirm(false)}
                    >
                      Keep this request
                    </button>
                  </div>
                ) : (
                  <button
                    className={styles.quiet}
                    onClick={() => setCancelConfirm(true)}
                  >
                    Cancel request & withdraw permission
                  </button>
                )}
              </div>
            )}
          </section>
          <div className={styles.trustLine}>
            <Lock width={22} height={22} aria-hidden="true" />
            <div>
              <strong>Need a person or another way?</strong>
              <Link className={styles.textLink} href="/support/help">
                Find help and direct program options.
              </Link>{" "}
              No program outcome is guaranteed.
            </div>
          </div>
        </div>
      </ApplicationWorkspace>
      <p className={`${styles.hint} ${styles.space}`}>
        Last recorded request update: {displayDate(request.updated_at, true)}.
        This page checks for updates every 30 seconds while visible. The status
        above shows whether background work is active.
      </p>
    </div>
  );
}
