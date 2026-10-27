import { z } from "zod";

export const NEEDS = [
  "food_now",
  "snap_new",
  "snap_renewal",
  "snap_pending",
  "snap_problem",
  "wic_new",
  "wic_continuing",
  "electricity",
  "gas",
  "water",
] as const;
export const needSchema = z.enum(NEEDS);
export type SupportNeed = z.infer<typeof needSchema>;
export const NEED_LABELS: Record<SupportNeed, string> = {
  food_now: "Food for now",
  snap_new: "Apply for SNAP",
  snap_renewal: "Renew SNAP",
  snap_pending: "Check a SNAP application",
  snap_problem: "Help with SNAP benefits",
  wic_new: "Apply for WIC",
  wic_continuing: "Continue WIC support",
  electricity: "Electric bill",
  gas: "Gas bill",
  water: "Water bill",
};
export const intakeSchema = z
  .object({
    needs: z
      .array(needSchema)
      .min(1)
      .max(10)
      .refine((v) => new Set(v).size === v.length, "Choose each need once."),
    urgency: z.enum(["today", "soon", "planning"]),
    zip: z.string().regex(/^\d{5}$/, "Enter a five-digit ZIP code."),
    language: z.enum(["en", "es"]),
    householdSize: z.number().int().min(1).max(30).nullable(),
    childrenUnderFive: z.boolean().nullable(),
    pregnantOrPostpartum: z.boolean().nullable(),
    incomeAmount: z.number().finite().min(0).max(1000000).nullable(),
    incomeFrequency: z.enum([
      "weekly",
      "biweekly",
      "twice_monthly",
      "monthly",
      "yearly",
      "unknown",
    ]),
    utilityProviders: z
      .array(z.enum(["peco", "pgw", "pwd", "other", "unknown"]))
      .max(5),
    shutoffDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    accountAuthority: z.enum(["self", "authorized_caregiver", "not_sure"]),
    contactPreference: z.enum(["in_app", "email"]),
    adultConfirmed: z.literal(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.incomeAmount !== null && v.incomeFrequency === "unknown")
      ctx.addIssue({
        code: "custom",
        path: ["incomeFrequency"],
        message:
          "Choose how often this income is received, or leave the amount blank.",
      });
    if (v.shutoffDate) {
      if (
        v.needs.filter((need) => ["electricity", "gas", "water"].includes(need))
          .length !== 1
      )
        ctx.addIssue({
          code: "custom",
          path: ["shutoffDate"],
          message:
            "A shutoff date must identify one utility account. Add account-specific notices or facts for combined requests.",
        });
      const parsed = new Date(v.shutoffDate + "T12:00:00Z");
      if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== v.shutoffDate
      )
        ctx.addIssue({
          code: "custom",
          path: ["shutoffDate"],
          message: "Enter a real shutoff date.",
        });
    }
  });
export type SupportIntake = z.infer<typeof intakeSchema>;

export const actionSchema = z.enum([
  "research",
  "prepare",
  "share",
  "submit",
  "schedule",
  "follow_up",
]);
export type SupportAction = z.infer<typeof actionSchema>;
export const mandateSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["full", "prepare_only"]),
    recipientIds: z
      .array(z.string().regex(/^[a-z0-9-]{1,60}$/))
      .min(1)
      .max(12),
    allowedActions: z.array(actionSchema).min(1).max(6),
    allowedData: z
      .array(z.enum(["household", "income", "utility", "documents"]))
      .min(1)
      .max(4),
    expiresAt: z.iso.datetime(),
    maxAttempts: z.number().int().min(1).max(24),
    maxRecipients: z.number().int().min(1).max(12),
    bookingPreference: z.enum([
      "ask_me",
      "weekday_morning",
      "weekday_afternoon",
      "any_weekday",
    ]),
    accepted: z.literal(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.recipientIds).size !== v.recipientIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["recipientIds"],
        message: "Recipients must be unique.",
      });
    if (v.recipientIds.length > v.maxRecipients)
      ctx.addIssue({
        code: "custom",
        path: ["maxRecipients"],
        message: "The recipient limit must include the named programs.",
      });
    if (
      v.mode === "prepare_only" &&
      v.allowedActions.some((a) => !["research", "prepare"].includes(a))
    )
      ctx.addIssue({
        code: "custom",
        path: ["allowedActions"],
        message: "Preparation-only permission cannot share or submit.",
      });
  });
export type ServiceMandate = z.infer<typeof mandateSchema>;
export const outcomeSchema = z.enum([
  "checking",
  "prepared",
  "sent",
  "partner_received",
  "partner_accepted",
  "agency_submitted",
  "assistance_approved",
  "support_received",
  "declined",
  "unresolved",
  "withdrawn",
]);
export type OutcomeState = z.infer<typeof outcomeSchema>;
export const OUTCOME_LABELS: Record<OutcomeState, string> = {
  checking: "Checking options",
  prepared: "Prepared",
  sent: "Sent",
  partner_received: "Partner received",
  partner_accepted: "Partner accepted",
  agency_submitted: "Application submitted",
  assistance_approved: "Assistance approved",
  support_received: "Support received",
  declined: "Declined",
  unresolved: "Still unresolved",
  withdrawn: "Withdrawn",
};
export type NecessaryAction = {
  id: string;
  need: SupportNeed;
  reason:
    | "missing_fact"
    | "expanded_permission"
    | "personal_step"
    | "meaningful_choice"
    | "qualified_help"
    | "execution_issue";
  title: string;
  explanation: string;
  resolver?: "parent" | "operator" | "partner";
  field?: string;
  url?: string;
  resolved?: boolean;
};
export type SupportRoute = {
  need: SupportNeed;
  programId: string;
  title: string;
  summary: string;
  state: OutcomeState;
  nextActor: "caselink" | "parent" | "partner" | "agency";
  officialUrl: string;
  sourceUrl: string;
  steps: string[];
  limitation: string | null;
};
export type SupportPlan = {
  version: 1;
  summary: string;
  routes: SupportRoute[];
  generatedAt: string;
  model: string | null;
};
export type SupportEvent = {
  id: string;
  request_id: string;
  kind: string;
  actor: string;
  summary: string;
  created_at: string;
  evidence?: Record<string, unknown>;
};
export type ParentDocument = {
  id: string;
  request_id: string;
  filename: string;
  media_type: string;
  size_bytes: number;
  status: string;
  expires_at: string;
  created_at: string;
};
export type SupportRequest = {
  id: string;
  household_id: string;
  status: "active" | "paused" | "cancelled" | "closed";
  intake: SupportIntake;
  mandate: ServiceMandate;
  plan: SupportPlan | null;
  required_actions: NecessaryAction[];
  version: number;
  facts?: {
    need: SupportNeed;
    field: string;
    value: unknown;
    source: "parent";
    confirmedAt: string;
    asOf: string;
  }[];
  created_at: string;
  updated_at: string;
  next_actor?: string | null;
  next_trigger?: string | null;
  next_run_at?: string | null;
  events?: SupportEvent[];
  events_truncated?: boolean;
  account_changed_at?: Partial<Record<SupportNeed, string>>;
  intake_confirmed_at?: Partial<Record<keyof SupportIntake, string>>;
  intake_need_scoped_fields?: string[];
  documents?: ParentDocument[];
};
export type ParentPreferences = {
  contactPreference: "in_app" | "email";
  language: "en" | "es";
  quietHoursStart: number;
  quietHoursEnd: number;
};

export function monthlyIncome(
  amount: number,
  frequency: SupportIntake["incomeFrequency"],
): number | null {
  const factors = {
    weekly: 52 / 12,
    biweekly: 26 / 12,
    twice_monthly: 2,
    monthly: 1,
    yearly: 1 / 12,
    unknown: 0,
  };
  if (!Number.isFinite(amount) || amount < 0 || frequency === "unknown")
    return null;
  return Math.round(amount * factors[frequency] * 100) / 100;
}
