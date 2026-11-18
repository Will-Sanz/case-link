"use client";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ANSWER_FIELDS, factAnswerBundleSchema } from "@/lib/parent/answers";
import { NEED_LABELS, type NecessaryAction, type SupportNeed, type SupportRequest } from "@/lib/parent/domain";
import { useSupportUpdate } from "./use-support-update";
import { SupportUpdateRecovery } from "./support-update-recovery";
import { useParentLocale } from "./parent-locale";
import {
  canonicalFactField, currentAnswer, factualAnswer, factualAnswerError, NecessaryAnswerFields, type AnswerDraft,
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

export function NecessaryAnswers(props: { request: SupportRequest; onChange: () => void }) {
  return <NecessaryAnswersContent key={props.request.id} {...props}/>;
}
function NecessaryAnswersContent({ request, onChange }: { request: SupportRequest; onChange: () => void }) {
  const { t, locale } = useParentLocale();
  const [savedBundle, setBundle] = useState(() => snapshot(request));

  const [error, setError] = useState<{ message: string; action?: NecessaryAction } | null>(null);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<SupportNeed | null>(null);
  const submitted = useRef<{ bundle: ReturnType<typeof snapshot>; provided: Question[] } | null>(null);
  const recovery = useSupportUpdate(request.id, (saved, superseded) => {
    const accepted = submitted.current;
    const remaining = snapshot(saved);
    const omitted = new Map(accepted?.bundle.questions.filter(question => !accepted.provided.includes(question)).map(question => [question.key, question.draft]));
    remaining.questions = remaining.questions.map(question => ({ ...question, draft: omitted.get(question.key) ?? question.draft }));
    setBundle(remaining); setNotice(null);
    setMessage(superseded ? "Your update was recorded. Newer changes are now in effect; check the current saved information."
      : remaining.questions.length ? saved.status === "paused"
        ? "Your provided answers are saved. Unanswered questions stay open; this request remains paused."
        : "Your provided answers are saved. Unanswered questions stay open; other permitted work can continue."
      : saved.status === "paused" ? "All your answers are saved. This request remains paused." : "All your answers are saved. Permitted work can continue.");
    onChange();
  }, onChange);
  const pending = recovery.pending, conflict = recovery.conflict;
  const bundle = recovery.locked ? savedBundle : currentQuestions(request, savedBundle);
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
    setNotice(providerChanged ? need : null);
    setError(null);
    setMessage("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recovery.locked || request.status !== "active" || bundle.status !== "active" || bundle.requestId !== request.id) return;
    setError(null); setMessage("");
    const provided = bundle.questions.filter((question) => question.draft.value.trim() ||
      (question.action.field === "income" && question.draft.frequency));
    if (!provided.length) {
      setError({ message: "Enter at least one answer before saving. Questions you leave blank stay open." });
      return;
    }
    const empty = provided.find((question) => question.action.field === "income" &&
      (!question.draft.value.trim() || !question.draft.frequency));
    if (empty) {
      setError({ action: empty.action, message: "Enter both the income amount and frequency, or clear both for now. Zero is a valid amount." });
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
      setError({ action: question?.action, message: question ? factualAnswerError(question.action.field) : "Check each answer before saving." });
      if (question) document.getElementById(
        `${question.action.field === "income" && !question.draft.frequency ? "frequency" : "answer"}-${question.action.id}`,
      )?.focus();
      return;
    }
    setBundle(bundle); submitted.current = { bundle, provided };
    await recovery.save(() => ({ action: "answer_facts", ...parsed.data }));
  }
  async function reviewLatest() {
    await recovery.review(latest => {
      focusNext.current = true; setBundle(snapshot(latest)); setError(null); setNotice(null);
      setMessage("The latest saved answers and questions are loaded. Check them before saving."); onChange();
    });
  }
  if (recovery.accessLost) return <div lang={locale} className={styles.supportControls}><SupportUpdateRecovery recovery={recovery} onReview={reviewLatest}/></div>;
  if (bundle.requestId !== request.id || (!bundle.questions.length && !message)) return null;
  const changed = conflict || request.version > bundle.version;
  return (
    <form lang={locale} className={`${styles.form} ${styles.supportControls}`} aria-label={t("Household questions")} onSubmit={submit}>
      {bundle.questions.length > 0 && <p className={styles.hint}>
        {t("Save the answers you know together. Leave a question blank if you’re not sure yet; that step stays open.")}</p>}
      {bundle.questions.map((question) => <section key={question.key} className={styles.actionBox}
        aria-labelledby={`context-${question.action.id} step-${question.action.id}`}>
        <p id={`context-${question.action.id}`}><strong>{t(NEED_LABELS[question.action.need])}</strong></p>
        <h3 lang={t(question.action.title) === question.action.title ? "" : locale} id={`step-${question.action.id}`} tabIndex={-1}>{t(question.action.title)}</h3>
        {question.sources.map((source, index) => <p key={source.id}
          lang={t(source.explanation) === source.explanation ? "" : locale} id={index ? `step-${source.id}` : undefined} tabIndex={index ? -1 : undefined}>{t(source.explanation)}</p>)}
        <NecessaryAnswerFields action={question.action} draft={question.draft}
          onChange={(draft) => change(question, draft)} required={false} disabled={recovery.locked || request.status !== "active" || bundle.status !== "active"} />
      </section>)}
      {notice && <p className={styles.notice} role="status">{t("The provider changed for {need}. Enter this account’s current details below; other answers are kept.").replace("{need}", t(NEED_LABELS[notice]).toLocaleLowerCase(locale))}</p>}
      {bundle.questions.length > 0 && <button className={styles.button} disabled={recovery.locked || request.status !== "active" || bundle.status !== "active"}>
        {t(pending ? recovery.checking ? "Checking saved result…" : "Saving answers…" : "Save all answers and continue")}
      </button>}
      {message && <p className={styles.success} role="status">{t(message)}</p>}
      {error && <p className={styles.error} role="alert"><span>{error.action && <>{t(NEED_LABELS[error.action.need])}: <span lang={t(error.action.title) === error.action.title ? "" : locale}>{t(error.action.title)}</span>. </>}<span lang={t(error.message) === error.message ? "" : locale}>{t(error.message)}</span></span></p>}
      <SupportUpdateRecovery recovery={recovery} onReview={reviewLatest} reviewLabel="Review latest questions"/>
      {changed && !recovery.unresolved && <div>
        <p className={styles.hint}>{t("Loading the latest questions replaces your unsaved answers with the current saved information.")}</p>
        <button className={styles.secondary} type="button" disabled={pending} onClick={reviewLatest}>
          {t(pending ? "Loading latest questions…" : "Review latest questions")}
        </button>
      </div>}
    </form>
  );
}
