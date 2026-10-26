"use client";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowRight, Lock, Refresh } from "iconoir-react";
import type { SupportRequest } from "@/lib/parent/domain";
import {
  browserSessionSchema,
  type ApplicationBrowserResponse,
  type BrowserControl,
} from "@/lib/parent/browser-policy";
import { getProgram, SNAP_NEW_APPLICATION_URL } from "@/lib/parent/programs";
import { displayDate, parentApi, ParentApiError } from "./api";
import { useParentResource } from "./use-parent-resource";
import styles from "./parent.module.css";
import layout from "./application-workspace.module.css";

function safeFrameUrl(value: string | null, requestId: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin &&
      url.pathname.startsWith(`/api/parent/requests/${requestId}/browser/`) &&
      !url.username &&
      !url.password &&
      !url.hash
      ? `${url.pathname}${url.search}`
      : null;
  } catch {
    return null;
  }
}

export function ApplicationBrowser({
  request,
  canStart,
  hasAttempt,
  onNeedsVerification,
}: {
  request: SupportRequest;
  canStart: boolean;
  hasAttempt: boolean;
  onNeedsVerification?: (needed: boolean) => void;
}) {
  const { data, error, loading, reload } =
    useParentResource<ApplicationBrowserResponse>(
      `/requests/${request.id}/browser`,
    );
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState("");
  const [startError, setStartError] = useState("");
  const [frameRevision, setFrameRevision] = useState(0);
  const [frameFailed, setFrameFailed] = useState<string | null>(null);
  const [loadedFrame, setLoadedFrame] = useState<string | null>(null);
  const [controlling, setControlling] = useState(false);
  const [controlNotice, setControlNotice] = useState("");
  const [enlarged, setEnlarged] = useState(false);
  const [now, setNow] = useState(Date.now);
  const pendingControl = useRef<AbortController | null>(null);
  const session = error ? null : data?.session;
  const stoppableSession = data?.session;
  const validated = browserSessionSchema.safeParse(session);
  const handoff =
    request.status === "active" &&
    validated.success &&
    validated.data.canControl
      ? validated.data.handoff
      : null;
  const expired = Boolean(handoff && Date.parse(handoff.expiresAt) <= now);
  const expiresAt = handoff?.expiresAt;
  const active =
    stoppableSession &&
    ["starting", "running", "needs_parent"].includes(stoppableSession.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !pendingControl.current) {
        reload();
        setFrameRevision((value) => value + 1);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [active, reload]);
  useEffect(() => () => pendingControl.current?.abort(), []);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  const frameUrl = session?.frameUrl
    ? safeFrameUrl(session.frameUrl, request.id)
    : null;
  const shownFrame = frameUrl
    ? `${frameUrl}${frameUrl.includes("?") ? "&" : "?"}view=${frameRevision}`
    : null;
  const needsVerification = Boolean(
    handoff?.kind === "challenge" && !expired && shownFrame && frameFailed !== shownFrame,
  );
  useEffect(() => {
    onNeedsVerification?.(needsVerification);
    return () => onNeedsVerification?.(false);
  }, [needsVerification, onNeedsVerification]);
  const ready = Boolean(
    handoff &&
    !expired &&
    shownFrame &&
    loadedFrame === shownFrame &&
    frameFailed !== shownFrame &&
    !controlling &&
    !stopping,
  );
  async function control(action: BrowserControl["action"]) {
    if (!ready || !session || !handoff || pendingControl.current) return;
    const controller = new AbortController();
    pendingControl.current = controller;
    setControlling(true);
    setControlNotice("");
    setLoadedFrame(null);
    try {
      await parentApi(`/requests/${request.id}/browser/control`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          sessionId: session.id,
          frameId: handoff.frameId,
          action,
        }),
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        const status = error instanceof ParentApiError ? error.status : 0;
        setControlNotice(
          status === 409
            ? "The website view changed. We’re checking its current state before another action."
            : status === 429
              ? "Please wait a moment, then update the website view. Your saved support is unchanged."
              : status === 400
                ? "That action is not available in this verification area. Update the website view or use its keyboard controls."
                : "We couldn’t confirm that website action. Check the connection below before trying again.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        pendingControl.current = null;
        setControlling(false);
        setFrameRevision((value) => value + 1);
        reload();
      }
    }
  }
  function verificationClick(event: MouseEvent<HTMLButtonElement>) {
    if (!ready || handoff?.kind !== "challenge") return;
    if (event.detail === 0) {
      void control({ type: "key", key: "Tab" });
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width && box.height)
      void control({
        type: "click",
        x: (event.clientX - box.left) / box.width,
        y: (event.clientY - box.top) / box.height,
      });
  }
  function refresh() {
    if (ready) void control({ type: "refresh" });
    else {
      setFrameRevision((value) => value + 1);
      reload();
    }
  }
  let host = "Pennsylvania COMPASS";
  try {
    if (session?.currentUrl) host = new URL(session.currentUrl).hostname;
  } catch {
    /* The status still has a safe program label. */
  }
  async function start() {
    setStarting(true);
    setStartError("");
    setNotice("");
    try {
      await parentApi(`/requests/${request.id}/browser`, {
        method: "POST",
        body: JSON.stringify({ programId: "snap-pa" }),
      });
      reload();
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : "The application connection could not start. Try again.",
      );
    } finally {
      setStarting(false);
    }
  }
  async function stop() {
    pendingControl.current?.abort();
    pendingControl.current = null;
    setControlling(false);
    setLoadedFrame(null);
    setStopping(true);
    setStartError("");
    setNotice("");
    try {
      await parentApi(`/requests/${request.id}/browser`, { method: "DELETE" });
      setNotice(
        "Website viewer stopped. Your support request and its permission have not changed.",
      );
      reload();
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : "We couldn’t stop the website viewer. Try again.",
      );
    } finally {
      setStopping(false);
    }
  }
  return (
    <section
      className={layout.browser}
      id="application-browser"
      tabIndex={-1}
      aria-labelledby="application-browser-title"
    >
      <div className={layout.browserBar}>
        <span className={layout.browserAddress}>
          <Lock width={15} height={15} aria-hidden="true" />
          {host}
        </span>
        <span>
          {session
            ? "Recorded browser session"
            : "Official application connection"}
        </span>
      </div>
      <div className={layout.browserBody}>
        <h3 id="application-browser-title">
          {session?.status === "running" || controlling
            ? "CaseLink is checking the next screen"
            : session?.status === "needs_parent"
              ? handoff?.kind === "challenge"
                ? "Complete the COMPASS verification"
                : "Continue the website check"
              : session?.status === "completed"
                ? "Connection check complete"
                : session?.status === "starting"
                  ? "Opening the official application"
                  : "Your SNAP application connection"}
        </h3>
        <p aria-live="polite" aria-atomic="true">
          {controlling
            ? "CaseLink is confirming what COMPASS shows in this same session. No household information is being entered or submitted."
            : handoff?.kind === "continue"
              ? "This preview pauses at COMPASS so you can test continuing in the same secure window. This is a connection test, not a submitted SNAP application."
              : handoff?.kind === "challenge"
                ? "You control the verification area below. CaseLink is paused and will continue automatically once COMPASS confirms the next screen."
                : (session?.summary ??
                  (loading
                    ? "Checking the application connection…"
                    : error
                      ? "We couldn’t confirm the application connection. Refresh to check before starting another attempt."
                      : (data?.reason ??
                        "An automatic application connection is not available for this request. No application is being filled or submitted here.")))}
        </p>
      </div>
      {shownFrame && frameFailed !== shownFrame && (
        <div className={layout.frameViewport}>
          {handoff?.kind === "challenge" ? (
            <button
              type="button"
              className={`${layout.frameButton} ${enlarged ? layout.frameEnlarged : ""}`}
              disabled={!ready}
              onClick={verificationClick}
              aria-label="Interact with COMPASS verification image"
            >
              {/* The owned JPEG exposes only the reviewed public verification area. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={layout.frame}
                src={shownFrame}
                width={handoff.width}
                height={handoff.height}
                alt="Current official application page in CaseLink’s secure browser"
                onLoad={() => setLoadedFrame(shownFrame)}
                onError={() => setFrameFailed(shownFrame)}
              />
            </button>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={`${layout.frame} ${enlarged ? layout.frameEnlarged : ""}`}
              src={shownFrame}
              width={handoff?.width}
              height={handoff?.height}
              alt="Current official application page in CaseLink’s secure browser"
              onLoad={() => setLoadedFrame(shownFrame)}
              onError={() => setFrameFailed(shownFrame)}
            />
          )}
        </div>
      )}
      {handoff && shownFrame && (
        <div className={layout.verificationTools}>
          <button
            type="button"
            className={styles.quiet}
            aria-pressed={enlarged}
            onClick={() => setEnlarged((value) => !value)}
          >
            {enlarged ? "Fit website to window" : "Enlarge website view"}
          </button>
          {handoff.kind === "challenge" && (
            <details>
              <summary>Use keyboard controls</summary>
              <p>
                Choose Next control to enter the verification area, then
                Activate control to use the selected item. CaseLink will confirm
                the result automatically.
              </p>
              <div
                className={layout.browserActions}
                role="group"
                aria-label="Verification keyboard controls"
              >
                {(
                  [
                    ["Previous control", "Shift+Tab"],
                    ["Next control", "Tab"],
                    ["Activate control", "Enter"],
                    ["Select control", "Space"],
                    ["Up", "ArrowUp"],
                    ["Down", "ArrowDown"],
                    ["Left", "ArrowLeft"],
                    ["Right", "ArrowRight"],
                    ["Close verification prompt", "Escape"],
                  ] as const
                ).map(([label, key]) => (
                  <button
                    type="button"
                    key={key}
                    className={styles.secondary}
                    disabled={!ready}
                    onClick={() => void control({ type: "key", key })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p>
                Checks that require typing or audio are not supported in this
                preview. The official DHS site remains available in this section.
              </p>
            </details>
          )}
        </div>
      )}
      <div className={layout.browserBody}>
        {session && (
          <p className={styles.hint}>
            Last recorded browser update: {displayDate(session.updatedAt, true)}
            .
          </p>
        )}
        <p className={styles.hint}>
          Connection check only: no personal information is entered and no
          application is submitted.
        </p>
        <div className={layout.browserActions}>
          {handoff && handoff.kind === "continue" && (
            <button
              type="button"
              className={styles.button}
              disabled={!ready}
              onClick={() => void control({ type: "continue" })}
            >
              {controlling ? "Checking COMPASS…" : "Continue with COMPASS"}
              <ArrowRight width={17} height={17} aria-hidden="true" />
            </button>
          )}
          {data?.available &&
            !error &&
            request.status === "active" &&
            canStart &&
            (!session || session.status === "closed") && (
              <button
                type="button"
                className={styles.button}
                disabled={starting || stopping}
                onClick={start}
              >
                {starting
                  ? "Opening application view…"
                  : session?.status === "closed"
                    ? "Reopen application view"
                    : "Open application view"}
                <ArrowRight width={17} height={17} aria-hidden="true" />
              </button>
            )}
          {stoppableSession && stoppableSession.status !== "closed" && (
            <button
              type="button"
              className={styles.secondary}
              disabled={starting || stopping}
              onClick={stop}
            >
              {stopping ? "Stopping website view…" : "Stop website view"}
            </button>
          )}
          <button
            type="button"
            className={styles.quiet}
            disabled={controlling || stopping}
            onClick={refresh}
          >
            <Refresh width={16} height={16} aria-hidden="true" /> Refresh
            application connection
          </button>
          <a
            className={styles.textLink}
            href={
              hasAttempt
                ? getProgram("snap-pa")!.officialUrl
                : SNAP_NEW_APPLICATION_URL
            }
          >
            {hasAttempt
              ? "Open the official SNAP service"
              : "Start a new SNAP application with DHS"}
          </a>
        </div>
        {startError && (
          <p className={styles.error} role="alert">
            {startError}
          </p>
        )}
        {notice && (
          <p className={styles.success} role="status">
            {notice}
          </p>
        )}
        {controlNotice && (
          <p className={styles.hint} role="status">
            {controlNotice}
          </p>
        )}
        {handoff && (
          <p className={styles.hint} role={expired ? "status" : undefined}>
            {expired ? (
              "This website session expired. Refresh the connection to check its current state."
            ) : (
              <>
                This secure website session closes{" "}
                <time dateTime={handoff.expiresAt}>
                  {displayDate(handoff.expiresAt, true)}
                </time>
                .{" "}
                {loadedFrame !== shownFrame && !controlling
                  ? "Loading the current website view before controls are enabled."
                  : ""}
              </>
            )}
          </p>
        )}
        <p className={styles.hint}>
          No COMPASS account is needed to begin on the official site; opening it
          does not file an application. Required identifiers belong in protected
          program fields, never chat.
        </p>
      </div>
      {frameFailed === shownFrame && shownFrame && (
        <p className={layout.frameNotice} role="status">
          The browser image could not load. Refresh the application connection;
          the last recorded status above is still available.
        </p>
      )}
      {shownFrame && (
        <p className={layout.frameNotice}>
          Protected browser view. Household fields stay unavailable here; only
          supported public verification controls can receive your input. Use the
          checklist to review saved work and receipts.
        </p>
      )}
    </section>
  );
}
