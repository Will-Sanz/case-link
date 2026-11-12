"use client";
import { Clock, Refresh, WarningTriangle } from "iconoir-react";
import type { SupportProgress } from "@/lib/parent/progress";
import { displayDate } from "./api";
import { usePermissionWindow } from "./use-permission-window";
import styles from "./parent.module.css";

export const PROGRESS_LABELS: Record<SupportProgress["state"], string> = {
  queued: "Waiting to start",
  running: "CaseLink is working",
  needs_parent: "A step needs you",
  waiting: "Waiting for the next step",
  paused: "Paused by you",
  cancelled: "Cancelled",
  closed: "Closed",
  failed: "A service step needs attention",
  service_offline: "Background service unavailable",
};

export function ProgressBadge({ progress }: { progress: SupportProgress }) {
  return (
    <span
      className={`${styles.badge} ${
        ["failed", "service_offline"].includes(progress.state)
          ? styles.badgeError
          : progress.state === "needs_parent"
            ? styles.badgeAttention
            : progress.state !== "running"
              ? styles.badgeWait
              : ""
      }`}
    >
      {PROGRESS_LABELS[progress.state]}
    </span>
  );
}

export function SupportProgressPanel({
  progress,
  onRefresh,
}: {
  progress?: SupportProgress;
  onRefresh: () => void;
}) {
  const unavailable = !progress || progress.state === "service_offline";
  const Icon = unavailable ? WarningTriangle : Clock;
  return (
    <section className={styles.progressPanel} aria-labelledby="support-status">
      <div className={styles.progressHeading}>
        <Icon width={24} height={24} aria-hidden="true" />
        <div>
          <h2 id="support-status" aria-live="polite">
            {progress ? PROGRESS_LABELS[progress.state] : "Status unavailable"}
          </h2>
          <p>
            {progress?.summary ??
              "We could not verify whether background work is active. Refresh to check. A saved request does not mean an application was sent."}
          </p>
        </div>
      </div>
      <div className={styles.progressFooter}>
        <div>
          {progress && (
            <p>
              Last recorded work update{" "}
              <time dateTime={progress.updatedAt}>
                {displayDate(progress.updatedAt, true)}
              </time>
            </p>
          )}
          {progress?.nextRunAt && (
            <p>
              Next check scheduled for{" "}
              <time dateTime={progress.nextRunAt}>
                {displayDate(progress.nextRunAt, true)}
              </time>
              .
            </p>
          )}
          {progress?.state === "waiting" && !progress.nextRunAt && (
            <p>
              No automatic check is currently scheduled. Check recorded activity
              for the next step.
            </p>
          )}
          {progress?.canContinueAfterClosing && (
            <p>You can leave this page. Authorized work can continue.</p>
          )}
          {progress?.state === "service_offline" && (
            <p>
              We cannot confirm that background work is running. Check recorded
              activity or refresh.
            </p>
          )}
        </div>
        <button
          className={`${styles.quiet} ${styles.hidePrint}`}
          onClick={onRefresh}
          aria-label="Refresh support progress"
        >
          <Refresh width={17} height={17} aria-hidden="true" />
          Refresh status
        </button>
      </div>
    </section>
  );
}

export function ApplicationSchedule({ request, progress, decisionFinished = false }: { request: import("@/lib/parent/domain").SupportRequest; progress?: SupportProgress; decisionFinished?: boolean }) {
  const permitted = usePermissionWindow(Date.parse(request.mandate.expiresAt));
  const triggers: Record<string, string> = {
    scheduled_follow_up: "Scheduled follow-up", parent_action_completed: "Completion of your required step",
    provider_capability_enabled: "The program connection becomes available", verified_receipt_available: "A verified receipt becomes available",
    authorization_renewed: "Permission is renewed", route_review_required: "CaseLink reviews the program connection", parent_reentry: "You return to this request", none: "No next trigger recorded",
  };
  return <>
    <p><strong>Next check:</strong> {request.status !== "active" ? "Future work is stopped." : !permitted ? "Permission has expired; future work is stopped." : !progress || progress.state === "service_offline" ? "The schedule cannot currently be verified." : progress.nextRunAt ? <time dateTime={progress.nextRunAt}>{displayDate(progress.nextRunAt, true)}</time> : "No automatic check is currently scheduled."}</p>
    <p><strong>Next trigger:</strong> {decisionFinished && request.next_trigger === "parent_action_completed" ? "Submit is already recorded; delivery must be checked before another attempt" : triggers[request.next_trigger ?? ""] ?? "Not recorded"}.</p>
  </>;
}
