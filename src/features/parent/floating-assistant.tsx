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
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";
import chatStyles from "./floating-assistant.module.css";

function requestLabel(request: SupportRequest, t: (text: string) => string) {
  return request.intake.needs.some((need) => need.startsWith("snap_"))
    ? t("Your SNAP request")
    : t("{needs} request").replace("{needs}", request.intake.needs.map((need) => t(NEED_LABELS[need])).join(" · "));
}

function SavedRequestAssistant({ id, onAction }: { id: string; onAction: () => void }) {
  const { t } = useParentLocale();
  const { data, loading, error, reload } = useParentResource<{ request: SupportRequest }>(`/requests/${id}`);
  return (
    <>
      {loading && <p role="status">{t("Loading this request…")}</p>}
      {error && <div className={chatStyles.recovery}><ServiceError error={error} retry={reload} returnTo={`/support/${id}`} /></div>}
      {data && !error && (
        <SupportAssistant key={id} request={data.request} onAction={onAction} onAnswer={reload} onRefresh={reload} />
      )}
    </>
  );
}

function SavedRequestPicker({ onAction, initialRequestId }: { onAction: () => void; initialRequestId?: string }) {
  const { t, locale } = useParentLocale();
  const { data, loading, error, reload } = useParentResource<{ requests: SupportRequest[] }>("/requests");
  const [selectedId, setSelectedId] = useState(initialRequestId ?? "");
  const selected = data?.requests.find((request) => request.id === selectedId)
    ?? (!selectedId && data?.requests.length === 1 ? data.requests[0] : undefined);
  return (
    <>
      {loading && <p role="status">{t("Loading your saved requests…")}</p>}
      {error && <div className={chatStyles.recovery}><ServiceError error={error} retry={reload} /></div>}
      {data && !error && (data.requests.length ? (
        <>
          <div className={styles.field}>
            <label htmlFor="chat-request">{t("Which request can we help with?")}</label>
            <select id="chat-request" className={styles.select} value={selected?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">{t("Choose a saved request")}</option>
              {data.requests.map((request) => (
                <option key={request.id} value={request.id}>
                  {requestLabel(request, t)} · {displayDate(request.created_at, true, locale)}
                </option>
              ))}
            </select>
            {selected && <p className={styles.hint}>{requestLabel(selected, t)} · {displayDate(selected.created_at, true, locale)}</p>}
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
  const { t } = useParentLocale();
  return (
    <div className={chatStyles.generalHelp}>
      <p className={chatStyles.context}>
        {t("CaseLink help · No saved request selected")}</p>
      <h2 className={chatStyles.helpTitle}>{t("A little help getting started")}</h2>
      <p>
        {t(intake
          ? "Your answers on this page have not been saved as a support request yet. Choose what you need, add what you know, then review your permission."
          : savedEmpty
            ? "You don’t have a saved support request yet. Start with what your household needs."
            : "Save a support request to ask the AI about your household’s progress. You can reach official help right away.")}
      </p>
      <p>
        {t("You can choose “Not sure” where offered. Optional details do not need to delay your application.")}</p>
      <nav aria-label={t("Ways to get assistance")} className={chatStyles.helpLinks}>
        {!intake && (
          <Link href="/get-support" onClick={onAction}>
            {t("Start a support request")}</Link>
        )}
        <a href={SNAP_NEW_APPLICATION_URL} onClick={onAction}>
          {t("Start SNAP on Pennsylvania’s official site")}</a>
        <Link href="/support/help#urgent" onClick={onAction}>
          {t("Food today or urgent utility help")}</Link>
        {!savedEmpty && (
          <Link href="/my-support" onClick={onAction}>
            {t("Ask about a saved request")}</Link>
        )}
      </nav>
      <p className={styles.hint}>
        {t("This is general app help. Opening a program’s website does not submit an application.")}</p>
    </div>
  );
}

export function FloatingAssistant({ signedIn }: { signedIn: boolean }) {
  const { t, locale } = useParentLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [launcherHidden, setLauncherHidden] = useState(false);
  const panel = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const requestId = /^\/support\/([a-f0-9-]{36})$/i.exec(pathname)?.[1];
  const close = () => {
    setOpen(false);
    (launcher.current ?? restoreButton.current)?.focus();
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
  useEffect(() => {
    if (launcherHidden && !open) document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [launcherHidden, open]);

  return (
    <>
      {launcherHidden ? <button ref={restoreButton} lang={locale} type="button" className={`${styles.secondary} ${chatStyles.restore}`} aria-label={t("Show CaseLink assistant")} onClick={() => { setLauncherHidden(false); setOpened(true); setOpen(true); }}>{t("Ask CaseLink")}</button> : <button
        lang={locale}
        ref={launcher}
        type="button"
        className={chatStyles.launcher}
        aria-label={t("Ask CaseLink for assistance")}
        aria-expanded={open}
        aria-controls="caselink-assistant"
        aria-haspopup="dialog"
        onClick={() => {
          setOpened(true);
          setOpen((value) => !value);
        }}
      >
        <ChatBubble width={22} height={22} aria-hidden="true" />
        <span>{t("Ask CaseLink")}</span>
      </button>}
      <dialog
        lang={locale}
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
            <h2 id="caselink-chat-title">{t("Ask CaseLink")}</h2>
            <p>{t("Your family support assistant")}</p>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={close}
            className={chatStyles.close}
            aria-label={t("Minimize chat")}
          >
            <Xmark width={22} height={22} aria-hidden="true" />
          </button>
        </header>
        <div className={chatStyles.body} key={`${signedIn}:${pathname}`}>
          <button type="button" className={styles.quiet} onClick={() => { setOpen(false); setLauncherHidden(true); }}>{t("Hide assistant button")}</button>
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
