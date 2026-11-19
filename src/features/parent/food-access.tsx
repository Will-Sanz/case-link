"use client";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import {
  foodAccessPlanSchema, foodAccessReportInputSchema, foodAccessReportSchema,
  SHARE_FOOD_ACCESS_PROGRAM, SHARE_FOOD_ACCESS_SITE, SHARE_FOOD_ACCESS_SOURCE, type FoodAccessReport,
} from "@/lib/parent/food-access";
import { currentFoodAccessAlternatives } from "@/lib/parent/food-access-alternatives";
import { FoodSiteEntries } from "./food-sites";
import { boundedParentApi, displayDate, ParentApiError } from "./api";
import { ServiceError } from "./feedback";
import { useParentLocale } from "./parent-locale";
import { permissionWindowCurrent, usePermissionWindow } from "./use-permission-window";
import styles from "./parent.module.css";

const resultLabels: Record<FoodAccessReport["result"], string> = {
  received_enough_food: "I collected enough food for this immediate need",
  some_food_still_needed: "I collected some food and still need help",
  no_food: "There was no food available",
  could_not_access: "I could not access this location",
  need_another_way: "I need another way to get food",
};
type ReportInput = z.infer<typeof foodAccessReportInputSchema>;
type Attempt = { requestId: string; input: ReportInput; body: string };
const replySchema = z.object({ ok: z.literal(true), report: foodAccessReportSchema }).strict();
// Acknowledgement retries remain bounded even after the service mandate expires.
const reportDeadline = () => new Date(Date.now() + 30_000).toISOString();
function ownedReport(value: unknown, requestId: string) {
  const parsed = foodAccessReportSchema.safeParse(value);
  return parsed.success && parsed.data.requestId === requestId ? parsed.data : null;
}
function sameReport(report: FoodAccessReport, attempt: Attempt) {
  return report.requestId === attempt.requestId && report.reportKey === attempt.input.reportKey
    && report.expectedVersion === attempt.input.expectedVersion && report.siteId === attempt.input.siteId
    && report.planHash === attempt.input.planHash && report.result === attempt.input.result;
}

export function FoodAccessReportSummary({ report: value, requestId }: { report: unknown; requestId: string }) {
  const { t, locale } = useParentLocale();
  const report = ownedReport(value, requestId);
  if (!report) return null;
  return <div lang={locale} className={styles.space}>
    <p><strong>{t("Food access report:")} {t(resultLabels[report.result])}</strong></p>
    <p lang="en">{SHARE_FOOD_ACCESS_SITE.name} · {SHARE_FOOD_ACCESS_SITE.address}</p>
    <p className={styles.hint}>{t("Parent reported")} {displayDate(report.reportedAt, true, locale)}. {t("Share access guidance reviewed")} {displayDate(SHARE_FOOD_ACCESS_SOURCE.reviewedOn, false, locale)}. {t("This is your report; Share has not confirmed it.")}</p>
  </div>;
}

export function FoodAccess({ request, plan: value, report: reportValue, alternatives: alternativesValue, onChange, readError }: {
  request: SupportRequest; plan: unknown; report?: unknown; alternatives?: unknown; onChange: () => void; readError?: Error | null;
}) {
  const { t, locale } = useParentLocale();
  const parsed = foodAccessPlanSchema.safeParse(value);
  const plan = parsed.success && parsed.data.requestId === request.id ? parsed.data : null;
  const [result, setResult] = useState<ReportInput["result"] | "">("");
  const [correcting, setCorrecting] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [saved, setSaved] = useState<FoodAccessReport | null>(null), [error, setError] = useState<Error | null>(null);
  const [announcement,setAnnouncement]=useState<FoodAccessReport|null>(null);
  const resultInput=useRef<HTMLSelectElement|null>(null), status=useRef<HTMLParagraphElement|null>(null);
  const [pendingWork, setPendingWork] = useState<{ scope: string; controller: AbortController } | null>(null);
  const work = useRef<AbortController | null>(null), running = useRef<AbortController | null>(null);
  const withinPermission = usePermissionWindow(Date.parse(request.mandate.expiresAt));
  const reports = [saved, reportValue, ...(request.events ?? []).filter(event => event.actor === "parent" && event.kind === "parent.outcome_reported")
    .map(event => event.evidence?.foodAccessReport)]
    .map(report => ownedReport(report, request.id)).filter((report): report is FoodAccessReport => report !== null)
    .sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt));
  const latest = reports[0] ?? null;
  const acknowledged = attempt ? reports.find(report => sameReport(report, attempt)) : null;
  if (attempt && acknowledged) { setAttempt(null); setSaved(acknowledged); setError(null); setResult(""); setCorrecting(false); setAnnouncement(acknowledged); }
  const uncertain = !!attempt && !acknowledged;
  const scope = JSON.stringify([request.id, request.version, request.status, request.mandate, plan?.planHash]);
  useLayoutEffect(() => {
    const controller = new AbortController(); work.current = controller;
    return () => { controller.abort(); if (work.current === controller) work.current = null; };
  }, [scope]);
  useLayoutEffect(()=>{ if(correcting)resultInput.current?.focus(); },[correcting]);
  useLayoutEffect(()=>{ if(saved)status.current?.focus(); },[saved]);
  const pending = pendingWork?.scope === scope && !pendingWork.controller.signal.aborted;
  const factualCorrection = !!plan && request.status === "closed" && request.closed_reason === "completed"
    && plan.requestVersion + 1 === request.version && latest !== null;
  const current = !!plan && request.intake.needs.includes("food_now") && !readError
    && ((plan.requestVersion === request.version && request.status === "active" && withinPermission) || factualCorrection)
    && request.mandate.recipientIds.includes(SHARE_FOOD_ACCESS_PROGRAM)
    && request.mandate.allowedActions.includes("prepare") && request.mandate.allowedData.includes("household");
  const received = latest?.outcome === "support_received", failed = latest?.outcome === "unresolved";
  const alternatives = !readError && currentFoodAccessAlternatives(alternativesValue, request, latest);
  const canRetry = uncertain && attempt?.requestId === request.id && !readError;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const controller = work.current;
    if (!controller || controller.signal.aborted || running.current === controller || pending || !plan
      || (attempt ? !canRetry : !current || !result || (received && !correcting) || (!factualCorrection && !permissionWindowCurrent(Date.parse(request.mandate.expiresAt))))) return;
    running.current = controller; setPendingWork({ scope, controller }); setError(null); setAnnouncement(null);
    try {
      const exact = attempt ?? (() => {
        const input = foodAccessReportInputSchema.parse({ expectedVersion: request.version, siteId: plan.site.id, planHash: plan.planHash,
          reportKey: crypto.randomUUID(), result });
        return { requestId: request.id, input, body: JSON.stringify({ action: "food_visit", ...input }) };
      })();
      setAttempt(exact);
      const reply = replySchema.safeParse(await boundedParentApi(`/requests/${exact.requestId}/outcome`, { method: "POST", body: exact.body },
        controller.signal, reportDeadline()));
      if (controller.signal.aborted || work.current !== controller) return;
      if (!reply.success || !sameReport(reply.data.report, exact))
        throw new ParentApiError("Your report is not confirmed yet. Retry this same report before choosing a different answer.", 0);
      setSaved(reply.data.report); setAttempt(null); setResult(""); setCorrecting(false); setAnnouncement(reply.data.report); onChange();
    } catch (failure) {
      if (controller.signal.aborted || work.current !== controller) return;
      setError(failure instanceof Error ? failure : new Error("Your report is not confirmed. Retry the same report."));
      if (failure instanceof ParentApiError && [400, 409, 412].includes(failure.status)) setAttempt(null);
      onChange();
    } finally {
      if (running.current === controller) running.current = null;
      if (!controller.signal.aborted && work.current === controller) setPendingWork(null);
    }
  }
  if (!plan) return <section lang={locale} className={`${styles.space} ${styles.foodAccess}`} aria-label={t("Food access plan")}>
    <p className={styles.notice}>{t("This food access plan needs a current service check. Your food need remains open.")}</p>
    <Link className={styles.textLink} href="/support/help">{t("See direct support options")}</Link>
  </section>;
  return <section lang={locale} className={`${styles.space} ${styles.foodAccess}`} aria-labelledby="food-access-title">
    <h2 id="food-access-title">{t(received ? "Your food report is recorded" : failed ? "Your food need remains open" : "Your food access plan")}</h2>
    <p ref={status} role="status" aria-live="polite" tabIndex={-1} className={styles.hint}>{announcement?.requestId === request.id ? `${t("Your food report is saved:")} ${t(resultLabels[announcement.result])}.` : ""}</p>
    <h3 lang="en">{plan.site.name}</h3>
    <p lang="en">{plan.site.address}</p>
    {plan.state === "prepared" && !failed && !received ? <>
      <p>{t(plan.site.location)}</p>
      <p>{t(plan.site.publishedHours)} {t(plan.site.paperwork)}</p>
      <p>{t("Food depends on donations. Stock is unknown and nothing is reserved. You or a helper would need to collect food in person.")}</p>
    </> : !received && <p>{t(failed ? "The reported visit did not meet your immediate food need. CaseLink must check another practical option; nothing is reserved." : "CaseLink needs to check the source information before recommending a walk-up visit. Use the current City listings below or direct support options.")}</p>}
    <p className={styles.hint}>{t("Share guidance reviewed")} {displayDate(plan.source.reviewedOn, false, locale)}. {t("Delivery, language service and physical-access arrangements are not verified.")}</p>
    {plan.cityObservation && <p className={styles.hint}>{t("City directory checked")} {displayDate(plan.cityObservation.checkedAt, true, locale)}. {t("A directory check does not confirm stock or access.")}</p>}
    <div className={`${styles.serviceLinks} ${styles.space}`}>
      <a className={styles.textLink} href={plan.source.operatorUrl}>{t("Read Share’s access instructions")}</a>
      <a className={styles.textLink} href={plan.source.cityUrl}>{t("Open the City’s full food finder")}</a>
      <Link className={styles.textLink} href="/support/help">{t("See direct support options")}</Link>
    </div>
    {failed && current && request.status === "active" && <section className={styles.space} aria-labelledby="food-directory-check-title">
      <h3 id="food-directory-check-title">{t("Other City listings checked for this request")}</h3>
      {alternatives ? <>
        <p className={styles.hint}>{t("Recorded City directory check")} {displayDate(alternatives.checkedAt, true, locale)} · {alternatives.queriedZip}</p>
        <p>{t("These are directory entries, not confirmed food or a reservation. CaseLink still needs to verify a usable option.")}</p>
        {alternatives.sites.length > 0 && <p className={styles.hint}>{t("Location names and notes appear as published by the source.")}</p>}
        {alternatives.state === "listed" ? <FoodSiteEntries id="food-access-directory-results" sites={alternatives.sites} /> :
          <p>{t(alternatives.state === "empty" ? "The City check returned no other matching entries. This does not mean no food help exists." : "The City directory check was unavailable. This remains a CaseLink service issue.")}</p>}
        {latest.result === "need_another_way" && <p className={styles.notice}>{t("You still need another way to obtain food. These listings do not verify delivery, a helper or physical access.")}</p>}
        {alternatives.moreSitesAvailable && <p className={styles.hint}>{t("The City has additional listings beyond this saved check.")}</p>}
      </> : <p className={styles.notice}>{t("CaseLink still needs to check public listings for this report. Your food need remains open.")}</p>}
    </section>}
    {latest && <FoodAccessReportSummary report={latest} requestId={request.id} />}
    {factualCorrection && <p className={styles.notice}>{t("This request stays closed and no work has restarted. A correction updates your factual report only. Start a new request with current permission if you need further food support.")}</p>}
    {received && <p className={styles.success}>{t("You reported enough food for this immediate need. Other support requests keep their own progress.")}</p>}
    {(received || factualCorrection) && current && !uncertain && !correcting && <button className={styles.quiet} onClick={() => { setCorrecting(true); setResult(""); }}>{t("Correct this food report")}</button>}
    {(!received && !factualCorrection) || uncertain || correcting ? <form className={`${styles.form} ${styles.space}`} onSubmit={submit}>
      <div className={styles.field}>
        <label htmlFor="food-access-result">{t("Did this food option work for you?")}</label>
        <select ref={resultInput} id="food-access-result" className={styles.select} required value={attempt?.input.result ?? result}
          disabled={!current || pending || uncertain} onChange={event => { setResult(event.target.value as ReportInput["result"] | ""); setError(null); }}>
          <option value="">{t("Choose what happened")}</option>
          {Object.entries(resultLabels).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
        </select>
        {uncertain && attempt && <p className={styles.hint}>{t("Report awaiting confirmation:")} {t(resultLabels[attempt.input.result])}</p>}
      </div>
      {uncertain && <p className={styles.notice}>{t("Your report is not confirmed yet. Retry the same report or refresh saved activity before changing your answer.")}</p>}
      {!current && !uncertain && <p className={styles.hint}>{t("New reports need the current active request and permission. Refresh your support to check the latest saved plan.")}</p>}
      <div className={styles.inline}>
        <button className={styles.button} disabled={pending || (uncertain ? !canRetry : !current || !result)}>{t(pending ? "Saving report…" : uncertain ? "Retry same report" : "Save food report")}</button>
        <button type="button" className={styles.quiet} disabled={pending} onClick={onChange}>{t("Refresh saved activity")}</button>
      </div>
    </form> : <p className={styles.space}><Link className={styles.textLink} href="/get-support?need=food_now">{t("Ask for food support again")}</Link></p>}
    {error && <div className={styles.space}><ServiceError error={error} returnTo={`/support/${request.id}`} /></div>}
  </section>;
}
