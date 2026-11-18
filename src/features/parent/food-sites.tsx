"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, MapPin } from "iconoir-react";
import type { FoodSiteResult } from "@/lib/parent/food-sites";
import { displayDate } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";

const dayLabels = {
  mon: "Monday",
  tues: "Tuesday",
  wed: "Wednesday",
  thurs: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function FoodSiteResults({ zip }: { zip: string }) {
  const { locale, t } = useParentLocale();
  const [expanded, setExpanded] = useState(false);
  const { data, error, loading, reload } = useParentResource<FoodSiteResult>(
    `/food-sites?zip=${encodeURIComponent(zip)}`,
  );
  if (loading)
    return <ParentLoading label="Checking the City’s food listings" />;
  if (error) return <ServiceError error={error} retry={reload} />;
  if (!data) return null;
  return (
    <>
      <p className={styles.hint}>{t("City listings for {zip} · checked {date}. This is a directory check, not confirmation from a location.").replace("{zip}", zip).replace("{date}", displayDate(data.checkedAt, true, locale))}</p>
      {data.sites.length > 0 && <p className={styles.hint}>{t("Location names and notes appear as published by the source.")}</p>}
      {data.sites.length ? (
        <ul className={styles.resourceList} id="food-location-results">
          {data.sites.slice(0, expanded ? undefined : 3).map((site) => (
            <li key={site.id}>
              <h3 lang="">{site.name}</h3>
              {site.category && (
                <p className={styles.small}>
                  <strong lang="">{site.category}</strong>
                </p>
              )}
              <p lang="" className={`${styles.inline} ${styles.small}`}>
                <MapPin width={17} height={17} aria-hidden="true" />
                {site.address}, {site.zip}
              </p>
              <div className={styles.inline}>
                {site.phoneNumber && (
                  <a
                    className={styles.textLink}
                    href={`tel:${site.phoneNumber.replace(/[^+\d]/g, "")}`}
                  >{t("Call {phone}").replace("{phone}", site.phoneNumber)}</a>
                )}
                {site.website && (
                  <a className={styles.textLink} href={site.website}>{t("Location website")}</a>
                )}
              </div>
              {(site.hours.length > 0 || site.serviceAreaNotes) && (
                <details className={styles.resourceDetails}>
                  <summary>{t("Listed hours & service details")}</summary>
                  {site.hours.length > 0 && (
                    <dl className={styles.hoursList}>
                      {site.hours.map((hours) => (
                        <div key={hours.day}>
                          <dt>{t(dayLabels[hours.day])}</dt>
                          <dd lang="">
                            {hours.windows.join(", ")}
                            {hours.notes && (
                              <span>
                                {hours.windows.length > 0 ? " · " : ""}
                                {hours.notes}
                              </span>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {site.serviceAreaNotes && <p lang="">{site.serviceAreaNotes}</p>}
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.small}>{t("No current City listings were returned for {zip}. Nearby help may still be available. Check the City finder for other locations.").replace("{zip}", zip)}</p>
      )}
      {data.sites.length > 3 && (
        <button
          className={styles.quiet}
          aria-expanded={expanded}
          aria-controls="food-location-results"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? t("Show fewer locations") : t("See {n} more city-listed locations").replace("{n}", String(data.sites.length - 3))}
        </button>
      )}
      {data.moreSitesAvailable && (
        <p className={styles.hint}>{t("The City has more listings. Use its full finder to explore additional options.")}</p>
      )}
    </>
  );
}

export function FoodSites({ zip }: { zip?: string }) {
  const { locale, t } = useParentLocale();
  const [draft, setDraft] = useState("");
  const [searchZip, setSearchZip] = useState("");
  const selectedZip = zip ?? searchZip;
  const [error, setError] = useState("");
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^191\d{2}$/.test(draft)) {
      setError(
        "Enter a Philadelphia ZIP code beginning with 191, or use the City’s full finder below.",
      );
      return;
    }
    setSearchZip(draft);
    setError("");
  }
  return (
    <section lang={locale} className={`${styles.surface} ${styles.foodSites}`} aria-labelledby="food-sites-title">
      <h2 id="food-sites-title">{t("Food locations near your ZIP")}</h2>
      <p className={styles.small}>{t("City-listed locations. Confirm hours, eligibility and food availability before traveling. A listing is not a reservation or a confirmed pickup.")}</p>
      {!zip && (
        <form
          className={`${styles.inline} ${styles.resourceSearch}`}
          onSubmit={search}
        >
          <div className={styles.field}>
            <label htmlFor="food-site-zip">{t("Philadelphia ZIP code")}</label>
            <input
              id="food-site-zip"
              className={styles.input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              required
              inputMode="numeric"
              pattern="[0-9]{5}"
              maxLength={5}
              autoComplete="postal-code"
              aria-invalid={!!error}
              aria-describedby={error ? "food-site-zip-error" : undefined}
            />
          </div>
          <button className={styles.secondary}>{t("Find food locations")}</button>
        </form>
      )}
      {error && (
        <p id="food-site-zip-error" role="alert" className={styles.error}>
          {t(error)}
        </p>
      )}
      {/^191\d{2}$/.test(selectedZip) ? (
        <div className={styles.resourceResults}>
          <FoodSiteResults key={selectedZip} zip={selectedZip} />
        </div>
      ) : (
        zip && (
          <p className={styles.hint}>{t("The connected listings cover Philadelphia ZIP codes. Use the full finder to check nearby options.")}</p>
        )
      )}
      <a
        className={`${styles.textLink} ${styles.resourceDirect}`}
        href="https://www.phila.gov/food/"
      >{t("Open the City’s full food finder")}{" "}
        <ArrowRight width={16} height={16} aria-hidden="true" />
      </a>
      <details className={styles.resourceDetails}>
        <summary>{t("More food options and a no-paperwork fridge")}</summary>
        <p>{t("Share Community Fridge & Pantry is outside 2901 W. Hunting Park Avenue, Philadelphia. Share publishes 24-hour access without paperwork. Food depends on donations; stock is unknown and nothing is reserved.")}</p>
        <p className={styles.hint}>{t("Share source reviewed November 17, 2026. Check the operator’s current instructions before traveling. Other fridges can have different hours. No delivery, interpreter or physical-access arrangement is confirmed.")}</p>
        <div className={styles.serviceLinks}>
          <a className={styles.textLink} href="https://www.sharefoodprogram.org/community-fridges/">{t("Read Share’s fridge access instructions")}</a>
          <a className={styles.textLink} href="https://www.sharefoodprogram.org/find-food/">{t("Open Share’s food finder")}</a>
          <a className={styles.textLink} href="https://www.feedingamerica.org/need-help-find-food">{t("Find a food bank outside this area")}</a>
        </div>
        <p>{t("Some finder locations offer delivery only. Check each service’s rules; a warehouse address is not a walk-in food site. If one visit does not work out, use the City or Share finder for another option. A listing or a visit does not mean food was received.")}</p>
      </details>
    </section>
  );
}
