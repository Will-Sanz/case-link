"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Lock, Mail } from "iconoir-react";
import { AUTH_LINK_ERROR_MESSAGE } from "@/lib/auth/safe-client-auth-message";
import { parentApi, safeReturnPath } from "./api";
import styles from "./parent.module.css";

const subscribeReady = () => () => {};

export function ParentSignIn({
  returnTo,
  deletionOnly = false,
  existingAccountRecovery = false,
  recoveryHref = "/forgot-password",
  emailCodeAvailable = true,
  authNotice,
}: {
  returnTo?: string;
  deletionOnly?: boolean;
  existingAccountRecovery?: boolean;
  recoveryHref?: string;
  emailCodeAvailable?: boolean;
  authNotice?: "password-reset-success" | "auth-link-error";
}) {
  const router = useRouter();
  const allowEmailCode = emailCodeAvailable && !deletionOnly;
  const ready = useSyncExternalStore(subscribeReady, () => true, () => false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"password" | "code">("password");
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(
    authNotice === "auth-link-error" ? AUTH_LINK_ERROR_MESSAGE : "",
  );
  const [resent, setResent] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const effectiveMethod = deletionOnly ? "password" : method;
  const codeSent = !deletionOnly && sent;
  useEffect(() => {
    if (codeSent) codeInput.current?.focus();
  }, [codeSent]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending) return;
    setPending(true);
    setError("");
    try {
      await parentApi("/auth", {
        method: "POST",
        body: JSON.stringify(
          effectiveMethod === "password"
            ? { action: deletionOnly ? "sign_in_for_deletion" : "sign_in", email, password }
            : codeSent
              ? { action: "verify_code", email, token }
              : { action: "send_code", email },
        ),
      });
      if (effectiveMethod === "password" || codeSent) {
        setPassword("");
        router.replace(deletionOnly ? "/account?delete=1" : safeReturnPath(returnTo));
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
    if (!ready || pending || deletionOnly) return;
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
          Your CaseLink account brings your support together. Sign in with the
          email and password you already use
          {allowEmailCode ? ", or get a secure email code." : "."}
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
            {codeSent ? "Check your email" : deletionOnly ? "Sign in to manage deletion" : "Welcome to CaseLink"}
          </h2>
          <p>
            {codeSent ? (
              <>
                Enter the code sent to <strong>{email}</strong>. It may take a
                moment to arrive.
              </>
            ) : effectiveMethod === "password" ? (
              "Use your existing CaseLink email and password."
            ) : (
              "New here or need a code? We’ll email you a secure sign-in code."
            )}
          </p>
        </div>
        {deletionOnly && <p className={styles.hint}>This sign-in checks access to your existing parent-support data for deletion. It does not create an account, reopen support work or authorize new collection.</p>}
        <form className={styles.form} onSubmit={submit}>
          {!codeSent ? (
            <div className={styles.field}>
              <label htmlFor="parent-email">Your email address</label>
              <input
                id="parent-email"
                className={styles.input}
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                disabled={!ready || pending}
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
                disabled={!ready || pending}
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
          {effectiveMethod === "password" && (
            <div className={styles.field}>
              <label htmlFor="parent-password">Password</label>
              <input
                id="parent-password"
                className={styles.input}
                type="password"
                autoComplete="current-password"
                required
                disabled={!ready || pending}
                maxLength={1024}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {existingAccountRecovery && (
                <p className={styles.hint}>
                  <Link className={styles.textLink} href={recoveryHref}>
                    Forgot your password?
                  </Link>{" "}
                  {recoveryHref === "/forgot-password"
                    ? "Reset your existing CaseLink password to sign in with it."
                    : "Reset on the existing CaseLink site, then return here to sign in."}
                </p>
              )}
            </div>
          )}
          {error && (
            <div className={styles.error} role="alert">
              {error}{" "}
              <Link className={styles.textLink} href="/support/help">
                See direct support options
              </Link>
            </div>
          )}
          {authNotice === "password-reset-success" && (
            <p className={styles.success} role="status">
              Your password is updated. Sign in with your new password.
            </p>
          )}
          {resent && allowEmailCode && (
            <p className={styles.success} role="status">
              A new code is on its way. Check your spam folder, too.
            </p>
          )}
          <button
            className={`${styles.button} ${styles.full}`}
            disabled={!ready || pending}
            type="submit"
          >
            {pending
              ? effectiveMethod === "password" || codeSent
                ? "Signing you in…"
                : "Sending your code…"
              : effectiveMethod === "password" || codeSent
                ? "Sign in"
                : "Email me a code"}{" "}
            {effectiveMethod === "password" || codeSent ? (
              <ArrowRight width={19} height={19} aria-hidden="true" />
            ) : (
              <Mail width={19} height={19} aria-hidden="true" />
            )}
          </button>
        </form>
        {allowEmailCode && (
          <button
            className={`${styles.quiet} ${styles.space}`}
            disabled={!ready || pending}
            onClick={() => {
              setMethod(effectiveMethod === "password" ? "code" : "password");
              setPassword("");
              setSent(false);
              setToken("");
              setError("");
              setResent(false);
            }}
          >
            {effectiveMethod === "password"
              ? "Use an email code instead"
              : "Use my CaseLink password"}
          </button>
        )}
        {codeSent && (
          <div className={`${styles.inline} ${styles.space}`}>
            <button
              className={styles.quiet}
              disabled={!ready || pending}
              onClick={resend}
            >
              Send a new code
            </button>
            <button
              className={styles.quiet}
              disabled={!ready || pending}
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
        {!deletionOnly && <p className={`${styles.hint} ${styles.space}`}>
          By continuing, you agree to our{" "}
          <Link className={styles.textLink} href="/support/terms">
            terms
          </Link>
          . Read how we handle your information in our{" "}
          <Link className={styles.textLink} href="/support/privacy">
            privacy notice
          </Link>
          . Signing in does not authorize sharing or applications.
        </p>}
      </section>
    </div>
  );
}
