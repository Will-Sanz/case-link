"use client";
import Link from "next/link";
import { useEffect } from "react";
import { ArrowRight, Clock, Folder, Refresh } from "iconoir-react";
import { NEED_LABELS } from "@/lib/parent/domain";
import type { SupportRequest } from "@/lib/parent/domain";
import type { SupportProgress } from "@/lib/parent/progress";
import { displayDate } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import { ProgressBadge } from "./support-progress";
import { currentApplicationState, type OperationHistory } from "./support-activity";
import type { SnapProtectedOperation } from "@/lib/parent/snap-protected-operation";
import styles from "./parent.module.css";

export function requestStatus(request: SupportRequest): string {
  if (request.status === "cancelled") return "Cancelled";
  if (request.status === "paused") return "Paused by you";
  if (request.status === "closed") return "Closed";
  if (
    request.required_actions.some(
      (action) =>
        !action.resolved && (!action.resolver || action.resolver === "parent"),
    )
  )
    return "A step needs you";
  if (request.required_actions.some((action) => !action.resolved))
    return "Waiting on a service step";
  return request.plan ? "Guidance ready" : "Request saved";
}

function SnapCardStatus({ request }: { request: SupportRequest }) {
  const history = useParentResource<NonNullable<OperationHistory["data"]>>(`/requests/${request.id}/operations?updated=${encodeURIComponent(request.updated_at)}`);
  const saved = useParentResource<{ review: SnapProtectedOperation | null }>(`/requests/${request.id}/snap-submission?expectedVersion=${request.version}&updated=${encodeURIComponent(request.updated_at)}`);
  const state = currentApplicationState(request, history, !saved.error && !saved.loading ? saved.data?.review : null);
  return <span className={styles.badge}>{request.status !== "active" ? `${requestStatus(request)} · ` : ""}{saved.error && !state.hasAttempt ? "Application records unavailable" : state.label}</span>;
}

export function MySupport() {
  const { data, error, loading, reload, reloadIfIdle } = useParentResource<{
    requests: SupportRequest[];
    progress?: Record<string, SupportProgress>;
  }>("/requests");
  const hasOpenRequests = data?.requests.some((request) =>
    request.status === "active" || request.status === "paused",
  ) ?? false;
  useEffect(() => {
    if (!hasOpenRequests) return;
    const refresh = () => {
      if (document.visibilityState === "visible") reloadIfIdle();
    };
    const interval = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [hasOpenRequests, reloadIfIdle]);
  return (
    <div className={styles.container}>
      <div className={styles.pageTop}>
        <div>
          <h1>My support</h1>
          <p>
            A clear view of what’s happening, what comes next, and anything that
            needs you.
          </p>
        </div>
        <div className={styles.inline}>
          <button className={styles.quiet} onClick={reload} aria-label="Refresh support status">
            <Refresh width={17} height={17} aria-hidden="true" />
            Refresh status
          </button>
          <Link className={styles.button} href="/get-support">
            Get more support{" "}
            <ArrowRight width={18} height={18} aria-hidden="true" />
          </Link>
        </div>
      </div>
      {loading ? (
        <ParentLoading />
      ) : error ? (
        <ServiceError error={error} retry={reload} />
      ) : data?.requests.length ? (
        <ul className={styles.list}>
          {data.requests.map((request) => (
            <li key={request.id}>
              <Link
                className={styles.requestCard}
                href={`/support/${request.id}`}
              >
                <div className={styles.between}>
                  <h2>
                    {request.intake.needs
                      .map((need) => NEED_LABELS[need])
                      .join(" · ")}
                  </h2>
                  {request.intake.needs.includes("snap_new") ? <SnapCardStatus request={request}/> : data.progress?.[request.id] ? (
                    <ProgressBadge progress={data.progress[request.id]} />
                  ) : (
                    <span
                      className={`${styles.badge} ${request.required_actions.some((a) => !a.resolved && (!a.resolver || a.resolver === "parent")) ? styles.badgeAttention : request.status !== "active" ? styles.badgeWait : ""}`}
                    >
                      {requestStatus(request)}
                    </span>
                  )}
                </div>
                <p>
                  {data.progress?.[request.id]?.summary ??
                    request.plan?.summary ??
                    "Your request is saved. Application progress and your next step will appear here."}
                </p>
                <div className={styles.requestMeta}>
                  <span className={styles.inline}>
                    <Clock width={15} height={15} aria-hidden="true" />
                    Updated {displayDate(request.updated_at)}
                  </span>
                  <span>
                    {request.mandate.mode === "prepare_only"
                      ? "Preparation only"
                      : "Permitted steps authorized"}
                  </span>
                  <span className={`${styles.textLink} ${styles.inline}`}>
                    View support{" "}
                    <ArrowRight width={15} height={15} aria-hidden="true" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Folder width={28} height={28} aria-hidden="true" />
          </div>
          <h2>Your next steps can start here</h2>
          <p>
            Request food or utility support, and we’ll keep your information and
            progress together in one place.
          </p>
          <Link className={styles.button} href="/get-support">
            Find support for my family{" "}
            <ArrowRight width={18} height={18} aria-hidden="true" />
          </Link>
        </div>
      )}
      <div className={`${styles.trustLine} ${styles.space}`}>
        <Clock width={22} height={22} aria-hidden="true" />
        <div>
          <strong>Know what’s happening.</strong> Each request shows whether
          work is running, waiting or needs you. Signing out protects this
          device; it doesn’t cancel your permission. A saved request is
          different from an application sent to a program.
        </div>
      </div>
    </div>
  );
}
