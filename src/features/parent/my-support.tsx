"use client";
import Link from "next/link";
import { ArrowRight, Clock, Folder } from "iconoir-react";
import { NEED_LABELS } from "@/lib/parent/domain";
import type { SupportRequest } from "@/lib/parent/domain";
import { displayDate } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
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
  return request.plan ? "Support in progress" : "Getting started";
}

export function MySupport() {
  const { data, error, loading, reload } = useParentResource<{
    requests: SupportRequest[];
  }>("/requests");
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
        <Link className={styles.button} href="/get-support">
          Get more support{" "}
          <ArrowRight width={18} height={18} aria-hidden="true" />
        </Link>
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
                  <span
                    className={`${styles.badge} ${request.required_actions.some((a) => !a.resolved && (!a.resolver || a.resolver === "parent")) ? styles.badgeAttention : request.status !== "active" ? styles.badgeWait : ""}`}
                  >
                    {requestStatus(request)}
                  </span>
                </div>
                <p>
                  {request.plan?.summary ??
                    "Your request is saved. Preparation and any required next steps will appear here."}
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
                  <span className={styles.textLink}>
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
          <strong>You can leave the page.</strong>Authorized work can continue
          until its limits expire, or you pause or cancel. Signing out protects
          this device; it doesn’t cancel your request.
        </div>
      </div>
    </div>
  );
}
