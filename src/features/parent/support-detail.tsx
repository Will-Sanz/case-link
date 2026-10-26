"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Download,
  Lock,
  Pause,
  Play,
  Refresh,
  ShieldCheck,
} from "iconoir-react";
import { NEED_LABELS, OUTCOME_LABELS, intakeSchema } from "@/lib/parent/domain";
import type {
  NecessaryAction,
  SupportIntake,
  SupportRequest,
} from "@/lib/parent/domain";
import { getProgram, PROGRAMS } from "@/lib/parent/programs";
import { displayDate, parentApi } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { requestStatus } from "./my-support";
import { SupportDocuments } from "./support-documents";
import { SupportActivity } from "./support-activity";
import { NecessaryAnswer } from "./necessary-answer";
import { ANSWER_FIELDS } from "@/lib/parent/answers";
import {
  PermissionEditor,
  type PermissionEditorHandle,
} from "./permission-editor";
import { useParentResource } from "./use-parent-resource";
import { UrgentHelp } from "./landing";
import styles from "./parent.module.css";

function officialLink(value?: string): string | null {
  return value && PROGRAMS.some((program) => program.officialUrl === value)
    ? value
    : null;
}

function RequiredStep({
  action,
  request,
  onChange,
  onReviewPermission,
}: {
  action: NecessaryAction;
  request: SupportRequest;
  onChange: () => void;
  onReviewPermission: () => void;
}) {
  const url = officialLink(action.url);
  const canAnswer =
    (action.reason === "missing_fact" &&
      ANSWER_FIELDS.includes(action.field as (typeof ANSWER_FIELDS)[number])) ||
    action.field === "bookingPreference";
  return (
    <section
      className={styles.actionBox}
      aria-labelledby={`context-${action.id} step-${action.id}`}
    >
      <p id={`context-${action.id}`} className={styles.small}>
        <strong>{NEED_LABELS[action.need]}</strong>
      </p>
      <h2 id={`step-${action.id}`}>{action.title}</h2>
      <p>{action.explanation}</p>
      {canAnswer ? (
        <NecessaryAnswer
          action={action}
          request={request}
          onChange={onChange}
        />
      ) : (
        <div className={styles.space}>
          {action.reason === "expanded_permission" && (
            <>
              <p className={styles.small}>
                Choose the named programs and information for this step. We’ll
                resume only the work you authorize.
              </p>
              <button
                className={`${styles.button} ${styles.space}`}
                onClick={onReviewPermission}
              >
                Review permission
              </button>
            </>
          )}
          {url && (
            <a className={styles.secondary} href={url}>
              Open the official program{" "}
              <ArrowRight width={17} height={17} aria-hidden="true" />
            </a>
          )}
          <p className={`${styles.small} ${styles.space}`}>
            {action.reason === "personal_step"
              ? "Complete required personal steps directly with the program. Opening a link does not confirm completion; the program must record the required evidence."
              : "This step needs confirmed information or qualified help. We won’t mark it complete without evidence."}
          </p>
          <Link className={styles.textLink} href="/support/help">
            See help and direct program contacts
          </Link>
        </div>
      )}
    </section>
  );
}

function CorrectDetails({
  request,
  onChange,
}: {
  request: SupportRequest;
  onChange: () => void;
}) {
  const [intake, setIntake] = useState(request.intake);
  const [baseVersion, setBaseVersion] = useState(request.version);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    const parsed = intakeSchema.safeParse(intake);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your information.");
      return;
    }
    setPending(true);
    try {
      const response = await parentApi<{ request: SupportRequest }>(
        `/requests/${request.id}`,
        {
          method: "POST",
          body: JSON.stringify({
            action: "correct",
            intake: parsed.data,
            version: baseVersion,
          }),
        },
      );
      setIntake(response.request.intake);
      setBaseVersion(response.request.version);
      setSaved(true);
      onChange();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t save the correction. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  function change<K extends keyof SupportIntake>(
    field: K,
    value: SupportIntake[K],
  ) {
    setIntake((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }
  return (
    <details className={styles.disclosure} open={editing}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          if (!editing) {
            setIntake(request.intake);
            setBaseVersion(request.version);
            setSaved(false);
            setError("");
          }
          setEditing((current) => !current);
        }}
      >
        Correct household or bill information
      </summary>
      <div>
        <p className={`${styles.hint} ${styles.space}`}>
          We stop queued uses of changed facts and check whether already
          delivered information needs a correction. Submitted history stays
          intact.
        </p>
        <form className={`${styles.form} ${styles.space}`} onSubmit={submit}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="correct-zip">ZIP code</label>
              <input
                id="correct-zip"
                className={styles.input}
                required
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
                value={intake.zip}
                onChange={(e) => change("zip", e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="correct-size">Household size</label>
              <input
                id="correct-size"
                className={styles.input}
                type="number"
                min={1}
                max={30}
                value={intake.householdSize ?? ""}
                onChange={(e) =>
                  change(
                    "householdSize",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </div>
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="correct-income">Income before taxes ($)</label>
              <input
                id="correct-income"
                className={styles.input}
                type="number"
                min={0}
                max={1000000}
                step="0.01"
                value={intake.incomeAmount ?? ""}
                onChange={(e) =>
                  change(
                    "incomeAmount",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="correct-frequency">How often</label>
              <select
                id="correct-frequency"
                className={styles.select}
                value={intake.incomeFrequency}
                onChange={(e) =>
                  change(
                    "incomeFrequency",
                    e.target.value as SupportIntake["incomeFrequency"],
                  )
                }
              >
                <option value="unknown">Not sure / not provided</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option>
                <option value="twice_monthly">Twice a month</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          {request.intake.needs.some((need) =>
            ["electricity", "gas", "water"].includes(need),
          ) && (
            <div className={styles.field}>
              <label htmlFor="correct-authority">
                Your authority for all selected utility accounts
              </label>
              <select
                id="correct-authority"
                className={styles.select}
                value={intake.accountAuthority}
                onChange={(e) =>
                  change(
                    "accountAuthority",
                    e.target.value as SupportIntake["accountAuthority"],
                  )
                }
              >
                <option value="self">
                  I hold every selected utility account
                </option>
                <option value="authorized_caregiver">
                  I hold or have permission to act for every selected utility
                  account
                </option>
                <option value="not_sure">Not sure</option>
              </select>
            </div>
          )}
          {intake.needs.filter((need) =>
            ["electricity", "gas", "water"].includes(need),
          ).length === 1 && (
            <div className={styles.field}>
              <label htmlFor="correct-shutoff">
                Shutoff date, if on a notice
              </label>
              <input
                id="correct-shutoff"
                className={styles.input}
                type="date"
                value={intake.shutoffDate ?? ""}
                onChange={(e) => change("shutoffDate", e.target.value || null)}
              />
            </div>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className={styles.success} role="status">
              Your correction is saved. We’re checking the affected work.
            </p>
          )}
          <button className={styles.button} disabled={pending} type="submit">
            {pending ? "Saving correction…" : "Save correction"}
          </button>
        </form>
      </div>
    </details>
  );
}

export function SupportDetail({ requestId }: { requestId: string }) {
  const { data, error, loading, reload } = useParentResource<{
    request: SupportRequest;
  }>(`/requests/${requestId}`);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const permissionEditor = useRef<PermissionEditorHandle>(null);
  const request = data?.request;
  const requestState = request?.status;
  useEffect(() => {
    if (requestState !== "active") return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 30000);
    return () => clearInterval(interval);
  }, [requestState, reload]);
  async function changeState(action: "pause" | "resume" | "cancel") {
    setPending(true);
    setActionError(null);
    setNotice("");
    try {
      await parentApi(`/requests/${requestId}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setCancelConfirm(false);
      setNotice(
        action === "pause"
          ? "Future work is paused. Already delivered information remains in the history."
          : action === "cancel"
            ? "Your request is cancelled. Future work has stopped; already delivered information may not be recallable."
            : "Your request can continue within its current permission and limits.",
      );
      reload();
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err
          : new Error("We couldn’t update your request. Please try again."),
      );
    } finally {
      setPending(false);
    }
  }
  if (loading)
    return (
      <div className={styles.container}>
        <ParentLoading />
      </div>
    );
  if (error || !request)
    return (
      <div className={styles.container}>
        <ServiceError
          error={
            error ??
            new Error(
              "This support request is unavailable. Check My support for your current requests.",
            )
          }
          retry={reload}
          returnTo={`/support/${requestId}`}
        />
      </div>
    );
  const inactive = ["cancelled", "closed"].includes(request.status);
  const actions = request.required_actions.filter(
    (action) =>
      !action.resolved && (!action.resolver || action.resolver === "parent"),
  );
  const serviceActions = request.required_actions.filter(
    (action) =>
      !action.resolved && action.resolver && action.resolver !== "parent",
  );
  return (
    <div className={styles.container}>
      <Link
        className={`${styles.quiet} ${styles.hidePrint}`}
        href="/my-support"
      >
        <ArrowLeft width={17} height={17} aria-hidden="true" />
        My support
      </Link>
      <div className={`${styles.pageTop} ${styles.space}`}>
        <div>
          <h1>Your family’s support</h1>
          <p>
            {request.plan?.summary ??
              "Your request is saved. We’re preparing the next useful steps from the information you shared."}
          </p>
        </div>
        <span
          className={`${styles.badge} ${actions.length ? styles.badgeAttention : request.status !== "active" ? styles.badgeWait : ""}`}
        >
          {requestStatus(request)}
        </span>
      </div>
      {notice && (
        <p className={`${styles.success} ${styles.space}`} role="status">
          {notice}
        </p>
      )}
      {actionError && <ServiceError error={actionError} />}
      {request.intake.urgency === "today" && (
        <div className={styles.space}>
          <UrgentHelp />
        </div>
      )}
      {request.status === "paused" && (
        <div className={`${styles.notice} ${styles.space}`}>
          <Pause width={22} height={22} aria-hidden="true" />
          <p>
            <strong>Paused by you.</strong> No future actions will run while
            paused. Resume when you’re ready; expired permission may need
            renewal.
          </p>
        </div>
      )}
      <div className={`${styles.detailGrid} ${styles.space}`}>
        <div className={styles.detailMain}>
          {!inactive &&
            actions.map((action) => (
              <RequiredStep
                key={action.id}
                action={action}
                request={request}
                onChange={reload}
                onReviewPermission={() => permissionEditor.current?.open()}
              />
            ))}
          {!inactive && serviceActions.length > 0 && (
            <details className={styles.disclosure}>
              <summary>CaseLink is handling a service step</summary>
              <div>
                <p className={`${styles.subtle} ${styles.small}`}>
                  These steps belong to CaseLink or the program. You don’t need
                  to resolve a service connection or repeat your information.
                </p>
                <ul className={`${styles.list} ${styles.space}`}>
                  {serviceActions.map((action) => (
                    <li key={action.id}>
                      <strong>{action.title}</strong>
                      <p className={`${styles.hint} ${styles.space}`}>
                        {action.explanation}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}
          <section className={styles.surface}>
            <div className={styles.between}>
              <h2>What’s happening</h2>
              <button
                className={`${styles.quiet} ${styles.hidePrint}`}
                onClick={reload}
                aria-label="Refresh support progress"
              >
                <Refresh width={17} height={17} aria-hidden="true" />
                Refresh
              </button>
            </div>
            {request.plan?.routes.length ? (
              request.plan.routes.map((route, i) => {
                const program = getProgram(route.programId);
                return (
                  <article
                    className={styles.needRow}
                    key={`${route.need}-${route.programId}-${i}`}
                  >
                    <div className={styles.between}>
                      <h3>{NEED_LABELS[route.need]}</h3>
                      <span
                        className={`${styles.badge} ${["checking", "unresolved"].includes(route.state) ? styles.badgeWait : ""}`}
                      >
                        {OUTCOME_LABELS[route.state]}
                      </span>
                    </div>
                    <p>
                      <strong>{route.title}</strong>
                      {program && route.title !== program.name && (
                        <> · {program.name}</>
                      )}
                    </p>
                    <p>{route.summary}</p>
                    {route.limitation && <p>{route.limitation}</p>}
                    <p>
                      <strong>Next:</strong>{" "}
                      {route.nextActor === "caselink"
                        ? "CaseLink"
                        : route.nextActor === "parent"
                          ? "Your personal step"
                          : route.nextActor === "agency"
                            ? "Agency response"
                            : "Program response"}
                    </p>
                    {route.steps.length > 0 && (
                      <details className={styles.disclosure}>
                        <summary>See the planned steps</summary>
                        <div>
                          <ol>
                            {route.steps.map((step, index) => (
                              <li key={index} className={styles.small}>
                                {step}
                              </li>
                            ))}
                          </ol>
                        </div>
                      </details>
                    )}
                    {program && (
                      <a
                        className={`${styles.textLink} ${styles.small}`}
                        href={program.officialUrl}
                      >
                        Official program & direct access
                      </a>
                    )}
                  </article>
                );
              })
            ) : (
              <div className={styles.stack}>
                <p className={styles.subtle}>Your selected needs are saved:</p>
                <ul>
                  {request.intake.needs.map((need) => (
                    <li key={need}>{NEED_LABELS[need]}</li>
                  ))}
                </ul>
                <div className={styles.trustLine}>
                  <Clock width={21} height={21} aria-hidden="true" />
                  <p>
                    Preparation is pending. A saved request is not an
                    application or a confirmed appointment. You can use official
                    programs directly while you wait.
                  </p>
                </div>
              </div>
            )}
          </section>
          <section className={styles.surface}>
            <h2>Activity & receipts</h2>
            <p className={`${styles.subtle} ${styles.small}`}>
              Prepared, sent, received, approved and support actually received
              are different steps. We show only recorded evidence.
            </p>
            {request.events?.length ? (
              <ol className={`${styles.timeline} ${styles.space}`}>
                {request.events.map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>{event.summary}</strong>
                      <p>
                        {event.actor === "parent"
                          ? "Parent reported"
                          : event.actor === "operator"
                            ? "Operator confirmed"
                            : event.actor === "agency" ||
                                event.actor === "partner"
                              ? "Program update"
                              : "CaseLink activity"}
                      </p>
                      <time dateTime={event.created_at}>
                        {displayDate(event.created_at, true)}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={`${styles.hint} ${styles.space}`}>
                No additional activity recorded yet. We won’t mark a request
                sent or received without evidence.
              </p>
            )}
            <a
              className={`${styles.secondary} ${styles.space} ${styles.hidePrint}`}
              href={`/api/parent/requests/${requestId}/export`}
            >
              <Download width={18} height={18} aria-hidden="true" />
              Download current summary
            </a>
            <p className={`${styles.hint} ${styles.space}`}>
              Your download reflects the recorded state. Submitted packet
              versions and receipts are preserved when a permitted channel
              produces them.
            </p>
          </section>
          <SupportActivity request={request} onChange={reload} />
          <SupportDocuments
            requestId={requestId}
            documents={request.documents ?? []}
            inactive={inactive}
            onChange={reload}
          />
        </div>
        <aside className={styles.detailAside}>
          <section className={styles.surface}>
            <h2>Your details</h2>
            <dl className={styles.factList}>
              <dt>Household ZIP</dt>
              <dd>
                {request.intake.zip}
                <small>You provided</small>
              </dd>
              <dt>Household size</dt>
              <dd>{request.intake.householdSize ?? "Not provided"}</dd>
              <dt>Language preference</dt>
              <dd>
                {request.intake.language === "es" ? "Spanish" : "English"}
              </dd>
              <dt>Updates</dt>
              <dd>
                {request.intake.contactPreference === "email"
                  ? "Email & My support"
                  : "My support only"}
              </dd>
              {request.intake.incomeAmount !== null && (
                <>
                  <dt>Income before taxes</dt>
                  <dd>
                    ${request.intake.incomeAmount.toLocaleString("en-US")}
                    <small>
                      {request.intake.incomeFrequency.replaceAll("_", " ")} ·
                      You provided
                    </small>
                  </dd>
                </>
              )}
              {request.intake.shutoffDate && (
                <>
                  <dt>Reported shutoff date</dt>
                  <dd>{displayDate(request.intake.shutoffDate)}</dd>
                </>
              )}
            </dl>
            {!inactive && (
              <CorrectDetails request={request} onChange={reload} />
            )}
          </section>
          <section className={styles.surface}>
            <h2>Your permission</h2>
            <div className={`${styles.inline} ${styles.small}`}>
              <ShieldCheck width={22} height={22} aria-hidden="true" />
              <strong>
                {request.mandate.mode === "prepare_only"
                  ? "Research & preparation only"
                  : "Permitted actions within your limits"}
              </strong>
            </div>
            <p className={`${styles.hint} ${styles.space}`}>
              Expires {displayDate(request.mandate.expiresAt)} · Up to{" "}
              {request.mandate.maxAttempts} attempts ·{" "}
              {request.mandate.recipientIds.length} named program
              {request.mandate.recipientIds.length === 1 ? "" : "s"}
            </p>
            <ul className={styles.recipientList}>
              {request.mandate.recipientIds.map((id) => (
                <li key={id}>
                  {getProgram(id)?.name ?? "Named program unavailable"}
                </li>
              ))}
            </ul>
            <p className={`${styles.hint} ${styles.space}`}>
              No signatures, passwords, EBT PINs or binding financial
              commitments. Documents need their own processing consent.
            </p>
            {!inactive && (
              <PermissionEditor
                ref={permissionEditor}
                request={request}
                onChange={reload}
              />
            )}
            {!inactive && (
              <div
                className={`${styles.stack} ${styles.space} ${styles.hidePrint}`}
              >
                <button
                  className={styles.secondary}
                  disabled={pending}
                  onClick={() =>
                    changeState(
                      request.status === "paused" ? "resume" : "pause",
                    )
                  }
                >
                  {request.status === "paused" ? (
                    <Play width={18} height={18} aria-hidden="true" />
                  ) : (
                    <Pause width={18} height={18} aria-hidden="true" />
                  )}
                  {pending
                    ? "Updating…"
                    : request.status === "paused"
                      ? "Resume support"
                      : "Pause future work"}
                </button>
                {cancelConfirm ? (
                  <div className={styles.stack}>
                    <p className={styles.small}>
                      Cancel this request and stop future work? Already sent
                      information cannot always be recalled.
                    </p>
                    <button
                      className={styles.danger}
                      disabled={pending}
                      onClick={() => changeState("cancel")}
                    >
                      Yes, cancel this request
                    </button>
                    <button
                      className={styles.quiet}
                      disabled={pending}
                      onClick={() => setCancelConfirm(false)}
                    >
                      Keep this request
                    </button>
                  </div>
                ) : (
                  <button
                    className={styles.quiet}
                    onClick={() => setCancelConfirm(true)}
                  >
                    Cancel request & withdraw permission
                  </button>
                )}
              </div>
            )}
          </section>
          <div className={styles.trustLine}>
            <Lock width={22} height={22} aria-hidden="true" />
            <div>
              <strong>Need a person or another way?</strong>
              <Link className={styles.textLink} href="/support/help">
                Find help and direct program options.
              </Link>{" "}
              No program outcome is guaranteed.
            </div>
          </div>
        </aside>
      </div>
      <p className={`${styles.hint} ${styles.space}`}>
        Last recorded update: {displayDate(request.updated_at, true)}. This page
        refreshes while visible; work does not depend on keeping it open.
      </p>
    </div>
  );
}
