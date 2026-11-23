"use client";
import { FoodAssessment } from "./food-assessment";
import type { SupportStartAnswers } from "./food-description";
import type { ParentIntakeSignInOptions } from "./intake";
import type { FoodAssessmentHandoff } from "@/lib/parent/food-assessment";
import styles from "./parent.module.css";

export function FoodServices({ initial, onChoose, signInOptions, onOwnerChanged, onStart, onOtherSupport }: {
  initial?: FoodAssessmentHandoff;
  onChoose?: (value: FoodAssessmentHandoff) => void;
  signInOptions?: ParentIntakeSignInOptions;
  onOwnerChanged?: () => void;
  onStart?: (value: SupportStartAnswers) => void;
  onOtherSupport?: (need?: string) => void;
}) {
  return <div className={`${styles.container} ${styles.foodServices}`}>
    <FoodAssessment initial={initial} onChoose={onChoose} onOwnerChanged={onOwnerChanged}
      onStart={onStart} onOtherSupport={onOtherSupport} descriptionOptions={onChoose ? { signInOptions } : undefined}/>
  </div>;
}
