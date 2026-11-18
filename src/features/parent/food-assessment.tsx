"use client";

import Link from "next/link";
import { useRef, useState, type ComponentProps, type FormEvent } from "react";
import { assessFoodSupport, foodAssessmentSchema, type FoodAssessmentHandoff, type FoodRecommendation } from "@/lib/parent/food-assessment";
import { foodAssessmentCopy } from "@/lib/parent/food-assessment-copy";
import { FoodDescription } from "./food-description";
import { foodDescriptionRoutingAnswersSchema, type FoodDescriptionRoutingAnswers } from "@/lib/parent/food-description-draft";
import { FoodAssessmentQuestions, type FoodQuestion } from "./food-assessment-questions";
import styles from "./parent.module.css";
import { useParentLocale } from "./parent-locale";



export function FoodAssessment({ initial, onChoose, descriptionOptions, onOwnerChanged }: { initial?: FoodAssessmentHandoff; onChoose?: (value: FoodAssessmentHandoff) => void; descriptionOptions?: { signInOptions?: ComponentProps<typeof FoodDescription>["signInOptions"] }; onOwnerChanged?: () => void }) {
  const { locale: language } = useParentLocale();
  const [answers, setAnswers] = useState(initial?.answers ?? { foodForTwoDays: "", benefitHistory: "", existingIssue: null } as { foodForTwoDays: string; benefitHistory: string; existingIssue: string | null });
  const [paths, setPaths] = useState<FoodRecommendation[] | null>(initial ? assessFoodSupport(initial.answers) : null);
  const [routingAnswers, setRoutingAnswers] = useState<FoodDescriptionRoutingAnswers>({});
  const [descriptionActive, setDescriptionActive] = useState(false);
  const [descriptionSource, setDescriptionSource] = useState(initial?.descriptionSource);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const firstAnswer = useRef<HTMLSelectElement>(null);
  const c = foodAssessmentCopy[language];
  function rememberAnswer(field: FoodQuestion, value: string, confirmedAt = new Date().toISOString()) {
    setRoutingAnswers(current => { const next = { ...current, [field]: { value, confirmedAt } }; if (!value) delete next[field]; if (field === "benefitHistory") delete next.existingIssue; return foodDescriptionRoutingAnswersSchema.parse(next); });
  }
  function resetDescription(ownerChanged = false) {
    setDescriptionSource(undefined); setPaths(null);
    setAnswers(ownerChanged ? { foodForTwoDays: "", benefitHistory: "", existingIssue: null } : { foodForTwoDays: routingAnswers.foodForTwoDays?.value ?? "", benefitHistory: routingAnswers.benefitHistory?.value ?? "", existingIssue: routingAnswers.existingIssue?.value ?? null });
    if (ownerChanged) { setRoutingAnswers({}); onOwnerChanged?.(); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = foodAssessmentSchema.safeParse(answers);
    if (!value.success) return;
    setPaths(assessFoodSupport(value.data));
    requestAnimationFrame(() => resultTitle.current?.focus());
  }
  const reason = (path: FoodRecommendation) => ({ immediate: c.immediateReason, new: c.new, pending: c.pending, renewal: c.renewalReason, problem: c.problem })[path.reason];
  return <section lang={language} aria-labelledby="food-assessment-title" className={styles.section}>
    <h1 id="food-assessment-title">{c.title}</h1><p>{c.intro}</p>
    <aside className={styles.notice} aria-label={c.immediate}><div><h2>{c.immediate}</h2><a className={styles.textLink} href="https://www.phila.gov/food/">{c.direct}</a><p>{c.directNote}</p></div></aside>
    {descriptionOptions && <FoodDescription {...descriptionOptions} routingAnswers={routingAnswers} onActive={setDescriptionActive}
      onReset={resetDescription} onRoutingAnswer={rememberAnswer}
      onManual={() => { setDescriptionActive(false); setDescriptionSource(undefined); setAnswers({ foodForTwoDays: routingAnswers.foodForTwoDays?.value ?? "", benefitHistory: routingAnswers.benefitHistory?.value ?? "", existingIssue: routingAnswers.existingIssue?.value ?? null }); setPaths(null); requestAnimationFrame(() => firstAnswer.current?.focus()); }}
      onProposed={proposal => { setAnswers(proposal.proposedAnswers); setDescriptionSource(proposal.source); setPaths(assessFoodSupport(proposal.proposedAnswers).filter(path => proposal.needIds.includes(path.need))); setDescriptionActive(false); requestAnimationFrame(() => resultTitle.current?.focus()); }}/>
    }
    {!descriptionActive && (paths === null ? <form className={styles.form} onSubmit={submit}>
      <FoodAssessmentQuestions answers={answers} firstAnswer={firstAnswer} onChange={(field, value) => {
        setAnswers(current => ({ ...current, [field]: value, ...(field === "benefitHistory" ? { existingIssue: null } : {}) }));
        rememberAnswer(field, value);
      }}/>
      <button className={styles.button}>{c.submit}</button>
    </form> : <div aria-labelledby="food-guide-results">
      <h2 id="food-guide-results" tabIndex={-1} ref={resultTitle}>{c.results}</h2>
      {answers.benefitHistory === "not_sure" && <p>{c.unknownResult}</p>}
      {!paths.length && answers.benefitHistory !== "not_sure" && <p>{c.empty}</p>}
      {onChoose && paths.length === 2 && <div className={styles.space}><p>{c.together}</p><button type="button" className={styles.button} onClick={() => onChoose({ needs: paths.map(path => path.need), answers: foodAssessmentSchema.parse(answers), ...(descriptionSource ? { descriptionSource } : {}) })}>{c.both}</button></div>}
      {paths.map(path => <section key={path.need} className={styles.serviceOption}><div><h3>{c.titles[path.need as keyof typeof c.titles]}</h3><p>{reason(path)}</p>{onChoose ? <button type="button" className={styles.secondary} onClick={() => onChoose({ needs: [path.need], answers: foodAssessmentSchema.parse(answers), ...(descriptionSource ? { descriptionSource } : {}) })}>{c.titles[path.need as keyof typeof c.titles]}</button> : <Link className={styles.textLink} href={`/get-support?need=${path.need}`}>{c.titles[path.need as keyof typeof c.titles]}</Link>}</div></section>)}
      <p>{c.control}</p>{!descriptionSource && <button className={styles.secondary} onClick={() => { setPaths(null); requestAnimationFrame(() => firstAnswer.current?.focus()); }}>{c.change}</button>}
    </div>)}
    {language === "es" && <p className={styles.notice}>{c.english}</p>}
  </section>;
}
