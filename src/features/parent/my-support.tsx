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
import { useParentLocale } from "./parent-locale";
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

export function MySupport() {
  const { locale, t } = useParentLocale();
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
  const requests = data?.requests ?? [];
  const progress = data?.progress ?? {};
  const needsAttention = (request: SupportRequest) => request.status === "active" &&
    (progress[request.id]?.state === "needs_parent" ||
      (!progress[request.id] && requestStatus(request) === "A step needs you"));
  const groups = [
    { title: "Needs your attention", requests: requests.filter(needsAttention) },
    { title: "In progress and recent updates", requests: requests.filter(request => !needsAttention(request)) },
  ];
  return (
    <div lang={locale} className={styles.container}>
      <div className={`${styles.pageTop} ${styles.supportListHeader}`}>
        <h1>{t("My support")}</h1>
        <div className={styles.inline}>
          <button className={styles.quiet} onClick={reload} aria-label={t("Refresh support status")}>
            <Refresh width={17} height={17} aria-hidden="true" />
            {t("Refresh status")}
          </button>
          {requests.length > 0 && <Link className={styles.secondary} href="/get-support">
            {t("Get more support")}{" "}
            <ArrowRight width={18} height={18} aria-hidden="true" />
          </Link>}
        </div>
      </div>
      {loading ? (
        <ParentLoading />
      ) : error ? (
        <ServiceError error={error} retry={reload} />
      ) : requests.length ? (
        <div className={styles.requestGroups}>
          {groups.filter(group => group.requests.length > 0).map(group => (
            <section key={group.title} aria-label={t(group.title)}>
              <h2>{t(group.title)}</h2>
              <ul className={styles.list}>
          {group.requests.map((request) => {
            const summary = progress[request.id]?.summary ?? request.plan?.summary ??
              "Your request is saved. Application progress and your next step will appear here.";
            return (
            <li key={request.id}>
              <Link
                className={styles.requestCard}
                href={`/support/${request.id}${needsAttention(request) && requestStatus(request) === "A step needs you" ? "#your-next-steps" : ""}`}
              >
                <div className={styles.between}>
                  <h3>
                    {request.intake.needs
                      .map((need) => t(NEED_LABELS[need]))
                      .join(" · ")}
                  </h3>
                  {progress[request.id] ? (
                    <ProgressBadge progress={progress[request.id]} />
                  ) : (
                    <span
                      className={`${styles.badge} ${request.required_actions.some((a) => !a.resolved && (!a.resolver || a.resolver === "parent")) ? styles.badgeAttention : request.status !== "active" ? styles.badgeWait : ""}`}
                    >
                      {t(requestStatus(request))}
                    </span>
                  )}
                </div>
                <p lang={t(summary) === summary ? "en" : locale}>
                  {t(summary)}
                </p>
                <div className={styles.requestMeta}>
                  <span className={styles.inline}>
                    <Clock width={15} height={15} aria-hidden="true" />
                    {t("Updated")} <time dateTime={request.updated_at}>{displayDate(request.updated_at, false, locale)}</time>
                  </span>
                  <span>
                    {request.mandate.mode === "prepare_only"
                      ? t("Preparation only")
                      : t("Permitted steps authorized")}
                  </span>
                  <span className={`${styles.textLink} ${styles.inline}`}>
                    {t("View support")}{" "}
                    <ArrowRight width={15} height={15} aria-hidden="true" />
                  </span>
                </div>
              </Link>
            </li>
          ); })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Folder width={28} height={28} aria-hidden="true" />
          </div>
          <h2>{t("Your next steps can start here")}</h2>
          <p>
            {t("Request food or utility support, and we’ll keep your information and progress together in one place.")}
          </p>
          <Link className={styles.button} href="/get-support">
            {t("Find support for my family")}{" "}
            <ArrowRight width={18} height={18} aria-hidden="true" />
          </Link>
        </div>
      )}

    </div>
  );
}
