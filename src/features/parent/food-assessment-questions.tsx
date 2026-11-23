"use client";
import { useId, type Ref } from "react";
import type { FoodAssessmentAnswers } from "@/lib/parent/food-assessment";
import { foodAssessmentCopy } from "@/lib/parent/food-assessment-copy";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";
export type FoodQuestion = keyof FoodAssessmentAnswers;
export type FoodQuestionValues = { foodForTwoDays: string; benefitHistory: string; existingIssue: string | null };
function questionOptions(c: (typeof foodAssessmentCopy)["en" | "es"]): Record<FoodQuestion, Record<string, string>> {
  return { foodForTwoDays: { yes: c.yes, no: c.no, not_sure: c.unknown },
    benefitHistory: { never: c.never, applied: c.applied, denied: c.denied, receiving: c.receiving, not_sure: c.unknown },
    existingIssue: { renewal: c.renewal, stopped: c.stopped, card: c.card, none: c.none, not_sure: c.unknown } };
}
/** Manual and optional-description clarification use the same reviewed questions and enum choices. */
export function FoodAssessmentQuestions({ answers, onChange, questionIds, firstAnswer, allowIncomplete = false, optional = false }: {
  answers: FoodQuestionValues; onChange: (field: FoodQuestion, value: string) => void;
  questionIds?: readonly FoodQuestion[]; firstAnswer?: Ref<HTMLInputElement>; allowIncomplete?: boolean; optional?: boolean;
}) {
  const { locale } = useParentLocale();
  const c = foodAssessmentCopy[locale];
  const options = questionOptions(c);
  const groupId = useId();
  const questions: { field: FoodQuestion; id: string; label: string }[] = [
    { field: "foodForTwoDays", id: "food-guide-enough", label: c.enough },
    { field: "benefitHistory", id: "food-guide-history", label: c.history },
    { field: "existingIssue", id: "food-guide-issue", label: c.issue },
  ];
  const visible = questions.filter(({ field }) => {
    if (field === "existingIssue") {
      return answers.benefitHistory === "receiving" &&
        (!questionIds || questionIds.includes(field) || questionIds.includes("benefitHistory"));
    }
    return !questionIds || questionIds.includes(field);
  });
  return visible.map(({ field, id, label }, index) => {
    const choices = Object.entries(options[field]);
    const focusValue = answers[field] || choices[0][0];
    return (
      <fieldset key={field} className={styles.foodChoices} id={id} aria-describedby={allowIncomplete ? "food-guide-partial-hint" : undefined}>
        <legend>{label}</legend>
        <div className={field === "foodForTwoDays" ? styles.foodChoiceOptions : styles.foodChoiceList}>
          {choices.map(([value, text]) => (
            <label className={styles.foodChoiceOption} key={value}>
              <input
                type="radio"
                name={`${groupId}-${field}`}
                value={value}
                checked={answers[field] === value}
                ref={index === 0 && value === focusValue ? firstAnswer : undefined}
                required={!allowIncomplete && !optional}
                onChange={() => onChange(field, value)}
              />
              <span>{text}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  });
}

export function FoodAssessmentSummary({ answers }: { answers: FoodAssessmentAnswers }) {
  const { locale } = useParentLocale(), c = foodAssessmentCopy[locale], options = questionOptions(c);
  return <dl><dt>{c.enough}</dt><dd>{options.foodForTwoDays[answers.foodForTwoDays]}</dd>
    <dt>{c.history}</dt><dd>{options.benefitHistory[answers.benefitHistory]}</dd>
    {answers.existingIssue && <><dt>{c.issue}</dt><dd>{options.existingIssue[answers.existingIssue]}</dd></>}
  </dl>;
}
