"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Lock,
  ShieldCheck,
} from "iconoir-react";
import { NEED_LABELS, intakeSchema } from "@/lib/parent/domain";
import type {
  ServiceMandate,
  ParentPreferences,
  SupportIntake,
  SupportNeed,
  SupportRequest,
  SupportAction,
} from "@/lib/parent/domain";
import { getProgramsForNeeds } from "@/lib/parent/programs";
import { parentApi } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import { UrgentHelp } from "./landing";
import styles from "./parent.module.css";

const foodNeeds: SupportNeed[] = [
  "food_now",
  "snap_new",
  "snap_renewal",
  "snap_pending",
  "snap_problem",
  "wic_new",
  "wic_continuing",
];
const utilityNeeds: SupportNeed[] = ["electricity", "gas", "water"];
export const initialIntake: SupportIntake = {
  needs: [],
  urgency: "soon",
  zip: "",
  language: "en",
  householdSize: null,
  childrenUnderFive: null,
  pregnantOrPostpartum: null,
  incomeAmount: null,
  incomeFrequency: "unknown",
  utilityProviders: [],
  shutoffDate: null,
  accountAuthority: "not_sure",
  contactPreference: "in_app",
  adultConfirmed: true,
};
function optionalBoolean(value: string): boolean | null {
  return value === "unknown" ? null : value === "yes";
}
function booleanValue(value: boolean | null): string {
  return value === null ? "unknown" : value ? "yes" : "no";
}

export function buildMandate(
  intake: SupportIntake,
  recipientIds: string[],
  mode: ServiceMandate["mode"],
  bookingPreference: ServiceMandate["bookingPreference"],
  expiresAt: string,
): ServiceMandate {
  return {
    version: 1,
    mode,
    recipientIds,
    allowedActions:
      mode === "prepare_only"
        ? ["research", "prepare"]
        : ["research", "prepare", "share", "submit", "schedule", "follow_up"],
    allowedData: [
      "household",
      "documents",
      ...(intake.needs.some((need) => need !== "food_now")
        ? ["income" as const]
        : []),
      ...(intake.needs.some((n) => utilityNeeds.includes(n))
        ? ["utility" as const]
        : []),
    ],
    expiresAt,
    maxAttempts: 12,
    maxRecipients: recipientIds.length,
    bookingPreference,
    accepted: true,
  };
}

export function ParentIntake({ initialNeed }: { initialNeed?: string }) {
  const session = useParentResource<{
    account: { email: string; preferences?: ParentPreferences };
  }>("/account");
  const preferencesApplied = useRef(false);
  const connections = useParentResource<{
    capabilities: {
      programId: string;
      enabled: boolean;
      actions: SupportAction[];
    }[];
  }>("/capabilities");
  const [intake, setIntake] = useState<SupportIntake>(() => ({
    ...initialIntake,
    needs:
      initialNeed === "food"
        ? ["food_now"]
        : initialNeed === "utilities"
          ? ["electricity"]
          : [],
  }));
  const [step, setStep] = useState(0);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [mode, setMode] = useState<ServiceMandate["mode"]>("full");
  const [booking, setBooking] =
    useState<ServiceMandate["bookingPreference"]>("ask_me");
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const startAttempt = useRef<{
    key: string;
    packet: { intake: SupportIntake; mandate: ServiceMandate };
  } | null>(null);
  const router = useRouter();
  const programs = getProgramsForNeeds(intake.needs);
  const hasUtility = intake.needs.some((n) => utilityNeeds.includes(n));
  const connected = (id: string) =>
    connections.data?.capabilities?.some(
      (connection) =>
        connection.programId === id &&
        connection.enabled &&
        connection.actions.some((action) =>
          ["share", "submit", "schedule", "follow_up"].includes(action),
        ),
    ) ?? false;
  const fullAvailable = programs.some(
    (p) => recipientIds.includes(p.id) && connected(p.id),
  );
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  useEffect(() => {
    if (session.data?.account.preferences && !preferencesApplied.current) {
      preferencesApplied.current = true;
      const preferences = session.data.account.preferences;
      setIntake((current) => ({
        ...current,
        language: preferences.language,
        contactPreference: preferences.contactPreference,
      }));
    }
  }, [session.data]);
  function change<K extends keyof SupportIntake>(
    key: K,
    value: SupportIntake[K],
  ) {
    setIntake((current) => ({ ...current, [key]: value }));
    setError(null);
    startAttempt.current = null;
  }
  function toggleNeed(need: SupportNeed) {
    const needs = intake.needs.includes(need)
      ? intake.needs.filter((n) => n !== need)
      : [...intake.needs, need];
    setIntake((current) => ({
      ...current,
      needs,
      ...(!needs.some((n) => n === "wic_new" || n === "wic_continuing")
        ? { pregnantOrPostpartum: null, childrenUnderFive: null }
        : {}),
    }));
    setError(null);
    startAttempt.current = null;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (step === 0) {
      if (!intake.needs.length) {
        setError(
          new Error(
            "Choose at least one kind of support so we can find relevant options.",
          ),
        );
        return;
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      const parsed = intakeSchema.safeParse(intake);
      if (!parsed.success) {
        setError(
          new Error(
            parsed.error.issues[0]?.message ??
              "Check your household information.",
          ),
        );
        return;
      }
      if (!adult) {
        setError(
          new Error(
            "Please confirm you are an adult requesting support for your household, or an authorized caregiver.",
          ),
        );
        return;
      }
      setRecipientIds(programs.map((p) => p.id));
      setStep(2);
      return;
    }
    if (!accepted || !recipientIds.length) {
      setError(
        new Error(
          "Select at least one named program and agree to the permission limits before starting.",
        ),
      );
      return;
    }
    setPending(true);
    try {
      if (!startAttempt.current) {
        const { authorization } = await parentApi<{
          authorization: { expiresAt: string };
        }>("/authorization-window");
        startAttempt.current = {
          key: crypto.randomUUID(),
          packet: {
            intake,
            mandate: buildMandate(
              intake,
              recipientIds,
              fullAvailable ? mode : "prepare_only",
              booking,
              authorization.expiresAt,
            ),
          },
        };
      }
      const response = await parentApi<{ request: SupportRequest }>(
        "/requests",
        {
          method: "POST",
          headers: { "Idempotency-Key": startAttempt.current.key },
          body: JSON.stringify(startAttempt.current.packet),
        },
      );
      router.push(`/support/${response.request.id}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err
          : new Error("We couldn’t save your request. Please try again."),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={`${styles.container} ${styles.narrow}`}>
      <div className={styles.pageTop}>
        <div>
          <h1>Let’s make the next steps easier.</h1>
          <p>
            Share what your family needs. You choose what we can handle, and you
            can change your mind.
          </p>
        </div>
      </div>
      {session.loading ? (
        <ParentLoading label="Checking secure access" />
      ) : session.error ? (
        <ServiceError
          error={session.error}
          retry={session.reload}
          returnTo={`/get-support${initialNeed ? `?need=${initialNeed}` : ""}`}
        />
      ) : (
        <>
          <ol className={styles.progress} aria-label="Support request steps">
            {["Your needs", "A few details", "Your permission"].map(
              (label, i) => (
                <li key={label} aria-current={i === step ? "step" : undefined}>
                  <span>
                    {i < step ? (
                      <Check width={14} height={14} aria-hidden="true" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  {label}
                </li>
              ),
            )}
          </ol>
          <section className={styles.surface}>
            <form className={styles.form} onSubmit={submit}>
              <div className={styles.formHeader}>
                <h2 ref={heading} tabIndex={-1}>
                  {
                    [
                      "What would help your household?",
                      "Just enough to find useful options",
                      "You’re in control of what happens next",
                    ][step]
                  }
                </h2>
                <p>
                  {
                    [
                      "Choose everything that applies. Food and utility support can move forward together.",
                      "Start with what you know. Optional details can help avoid questions later.",
                      "These are the specific programs and limits for this request. No unknown recipients or open-ended permission.",
                    ][step]
                  }
                </p>
              </div>
              {step === 0 && (
                <>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>Food & benefits</legend>
                    <div className={styles.choices}>
                      {foodNeeds.map((need) => (
                        <label className={styles.choice} key={need}>
                          <input
                            type="checkbox"
                            checked={intake.needs.includes(need)}
                            onChange={() => toggleNeed(need)}
                          />
                          <span>
                            <strong>{NEED_LABELS[need]}</strong>
                            {need === "food_now" && (
                              <small>Food today or in the next few days</small>
                            )}
                            {need === "snap_problem" && (
                              <small>
                                A notice, missing benefits or another routine
                                issue
                              </small>
                            )}
                            {need === "wic_new" && (
                              <small>
                                Pregnancy, postpartum or a child under five
                              </small>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>Utility bills</legend>
                    <div className={styles.choices}>
                      {utilityNeeds.map((need) => (
                        <label className={styles.choice} key={need}>
                          <input
                            type="checkbox"
                            checked={intake.needs.includes(need)}
                            onChange={() => toggleNeed(need)}
                          />
                          <strong>{NEED_LABELS[need]}</strong>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>
                      How soon do you need help?
                    </legend>
                    <div className={styles.choices}>
                      {(
                        [
                          {
                            value: "today",
                            label:
                              "Today — food is running out or service is off / at risk",
                          },
                          {
                            value: "soon",
                            label: "Soon — things are getting difficult",
                          },
                          { value: "planning", label: "I’m planning ahead" },
                        ] as const
                      ).map((item) => (
                        <label className={styles.choice} key={item.value}>
                          <input
                            type="radio"
                            name="urgency"
                            checked={intake.urgency === item.value}
                            onChange={() => change("urgency", item.value)}
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
              {step === 1 && (
                <>
                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label htmlFor="support-zip">Household ZIP code</label>
                      <input
                        className={styles.input}
                        id="support-zip"
                        inputMode="numeric"
                        autoComplete="postal-code"
                        maxLength={5}
                        pattern="[0-9]{5}"
                        required
                        value={intake.zip}
                        onChange={(e) => change("zip", e.target.value)}
                      />
                      <p className={styles.hint}>
                        Philadelphia is our first service area. We’ll explain
                        any coverage limits.
                      </p>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="support-language">
                        Preferred service language
                      </label>
                      <select
                        id="support-language"
                        className={styles.select}
                        value={intake.language}
                        onChange={(e) =>
                          change("language", e.target.value as "en" | "es")
                        }
                      >
                        <option value="en">English</option>
                        <option value="es">Spanish / Español</option>
                      </select>
                      {intake.language === "es" && (
                        <p className={styles.hint}>
                          We’ll record your Spanish preference. This
                          early-access interface is currently in English;
                          Spanish service availability depends on the program.
                        </p>
                      )}
                    </div>
                  </div>
                  {hasUtility && (
                    <fieldset className={styles.fieldset}>
                      <legend className={styles.legend}>
                        Your authority for all selected utility accounts
                      </legend>
                      <div className={styles.choices}>
                        {(
                          [
                            {
                              value: "self",
                              label: "I hold every selected utility account",
                            },
                            {
                              value: "authorized_caregiver",
                              label:
                                "I hold or have permission to act for every selected utility account",
                            },
                            {
                              value: "not_sure",
                              label: "I’m not sure what authority I need",
                            },
                          ] as const
                        ).map((item) => (
                          <label className={styles.choice} key={item.value}>
                            <input
                              type="radio"
                              name="authority"
                              checked={intake.accountAuthority === item.value}
                              onChange={() =>
                                change("accountAuthority", item.value)
                              }
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <details className={styles.disclosure}>
                    <summary>Add helpful household details (optional)</summary>
                    <div className={styles.stack}>
                      <div className={styles.field}>
                        <label htmlFor="household-size">
                          People in your household
                        </label>
                        <input
                          id="household-size"
                          className={styles.input}
                          type="number"
                          min={1}
                          max={30}
                          value={intake.householdSize ?? ""}
                          onChange={(e) =>
                            change(
                              "householdSize",
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        />
                        <p className={styles.hint}>
                          Leave blank if you’re not sure who a program will
                          count.
                        </p>
                      </div>
                      {intake.needs.some(
                        (need) =>
                          need === "wic_new" || need === "wic_continuing",
                      ) && (
                        <div className={styles.row}>
                          <div className={styles.field}>
                            <label htmlFor="children-under-five">
                              Any children under five?
                            </label>
                            <select
                              id="children-under-five"
                              className={styles.select}
                              value={booleanValue(intake.childrenUnderFive)}
                              onChange={(e) =>
                                change(
                                  "childrenUnderFive",
                                  optionalBoolean(e.target.value),
                                )
                              }
                            >
                              <option value="unknown">Not sure / skip</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </div>
                          <div className={styles.field}>
                            <label htmlFor="pregnancy">
                              Pregnant or postpartum?
                            </label>
                            <select
                              id="pregnancy"
                              className={styles.select}
                              value={booleanValue(intake.pregnantOrPostpartum)}
                              onChange={(e) =>
                                change(
                                  "pregnantOrPostpartum",
                                  optionalBoolean(e.target.value),
                                )
                              }
                            >
                              <option value="unknown">Not sure / skip</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </div>
                        </div>
                      )}
                      <div className={styles.row}>
                        <div className={styles.field}>
                          <label htmlFor="income-amount">
                            Household income before taxes ($)
                          </label>
                          <input
                            className={styles.input}
                            id="income-amount"
                            type="number"
                            min={0}
                            max={1000000}
                            step="0.01"
                            value={intake.incomeAmount ?? ""}
                            onChange={(e) =>
                              change(
                                "incomeAmount",
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                          />
                          <p className={styles.hint}>
                            Zero income is okay. Leave blank if variable or
                            unknown.
                          </p>
                        </div>
                        <div className={styles.field}>
                          <label htmlFor="income-frequency">
                            How often is that amount received?
                          </label>
                          <select
                            id="income-frequency"
                            className={styles.select}
                            value={intake.incomeFrequency}
                            onChange={(e) =>
                              change(
                                "incomeFrequency",
                                e.target
                                  .value as SupportIntake["incomeFrequency"],
                              )
                            }
                          >
                            <option value="unknown">Not sure / skip</option>
                            <option value="weekly">Weekly</option>
                            <option value="biweekly">Every two weeks</option>
                            <option value="twice_monthly">Twice a month</option>
                            <option value="monthly">Monthly</option>
                            <option value="yearly">Yearly</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </details>
                  {hasUtility && (
                    <details className={styles.disclosure}>
                      <summary>Add utility information (optional)</summary>
                      <div className={styles.stack}>
                        <fieldset className={styles.fieldset}>
                          <legend className={styles.legend}>
                            Which providers are on the bills?
                          </legend>
                          <div className={styles.choices}>
                            {(
                              [
                                { value: "peco", label: "PECO" },
                                {
                                  value: "pgw",
                                  label: "Philadelphia Gas Works (PGW)",
                                },
                                { value: "pwd", label: "Philadelphia Water" },
                                { value: "other", label: "Another provider" },
                                { value: "unknown", label: "I’m not sure" },
                              ] as const
                            ).map((provider) => (
                              <label
                                className={styles.checkbox}
                                key={provider.value}
                              >
                                <input
                                  type="checkbox"
                                  checked={intake.utilityProviders.includes(
                                    provider.value,
                                  )}
                                  onChange={() =>
                                    change(
                                      "utilityProviders",
                                      intake.utilityProviders.includes(
                                        provider.value,
                                      )
                                        ? intake.utilityProviders.filter(
                                            (v) => v !== provider.value,
                                          )
                                        : [
                                            ...intake.utilityProviders,
                                            provider.value,
                                          ],
                                    )
                                  }
                                />
                                {provider.label}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        {intake.needs.filter((need) =>
                          utilityNeeds.includes(need),
                        ).length === 1 && (
                          <div className={styles.field}>
                            <label htmlFor="shutoff-date">
                              Shutoff date on a notice, if known
                            </label>
                            <input
                              id="shutoff-date"
                              className={styles.input}
                              type="date"
                              value={intake.shutoffDate ?? ""}
                              onChange={(e) =>
                                change("shutoffDate", e.target.value || null)
                              }
                            />
                            <p className={styles.hint}>
                              Use the shutoff date, rather than the bill’s
                              payment due date. Leave blank if uncertain.
                            </p>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                  <div className={styles.field}>
                    <label htmlFor="contact-preference">
                      How would you like support updates?
                    </label>
                    <select
                      id="contact-preference"
                      className={styles.select}
                      value={intake.contactPreference}
                      onChange={(e) =>
                        change(
                          "contactPreference",
                          e.target.value as SupportIntake["contactPreference"],
                        )
                      }
                    >
                      <option value="in_app">Only in My support</option>
                      <option value="email">Email and My support</option>
                    </select>
                    <p className={styles.hint}>
                      Email availability is confirmed before it’s used.
                      Sensitive details stay in your account.
                    </p>
                  </div>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={adult}
                      onChange={(e) => setAdult(e.target.checked)}
                      required
                    />
                    <span>
                      I’m 18 or older and requesting support for my household or
                      as an authorized caregiver.
                    </span>
                  </label>
                </>
              )}
              {step === 2 && (
                <>
                  <div className={styles.notice}>
                    <ShieldCheck width={23} height={23} aria-hidden="true" />
                    <p>
                      <strong>
                        {fullAvailable
                          ? "Supported work, within your limits."
                          : "Preparation is available; external actions are not connected yet."}
                      </strong>{" "}
                      {fullAvailable
                        ? "Only programs with a verified permitted channel can receive information or carry out applications."
                        : "This authorization lets us research and prepare. It does not send anything, book appointments or submit applications."}
                    </p>
                  </div>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>
                      Named programs for this request
                    </legend>
                    <div className={styles.choices}>
                      {programs.map((program) => (
                        <label className={styles.choice} key={program.id}>
                          <input
                            type="checkbox"
                            checked={recipientIds.includes(program.id)}
                            onChange={() => {
                              setRecipientIds((current) =>
                                current.includes(program.id)
                                  ? current.filter((id) => id !== program.id)
                                  : [...current, program.id],
                              );
                              setAccepted(false);
                              startAttempt.current = null;
                            }}
                          />
                          <span>
                            <strong>{program.name}</strong>
                            <small>{program.description}</small>
                            <small>
                              {connected(program.id)
                                ? "Verified execution channel available"
                                : "Research and preparation only — no external sharing"}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {fullAvailable && (
                    <fieldset className={styles.fieldset}>
                      <legend className={styles.legend}>
                        What can CaseLink handle?
                      </legend>
                      <div className={styles.choices}>
                        <label className={styles.choice}>
                          <input
                            name="mode"
                            type="radio"
                            checked={mode === "full"}
                            onChange={() => {
                              setMode("full");
                              setAccepted(false);
                              startAttempt.current = null;
                            }}
                          />
                          <span>
                            <strong>
                              Prepare and carry out permitted steps
                            </strong>
                            <small>
                              Share allowed information, submit supported
                              applications, coordinate appointments and follow
                              up. Required personal acts remain yours.
                            </small>
                          </span>
                        </label>
                        <label className={styles.choice}>
                          <input
                            name="mode"
                            type="radio"
                            checked={mode === "prepare_only"}
                            onChange={() => {
                              setMode("prepare_only");
                              setAccepted(false);
                              startAttempt.current = null;
                            }}
                          />
                          <span>
                            <strong>Prepare only</strong>
                            <small>
                              Research and prepare without sharing information
                              or submitting anything.
                            </small>
                          </span>
                        </label>
                      </div>
                    </fieldset>
                  )}
                  <div className={styles.mandateList}>
                    <div className={styles.mandateItem}>
                      <Lock width={22} height={22} aria-hidden="true" />
                      <div>
                        <h3>The information we can use</h3>
                        <p>
                          Your needs, household details
                          {intake.needs.some((need) => need !== "food_now")
                            ? ", income information when a named program requires it"
                            : ""}
                          {hasUtility ? " and utility information" : ""}, only
                          for this request. Any bills or notices you later
                          choose to add can be used for this request and these
                          named programs, after separate document-processing
                          consent. No passwords, EBT PINs or signatures.
                        </p>
                      </div>
                    </div>
                    <div className={styles.mandateItem}>
                      <Clock width={22} height={22} aria-hidden="true" />
                      <div>
                        <h3>Up to 30 days · up to 12 attempts</h3>
                        <p>
                          Limited to the {recipientIds.length || "selected"}{" "}
                          named program{recipientIds.length === 1 ? "" : "s"}.
                          We stop future work if you pause, cancel or withdraw
                          permission. Already delivered information may not be
                          recallable.
                        </p>
                      </div>
                    </div>
                    <div className={styles.mandateItem}>
                      <Check width={22} height={22} aria-hidden="true" />
                      <div>
                        <h3>Your personal decisions stay yours</h3>
                        <p>
                          No signing as you, accepting payment plans, paying
                          fees or making binding commitments. A program decides
                          eligibility and available assistance.
                        </p>
                      </div>
                    </div>
                  </div>
                  {mode === "full" && fullAvailable && (
                    <div className={styles.field}>
                      <label htmlFor="booking-preference">
                        Appointment preference
                      </label>
                      <select
                        id="booking-preference"
                        className={styles.select}
                        value={booking}
                        onChange={(e) => {
                          setBooking(
                            e.target
                              .value as ServiceMandate["bookingPreference"],
                          );
                          setAccepted(false);
                          startAttempt.current = null;
                        }}
                      >
                        <option value="ask_me">Ask me before booking</option>
                        <option value="weekday_morning">
                          Weekday mornings
                        </option>
                        <option value="weekday_afternoon">
                          Weekday afternoons
                        </option>
                        <option value="any_weekday">Any weekday</option>
                      </select>
                      <p className={styles.hint}>
                        This does not authorize fees or financial commitments.
                      </p>
                    </div>
                  )}
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      required
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                    />
                    <span>
                      I authorize{" "}
                      {mode === "full" && fullAvailable
                        ? "the permitted steps described above"
                        : "research and preparation only"}{" "}
                      for this request within these limits. I can stop future
                      work in My support.
                    </span>
                  </label>
                  <p className={styles.hint}>
                    We continue authorized work when you close the page or sign
                    out. Your{" "}
                    <Link className={styles.textLink} href="/support/privacy">
                      privacy and control options
                    </Link>{" "}
                    are always available.
                  </p>
                </>
              )}
              {error && <ServiceError error={error} />}
              <div className={styles.formFooter}>
                {step > 0 ? (
                  <button
                    type="button"
                    className={styles.quiet}
                    onClick={() => {
                      setStep((current) => current - 1);
                      setError(null);
                      setAccepted(false);
                      startAttempt.current = null;
                    }}
                    disabled={pending}
                  >
                    <ArrowLeft width={17} height={17} aria-hidden="true" />
                    Back
                  </button>
                ) : (
                  <span className={styles.hint}>
                    You can choose more than one.
                  </span>
                )}
                <button
                  className={styles.button}
                  type="submit"
                  disabled={pending}
                >
                  {pending
                    ? "Saving your request…"
                    : step === 2
                      ? "Start getting support"
                      : "Continue"}
                  <ArrowRight width={18} height={18} aria-hidden="true" />
                </button>
              </div>
            </form>
          </section>
        </>
      )}
      <div className={styles.section}>
        <UrgentHelp />
      </div>
    </div>
  );
}
