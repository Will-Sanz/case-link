"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ChatBubble, Refresh } from "iconoir-react";
import {
  assistantQuestionSchema,
  type ParentAssistantConversation,
} from "@/lib/parent/assistant-contract";
import type { SupportRequest } from "@/lib/parent/domain";
import { PROGRAMS } from "@/lib/parent/programs";
import { displayDate, parentApi } from "./api";
import { ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
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
  const path = `/requests/${request.id}/assistant`;
  const { data, error, loading, reload, reloadIfIdle } =
    useParentResource<ParentAssistantConversation>(path);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState("");
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
        parsed.error.issues[0]?.message ?? "Check your question.",
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
      className={chatStyles.assistant}
      aria-label="Ask about your saved request"
    >
      <div className={styles.between}>
        <h2 className={chatStyles.sectionTitle}>
          <ChatBubble width={22} height={22} aria-hidden="true" />
          Your conversation
        </h2>
        <button
          className={styles.quiet}
          onClick={() => {
            reload();
            onRefresh?.();
          }}
          aria-label="Refresh assistant conversation"
        >
          <Refresh width={16} height={16} aria-hidden="true" />
          Refresh
        </button>
      </div>
      {loading && (
        <p role="status" className={styles.hint}>
          Loading your conversation…
        </p>
      )}
      {error && (
        <ServiceError
          error={error}
          retry={reload}
          returnTo={`/support/${request.id}`}
        />
      )}
      {data && !data.available && (
        <p className={styles.notice} role="status">
          {data.unavailableReason ??
            "The assistant is unavailable. Your recorded progress and direct program options remain below."}
        </p>
      )}
      {cancelError && (
        <p className={styles.error} role="alert">
          {cancelError}
        </p>
      )}
      {!!data?.messages?.length && (
        <ol
          ref={conversation}
          className={`${styles.conversation} ${chatStyles.conversation}`}
          aria-label="Conversation about this request"
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
                <strong>You</strong>
                <p>{message.question}</p>
                <time dateTime={message.created_at}>
                  {displayDate(message.created_at, true)}
                </time>
              </div>
              <div className={styles.answerBubble}>
                <strong>CaseLink AI</strong>
                {message.status === "answered" && message.answer ? (
                  <>
                    <p>{message.answer.intro}</p>
                    {message.answer.paragraphs.map((paragraph, index) => (
                      <div key={index} className={styles.answerParagraph}>
                        <p>{paragraph.text}</p>
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
                              {paragraph.sourceLabel}
                            </a>
                          ) : (
                            paragraph.sourceLabel
                          )}
                          {paragraph.recordedAt && (
                            <> · {displayDate(paragraph.recordedAt, true)}</>
                          )}
                        </p>
                      </div>
                    ))}
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
                          Go to your step: {action.title}
                        </a>
                      ) : null;
                    })}
                    <time dateTime={message.updated_at}>
                      Answer recorded {displayDate(message.updated_at, true)}
                    </time>
                  </>
                ) : message.status === "failed" ? (
                  <p className={styles.error}>
                    {message.error ??
                      "This question could not be answered. Check the recorded progress or try asking again."}
                  </p>
                ) : (
                  <>
                    <p className={styles.hint} role="status">
                      {message.status === "running"
                        ? "Reading the saved information for your answer…"
                        : data.available
                          ? "Question saved. Waiting for the assistant to begin."
                          : "Question saved; an active assistant connection cannot be confirmed."}
                    </p>
                    <button
                      type="button"
                      className={styles.quiet}
                      disabled={cancelling !== null}
                      onClick={() => cancelQuestion(message.id)}
                    >
                      {cancelling === message.id
                        ? "Stopping answer…"
                        : "Cancel question"}
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
          Showing your latest 40 questions. Your{" "}
          <a className={styles.textLink} href="/api/parent/account/export">
            information download
          </a>{" "}
          includes retained earlier messages.
        </p>
      )}
      <form className={chatStyles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label htmlFor="assistant-question">
            Your question about this request
          </label>
          <textarea
            id="assistant-question"
            className={`${styles.textarea} ${chatStyles.composer}`}
            rows={3}
            placeholder="Ask a question about this request…"
            required
            maxLength={2000}
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
              setSendError("");
            }}
            aria-describedby="assistant-privacy"
            disabled={pending}
          />
          <p id="assistant-privacy" className={styles.hint}>
            By sending, you agree to use your question, saved account preferences and relevant request details with OpenAI to answer.
            Keep identity numbers, passwords and PINs out of chat.
          </p>
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
            {pending ? "Sending…" : "Send"}
            <ArrowRight width={17} height={17} aria-hidden="true" />
          </button>
        </div>
        {notice && (
          <p className={styles.success} role="status">
            {notice}
          </p>
        )}
        {sendError && (
          <p className={styles.error} role="alert">
            {sendError}
          </p>
        )}
      </form>
    </section>
  );
}
