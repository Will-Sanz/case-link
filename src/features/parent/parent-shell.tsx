import Link from "next/link";
import type { ReactNode } from "react";
import { Link as LinkIcon } from "iconoir-react";
import styles from "./parent.module.css";
import { ParentNavigation } from "./parent-navigation";

export function ParentShell({
  children,
  signedIn = false,
}: {
  children: ReactNode;
  signedIn?: boolean;
}) {
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="CaseLink home">
            <span className={styles.brandMark}>
              <LinkIcon
                width={23}
                height={23}
                strokeWidth={2}
                aria-hidden="true"
              />
            </span>
            CaseLink
          </Link>
          <ParentNavigation signedIn={signedIn} />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>CaseLink · Support for your family, with you in control.</span>
          <nav className={styles.footerLinks} aria-label="Footer">
            <Link href="/support/privacy">Privacy & control</Link>
            <Link href="/support/terms">Terms</Link>
            <Link href="/support/help">Get help</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
