"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChatBubble, Xmark } from "iconoir-react";
import { CaseLinkMark } from "@/components/brand/caselink-mark";
import { NEED_LABELS, type SupportRequest } from "@/lib/parent/domain";
import { SNAP_NEW_APPLICATION_URL } from "@/lib/parent/programs";
import { displayDate } from "./api";
import { ServiceError } from "./feedback";
import { SupportAssistant } from "./support-assistant";
import { useParentResource } from "./use-parent-resource";
import styles from "./parent.module.css";
import chatStyles from "./floating-assistant.module.css";

function requestLabel(request: SupportRequest) {
  return request.intake.needs.some((need) => need.startsWith("snap_"))
    ? "Your SNAP request"
    : `${request.intake.needs.map((need) => NEED_LABELS[need]).join(" · ")} request`;
}

function SavedRequestAssistant({ id, onAction }: { id: string; onAction: () => void }) {
  const { data, loading, error, reload } = useParentResource<{ request: SupportRequest }>(`/requests/${id}`);
  return (
    <>
      {loading && <p role="status">Loading this request…</p>}
      {error && <ServiceError error={error} retry={reload} returnTo={`/support/${id}`} />}
      {data && !error && (
        <SupportAssistant key={id} request={data.request} onAction={onAction} onAnswer={reload} onRefresh={reload} />
      )}
    </>
  );
}

function SavedRequestPicker({ onAction, initialRequestId }: { onAction: () => void; initialRequestId?: string }) {
  const { data, loading, error, reload } = useParentResource<{ requests: SupportRequest[] }>("/requests");
  const [selectedId, setSelectedId] = useState(initialRequestId ?? "");
  const selected = data?.requests.find((request) => request.id === selectedId)
    ?? (!selectedId && data?.requests.length === 1 ? data.requests[0] : undefined);
  return (
    <>
      {loading && <p role="status">Loading your saved requests…</p>}
      {error && <ServiceError error={error} retry={reload} />}
      {data && !error && (data.requests.length ? (
        <>
          <div className={styles.field}>
            <label htmlFor="chat-request">Which request can we help with?</label>
            <select id="chat-request" className={styles.select} value={selected?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">Choose a saved request</option>
              {data.requests.map((request) => (
                <option key={request.id} value={request.id}>
                  {requestLabel(request)} · {displayDate(request.created_at, true)}
                </option>
              ))}
            </select>
          </div>
          {selected && <SavedRequestAssistant key={selected.id} id={selected.id} onAction={onAction} />}
        </>
      ) : <GeneralHelp savedEmpty onAction={onAction} />)}
    </>
  );
}

function GeneralHelp({
  savedEmpty = false,
  intake = false,
  onAction,
}: {
  savedEmpty?: boolean;
  intake?: boolean;
  onAction: () => void;
}) {
  return (
    <div className={chatStyles.generalHelp}>
      <p className={chatStyles.context}>
        CaseLink help · No saved request selected
      </p>
      <h2 className={chatStyles.helpTitle}>A little help getting started</h2>
      <p>
        {intake
          ? "Your answers on this page have not been saved as a support request yet. Choose what you need, add what you know, then review your permission."
          : savedEmpty
            ? "You don’t have a saved support request yet. Start with what your household needs."
            : "Save a support request to ask the AI about your household’s progress. You can reach official help right away."}
      </p>
      <p>
        You can choose “Not sure” where offered. Optional details do not need to
        delay your application.
      </p>
      <nav aria-label="Ways to get assistance" className={chatStyles.helpLinks}>
        {!intake && (
          <Link href="/get-support" onClick={onAction}>
            Start a support request
          </Link>
        )}
        <a href={SNAP_NEW_APPLICATION_URL} onClick={onAction}>
          Start SNAP on Pennsylvania’s official site
        </a>
        <Link href="/support/help#urgent" onClick={onAction}>
          Food today or urgent utility help
        </Link>
        {!savedEmpty && (
          <Link href="/my-support" onClick={onAction}>
            Ask about a saved request
          </Link>
        )}
      </nav>
      <p className={styles.hint}>
        This is general app help. Opening a program’s website does not submit an
        application.
      </p>
    </div>
  );
}

export function FloatingAssistant({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const panel = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const requestId = /^\/support\/([a-f0-9-]{36})$/i.exec(pathname)?.[1];
  const close = () => {
    setOpen(false);
    launcher.current?.focus();
  };

  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    const mobile = window.matchMedia("(max-width: 600px)");
    function show() {
      if (!dialog) return;
      if (dialog.open) dialog.close();
      if (mobile.matches) dialog.showModal();
      else dialog.show();
      closeButton.current?.focus();
    }
    const viewport = window.visualViewport;
    function resizeViewport() {
      dialog?.style.setProperty(
        "--chat-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      dialog?.style.setProperty(
        "--chat-viewport-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    }
    resizeViewport();
    show();
    mobile.addEventListener("change", show);
    viewport?.addEventListener("resize", resizeViewport);
    viewport?.addEventListener("scroll", resizeViewport);
    return () => {
      mobile.removeEventListener("change", show);
      viewport?.removeEventListener("resize", resizeViewport);
      viewport?.removeEventListener("scroll", resizeViewport);
      if (dialog.open) dialog.close();
    };
  }, [open, pathname]);

  return (
    <>
      <button
        ref={launcher}
        type="button"
        className={chatStyles.launcher}
        aria-label="Ask CaseLink for assistance"
        aria-expanded={open}
        aria-controls="caselink-assistant"
        aria-haspopup="dialog"
        onClick={() => {
          setOpened(true);
          setOpen((value) => !value);
        }}
      >
        <ChatBubble width={22} height={22} aria-hidden="true" />
        <span>Ask CaseLink</span>
      </button>
      <dialog
        ref={panel}
        id="caselink-assistant"
        aria-labelledby="caselink-chat-title"
        className={chatStyles.window}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Tab" &&
            window.matchMedia("(max-width: 600px)").matches
          ) {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                "button, a[href], input, select, textarea, summary, [tabindex]",
              ),
            ).filter(
              (element) =>
                element.tabIndex >= 0 &&
                !element.matches(":disabled") &&
                element.getClientRects().length > 0,
            );
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        <header className={chatStyles.header}>
          <CaseLinkMark />
          <div>
            <h2 id="caselink-chat-title">Ask CaseLink</h2>
            <p>Your family support assistant</p>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={close}
            className={chatStyles.close}
            aria-label="Minimize chat"
          >
            <Xmark width={22} height={22} aria-hidden="true" />
          </button>
        </header>
        <div className={chatStyles.body} key={`${signedIn}:${pathname}`}>
          {opened &&
            (signedIn || requestId ? (
              <SavedRequestPicker onAction={close} initialRequestId={requestId} />
            ) : (
              <GeneralHelp
                intake={pathname === "/get-support"}
                onAction={close}
              />
            ))}
        </div>
      </dialog>
    </>
  );
}
