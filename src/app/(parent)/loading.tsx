import { ParentLoading } from "@/features/parent/feedback";
import styles from "@/features/parent/parent.module.css";
export default function Loading() {
  return (
    <div className={styles.container}>
      <ParentLoading />
    </div>
  );
}
