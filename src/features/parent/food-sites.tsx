"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, MapPin } from "iconoir-react";
import type { FoodSiteResult } from "@/lib/parent/food-sites";
import { displayDate } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
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
      <p className={styles.hint}>
        City listings for {zip} · checked {displayDate(data.checkedAt, true)}.
        This is a directory check, not confirmation from a location.
      </p>
      {data.sites.length ? (
        <ul className={styles.resourceList} id="food-location-results">
          {data.sites.slice(0, expanded ? undefined : 3).map((site) => (
            <li key={site.id}>
              <h3>{site.name}</h3>
              {site.category && (
                <p className={styles.small}>
                  <strong>{site.category}</strong>
                </p>
              )}
              <p className={`${styles.inline} ${styles.small}`}>
                <MapPin width={17} height={17} aria-hidden="true" />
                {site.address}, {site.zip}
              </p>
              <div className={styles.inline}>
                {site.phoneNumber && (
                  <a
                    className={styles.textLink}
                    href={`tel:${site.phoneNumber.replace(/[^+\d]/g, "")}`}
                  >
                    Call {site.phoneNumber}
                  </a>
                )}
                {site.website && (
                  <a className={styles.textLink} href={site.website}>
                    Location website
                  </a>
                )}
              </div>
              {(site.hours.length > 0 || site.serviceAreaNotes) && (
                <details className={styles.resourceDetails}>
                  <summary>Listed hours & service details</summary>
                  {site.hours.length > 0 && (
                    <dl className={styles.hoursList}>
                      {site.hours.map((hours) => (
                        <div key={hours.day}>
                          <dt>{dayLabels[hours.day]}</dt>
                          <dd>
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
                  {site.serviceAreaNotes && <p>{site.serviceAreaNotes}</p>}
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.small}>
          No current City listings were returned for {zip}. Nearby help may
          still be available. Check the City finder for other locations.
        </p>
      )}
      {data.sites.length > 3 && (
        <button
          className={styles.quiet}
          aria-expanded={expanded}
          aria-controls="food-location-results"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded
            ? "Show fewer locations"
            : `See ${data.sites.length - 3} more city-listed locations`}
        </button>
      )}
      {data.moreSitesAvailable && (
        <p className={styles.hint}>
          The City has more listings. Use its full finder to explore additional
          options.
        </p>
      )}
    </>
  );
}

export function FoodSites({ zip }: { zip?: string }) {
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
    <section className={styles.surface} aria-labelledby="food-sites-title">
      <h2 id="food-sites-title">Food locations near your ZIP</h2>
      <p className={styles.small}>
        City-listed locations. Confirm hours, eligibility and food availability
        before traveling. A listing is not a reservation or a confirmed pickup.
      </p>
      {!zip && (
        <form
          className={`${styles.inline} ${styles.resourceSearch}`}
          onSubmit={search}
        >
          <div className={styles.field}>
            <label htmlFor="food-site-zip">Philadelphia ZIP code</label>
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
            />
          </div>
          <button className={styles.secondary}>Find food locations</button>
        </form>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {/^191\d{2}$/.test(selectedZip) ? (
        <div className={styles.resourceResults}>
          <FoodSiteResults key={selectedZip} zip={selectedZip} />
        </div>
      ) : (
        zip && (
          <p className={styles.hint}>
            The connected listings cover Philadelphia ZIP codes. Use the full
            finder to check nearby options.
          </p>
        )
      )}
      <a
        className={`${styles.textLink} ${styles.resourceDirect}`}
        href="https://www.phila.gov/food/"
      >
        Open the City’s full food finder{" "}
        <ArrowRight width={16} height={16} aria-hidden="true" />
      </a>
    </section>
  );
}
