"use client";
import { useParentLocale } from "./parent-locale";
import Link from "next/link";
import { z } from "zod";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { boundedParentApi, canCollectSnapApplication, canCollectWicApplication, canCollectPecoApplication, canCollectPgwApplication, canCollectWaterApplication, ParentApiError, type ParentAuthorizationWindow } from "./api";
import { SNAP_APPLICATION_NOTICE_VERSION, WIC_APPLICATION_NOTICE_VERSION, WIC_SUBJECT_AUTHORITY_STATEMENT } from "@/lib/parent/constants";
import { wicApplicationFieldsValueSchema, type WicApplicationFields } from "@/lib/parent/wic-application-fields";
import { PECO_APPLICATION_NOTICE_VERSION, PECO_ACCOUNT_AUTHORITY_STATEMENT, PECO_SUBJECT_AUTHORITY_STATEMENT, pecoApplicationFieldsValueSchema, type PecoApplicationFields } from "@/lib/parent/peco-application-fields";
import { PGW_APPLICATION_NOTICE_VERSION, PGW_ACCOUNT_AUTHORITY_STATEMENT, PGW_SUBJECT_AUTHORITY_STATEMENT, pgwApplicationFieldsValueSchema, type PgwApplicationFields } from "@/lib/parent/pgw-application-fields";
import { WATER_APPLICATION_NOTICE_VERSION, WATER_ACCOUNT_AUTHORITY_STATEMENT, WATER_SUBJECT_AUTHORITY_STATEMENT, waterApplicationFieldsValueSchema, type WaterApplicationFields } from "@/lib/parent/water-application-fields";
import { assessSnapApplicationFields, snapApplicationFieldsSchema, type SnapApplicationFields } from "@/lib/parent/snap-application-fields";
import { familyProfileReadSchema, type FamilyProfileSnapshot, type FamilyProfileSource } from "@/lib/parent/family-profile";
import { projectFamilyProfileApplication, matchingFamilyProfileFields, mergeFamilyProfileApplicationProjection, familyProfileApplicationValue, replaceFamilyProfileApplicationValue, sameFamilyProfileApplicationValue, type FamilyProfileApplicationDetails, type FamilyProfileApplicationProgram, type FamilyProfileApplicationOptions } from "@/lib/parent/family-profile-application";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import { UrgentHelp } from "./landing";
import { FoodServices } from "./food-services";
import { foodAssessmentHandoffSchema, foodAssessmentReplySchema, type FoodAssessmentHandoff } from "@/lib/parent/food-assessment";
import { ParentSignIn } from "./sign-in";
import { SnapApplicationFormFields } from "./snap-application-form";
import { SnapDocumentLanguage, type SnapFormTemplateId } from "./snap-document-language";
import { SNAP_EN_TEMPLATE_ID } from "@/lib/parent/snap-form-source";
import { SnapApplicationNotice } from "./snap-application-review";
import { WicApplicationNotice, WicApplicationFormFields } from "./wic-application-form";
import { PecoApplicationNotice, PecoApplicationFormFields, PECO_HELP_URL } from "./peco-application-form";
import { PgwApplicationNotice, PgwApplicationFormFields, PGW_HELP_URL } from "./pgw-application-form";
import { WaterApplicationNotice, WaterApplicationFormFields, WATER_HELP_URL } from "./water-application-form";
import { usePermissionWindow } from "./use-permission-window";
import styles from "./parent.module.css";
import wicStyles from "./wic.module.css";

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
const utilityPreparationChoices = {
  peco: {
    need: "electricity", provider: "peco", programId: "peco-cap", label: "PECO CAP", short: "PECO", purpose: "private CAP preparation",
    optIn: "Prepare PECO CAP help for this electricity account", kind: "peco_application", noticeVersion: PECO_APPLICATION_NOTICE_VERSION,
    schema: pecoApplicationFieldsValueSchema, canCollect: canCollectPecoApplication, helpUrl: PECO_HELP_URL,
    subjectStatement: PECO_SUBJECT_AUTHORITY_STATEMENT, accountStatement: PECO_ACCOUNT_AUTHORITY_STATEMENT,
  },
  pgw: {
    need: "gas", provider: "pgw", programId: "pgw-crp", label: "PGW CRP", short: "PGW", purpose: "private CRP preparation",
    optIn: "Prepare PGW CRP help for this gas account", kind: "pgw_application", noticeVersion: PGW_APPLICATION_NOTICE_VERSION,
    schema: pgwApplicationFieldsValueSchema, canCollect: canCollectPgwApplication, helpUrl: PGW_HELP_URL,
    subjectStatement: PGW_SUBJECT_AUTHORITY_STATEMENT, accountStatement: PGW_ACCOUNT_AUTHORITY_STATEMENT,
  },
  water: {
    need: "water", provider: "pwd", programId: "pwd-tap", label: "Philadelphia water assistance", short: "water", purpose: "private water assistance preparation",
    optIn: "Prepare Philadelphia water assistance for this water account", kind: "water_application", noticeVersion: WATER_APPLICATION_NOTICE_VERSION,
    schema: waterApplicationFieldsValueSchema, canCollect: canCollectWaterApplication, helpUrl: WATER_HELP_URL,
    subjectStatement: WATER_SUBJECT_AUTHORITY_STATEMENT, accountStatement: WATER_ACCOUNT_AUTHORITY_STATEMENT,
  },
} as const;
type UtilityPreparation = keyof typeof utilityPreparationChoices;
type UtilityDetails = PecoApplicationFields | PgwApplicationFields | WaterApplicationFields;
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
const authorizationReply=z.object({authorization:z.object({issuedAt:z.iso.datetime({offset:true}),expiresAt:z.iso.datetime({offset:true}),snapApplication:z.object({collectionEnabled:z.boolean(),noticeVersion:z.string().nullable()}).optional(),wicApplication:z.object({collectionEnabled:z.boolean(),noticeVersion:z.string().nullable(),expiresAt:z.string().nullable()}).optional(),pecoApplication:z.object({collectionEnabled:z.boolean(),noticeVersion:z.string().nullable(),expiresAt:z.string().nullable()}).optional(),pgwApplication:z.object({collectionEnabled:z.boolean(),noticeVersion:z.string().nullable(),expiresAt:z.string().nullable()}).optional(),waterApplication:z.object({collectionEnabled:z.boolean(),noticeVersion:z.string().nullable(),expiresAt:z.string().nullable()}).optional()})});

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
  privateUtilityPreparation = false,
  includeProtectedDocuments = false,
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
      ...(privateUtilityPreparation || intake.needs.every(need => need === "wic_new" || need === "wic_continuing") ? [] : ["documents" as const]),
      ...(intake.needs.some((need) => incomeNeeds.includes(need))
        ? ["income" as const]
        : []),
      ...(intake.needs.some((n) => utilityNeeds.includes(n))
        ? ["utility" as const]
        : []),
      ...(privateUtilityPreparation && includeProtectedDocuments ? ["documents" as const] : []),
    ],
    expiresAt,
    maxAttempts: 12,
    maxRecipients: recipientIds.length,
    bookingPreference,
    accepted: true,
  };
}

const reusableZipReadSchema = z.object({ ownerId: z.uuid(), zip: reusableZipSchema.nullable() });
export type ParentIntakeSignInOptions = { existingAccountRecovery?: boolean; recoveryHref?: string; emailCodeAvailable?: boolean };
export function ParentIntake({ initialNeed, signInOptions }: { initialNeed?: string; signInOptions?: ParentIntakeSignInOptions }) {
  const [guide, setGuide] = useState<{ handoff: FoodAssessmentHandoff; editing: boolean } | null>(null);
  const [guideOwnerChanged, setGuideOwnerChanged] = useState(false);
  const guidePanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (guide && !guide.editing) guidePanel.current?.querySelector<HTMLElement>("#food-guide-results")?.focus();
  }, [guide]);
  const guideNeed = guide?.handoff.needs.find(need => need !== "food_now") ?? guide?.handoff.needs[0];
  return initialNeed === "food" ? (
    <><div ref={guidePanel} hidden={guide?.editing}><FoodServices key={guideOwnerChanged ? "fresh" : "guide"} initial={guide?.handoff} signInOptions={signInOptions} onOwnerChanged={() => { setGuide(null); setGuideOwnerChanged(true); }} onChoose={value => { setGuideOwnerChanged(false); setGuide({ handoff: foodAssessmentHandoffSchema.parse(value), editing: true }); }}/></div>
      {guideOwnerChanged && <p role="status">Your sign-in changed. The earlier answers were cleared; begin with your current household.</p>}
      {guide && <div hidden={!guide.editing}><ParentIntakeForm key={guideNeed} active={guide.editing} initialNeed={guideNeed} handoff={guide.handoff} signInOptions={signInOptions}
      onFoodBack={() => setGuide({ ...guide, editing: false })}
      onFoodOwnerChanged={() => { setGuide(null); setGuideOwnerChanged(true); }}/></div>}</>
  ) : (
    <ParentIntakeForm key={initialNeed ?? "all"} initialNeed={initialNeed} />
  );
}

function ParentIntakeForm({ initialNeed, handoff, onFoodBack, onFoodOwnerChanged, signInOptions, active = true }: { initialNeed?: string; handoff?: FoodAssessmentHandoff; onFoodBack?: () => void; onFoodOwnerChanged?: () => void; signInOptions?: ParentIntakeSignInOptions; active?: boolean }) {
  const { t, locale } = useParentLocale();
  const session = useParentResource<{
    account: { id?: string; email: string; preferences?: ParentPreferences };
  }>("/account");
  const reloadSession = session.reload;
  const preferencesApplied = useRef(false);
  const connections = useParentResource<{
    capabilities: {
      programId: string;
      enabled: boolean;
      actions: SupportAction[];
    }[];
  }>("/capabilities");
  const authorization = useParentResource<ParentAuthorizationWindow>("/authorization-window");
  const [familyProfile, setFamilyProfile] = useState<FamilyProfileSnapshot | null>(null);
  const familyOwner = useRef<string | null>(null);
  const [familyAccess, setFamilyAccess] = useState<"ready" | "checking" | "changed" | "unavailable">("ready");
  const familyOwnerCheck = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const familyProfileRequested = useRef(false), familyProfileWork = useRef<AbortController | null>(null);
  const languageChosen = useRef(false);
  const explicitLanguage = useRef<"en" | "es" | null>(null);
  const guideOwner = useRef<string | null>(null);
  const [guideSignIn, setGuideSignIn] = useState(false);
  const [guideTimingChosen, setGuideTimingChosen] = useState(handoff?.answers.foodForTwoDays === "no");
  const guideTimingManual = useRef(false);
  const [previousGuide, setPreviousGuide] = useState(handoff);
  const [guideCheck, setGuideCheck] = useState<z.infer<typeof foodAssessmentReplySchema> | null>(null);
  useEffect(() => () => { familyProfileWork.current?.abort(); familyOwnerCheck.current?.controller.abort(); }, []);
  const familyApplied = useRef(new Set<FamilyProfileApplicationProgram>());
  const familyTarget = useRef<{ program: FamilyProfileApplicationProgram; accountAuthority: SupportIntake["accountAuthority"] } | null>(null);
  const [familyFilled, setFamilyFilled] = useState<Partial<Record<FamilyProfileApplicationProgram, boolean>>>({});
  const familyDraftChanged = useRef({ snap: false, wic: false, utility: false });
  const familySources = useRef<Partial<Record<FamilyProfileApplicationProgram, { projection: ReturnType<typeof projectFamilyProfileApplication>; options: Omit<FamilyProfileApplicationOptions, "now" | "accountAuthority" | "wicBeneficiaries"> }>>>({});
  const [familyAccountPerson, setFamilyAccountPerson] = useState("");
  const [familyHomeAddress, setFamilyHomeAddress] = useState(false);
  const [familyPecoPhone, setFamilyPecoPhone] = useState<"home" | "cell" | "">("");
  const zipDefaultConsumed = useRef(false);
  const intakeOwner = useRef<string | null>(null);
  const [reusedZip, setReusedZip] = useState<z.infer<typeof reusableZipSchema> | null>(null);
  const [intake, setIntake] = useState<SupportIntake>(() => ({
    ...initialIntake,
    needs: handoff?.needs ?? ([...foodNeeds, ...utilityNeeds].includes(initialNeed as SupportNeed)
      ? [initialNeed as SupportNeed]
      : []),
    ...(initialNeed === "wic_new" ? { accountAuthority: "self" as const } : {}),
    ...(handoff?.answers.foodForTwoDays === "no" ? { urgency: "today" as const } : {}),
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
  const [snapDocument, setSnapDocument] = useState<SnapFormTemplateId>(SNAP_EN_TEMPLATE_ID);
  const [snapDocumentChosen, setSnapDocumentChosen] = useState(false);
  const [detailsReady, setDetailsReady] = useState(false);
  const [startUncertain, setStartUncertain] = useState(false);
  const [collectionBlocked, setCollectionBlocked] = useState(false);
  const [wicDetails, setWicDetails] = useState<WicApplicationFields>({});
  const [wicDetailsReady, setWicDetailsReady] = useState(false);
  const [wicBlocked, setWicBlocked] = useState(false);
  const [utilityPreparation, setUtilityPreparation] = useState<UtilityPreparation | null>(null);
  const [utilityDetails, setUtilityDetails] = useState<UtilityDetails>({});
  const [utilityDetailsReady, setUtilityDetailsReady] = useState(false);
  const [utilityBlocked, setUtilityBlocked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const startAttempt = useRef<{
    key: string;
    packet: { intake: SupportIntake; mandate: ServiceMandate; expectedOwnerId?: string; kind?: "snap_application" | "wic_application" | "peco_application" | "pgw_application" | "water_application"; details?: SnapApplicationFields | WicApplicationFields | UtilityDetails; noticeVersion?: typeof SNAP_APPLICATION_NOTICE_VERSION | typeof WIC_APPLICATION_NOTICE_VERSION | typeof PECO_APPLICATION_NOTICE_VERSION | typeof PGW_APPLICATION_NOTICE_VERSION | typeof WATER_APPLICATION_NOTICE_VERSION; subjectAuthorityDeclared?: true; accountAuthorityDeclared?: true; reusedZip?: ReusedZipSource; familyProfileSource?: FamilyProfileSource; descriptionSource?: FoodAssessmentHandoff["descriptionSource"]; documentTemplateId?: SnapFormTemplateId };
  } | null>(null);
  const work=useRef<AbortController|null>(null),running=useRef<AbortController|null>(null);
  const scope=JSON.stringify({intake,snapDetails,snapDocument,snapDocumentChosen,detailsReady,wicDetails,wicDetailsReady,utilityPreparation,utilityDetails,utilityDetailsReady,recipientIds,mode,booking,accepted,reusedZip,handoff});
  const pending = pendingWork?.scope === scope && !pendingWork.controller.signal.aborted;
  useLayoutEffect(()=>{
    const controller=new AbortController();work.current=controller;
    return()=>{controller.abort();if(work.current===controller)work.current=null;};
  },[scope]);
  const router = useRouter();
  if (previousGuide !== handoff) {
    setPreviousGuide(handoff);
    if (handoff && previousGuide) {
      setGuideCheck(null);
      if (handoff.needs.join(",") !== previousGuide.needs.join(",")) {
        setIntake(current => ({ ...current, needs: handoff.needs }));
        setAccepted(false);
      }
    }
    if (handoff && previousGuide && !guideTimingManual.current && handoff.answers.foodForTwoDays !== previousGuide.answers.foodForTwoDays) {
      setGuideTimingChosen(handoff.answers.foodForTwoDays === "no");
      if (handoff.answers.foodForTwoDays === "no") setIntake(current => ({ ...current, urgency: "today" }));
    }
  }
  useEffect(() => {
    if (!handoff) return;
    const current = z.uuid().safeParse(session.data?.account.id);
    if (!current.success) return;
    if (guideOwner.current && guideOwner.current !== current.data.toLowerCase()) onFoodOwnerChanged?.();
    else guideOwner.current ??= current.data.toLowerCase();
  }, [handoff, session.data?.account.id, onFoodOwnerChanged]);
  async function checkGuideOwner(signal: AbortSignal, deadline: string) {
    const account = z.object({ account: z.object({ id: z.uuid() }) }).parse(await boundedParentApi("/account", {}, signal, deadline));
    signal.throwIfAborted();
    if (guideOwner.current && account.account.id.toLowerCase() !== guideOwner.current) {
      onFoodOwnerChanged?.(); throw new ParentApiError("Your sign-in changed. Earlier answers cannot be used for another household.", 412);
    }
    guideOwner.current ??= account.account.id.toLowerCase();
  }
  async function checkFoodAssessment(signal: AbortSignal, deadline: string) {
    if (!handoff) return;
    const result = foodAssessmentReplySchema.parse(await boundedParentApi("/food-assessment", { method: "POST", body: JSON.stringify(handoff) }, signal, deadline));
    signal.throwIfAborted();
    if (!guideOwner.current || result.ownerId.toLowerCase() !== guideOwner.current) {
      onFoodOwnerChanged?.(); throw new ParentApiError("Your sign-in changed. Earlier answers cannot be used for another household.", 412);
    }
    if (handoff.needs.some(need => !result.candidates.some(candidate => candidate.need === need))) throw new ParentApiError("These proposed options changed. Return to the food questions to choose current paths.", 412);
    setGuideCheck(result);
  }
  useEffect(() => {
    if (!handoff) return;
    const controller = new AbortController();
    const check = () => { if (!guideOwner.current) return; void checkGuideOwner(controller.signal, new Date(Date.now() + 30_000).toISOString()).catch(failure => {
      if (!controller.signal.aborted && failure instanceof ParentApiError && [401, 403].includes(failure.status)) { setGuideSignIn(true); session.reload(); }
    }); };
    const returned = (event: PageTransitionEvent) => { if (event.persisted) check(); };
    window.addEventListener("focus", check); window.addEventListener("online", check); window.addEventListener("pageshow", returned);
    return () => { controller.abort(); window.removeEventListener("focus", check); window.removeEventListener("online", check); window.removeEventListener("pageshow", returned); };
  });
  const snapSelected = intake.needs.includes("snap_new");
  const directSnap = initialNeed === "snap_new" && step > 0 && snapSelected && intake.needs.length === 1;
  const fullSnap = snapSelected && canCollectSnapApplication(authorization.data) && !authorization.error && !collectionBlocked;
  const wicOnly = intake.needs.length === 1 && intake.needs[0] === "wic_new";
  const wicNeedsOnly = intake.needs.length > 0 && intake.needs.every(need => need === "wic_new" || need === "wic_continuing");
  const wicWindowCurrent = usePermissionWindow(Date.parse(authorization.data?.authorization?.wicApplication?.expiresAt ?? ""));
  const fullWic = wicOnly && wicWindowCurrent && canCollectWicApplication(authorization.data) && !authorization.error && !wicBlocked;
  const selectedUtilities = intake.needs.filter(need => utilityNeeds.includes(need));
  const utilityChoice = (Object.keys(utilityPreparationChoices) as UtilityPreparation[]).find(key => {
    const option = utilityPreparationChoices[key];
    return intake.needs.length === 1 && intake.needs[0] === option.need && intake.utilityProviders.length === 1 && intake.utilityProviders[0] === option.provider;
  });
  const utilityConfig = utilityPreparation ? utilityPreparationChoices[utilityPreparation] : null;
  const utilityWindowKey = utilityPreparation ? `${utilityPreparation}Application` as const : "pecoApplication";
  const utilityWindow = authorization.data?.authorization?.[utilityWindowKey];
  const utilityWindowCurrent = usePermissionWindow(Date.parse(utilityWindow?.expiresAt ?? ""));
  const fullUtility = !!utilityConfig && utilityChoice === utilityPreparation && intake.accountAuthority !== "not_sure" && utilityWindowCurrent && utilityConfig.canCollect(authorization.data) && !authorization.error && !utilityBlocked;
  const closeChangedFamily = useCallback(() => {
    work.current?.abort(); running.current?.abort(); familyProfileWork.current?.abort();
    familyOwnerCheck.current?.controller.abort(); familyOwnerCheck.current = null;
    familyOwner.current = null; familySources.current = {}; familyApplied.current.clear();
    setFamilyProfile(null); setFamilyFilled({}); setSnapDetails({}); setSnapDocument(SNAP_EN_TEMPLATE_ID); setSnapDocumentChosen(false); setWicDetails({}); setUtilityDetails({});
    intakeOwner.current = null; setReusedZip(null); setIntake(current => ({ ...current, zip: "", householdSize: null, incomeAmount: null, incomeFrequency: "unknown", accountAuthority: "not_sure" }));
    setAccepted(false); setError(null); setStartUncertain(false); startAttempt.current = null;
    setFamilyAccess("changed");
    onFoodOwnerChanged?.();
  }, [onFoodOwnerChanged]);
  const readOwnedFamilyProfile = useCallback(async (signal: AbortSignal, deadline: string, receiptOnly = false) => {
    const owner = familyOwner.current ?? intakeOwner.current;
    if (!owner) throw new Error("Saved family information needs a current owner.");
    const account = z.object({ account: z.object({ id: z.uuid() }) }).parse(await boundedParentApi("/account", {}, signal, deadline));
    if (account.account.id.toLowerCase() !== owner) { closeChangedFamily(); throw new Error("family_owner_changed"); }
    if (receiptOnly || !familyOwner.current) { signal.throwIfAborted(); return null; }
    const value = await boundedParentApi("/family-profile", {}, signal, deadline);
    const read = value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {}; delete read.ok;
    const current = familyProfileReadSchema.parse(read);
    if (current.ownerId !== owner) { closeChangedFamily(); throw new Error("family_owner_changed"); }
    signal.throwIfAborted(); return current;
  }, [closeChangedFamily]);
  const ensureFamilyOwner = useCallback(async () => {
    const owner = familyOwner.current ?? intakeOwner.current;
    if (!owner) return;
    if (familyOwnerCheck.current) return familyOwnerCheck.current.promise;
    const controller = new AbortController(); setFamilyAccess("checking");
    const promise = (async () => {
      try {
        const deadline = new Date(Date.now() + 30_000).toISOString();
        const current = await readOwnedFamilyProfile(controller.signal, deadline, startUncertain && !!startAttempt.current);
        if (current && (!current.profile || !current.collection.collectionEnabled || Date.parse(current.collection.expiresAt ?? "") <= Date.now())) throw new Error("family_access_unavailable");
        controller.signal.throwIfAborted(); setFamilyAccess("ready");
      } catch (failure) {
        if ((familyOwner.current || intakeOwner.current) && !controller.signal.aborted) {
          if (handoff && failure instanceof ParentApiError && failure.status === 401) {
            setGuideSignIn(true); setFamilyAccess("ready"); reloadSession();
          } else if (failure instanceof ParentApiError && [401, 403].includes(failure.status)) closeChangedFamily();
          else setFamilyAccess("unavailable");
        }
        throw new Error("Saved family information needs a fresh sign-in check before this request can continue.");
      } finally { if (familyOwnerCheck.current?.controller === controller) familyOwnerCheck.current = null; }
    })();
    familyOwnerCheck.current = { controller, promise }; return promise;
  }, [closeChangedFamily, readOwnedFamilyProfile, startUncertain, handoff, reloadSession]);
  useEffect(() => {
    const check = () => { if (familyOwner.current || intakeOwner.current) void ensureFamilyOwner().catch(() => {}); };
    const returned = (event: PageTransitionEvent) => { if (event.persisted) check(); };
    window.addEventListener("focus", check); window.addEventListener("pageshow", returned); window.addEventListener("online", check);
    return () => { window.removeEventListener("focus", check); window.removeEventListener("pageshow", returned); window.removeEventListener("online", check); };
  }, [ensureFamilyOwner]);
  useEffect(() => {
    if (familyAccess === "changed") return;
    const expected = z.uuid().safeParse(session.data?.account.id);
    if (intakeOwner.current && expected.success && expected.data.toLowerCase() !== intakeOwner.current) { closeChangedFamily(); return; }
    if (expected.success && !intakeOwner.current) intakeOwner.current = expected.data.toLowerCase();
    if (zipDefaultConsumed.current || familyAccess !== "ready") return;
    const controller = new AbortController();
    boundedParentApi("/intake-defaults", {}, controller.signal, new Date(Date.now() + 30_000).toISOString())
      .then(value => {
        if (controller.signal.aborted || zipDefaultConsumed.current) return;
        const parsed = reusableZipReadSchema.safeParse(value);
        if (!parsed.success) return;
        if (expected.success && parsed.data.ownerId.toLowerCase() !== expected.data.toLowerCase()) { closeChangedFamily(); return; }
        const saved = parsed.data.zip;
        if (!saved || Date.parse(saved.expiresAt) <= Date.now() || Date.parse(saved.confirmedAt) > Date.now()) return;
        zipDefaultConsumed.current = true; intakeOwner.current = parsed.data.ownerId.toLowerCase();
        setIntake(current => ({ ...current, zip: saved.value })); setReusedZip(saved);
      })
      .catch(() => { /* Saved defaults are optional; manual entry remains available. */ });
    return () => controller.abort();
  }, [closeChangedFamily, session.data?.account.id, familyAccess]);
  const seedFamilyProfile = useCallback((profile: FamilyProfileSnapshot, program: FamilyProfileApplicationProgram, accountAuthority: SupportIntake["accountAuthority"]) => {
    const changed = program === "snap-pa" ? familyDraftChanged.current.snap : program === "wic-pa" ? familyDraftChanged.current.wic : familyDraftChanged.current.utility;
    if (changed || familyApplied.current.has(program) || !["snap-pa", "wic-pa"].includes(program) && accountAuthority === "not_sure") return;
    const projection = projectFamilyProfileApplication(profile, program, { now: new Date(), accountAuthority });
    familyApplied.current.add(program); familySources.current[program] = { projection, options: {} };
    setFamilyFilled(current => ({ ...current, [program]: projection.fields.length > 0 }));
    if (!projection.fields.length) return;
    if (program === "snap-pa") {
      const details = { ...projection.details, ...(explicitLanguage.current ? { language: explicitLanguage.current } : {}) } as SnapApplicationFields; setSnapDetails(details);
      if (details.language) languageChosen.current = true;
      setIntake(current => ({ ...current, ...(details.zip && !current.zip ? { zip: details.zip } : {}),
        ...(details.language === "en" || details.language === "es" ? { language: details.language } : {}) }));
    } else if (program === "wic-pa") setWicDetails(projection.details as WicApplicationFields);
    else setUtilityDetails(projection.details as UtilityDetails);
  }, []);
  useEffect(() => {
    const expectedOwner = z.uuid().safeParse(session.data?.account.id);
    if ((!fullSnap && !fullWic && !fullUtility) || familyProfileRequested.current || !expectedOwner.success) return;
    familyProfileRequested.current = true;
    const controller = new AbortController(); familyProfileWork.current = controller;
    boundedParentApi("/family-profile", {}, controller.signal, new Date(Date.now() + 30_000).toISOString())
      .then(value => {
        if (controller.signal.aborted || !value || typeof value !== "object") return;
        const read = { ...(value as Record<string, unknown>) }; delete read.ok;
        const parsed = familyProfileReadSchema.safeParse(read);
        if (parsed.success && parsed.data.collection.collectionEnabled && Date.parse(parsed.data.collection.expiresAt ?? "") > Date.now()) {
          if (parsed.data.ownerId !== expectedOwner.data.toLowerCase()) { closeChangedFamily(); return; }
          familyOwner.current = parsed.data.profile ? parsed.data.ownerId : null;
          setFamilyProfile(parsed.data.profile);
          if (parsed.data.profile && familyTarget.current) seedFamilyProfile(parsed.data.profile, familyTarget.current.program, familyTarget.current.accountAuthority);
        }
      }).catch(() => { /* Saved family facts are optional; all manual application paths remain available. */ });
  }, [fullSnap, fullWic, fullUtility, seedFamilyProfile, closeChangedFamily, session.data?.account.id]);
  useEffect(() => {
    const program: FamilyProfileApplicationProgram | undefined = fullSnap ? "snap-pa" : fullWic ? "wic-pa" : fullUtility ? utilityConfig?.programId : undefined;
    familyTarget.current = program && step === 1 ? { program, accountAuthority: intake.accountAuthority } : null;
  }, [fullSnap, fullWic, fullUtility, utilityConfig, intake.accountAuthority, step]);
  const snapValues={...(!reusedZip && intake.zip?{zip:intake.zip}:{}),...snapDetails};
  const programs = getProgramsForNeeds(intake.needs).filter(program=>(!fullSnap||program.id==='snap-pa'||
    program.needs.some(need=>need!=='snap_new'&&intake.needs.includes(need))) && (!fullWic || program.id === "wic-pa") && (!utilityPreparation || program.id === utilityConfig?.programId));
  const hasBenefits = intake.needs.some((need) =>
    [
      "snap_new",
      "snap_renewal",
      "snap_pending",
      "snap_problem",
    ].includes(need),
  );
  const connected = (id: string) =>
    handoff && guideCheck ? guideCheck.candidates.some(candidate => handoff.needs.includes(candidate.need) && candidate.programs.some(program => program.programId === id && program.actions.some(action => supportsInitialServiceDelivery(candidate.need, action)))) : connections.data?.capabilities?.some(
      (connection) =>
        connection.programId === id &&
        connection.enabled &&
        connection.actions.some((action) =>
          ["share", "submit", "schedule"].includes(action) && programs.some(program=>program.id===id &&
            program.needs.some(need=>intake.needs.includes(need)&&supportsInitialServiceDelivery(need,action))),
        ),
    ) ?? false;
  const fullAvailable = !utilityPreparation && programs.some(
    (p) => recipientIds.includes(p.id) && connected(p.id),
  );
  const formReady = !session.loading && !session.error && !guideSignIn && familyAccess === "ready";
  useEffect(() => {
    if (active && formReady) heading.current?.focus();
  }, [step, active, formReady]);
  useEffect(() => {
    if (session.data?.account.preferences && !preferencesApplied.current) {
      preferencesApplied.current = true;
      const preferences = session.data.account.preferences;
      setIntake((current) => ({
        ...current,
        language: languageChosen.current ? current.language : preferences.language,
        contactPreference: preferences.contactPreference,
      }));
    }
  }, [session.data]);
  function change<K extends keyof SupportIntake>(
    key: K,
    value: SupportIntake[K],
  ) {
    if (key === "language") { languageChosen.current = true; explicitLanguage.current = value as "en" | "es"; }
    if (key === "zip") { zipDefaultConsumed.current = true; setReusedZip(null); }
    if (key === "utilityProviders") { setUtilityPreparation(null); setUtilityDetails({}); setUtilityDetailsReady(false); setAccepted(false); }
    if (key === "accountAuthority") { setUtilityDetailsReady(false); setAccepted(false); }
    if (key === "utilityProviders") {
      familyDraftChanged.current.utility = false;
      for (const program of ["peco-cap", "pgw-crp", "pwd-tap"] as const) { familyApplied.current.delete(program); delete familySources.current[program]; }
      setFamilyAccountPerson(""); setFamilyHomeAddress(false); setFamilyPecoPhone("");
    }
    setIntake((current) => ({ ...current, [key]: value }));
    if (key === "accountAuthority" && utilityConfig && familyProfile && utilityConfig.canCollect(authorization.data))
      seedFamilyProfile(familyProfile, utilityConfig.programId, value as SupportIntake["accountAuthority"]);
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
    familyDraftChanged.current.wic = false; familyApplied.current.delete("wic-pa"); delete familySources.current["wic-pa"];
    familyDraftChanged.current.utility = false;
    for (const program of ["peco-cap", "pgw-crp", "pwd-tap"] as const) { familyApplied.current.delete(program); delete familySources.current[program]; }
    if (!needs.includes("snap_new")) { familyDraftChanged.current.snap = false; familyApplied.current.delete("snap-pa"); delete familySources.current["snap-pa"]; }
    setWicDetails({}); setWicDetailsReady(false); setAccepted(false);
    setUtilityPreparation(null); setUtilityDetails({}); setUtilityDetailsReady(false);
    if (familyProfile) {
      if (needs.includes("snap_new") && canCollectSnapApplication(authorization.data)) seedFamilyProfile(familyProfile, "snap-pa", intake.accountAuthority);
      else if (needs.length === 1 && needs[0] === "wic_new" && canCollectWicApplication(authorization.data)) seedFamilyProfile(familyProfile, "wic-pa", intake.accountAuthority);
    }
    startAttempt.current = null;
  }
  function changeWicDetails(details: WicApplicationFields) {
    familyDraftChanged.current.wic = true;
    setWicDetails(details); setWicDetailsReady(false); setAccepted(false); setError(null); startAttempt.current = null;
  }
  function changeUtilityDetails(details: UtilityDetails) {
    familyDraftChanged.current.utility = true;
    setUtilityDetails(details); setUtilityDetailsReady(false); setAccepted(false); setError(null); startAttempt.current = null;
  }
  function chooseSavedUtility(options: { accountPersonId?: string; useHomeAddress?: boolean; pecoPhoneType?: "home" | "cell" }) {
    if (!familyProfile || !utilityConfig) return;
    const savedOptions = { ...familySources.current[utilityConfig.programId]?.options, ...options };
    const projection = projectFamilyProfileApplication(familyProfile, utilityConfig.programId, { now: new Date(), accountAuthority: intake.accountAuthority, ...savedOptions });
    const previous = familySources.current[utilityConfig.programId]?.projection;
    const merged = structuredClone(utilityDetails) as Record<string, unknown>;
    const holderKey = utilityPreparation === "pgw" ? "customer" : "applicant";
    const oldHolder = merged[holderKey] as { id?: string } | undefined;
    if (options.accountPersonId && options.accountPersonId !== oldHolder?.id && previous) {
      for (const field of previous.fields) {
        if (!["phone", "email", "mailingAddress", "homePhone", "cellPhone"].includes(field.applicationPath) && !field.applicationPath.endsWith(".relationship")) continue;
        if (!sameFamilyProfileApplicationValue(familyProfileApplicationValue(merged, field.applicationPath), familyProfileApplicationValue(previous.details, field.applicationPath), field.applicationPath)) continue;
        const parts = field.applicationPath.split("."), parent = parts.length === 1 ? merged : familyProfileApplicationValue(merged, parts.slice(0, -1).join("."));
        if (parent && typeof parent === "object") delete (parent as Record<string, unknown>)[parts.at(-1)!];
      }
    }
    const existingPeople = [merged[holderKey], ...((merged.householdMembers ?? []) as unknown[])].filter((person): person is Record<string, unknown> & { id: string } => !!person && typeof person === "object" && "id" in person);
    const mergePerson = (person: Record<string, unknown> & { id: string }, member: boolean) => {
      const prior = existingPeople.find(value => value.id === person.id);
      const allowed = utilityPreparation === "pgw" ? ["firstName", "lastName", "income", ...(member ? ["dateOfBirth", "relationship"] : ["under18"])]
        : utilityPreparation === "water" ? ["name", "dateOfBirth", "grossMonthlyIncome", "income", ...(member ? ["relationship"] : [])]
        : ["firstName", "lastName", "middleInitial", "dateOfBirth", "income", ...(member ? ["relationship"] : [])];
      return { ...person, ...Object.fromEntries(Object.entries(prior ?? {}).filter(([key]) => allowed.includes(key))) };
    };
    for (const [key, value] of Object.entries(projection.details)) {
      if (key === "applicant" || key === "customer") {
        if (options.accountPersonId !== undefined || merged[key] === undefined) {
          merged[key] = mergePerson(value as Record<string, unknown> & { id: string }, false);
        }
      } else if (key === "householdMembers") {
        const existing = (merged[key] ?? []) as { id: string }[], people = value as (Record<string, unknown> & { id: string })[];
        merged[key] = [...people.map(person => mergePerson(person, true)), ...existing.filter(person => person.id !== options.accountPersonId && !people.some(saved => saved.id === person.id))];
      } else if (key === "address" || key === "propertyAddress") {
        if (options.useHomeAddress) merged[key] = value;
      } else if (key === "homePhone" || key === "cellPhone") {
        if (options.pecoPhoneType) merged[key] = value;
      } else if (merged[key] === undefined) merged[key] = value;
    }
    familySources.current[utilityConfig.programId] = { projection: mergeFamilyProfileApplicationProjection(previous, projection), options: savedOptions };
    changeUtilityDetails(merged as UtilityDetails);
  }
  function chooseSavedWicChild(id: string) {
    if (!familyProfile) return;
    const selected = [...new Set([...(wicDetails.children ?? []).filter(child => familyProfile.details.members?.some(person => person.id === child.id)).map(child => child.id), id])], projection = projectFamilyProfileApplication(familyProfile, "wic-pa", { now: new Date(), wicBeneficiaries: wicDetails.beneficiaries, wicChildIds: selected });
    const children = (projection.details as WicApplicationFields).children ?? [];
    changeWicDetails({ ...wicDetails, children: [...(wicDetails.children ?? []), ...children.filter(child => child.id === id && !wicDetails.children?.some(current => current.id === id))] });
    const previous = familySources.current["wic-pa"];
    familySources.current["wic-pa"] = { projection: mergeFamilyProfileApplicationProjection(previous?.projection, projection), options: { wicChildIds: selected } };
  }
  function familySource(program: FamilyProfileApplicationProgram, details: FamilyProfileApplicationDetails): FamilyProfileSource | undefined {
    const saved = familySources.current[program];
    if (!familyProfile || !saved || !familyOwner.current) return;
    const fields = matchingFamilyProfileFields(details, saved.projection);
    return fields.length ? { expectedOwnerId: familyOwner.current, revision: familyProfile.revision, fields, options: saved.options } : undefined;
  }
  async function refreshUtilityCollection() {
    const controller = work.current;
    if (!controller || controller.signal.aborted || running.current === controller) return;
    running.current = controller; setPendingWork({ scope, controller }); setError(null);
    try {
      await ensureFamilyOwner();
      if (controller.signal.aborted || work.current !== controller) return;
      const latest = await readAuthorizationWindow(controller.signal);
      if (controller.signal.aborted || work.current !== controller) return;
      setUtilityBlocked(!utilityConfig?.canCollect(latest)); authorization.reload();
    } catch (failure) {
      if (!controller.signal.aborted && work.current === controller) { setUtilityBlocked(true); setError(failure instanceof Error ? failure : new Error(`${utilityConfig?.short ?? "Utility"} preparation access could not be checked. Your draft remains on this page.`)); }
    } finally { if (running.current === controller) running.current = null; if (!controller.signal.aborted && work.current === controller) setPendingWork(null); }
  }
  async function refreshWicCollection() {
    const controller = work.current;
    if (!controller || controller.signal.aborted || running.current === controller) return;
    running.current = controller; setPendingWork({ scope, controller }); setError(null);
    try {
      await ensureFamilyOwner();
      if (controller.signal.aborted || work.current !== controller) return;
      const latest = await readAuthorizationWindow(controller.signal);
      if (controller.signal.aborted || work.current !== controller) return;
      setWicBlocked(!canCollectWicApplication(latest)); authorization.reload();
    } catch (failure) {
      if (!controller.signal.aborted && work.current === controller) { setWicBlocked(true); setError(failure instanceof Error ? failure : new Error("WIC availability could not be checked. Your draft remains on this page.")); }
    } finally { if (running.current === controller) running.current = null; if (!controller.signal.aborted && work.current === controller) setPendingWork(null); }
  }
  function changeSnapDetails(details: SnapApplicationFields) {
    familyDraftChanged.current.snap = true; languageChosen.current = true;
    if (details.language === "en" || details.language === "es") explicitLanguage.current = details.language;
    setSnapDetails(details);setDetailsReady(false);setAccepted(false);setError(null);startAttempt.current=null;
    setIntake(current=>({...current,zip:reusedZip ? current.zip : details.zip??"",householdSize:details.household?.length??null,
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
      await ensureFamilyOwner();
      if(controller.signal.aborted||work.current!==controller)return;
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
    if(pending || familyAccess !== "ready")return;
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
      if (handoff && !guideTimingChosen) { setError(new Error("Choose when to prioritize this request. An unknown food answer does not set a deadline.")); return; }
      if ((snapSelected || wicOnly || utilityPreparation) && authorization.loading) return;
      if (utilityPreparation && !fullUtility) {
        setError(new Error(`Private ${utilityConfig?.label ?? "utility"} preparation is unavailable or account authority is unresolved. Your draft remains on this page; check access and account authority or use official ${utilityConfig?.short ?? "utility"} help.`)); return;
      }
      if (fullUtility && !utilityConfig?.schema.safeParse(utilityDetails).success) {
        setError(new Error(`Check the ${utilityConfig?.short ?? "utility"} account, names, dates, addresses, contact details, applicable financial answers and income source lists. Unknown answers can stay blank.`)); return;
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
      if (handoff) {
        const controller = work.current;
        if (!controller || controller.signal.aborted || running.current === controller) return;
        running.current = controller; setPendingWork({ scope, controller });
        try { await checkFoodAssessment(controller.signal, new Date(Date.now() + 30_000).toISOString()); }
        catch (failure) {
          if (!controller.signal.aborted && work.current === controller) {
            if (failure instanceof ParentApiError && [401, 403].includes(failure.status)) { setGuideSignIn(true); session.reload(); }
            setError(failure instanceof Error ? failure : new Error("Food options could not be checked. Your answers remain on this page."));
          }
          return;
        } finally { if (running.current === controller) running.current = null; if (!controller.signal.aborted && work.current === controller) setPendingWork(null); }
        if (controller.signal.aborted || work.current !== controller) return;
      }
      setRecipientIds(programs.map((p) => p.id));
      setDetailsReady(fullSnap);
      setWicDetailsReady(fullWic);
      setUtilityDetailsReady(fullUtility);
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
    if (utilityPreparation && !utilityDetailsReady && !startAttempt.current) {
      setStep(1); setAccepted(false); setError(new Error(`Read the ${utilityConfig?.short ?? "utility"} notice and provide known preparation answers before authorizing this request.`)); return;
    }
    const controller=work.current;
    if(!controller||controller.signal.aborted||running.current===controller)return;
    running.current=controller;setPendingWork({ scope, controller });
    let creationAttempted = false;
    let refreshedZip: z.infer<typeof reusableZipSchema> | null = null;
    let refreshedFood: { program: "snap-pa" | "wic-pa"; profile: FamilyProfileSnapshot; details: SnapApplicationFields | WicApplicationFields;
      projection: ReturnType<typeof projectFamilyProfileApplication>; intake: SupportIntake } | null = null;
    try {
      await ensureFamilyOwner();
      if (controller.signal.aborted || work.current !== controller) return;
      if (handoff && startAttempt.current) await checkGuideOwner(controller.signal, startAttempt.current.packet.mandate.expiresAt);
      const retryingSnap = startAttempt.current?.packet.kind === "snap_application";
      const retryingWic = startAttempt.current?.packet.kind === "wic_application";
      const retryingUtility = ["peco_application", "pgw_application", "water_application"].includes(startAttempt.current?.packet.kind ?? "");
      if (!startAttempt.current) {
        if (handoff) await checkFoodAssessment(controller.signal, new Date(Date.now() + 30_000).toISOString());
        if (controller.signal.aborted || work.current !== controller) return;
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
        if (utilityDetailsReady && (!fullUtility || !utilityConfig?.canCollect(window))) {
          setUtilityBlocked(true); authorization.reload();
          throw new Error(`Private ${utilityConfig?.label ?? "utility"} collection is unavailable. Your answers remain on this page; nothing new has been saved.`);
        }
        const utility = utilityDetailsReady && utilityConfig ? utilityConfig.schema.parse(utilityDetails) : undefined;
        if (utility && (recipientIds.length !== 1 || recipientIds[0] !== utilityConfig?.programId)) throw new Error("Private utility answers can be saved only for their exact named program.");
        const wic = wicDetailsReady ? wicApplicationFieldsValueSchema.parse(wicDetails) : undefined;
        if (wic && !recipientIds.includes("wic-pa")) throw new Error("Private WIC answers can be saved only for the named Pennsylvania WIC program.");
        const details=detailsReady?validatedSnapDetails():undefined;
        if (details && !recipientIds.includes("snap-pa")) throw new Error("SNAP application answers can be saved only for the named Pennsylvania SNAP program. Choose that program or return to change your support needs.");
        const profileSource = details ? familySource("snap-pa", details) : wic ? familySource("wic-pa", wic) : utility && utilityConfig ? familySource(utilityConfig.programId, utility) : undefined;
        const owner = z.uuid().safeParse(familyOwner.current ?? intakeOwner.current ?? session.data?.account.id);
        startAttempt.current = {
          key: crypto.randomUUID(),
          packet: {
            intake,
            ...(owner.success ? { expectedOwnerId: owner.data.toLowerCase() } : {}),
            ...(handoff?.descriptionSource ? { descriptionSource: handoff.descriptionSource } : {}),
            mandate: buildMandate(
              intake,
              recipientIds,
              fullAvailable ? mode : "prepare_only",
              booking,
              window.authorization.expiresAt,
              !!utility,
              !!utility,
            ),
            ...(details?{kind:"snap_application" as const,details,noticeVersion:SNAP_APPLICATION_NOTICE_VERSION,...(snapDocumentChosen ? { documentTemplateId: snapDocument } : {})}:{}),
            ...(wic ? { kind: "wic_application" as const, details: wic, noticeVersion: WIC_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true as const } : {}),
            ...(utility && utilityConfig ? { kind: utilityConfig.kind, details: utility, noticeVersion: utilityConfig.noticeVersion, subjectAuthorityDeclared: true as const, accountAuthorityDeclared: true as const } : {}),
            ...(profileSource ? { familyProfileSource: profileSource } : {}),
            ...(reusedZip ? { reusedZip: { sourceRequestId: reusedZip.sourceRequestId, sourceVersion: reusedZip.sourceVersion } } : {}),
          },
        };
      }
      if (retryingSnap) {
        const currentWindow = await readAuthorizationWindow(controller.signal);
        if (controller.signal.aborted || work.current !== controller) return;
        if (!canCollectSnapApplication(currentWindow)) {
          setCollectionBlocked(true); authorization.reload();
          throw new Error("Private SNAP access is unavailable. Your draft and original save attempt stay in this tab. Check access before retrying the same request.");
        }
        setCollectionBlocked(false);
      }
      if (retryingWic) {
        const currentWindow = await readAuthorizationWindow(controller.signal);
        if (controller.signal.aborted || work.current !== controller) return;
        if (!canCollectWicApplication(currentWindow)) {
          setWicBlocked(true); authorization.reload();
          throw new Error("Private WIC access is unavailable. Your exact saved attempt and draft are kept; check access again before retrying it.");
        }
      }
      if (retryingUtility) {
        const currentWindow = await readAuthorizationWindow(controller.signal);
        if (controller.signal.aborted || work.current !== controller) return;
        if (!utilityConfig?.canCollect(currentWindow)) {
          setUtilityBlocked(true); authorization.reload();
          throw new Error(`Private ${utilityConfig?.short ?? "utility"} access is unavailable. Your exact saved attempt and draft are kept; check access again before retrying it.`);
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
          if (!(failure instanceof ParentApiError) || failure.status !== 412 || startUncertain) throw failure;
          const packet = startAttempt.current.packet;
          const profileChanged = failure.message === "Your saved family answers changed or expired before this save. Check the current family profile before trying again.";
          const program = packet.kind === "snap_application" ? "snap-pa" : packet.kind === "wic_application" ? "wic-pa" : undefined;
          const previous = program && familySources.current[program];
          if (profileChanged && program && previous && packet.familyProfileSource && packet.details) {
            creationAttempted = false;
            if (attempt === 1) throw new ParentApiError("Your saved family information is still changing. Your answers are kept; try starting again shortly.", 412);
            const current = await readOwnedFamilyProfile(controller.signal, packet.mandate.expiresAt);
            if (!current?.profile || !current.collection.collectionEnabled || Date.parse(current.collection.expiresAt ?? "") <= Date.now()) {
              setFamilyAccess("unavailable"); throw new ParentApiError("Your saved family information is unavailable. Your draft is kept while access is checked.", 412);
            }
            const next = projectFamilyProfileApplication(current.profile, program, { now: new Date(), ...previous.options,
              ...(program === "wic-pa" ? { wicBeneficiaries: (packet.details as WicApplicationFields).beneficiaries } : {}) });
            const details = structuredClone(packet.details) as SnapApplicationFields | WicApplicationFields;
            const fields: typeof next.fields = [], removed: string[] = [];
            for (const old of matchingFamilyProfileFields(details, previous.projection)) {
              const fresh = next.fields.find(field => field.applicationPath === old.applicationPath);
              replaceFamilyProfileApplicationValue(details, old.applicationPath, fresh ? familyProfileApplicationValue(next.details, fresh.applicationPath) : undefined);
              if (fresh) fields.push(fresh); else removed.push(old.applicationPath);
            }
            const projection = { details: next.details, fields };
            const nextIntake = { ...packet.intake };
            if (program === "snap-pa") {
              if (!packet.reusedZip && previous.projection.fields.some(field => field.applicationPath === "zip") && packet.intake.zip === (packet.details as SnapApplicationFields).zip)
                nextIntake.zip = (details as SnapApplicationFields).zip ?? "";
              if (previous.projection.fields.some(field => field.applicationPath === "language") && packet.intake.language === (packet.details as SnapApplicationFields).language)
                nextIntake.language = ["en", "es"].includes((details as SnapApplicationFields).language ?? "") ? (details as SnapApplicationFields).language as "en" | "es" : initialIntake.language;
            }
            refreshedFood = { program, profile: current.profile, details, projection, intake: nextIntake };
            startAttempt.current.packet = { ...packet, intake: nextIntake, details };
            if (fields.length) startAttempt.current.packet.familyProfileSource = { expectedOwnerId: current.ownerId, revision: current.profile.revision, fields, options: previous.options };
            else delete startAttempt.current.packet.familyProfileSource;
            if (program === "snap-pa" && (!intakeSchema.safeParse(nextIntake).success || !assessSnapApplicationFields(details as SnapApplicationFields, new Date()).nonProtectedDataReadyForReview)) {
              const field = removed[0]?.split(".").at(-1), label = field === "dateOfBirth" ? "date of birth" : field === "zip" ? "household ZIP code" : field === "firstName" || field === "lastName" ? "name" : "application answer";
              startAttempt.current = null; setStartUncertain(false); setDetailsReady(false); setStep(1);
              throw new ParentApiError(`A current ${label} is needed. Your other application answers are kept.`, 412);
            }
            continue;
          }
          if (failure.message !== "Saved routing information changed before this request was created." || !packet.reusedZip) throw failure;
          creationAttempted = false;
          // This specific response proves no request was created; refresh once within the same mandate/key.
          const latest = reusableZipReadSchema.parse(await boundedParentApi("/intake-defaults", {}, controller.signal, startAttempt.current.packet.mandate.expiresAt));
          if (intakeOwner.current !== latest.ownerId.toLowerCase()) { closeChangedFamily(); throw new ParentApiError("Your sign-in changed. Start a fresh request for your current account.", 403); }
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
      if ((status===401||status===403) && (familyOwner.current || intakeOwner.current)) {
        await ensureFamilyOwner().catch(() => {});
        if(controller.signal.aborted||work.current!==controller)return;
      }
      if(handoff && (status===401||status===403)){setGuideSignIn(true);session.reload();}
      setStartUncertain(!!startAttempt.current && (startUncertain || creationAttempted &&
        (status<400||status>=500||status===409||status===401||status===403)));
      if(snapSelected && (status===401||status===403)){setCollectionBlocked(true);authorization.reload();}
      if(wicOnly && (status===401||status===403)){setWicBlocked(true);authorization.reload();}
      if(utilityPreparation && (status===401||status===403)){setUtilityBlocked(true);authorization.reload();}
      setError(
        err instanceof Error
          ? err
          : new Error("We couldn’t save your request. Please try again."),
      );
    } finally {
      if (refreshedFood && !controller.signal.aborted && work.current === controller) {
        familySources.current[refreshedFood.program] = { projection: refreshedFood.projection, options: familySources.current[refreshedFood.program]?.options ?? {} };
        setFamilyProfile(refreshedFood.profile); setIntake(refreshedFood.intake);
        if (refreshedFood.program === "snap-pa") setSnapDetails(refreshedFood.details as SnapApplicationFields);
        else setWicDetails(refreshedFood.details as WicApplicationFields);
      }
      if (refreshedZip && !controller.signal.aborted && work.current === controller) {
        const zip = refreshedZip.value;
        setIntake(current => ({ ...current, zip }));
        setReusedZip(refreshedZip);
      }
      if(running.current===controller)running.current=null;
      if(!controller.signal.aborted&&work.current===controller)setPendingWork(null);
    }
  }
  const localizedIntake = snapSelected || wicNeedsOnly;
  const st = (copy: string) => localizedIntake ? t(copy) : copy;
  return (
    <div className={`${styles.container} ${snapSelected ? styles.snapIntake : ""} ${wicNeedsOnly ? wicStyles.intake : ""}`}>
      <div lang={localizedIntake ? locale : "en"} className={styles.pageTop}>
        <div>
          <h1>{st(directSnap ? "Apply for SNAP" : "Let’s make the next steps easier.")}</h1>
          <p>
            {st("Share what your family needs. You choose what we can handle, and you can change your mind.")}{" "}</p>
        </div>
      </div>
      {snapSelected && <p className={`${styles.hint} ${styles.space}`}>
        {st("You can")}{" "}<a className={styles.textLink} href={SNAP_NEW_APPLICATION_URL} target="_blank" rel="noreferrer">{st("apply directly with Pennsylvania SNAP")}</a> {st("at any time, including before completing these questions. The official application opens in a new tab.")}{" "}</p>}
      {session.loading ? (
        <ParentLoading label="Checking secure access" />
      ) : familyAccess === "changed" ? <section lang={localizedIntake ? locale : "en"} className={styles.surface}><h2>{st("Your sign-in changed")}</h2><p>{st("This tab’s earlier family information was cleared. Start a fresh request for your current account. If an earlier save was unconfirmed, check My support using that earlier sign-in.")}</p><a className={styles.textLink} href={`/get-support${initialNeed ? `?need=${initialNeed}` : ""}`}>{st("Start a fresh request")}</a></section>
      : handoff && (guideSignIn || session.error instanceof ParentApiError && [401, 403].includes(session.error.status)) ? <ParentSignIn {...signInOptions} onSignedIn={async () => {
        const controller = work.current;
        if (!controller || controller.signal.aborted) throw new Error("The request changed. Return to the food questions before continuing.");
        await checkGuideOwner(controller.signal, new Date(Date.now() + 30_000).toISOString());
        if (!controller.signal.aborted) { setGuideSignIn(false); setError(null); session.reload(); }
      }}/>
      : session.error ? (
        <ServiceError
          error={session.error}
          retry={session.reload}
          returnTo={`/get-support${initialNeed ? `?need=${initialNeed}` : ""}`}
        />
      ) : (
        <>
          {familyAccess === "checking" && <ParentLoading label="Checking secure access"/>}
          {familyAccess === "unavailable" && <section lang={localizedIntake ? locale : "en"} className={styles.surface}><h2>{st("We could not recheck your saved family information")}</h2><p>{st("Your draft is kept in this tab. Recheck access before continuing so information stays with the right family.")}</p><button type="button" className={styles.secondary} onClick={() => { void ensureFamilyOwner().catch(() => {}); }}>{st("Recheck secure access")}</button></section>}
          <div hidden={familyAccess !== "ready"}>
          {handoff && step === 1 && <fieldset className={styles.fieldset} disabled={pending || startUncertain}>
            <legend className={styles.legend}>{st("When should CaseLink prioritize this request?")}</legend>
            <p className={styles.hint}>{st(handoff.answers.foodForTwoDays === "no" ? "You said there is not enough food for today and tomorrow. Today is the proposed priority; you can change it." : "Your earlier answer does not establish a deadline. Choose the timing that works for this request.")}</p>
            <label htmlFor="guided-food-timing">{st("Request timing")}</label><select id="guided-food-timing" className={styles.select} value={guideTimingChosen ? intake.urgency : ""} onChange={event => { guideTimingManual.current = true; setGuideTimingChosen(true); change("urgency", event.target.value as SupportIntake["urgency"]); }} required>
              <option value="">{st("Choose a priority")}</option><option value="today">{st("Today")}</option><option value="soon">{st("Soon")}</option><option value="planning">{st("Planning ahead")}</option>
            </select>
          </fieldset>}
          {handoff && step === 2 && guideCheck && <p className={styles.hint}>{st("Food options checked for this account.")}{" "}{st(guideCheck.candidates.some(candidate => candidate.programs.some(program => program.actions.some(action => supportsInitialServiceDelivery(candidate.need, action)))) ? "Any connected action still needs the exact permission below and a current service check." : "No connected sending or booking action was confirmed for these options. The permission below describes preparation; official help stays available.")} {st("Unselected food options have not started.")}</p>}
          <ol lang={localizedIntake ? locale : "en"} className={styles.progress} aria-label={st("Support request steps")}>
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
                  {st(label)}
                </li>
                );
              },
            )}
          </ol>
          <section lang={localizedIntake ? locale : "en"} className={`${styles.surface} ${wicNeedsOnly ? wicStyles.intakeSurface : ""}`}>
            <form lang={snapSelected || wicNeedsOnly && step > 0 ? locale : "en"} className={styles.form} onSubmit={submit}>
              <div className={styles.formHeader}>
                <h2 ref={heading} tabIndex={-1}>
                  {
                    st([
                      "What would help your household?",
                      fullSnap ? "Tell us about your household" : "Your household details, in one place",
                      "You’re in control of what happens next",
                    ][step])
                  }
                </h2>
                <p>
                  {
                    st([
                      "Choose the food or utility support your household needs.",
                      fullSnap ? "Answer the questions that apply to you. CaseLink will use these answers to prepare your application; you can review and correct it afterward. Leave optional or uncertain answers blank." : "Add what you know now so you don’t have to answer the same questions later. You can leave uncertain details blank.",
                      "These are the specific programs and limits for this request. No unknown recipients or open-ended permission.",
                    ][step])
                  }
                </p>
              </div>
              {step === 0 && (
                <>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>{st("Food & benefits")}</legend>
                    <div className={`${styles.choices} ${styles.needChoices}`}>
                      {foodNeeds.map((need) => (
                        <label className={styles.choice} key={need}>
                          <input
                            type="checkbox"
                            checked={intake.needs.includes(need)}
                            onChange={() => toggleNeed(need)}
                          />
                          <span>
                            <strong>{st(NEED_LABELS[need])}</strong>
                            {need === "food_now" && (
                              <small>
                                {st("Find groceries or meals now. This does not start a SNAP application.")}{" "}</small>
                            )}
                            {need === "snap_new" && (
                              <small>
                                {st("A new application for help paying for groceries")}{" "}</small>
                            )}
                            {need === "snap_renewal" && (
                              <small>{st("Keep benefits you already receive")}</small>
                            )}
                            {need === "snap_pending" && (
                              <small>
                                {st("Follow an application you already sent; avoid applying twice")}{" "}</small>
                            )}
                            {need === "snap_problem" && (
                              <small>
                                {st("A notice, missing benefits or another routine issue")}{" "}</small>
                            )}
                            {need === "wic_new" && (
                              <small>
                                {st("Pregnancy, postpartum or a child under five")}{" "}</small>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>{st("Utility bills & service")}</legend>
                    <div className={`${styles.choices} ${styles.needChoices}`}>
                      {utilityNeeds.map(need => <label className={styles.choice} key={need}>
                        <input type="checkbox" checked={intake.needs.includes(need)} onChange={() => toggleNeed(need)}/>
                        <span><strong>{NEED_LABELS[need]}</strong><small>{st("Bill assistance, a shutoff notice or disconnected service")}</small></span>
                      </label>)}
                    </div>
                  </fieldset>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>
                      {st("How soon do you need help?")}{" "}</legend>
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
                          <span>{st(item.label)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
              {step === 1 && (
                <>
                  {snapSelected && authorization.loading ? <ParentLoading label="Checking SNAP application availability"/> : fullSnap ? <>
                    {familyProfile && familyFilled["snap-pa"] ? <p className={styles.hint}>{st("We filled current answers from your saved family information. Change anything that needs correcting. Reuse keeps its original dates.")}{" "}<Link href="/family-profile" className={styles.textLink}>{st("Update family information")}</Link>.</p> : null}
                    <SnapApplicationNotice templateId={snapDocument}/>
                    <SnapDocumentLanguage value={snapDocument} disabled={pending || startUncertain} onChange={value => { setSnapDocument(value); setSnapDocumentChosen(true); setDetailsReady(false); setAccepted(false); setError(null); startAttempt.current=null; }}/>
                    {reusedZip && <div className={styles.notice}>
                      <p>{st("We will use your saved ZIP for support routing:")} {reusedZip.value}.</p>
                      <p>{st("Provided")} {new Date(reusedZip.confirmedAt).toLocaleDateString(locale === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}. {st("This does not fill or change your applicant address. Reuse keeps the original date and expiry.")}</p>
                    </div>}
                    {(reusedZip || intake.zip !== snapValues.zip) && /^\d{5}$/.test(snapValues.zip ?? "") && <button type="button" className={styles.secondary} disabled={pending || startUncertain} onClick={() => { change("zip", snapValues.zip!); setAccepted(false); }}>
                      {st("Use applicant ZIP code for support routing")}
                    </button>}
                    <SnapApplicationFormFields value={snapValues} onChange={changeSnapDetails} disabled={pending}/>
                  </> : <>
                  {snapSelected && <div className={styles.notice}>
                    <p>{st(authorization.loading ? "Checking whether private SNAP application fields are available…" : "Full private SNAP application fields are not available here yet. You can still save minimum routing details and use the official program directly; this does not complete or submit an application.")}</p>
                    {(authorization.error || collectionBlocked) && <button type="button" className={styles.secondary} disabled={pending} onClick={refreshSnapCollection}>{st("Check application availability again")}</button>}
                    <a className={styles.textLink} href={getProgramsForNeeds(["snap_new"])[0].officialUrl}>{st("Open official SNAP help")}</a>
                  </div>}
                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label htmlFor="support-zip">{st("Household ZIP code")}</label>
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
                        {st("Philadelphia is our first service area. We’ll explain any coverage limits.")}{" "}</p>
                      {reusedZip && <p className={styles.hint}>{st("We filled your ZIP code from your saved information, provided")}{" "}{new Date(reusedZip.confirmedAt).toLocaleDateString(wicNeedsOnly && locale === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}{st(". You can change it here. Reuse keeps its original date and expiry.")}</p>}
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="support-language">
                        {st("Preferred service language")}{" "}</label>
                      <select
                        id="support-language"
                        className={styles.select}
                        value={intake.language}
                        onChange={(e) =>
                          change("language", e.target.value as "en" | "es")
                        }
                      >
                        <option value="en">{st("English")}</option>
                        <option value="es">{st("Spanish / Español")}</option>
                      </select>
                      {intake.language === "es" && (
                        <p className={styles.hint}>
                          {localizedIntake ? st("Your service language preference is separate from the screen and official document languages. Language services depend on the program.") : "We’ll record your Spanish preference. This interface is currently in English; Spanish service availability depends on the program."}{" "}</p>
                      )}
                    </div>
                  </div>
                  </>}
                  {wicOnly && authorization.loading ? <ParentLoading label="Checking WIC application availability"/> : fullWic ? <>
                    {familyProfile && <p className={styles.hint}>{st("Current saved contact details can be reused here. Choose any child separately; your saved family information does not choose WIC beneficiaries.")}{" "}<Link href="/family-profile" className={styles.textLink}>{st("Update family information")}</Link>.</p>}
                    <WicApplicationNotice/>
                    <WicApplicationFormFields value={wicDetails} onChange={changeWicDetails} disabled={pending}/>
                    {familyProfile && ["children", "mother_and_children"].includes(wicDetails.beneficiaries ?? "") && <div className={styles.field}>
                      <label htmlFor="wic-saved-child">{st("Add a child from your saved family information")}</label><select id="wic-saved-child" className={styles.select} value="" disabled={pending} onChange={event => { if (event.target.value) chooseSavedWicChild(event.target.value); }}>
                        <option value="">{st("Choose a child, or add their details above")}</option>{(familyProfile.details.members ?? []).filter(person => !wicDetails.children?.some(child => child.id === person.id)).map(person => <option key={person.id} value={person.id}>{[person.firstName, person.lastName].filter(Boolean).join(" ") || st("Saved household member")}</option>)}
                      </select><p className={styles.hint}>{st("Choose only the child or children this WIC request is for. This does not establish eligibility.")}</p>
                    </div>}

                  </> : intake.needs.some(need => need === "wic_new" || need === "wic_continuing") ? <div className={`${styles.notice} ${wicNeedsOnly ? wicStyles.notice : ""}`}><div className={wicNeedsOnly ? wicStyles.availability : undefined}>
                    <p>{st("Private WIC questions are not available for this request.")}{" "}{st(wicOnly ? "Your unsaved WIC answers, if any, remain on this page. You can save minimum routing information when no private draft is pending." : "Combined and continuing requests keep their separate routing; this does not start a new WIC pre-application.")}</p>
                    {wicOnly && <button type="button" className={styles.secondary} disabled={pending} onClick={refreshWicCollection}>{st("Check WIC availability again")}</button>}
                    <a className={styles.textLink} href={getProgramsForNeeds(["wic_new"])[0].officialUrl}>{st("Open official WIC help")}</a>
                  </div></div> : null}
                  {selectedUtilities.length > 0 && <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>{st("Utility routing")}</legend>
                    <fieldset className={styles.fieldset}><legend className={styles.legend}>{st("Utility providers")}</legend>
                      <div className={styles.choices}>
                        {utilityProviderChoices.filter(provider => !provider.need || intake.needs.includes(provider.need)).map(({ id, label }) => <label key={id} className={styles.choice}>
                          <input type="checkbox" checked={intake.utilityProviders.includes(id)} onChange={() => change("utilityProviders", intake.utilityProviders.includes(id) ? intake.utilityProviders.filter(provider => provider !== id) : [...intake.utilityProviders.filter(provider => id !== "unknown" && provider !== "unknown"), id])}/><span>{label}</span>
                        </label>)}
                      </div>
                    </fieldset>
                    <div className={styles.field}><label htmlFor="support-utility-authority">{st("Your authority for the selected utility accounts")}</label><select id="support-utility-authority" className={styles.select} value={intake.accountAuthority} onChange={event => change("accountAuthority", event.target.value as SupportIntake["accountAuthority"])}>
                      <option value="not_sure">{st("Not sure / unanswered")}</option><option value="self">{st("I hold every selected account")}</option><option value="authorized_caregiver">{st("I hold or have permission to help with every selected account")}</option></select></div>
                    {selectedUtilities.length === 1 && <div className={styles.field}><label htmlFor="support-shutoff">{st("Shutoff date, if on a notice")}</label><input id="support-shutoff" className={styles.input} type="date" value={intake.shutoffDate ?? ""} onChange={event => change("shutoffDate", event.target.value || null)}/></div>}
                    <p className={styles.hint}>{st("Use official utility help now if service is at risk. Saving a request does not stop a shutoff or restore service.")}</p>
                    {utilityChoice && <label className={styles.checkbox}><input type="checkbox" checked={utilityPreparation === utilityChoice} onChange={event => {
                      familyDraftChanged.current.utility = false; familyApplied.current.delete(utilityPreparationChoices[utilityChoice].programId); delete familySources.current[utilityPreparationChoices[utilityChoice].programId];
                      setFamilyAccountPerson(""); setFamilyHomeAddress(false); setFamilyPecoPhone("");
                      setUtilityPreparation(event.target.checked ? utilityChoice : null); setUtilityDetails({}); setUtilityDetailsReady(false); setAccepted(false); setError(null); startAttempt.current = null;
                      if (event.target.checked) {
                        setIntake(current => ({ ...current, householdSize: null, incomeAmount: null, incomeFrequency: "unknown" }));
                        if (familyProfile && utilityPreparationChoices[utilityChoice].canCollect(authorization.data)) seedFamilyProfile(familyProfile, utilityPreparationChoices[utilityChoice].programId, intake.accountAuthority);
                      }
                    }}/><span>{utilityPreparationChoices[utilityChoice].optIn}{st(". Keep this a separate, preparation-only request for this named program.")}</span></label>}
                    {utilityChoice && !utilityPreparation && <p className={styles.hint}>{st("Ordinary utility help does not start a benefit application. Choose")}{" "}{utilityPreparationChoices[utilityChoice].label} {st("preparation only if you want CaseLink to save its private answers.")}</p>}
                    {!utilityChoice && <p className={styles.hint}>{st("Private application preparation needs a separate request for one named utility account. This request keeps its selected utility needs.")}</p>}
                  </fieldset>}
                  {utilityPreparation && utilityConfig && (authorization.loading ? <ParentLoading label={`Checking ${utilityConfig.short} preparation availability`}/> : fullUtility ? <>
                    {familyProfile && <fieldset className={styles.fieldset}><legend className={styles.legend}>{st("Use saved family information")}</legend>
                      <p className={styles.hint}>{st(intake.accountAuthority === "self" ? "We filled current saved names and household details for your account." : "Choose the actual account holder below to reuse their saved details.")} {st("Check which address this account serves; an application still needs its specific answers. Reuse keeps original dates.")}{" "}<Link href="/family-profile" className={styles.textLink}>{st("Update family information")}</Link>.</p>
                      {intake.accountAuthority === "authorized_caregiver" && <div className={styles.field}><label htmlFor="utility-saved-holder">{st("Account holder from your saved family information")}</label><select id="utility-saved-holder" className={styles.select} value={familyAccountPerson} disabled={pending} onChange={event => { setFamilyAccountPerson(event.target.value); if (event.target.value) chooseSavedUtility({ accountPersonId: event.target.value }); }}>
                        <option value="">{st("Choose the account holder, or enter their details below")}</option>{[familyProfile.details.primaryPerson, ...(familyProfile.details.members ?? [])].map(person => <option key={person.id} value={person.id}>{[person.firstName, person.lastName].filter(Boolean).join(" ") || "Saved household member"}</option>)}
                      </select></div>}
                      {familyProfile.details.homeAddress?.street && <button type="button" className={styles.secondary} disabled={pending || familyHomeAddress} onClick={() => { chooseSavedUtility({ useHomeAddress: true }); setFamilyHomeAddress(true); }}>{st("Use saved home address for this utility account")}</button>}
                      {utilityPreparation === "peco" && familyProfile.details.contact?.phone && <div className={styles.field}><label htmlFor="peco-saved-phone">{st("Use your saved phone number as")}</label><select id="peco-saved-phone" className={styles.select} value={familyPecoPhone} disabled={pending} onChange={event => { const type = event.target.value as "home" | "cell" | ""; setFamilyPecoPhone(type); if (type) chooseSavedUtility({ pecoPhoneType: type }); }}><option value="">{st("Choose a phone type, or enter a number below")}</option><option value="home">{st("Home phone")}</option><option value="cell">{st("Mobile phone")}</option></select></div>}
                    </fieldset>}
                    {utilityPreparation === "peco" ? <><PecoApplicationNotice/><PecoApplicationFormFields value={utilityDetails as PecoApplicationFields} onChange={changeUtilityDetails} disabled={pending}/></>
                      : utilityPreparation === "pgw" ? <><PgwApplicationNotice/><PgwApplicationFormFields value={utilityDetails as PgwApplicationFields} onChange={changeUtilityDetails} disabled={pending}/></>
                      : <><WaterApplicationNotice/><WaterApplicationFormFields value={utilityDetails as WaterApplicationFields} onChange={changeUtilityDetails} disabled={pending}/></>}
                  </> : <div className={styles.notice}><div><p>{st("Private")}{" "}{utilityConfig.label} {st("preparation is not available or account authority is unresolved. Your unsaved answers remain on this page. Confirm your account authority and check access before entering private answers.")}</p>
                    <button type="button" className={styles.secondary} disabled={pending} onClick={refreshUtilityCollection}>{st("Check")}{" "}{utilityConfig.short} {st("preparation access again")}</button>
                    <a className={styles.textLink} href={utilityConfig.helpUrl}>{st("Open official")}{" "}{utilityConfig.short} {st("help")}</a>
                  </div></div>)}
                  {hasBenefits && !(snapSelected&&authorization.loading) && (!fullSnap || intake.needs.some(need=>need==='wic_new'||need==='wic_continuing')) ? (
                    <fieldset className={styles.fieldset}>
                      <legend className={styles.legend}>
                        {st("Household & income")}{" "}</legend>
                      <p className={styles.hint}>
                        {st("These answers can be reused for the programs you choose. They are optional here; you can still access official help without them.")}{" "}</p>
                      <div className={styles.stack}>
                        {!fullSnap && <div className={styles.field}>
                          <label htmlFor="household-size">
                            {st("People in your household")}{" "}</label>
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
                            {st("Leave blank if you’re not sure who a program will count.")}{" "}</p>
                        </div>}
                        {!fullSnap && <div className={styles.row}>
                          <div className={styles.field}>
                            <label htmlFor="income-amount">
                              {st("Household income before taxes ($)")}{" "}</label>
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
                              {st("Zero income is okay. Leave blank if variable or unknown.")}{" "}</p>
                          </div>
                          <div className={styles.field}>
                            <label htmlFor="income-frequency">
                              {st("How often is that amount received?")}{" "}</label>
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
                              <option value="unknown">{st("Not sure / skip")}</option>
                              <option value="weekly">{st("Weekly")}</option>
                              <option value="biweekly">{st("Every two weeks")}</option>
                              <option value="twice_monthly">
                                {st("Twice a month")}{" "}</option>
                              <option value="monthly">{st("Monthly")}</option>
                              <option value="yearly">{st("Yearly")}</option>
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
                        {st("Names, addresses, dates of birth and required identity numbers belong in a protected application step. Don’t put them in chat or these household fields. We’ll reuse your saved answers; a provider may still require a personal identity check or declaration.")}{" "}</p>
                    </div>
                  )}
                  <div className={styles.field}>
                    <label htmlFor="contact-preference">
                      {st("How would you like support updates?")}{" "}</label>
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
                      <option value="in_app">{st("Only in My support")}</option>
                      <option value="email">{st("Email and My support")}</option>
                    </select>
                    {snapSelected && <p className={styles.hint}>{st(intake.contactPreference === "email" ? "Email and My support" : "Only in My support")}</p>}
                    <p className={styles.hint}>
                      {st("Email availability is confirmed before it’s used. Sensitive details stay in your account.")}{" "}</p>
                  </div>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={adult}
                      onChange={(e) => setAdult(e.target.checked)}
                      required
                    />
                    <span>
                      {st("I’m 18 or older and requesting support for my household or as an authorized caregiver.")}{" "}</span>
                  </label>
                </>
              )}
              {step === 2 && (
                <fieldset className={`${styles.fieldset} ${styles.form}`} disabled={pending || startUncertain}>
                  <div className={`${styles.notice} ${wicNeedsOnly ? wicStyles.mandateNotice : ""}`}>
                    <ShieldCheck width={23} height={23} aria-hidden="true" />
                    <p>
                      <strong>
                        {st(fullAvailable
                          ? "Supported work, within your limits."
                          : "We can prepare. Applications are not connected yet.")}
                      </strong>{" "}
                      {st(fullAvailable
                        ? "Only programs with a verified permitted channel can receive information or carry out applications."
                        : "Your permission covers research and preparation. Nothing is sent, booked or submitted. Official programs remain available directly.")}
                    </p>
                  </div>
                  {(fullSnap && recipientIds.length===1 && recipientIds[0]==='snap-pa' || fullWic && recipientIds.length===1 && recipientIds[0]==='wic-pa' || utilityDetailsReady && recipientIds.length === 1 && recipientIds[0] === utilityConfig?.programId) ? <p><strong>{utilityDetailsReady ? utilityConfig?.label : st(fullWic ? "Pennsylvania WIC" : "Pennsylvania SNAP")}</strong>{" "}{fullWic ? st("is the named program for your prepared WIC answers.") : <>{st("is the named program for your")}{" "}{utilityDetailsReady ? utilityConfig?.purpose : st("application")}.</>}</p> : <fieldset className={styles.fieldset}>
                    <legend className={styles.legend}>
                      {st("Named programs for this request")}{" "}</legend>
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
                            <strong lang={st(program.name) === program.name ? "en" : locale}>{st(program.name)}</strong>
                            <small>
                              {st(connected(program.id)
                                ? "Permitted actions available"
                                : "Prepare only · nothing sent")}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>}
                  <details className={styles.programDetails}>
                    <summary>{st("About these programs & direct access")}</summary>
                    <ul className={styles.programDescriptions}>
                      {programs.map((program) => (
                        <li key={program.id}>
                          <strong>{program.name}</strong>
                        <p lang={wicNeedsOnly || st(program.description) === program.description ? "en" : locale}>{wicNeedsOnly ? program.description : st(program.description)}</p>
                          <a
                            className={styles.textLink}
                            href={program.officialUrl}
                          >
                            {st("Open official program")}{" "}</a>
                        </li>
                      ))}
                    </ul>
                  </details>
                  {fullAvailable && (
                    <fieldset className={styles.fieldset}>
                      <legend className={styles.legend}>
                        {st("What can CaseLink handle?")}{" "}</legend>
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
                              {st("Prepare and carry out permitted steps")}{" "}</strong>
                            <small>
                              {st("Share allowed information, submit supported applications, coordinate appointments and follow up. Required personal acts remain yours.")}{" "}</small>
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
                            <strong>{st("Prepare only")}</strong>
                            <small>
                              {st("Research and prepare without sharing information or submitting anything.")}{" "}</small>
                          </span>
                        </label>
                      </div>
                    </fieldset>
                  )}
                  <div className={styles.mandateList}>
                    <div className={styles.mandateItem}>
                      <Lock width={22} height={22} aria-hidden="true" />
                      <div>
                        <h3>{st("The information we can use")}</h3>
                        <p>
                          {st(utilityDetailsReady ? `Your private ${utilityConfig?.label} answers described in its notice, your household, income, utility and routing information` : wicDetailsReady ? "Your private WIC preparation answers described in the WIC notice, your needs and routing information" : detailsReady ? "Your private SNAP application answers described in the SNAP data notice, your needs and household details" : "Your needs, household details")}
                          {st(intake.needs.some((need) => incomeNeeds.includes(need))
                            ? ", income information when a named program requires it"
                            : "")}{st(", only for this request.")}{" "}{utilityDetailsReady ? "Documents for this named program are included in your preparation permission. Each document still needs separate processing consent in the protected step when available. Do not put documents or required identifiers or account secrets in this form or chat. " : wicNeedsOnly ? `${st("WIC document uploads are not available.")} ` : <>{st("Any bills or notices you later choose to add can be used for the verified needs and named programs, after separate document-processing consent.")}{" "}{intake.needs.some(need => need === "wic_new" || need === "wic_continuing") && "Do not upload WIC documents here. "}</>}{st("No passwords, EBT PINs or signatures.")}{" "}</p>
                      </div>
                    </div>
                    <div className={styles.mandateItem}>
                      <Clock width={22} height={22} aria-hidden="true" />
                      <div>
                        <h3>{st("Up to 30 days · up to 12 attempts")}</h3>
                        <p>{wicNeedsOnly ? <>{locale === "es" ? st("Named programs selected: {count}").replace("{count}", String(recipientIds.length)) : `Limited to the ${recipientIds.length || "selected"} named program${recipientIds.length === 1 ? "" : "s"}`}{st(". We stop future work if you pause, cancel or withdraw permission. Already delivered information may not be recallable.")}</> : st(recipientIds.length === 1 ? "Limited to one named program. We stop future work if you pause, cancel or withdraw permission. Already delivered information may not be recallable." : "Limited to {count} named programs. We stop future work if you pause, cancel or withdraw permission. Already delivered information may not be recallable.").replace("{count}", String(recipientIds.length || st("selected")))}</p>
                      </div>
                    </div>
                    <div className={styles.mandateItem}>
                      <Check width={22} height={22} aria-hidden="true" />
                      <div>
                        <h3>{st("Your personal decisions stay yours")}</h3>
                        <p>
                          {st("No signing as you, accepting payment plans, paying fees or making binding commitments. A program decides eligibility and available assistance.")}{" "}</p>
                      </div>
                    </div>
                  </div>
                  {mode === "full" && fullAvailable && (!fullSnap || intake.needs.some(need=>need!=='snap_new')) && (
                    <div className={styles.field}>
                      <label htmlFor="booking-preference">
                        {st("Appointment preference")}{" "}</label>
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
                        <option value="ask_me">{st("Ask me before booking")}</option>
                        <option value="weekday_morning">
                          {st("Weekday mornings")}{" "}</option>
                        <option value="weekday_afternoon">
                          {st("Weekday afternoons")}{" "}</option>
                        <option value="any_weekday">{st("Any weekday")}</option>
                      </select>
                      <p className={styles.hint}>
                        {st("This does not authorize fees or financial commitments.")}{" "}</p>
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
                      {st("I authorize")}{" "}
                      {st(mode === "full" && fullAvailable
                        ? "the permitted steps described above"
                        : "research and preparation only")}{" "}
                      {st("for this request within these limits. I can stop future work in My support.")}{" "}{detailsReady && st(" I also agree to save and use my private SNAP application answers for this named program under the SNAP data notice.")}
                      {wicDetailsReady && <> {st("I agree to save and use my private WIC answers for Pennsylvania WIC under the WIC notice.")} {st(WIC_SUBJECT_AUTHORITY_STATEMENT)}{locale === "es" && <span lang="en"> ({WIC_SUBJECT_AUTHORITY_STATEMENT})</span>}</>}
                      {utilityDetailsReady && utilityConfig && ` I agree to save and use my private ${utilityConfig.label} answers for this named program under its notice. I authorize household, income, utility and document use for this preparation; each protected document needs its separate processing consent. ${utilityConfig.subjectStatement} ${utilityConfig.accountStatement}`}
                    </span>
                  </label>
                  <p className={styles.hint}>
                    {st("Closing the page or signing out does not cancel your permission. My support shows whether work is running, waiting or unavailable. Your")}{" "}
                    <Link className={styles.textLink} href="/support/privacy">
                      {st("privacy and control options")}{" "}</Link>{" "}
                    {st("are always available.")}{" "}</p>
                </fieldset>
              )}
              {error && (wicNeedsOnly ? <div className={wicStyles.feedback}><ServiceError error={error} /></div> : <ServiceError error={error} />)}
              {startUncertain && <p className={styles.notice}><span>{st("The save result has not been confirmed. Retry the same request before changing answers or starting another request.")}{" "}<Link className={styles.textLink} href="/my-support">{st("Check My support for the saved request")}</Link>.</span></p>}
              <div className={styles.formFooter}>
                {step > 0 ? (
                  <button
                    type="button"
                    className={styles.quiet}
                    onClick={() => {
                      if (handoff && step === 1) { onFoodBack?.(); return; }
                      if (step === 2 && familyProfile) {
                        const program: FamilyProfileApplicationProgram | undefined = fullSnap ? "snap-pa" : fullWic ? "wic-pa" : fullUtility ? utilityConfig?.programId : undefined;
                        if (program) seedFamilyProfile(familyProfile, program, intake.accountAuthority);
                      }
                      setStep((current) => current - 1);
                      setError(null);
                      setAccepted(false);
                      startAttempt.current = null;
                    }}
                    disabled={pending || startUncertain}
                  >
                    <ArrowLeft width={17} height={17} aria-hidden="true" />
                    {st("Back")}{" "}</button>
                ) : (
                  <span className={styles.hint}>
                    {st("You can choose more than one.")}{" "}</span>
                )}
                <button
                  className={styles.button}
                  type="submit"
                  disabled={pending || (step===1 && (snapSelected || wicOnly || !!utilityPreparation) && authorization.loading)}
                >
                  {st(pending
                    ? "Saving your request…"
                    : wicOnly && startUncertain ? "Retry the same WIC request"
                    : utilityPreparation && startUncertain ? `Retry the same ${utilityConfig?.short} request`
                    : step === 2
                      ? "Start getting support"
                      : "Continue")}
                  <ArrowRight width={18} height={18} aria-hidden="true" />
                </button>
              </div>
            </form>
          </section>
          </div>
        </>
      )}
      <div className={styles.section}>
        <UrgentHelp />
      </div>
    </div>
  );
}
