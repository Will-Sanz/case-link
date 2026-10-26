import Link from "next/link";
import { ArrowRight, InfoCircle, WarningTriangle } from "iconoir-react";
import { ParentApiError } from "./api";
import styles from "./parent.module.css";

export function ServiceError({
  error,
  retry,
  returnTo = "/my-support",
}: {
  error: Error;
  retry?: () => void;
  returnTo?: string;
}) {
  if (error instanceof ParentApiError && error.status === 401)
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>
          <InfoCircle width={28} height={28} aria-hidden="true" />
        </div>
        <h2>Let’s bring you back to your support</h2>
        <p>
          Sign in with your email code to keep your household’s information
          private.
        </p>
        <Link
          className={styles.button}
          href={`/sign-in?next=${encodeURIComponent(returnTo)}`}
        >
          Sign in to continue{" "}
          <ArrowRight width={18} height={18} aria-hidden="true" />
        </Link>
      </div>
    );
  return (
    <div className={styles.error} role="alert">
      <WarningTriangle width={23} height={23} aria-hidden="true" />
      <div>
        <strong>
          {error instanceof ParentApiError && error.status === 503
            ? "Live support isn’t available yet"
            : "We couldn’t finish this step"}
        </strong>
        <p>{error.message}</p>
        <div className={`${styles.inline} ${styles.space}`}>
          {retry && (
            <button className={styles.secondary} onClick={retry}>
              Try again
            </button>
          )}
          <Link className={styles.textLink} href="/support/help">
            See direct support options
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ParentLoading({
  label = "Loading your support",
}: {
  label?: string;
}) {
  return (
    <div className={styles.loading} role="status" aria-label={label}>
      <span className={styles.screenReader}>{label}…</span>
      <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
      <div className={styles.skeleton} />
      <div className={styles.skeleton} />
      <div className={styles.skeleton} />
    </div>
  );
}
