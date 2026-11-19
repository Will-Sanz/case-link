"use client";
import { ServiceError } from "@/features/parent/feedback";
import styles from "@/features/parent/parent.module.css";
export default function ParentError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className={styles.container}>
      <ServiceError
        error={
          new Error(
            "Your support hasn’t been lost. Please try again, or use the direct resources in Help.",
          )
        }
        retry={reset}
      />
    </div>
  );
}
