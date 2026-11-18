"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ChatBubble, Refresh } from "iconoir-react";
import {
  assistantQuestionSchema,
  type ParentAssistantConversation,
} from "@/lib/parent/assistant-contract";
import type { SupportRequest } from "@/lib/parent/domain";
import { PROGRAMS } from "@/lib/parent/programs";
import { assistantIntroDisplay, assistantParagraphDisplay, assistantSourceDisplay } from "@/lib/parent/assistant-display";
import { displayDate, parentApi } from "./api";
import { ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";
import chatStyles from "./floating-assistant.module.css";

export function SupportAssistant({
  request,
  onAction,
  onAnswer,
  onRefresh,
}: {
  request: SupportRequest;
  onAction?: () => void;
  onAnswer?: () => void;
  onRefresh?: () => void;
}) {
  const { t, locale } = useParentLocale();
  const path = `/requests/${request.id}/assistant`;
  const { data, error, loading, reload, reloadIfIdle } =
    useParentResource<ParentAssistantConversation>(path);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [retryQuestion, setRetryQuestion] = useState(false);
  const [notice, setNotice] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState("");
  const attempt = useRef<{ question: string; key: string } | null>(null);
  const conversation = useRef<HTMLOListElement>(null);
  const followLatest = useRef(true);
  const latestMessage = data?.messages?.at(-1);
  useEffect(() => {
    if (latestMessage?.status === "answered") onAnswer?.();
  }, [
    latestMessage?.id,
    latestMessage?.status,
    latestMessage?.updated_at,
    onAnswer,
  ]);
  useEffect(() => {
    const list = conversation.current;
    if (list && followLatest.current)
      list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
  }, [latestMessage?.id, latestMessage?.status, latestMessage?.updated_at]);
  const waiting = data?.messages?.some((message) =>
    ["queued", "running"].includes(message.status),
  );
  useEffect(() => {
    if (!waiting) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") reloadIfIdle();
    }, 5000);
    return () => clearInterval(interval);
  }, [waiting, reloadIfIdle]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setSendError("");
    setRetryQuestion(false);
    if (!data?.available || error || pending) return;
    const text = question.trim();
    const idempotencyKey =
      attempt.current?.question === text
        ? attempt.current.key
        : crypto.randomUUID();
    const parsed = assistantQuestionSchema.safeParse({
      question: text,
      idempotencyKey,
      consented: true,
    });
    if (!parsed.success) {
      setSendError(
        parsed.error.issues.find(issue => issue.code === "custom")?.message ?? "Enter a question using 1 to 2,000 characters.",
      );
      return;
    }
    attempt.current = { question: text, key: idempotencyKey };
    setPending(true);
    try {
      await parentApi(path, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      setQuestion("");
      attempt.current = null;
      followLatest.current = true;
      setNotice("Your question is saved. Its answer will appear here.");
      reload();
    } catch (err) {
      setRetryQuestion(true);
      setSendError(
        err instanceof Error
          ? err.message
          : "Your question could not be saved. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  async function cancelQuestion(messageId: string) {
    setCancelling(messageId);
    setCancelError("");
    try {
      await parentApi(path, {
        method: "DELETE",
        body: JSON.stringify({ messageId }),
      });
      reload();
    } catch (err) {
      setCancelError(
        err instanceof Error
          ? err.message
          : "We couldn’t stop this answer. Please try again.",
      );
    } finally {
      setCancelling(null);
    }
  }
  return (
    <section
      lang={locale}
      className={chatStyles.assistant}
      aria-label={t("Ask about your saved request")}
    >
      <div className={styles.between}>
        <h2 className={chatStyles.sectionTitle}>
          <ChatBubble width={22} height={22} aria-hidden="true" />
          {t("Your conversation")}</h2>
        <button
          className={styles.quiet}
          onClick={() => {
            reload();
            onRefresh?.();
          }}
          aria-label={t("Refresh assistant conversation")}
        >
          <Refresh width={16} height={16} aria-hidden="true" />
          {t("Refresh")}</button>
      </div>
      {loading && (
        <p role="status" className={styles.hint}>
          {t("Loading your conversation…")}</p>
      )}
      {error && (
        <div className={chatStyles.recovery}><ServiceError
          error={error}
          retry={reload}
          returnTo={`/support/${request.id}`}
        /></div>
      )}
      {data && !data.available && (
        <p className={`${styles.notice} ${chatStyles.message}`} role="status" lang={data.unavailableReason && t(data.unavailableReason) === data.unavailableReason ? "" : locale}>
          {t(data.unavailableReason ??
            "The assistant is unavailable. Your recorded progress and direct program options remain below.")}
        </p>
      )}
      {cancelError && (
        <p className={`${styles.error} ${chatStyles.message}`} role="alert" lang={t(cancelError) === cancelError ? "" : locale}>
          {t(cancelError)}
        </p>
      )}
      {!!data?.messages?.length && (
        <ol
          ref={conversation}
          className={`${styles.conversation} ${chatStyles.conversation}`}
          aria-label={t("Conversation about this request")}
          tabIndex={0}
          onScroll={(event) => {
            const list = event.currentTarget;
            followLatest.current =
              list.scrollHeight - list.scrollTop - list.clientHeight < 80;
          }}
        >
          {data.messages.map((message) => (
            <li key={message.id}>
              <div className={styles.questionBubble}>
                <strong>{t("You")}</strong>
                <p lang="">{message.question}</p>
                <time dateTime={message.created_at}>
                  {displayDate(message.created_at, true, locale)}
                </time>
              </div>
              <div className={styles.answerBubble}>
                <strong>{t("CaseLink AI")}</strong>
                {message.status === "answered" && message.answer ? (
                  <>
                    <p lang={assistantIntroDisplay(message.answer.intro, locale).language}>{assistantIntroDisplay(message.answer.intro, locale).text}</p>
                    {message.answer.paragraphs.map((paragraph, index) => {
                      const display = assistantParagraphDisplay(paragraph, locale);
                      const source = assistantSourceDisplay(paragraph.sourceLabel, locale);
                      return (
                      <div key={index} className={styles.answerParagraph}>
                        {display.original?.language === "en" && <p className={styles.hint}>{t("CaseLink explanation in Spanish")}</p>}
                        <p>{display.parts.map((part, partIndex) => <span key={partIndex} lang={part.language}>{part.text}</span>)}</p>
                        {locale === "es" && !display.translated && <p className={styles.hint}>{t("This saved text is shown in its original language.")}</p>}
                        {display.original && <details className={chatStyles.original}><summary>{t(display.original.language === "en" ? "Original English source text" : "Original saved text")}</summary><p lang={display.original.language}>{display.original.text}</p></details>}
                        <p className={styles.answerSource}>
                          {paragraph.sourceUrl &&
                          PROGRAMS.some(
                            (program) =>
                              program.officialUrl === paragraph.sourceUrl ||
                              program.sourceUrl === paragraph.sourceUrl,
                          ) ? (
                            <a
                              className={styles.textLink}
                              href={paragraph.sourceUrl}
                            >
                              <span lang={source.language}>{source.text}</span>
                            </a>
                          ) : (
                            <span lang={source.language}>{source.text}</span>
                          )}
                          {paragraph.recordedAt && (
                            <> · {displayDate(paragraph.recordedAt, true, locale)}</>
                          )}
                        </p>
                      </div>
                    ); })}
                    {message.answer.actionIds.map((id) => {
                      const action = request.required_actions.find(
                        (item) =>
                          request.status === "active" &&
                          item.id === id &&
                          !item.resolved &&
                          (!item.resolver || item.resolver === "parent"),
                      );
                      return action ? (
                        <a
                          key={id}
                          className={styles.textLink}
                          href={`/support/${request.id}#step-${encodeURIComponent(id)}`}
                          onClick={onAction}
                        >
                          {t("Go to your step:")}{" "}<span lang="">{action.title}</span>
                        </a>
                      ) : null;
                    })}
                    <time dateTime={message.updated_at}>
                      {t("Answer recorded")}{" "}{displayDate(message.updated_at, true, locale)}
                    </time>
                  </>
                ) : message.status === "failed" ? (
                  <p className={`${styles.error} ${chatStyles.message}`} lang={message.error && t(message.error) === message.error ? "" : locale}>
                    {t(message.error ??
                      "This question could not be answered. Check the recorded progress or try asking again.")}
                  </p>
                ) : (
                  <>
                    <p className={styles.hint} role="status">
                      {t(message.status === "running"
                        ? "Reading the saved information for your answer…"
                        : data.available
                          ? "Question saved. Waiting for the assistant to begin."
                          : "Question saved; an active assistant connection cannot be confirmed.")}
                    </p>
                    <button
                      type="button"
                      className={styles.quiet}
                      disabled={cancelling !== null}
                      onClick={() => cancelQuestion(message.id)}
                    >
                      {t(cancelling === message.id
                        ? "Stopping answer…"
                        : "Cancel question")}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {data?.historyLimited && (
        <p className={styles.hint}>
          {t("Showing your latest 40 questions. Your")}{" "}
          <a className={styles.textLink} href="/api/parent/account/export">
            {t("information download")}</a>{" "}
          {t("includes retained earlier messages.")}</p>
      )}
      <form className={chatStyles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label htmlFor="assistant-question">
            {t("Your question about this request")}</label>
          <textarea
            id="assistant-question"
            className={`${styles.textarea} ${chatStyles.composer}`}
            rows={3}
            placeholder={t("Ask a question about this request…")}
            required
            maxLength={2000}
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
              setSendError("");
              setRetryQuestion(false);
            }}
            aria-describedby="assistant-privacy"
            disabled={pending}
          />
          <p id="assistant-privacy" className={styles.hint}>
            {t("By sending, you agree to use your question, saved account preferences and relevant request details with OpenAI to answer. Keep identity numbers, passwords and PINs out of chat.")}</p>
          <p className={styles.hint}>{t("Changing the screen language does not change your saved service language. Program language services must be confirmed.")}</p>
        </div>
        <div className={styles.between}>
          <button
            className={styles.button}
            disabled={
              pending ||
              !data?.available ||
              !!error ||
              !question.trim()
            }
          >
            {t(pending ? "Sending…" : retryQuestion ? "Retry the same question" : "Send")}
            <ArrowRight width={17} height={17} aria-hidden="true" />
          </button>
        </div>
        {notice && (
          <p className={`${styles.success} ${chatStyles.message}`} role="status">
            {t(notice)}
          </p>
        )}
        {sendError && (
          <p className={`${styles.error} ${chatStyles.message}`} role="alert" lang={t(sendError) === sendError ? "" : locale}>
            {t(sendError)}
          </p>
        )}
        {sendError && retryQuestion && <p className={styles.hint}>{t("Your draft is kept here. If the connection is available, retry the same question.")}</p>}
      </form>
    </section>
  );
}
