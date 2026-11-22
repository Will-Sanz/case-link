"use client";

import Link from "next/link";
import { useRef, useState, type ComponentProps, type FormEvent } from "react";
import { assessFoodSupport, foodAssessmentSchema, type FoodAssessmentHandoff, type FoodRecommendation } from "@/lib/parent/food-assessment";
import { readyFoodDescriptionNeeds } from "@/lib/parent/food-description-view";
import { foodAssessmentCopy } from "@/lib/parent/food-assessment-copy";
import { FoodDescription, type SupportStartAnswers } from "./food-description";
import { foodDescriptionRoutingAnswersSchema, type FoodDescriptionRoutingAnswers } from "@/lib/parent/food-description-draft";
import { FoodAssessmentQuestions, type FoodQuestion } from "./food-assessment-questions";
import { FoodSites } from "./food-sites";
import styles from "./parent.module.css";
import { useParentLocale } from "./parent-locale";



export function FoodAssessment({ initial, onChoose, descriptionOptions, onOwnerChanged, onStart, onOtherSupport }: { initial?: FoodAssessmentHandoff; onChoose?: (value: FoodAssessmentHandoff) => void; descriptionOptions?: { signInOptions?: ComponentProps<typeof FoodDescription>["signInOptions"] }; onOwnerChanged?: () => void; onStart?: (answers: SupportStartAnswers) => void; onOtherSupport?: (need?: string) => void }) {
  const { locale: language, t } = useParentLocale();
  const [manual, setManual] = useState<"choose" | "food" | null>(null);
  const [start, setStart] = useState<SupportStartAnswers | null>(null);
  const followUp = useRef<HTMLHeadingElement>(null);
  const [answers, setAnswers] = useState(initial?.answers ?? { foodForTwoDays: "", benefitHistory: "", existingIssue: null } as { foodForTwoDays: string; benefitHistory: string; existingIssue: string | null });
  const [paths, setPaths] = useState<FoodRecommendation[] | null>(initial ? assessFoodSupport(initial.answers) : null);
  const [routingAnswers, setRoutingAnswers] = useState<FoodDescriptionRoutingAnswers>({});
  const [descriptionActive, setDescriptionActive] = useState(false);
  const [benefitsExpanded, setBenefitsExpanded] = useState(Boolean(initial?.answers.benefitHistory));
  const [descriptionSource, setDescriptionSource] = useState(initial?.descriptionSource);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const firstFoodChoice = useRef<HTMLInputElement>(null);
  const benefitAnswer = useRef<HTMLInputElement>(null);
  const c = foodAssessmentCopy[language];
  function rememberAnswer(field: FoodQuestion, value: string, confirmedAt = new Date().toISOString()) {
    setRoutingAnswers(current => { const next = { ...current, [field]: { value, confirmedAt } }; if (!value) delete next[field]; if (field === "benefitHistory") delete next.existingIssue; return foodDescriptionRoutingAnswersSchema.parse(next); });
  }
  function resetDescription(ownerChanged = false) {
    setDescriptionSource(undefined); setPaths(null);
    setAnswers(ownerChanged ? { foodForTwoDays: "", benefitHistory: "", existingIssue: null } : { foodForTwoDays: routingAnswers.foodForTwoDays?.value ?? "", benefitHistory: routingAnswers.benefitHistory?.value ?? "", existingIssue: routingAnswers.existingIssue?.value ?? null });
    if (ownerChanged) { setRoutingAnswers({}); setBenefitsExpanded(false); setManual(null); setStart(null); onOwnerChanged?.(); }
  }
  const questionIds: FoodQuestion[] = [];
  if (!answers.foodForTwoDays) questionIds.push("foodForTwoDays");
  if (!answers.benefitHistory) questionIds.push("benefitHistory");
  if (answers.benefitHistory === "receiving" && !answers.existingIssue) questionIds.push("existingIssue");
  const represented = foodAssessmentSchema.safeParse({ foodForTwoDays: answers.foodForTwoDays || "not_sure", benefitHistory: answers.benefitHistory || "not_sure",
    existingIssue: answers.benefitHistory === "receiving" ? answers.existingIssue || "not_sure" : null });
  const recommendations = represented.success ? assessFoodSupport(represented.data) : [];
  const ready = represented.success ? readyFoodDescriptionNeeds({ state: questionIds.length ? "needs_clarification" : "proposal", needIds: recommendations.map(path => path.need),
    questionIds, proposedAnswers: represented.data, conflicts: [], outOfScope: null }) : [];
  const allowIncomplete = questionIds.length > 0 && ready.length > 0;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!represented.success) return;
    if (questionIds.length > 0 && !ready.length) {
      if (answers.foodForTwoDays && !benefitsExpanded) {
        setBenefitsExpanded(true);
        requestAnimationFrame(() => benefitAnswer.current?.focus());
      }
      return;
    }
    setPaths(recommendations.filter(path => ready.includes(path.need)));
    requestAnimationFrame(() => resultTitle.current?.focus());
  }
  function answer(field: FoodQuestion, value: string) {
    setAnswers(current => ({ ...current, [field]: value, ...(field === "benefitHistory" ? { existingIssue: null } : {}) }));
    rememberAnswer(field, value);
  }
  const reason = (path: FoodRecommendation) => ({ immediate: c.immediateReason, new: c.new, pending: c.pending, renewal: c.renewalReason, problem: answers.benefitHistory === "denied" ? c.deniedReason : c.problem })[path.reason];
  function continueWith(needs: FoodAssessmentHandoff["needs"]) {
    if (!represented.success) return;
    onChoose?.({ needs, answers: represented.data, ...(descriptionSource ? { descriptionSource } : {}) });
  }
  const bothOptions = !!onChoose && paths?.length === 2;

  return <section lang={language} aria-labelledby={onStart ? "support-start-title" : "food-assessment-title"} className={onStart ? styles.startFlow : `${styles.section} ${styles.foodGuide}`} data-describing={descriptionActive || undefined}>
    {onStart && <h1 id="support-start-title">{t("Get support")}</h1>}
    {!onStart && <><h1 id="food-assessment-title">{c.title}</h1><p>{c.intro}</p>
      <aside className={styles.foodUrgent} aria-label={c.immediate}><a className={styles.textLink} href="https://www.phila.gov/food/">{c.direct}</a><p>{c.directNote}</p></aside></>}
    {onStart && manual === "choose" && <div className={styles.foodResults}>
      <h2 ref={followUp} tabIndex={-1}>{t("What kind of help do you need?")}</h2>
      <button className={styles.button} type="button" onClick={() => { setManual("food"); requestAnimationFrame(() => firstFoodChoice.current?.focus()); }}>{t("Food or SNAP")}</button>
      <button className={styles.secondary} type="button" onClick={() => onOtherSupport?.()}>{t("See all support options")}</button>
      <details className={styles.disclosure}>
        <summary>{t("Browse local food locations")}</summary>
        <FoodSites initialZip={start?.zip} />
      </details>
      <Link className={styles.textLink} href="/support/help#urgent">{t("Find urgent food or utility help")}</Link>
      <button className={styles.quiet} type="button" onClick={() => setManual(null)}>{t("Back to Get support")}</button>
    </div>}
    {(!onStart || manual === "food" || paths !== null) && !descriptionActive && (paths === null ? <form className={styles.form} onSubmit={submit}>
      <FoodAssessmentQuestions answers={answers} questionIds={["foodForTwoDays"]} firstAnswer={firstFoodChoice} allowIncomplete={allowIncomplete} onChange={answer} />
      {allowIncomplete && <p id="food-guide-partial-hint" className={styles.hint}>{c.partial}</p>}
      <details className={styles.disclosure} open={benefitsExpanded} onToggle={event => setBenefitsExpanded(event.currentTarget.open)}>
        <summary>{c.benefits}</summary>
        <div className={styles.form}>
          <FoodAssessmentQuestions answers={answers} questionIds={["benefitHistory"]} firstAnswer={benefitAnswer} allowIncomplete={allowIncomplete} optional={!benefitsExpanded} onChange={answer} />
        </div>
      </details>
      <button className={styles.button}>{c.submit}</button>
    </form> : <div className={styles.foodResults} aria-labelledby="food-guide-results">
      <h2 id="food-guide-results" tabIndex={-1} ref={resultTitle}>{c.results}</h2>
      {answers.benefitHistory === "not_sure" && <p>{c.unknownResult}</p>}
      {!paths.length && answers.benefitHistory !== "not_sure" && <p>{c.empty}</p>}
      {bothOptions && <div className={styles.foodRecommendation}>
        <p><strong>{paths.map(path => c.titles[path.need]).join(" + ")}</strong></p>
        <p>{c.together}</p>
        <button type="button" className={styles.button} onClick={() => continueWith(paths.map(path => path.need))}>{c.both}</button>
      </div>}
      {paths.map(path => (
        <section key={path.need} className={bothOptions ? styles.serviceOption : styles.foodRecommendation}>
          <h3>{c.titles[path.need]}</h3>
          <p>{reason(path)}</p>
          {onChoose ? <button type="button" className={bothOptions ? styles.secondary : styles.button} onClick={() => continueWith([path.need])}>{c.titles[path.need]}</button>
            : <Link className={paths.length === 1 ? styles.button : styles.textLink} href={`/get-support?need=${path.need}`}>{c.titles[path.need]}</Link>}
        </section>
      ))}
      {!!paths.length && <p className={styles.hint}>{c.control}</p>}
      {!descriptionSource && <button type="button" className={styles.quiet} onClick={() => { setPaths(null); requestAnimationFrame(() => firstFoodChoice.current?.focus()); }}>{c.change}</button>}
    </div>)}
    {descriptionOptions && <div className={styles.descriptionSlot} hidden={manual === "food"}><FoodDescription {...descriptionOptions} routingAnswers={routingAnswers} onActive={setDescriptionActive}
      onStart={onStart ? value => { setStart(value); onStart(value); } : undefined} onOtherSupport={onOtherSupport}
      onResumePrevious={manual === "choose" ? () => setManual(null) : undefined}
      onReset={resetDescription} onRoutingAnswer={rememberAnswer}
      onManual={() => { if (onStart) { setManual("choose"); requestAnimationFrame(() => followUp.current?.focus()); }
        setDescriptionActive(false); setDescriptionSource(undefined); setAnswers({ foodForTwoDays: routingAnswers.foodForTwoDays?.value ?? "", benefitHistory: routingAnswers.benefitHistory?.value ?? "", existingIssue: routingAnswers.existingIssue?.value ?? null }); setPaths(null); if (!onStart) requestAnimationFrame(() => firstFoodChoice.current?.focus()); }}
      onProposed={proposal => { setAnswers(proposal.proposedAnswers); setDescriptionSource(proposal.source); setPaths(assessFoodSupport(proposal.proposedAnswers).filter(path => proposal.needIds.includes(path.need))); setDescriptionActive(false); requestAnimationFrame(() => resultTitle.current?.focus()); }}/></div>
    }
    {onStart && manual === "food" && <button className={styles.quiet} type="button" onClick={() => { setPaths(null); setManual("choose"); requestAnimationFrame(() => followUp.current?.focus()); }}>{t("See other support options")}</button>}
    {!onStart && language === "es" && <p className={styles.notice}>{c.english}</p>}
  </section>;
}
