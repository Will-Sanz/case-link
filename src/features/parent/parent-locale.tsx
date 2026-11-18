"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PARENT_LOCALE_COOKIE, parentLocale, parentText, type ParentLocale } from "@/lib/parent/locale";
import styles from "./parent.module.css";

const LocaleContext = createContext<{ locale: ParentLocale; provided: boolean; chooseLocale: (locale: ParentLocale) => void }>({ locale: "en", provided: false, chooseLocale() {} });

export function ParentLocaleProvider({ initialLocale, children }: { initialLocale: ParentLocale; children: ReactNode }) {
  const [locale, setLocale] = useState(initialLocale);
  const router = useRouter();
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = locale;
    return () => { document.documentElement.lang = previous; };
  }, [locale]);
  function chooseLocale(value: ParentLocale) {
    const next = parentLocale(value);
    setLocale(next);
    let remembered = false;
    try {
      document.cookie = `${PARENT_LOCALE_COOKIE}=${next}; Path=/; Max-Age=7776000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      remembered = document.cookie.split("; ").includes(`${PARENT_LOCALE_COOKIE}=${next}`);
    } catch { /* Remembering a display preference is optional; the selected language remains usable in this tab. */ }
    const current = new URL(window.location.href);
    if (["/forgot-password", "/reset-password"].includes(current.pathname)) {
      if (current.searchParams.get("ui") !== next) {
        current.searchParams.set("ui", next);
        router.replace(`${current.pathname}${current.search}${current.hash}`, { scroll: false });
      }
    } else if (remembered) router.refresh();
  }
  return <LocaleContext.Provider value={{ locale, provided: true, chooseLocale }}>{children}</LocaleContext.Provider>;
}

export function useParentLocale() {
  const value = useContext(LocaleContext);
  return { ...value, t: (english: string) => parentText(value.locale, english) };
}

/** The original recovery host can render the selected locale without changing its Auth contract. */
export function ParentRecoveryLocale({ requestedLocale, children }: { requestedLocale?: ParentLocale; children: ReactNode }) {
  const inherited = useContext(LocaleContext);
  const [pendingLocale, setPendingLocale] = useState(requestedLocale);
  if (inherited.provided && pendingLocale && inherited.locale === pendingLocale) setPendingLocale(undefined);
  useEffect(() => {
    if (pendingLocale && inherited.provided) inherited.chooseLocale(pendingLocale);
  }, [pendingLocale, inherited]);
  if (!inherited.provided && requestedLocale) return <ParentLocaleProvider initialLocale={requestedLocale}><div lang={requestedLocale}>{children}</div></ParentLocaleProvider>;
  const locale = pendingLocale ?? inherited.locale;
  return <LocaleContext.Provider value={{ ...inherited, locale }}>
    <div lang={locale}>{children}</div>
  </LocaleContext.Provider>;
}

export function ParentLanguageSelector() {
  const { locale, chooseLocale, t, provided } = useParentLocale();
  if (!provided) return null;
  return <label className={styles.label}>{t("Screen language / Idioma de pantalla")}
    <select className={styles.select} value={locale} onChange={event => chooseLocale(parentLocale(event.target.value))}>
      <option value="en" lang="en">English</option><option value="es" lang="es">Español</option>
    </select>
  </label>;
}
