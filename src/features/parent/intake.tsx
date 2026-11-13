"use client";
import Link from "next/link";
import { z } from "zod";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { NEED_LABELS, intakeSchema, reusableZipSchema, type ReusedZipSource } from "@/lib/parent/domain";
import type {
  ServiceMandate,
  ParentPreferences,
  SupportIntake,
  StoredSupportIntake,
  SupportNeed,
  SupportAction,
} from "@/lib/parent/domain";
import { getProgramsForNeeds, SNAP_NEW_APPLICATION_URL, supportsInitialServiceDelivery } from "@/lib/parent/programs";
import { boundedParentApi, canCollectSnapApplication, canCollectWicApplication, canCollectPecoApplication, ParentApiError, type ParentAuthorizationWindow } from "./api";
import { SNAP_APPLICATION_NOTICE_VERSION, WIC_APPLICATION_NOTICE_VERSION, WIC_SUBJECT_AUTHORITY_STATEMENT } from "@/lib/parent/constants";
import { wicApplicationFieldsValueSchema, type WicApplicationFields } from "@/lib/parent/wic-application-fields";
import { PECO_APPLICATION_NOTICE_VERSION, PECO_ACCOUNT_AUTHORITY_STATEMENT, PECO_SUBJECT_AUTHORITY_STATEMENT, pecoApplicationFieldsValueSchema, type PecoApplicationFields } from "@/lib/parent/peco-application-fields";
import { assessSnapApplicationFields, snapApplicationFieldsSchema, type SnapApplicationFields } from "@/lib/parent/snap-application-fields";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import { UrgentHelp } from "./landing";
import { FoodServices } from "./food-services";
import { SnapApplicationFormFields } from "./snap-application-form";
import { SnapApplicationNotice } from "./snap-application-review";
import { WicApplicationNotice, WicApplicationFormFields } from "./wic-application-form";
import { PecoApplicationNotice, PecoApplicationFormFields, PECO_HELP_URL } from "./peco-application-form";
import { usePermissionWindow } from "./use-permission-window";
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
const utilityProviderChoices = [
  { id: "peco", need: "electricity", label: "PECO" }, { id: "pgw", need: "gas", label: "PGW" },
  { id: "pwd", need: "water", label: "Philadelphia Water" }, { id: "other", need: null, label: "Another provider" },
  { id: "unknown", need: null, label: "Not sure" },
] as const;
const incomeNeeds: SupportNeed[] = ["snap_new", "snap_renewal", "snap_pending", "snap_problem", ...utilityNeeds];
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
const authorizationReply=z.object({authorization:z.object({issuedAt:z.iso.datetime({offset:true}),expiresAt:z.iso.datetime({offset:true}),snapApplication:z.object({collectionEnabled:z.boolean(),noticeVersion:z.string().nullable()}).optional(),wicApplication:z.object({collectionEnabled:z.boolean(),noticeVersion:z.string().nullable(),expiresAt:z.string().nullable()}).optional(),pecoApplication:z.object({collectionEnabled:z.boolean(),noticeVersion:z.string().nullable(),expiresAt:z.string().nullable()}).optional()})});

async function readAuthorizationWindow(signal: AbortSignal) {
  const result = authorizationReply.parse(await boundedParentApi("/authorization-window", {}, signal, new Date(Date.now() + 30_000).toISOString()));
  if (Date.parse(result.authorization.expiresAt) <= Date.now()) throw new Error("Authorization timing is unavailable. Try again before starting.");
  return result;
}

export function buildMandate(
  intake: StoredSupportIntake,
  recipientIds: string[],
  mode: ServiceMandate["mode"],
  bookingPreference: ServiceMandate["bookingPreference"],
  expiresAt: string,
  privatePecoPreparation = false,
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
      ...(privatePecoPreparation || intake.needs.every(need => need === "wic_new" || need === "wic_continuing") ? [] : ["documents" as const]),
      ...(intake.needs.some((need) => incomeNeeds.includes(need))
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
  return initialNeed === "food" ? (
    <FoodServices />
  ) : (
    <ParentIntakeForm key={initialNeed ?? "all"} initialNeed={initialNeed} />
  );
}

function ParentIntakeForm({ initialNeed }: { initialNeed?: string }) {
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
  const authorization = useParentResource<ParentAuthorizationWindow>("/authorization-window");
  const zipDefaultConsumed = useRef(false);
  const [reusedZip, setReusedZip] = useState<z.infer<typeof reusableZipSchema> | null>(null);
  const [intake, setIntake] = useState<SupportIntake>(() => ({
    ...initialIntake,
    needs: [...foodNeeds, ...utilityNeeds].includes(initialNeed as SupportNeed)
      ? [initialNeed as SupportNeed]
      : [],
    ...(initialNeed === "wic_new" ? { accountAuthority: "self" as const } : {}),
  }));
  const [step, setStep] = useState(() => intake.needs.length ? 1 : 0);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [mode, setMode] = useState<ServiceMandate["mode"]>("full");
  const [booking, setBooking] =
    useState<ServiceMandate["bookingPreference"]>("ask_me");
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [pendingWork, setPendingWork] = useState<{ scope: string; controller: AbortController } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [snapDetails, setSnapDetails] = useState<SnapApplicationFields>({});
  const [detailsReady, setDetailsReady] = useState(false);
  const [startUncertain, setStartUncertain] = useState(false);
  const [collectionBlocked, setCollectionBlocked] = useState(false);
  const [wicDetails, setWicDetails] = useState<WicApplicationFields>({});
  const [wicDetailsReady, setWicDetailsReady] = useState(false);
  const [wicBlocked, setWicBlocked] = useState(false);
  const [pecoPreparation, setPecoPreparation] = useState(false);
  const [pecoDetails, setPecoDetails] = useState<PecoApplicationFields>({});
  const [pecoDetailsReady, setPecoDetailsReady] = useState(false);
  const [pecoBlocked, setPecoBlocked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const startAttempt = useRef<{
    key: string;
    packet: { intake: SupportIntake; mandate: ServiceMandate; kind?: "snap_application" | "wic_application" | "peco_application"; details?: SnapApplicationFields | WicApplicationFields | PecoApplicationFields; noticeVersion?: typeof SNAP_APPLICATION_NOTICE_VERSION | typeof WIC_APPLICATION_NOTICE_VERSION | typeof PECO_APPLICATION_NOTICE_VERSION; subjectAuthorityDeclared?: true; accountAuthorityDeclared?: true; reusedZip?: ReusedZipSource };
  } | null>(null);
  const work=useRef<AbortController|null>(null),running=useRef<AbortController|null>(null);
  const scope=JSON.stringify({intake,snapDetails,detailsReady,wicDetails,wicDetailsReady,pecoPreparation,pecoDetails,pecoDetailsReady,recipientIds,mode,booking,accepted,reusedZip});
  const pending = pendingWork?.scope === scope && !pendingWork.controller.signal.aborted;
  useLayoutEffect(()=>{
    const controller=new AbortController();work.current=controller;
    return()=>{controller.abort();if(work.current===controller)work.current=null;};
  },[scope]);
  const router = useRouter();
  const snapSelected = intake.needs.includes("snap_new");
  useEffect(() => {
    if (snapSelected || zipDefaultConsumed.current) return;
    const controller = new AbortController();
    boundedParentApi("/intake-defaults", {}, controller.signal, new Date(Date.now() + 30_000).toISOString())
      .then(value => {
        if (controller.signal.aborted || zipDefaultConsumed.current) return;
        const parsed = z.object({ zip: reusableZipSchema.nullable() }).safeParse(value);
        const saved = parsed.success ? parsed.data.zip : null;
        if (!saved || Date.parse(saved.expiresAt) <= Date.now() || Date.parse(saved.confirmedAt) > Date.now()) return;
        zipDefaultConsumed.current = true;
        setIntake(current => current.zip ? current : { ...current, zip: saved.value });
        setReusedZip(saved);
      })
      .catch(() => { /* Saved defaults are optional; manual entry remains available. */ });
    return () => controller.abort();
  }, [snapSelected]);
  const directSnap = initialNeed === "snap_new" && step > 0 && snapSelected && intake.needs.length === 1;
  const fullSnap = snapSelected && canCollectSnapApplication(authorization.data) && !authorization.error && !collectionBlocked;
  const wicOnly = intake.needs.length === 1 && intake.needs[0] === "wic_new";
  const wicNeedsOnly = intake.needs.every(need => need === "wic_new" || need === "wic_continuing");
  const wicWindowCurrent = usePermissionWindow(Date.parse(authorization.data?.authorization?.wicApplication?.expiresAt ?? ""));
  const fullWic = wicOnly && wicWindowCurrent && canCollectWicApplication(authorization.data) && !authorization.error && !wicBlocked;
  const selectedUtilities = intake.needs.filter(need => utilityNeeds.includes(need));
  const pecoOnly = intake.needs.length === 1 && intake.needs[0] === "electricity" && intake.utilityProviders.length === 1 && intake.utilityProviders[0] === "peco";
  const pecoWindowCurrent = usePermissionWindow(Date.parse(authorization.data?.authorization?.pecoApplication?.expiresAt ?? ""));
  const fullPeco = pecoPreparation && pecoOnly && intake.accountAuthority !== "not_sure" && pecoWindowCurrent && canCollectPecoApplication(authorization.data) && !authorization.error && !pecoBlocked;
  const snapValues={...(intake.zip?{zip:intake.zip}:{}),...snapDetails};
  const programs = getProgramsForNeeds(intake.needs).filter(program=>(!fullSnap||program.id==='snap-pa'||
    program.needs.some(need=>need!=='snap_new'&&intake.needs.includes(need))) && (!fullWic || program.id === "wic-pa") && (!pecoPreparation || program.id === "peco-cap"));
  const hasBenefits = intake.needs.some((need) =>
    [
      "snap_new",
      "snap_renewal",
      "snap_pending",
      "snap_problem",
    ].includes(need),
  );
  const connected = (id: string) =>
    connections.data?.capabilities?.some(
      (connection) =>
        connection.programId === id &&
        connection.enabled &&
        connection.actions.some((action) =>
          ["share", "submit", "schedule"].includes(action) && programs.some(program=>program.id===id &&
            program.needs.some(need=>intake.needs.includes(need)&&supportsInitialServiceDelivery(need,action))),
        ),
    ) ?? false;
  const fullAvailable = !pecoPreparation && programs.some(
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
    if (key === "zip") { zipDefaultConsumed.current = true; setReusedZip(null); }
    if (key === "utilityProviders") { setPecoPreparation(false); setPecoDetails({}); setPecoDetailsReady(false); setAccepted(false); }
    if (key === "accountAuthority") { setPecoDetailsReady(false); setAccepted(false); }
    setIntake((current) => ({ ...current, [key]: value }));
    setError(null);
    startAttempt.current = null;
  }
  function toggleNeed(need: SupportNeed) {
    const needs = intake.needs.includes(need)
      ? intake.needs.filter((n) => n !== need)
      : [...intake.needs, need];
    const utilityContextChanged = utilityNeeds.some(item => intake.needs.includes(item) !== needs.includes(item));
    setIntake((current) => ({
      ...current,
      needs,
      pregnantOrPostpartum: null, childrenUnderFive: null,
      ...(!needs.some(n => incomeNeeds.includes(n)) ? { householdSize: null, incomeAmount: null, incomeFrequency: "unknown" as const } : {}),
      ...(!needs.some(n => utilityNeeds.includes(n)) ? { utilityProviders: [], shutoffDate: null, accountAuthority: "self" as const }
        : utilityContextChanged ? { accountAuthority: "not_sure" as const, shutoffDate: null } : {}),
    }));
    setError(null);
    if (!needs.includes("snap_new")) { setSnapDetails({}); setDetailsReady(false); }
    setWicDetails({}); setWicDetailsReady(false); setAccepted(false);
    setPecoPreparation(false); setPecoDetails({}); setPecoDetailsReady(false);
    startAttempt.current = null;
  }
  function changeWicDetails(details: WicApplicationFields) {
    setWicDetails(details); setWicDetailsReady(false); setAccepted(false); setError(null); startAttempt.current = null;
  }
  function changePecoDetails(details: PecoApplicationFields) {
    setPecoDetails(details); setPecoDetailsReady(false); setAccepted(false); setError(null); startAttempt.current = null;
  }
  async function refreshPecoCollection() {
    const controller = work.current;
    if (!controller || controller.signal.aborted || running.current === controller) return;
    running.current = controller; setPendingWork({ scope, controller }); setError(null);
    try {
      const latest = await readAuthorizationWindow(controller.signal);
      if (controller.signal.aborted || work.current !== controller) return;
      setPecoBlocked(!canCollectPecoApplication(latest)); authorization.reload();
    } catch (failure) {
      if (!controller.signal.aborted && work.current === controller) { setPecoBlocked(true); setError(failure instanceof Error ? failure : new Error("PECO preparation access could not be checked. Your draft remains on this page.")); }
    } finally { if (running.current === controller) running.current = null; if (!controller.signal.aborted && work.current === controller) setPendingWork(null); }
  }
  async function refreshWicCollection() {
    const controller = work.current;
    if (!controller || controller.signal.aborted || running.current === controller) return;
    running.current = controller; setPendingWork({ scope, controller }); setError(null);
    try {
      const latest = await readAuthorizationWindow(controller.signal);
      if (controller.signal.aborted || work.current !== controller) return;
      setWicBlocked(!canCollectWicApplication(latest)); authorization.reload();
    } catch (failure) {
      if (!controller.signal.aborted && work.current === controller) { setWicBlocked(true); setError(failure instanceof Error ? failure : new Error("WIC availability could not be checked. Your draft remains on this page.")); }
    } finally { if (running.current === controller) running.current = null; if (!controller.signal.aborted && work.current === controller) setPendingWork(null); }
  }
  function changeSnapDetails(details: SnapApplicationFields) {
    zipDefaultConsumed.current = true; setReusedZip(null);
    setSnapDetails(details);setDetailsReady(false);setAccepted(false);setError(null);startAttempt.current=null;
    setIntake(current=>({...current,zip:details.zip??"",householdSize:details.household?.length??null,
      ...(details.language==='en'||details.language==='es'?{language:details.language}:{}),
      incomeAmount:null,incomeFrequency:"unknown",
    }));
  }
  async function refreshSnapCollection() {
    const controller=work.current;
    if(!controller||controller.signal.aborted||running.current===controller)return;
    running.current=controller;
    setPendingWork({ scope, controller });setError(null);
    try {
      const latest=await readAuthorizationWindow(controller.signal);
      if(controller.signal.aborted||work.current!==controller)return;
      setCollectionBlocked(!canCollectSnapApplication(latest));authorization.reload();
    } catch(err) {if(!controller.signal.aborted&&work.current===controller){setCollectionBlocked(true);setError(err instanceof Error?err:new Error("Application availability could not be checked."));}}
    finally {if(running.current===controller)running.current=null;if(!controller.signal.aborted&&work.current===controller)setPendingWork(null);}
  }
  function validatedSnapDetails() {
    const parsed=snapApplicationFieldsSchema(new Date()).safeParse(snapValues);
    if (!parsed.success) throw new Error("Check your SNAP application answers. Use only the requested information; identifiers, credentials and signatures belong in the protected official-program step.");
    const assessment=assessSnapApplicationFields(parsed.data,new Date());
    if (!assessment.nonProtectedDataReadyForReview) {
      const group=assessment.missingFields[0]?.split('.')[0];
      const label=({applicant:"your name",county:"your county",language:"language preferences",otherLanguage:"language preferences",interpreter:"interpreter preferences",interpreterLanguage:"interpreter preferences",household:"everyone in your home",income:"this month’s income",screening:"the expedited-service questions",history:"the application history questions",expenses:"applicable expenses",expenseClaims:"expense deductions",authorizedRepresentative:"your chosen representative"} as Record<string,string>)[group??""];
      throw new Error(assessment.serviceQuestions.includes("address_or_provider_accepted_alternative")
        ? "Add a usable postal address for this application. If you do not have a permanent address, CaseLink needs to verify an accepted mailing alternative; official application help remains available without completing these fields."
        : label ? `Complete the applicable answers for ${label}. Unknown answers stay blank; they are not treated as No or zero.`
        : "The application’s date-sensitive answers or form source need checking before complete preparation. Your answers remain on this page and official program access stays available.");
    }
    return parsed.data;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(pending)return;
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
      if ((snapSelected || wicOnly || pecoPreparation) && authorization.loading) return;
      if (pecoPreparation && !fullPeco) {
        setError(new Error("Private PECO CAP preparation is unavailable or account authority is unresolved. Your draft remains on this page; check access and account authority or use official PECO help.")); return;
      }
      if (fullPeco && !pecoApplicationFieldsValueSchema.safeParse(pecoDetails).success) {
        setError(new Error("Check the PECO account, names, dates, service address, phone numbers and income source lists. Unknown answers can stay blank.")); return;
      }
      if (wicOnly && Object.keys(wicDetails).length && !fullWic) {
        setError(new Error("Private WIC collection is unavailable. Your answers remain on this page; check access again or use official WIC help.")); return;
      }
      if (fullWic && !wicApplicationFieldsValueSchema.safeParse(wicDetails).success) {
        setError(new Error("Check the WIC names, dates, address and contact answers. Unknown answers may stay blank; use only the requested information.")); return;
      }
      if (fullSnap) {
        try {validatedSnapDetails();} catch (err) {setError(err instanceof Error?err:new Error("Check your SNAP application answers."));heading.current?.focus();return;}
      }
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
      setDetailsReady(fullSnap);
      setWicDetailsReady(fullWic);
      setPecoDetailsReady(fullPeco);
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
    if (fullSnap && !detailsReady && !startAttempt.current) {
      setStep(1);setAccepted(false);
      setError(new Error("Private SNAP application preparation is now available. Complete its applicable questions before authorizing this application."));
      return;
    }
    if (fullWic && !wicDetailsReady && !startAttempt.current) {
      setStep(1); setAccepted(false); setError(new Error("Private WIC preparation is now available. Read its notice and provide any known answers before authorizing this request.")); return;
    }
    if (pecoPreparation && !pecoDetailsReady && !startAttempt.current) {
      setStep(1); setAccepted(false); setError(new Error("Read the PECO notice and provide known preparation answers before authorizing this request.")); return;
    }
    const controller=work.current;
    if(!controller||controller.signal.aborted||running.current===controller)return;
    running.current=controller;setPendingWork({ scope, controller });
    let creationAttempted = false;
    let refreshedZip: z.infer<typeof reusableZipSchema> | null = null;
    try {
      const retryingWic = startAttempt.current?.packet.kind === "wic_application";
      const retryingPeco = startAttempt.current?.packet.kind === "peco_application";
      if (!startAttempt.current) {
        const window = await readAuthorizationWindow(controller.signal);
        if(controller.signal.aborted||work.current!==controller)return;
        if (snapSelected && !detailsReady && canCollectSnapApplication(window)) {
          setCollectionBlocked(false);authorization.reload();setStep(1);setAccepted(false);
          setError(new Error("Private SNAP application preparation is now available. Complete its applicable questions before authorizing this application."));
          return;
        }
        if (detailsReady && (!fullSnap || !canCollectSnapApplication(window))) {
          setCollectionBlocked(true);
          authorization.reload();
          throw new Error("Private SNAP application collection is currently unavailable. Your answers remain on this page; nothing new has been saved. Official program help remains available.");
        }
        if (wicOnly && !wicDetailsReady && canCollectWicApplication(window)) {
          setWicBlocked(false); authorization.reload(); setStep(1); setAccepted(false);
          setError(new Error("Private WIC preparation is now available. Read its notice and provide any known answers before authorizing this request.")); return;
        }
        if (wicDetailsReady && (!fullWic || !canCollectWicApplication(window))) {
          setWicBlocked(true); authorization.reload();
          throw new Error("Private WIC collection is unavailable. Your answers remain on this page; nothing new has been saved.");
        }
        if (pecoDetailsReady && (!fullPeco || !canCollectPecoApplication(window))) {
          setPecoBlocked(true); authorization.reload();
          throw new Error("Private PECO CAP collection is unavailable. Your answers remain on this page; nothing new has been saved.");
        }
        const peco = pecoDetailsReady ? pecoApplicationFieldsValueSchema.parse(pecoDetails) : undefined;
        if (peco && (recipientIds.length !== 1 || recipientIds[0] !== "peco-cap")) throw new Error("Private PECO CAP answers can be saved only for the named PECO program.");
        const wic = wicDetailsReady ? wicApplicationFieldsValueSchema.parse(wicDetails) : undefined;
        if (wic && !recipientIds.includes("wic-pa")) throw new Error("Private WIC answers can be saved only for the named Pennsylvania WIC program.");
        const details=detailsReady?validatedSnapDetails():undefined;
        if (details && !recipientIds.includes("snap-pa")) throw new Error("SNAP application answers can be saved only for the named Pennsylvania SNAP program. Choose that program or return to change your support needs.");
        startAttempt.current = {
          key: crypto.randomUUID(),
          packet: {
            intake,
            mandate: buildMandate(
              intake,
              recipientIds,
              fullAvailable ? mode : "prepare_only",
              booking,
              window.authorization.expiresAt,
              !!peco,
            ),
            ...(details?{kind:"snap_application" as const,details,noticeVersion:SNAP_APPLICATION_NOTICE_VERSION}:{}),
            ...(wic ? { kind: "wic_application" as const, details: wic, noticeVersion: WIC_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true as const } : {}),
            ...(peco ? { kind: "peco_application" as const, details: peco, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true as const, accountAuthorityDeclared: true as const } : {}),
            ...(!details && reusedZip ? { reusedZip: { sourceRequestId: reusedZip.sourceRequestId, sourceVersion: reusedZip.sourceVersion } } : {}),
          },
        };
      }
      if (retryingWic) {
        const currentWindow = await readAuthorizationWindow(controller.signal);
        if (controller.signal.aborted || work.current !== controller) return;
        if (!canCollectWicApplication(currentWindow)) {
          setWicBlocked(true); authorization.reload();
          throw new Error("Private WIC access is unavailable. Your exact saved attempt and draft are kept; check access again before retrying it.");
        }
      }
      if (retryingPeco) {
        const currentWindow = await readAuthorizationWindow(controller.signal);
        if (controller.signal.aborted || work.current !== controller) return;
        if (!canCollectPecoApplication(currentWindow)) {
          setPecoBlocked(true); authorization.reload();
          throw new Error("Private PECO access is unavailable. Your exact saved attempt and draft are kept; check access again before retrying it.");
        }
      }
      let response: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          creationAttempted = true;
          response = await boundedParentApi("/requests", {
            method: "POST",
            headers: { "Idempotency-Key": startAttempt.current.key },
            body: JSON.stringify(startAttempt.current.packet),
          }, controller.signal, startAttempt.current.packet.mandate.expiresAt);
          break;
        } catch (failure) {
          if (!(failure instanceof ParentApiError) || failure.status !== 412 || !startAttempt.current.packet.reusedZip) throw failure;
          creationAttempted = false;
          // This specific response proves no request was created; refresh once within the same mandate/key.
          const latest = z.object({ zip: reusableZipSchema.nullable() }).parse(await boundedParentApi("/intake-defaults", {}, controller.signal, startAttempt.current.packet.mandate.expiresAt));
          if (!latest.zip) {
            zipDefaultConsumed.current = true;
            refreshedZip = null;
            startAttempt.current = null; setStartUncertain(false); setReusedZip(null);
            setIntake(current => ({ ...current, zip: "" })); setStep(1);
            throw new ParentApiError("A current household ZIP code is needed. Your other answers are kept.", 412);
          }
          if (attempt === 1) throw new ParentApiError("Saved routing information is still changing. Your answers are kept; try starting again shortly.", 412);
          refreshedZip = latest.zip;
          startAttempt.current.packet = { ...startAttempt.current.packet,
            intake: { ...startAttempt.current.packet.intake, zip: latest.zip.value },
            reusedZip: { sourceRequestId: latest.zip.sourceRequestId, sourceVersion: latest.zip.sourceVersion },
          };
        }
      }
      if(controller.signal.aborted||work.current!==controller)return;
      const saved=z.object({request:z.object({id:z.uuid()})}).safeParse(response);
      if (!saved.success) throw new ParentApiError("The saved request could not be confirmed. Retry the same request before making changes.",0);
      router.push(`/support/${saved.data.request.id}`);
      router.refresh();
    } catch (err) {
      if(controller.signal.aborted||work.current!==controller)return;
      const status=err instanceof ParentApiError?err.status:0;
      setStartUncertain(!!startAttempt.current && (startUncertain || creationAttempted &&
        (status<400||status>=500||status===409 || (wicOnly || pecoPreparation) && (status===401||status===403))));
      if(snapSelected && (status===401||status===403)){setCollectionBlocked(true);authorization.reload();}
      if(wicOnly && (status===401||status===403)){setWicBlocked(true);authorization.reload();}
      if(pecoPreparation && (status===401||status===403)){setPecoBlocked(true);authorization.reload();}
      setError(
        err instanceof Error
          ? err
          : new Error("We couldn’t save your request. Please try again."),
      );
    } finally {
      if (refreshedZip && !controller.signal.aborted && work.current === controller) {
        const zip = refreshedZip.value;
        setIntake(current => ({ ...current, zip }));
        setReusedZip(refreshedZip);
      }
      if(running.current===controller)running.current=null;
      if(!controller.signal.aborted&&work.current===controller)setPendingWork(null);
    }
  }
  return (
    <div className={styles.container}>
      <div className={styles.pageTop}>
        <div>
          <h1>{directSnap ? "Apply for SNAP" : "Let’s make the next steps easier."}</h1>
          <p>
            Share what your family needs. You choose what we can handle, and you
            can change your mind.
          </p>
        </div>
      </div>
      {snapSelected && <p className={`${styles.hint} ${styles.space}`}>
        You can <a className={styles.textLink} href={SNAP_NEW_APPLICATION_URL} target="_blank" rel="noreferrer">apply directly with Pennsylvania SNAP</a> at any time, including before completing these questions. The official application opens in a new tab.
      </p>}
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
            {(directSnap ? ["Application details", "Your permission"] : ["Your needs", "Household details", "Your permission"]).map(
              (label, index) => {
                const i = directSnap ? index + 1 : index;
                return (
                <li key={label} aria-current={i === step ? "step" : undefined}>
                  <span>
                    {i < step ? (
                      <Check width={14} height={14} aria-hidden="true" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {label}
                </li>
                );
              },
            )}
          </ol>
          <section className={styles.surface}>
            <form className={styles.form} onSubmit={submit}>
              <div className={styles.formHeader}>
                <h2 ref={heading} tabIndex={-1}>
                  {
                    [
                      "What would help your household?",
                      fullSnap ? "Tell us about your household" : "Your household details, in one place",
                      "You’re in control of what happens next",
                    ][step]
                  }
                </h2>
                <p>
                  {
                    [
                      "Choose the food or utility support your household needs.",
                      fullSnap ? "Answer the questions that apply to you. CaseLink will use these answers to prepare your application; you can review and correct it afterward. Leave optional or uncertain answers blank." : "Add what you know now so you don’t have to answer the same questions later. You can leave uncertain details blank.",
                      "These are the specific programs and limits for this request. No unknown recipients or open-ended permission.",
                    ][step]
                  }
                </p>
              </div>
              {step === 0 && (
                <>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>Food & benefits</legend>
                    <div className={`${styles.choices} ${styles.needChoices}`}>
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
                              <small>
                                Find groceries or meals now. This does not start
                                a SNAP application.
                              </small>
                            )}
                            {need === "snap_new" && (
                              <small>
                                A new application for help paying for groceries
                              </small>
                            )}
                            {need === "snap_renewal" && (
                              <small>Keep benefits you already receive</small>
                            )}
                            {need === "snap_pending" && (
                              <small>
                                Follow an application you already sent; avoid
                                applying twice
                              </small>
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
                    <legend className={styles.legend}>Utility bills & service</legend>
                    <div className={`${styles.choices} ${styles.needChoices}`}>
                      {utilityNeeds.map(need => <label className={styles.choice} key={need}>
                        <input type="checkbox" checked={intake.needs.includes(need)} onChange={() => toggleNeed(need)}/>
                        <span><strong>{NEED_LABELS[need]}</strong><small>Bill assistance, a shutoff notice or disconnected service</small></span>
                      </label>)}
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
                              "Today — food is running out or utility service is at risk",
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
                  {snapSelected && authorization.loading ? <ParentLoading label="Checking SNAP application availability"/> : fullSnap ? <>
                    <SnapApplicationNotice />
                    <SnapApplicationFormFields value={snapValues} onChange={changeSnapDetails} disabled={pending}/>
                  </> : <>
                  {snapSelected && <div className={styles.notice}>
                    <p>{authorization.loading ? "Checking whether private SNAP application fields are available…" : "Full private SNAP application fields are not available here yet. You can still save minimum routing details and use the official program directly; this does not complete or submit an application."}</p>
                    {(authorization.error || collectionBlocked) && <button type="button" className={styles.secondary} disabled={pending} onClick={refreshSnapCollection}>Check application availability again</button>}
                    <a className={styles.textLink} href={getProgramsForNeeds(["snap_new"])[0].officialUrl}>Open official SNAP help</a>
                  </div>}
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
                      {reusedZip && <p className={styles.hint}>We filled your ZIP code from your saved information, provided {new Date(reusedZip.confirmedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}. You can change it here. Reuse keeps its original date and expiry.</p>}
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
                          interface is currently in English;
                          Spanish service availability depends on the program.
                        </p>
                      )}
                    </div>
                  </div>
                  </>}
                  {wicOnly && authorization.loading ? <ParentLoading label="Checking WIC application availability"/> : fullWic ? <>
                    <WicApplicationNotice/>
                    <WicApplicationFormFields value={wicDetails} onChange={changeWicDetails} disabled={pending}/>
                  </> : intake.needs.some(need => need === "wic_new" || need === "wic_continuing") ? <div className={styles.notice}><div>
                    <p>Private WIC questions are not available for this request. {wicOnly ? "Your unsaved WIC answers, if any, remain on this page. You can save minimum routing information when no private draft is pending." : "Combined and continuing requests keep their separate routing; this does not start a new WIC pre-application."}</p>
                    {wicOnly && <button type="button" className={styles.secondary} disabled={pending} onClick={refreshWicCollection}>Check WIC availability again</button>}
                    <a className={styles.textLink} href={getProgramsForNeeds(["wic_new"])[0].officialUrl}>Open official WIC help</a>
                  </div></div> : null}
                  {selectedUtilities.length > 0 && <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>Utility routing</legend>
                    <fieldset className={styles.fieldset}><legend className={styles.legend}>Utility providers</legend>
                      <div className={styles.choices}>
                        {utilityProviderChoices.filter(provider => !provider.need || intake.needs.includes(provider.need)).map(({ id, label }) => <label key={id} className={styles.choice}>
                          <input type="checkbox" checked={intake.utilityProviders.includes(id)} onChange={() => change("utilityProviders", intake.utilityProviders.includes(id) ? intake.utilityProviders.filter(provider => provider !== id) : [...intake.utilityProviders.filter(provider => id !== "unknown" && provider !== "unknown"), id])}/><span>{label}</span>
                        </label>)}
                      </div>
                    </fieldset>
                    <div className={styles.field}><label htmlFor="support-utility-authority">Your authority for the selected utility accounts</label><select id="support-utility-authority" className={styles.select} value={intake.accountAuthority} onChange={event => change("accountAuthority", event.target.value as SupportIntake["accountAuthority"])}>
                      <option value="not_sure">Not sure / unanswered</option><option value="self">I hold every selected account</option><option value="authorized_caregiver">I hold or have permission to help with every selected account</option></select></div>
                    {selectedUtilities.length === 1 && <div className={styles.field}><label htmlFor="support-shutoff">Shutoff date, if on a notice</label><input id="support-shutoff" className={styles.input} type="date" value={intake.shutoffDate ?? ""} onChange={event => change("shutoffDate", event.target.value || null)}/></div>}
                    <p className={styles.hint}>Use official utility help now if service is at risk. Saving a request does not stop a shutoff or restore service.</p>
                    {pecoOnly && <label className={styles.checkbox}><input type="checkbox" checked={pecoPreparation} onChange={event => {
                      setPecoPreparation(event.target.checked); setPecoDetails({}); setPecoDetailsReady(false); setAccepted(false); setError(null); startAttempt.current = null;
                      if (event.target.checked) setIntake(current => ({ ...current, householdSize: null, incomeAmount: null, incomeFrequency: "unknown" }));
                    }}/><span>Prepare PECO CAP help for this electricity account. Keep this a separate, preparation-only PECO request.</span></label>}
                    {pecoOnly && !pecoPreparation && <p className={styles.hint}>Ordinary electricity help does not start a CAP application. Choose CAP preparation only if you want CaseLink to save its private answers.</p>}
                    {selectedUtilities.length > 0 && !pecoOnly && <p className={styles.hint}>Private CAP preparation is available only as a separate electricity request for a named PECO account. This request keeps its selected utility needs.</p>}
                  </fieldset>}
                  {pecoPreparation && (authorization.loading ? <ParentLoading label="Checking PECO preparation availability"/> : fullPeco ? <>
                    <PecoApplicationNotice/>
                    <PecoApplicationFormFields value={pecoDetails} onChange={changePecoDetails} disabled={pending}/>
                  </> : <div className={styles.notice}><div><p>Private PECO CAP preparation is not available or account authority is unresolved. Your unsaved answers remain on this page. Confirm your account authority and check access before entering private answers.</p>
                    <button type="button" className={styles.secondary} disabled={pending} onClick={refreshPecoCollection}>Check PECO preparation access again</button>
                    <a className={styles.textLink} href={PECO_HELP_URL}>Open official PECO help</a>
                  </div></div>)}
                  {hasBenefits && !(snapSelected&&authorization.loading) && (!fullSnap || intake.needs.some(need=>need==='wic_new'||need==='wic_continuing')) ? (
                    <fieldset className={styles.fieldset}>
                      <legend className={styles.legend}>
                        Household & income
                      </legend>
                      <p className={styles.hint}>
                        These answers can be reused for the programs you choose.
                        They are optional here; you can still access official
                        help without them.
                      </p>
                      <div className={styles.stack}>
                        {!fullSnap && <div className={styles.field}>
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
                        </div>}
                        {!fullSnap && <div className={styles.row}>
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
                              <option value="twice_monthly">
                                Twice a month
                              </option>
                              <option value="monthly">Monthly</option>
                              <option value="yearly">Yearly</option>
                            </select>
                          </div>
                        </div>}
                      </div>
                    </fieldset>
                  ) : null}
                  {hasBenefits && !fullSnap && (
                    <div className={styles.notice}>
                      <Lock width={22} height={22} aria-hidden="true" />
                      <p>
                        Names, addresses, dates of birth and required identity
                        numbers belong in a protected application step. Don’t
                        put them in chat or these household fields. We’ll reuse
                        your saved answers; a provider may still require a
                        personal identity check or declaration.
                      </p>
                    </div>
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
                <fieldset className={`${styles.fieldset} ${styles.form}`} disabled={pending || startUncertain}>
                  <div className={styles.notice}>
                    <ShieldCheck width={23} height={23} aria-hidden="true" />
                    <p>
                      <strong>
                        {fullAvailable
                          ? "Supported work, within your limits."
                          : "We can prepare. Applications are not connected yet."}
                      </strong>{" "}
                      {fullAvailable
                        ? "Only programs with a verified permitted channel can receive information or carry out applications."
                        : "Your permission covers research and preparation. Nothing is sent, booked or submitted. Official programs remain available directly."}
                    </p>
                  </div>
                  {(fullSnap && recipientIds.length===1 && recipientIds[0]==='snap-pa' || fullWic && recipientIds.length===1 && recipientIds[0]==='wic-pa' || pecoDetailsReady && recipientIds.length === 1 && recipientIds[0] === 'peco-cap') ? <p><strong>{pecoDetailsReady ? "PECO CAP" : fullWic ? "Pennsylvania WIC" : "Pennsylvania SNAP"}</strong> is the named program for your {pecoDetailsReady ? "private CAP preparation" : fullWic ? "prepared WIC answers" : "application"}.</p> : <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>
                      Named programs for this request
                    </legend>
                    <div
                      className={`${styles.choices} ${styles.programChoices}`}
                    >
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
                            <small>
                              {connected(program.id)
                                ? "Permitted actions available"
                                : "Prepare only · nothing sent"}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>}
                  <details className={styles.programDetails}>
                    <summary>About these programs & direct access</summary>
                    <ul className={styles.programDescriptions}>
                      {programs.map((program) => (
                        <li key={program.id}>
                          <strong>{program.name}</strong>
                          <p>{program.description}</p>
                          <a
                            className={styles.textLink}
                            href={program.officialUrl}
                          >
                            Open official program
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
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
                          {pecoDetailsReady ? "Your private PECO CAP answers described in the PECO notice, your needs, utility and routing information" : wicDetailsReady ? "Your private WIC preparation answers described in the WIC notice, your needs and routing information" : detailsReady ? "Your private SNAP application answers described in the SNAP data notice, your needs and household details" : "Your needs, household details"}
                          {intake.needs.some((need) => incomeNeeds.includes(need))
                            ? ", income information when a named program requires it"
                            : ""}, only
                          for this request. {pecoDetailsReady ? "Private PECO document uploads are not connected. " : wicNeedsOnly ? "WIC document uploads are not available. " : <>Any bills or notices you later
                          choose to add can be used for the verified needs and named programs, after separate document-processing
                          consent. {intake.needs.some(need => need === "wic_new" || need === "wic_continuing") && "Do not upload WIC documents here. "}</>}No passwords, EBT PINs or signatures.
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
                  {mode === "full" && fullAvailable && (!fullSnap || intake.needs.some(need=>need!=='snap_new')) && (
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
                      {detailsReady && " I also agree to save and use my private SNAP application answers for this named program under the SNAP data notice."}
                      {wicDetailsReady && ` I agree to save and use my private WIC answers for Pennsylvania WIC under the WIC notice. ${WIC_SUBJECT_AUTHORITY_STATEMENT}`}
                      {pecoDetailsReady && ` I agree to save and use my private PECO CAP answers for PECO CAP under the PECO notice. ${PECO_SUBJECT_AUTHORITY_STATEMENT} ${PECO_ACCOUNT_AUTHORITY_STATEMENT}`}
                    </span>
                  </label>
                  <p className={styles.hint}>
                    Closing the page or signing out does not cancel your
                    permission. My support shows whether work is running,
                    waiting or unavailable. Your{" "}
                    <Link className={styles.textLink} href="/support/privacy">
                      privacy and control options
                    </Link>{" "}
                    are always available.
                  </p>
                </fieldset>
              )}
              {error && <ServiceError error={error} />}
              {startUncertain && <p className={styles.notice}>The save result has not been confirmed. Retry the same request before changing answers or starting another request. <Link className={styles.textLink} href="/my-support">Check My support for the saved request</Link>.</p>}
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
                    disabled={pending || startUncertain}
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
                  disabled={pending || (step===1 && (snapSelected || wicOnly || pecoPreparation) && authorization.loading)}
                >
                  {pending
                    ? "Saving your request…"
                    : wicOnly && startUncertain ? "Retry the same WIC request"
                    : pecoPreparation && startUncertain ? "Retry the same PECO request"
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
