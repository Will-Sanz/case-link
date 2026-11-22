"use client";
import { useParentLocale } from "./parent-locale";
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
} from "iconoir-react";
import { NEED_LABELS, OUTCOME_LABELS, intakeSchema, storedIntakeSchema } from "@/lib/parent/domain";
import type {
  NecessaryAction,
  SupportIntake,
  SupportAction,
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
import { FoodAccess, FoodAccessReportSummary } from "./food-access";
import { SupportPartners } from "./support-partners";
import { NecessaryAnswer } from "./necessary-answer";
import { NecessaryAnswers, isFactualQuestion } from "./necessary-answers";
import { SavedAccountAnswers } from "./saved-account-answers";
import { ANSWER_FIELDS } from "@/lib/parent/answers";
import { supportRouteLabel, supportRouteReceipt } from "@/lib/parent/application-readiness";
import {
  PERMISSION_DATA_LABELS,
  PermissionEditor,
  type PermissionEditorHandle,
} from "./permission-editor";
import { useParentResource } from "./use-parent-resource";
import type { SupportProgress } from "@/lib/parent/progress";
import { ProgressBadge, SupportProgressPanel } from "./support-progress";
import { ApplicationWorkspace, isPrivateUtilityPreparationRequest, supportTitle } from "./application-workspace";
import workspace from "./application-workspace.module.css";
import { UrgentHelp } from "./landing";
import styles from "./parent.module.css";
import wicStyles from "./wic.module.css";

const PERMISSION_ACTION_LABELS: Record<SupportAction, string> = {
  research: "Look up options",
  prepare: "Prepare your information",
  share: "Share permitted information",
  submit: "Submit supported applications",
  schedule: "Coordinate appointments",
  follow_up: "Follow up with programs",
};

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
  const { t: parentText, locale } = useParentLocale();
  const localized = action.need === "food_now" || action.need.startsWith("wic_") || action.need.startsWith("snap_");
  const t = (text: string) => localized ? parentText(text) : text;
  const snapDetails = action.need === "snap_new" && request.intake.needs.includes("snap_new") &&
    action.reason === "missing_fact" && action.field === "snap_application_details";
  const snapSubmit = action.need === "snap_new" && request.intake.needs.includes("snap_new") && action.reason === "submission_review" && action.field === "snap_final_submit";
  const url = officialLink(action.url);
  const stepOwner = action.reason === "personal_step"
    ? "Complete with the program"
    : action.reason === "expanded_permission" ? "Decide what CaseLink may do" : null;
  const canAnswer =
    (action.reason === "missing_fact" &&
      ANSWER_FIELDS.includes(action.field as (typeof ANSWER_FIELDS)[number])) ||
    action.field === "bookingPreference";
  return (
    <section
      className={`${styles.actionBox} ${action.need.startsWith("wic_") ? wicStyles.personalStep : ""}`}
      aria-labelledby={snapSubmit ? `step-${action.id}` : `context-${action.id} step-${action.id}`}
    >
      {!snapSubmit && <p id={`context-${action.id}`} className={styles.small}>
        <strong lang={t(NEED_LABELS[action.need]) === NEED_LABELS[action.need] ? "en" : locale}>{t(NEED_LABELS[action.need])}</strong>
      </p>}
      <h2 lang="" id={`step-${action.id}`} tabIndex={-1}>
        {action.title}
      </h2>
      {stepOwner && <p lang={localized ? locale : "en"} className={styles.small}><strong>{t(stepOwner)}</strong></p>}
      <p lang="">{action.explanation}</p>
      {snapSubmit ? <a lang={locale} className={styles.button} href="#snap-final-review">{t("Review application and Submit")}</a> : snapDetails ? <a lang={locale} className={styles.button} href="#application-answers" onClick={onSnapDetails}>{t("Answer SNAP application questions")}</a> : canAnswer ? (
        <NecessaryAnswer
          action={action}
          request={request}
          onChange={onChange}
        />
      ) : (
        <div lang={localized ? locale : "en"} className={styles.space}>
          {action.reason === "expanded_permission" && (
            <>
              <p className={styles.small}>
                {t("Choose the named programs and information for this step. We’ll resume only the work you authorize.")}
              </p>
              <a
                className={`${styles.button} ${styles.space}`}
                href="#application-controls"
                onClick={onReviewPermission}
              >
                {t("Review permission")}
              </a>
            </>
          )}
          {url && (
            <a className={styles.secondary} href={url}>
              {t("Open the official program")}{" "}
              <ArrowRight width={17} height={17} aria-hidden="true" />
            </a>
          )}
          <p className={`${styles.small} ${styles.space}`}>
            {t(action.reason === "personal_step"
              ? "Complete required personal steps directly with the program. Opening a link does not confirm completion; the program must record the required evidence."
              : "This step needs confirmed information or qualified help. We won’t mark it complete without evidence.")}
          </p>
          <Link className={styles.textLink} href="/support/help">
            {t("See help and direct program contacts")}
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
  const { t: parentText, locale } = useParentLocale();
  const localized = request.intake.needs.length > 0 && request.intake.needs.every(need => need === "food_now" || need.startsWith("snap_") || need.startsWith("wic_"));
  const t = (copy: string) => localized ? parentText(copy) : copy;
  const [intake, setIntake] = useState(request.intake);
  const frequencies = [
    ["unknown", "Not sure / not provided"], ["weekly", "Weekly"], ["biweekly", "Every two weeks"],
    ["twice_monthly", "Twice a month"], ["monthly", "Monthly"], ["yearly", "Yearly"],
  ];
  const frequencyLabel = frequencies.find(([value]) => value === intake.incomeFrequency)?.[1];
  const [baseVersion, setBaseVersion] = useState(request.version);
  const [editing, setEditing] = useState(false);
  const [pendingWork, setPendingWork] = useState<{ scope: string; controller: AbortController } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const legacyPrivate = request.intake.childrenUnderFive !== null || request.intake.pregnantOrPostpartum !== null;
  const privateUtility = isPrivateUtilityPreparationRequest(request);
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
      const result=z.object({request:z.object({id:z.uuid(),intake:storedIntakeSchema,version:z.number().int().positive()})}).safeParse(response);
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
  if(legacyPrivate)return <div lang={localized ? locale : "en"} className={styles.space}>
    <p className={styles.notice} role="status">{t("CaseLink needs a safe update for your previously saved private WIC answers before household corrections can be made here. Your saved request and answers are unchanged. You can still pause or cancel work and use the")}{" "}<a className={styles.textLink} href={getProgram('wic-pa')!.officialUrl}>{t("official WIC service")}</a>.</p>
    <dl className={styles.factList}><dt>{t("Previously saved child-under-five answer")}</dt><dd>{t(request.intake.childrenUnderFive===null?'Not provided':request.intake.childrenUnderFive?'Yes':'No')}</dd>
      <dt>{t("Previously saved pregnancy or postpartum answer")}</dt><dd>{t(request.intake.pregnantOrPostpartum===null?'Not provided':request.intake.pregnantOrPostpartum?'Yes':'No')}</dd></dl>
  </div>;
  return (
    <details lang={localized ? locale : "en"} className={styles.disclosure} open={editing}>
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
      >{t("Correct household or bill information")}</summary>
      <div>
        <p className={`${styles.hint} ${styles.space}`}>{t("We stop queued uses of changed facts and check whether already delivered information needs a correction. Submitted history stays intact.")}</p>
        <form className={`${styles.form} ${styles.space}`} onSubmit={submit}>
          <fieldset className={`${styles.fieldset} ${styles.form}`} aria-label={t("Household and bill corrections")} disabled={pending}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="correct-zip">{t("ZIP code")}</label>
              <input
                id="correct-zip"
                className={styles.input}
                required
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
                value={intake.zip ?? ""}
                onChange={(e) => change("zip", e.target.value)}
              />
            </div>
            {!privateUtility && <div className={styles.field}>
              <label htmlFor="correct-size">{t("Household size")}</label>
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
            </div>}
          </div>
          {!privateUtility && <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="correct-income">{t("Income before taxes ($)")}</label>
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
              <label htmlFor="correct-frequency">{t("How often")}</label>
              <select
                id="correct-frequency"
                aria-describedby={localized && frequencyLabel ? "correct-frequency-choice" : undefined}
                className={styles.select}
                value={intake.incomeFrequency}
                onChange={(e) =>
                  change(
                    "incomeFrequency",
                    e.target.value as SupportIntake["incomeFrequency"],
                  )
                }
              >
                {frequencies.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
              {localized && frequencyLabel && <p className={styles.hint} id="correct-frequency-choice">{t(frequencyLabel)}</p>}
            </div>
          </div>}
          {privateUtility && <p className={styles.hint}>Names, birth dates, account details, addresses and income source lists are corrected in <a className={styles.textLink} href="#application-review">Your utility application answers</a>. Household routing ZIP and any shutoff date stay separate.</p>}
          {intake.needs.some(need=>need.startsWith('wic_')) && <p className={styles.hint}>{t("Private WIC questions are not available here yet. Ordinary routing changes do not collect those answers.")}</p>}
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
            <p lang={t(error) === error ? "" : locale} className={styles.error} role="alert">
              {t(error)}
            </p>
          )}
          {saved && (
            <p className={styles.success} role="status">{t("Your correction is saved. We’re checking the affected work.")}</p>
          )}
          <button className={styles.button} disabled={pending} type="submit">
            {t(pending ? "Saving correction…" : "Save correction")}
          </button>
          </fieldset>
        </form>
      </div>
    </details>
  );
}

export function SupportDetail({ requestId }: { requestId: string }) {
  const { t, locale } = useParentLocale();
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
        {error instanceof ParentApiError && error.status === 404 ? (
          <div lang={locale} className={styles.empty}>
            <h1>{t("This request is unavailable")}</h1>
            <p>{t("Check My support for the requests available to your account.")}</p>
            <Link className={styles.button} href="/my-support">{t("Go to My support")}</Link>
          </div>
        ) : <ServiceError
          error={
            error ??
            new Error(
              "This support request is unavailable. Check My support for your current requests.",
            )
          }
          retry={reload}
          returnTo={`/support/${requestId}`}
        />}
      </div>
    );
  const wicOnly = request.intake.needs.length > 0 && request.intake.needs.every(need => need.startsWith("wic_"));
  const foodOnly = request.intake.needs.length > 0 && request.intake.needs.every(need => need === "food_now" || need.startsWith("snap_") || need.startsWith("wic_"));
  const localized = wicOnly || foodOnly;
  const wt = (text: string) => localized ? t(text) : text;
  const inactive = ["cancelled", "closed"].includes(request.status);
  const acceptingActions = request.status === "active";
  const foodAccessOnly = request.intake.needs.length === 1 && request.intake.needs[0] === "food_now";
  const foodRoute = request.plan?.routes.find(route => route.need === "food_now" && route.foodAccess);
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
    <div lang={localized ? locale : "en"} className={workspace.caseView} data-case-workspace>
      <div className={workspace.caseHeader}>
      <Link
        className={`${styles.quiet} ${styles.hidePrint}`}
        href="/my-support"
        aria-label={wt("My support")}
      >
        <ArrowLeft width={17} height={17} aria-hidden="true" />
        <span className={workspace.caseBackLabel}>{wt("My support")}</span>
      </Link>
      <h1 lang={t(supportTitle(request)) === supportTitle(request) ? "en" : locale}>{t(supportTitle(request))}</h1>
        {outdatedParentWait ? <span className={styles.badge}>{wt(submittedNeeds.includes("snap_new") ? "Application submitted" : attemptRecorded ? "Delivery check with CaseLink" : "Submit decision recorded")}</span> : data?.progress && !error ? (
          <ProgressBadge progress={data.progress} />
        ) : (
          <span
            className={`${styles.badge} ${actions.length ? styles.badgeAttention : request.status !== "active" ? styles.badgeWait : ""}`}
          >
            {wt(requestStatus(request))}
          </span>
        )}
      </div>
      {notice && (
        <p className={`${styles.success} ${styles.space}`} role="status">
          {wt(notice)}
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
        {!outdatedParentWait && <details lang={localized ? locale : "en"} className={styles.disclosure}>
          <summary>{wt("Work status & updates")}</summary>
          <div><SupportProgressPanel
            progress={error ? undefined : data?.progress}
            onRefresh={reload}
          /></div>
        </details>}
        {request.intake.urgency === "today" && (
          <div className={styles.space}>
            <UrgentHelp />
          </div>
        )}
        <section
          id="your-next-steps"
          lang={localized ? locale : "en"}
          className={workspace.section}
          tabIndex={-1}
          aria-labelledby="your-steps-heading"
        >
          <h2 id="your-steps-heading" className={workspace.sectionHeading}>
            {wt("Your next steps")}
          </h2>
          {acceptingActions && actions.length > 0 && (
            <p className={styles.subtle}>
              {wt("These are the saved household steps for this request. Open the official website section for any website verification.")}
            </p>
          )}
          {(!actions.length || !acceptingActions) && (
            <p className={styles.subtle}>
              {wt(!acceptingActions
                ? "No new personal steps are requested while this request is paused or finished."
                : reviewFinished && !submittedNeeds.includes("snap_new")
                  ? attemptRecorded
                    ? "CaseLink must confirm the recorded delivery attempt before any retry. No repeated review is requested."
                    : "Your Submit decision is saved. CaseLink owns the delivery check; you do not need to repeat the review."
                : submittedNeeds.length === request.intake.needs.length
                  ? "Use the recorded submission and any official notices above for your next step. No household update is currently requested."
                  : foodAccessOnly
                    ? "CaseLink has no household questions for you right now."
                    : "No household updates are requested in this section. Check the official website and overview sections for any website verification or other next step.")}
              {acceptingActions && foodAccessOnly && <>{" "}<a className={styles.textLink} href="#application-programs">{wt("See your food options and any visit instructions.")}</a></>}
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
              <summary>{wt("A CaseLink service step is unresolved")}</summary>
              <div>
                <p className={`${styles.subtle} ${styles.small}`}>
                  {wt("These steps belong to CaseLink or the program. You don’t need to resolve a service connection or repeat your information.")}
                </p>
                <ul className={`${styles.list} ${styles.space}`}>
                  {serviceActions.map((action) => (
                    <li key={action.id}>
                      <strong lang="">{action.title}</strong>
                      <p className={`${styles.hint} ${styles.space}`}>
                        <span lang="">{action.explanation}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}
        </section>
        <section
          id="application-programs"
          lang={localized ? locale : "en"}
          className={`${styles.surface} ${foodRoute ? styles.foodPrograms : ""} ${workspace.section}`}
          tabIndex={-1}
        >
        {foodRoute && <FoodAccess request={request} plan={foodRoute.foodAccess} report={foodRoute.foodAccessReport} alternatives={foodRoute.foodAccessAlternatives} onChange={reload} readError={error} />}
        {request.intake.needs.includes("food_now") && foodRoute?.foodAccessReport?.outcome !== "unresolved" && (
          <FoodSites zip={currentIntakeFields(request, new Date(), "food_now").zip} />
        )}
          <h2>{wt("Program progress")}</h2>
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
                    <h3>{wt(NEED_LABELS[route.need])}</h3>
                    <span
                      className={`${styles.badge} ${["checking", "unresolved"].includes(state) ? styles.badgeWait : ""}`}
                    >
                      {wt(receipt ? OUTCOME_LABELS[receipt.state] : snapDeliveryCheck ? attemptRecorded ? "Delivery result not confirmed" : "Submit decision recorded" : supportRouteLabel(route, currentOperations))}
                    </span>
                  </div>
                  {localized && locale === "es" && (wt(route.summary) === route.summary || route.steps.some(step => wt(step) === step)) && <p className={styles.hint}>{wt("Original recorded wording remains in its source language.")}</p>}
                  <p>
                    <strong lang={program && route.title === program.name ? "en" : wt(route.title) === route.title ? "" : locale}>{program && route.title === program.name ? program.name : wt(route.title)}</strong>
                    {program && route.title !== program.name && (
                      <> · <span lang="en">{program.name}</span></>
                    )}
                  </p>
                  <p lang={receipt || snapDeliveryCheck || wt(route.summary) !== route.summary ? localized ? locale : "en" : ""}>{wt(receipt
                    ? wt("{state} is recorded. Open Activity & receipts for the exact evidence and any program instructions.").replace("{state}", wt(OUTCOME_LABELS[receipt.state]))
                    : snapDeliveryCheck
                      ? attemptRecorded ? "A delivery attempt is recorded. CaseLink must confirm its result before any retry." : "Your decision to send the exact SNAP application is recorded. CaseLink must check delivery and any agency confirmation."
                      : route.summary)}</p>
                  {!receipt && !snapDeliveryCheck && route.limitation && <p lang={wt(route.limitation) === route.limitation ? "" : locale}>{wt(route.limitation)}</p>}
                  <p>
                    <strong>{wt("Next:")}</strong>{" "}
                    {wt(receipt
                      ? receiptNextStep(state)
                      : snapDeliveryCheck || route.nextActor === "caselink"
                      ? "CaseLink"
                      : route.nextActor === "parent"
                        ? "Your personal step"
                        : route.nextActor === "agency"
                          ? "Agency response"
                          : "Program response")}
                  </p>
                  {!receipt && !snapDeliveryCheck && route.steps.length > 0 && (
                    <details className={styles.disclosure}>
                      <summary>{wt("See the planned steps")}</summary>
                      <div>
                        <ol>
                          {route.steps.map((step, index) => (
                            <li key={index} lang={wt(step) === step ? "" : locale} className={styles.small}>
                              {wt(step)}
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
                    >{wt("Official program & direct access")}</a>
                  )}
                </article>
              );
            })
          ) : (
            <div className={styles.stack}>
              <p className={styles.subtle}>{wt("Your selected needs are saved:")}</p>
              <ul>
                {request.intake.needs.map((need) => (
                  <li key={need}>
                    {wt(NEED_LABELS[need])}
                    {need === "snap_new" && currentSnapReceipt ? <> · {wt(OUTCOME_LABELS[currentSnapReceipt.state])}</> : wt(submittedNeeds.includes(need) ? " · Application submitted" : need === "snap_new" && reviewFinished ? attemptRecorded ? " · Delivery result not confirmed" : " · Submit decision recorded" : need === "snap_new" && preparedSnapReview ? " · Application prepared" : "")}
                  </li>
                ))}
              </ul>
              {showSnapProgress && <div className={styles.trustLine}>
                <Clock width={21} height={21} aria-hidden="true" />
                <div>
                  <p>{wt(currentSnapReceipt
                    ? wt("{state} is recorded. Open Activity & receipts for the exact evidence and any program instructions.").replace("{state}", wt(OUTCOME_LABELS[currentSnapReceipt.state]))
                    : !acceptingActions
                      ? "Future SNAP application work is stopped. Open Activity & receipts for anything already attempted or confirmed."
                      : attemptRecorded ? "A delivery attempt is recorded. CaseLink must confirm its result before any retry."
                        : decisionRecorded ? "Your decision to send the exact SNAP application is recorded. CaseLink must check delivery and any agency confirmation."
                          : snapReviewRequired ? "The exact SNAP application is prepared. Review it above before choosing Submit."
                            : "The exact SNAP application is prepared. CaseLink must resolve its remaining submission requirements before Submit can be offered.")}</p>
                  {currentSnapReceipt?.state === "agency_submitted" && <p>{wt("A submission is separate from approval or receiving support.")}</p>}
                  <p><strong>{wt("Next:")}</strong>{" "}{currentSnapReceipt ? wt(receiptNextStep(currentSnapReceipt.state)) : !acceptingActions ? <a className={styles.textLink} href="#application-receipts">{wt("Activity & receipts")}</a> : !reviewFinished && snapReviewRequired ? <a className={styles.textLink} href="#snap-final-review">{wt("Your application review")}</a> : "CaseLink"}</p>
                </div>
              </div>}
              {(!showSnapProgress || request.intake.needs.some(need => need !== "snap_new")) && <div className={styles.trustLine}>
                <Clock width={21} height={21} aria-hidden="true" />
                <p>
                  {wt(submittedNeeds.some(need => need !== "snap_new" || !showSnapProgress)
                    ? "An agency submission is recorded for the support marked above. Open Activity & receipts for the exact application and any follow-up requirements. A submission is separate from approval or receiving support."
                    : showSnapProgress
                      ? "Preparation is pending for your other selected support. A saved request is not an application or a confirmed appointment. You can use official programs directly while you wait."
                    : "Preparation is pending. A saved request is not an application or a confirmed appointment. You can use official programs directly while you wait.")}
                </p>
              </div>}
            </div>
          )}
          <SupportPartners request={request} />
        </section>
        <section
          id="application-receipts"
          lang={localized ? locale : "en"}
          className={`${styles.surface} ${workspace.section} ${workspace.receipts} ${wicOnly ? wicStyles.receipts : ""}`}
          tabIndex={-1}
        >
          <h2>{wt("Activity & receipts")}</h2>
          <p className={`${styles.subtle} ${styles.small}`}>
            {wt("Prepared, sent, received, approved and support actually received are different steps. We show only recorded evidence.")}
          </p>
          <SupportActivity
            request={request}
            onChange={reload}
            history={history}
          />
          {request.events?.length ? (
            <ol className={`${styles.timeline} ${styles.space}`}>
              {request.events.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong lang="">{event.summary}</strong>
                    {event.kind === "parent.outcome_reported" &&
                      event.actor === "parent" && (
                        <>
                          {typeof event.evidence?.outcome === "string" &&
                            Object.hasOwn(
                              OUTCOME_LABELS,
                              event.evidence.outcome,
                            ) && (
                              <p>
                                {wt("Reported outcome:")}{" "}
                                {wt(
                                  OUTCOME_LABELS[
                                    event.evidence
                                      .outcome as keyof typeof OUTCOME_LABELS
                                  ]
                                )}
                              </p>
                            )}
                          {typeof event.evidence?.reference === "string" && (
                            <p lang="">{event.evidence.reference}</p>
                          )}
                          {event.evidence?.foodAccessReport && <FoodAccessReportSummary report={event.evidence.foodAccessReport} requestId={request.id} />}
                        </>
                      )}
                    <p>
                      {wt(event.actor === "parent"
                        ? wicOnly ? "Reported by parent" : "Parent reported"
                        : event.actor === "operator"
                          ? "Operator confirmed"
                          : event.actor === "agency" ||
                              event.actor === "partner"
                            ? "Program update"
                            : "CaseLink activity")}
                    </p>
                    <time dateTime={event.created_at}>
                      {displayDate(event.created_at, true, localized ? locale : "en")}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className={`${styles.hint} ${styles.space}`}>
              {wt("No additional activity recorded yet. We won’t mark a request sent or received without evidence.")}
            </p>
          )}
          {request.events_truncated && (
            <p className={`${styles.hint} ${styles.space}`}>{wt("Showing the latest 200 updates.")}{" "}
              <a className={styles.textLink} href="/api/parent/account/export">{wt("Download your information")}</a>{" "}{wt("for retained earlier history.")}</p>
          )}
          <a
            className={`${styles.secondary} ${styles.space} ${styles.hidePrint}`}
            href={`/api/parent/requests/${requestId}/export`}
          >
            <Download width={18} height={18} aria-hidden="true" />
            {wt("Download current summary")}
          </a>
          <p className={`${styles.hint} ${styles.space}`}>
            {wt("Your download reflects the recorded state. Submitted packet versions and receipts are preserved when a permitted channel produces them.")}
          </p>
        </section>
        <div
          id="application-documents"
          className={workspace.section}
          tabIndex={-1}
        >
          {request.intake.needs.some(need => need.startsWith("wic_")) && <p lang={locale} className={`${styles.notice} ${wicStyles.notice}`}>
            {t(request.intake.needs.every(need => need.startsWith("wic_"))
              ? "Private WIC document intake is not connected. Existing document history remains available; do not upload WIC health or family documents through this route. Use official WIC help for required documents."
              : "This document route covers only the verified other support needs in this request. WIC private or health documents are not accepted here; use official WIC help for those documents.")}
          </p>}
          {isPrivateUtilityPreparationRequest(request) && <div className={styles.notice}><div>
            <p>Utility application documents and required identifiers use a separate protected step. Read its processing notice before adding anything. CaseLink checks and prepares permitted information automatically; saved documents do not confirm agency acceptance or stop a shutoff.</p>
            <a className={styles.textLink} href={`/protected/utilities/requests/${request.id}/workspace?expectedVersion=${request.version}`}>Open protected utility documents</a>
          </div></div>}
          <SupportDocuments
            requestId={requestId}
            documents={request.documents ?? []}
            inactive={!acceptingActions || request.intake.needs.every(need => need.startsWith("wic_")) || isPrivateUtilityPreparationRequest(request)}
            onChange={reload}
          />
        </div>
        <div
          lang={localized ? locale : "en"}
          id="application-controls"
          className={workspace.section}
          tabIndex={-1}
        >
          <section className={styles.surface}>
            <h2>{wt("Your details")}</h2>
            <dl className={styles.factList}>
              <dt>{wt("Household ZIP")}</dt>
              <dd>
                {request.intake.zip ?? wt("Current ZIP code needed")}
                <small>{wt("You provided")}</small>
              </dd>
              <dt>{wt("Household size")}</dt>
              <dd>{request.intake.householdSize ?? wt("Not provided")}</dd>
              <dt>{wt("Language preference")}</dt>
              <dd>
                {wt(request.intake.language === "es" ? "Spanish" : "English")}
              </dd>
              <dt>{wt("Updates")}</dt>
              <dd>
                {wt(request.intake.contactPreference === "email"
                  ? "Email & My support"
                  : "My support only")}
              </dd>
              {request.intake.incomeAmount !== null && (
                <>
                  <dt>{wt("Income before taxes")}</dt>
                  <dd>
                    ${request.intake.incomeAmount.toLocaleString(localized && locale === "es" ? "es-US" : "en-US")}
                    <small>
                      {localized ? wt(request.intake.incomeFrequency === "unknown" ? "Not sure / not provided" : ({ weekly: "Weekly", biweekly: "Every two weeks", twice_monthly: "Twice a month", monthly: "Monthly", yearly: "Yearly" } as const)[request.intake.incomeFrequency]) : request.intake.incomeFrequency.replaceAll("_", " ")}{" "}{wt("· You provided")}</small>
                  </dd>
                </>
              )}
              {request.intake.shutoffDate && (
                <>
                  <dt>{wt("Reported shutoff date")}</dt>
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
            <h2>{wt("Your permission")}</h2>
            <p className={styles.subtle}>{wt(inactive ? "Your saved permission for this request." : "These limits apply to future work on this request.")}</p>
            <dl className={`${styles.factList} ${workspace.permissionFacts}`}>
              <dt>{wt(request.mandate.recipientIds.length === 1 ? "1 named program" : "{n} named programs").replace("{n}", String(request.mandate.recipientIds.length))}</dt>
              <dd><ul className={styles.recipientList}>
                {request.mandate.recipientIds.map(id => (
                  <li key={id} lang={getProgram(id) ? "en" : localized ? locale : "en"}>
                    {getProgram(id)?.name ?? wt("Named program unavailable")}
                  </li>
                ))}
              </ul></dd>
              <dt>{wt("What you allowed CaseLink to do")}</dt>
              <dd>{request.mandate.allowedActions.map(action => wt(PERMISSION_ACTION_LABELS[action])).join(" · ")}</dd>
              <dt>{wt("Information CaseLink may use")}</dt>
              <dd>{request.mandate.allowedData.map(field => wt(PERMISSION_DATA_LABELS[field])).join(" · ")}</dd>
              <dt>{wt("Expires")}</dt>
              <dd><time dateTime={request.mandate.expiresAt}>{displayDate(request.mandate.expiresAt, false, localized ? locale : "en")}</time></dd>
              <dt>{wt("Attempt limit")}</dt>
              <dd>{wt("Up to {n} attempts").replace("{n}", String(request.mandate.maxAttempts))}</dd>
            </dl>
            <p className={`${styles.hint} ${styles.space}`}>{wt("No signatures, passwords, EBT PINs or binding financial commitments. Documents need their own processing consent.")}</p>
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
                  {wt(pending
                    ? "Updating…"
                    : request.status === "paused"
                      ? "Resume support"
                      : "Pause future work")}
                </button>
                {cancelConfirm ? (
                  <div className={styles.stack}>
                    <p className={styles.small}>{wt("Cancel this request and stop future work? Already sent information cannot always be recalled.")}</p>
                    <button
                      className={styles.danger}
                      disabled={pending}
                      onClick={() => changeState("cancel")}
                    >{wt("Yes, cancel this request")}</button>
                    <button
                      className={styles.quiet}
                      disabled={pending}
                      onClick={() => setCancelConfirm(false)}
                    >{wt("Keep this request")}</button>
                  </div>
                ) : (
                  <button
                    className={styles.quiet}
                    onClick={() => setCancelConfirm(true)}
                  >{wt("Cancel request & withdraw permission")}</button>
                )}
              </div>
            )}
          </section>
          <div className={styles.trustLine}>
            <Lock width={22} height={22} aria-hidden="true" />
            <div>
              <strong>{wt("Need a person or another way?")}</strong>
              <Link className={styles.textLink} href="/support/help">{wt("Find help and direct program options.")}</Link>{" "}{wt("No program outcome is guaranteed.")}<nav className={`${styles.inline} ${styles.space} ${styles.small}`} aria-label={wt("Case policies and contact")}>
                <Link className={styles.textLink} href="/support/privacy#data-policy">{wt("Data policy")}</Link>
                <Link className={styles.textLink} href="/support/privacy">{wt("Privacy")}</Link>
                <Link className={styles.textLink} href="/support/terms">{wt("Terms")}</Link>
                <a className={styles.textLink} href="mailto:willsanz23@gmail.com">{wt("Contact CaseLink")}</a>
              </nav>
            </div>
          </div>
        </div>
      </ApplicationWorkspace>

    </div>
  );
}
