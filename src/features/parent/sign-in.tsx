"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Lock, Mail } from "iconoir-react";
import { AUTH_LINK_ERROR_MESSAGE } from "@/lib/auth/safe-client-auth-message";
import { parentApi, safeReturnPath } from "./api";
import styles from "./parent.module.css";

export function ParentSignIn({
  returnTo,
  existingAccountRecovery = false,
  recoveryHref = "/forgot-password",
  emailCodeAvailable = true,
  authNotice,
}: {
  returnTo?: string;
  existingAccountRecovery?: boolean;
  recoveryHref?: string;
  emailCodeAvailable?: boolean;
  authNotice?: "password-reset-success" | "auth-link-error";
}) {
  const router = useRouter();
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
          method === "password"
            ? { action: "sign_in", email, password }
            : sent
              ? { action: "verify_code", email, token }
              : { action: "send_code", email },
        ),
      });
      if (method === "password" || sent) {
        setPassword("");
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
          Your CaseLink account brings your support together. Sign in with the
          email and password you already use
          {emailCodeAvailable ? ", or get a secure email code." : "."}
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
            ) : method === "password" ? (
              "Use your existing CaseLink email and password."
            ) : (
              "New here or need a code? We’ll email you a secure sign-in code."
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
                autoComplete="username"
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
          {method === "password" && (
            <div className={styles.field}>
              <label htmlFor="parent-password">Password</label>
              <input
                id="parent-password"
                className={styles.input}
                type="password"
                autoComplete="current-password"
                required
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
              ? method === "password" || sent
                ? "Signing you in…"
                : "Sending your code…"
              : method === "password" || sent
                ? "Sign in"
                : "Email me a code"}{" "}
            {method === "password" || sent ? (
              <ArrowRight width={19} height={19} aria-hidden="true" />
            ) : (
              <Mail width={19} height={19} aria-hidden="true" />
            )}
          </button>
        </form>
        {emailCodeAvailable && (
          <button
            className={`${styles.quiet} ${styles.space}`}
            disabled={pending}
            onClick={() => {
              setMethod(method === "password" ? "code" : "password");
              setPassword("");
              setSent(false);
              setToken("");
              setError("");
              setResent(false);
            }}
          >
            {method === "password"
              ? "Use an email code instead"
              : "Use my CaseLink password"}
          </button>
        )}
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
