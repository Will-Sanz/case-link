"use client";
import { SNAP_EN_TEMPLATE_ID, SNAP_ES_TEMPLATE_ID, snapFormTemplateIdSchema } from "@/lib/parent/snap-form-source";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";

export type SnapFormTemplateId = typeof SNAP_EN_TEMPLATE_ID | typeof SNAP_ES_TEMPLATE_ID;

export function SnapDocumentLanguage({ value, onChange, disabled = false }: {
  value: SnapFormTemplateId; onChange: (value: SnapFormTemplateId) => void; disabled?: boolean;
}) {
  const { t, locale } = useParentLocale();
  return <div className={styles.field} lang={locale}>
    <label htmlFor="snap-document-language">{t("Official SNAP document language")}</label>
    <select id="snap-document-language" className={styles.select} value={value} disabled={disabled}
      onChange={event => onChange(snapFormTemplateIdSchema.parse(event.target.value) as SnapFormTemplateId)}>
      <option value={SNAP_EN_TEMPLATE_ID} lang="en">English</option>
      <option value={SNAP_ES_TEMPLATE_ID} lang="es">Español</option>
    </select>
    <p className={styles.hint}>{t("Choose the official form you want to review and complete. This does not change your screen language, contact language or interpreter choice.")}</p>
  </div>;
}
