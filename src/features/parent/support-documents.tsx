"use client";
import Link from "next/link";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Camera, Lock, Page, Trash, Upload } from "iconoir-react";
import type { ParentDocument } from "@/lib/parent/domain";
import { parentApi, displayDate } from "./api";
import styles from "./parent.module.css";

export function SupportDocuments({
  requestId,
  documents,
  inactive,
  onChange,
}: {
  requestId: string;
  documents: ParentDocument[];
  inactive: boolean;
  onChange: () => void;
}) {
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const uploadId = useId();
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setMessage("");
    if (!consent || !file) {
      setError("Choose a document and agree to its processing first.");
      return;
    }
    if (
      !["image/jpeg", "image/png", "application/pdf"].includes(file.type) ||
      file.size > 10 * 1024 * 1024 ||
      file.size === 0
    ) {
      setError(
        "Choose a JPEG, PNG or readable PDF up to 10 MB. PDFs can have up to five pages.",
      );
      return;
    }
    const body = new FormData();
    body.set("file", file);
    body.set("consent", "1");
    setPending(true);
    try {
      await parentApi(`/requests/${requestId}/documents`, {
        method: "POST",
        body,
      });
      setFile(null);
      setConsent(false);
      form.reset();
      setMessage(
        "Document saved privately. Its processing status will appear here.",
      );
      onChange();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t upload your document. Keep the original and try again.",
      );
    } finally {
      setPending(false);
    }
  }
  async function remove(document: ParentDocument) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      await parentApi(`/requests/${requestId}/documents/${document.id}`, {
        method: "DELETE",
      });
      setMessage(
        "Document deletion recorded. Information already delivered to a program may not be recallable.",
      );
      onChange();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t remove that document. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className={styles.surface} aria-labelledby={`${uploadId}-title`}>
      <h2 id={`${uploadId}-title`}>Bills & documents</h2>
      <p className={`${styles.subtle} ${styles.small}`}>
        Optional unless a selected program needs one. You can enter information
        yourself instead.
      </p>
      {documents.length > 0 ? (
        <ul className={styles.documentList}>
          {documents.map((document) => (
            <li className={styles.document} key={document.id}>
              <div className={styles.inline}>
                <Page width={22} height={22} aria-hidden="true" />
                <div>
                  <strong>{document.filename}</strong>
                  <span>
                    {document.status === "raw_deleted"
                      ? "Original file removed; validated facts remain"
                      : `${document.status.replaceAll("_", " ")} · Raw file expires ${displayDate(document.expires_at)}`}
                  </span>
                </div>
              </div>
              <button
                className={styles.quiet}
                disabled={pending}
                onClick={() => remove(document)}
                aria-label={`Delete ${document.filename}`}
              >
                <Trash width={18} height={18} aria-hidden="true" />
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`${styles.hint} ${styles.space}`}>
          No documents added. Optional uploads do not hold up your request.
        </p>
      )}
      {!inactive && (
        <details className={styles.disclosure}>
          <summary>Add a document or take a photo</summary>
          <div>
            <div className={styles.notice}>
              <Lock width={20} height={20} aria-hidden="true" />
              <p>
                Share only a bill, benefit notice or requested supporting
                document. Do not upload passwords, EBT PINs or identity
                documents. Your document may be read by AI to extract relevant
                facts for this request. It stays private. Its initial expiry is
                seven days after upload; you can request earlier deletion here.
              </p>
            </div>
            <form
              className={`${styles.form} ${styles.space}`}
              onSubmit={upload}
            >
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => {
                    setConsent(event.target.checked);
                    if (!event.target.checked) setFile(null);
                  }}
                />
                <span>
                  I agree to private storage and AI processing of this document
                  for this support request.{" "}
                  <Link
                    className={styles.textLink}
                    href="/support/privacy#documents"
                  >
                    Read document privacy details.
                  </Link>
                </span>
              </label>
              {consent && (
                <div className={styles.stack}>
                  <div className={styles.upload}>
                    <Upload width={28} height={28} aria-hidden="true" />
                    <label htmlFor={`${uploadId}-file`}>
                      Choose a bill or notice
                    </label>
                    <input
                      id={`${uploadId}-file`}
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null);
                        setError("");
                      }}
                    />
                    <p className={styles.hint}>
                      JPEG, PNG or readable PDF · Up to 10 MB and five pages
                    </p>
                  </div>
                  <div className={styles.field}>
                    <label
                      className={`${styles.secondary} ${styles.inline}`}
                      htmlFor={`${uploadId}-camera`}
                    >
                      <Camera width={19} height={19} aria-hidden="true" />
                      Take a photo
                    </label>
                    <input
                      id={`${uploadId}-camera`}
                      className={styles.input}
                      type="file"
                      accept="image/jpeg,image/png"
                      capture="environment"
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null);
                        setError("");
                      }}
                    />
                    <p className={styles.hint}>
                      Include the full page. Use good light, keep it flat, and
                      make sure dates and amounts are readable. You can retake a
                      photo before uploading.
                    </p>
                  </div>
                  {file && (
                    <p className={styles.hint}>
                      Ready to upload: <strong>{file.name}</strong> (
                      {(file.size / 1024 / 1024).toFixed(1)} MB)
                    </p>
                  )}
                  <button
                    className={styles.button}
                    type="submit"
                    disabled={pending || !file}
                  >
                    {pending ? "Uploading securely…" : "Upload privately"}
                  </button>
                </div>
              )}
            </form>
          </div>
        </details>
      )}
      {message && (
        <p className={`${styles.success} ${styles.space}`} role="status">
          {message}
        </p>
      )}
      {error && (
        <p className={`${styles.error} ${styles.space}`} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
