"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download } from "iconoir-react";
import { parentApi, ParentApiError } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import styles from "./parent.module.css";

export function AccountDeletion({ ownerId, initiallyRecorded = false, showExport = false, onRecorded }: {
  ownerId: string; initiallyRecorded?: boolean; showExport?: boolean; onRecorded?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(!showExport);
  const [confirmation, setConfirmation] = useState("");
  const [deleted, setDeleted] = useState(initiallyRecorded);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  useEffect(() => { if (deleted) resultHeading.current?.focus(); }, [deleted]);
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || confirmation !== "DELETE") return;
    setPending(true);
    setError("");
    try {
      await parentApi("/account", {
        method: "POST",
        body: JSON.stringify({ action: "delete", confirmation, expectedOwnerId: ownerId }),
      });
      setDeleted(true);
      onRecorded?.();
      try {
        await parentApi("/auth", {
          method: "POST",
          body: JSON.stringify({ action: "sign_out" }),
        });
      } catch {
        setError(
          "Parent-support access is disabled, but we couldn’t confirm sign-out on this device. Close this browser before leaving a shared device.",
        );
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t record your deletion request. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  if (!z.uuid().safeParse(ownerId).success) return <ServiceError error={new Error("Deletion access could not be confirmed. Please try again.")} />;
  if (deleted)
    return (
      <section className={styles.surface}>
        <h2 ref={resultHeading} tabIndex={-1}>Your deletion request is recorded</h2>
        <p className={`${styles.subtle} ${styles.space}`}>
          Future parent-support work is stopped and parent access is disabled.
          Private files and eligible parent records enter the deletion process.
          Your existing CaseLink sign-in and school records are kept separate.
          Information already sent to a program may remain under that program’s
          retention rules.
        </p>
        <p className={`${styles.hint} ${styles.space}`}>
          Deletion does not withdraw an application already held by an agency.
          Contact that program directly for its options.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Link className={`${styles.button} ${styles.space}`} href="/">
          Return home
        </Link>
      </section>
    );
  return (
      <section className={styles.surface}>
        <h2>Your information & control</h2>
        {showExport && <>
        <p className={`${styles.subtle} ${styles.small}`}>
          Download your account information and recorded support history.
          Individual request pages also include printable summaries.
        </p>
        <a
          className={`${styles.secondary} ${styles.space}`}
          href="/api/parent/account/export"
        >
          <Download width={18} height={18} aria-hidden="true" />
          Download my information
        </a>
        </>}
        <div className={styles.disclosure}>
          <Link className={styles.textLink} href="/support/privacy">
            Read privacy, retention and sharing details
          </Link>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <details
          className={styles.disclosure}
          open={deleteOpen}
          onToggle={(event) => setDeleteOpen(event.currentTarget.open)}
        >
          <summary>Delete my parent-support data & stop future work</summary>
          <div>
            <p className={`${styles.small} ${styles.subtle}`}>
              This stops parent-support work, blocks parent access and records a
              deletion request. It keeps your existing CaseLink sign-in and
              school records. Minimal service evidence and information already
              delivered to a program have separate retention rules. Download
              anything you need first.
            </p>
            <form
              className={`${styles.form} ${styles.space}`}
              onSubmit={remove}
            >
              <div className={styles.field}>
                <label htmlFor="delete-confirmation">
                  Type DELETE to confirm
                </label>
                <input
                  id="delete-confirmation"
                  className={styles.input}
                  autoComplete="off"
                  disabled={pending}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                  pattern="DELETE"
                />
              </div>
              <button
                className={styles.danger}
                type="submit"
                disabled={pending || confirmation !== "DELETE"}
              >
                {pending
                  ? "Recording deletion…"
                  : "Delete parent-support data & stop work"}
              </button>
              <button
                className={styles.quiet}
                type="button"
                disabled={pending}
                onClick={() => {
                  setDeleteOpen(false);
                  setConfirmation("");
                }}
              >
                Keep my parent-support data
              </button>
            </form>
          </div>
        </details>
      </section>
  );
}

/** This metadata-only fallback does not reopen account reads, enrollment or support work. */
export function AccountDeletionAccess() {
  const { data, error, loading, reload } = useParentResource<{ ownerId: string; status: "active" | "deletion_requested" }>("/account/deletion");
  if (loading) return <ParentLoading label="Checking deletion access" />;
  if (error instanceof ParentApiError && error.status === 401)
    return <section className={styles.surface}>
      <h2>Sign in to manage deletion</h2>
      <p>Use your existing CaseLink account to request deletion of your parent-support data. This does not reopen support work or create an account.</p>
      <Link className={`${styles.button} ${styles.space}`} href="/sign-in?purpose=delete-parent-data">Sign in for deletion</Link>
      <p className={styles.space}>For account recovery or a privacy request you cannot complete here, <Link className={styles.textLink} href="/support/privacy">contact the privacy operator</Link>.</p>
    </section>;
  if (error || !data || !z.uuid().safeParse(data.ownerId).success || !["active", "deletion_requested"].includes(data.status))
    return <ServiceError error={error ?? new Error("Deletion access could not be confirmed. Please try again.")} retry={reload} returnTo="/account" />;
  return <AccountDeletion key={`${data.ownerId}:${data.status}`} ownerId={data.ownerId} initiallyRecorded={data.status === "deletion_requested"} />;
}
