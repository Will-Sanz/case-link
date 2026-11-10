import Link from "next/link";
import type { ReactNode } from "react";
import { CaseLinkWordmark } from "@/components/brand/caselink-mark";
import { ChatGptFuturesBanner } from "@/components/brand/chatgpt-futures-banner";
import styles from "./parent.module.css";
import { ParentNavigation } from "./parent-navigation";
import { FloatingAssistant } from "./floating-assistant";
import chatStyles from "./floating-assistant.module.css";

export function ParentShell({
  children,
  showRecognition = false,
  signedIn = false,
}: {
  children: ReactNode;
  showRecognition?: boolean;
  signedIn?: boolean;
}) {
  return (
    <div className={`${styles.shell} ${chatStyles.shell}`}>
      <a className={styles.skip} href="#main-content">
        Skip to content
      </a>
      {showRecognition && <ChatGptFuturesBanner />}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="CaseLink home">
            <CaseLinkWordmark />
          </Link>
          <ParentNavigation signedIn={signedIn} />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <Link href="/" aria-label="CaseLink home">
              <CaseLinkWordmark />
            </Link>
            <p>Support for your family, with you in control.</p>
            <p>Built in Philadelphia.</p>
          </div>
          <nav className={styles.footerLinks} aria-label="Footer">
            <Link href="/support/privacy#data-policy">Data policy</Link>
            <Link href="/support/privacy">Privacy policy</Link>
            <Link href="/support/terms">Terms of service</Link>
            <Link href="/support/help">Get help</Link>
            <a href="mailto:willsanz23@gmail.com">Contact CaseLink</a>
          </nav>
        </div>
      </footer>
      <FloatingAssistant signedIn={signedIn} />
    </div>
  );
}
