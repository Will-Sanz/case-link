"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Lock, Mail } from "iconoir-react";
import { parentApi, safeReturnPath } from "./api";
import styles from "./parent.module.css";

export function ParentSignIn({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (sent) codeInput.current?.focus();
  }, [sent]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await parentApi("/auth", {
        method: "POST",
        body: JSON.stringify(
          sent
            ? { action: "verify_code", email, token }
            : { action: "send_code", email },
        ),
      });
      if (sent) {
        router.replace(safeReturnPath(returnTo));
        router.refresh();
      } else {
        setSent(true);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t sign you in. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  async function resend() {
    setPending(true);
    setError("");
    setResent(false);
    try {
      await parentApi("/auth", {
        method: "POST",
        body: JSON.stringify({ action: "send_code", email }),
      });
      setResent(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t send a new code. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={`${styles.container} ${styles.authGrid}`}>
      <div className={styles.authAside}>
        <h1>
          A simpler way
          <br />
          to find support.
        </h1>
        <p>
          Use one email address to start, come back, and see what happens next.
          No password to remember.
        </p>
        <div className={styles.trustLine}>
          <Lock width={22} height={22} aria-hidden="true" />
          <div>
            <strong>A private place for your household</strong>Use an email only
            you can access. On a shared device, sign out when you’re finished.
          </div>
        </div>
      </div>
      <section className={styles.surface} aria-labelledby="signin-title">
        <div className={styles.formHeader}>
          <h2 id="signin-title">
            {sent ? "Check your email" : "Welcome to CaseLink"}
          </h2>
          <p>
            {sent ? (
              <>
                Enter the code sent to <strong>{email}</strong>. It may take a
                moment to arrive.
              </>
            ) : (
              "New here or coming back? We’ll email you a secure sign-in code."
            )}
          </p>
        </div>
        <form className={styles.form} onSubmit={submit}>
          {!sent ? (
            <div className={styles.field}>
              <label htmlFor="parent-email">Your email address</label>
              <input
                id="parent-email"
                className={styles.input}
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                aria-describedby="email-help"
              />
              <p id="email-help" className={styles.hint}>
                We use this to verify your account. Support updates follow your
                notification choices.
              </p>
            </div>
          ) : (
            <div className={styles.field}>
              <label htmlFor="parent-token">Email code</label>
              <input
                ref={codeInput}
                id="parent-token"
                className={styles.input}
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6,10}"
                autoComplete="one-time-code"
                required
                maxLength={10}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                aria-describedby="code-help"
              />
              <p id="code-help" className={styles.hint}>
                Use the newest code. Never share it with anyone.
              </p>
            </div>
          )}
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          {resent && (
            <p className={styles.success} role="status">
              A new code is on its way. Check your spam folder, too.
            </p>
          )}
          <button
            className={`${styles.button} ${styles.full}`}
            disabled={pending}
            type="submit"
          >
            {pending
              ? sent
                ? "Signing you in…"
                : "Sending your code…"
              : sent
                ? "Sign in"
                : "Email me a code"}{" "}
            {sent ? (
              <ArrowRight width={19} height={19} aria-hidden="true" />
            ) : (
              <Mail width={19} height={19} aria-hidden="true" />
            )}
          </button>
        </form>
        {sent && (
          <div className={`${styles.inline} ${styles.space}`}>
            <button
              className={styles.quiet}
              disabled={pending}
              onClick={resend}
            >
              Send a new code
            </button>
            <button
              className={styles.quiet}
              disabled={pending}
              onClick={() => {
                setSent(false);
                setToken("");
                setError("");
                setResent(false);
              }}
            >
              Use a different email
            </button>
          </div>
        )}
        <p className={`${styles.hint} ${styles.space}`}>
          By continuing, you agree to our{" "}
          <Link className={styles.textLink} href="/support/terms">
            terms
          </Link>
          . Read how we handle your information in our{" "}
          <Link className={styles.textLink} href="/support/privacy">
            privacy notice
          </Link>
          . Signing in does not authorize sharing or applications.
        </p>
      </section>
    </div>
  );
}
