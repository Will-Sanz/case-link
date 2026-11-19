"use client";
import type { SupportRequest } from "@/lib/parent/domain";
import type { ParentPartner } from "@/lib/parent/partner-directory";
import { displayDate } from "./api";
import { useParentResource } from "./use-parent-resource";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";

export function SupportPartners({ request }: { request: SupportRequest }) {
  const { t: parentText, locale } = useParentLocale();
  const localized = request.intake.needs.length > 0 && request.intake.needs.every(need => need === "food_now" || need.startsWith("snap_") || need.startsWith("wic_"));
  const t = (copy: string) => localized ? parentText(copy) : copy;
  const { data, error, loading, reload } = useParentResource<{
    partners: ParentPartner[];
  }>("/partners");
  const partners =
    data?.partners
      ?.filter((partner) =>
        partner.programIds.some((id) =>
          request.mandate.recipientIds.includes(id),
        ),
      )
      .filter(
        (partner, index, all) =>
          all.findIndex(
            (other) => other.officialUrl === partner.officialUrl,
          ) === index,
      ) ?? [];
  if (loading)
    return (
      <p lang={localized ? locale : "en"} className={styles.hint} role="status">{t("Checking existing partner contacts…")}</p>
    );
  if (error)
    return (
      <div lang={localized ? locale : "en"} className={styles.notice}>
        <div>
          <p>
            {t("Existing partner contacts could not be loaded. Official program links above remain available.")}
          </p>
          <button className={styles.quiet} onClick={reload}>
            {t("Check partner contacts again")}
          </button>
        </div>
      </div>
    );
  if (!partners.length) return null;
  return (
    <section lang={localized ? locale : "en"} className={styles.surface}>
      <h2>{t("Existing CaseLink partners")}</h2>
      <p className={styles.small}>
        {t("These resources come from the original CaseLink directory. You can contact them directly. A partner listing does not mean CaseLink has sent your information or submitted an application.")}
      </p>
      <ul className={styles.resourceList}>
        {partners.map((partner) => (
          <li key={partner.legacyResourceId}>
            <h3 lang="">
              <a className={styles.textLink} href={partner.officialUrl}>
                {partner.name}
              </a>
            </h3>
            <p className={styles.hint}>
              {t("Existing partner · direct contact available · automated delivery not connected")}
            </p>
            <p className={styles.hint}>
              {t("Official source checked {checked} · directory record updated {updated}.").replace("{checked}", displayDate(partner.sourceCheckedAt, false, localized ? locale : "en")).replace("{updated}", displayDate(partner.directoryUpdatedAt, false, localized ? locale : "en"))}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
