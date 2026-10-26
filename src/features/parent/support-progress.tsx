import { Clock, Refresh, WarningTriangle } from "iconoir-react";
import type { SupportProgress } from "@/lib/parent/progress";
import { displayDate } from "./api";
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
