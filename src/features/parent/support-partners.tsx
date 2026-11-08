"use client";
import type { SupportRequest } from "@/lib/parent/domain";
import type { ParentPartner } from "@/lib/parent/partner-directory";
import { displayDate } from "./api";
import { useParentResource } from "./use-parent-resource";
import styles from "./parent.module.css";

export function SupportPartners({ request }: { request: SupportRequest }) {
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
      <p className={styles.hint} role="status">
        Checking existing partner contacts…
      </p>
    );
  if (error)
    return (
      <div className={styles.notice}>
        <div>
          <p>
            Existing partner contacts could not be loaded. Official program
            links above remain available.
          </p>
          <button className={styles.quiet} onClick={reload}>
            Check partner contacts again
          </button>
        </div>
      </div>
    );
  if (!partners.length) return null;
  return (
    <section className={styles.surface}>
      <h2>Existing CaseLink partners</h2>
      <p className={styles.small}>
        These resources come from the original CaseLink directory. You can
        contact them directly. A partner listing does not mean CaseLink has sent
        your information or submitted an application.
      </p>
      <ul className={styles.resourceList}>
        {partners.map((partner) => (
          <li key={partner.legacyResourceId}>
            <h3>
              <a className={styles.textLink} href={partner.officialUrl}>
                {partner.name}
              </a>
            </h3>
            <p className={styles.hint}>
              Existing partner · direct contact available · automated delivery
              not connected
            </p>
            <p className={styles.hint}>
              Official source checked {displayDate(partner.sourceCheckedAt)} ·
              directory record updated {displayDate(partner.directoryUpdatedAt)}
              .
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
