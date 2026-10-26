"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, Clock, Lock, Refresh } from "iconoir-react";
import type { SupportNeed, SupportRequest } from "@/lib/parent/domain";
import type { SupportProgress } from "@/lib/parent/progress";
import type { ApplicationBrowserResponse } from "@/lib/parent/browser-policy";
import { getProgram, SNAP_NEW_APPLICATION_URL } from "@/lib/parent/programs";
import { displayDate, parentApi } from "./api";
import { useParentResource } from "./use-parent-resource";
import type { OperationHistory, RecordedOperation } from "./support-activity";
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
    | "need"
    | "action"
  >[],
  programId?: string,
  currentVersion?: number,
  need?: SupportNeed,
): {
  label: string;
  detail: string;
  submitted: boolean;
  hasAttempt: boolean;
  outcome?: "assistance_approved" | "support_received" | "declined";
} {
  const relevant = operations.filter(
    (operation) =>
      (!programId || operation.program_id === programId) &&
      (!need || operation.need === need),
  );
  const latestDecision = relevant.find((operation) =>
    [
      "agency_submitted",
      "assistance_approved",
      "support_received",
      "declined",
    ].includes(operation.state),
  )?.state;
  const outcome =
    latestDecision === "assistance_approved" ||
    latestDecision === "support_received" ||
    latestDecision === "declined"
      ? latestDecision
      : undefined;
  const submitted = relevant.filter(
    (operation) => operation.state === "agency_submitted",
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
  return {
    label: "No application submission recorded",
    detail: relevant.some((operation) => operation.artifact_id)
      ? "A prepared form is saved. Preparation is separate from sending an application."
      : "Your support request is saved. Guidance and a support plan are separate from filling or sending an application.",
    submitted: false,
    hasAttempt: false,
  };
}

function safeFrameUrl(value: string | null, requestId: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin &&
      url.pathname.startsWith(`/api/parent/requests/${requestId}/browser/`) &&
      !url.username &&
      !url.password &&
      !url.hash
      ? `${url.pathname}${url.search}`
      : null;
  } catch {
    return null;
  }
}

function ApplicationBrowser({
  request,
  canStart,
  hasAttempt,
}: {
  request: SupportRequest;
  canStart: boolean;
  hasAttempt: boolean;
}) {
  const { data, error, loading, reload } =
    useParentResource<ApplicationBrowserResponse>(
      `/requests/${request.id}/browser`,
    );
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState("");
  const [startError, setStartError] = useState("");
  const [frameRevision, setFrameRevision] = useState(0);
  const [frameFailed, setFrameFailed] = useState<string | null>(null);
  const session = error ? null : data?.session;
  const active =
    session && ["starting", "running", "needs_parent"].includes(session.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        reload();
        setFrameRevision((value) => value + 1);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [active, reload]);
  const frameUrl = session?.frameUrl
    ? safeFrameUrl(session.frameUrl, request.id)
    : null;
  const shownFrame = frameUrl
    ? `${frameUrl}${frameUrl.includes("?") ? "&" : "?"}view=${frameRevision}`
    : null;
  let host = "Pennsylvania COMPASS";
  try {
    if (session?.currentUrl) host = new URL(session.currentUrl).hostname;
  } catch {
    /* The status still has a safe program label. */
  }
  async function start() {
    setStarting(true);
    setStartError("");
    setNotice("");
    try {
      await parentApi(`/requests/${request.id}/browser`, {
        method: "POST",
        body: JSON.stringify({ programId: "snap-pa" }),
      });
      reload();
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : "The application connection could not start. Try again.",
      );
    } finally {
      setStarting(false);
    }
  }
  async function stop() {
    setStopping(true);
    setStartError("");
    setNotice("");
    try {
      await parentApi(`/requests/${request.id}/browser`, { method: "DELETE" });
      setNotice(
        "Website viewer stopped. Your support request and its permission have not changed.",
      );
      reload();
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : "We couldn’t stop the website viewer. Try again.",
      );
    } finally {
      setStopping(false);
    }
  }
  return (
    <section
      className={layout.browser}
      aria-labelledby="application-browser-title"
    >
      <div className={layout.browserBar}>
        <span className={layout.browserAddress}>
          <Lock width={15} height={15} aria-hidden="true" />
          {host}
        </span>
        <span>
          {session
            ? "Recorded browser session"
            : "Official application connection"}
        </span>
      </div>
      <div className={layout.browserBody}>
        <h3 id="application-browser-title">
          {session?.status === "running"
            ? "CaseLink’s application browser"
            : session?.status === "needs_parent"
              ? "A personal check needs you"
              : session?.status === "completed"
                ? "Browser work finished"
                : session?.status === "starting"
                  ? "Opening the official application"
                  : "Your SNAP application connection"}
        </h3>
        <p aria-live="polite">
          {session?.summary ??
            (loading
              ? "Checking the application connection…"
              : error
                ? "We couldn’t confirm the application connection. Refresh to check before starting another attempt."
                : (data?.reason ??
                  "An automatic application connection is not available for this request. No application is being filled or submitted here."))}
        </p>
        {session && (
          <p className={styles.hint}>
            Last recorded browser update: {displayDate(session.updatedAt, true)}
            . A finished browser session does not by itself confirm submission.
          </p>
        )}
        <p className={styles.hint}>
          This connection currently checks the official start page only. It does
          not fill personal fields or submit an application. Required provider
          checks and a protected application connection must be completed first.
        </p>
        <div className={layout.browserActions}>
          {data?.available &&
            !error &&
            request.status === "active" &&
            canStart &&
            (!session || session.status === "closed") && (
              <button
                type="button"
                className={styles.button}
                disabled={starting || stopping}
                onClick={start}
              >
                {starting
                  ? "Opening application view…"
                  : session?.status === "closed"
                    ? "Reopen application view"
                    : "Open application view"}
                <ArrowRight width={17} height={17} aria-hidden="true" />
              </button>
            )}
          {session && session.status !== "closed" && !error && (
            <button
              type="button"
              className={styles.secondary}
              disabled={starting || stopping}
              onClick={stop}
            >
              {stopping ? "Stopping website view…" : "Stop website view"}
            </button>
          )}
          <button
            type="button"
            className={styles.quiet}
            onClick={() => {
              reload();
              setFrameRevision((value) => value + 1);
            }}
          >
            <Refresh width={16} height={16} aria-hidden="true" /> Refresh
            application connection
          </button>
          <a
            className={styles.textLink}
            href={
              hasAttempt
                ? getProgram("snap-pa")!.officialUrl
                : SNAP_NEW_APPLICATION_URL
            }
          >
            {hasAttempt
              ? "Open the official SNAP service"
              : "Start a new SNAP application with DHS"}
          </a>
        </div>
        {startError && (
          <p className={styles.error} role="alert">
            {startError}
          </p>
        )}
        {notice && (
          <p className={styles.success} role="status">
            {notice}
          </p>
        )}
        <p className={styles.hint}>
          No COMPASS account is needed to begin on the official site; opening it
          does not file an application. Required identifiers belong in protected
          program fields, never chat.
        </p>
      </div>
      {shownFrame && frameFailed !== shownFrame && (
        // The server renders an owned, redacted browser screenshot; never embed a provider page or an arbitrary URL.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={layout.frame}
          src={shownFrame}
          alt="Current official application page in CaseLink’s secure browser"
          onError={() => setFrameFailed(shownFrame)}
        />
      )}
      {frameFailed === shownFrame && shownFrame && (
        <p className={layout.frameNotice} role="status">
          The browser image could not load. Refresh the application connection;
          the last recorded status above is still available.
        </p>
      )}
      {shownFrame && (
        <p className={layout.frameNotice}>
          Protected browser view. Sensitive fields are masked before this image
          reaches your device. Use the checklist to review saved work and
          receipts.
        </p>
      )}
    </section>
  );
}

export function ApplicationWorkspace({
  request,
  progress,
  children,
  history,
}: {
  request: SupportRequest;
  progress?: SupportProgress;
  children: ReactNode;
  history: OperationHistory;
}) {
  const [activeSection, setActiveSection] = useState("application-overview");
  const { data, error, loading, reload } = history;
  const snap = request.intake.needs.includes("snap_new");
  const operations = data?.operations ?? [];
  const historyLimited = data?.historyLimited !== false;
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
      !action.resolved && (!action.resolver || action.resolver === "parent"),
  );
  const inactive = request.status !== "active";
  const needsService = request.required_actions.some(
    (action) =>
      !action.resolved && action.resolver && action.resolver !== "parent",
  );
  const nextActor = inactive
    ? "Work is paused or finished"
    : actions.length
      ? "Next: You"
      : application.outcome === "support_received"
        ? "Outcome recorded: Support received"
        : application.outcome === "assistance_approved"
          ? "Next: Program follow-up"
          : application.outcome === "declined"
            ? "Next: Decision & follow-up"
            : progress?.state === "running" || progress?.state === "queued"
              ? "Next: CaseLink"
              : application.submitted
                ? "Next: The program"
                : "Next: CaseLink’s application connection";
  const nextDetail = inactive
    ? "Your recorded information and history stay available below. Your permission controls show whether this request can resume."
    : actions.length
      ? `${actions.length === 1 ? "One personal step needs" : `${actions.length} personal steps need`} your attention. Everything currently known to need you is grouped below.`
      : application.outcome === "support_received"
        ? "Support received is recorded. Your receipt and any remaining support steps are below. This outcome does not start another application."
        : application.outcome === "assistance_approved"
          ? "Approval is recorded. Actual receipt of support is a separate step. Check Activity & receipts for the decision, delivery and follow-up evidence."
          : application.outcome === "declined"
            ? "A decline is recorded. Check Activity & receipts for the decision and Program progress for any recorded appeal or alternative. The decision does not start a new application."
            : progress?.state === "running"
              ? `${progress.summary} The browser below shows the official site connection and any recorded blocker.`
              : progress?.state === "queued"
                ? progress.summary
                : application.submitted
                  ? "Check Activity & receipts for the actual agency record and any interview, document or follow-up requirement."
                  : historyLimited
                    ? "Earlier application and delivery records need checking before a new filing. The public website view remains available below."
                    : needsService
                      ? "CaseLink has a service connection to resolve. You do not need to repeat your household details. Official program access remains available."
                      : "No application is currently confirmed as submitted. Check the application connection below; you can also use the official program directly.";
  const steps = [
    {
      id: "application-overview",
      label: "Request & permission",
      detail: "Saved",
      done: true,
    },
    {
      id: "your-next-steps",
      label: "Your next steps",
      detail: inactive
        ? "History"
        : actions.length
          ? `${actions.length} need you`
          : "Nothing requested",
      done:
        request.required_actions.length > 0 &&
        !actions.length &&
        request.required_actions.every((action) => action.resolved),
    },
    {
      id: "application-programs",
      label: "Application progress",
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
    <div className={layout.workspace}>
      <nav className={layout.checklist} aria-label="Your application checklist">
        <h2>{snap ? "Your SNAP checklist" : "Your support checklist"}</h2>
        <ol>
          {steps.map((step, index) => (
            <li key={step.id}>
              <a
                href={`#${step.id}`}
                aria-current={
                  activeSection === step.id ? "location" : undefined
                }
                onClick={() => {
                  setActiveSection(step.id);
                  document
                    .getElementById(step.id)
                    ?.focus({ preventScroll: true });
                }}
              >
                <span
                  className={`${layout.marker} ${step.done ? layout.markerDone : ""}`}
                  aria-hidden="true"
                >
                  {step.done ? <Check width={15} height={15} /> : index + 1}
                </span>
                <span>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className={layout.content}>
        <section
          className={layout.overview}
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
                      : application.label}
              </strong>
              <p>
                {error
                  ? "We can’t confirm the latest submission record. Check again before starting a new attempt."
                  : loading
                    ? "We use recorded operations and receipts to confirm what actually happened."
                    : historyLimited && !application.hasAttempt
                      ? "Only the latest 100 operation records are available here. An earlier submission or uncertain delivery may be outside this view. We cannot treat this as a fresh application until earlier history is checked."
                      : application.detail}
              </p>
            </div>
          </div>
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
            {!inactive && actions.length > 0 && (
              <a className={styles.button} href="#your-next-steps">
                {actions.length === 1 ? "Complete your step" : "See your steps"}{" "}
                <ArrowRight width={17} height={17} aria-hidden="true" />
              </a>
            )}
          </div>
          <ul
            className={layout.completeList}
            aria-label="Saved for this request"
          >
            <li>
              <Check width={15} height={15} aria-hidden="true" /> Your support
              needs
            </li>
            <li>
              <Check width={15} height={15} aria-hidden="true" /> Household ZIP{" "}
              {request.intake.zip}
            </li>
            <li>
              <Check width={15} height={15} aria-hidden="true" /> Bounded
              permission
            </li>
          </ul>
        </section>
        {snap && (
          <ApplicationBrowser
            request={request}
            canStart={!loading && !error && !application.hasAttempt}
            hasAttempt={
              loading ||
              !!error ||
              historyLimited ||
              application.hasAttempt ||
              relatedSnapAttempt
            }
          />
        )}
        {children}
      </div>
    </div>
  );
}
