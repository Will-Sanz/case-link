"use client";
import Link from "next/link";
import { Children, isValidElement, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Clock } from "iconoir-react";
import type { SupportNeed, SupportRequest } from "@/lib/parent/domain";
import type { SupportProgress } from "@/lib/parent/progress";
import { currentProtectedSnapAttempt, currentSnapReview, currentSnapDraft, SnapDraftReview, isSnapFinalReviewAction, protectedRecordedSnapPacket, recordedReceipt, type OperationHistory, type RecordedOperation } from "./support-activity";
import { sameSnapProtectedOperationBinding, snapProtectedDeliveryAttempt, type SnapProtectedOperation } from "@/lib/parent/snap-protected-operation";
import { SnapSubmissionConfirmation } from "./snap-submission-confirmation";
import { ApplicationBrowser } from "./application-browser";
import { SnapApplicationReview } from "./snap-application-review";
import { SnapFinalReview } from "./snap-final-review";
import styles from "./parent.module.css";
import layout from "./application-workspace.module.css";

export function supportTitle(request: SupportRequest): string {
  if (request.intake.needs.length > 1) return "Your family’s support";
  const need = request.intake.needs[0];
  if (need === "snap_new") return "Your SNAP application";
  if (need?.startsWith("snap_")) return "Your SNAP support";
  if (need === "food_now") return "Food for your family";
  if (need?.startsWith("wic_")) return "Your WIC support";
  return "Your utility support";
}

export function recordedApplicationState(
  operations: Pick<
    RecordedOperation,
    | "id"
    | "program_id"
    | "state"
    | "request_version"
    | "artifact_id"
    | "protected_packet"
    | "form"
    | "need"
    | "action"
    | "evidence"
  >[],
  programId?: string,
  currentVersion?: number,
  need?: SupportNeed,
): {
  label: string;
  detail: string;
  submitted: boolean;
  hasAttempt: boolean;
  currentVersionSubmitted?: boolean;
  outcome?: "assistance_approved" | "support_received" | "declined";
} {
  const relevant = operations.filter(
    (operation) =>
      (!programId || operation.program_id === programId) &&
      (!need || operation.need === need),
  );
  const latestDecision = relevant.flatMap((operation) => {
    const receipt = recordedReceipt(operation);
    return receipt && ["agency_submitted", "assistance_approved", "support_received", "declined"].includes(receipt.state) &&
      (currentVersion === undefined || operation.request_version === currentVersion)
      ? [receipt] : [];
  }).sort((a, b) => Date.parse(b.agencyStatus?.observedAt ?? b.recordedAt) - Date.parse(a.agencyStatus?.observedAt ?? a.recordedAt))[0]?.state;
  const outcome =
    latestDecision === "assistance_approved" ||
    latestDecision === "support_received" ||
    latestDecision === "declined"
      ? latestDecision
      : undefined;
  const submitted = relevant.filter(
    (operation) => operation.state === "agency_submitted" && recordedReceipt(operation),
  );
  if (submitted.length) {
    const earlierVersion =
      currentVersion !== undefined &&
      submitted.every(
        (operation) => operation.request_version !== currentVersion,
      );
    return {
      label: earlierVersion
        ? "An earlier application version was submitted"
        : "Application submission recorded",
      detail: earlierVersion
        ? "Your information has changed since the recorded submission. Activity & receipts keeps the exact application and any correction or follow-up evidence."
        : "An agency submission is recorded. Open Activity & receipts for the exact evidence and who confirmed it.",
      submitted: true,
      hasAttempt: true,
      currentVersionSubmitted: currentVersion !== undefined && !earlierVersion,
      outcome,
    };
  }
  if (
    outcome === "assistance_approved" ||
    outcome === "support_received" ||
    outcome === "declined"
  )
    return {
      label: "A program outcome is recorded",
      detail:
        "Open Activity & receipts for the program’s decision or support received. An outcome record alone does not establish how an application was filed.",
      submitted: false,
      hasAttempt: true,
      outcome,
    };
  if (
    relevant.some(
      (operation) =>
        [
          "executing",
          "delivery_unknown",
          "sent",
          "partner_received",
          "partner_accepted",
          "unresolved",
          "agency_submitted",
          "assistance_approved",
          "support_received",
          "declined",
        ].includes(operation.state) &&
        (operation.state !== "executing" ||
          !["research", "prepare"].includes(operation.action ?? "")),
    )
  )
    return {
      label: "Agency submission not confirmed",
      detail:
        "A delivery or unresolved attempt is recorded. CaseLink must confirm the agency’s receipt before calling this a submitted application or trying again.",
      submitted: false,
      hasAttempt: true,
    };
  if (relevant.some(operation => operation.state === "prepared" && (currentVersion === undefined || operation.request_version === currentVersion) && protectedRecordedSnapPacket(operation)))
    return { label: "SNAP application prepared", detail: "The exact application is prepared for your review. No application submission is recorded.", submitted: false, hasAttempt: false };
  const forms = relevant.filter((operation) => operation.artifact_id);
  return {
    label: "No application submission recorded",
    detail: forms.length
      ? forms.every((operation) => operation.form?.preparation_only)
        ? "An incomplete unsigned draft is saved. It is not a complete application and has not been submitted."
        : "A prepared form is saved. Preparation is separate from sending an application."
      : "Your support request is saved. Guidance and a support plan are separate from filling or sending an application.",
    submitted: false,
    hasAttempt: false,
  };
}

export function ApplicationWorkspace({
  request,
  progress,
  children,
  history,
  onChange,
  snapAnswerRequest,
  snapReview,
  snapSubmissionDecision,
  onReviewChange,
}: {
  request: SupportRequest;
  progress?: SupportProgress;
  children: ReactNode;
  history: OperationHistory;
  onChange?: () => void;
  snapAnswerRequest?: number;
  snapReview?: SnapProtectedOperation | null;
  snapSubmissionDecision?: SnapProtectedOperation | null;
  onReviewChange?: (review: SnapProtectedOperation | null) => void;
}) {
  const [activeSection, setActiveSection] = useState("application-overview");
  const focusTarget = useRef<HTMLElement | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const selectTarget = useCallback((id: string) => {
    const target = document.getElementById(id);
    const panel = target?.closest<HTMLElement>("[data-workspace-panel]");
    if (!target || !panel || !workspace.current?.contains(panel)) return false;
    focusTarget.current = target;
    setActiveSection(panel.dataset.workspacePanel!);
    // The current panel may already be open, so no render would move focus.
    if (!panel.hidden) target.focus();
    return true;
  }, []);
  useLayoutEffect(() => {
    const followHash = () => selectTarget(window.location.hash.slice(1) || "application-overview");
    if (window.location.hash) followHash();
    window.addEventListener("hashchange", followHash);
    window.addEventListener("popstate", followHash);
    return () => {
      window.removeEventListener("hashchange", followHash);
      window.removeEventListener("popstate", followHash);
    };
  }, [selectTarget]);
  useLayoutEffect(() => {
    const target = focusTarget.current;
    if (target && !target.closest("[data-workspace-panel]")?.contains(document.activeElement)) target.focus();
    focusTarget.current = null;
  }, [activeSection]);
  const [verification, setVerification] = useState({ requestId: request.id, needed: false });
  const onNeedsVerification = useCallback((needed: boolean) => {
    setVerification({ requestId: request.id, needed });
  }, [request.id]);
  const needsVerification = verification.requestId === request.id && verification.needed;
  const { data, error, loading, reload } = history;
  const snap = request.intake.needs.includes("snap_new");
  const operations = data?.operations ?? [];
  const historyLimited = data?.historyLimited !== false;
  const ownedReview = snap ? currentSnapReview(request, snapReview) : null;
  const knownDecision = snap ? currentSnapReview(request, snapSubmissionDecision) : null;
  const decisionRecorded = ownedReview?.snapSubmissionAuthorized === true || (knownDecision?.snapSubmissionAuthorized === true && (!ownedReview || sameSnapProtectedOperationBinding(ownedReview, knownDecision)));
  const attemptRecorded = !!ownedReview && snapProtectedDeliveryAttempt(ownedReview.state) || !error && !loading && currentProtectedSnapAttempt(request, operations);
  const reviewFinished = decisionRecorded || attemptRecorded;
  const reviewRequested = snap && request.required_actions.some(action => !action.resolved && (!action.resolver || action.resolver === "parent") && isSnapFinalReviewAction(action));
  const protectedPrepared = snap && !error && !loading && operations.some(operation => operation.request_id === request.id && operation.request_version === request.version && operation.state === "prepared" && protectedRecordedSnapPacket(operation));
  const application = recordedApplicationState(
    operations,
    snap ? "snap-pa" : undefined,
    request.version,
    snap
      ? "snap_new"
      : request.intake.needs.length === 1
        ? request.intake.needs[0]
        : undefined,
  );
  const snapSubmissionComplete = snap && application.currentVersionSubmitted;
  const draft = !loading && !error && !reviewRequested && !protectedPrepared && !reviewFinished && !application.submitted ? currentSnapDraft(request, operations) : null;
  const snapSubmission = snapSubmissionComplete
    ? operations.filter((operation) => operation.program_id === "snap-pa" &&
        operation.need === "snap_new" && operation.request_version === request.version &&
        operation.state === "agency_submitted" && recordedReceipt(operation))
      .sort((a, b) => {
        const left = recordedReceipt(a)!, right = recordedReceipt(b)!;
        return Date.parse(right.agencyStatus?.observedAt ?? right.recordedAt) - Date.parse(left.agencyStatus?.observedAt ?? left.recordedAt);
      })[0]
    : undefined;
  const snapReceipt = snapSubmission ? recordedReceipt(snapSubmission) : null;
  const relatedSnapAttempt =
    snap &&
    !error &&
    !loading &&
    operations.some(
      (operation) =>
        operation.program_id === "snap-pa" &&
        operation.need !== "snap_new" &&
        recordedApplicationState([operation]).hasAttempt,
    );
  const actions = request.required_actions.filter(
    (action) =>
      !action.resolved && (!action.resolver || action.resolver === "parent") && !(reviewFinished && isSnapFinalReviewAction(action)),
  );
  const inactive = request.status !== "active";
  const needsService = request.required_actions.some(
    (action) =>
      !action.resolved && action.resolver && action.resolver !== "parent",
  );
  const nextActor = inactive
    ? "Work is paused or finished"
    : needsVerification
      ? "Next: You — COMPASS verification"
    : actions.length
      ? "Next: You"
      : application.outcome === "support_received"
        ? "Outcome recorded: Support received"
        : application.outcome === "assistance_approved"
          ? "Next: Program follow-up"
          : application.outcome === "declined"
            ? "Next: Decision & follow-up"
            : reviewFinished && !application.submitted
              ? "Next: CaseLink"
            : progress?.state === "running" || progress?.state === "queued"
              ? "Next: CaseLink"
              : application.submitted
                ? "Next: The program"
                : "Next: CaseLink’s application connection";
  const nextDetail = inactive
    ? "Your recorded information and history stay available below. Your permission controls show whether this request can resume."
    : needsVerification
      ? "COMPASS needs a verification step in the Official website section. CaseLink will check the result and continue the supported connection steps automatically."
    : actions.length
      ? `${actions.length === 1 ? "One personal step needs" : `${actions.length} personal steps need`} your attention. Open Your next steps to continue.`
      : application.outcome === "support_received"
        ? "Support received is recorded. Your receipt and any remaining support steps are below. This outcome does not start another application."
        : application.outcome === "assistance_approved"
          ? "Approval is recorded. Actual receipt of support is a separate step. Check Activity & receipts for the decision, delivery and follow-up evidence."
          : application.outcome === "declined"
            ? "A decline is recorded. Check Activity & receipts for the decision and Program progress for any recorded appeal or alternative. The decision does not start a new application."
            : reviewFinished && !application.submitted
              ? attemptRecorded
                ? "A delivery attempt is recorded. CaseLink must confirm its result before any retry. No repeat Submit decision is requested."
                : "Your Submit decision is saved. CaseLink must check delivery and record any agency confirmation. You do not need to choose Submit again."
            : progress?.state === "running"
              ? `${progress.summary} The Official website section shows the official site connection and any recorded blocker.`
              : progress?.state === "queued"
                ? progress.summary
                : application.submitted
                  ? "Check Activity & receipts for the actual agency record and any interview, document or follow-up requirement."
                  : historyLimited
                    ? "Earlier application and delivery records need checking before a new filing. The Official website section remains available."
                    : needsService
                      ? "CaseLink has a service connection to resolve. You do not need to repeat your household details. Official program access remains available."
                      : "No application is currently confirmed as submitted. Open the Official website section; you can also use the official program directly.";
  const steps = [
    {
      id: "application-overview",
      label: "Overview",
      detail: "Saved",
      done: true,
    },
    ...(snap ? [
      { id: "application-review", label: "Your application", detail: reviewRequested && !reviewFinished ? "Review needed" : "Answers & preparation", done: false },
      { id: "application-browser", label: "Official website", detail: needsVerification && !inactive ? "Needs you now" : "COMPASS connection", done: false },
    ] : []),
    {
      id: "your-next-steps",
      label: "Your next steps",
      detail: inactive
        ? "History"
        : actions.length
          ? `${actions.length} need you`
          : needsVerification
            ? "COMPASS step above"
          : "Nothing requested",
      done:
        !needsVerification &&
        request.required_actions.length > 0 &&
        !actions.length &&
        request.required_actions.every((action) => action.resolved),
    },
    {
      id: "application-programs",
      label: "Program progress",
      detail:
        loading || error
          ? "Checking records"
          : application.submitted
            ? "Submission recorded"
            : "Not confirmed",
      done: !loading && !error && application.submitted,
    },
    {
      id: "application-documents",
      label: "Your documents",
      detail: `${request.documents?.length ?? 0} saved`,
      done: !!request.documents?.length,
    },
    {
      id: "application-receipts",
      label: "Activity & receipts",
      detail: "Recorded evidence",
      done: false,
    },
    {
      id: "application-controls",
      label: "Details & controls",
      detail: "Review or change",
      done: false,
    },
  ];
  return (
    <div className={layout.workspace} ref={workspace} onClick={event => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (selectTarget(link.hash.slice(1))) {
        event.preventDefault();
        if (window.location.hash !== link.hash) window.history.pushState(null, "", link.hash);
      }
    }}>
      <nav className={layout.checklist} aria-label="Your application checklist">
        <h2>{snap ? "Your SNAP request" : "Your support request"}</h2>
        <ol>
          {steps.map((step) => (
            <li key={step.id}>
              <a
                href={`#${step.id}`}
                aria-current={
                  activeSection === step.id ? "location" : undefined
                }

              >
                <span
                  className={`${layout.marker} ${step.done ? layout.markerDone : ""}`}
                  aria-hidden="true"
                >
                  {step.done ? <Check width={15} height={15} /> : <Clock width={14} height={14} />}
                </span>
                <span>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </span>
              </a>
            </li>
          ))}
        </ol>
        <div className={layout.helpLinks}>
          <Link href="/support/help">Get help</Link>
          <Link href="/support/privacy">Privacy & data</Link>
          <Link href="/support/terms">Terms</Link>
          <a href="mailto:willsanz23@gmail.com">Contact CaseLink</a>
        </div>
      </nav>
      <div className={layout.content}>
        <section
          className={layout.overview}
          data-workspace-panel="application-overview"
          hidden={activeSection !== "application-overview"}
          id="application-overview"
          tabIndex={-1}
          aria-labelledby="application-state"
        >
          <h2 id="application-state">
            {snap
              ? "Where your application stands"
              : "Where your support stands"}
          </h2>
          <div className={layout.statusLine}>
            {application.submitted && !error ? (
              <Check width={22} height={22} aria-hidden="true" />
            ) : (
              <Clock width={22} height={22} aria-hidden="true" />
            )}
            <div>
              <strong>
                {error
                  ? "Application records unavailable"
                  : loading
                    ? "Checking application records…"
                    : historyLimited && !application.hasAttempt
                      ? "Earlier application history needs checking"
                      : decisionRecorded && !application.hasAttempt
                        ? "Submit decision recorded"
                      : snapSubmissionComplete
                        ? "SNAP application complete"
                        : application.label}
              </strong>
              <p>
                {error
                  ? "We can’t confirm the latest submission record. Check again before starting a new attempt."
                  : loading
                    ? "We use recorded operations and receipts to confirm what actually happened."
                    : historyLimited && !application.hasAttempt
                      ? "Only the latest 100 operation records are available here. An earlier submission or uncertain delivery may be outside this view. We cannot treat this as a fresh application until earlier history is checked."
                      : decisionRecorded && !application.hasAttempt
                        ? "The decision to send your exact application is saved. Delivery and an agency confirmation are separate records."
                      : snapSubmissionComplete && !application.outcome && !historyLimited
                        ? "Submission confirmed · benefits decision pending. Open your recorded receipt for the exact application and who confirmed it."
                        : application.detail}
              </p>
            </div>
          </div>
          {!loading && !error && snapSubmissionComplete && (
            <a
              className={styles.button}
              href="#application-receipts"

            >
              View application receipt <ArrowRight width={17} height={17} aria-hidden="true" />
            </a>
          )}
          {!loading && !error && snapSubmission && snapReceipt && (
            <SnapSubmissionConfirmation
              requestId={request.id}
              operationId={snapSubmission.id}
              receipt={snapReceipt}
              outcome={application.outcome}
            />
          )}
          {error && (
            <button type="button" className={styles.quiet} onClick={reload}>
              Check application records again
            </button>
          )}
          {relatedSnapAttempt && (
            <p className={styles.hint}>
              A separate SNAP journey also has recorded activity in this
              request.{" "}
              <a className={styles.textLink} href="#application-receipts">
                Review Activity & receipts
              </a>{" "}
              before starting a new application. You can still check the public
              website view below; it does not start or duplicate an application.
            </p>
          )}
          <div className={layout.nextAction}>
            <strong>{nextActor}</strong>
            <p>{nextDetail}</p>
            {!inactive && (actions.length > 0 || needsVerification) && (
              <a className={styles.button} href={needsVerification ? "#application-browser" : reviewRequested && !reviewFinished ? "#snap-final-review" : "#your-next-steps"}>
                {needsVerification ? "Complete COMPASS verification" : reviewRequested && !reviewFinished ? "Review application and Submit" : actions.length === 1 ? "Complete your step" : "See your steps"}{" "}
                <ArrowRight width={17} height={17} aria-hidden="true" />
              </a>
            )}
          </div>
        </section>
        <div id="application-review" tabIndex={-1} className={layout.panel} data-workspace-panel="application-review" hidden={activeSection !== "application-review"}>
        {draft && <SnapDraftReview key={`${request.id}:${request.version}:${draft.artifact_id}`} request={request} operation={draft}/>}
        {reviewRequested && <SnapFinalReview key={`${request.id}:${request.version}`} request={request} onChange={onChange} onReviewChange={onReviewChange}/>}
        {snap && <SnapApplicationReview key={`snap-answers:${request.id}`} request={request} onChange={onChange} answerRequest={snapAnswerRequest}/>}
        </div>
        {snap && (
          <div className={layout.panel} data-workspace-panel="application-browser" hidden={activeSection !== "application-browser"}>
          <ApplicationBrowser
            key={`compass-browser:${request.id}`}
            request={request}
            preparedApplicationAvailable={protectedPrepared || attemptRecorded || ownedReview?.protectedPacketCurrent === true}
            canStart={!loading && !error && !application.hasAttempt && !protectedPrepared}
            hasAttempt={
              loading ||
              !!error ||
              historyLimited ||
              application.hasAttempt ||
              protectedPrepared ||
              relatedSnapAttempt
            }
            onNeedsVerification={onNeedsVerification}
          />
          </div>
        )}
        {Children.map(children, child => {
          const section = isValidElement<{ id?: string }>(child) && child.props.id || "application-overview";
          return <div className={layout.panel} data-workspace-panel={section} hidden={activeSection !== section}>{child}</div>;
        })}
      </div>
    </div>
  );
}
