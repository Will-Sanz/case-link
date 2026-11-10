import Link from "next/link";
import styles from "@/features/parent/parent.module.css";
export default function NotFound() {
  return (
    <div className={styles.container}>
      <h1>We couldn’t find that page</h1>
      <p className={`${styles.lead} ${styles.space}`}>
        The link may be old, or this support request may no longer be available
        to your account.
      </p>
      <Link className={`${styles.button} ${styles.space}`} href="/my-support">
        Go to My support
      </Link>
    </div>
  );
}
