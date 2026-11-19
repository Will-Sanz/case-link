"use client";
import { useParentLocale } from "./parent-locale";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import styles from "./parent.module.css";

const supportLinks = [
  { href: "/get-support", label: "Get support" },
  { href: "/my-support", label: "My support" },
  { href: "/family-profile", label: "Family information" },
  { href: "/support/help", label: "Help" },
];

export function ParentNavigation({ signedIn }: { signedIn: boolean }) {
  const { t } = useParentLocale();
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const links = signedIn
    ? supportLinks
    : [
        { href: "/product", label: "How it works" },
        { href: "/support/help", label: "Get help" },
      ];
  const active = (href: string) =>
    pathname === href ||
    (href === "/my-support" && /^\/support\/[a-f0-9-]{36}$/i.test(pathname));
  const accountPath = signedIn ? "/account" : "/sign-in";
  const closeMenu = () => menu.current?.removeAttribute("open");
  return (
    <>
      <nav className={styles.navigation} aria-label={t("Main navigation")}>
        {links.map((link) => (
          <Link
            key={link.href}
            className={styles.navLink}
            href={link.href}
            aria-current={active(link.href) ? "page" : undefined}
          >
            {t(link.label)}
          </Link>
        ))}
        <Link
          className={styles.navAccount}
          href={accountPath}
          aria-current={pathname === accountPath ? "page" : undefined}
        >
          {signedIn ? t("Your account") : t("Sign in")}
        </Link>
      </nav>
      <details ref={menu} className={styles.mobileNav}>
        <summary>{t("Menu")}</summary>
        <nav aria-label={t("Mobile navigation")}>
          {links.map((link) => (
            <Link
              key={link.href}
              className={styles.navLink}
              href={link.href}
              aria-current={active(link.href) ? "page" : undefined}
              onClick={closeMenu}
            >
              {t(link.label)}
            </Link>
          ))}
          <Link
            className={styles.navLink}
            href={accountPath}
            aria-current={pathname === accountPath ? "page" : undefined}
            onClick={closeMenu}
          >
            {signedIn ? t("Your account") : t("Sign in")}
          </Link>
        </nav>
      </details>
    </>
  );
}
