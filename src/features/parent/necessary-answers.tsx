"use client";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ANSWER_FIELDS, factAnswerBundleSchema } from "@/lib/parent/answers";
import { NEED_LABELS, type NecessaryAction, type SupportRequest } from "@/lib/parent/domain";
import { parentApi, ParentApiError } from "./api";
import {
  canonicalFactField, currentAnswer, factualAnswer, NecessaryAnswerFields, type AnswerDraft,
} from "./necessary-answer";
import styles from "./parent.module.css";

const accountFields = ["accountAuthority", "amountDue", "totalBalance", "dueDate", "shutoffDate"];
export function isFactualQuestion(action: NecessaryAction) {
  return !action.resolved && (!action.resolver || action.resolver === "parent") &&
    action.reason === "missing_fact" && ANSWER_FIELDS.includes(action.field as (typeof ANSWER_FIELDS)[number]);
}
type Question = { key: string; action: NecessaryAction; sources: NecessaryAction[]; draft: AnswerDraft };
function snapshot(request: SupportRequest) {
  const now = new Date(), questions = new Map<string, Question>();
  const providers: Record<string, string> = {};
  for (const action of request.required_actions.filter(isFactualQuestion)) {
    const field = canonicalFactField(action.field), key = `${action.need}:${field}`;
    const previous = questions.get(key);
    if (previous) { previous.sources.push(action); continue; }
    questions.set(key, { key, action: { ...action, field }, sources: [action], draft: currentAnswer(request, action, now) });
    const recorded = request.facts?.find((fact) => fact.need === action.need && fact.field === "utilityProvider")?.value;
    const expected = ({ electricity: "peco", gas: "pgw", water: "pwd" } as Record<string, "peco" | "pgw" | "pwd">)[action.need];
    // Match the recorder's account-reset baseline; this is not execution authority.
    providers[action.need] = recorded != null
      ? typeof recorded === "string" ? recorded : JSON.stringify(recorded)
      : expected && request.intake.utilityProviders.includes(expected) ? expected
        : request.intake.utilityProviders.includes("other") ? "other" : "unknown";
  }
  return { requestId: request.id, version: request.version, status: request.status, questions: [...questions.values()], providers };
}
function currentQuestions(request: SupportRequest, saved: ReturnType<typeof snapshot>) {
  if (saved.requestId !== request.id) return saved;
  if (!saved.questions.length && request.version >= saved.version) return snapshot(request);
  if (saved.version !== request.version) return saved;
  const latest = snapshot(request), drafts = new Map(saved.questions.map((question) => [question.key, question.draft]));
  return { ...latest, status: saved.status === "active" ? latest.status : saved.status,
    providers: { ...latest.providers, ...saved.providers }, questions: latest.questions.map((question) => {
    const old = drafts.get(question.key), need = question.action.need;
    const changedAccount = saved.providers[need] !== undefined && latest.providers[need] !== "unknown" && saved.providers[need] !== latest.providers[need];
    return { ...question, draft: old ?? (changedAccount && accountFields.includes(question.action.field ?? "")
      ? { value: "", frequency: "" } : question.draft) };
  }) };
}

export function NecessaryAnswers({ request, onChange }: { request: SupportRequest; onChange: () => void }) {
  const [savedBundle, setBundle] = useState(() => snapshot(request));
  const [pending, setPending] = useState(false);
  const bundle = pending ? savedBundle : currentQuestions(request, savedBundle);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const focusNext = useRef(false);
  useLayoutEffect(() => {
    if (!focusNext.current || pending) return;
    focusNext.current = false;
    const first = savedBundle.questions[0];
    document.getElementById(first ? `answer-${first.action.id}` : "your-next-steps")?.focus();
  }, [savedBundle, pending]);

  function change(question: Question, draft: AnswerDraft) {
    const need = question.action.need;
    const providerChanged = question.action.field === "utilityProvider" && draft.value &&
      bundle.providers[need] !== "unknown" && bundle.providers[need] !== draft.value;
    setBundle({ ...bundle,
      providers: question.action.field === "utilityProvider" && draft.value
        ? { ...bundle.providers, [need]: draft.value } : bundle.providers,
      questions: bundle.questions.map((item) => item.key === question.key ? { ...item, draft }
        : providerChanged && item.action.need === need && accountFields.includes(item.action.field ?? "")
          ? { ...item, draft: { value: "", frequency: "" } } : item),
    });
    setNotice(providerChanged
      ? `The provider changed for ${NEED_LABELS[need].toLowerCase()}. Enter this account’s current details below; other answers are kept.` : "");
    setError("");
    setMessage("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || conflict || request.status !== "active" || bundle.status !== "active" || bundle.requestId !== request.id) return;
    setError(""); setMessage("");
    const provided = bundle.questions.filter((question) => question.draft.value.trim() ||
      (question.action.field === "income" && question.draft.frequency));
    if (!provided.length) {
      setError("Enter at least one answer before saving. Questions you leave blank stay open.");
      return;
    }
    const empty = provided.find((question) => question.action.field === "income" &&
      (!question.draft.value.trim() || !question.draft.frequency));
    if (empty) {
      setError(`${NEED_LABELS[empty.action.need]}: ${empty.action.title}. Enter both the income amount and frequency, or clear both for now. Zero is a valid amount.`);
      document.getElementById(`${empty.draft.value.trim() ? "frequency" : "answer"}-${empty.action.id}`)?.focus();
      return;
    }
    const parsed = factAnswerBundleSchema.safeParse({
      answers: provided.map((question) => factualAnswer(question.action, question.draft)),
      version: bundle.version,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const question = typeof issue?.path[1] === "number" ? provided[issue.path[1]] : undefined;
      setError(`${question ? `${NEED_LABELS[question.action.need]}: ${question.action.title}. ` : ""}${issue?.message ?? "Check each answer before saving."}`);
      if (question) document.getElementById(
        `${question.action.field === "income" && !question.draft.frequency ? "frequency" : "answer"}-${question.action.id}`,
      )?.focus();
      return;
    }
    setBundle(bundle);
    setPending(true);
    try {
      const saved = await parentApi<{ request: SupportRequest }>(`/requests/${request.id}`, {
        method: "POST", body: JSON.stringify({ action: "answer_facts", ...parsed.data }),
      });
      if (!saved.request || saved.request.id !== bundle.requestId)
        throw new Error("We couldn’t confirm the saved answers. Load the latest questions before trying again.");
      const remaining = snapshot(saved.request);
      const omitted = new Map(bundle.questions.filter((question) => !provided.includes(question))
        .map((question) => [question.key, question.draft]));
      remaining.questions = remaining.questions.map((question) => ({ ...question,
        draft: omitted.get(question.key) ?? question.draft,
      }));
      setBundle(remaining);
      setConflict(false); setNotice("");
      setMessage(remaining.questions.length
        ? `Your provided answers are saved. Unanswered questions stay open; ${saved.request.status === "paused" ? "this request remains paused." : "other permitted work can continue."}`
        : saved.request.status === "paused"
        ? "All your answers are saved. This request remains paused."
        : "All your answers are saved. Permitted work can continue.");
      onChange();
    } catch (err) {
      setConflict(!(err instanceof ParentApiError) || err.status < 400 || err.status === 409 || err.status >= 500);
      setError(err instanceof Error ? err.message : "Your answers could not be saved. Try again.");
    } finally { setPending(false); }
  }
  async function reviewLatest() {
    setPending(true);
    try {
      const latest = await parentApi<{ request: SupportRequest }>(`/requests/${request.id}`);
      if (!latest.request || latest.request.id !== bundle.requestId)
        throw new Error("The latest questions are unavailable. Your draft is still here.");
      focusNext.current = true;
      setBundle(snapshot(latest.request));
      setError(""); setConflict(false); setNotice("");
      setMessage("The latest saved answers and questions are loaded. Check them before saving.");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn’t load the latest questions. Your draft is still here.");
    } finally { setPending(false); }
  }
  if (bundle.requestId !== request.id || (!bundle.questions.length && !message)) return null;
  const changed = conflict || request.version > bundle.version;
  return (
    <form className={styles.form} aria-label="Household questions" onSubmit={submit}>
      {bundle.questions.length > 0 && <p className={styles.hint}>
        Save the answers you know together. Leave a question blank if you’re not sure yet; that step stays open.
      </p>}
      {bundle.questions.map((question) => <section key={question.key} className={styles.actionBox}
        aria-labelledby={`context-${question.action.id} step-${question.action.id}`}>
        <p id={`context-${question.action.id}`}><strong>{NEED_LABELS[question.action.need]}</strong></p>
        <h3 id={`step-${question.action.id}`} tabIndex={-1}>{question.action.title}</h3>
        {question.sources.map((source, index) => <p key={source.id}
          id={index ? `step-${source.id}` : undefined} tabIndex={index ? -1 : undefined}>{source.explanation}</p>)}
        <NecessaryAnswerFields action={question.action} draft={question.draft}
          onChange={(draft) => change(question, draft)} required={false} disabled={pending || request.status !== "active" || bundle.status !== "active"} />
      </section>)}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {bundle.questions.length > 0 && <button className={styles.button} disabled={pending || conflict || request.status !== "active" || bundle.status !== "active"}>
        {pending ? "Saving answers…" : "Save all answers and continue"}
      </button>}
      {message && <p className={styles.success} role="status">{message}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {changed && <div>
        <p className={styles.hint}>Loading the latest questions replaces your unsaved answers with the current saved information.</p>
        <button className={styles.secondary} type="button" disabled={pending} onClick={reviewLatest}>
          {pending ? "Loading latest questions…" : "Review latest questions"}
        </button>
      </div>}
    </form>
  );
}
