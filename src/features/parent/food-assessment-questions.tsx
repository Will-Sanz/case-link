"use client";
import type { Ref } from "react";
import type { FoodAssessmentAnswers } from "@/lib/parent/food-assessment";
import { foodAssessmentCopy } from "@/lib/parent/food-assessment-copy";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";
export type FoodQuestion = keyof FoodAssessmentAnswers;
export type FoodQuestionValues = { foodForTwoDays: string; benefitHistory: string; existingIssue: string | null };
function questionOptions(c: (typeof foodAssessmentCopy)["en" | "es"]): Record<FoodQuestion, Record<string, string>> {
  return { foodForTwoDays: { yes: c.yes, no: c.no, not_sure: c.unknown },
    benefitHistory: { never: c.never, applied: c.applied, receiving: c.receiving, not_sure: c.unknown },
    existingIssue: { renewal: c.renewal, stopped: c.stopped, card: c.card, none: c.none, not_sure: c.unknown } };
}
/** Manual and optional-description clarification use the same reviewed questions and enum choices. */
export function FoodAssessmentQuestions({ answers, onChange, questionIds, firstAnswer }: {
  answers: FoodQuestionValues; onChange: (field: FoodQuestion, value: string) => void;
  questionIds?: readonly FoodQuestion[]; firstAnswer?: Ref<HTMLSelectElement>;
}) {
  const { locale } = useParentLocale(), c = foodAssessmentCopy[locale], options = questionOptions(c);
  const show = (id: FoodQuestion) => !questionIds || questionIds.includes(id);
  const issue = answers.benefitHistory === "receiving" && (show("existingIssue") || questionIds?.includes("benefitHistory"));
  return <>
    {show("foodForTwoDays") && <><label className={styles.label} htmlFor="food-guide-enough">{c.enough}</label>
      <select className={styles.select} id="food-guide-enough" ref={firstAnswer} required value={answers.foodForTwoDays} onChange={event => onChange("foodForTwoDays", event.target.value)}>
        <option value="">{c.select}</option>{Object.entries(options.foodForTwoDays).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>{options.foodForTwoDays[answers.foodForTwoDays] && <p className={styles.hint}>{options.foodForTwoDays[answers.foodForTwoDays]}</p>}</>}
    {show("benefitHistory") && <><label className={styles.label} htmlFor="food-guide-history">{c.history}</label>
      <select className={styles.select} id="food-guide-history" ref={!show("foodForTwoDays") ? firstAnswer : undefined} required value={answers.benefitHistory} onChange={event => onChange("benefitHistory", event.target.value)}>
        <option value="">{c.select}</option>{Object.entries(options.benefitHistory).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>{options.benefitHistory[answers.benefitHistory] && <p className={styles.hint}>{options.benefitHistory[answers.benefitHistory]}</p>}</>}
    {issue && <><label className={styles.label} htmlFor="food-guide-issue">{c.issue}</label>
      <select className={styles.select} id="food-guide-issue" ref={!show("foodForTwoDays") && !show("benefitHistory") ? firstAnswer : undefined} required value={answers.existingIssue ?? ""} onChange={event => onChange("existingIssue", event.target.value)}>
        <option value="">{c.select}</option>{Object.entries(options.existingIssue).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>{options.existingIssue[answers.existingIssue ?? ""] && <p className={styles.hint}>{options.existingIssue[answers.existingIssue ?? ""]}</p>}</>}
  </>;
}

export function FoodAssessmentSummary({ answers }: { answers: FoodAssessmentAnswers }) {
  const { locale } = useParentLocale(), c = foodAssessmentCopy[locale], options = questionOptions(c);
  return <dl><dt>{c.enough}</dt><dd>{options.foodForTwoDays[answers.foodForTwoDays]}</dd>
    <dt>{c.history}</dt><dd>{options.benefitHistory[answers.benefitHistory]}</dd>
    {answers.existingIssue && <><dt>{c.issue}</dt><dd>{options.existingIssue[answers.existingIssue]}</dd></>}
  </dl>;
}
