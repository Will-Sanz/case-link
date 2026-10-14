import type { FamilyDetail, PlanStepDetails, PlanStepRow, PlanStepActionItemRow } from "@/types/family";

export type LikelyIdentifierKind =
  | "email"
  | "phone"
  | "government_id"
  | "student_id"
  | "birth_date"
  | "street_address"
  | "person_name";

export type LikelyIdentifierFinding = {
  kind: LikelyIdentifierKind;
  value: string;
  start: number;
  end: number;
};

export type PrivacyFieldInput = {
  field: string;
  label: string;
  value: string | null | undefined;
  mode?: "label" | "narrative";
};

export type PrivacyFieldFinding = LikelyIdentifierFinding & {
  field: string;
  label: string;
};

type Pattern = {
  kind: Exclude<LikelyIdentifierKind, "person_name">;
  expression: RegExp;
};

const PATTERNS: Pattern[] = [
  {
    kind: "email",
    expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    kind: "phone",
    expression: /(?<![\p{L}\d])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![\p{L}\d])/gu,
  },
  {
    kind: "government_id",
    expression: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    kind: "student_id",
    expression:
      /\b(?:student|participant|child|client|case)\s*(?:id|identifier|number|no\.?)\s*[:#-]?\s*[A-Z0-9][A-Z0-9-]{3,}\b/gi,
  },
  {
    kind: "birth_date",
    expression:
      /\b(?:date\s+of\s+birth|d\.?o\.?b\.?|born)\s*[:#-]?\s*(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/gi,
  },
  {
    kind: "street_address",
    expression:
      /\b\d{1,6}\s+(?:[A-Z0-9][A-Z0-9.'-]*\s+){0,5}(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|place|pl\.?|way|circle|terrace|trail)\b/gi,
  },
];

const PERSON_NAME =
  /(?<!\p{L})\p{Lu}\p{Ll}{1,30}(?:[-'’]\p{Lu}?\p{Ll}{1,30})?\s+\p{Lu}\p{Ll}{1,30}(?:[-'’]\p{Lu}?\p{Ll}{1,30})?(?!\p{L})/gu;

const LABEL_PERSON_NAME = /^[\p{L}][\p{L}'’-]{1,30}(?:\s+[\p{L}][\p{L}'’-]{1,30}){1,2}$/u;

const EXPLICIT_PERSON_NAME =
  /\b(?:(?:student|child|parent|mother|father|guardian|participant|client|family)\s+(?:name\s*)?|name\s*)(?:is\s+|:\s*)([\p{L}][\p{L}'’-]{1,30}\s+[\p{L}][\p{L}'’-]{1,30})/giu;

const PERSON_CONTEXT_AFTER =
  /^(?:,\s*)?(?:age\b|needs?\b|lives?\b|called\b|reported\b|said\b|has\b|is\b|was\b|will\b|can(?:not|'t)?\b|attends?\b|was\s+born\b)/i;

const SAFE_NAME_WORDS = new Set([
  "access",
  "anonymous",
  "authority",
  "benefits",
  "case",
  "center",
  "childcare",
  "city",
  "community",
  "department",
  "education",
  "emergency",
  "employment",
  "family",
  "financial",
  "food",
  "group",
  "health",
  "help",
  "homeless",
  "household",
  "housing",
  "legal",
  "mental",
  "north",
  "office",
  "outreach",
  "plan",
  "program",
  "school",
  "service",
  "south",
  "stability",
  "support",
  "team",
  "transportation",
  "west",
]);

function addRegexFindings(
  text: string,
  kind: LikelyIdentifierKind,
  expression: RegExp,
  findings: LikelyIdentifierFinding[],
): void {
  expression.lastIndex = 0;
  for (const match of text.matchAll(expression)) {
    const value = match[0];
    const start = match.index ?? 0;
    findings.push({ kind, value, start, end: start + value.length });
  }
}

function looksLikeAllowedPhrase(value: string): boolean {
  const words = value.toLowerCase().split(/\s+/).filter(Boolean);
  return words.some((word) => SAFE_NAME_WORDS.has(word));
}

function addPersonNameFindings(
  text: string,
  mode: "label" | "narrative",
  findings: LikelyIdentifierFinding[],
): void {
  const label = text.trim().replace(/\s+\d+$/, "");
  if (mode === "label" && LABEL_PERSON_NAME.test(label) && !looksLikeAllowedPhrase(label)) {
    const start = text.indexOf(label);
    findings.push({ kind: "person_name", value: label, start, end: start + label.length });
  }
  EXPLICIT_PERSON_NAME.lastIndex = 0;
  for (const match of text.matchAll(EXPLICIT_PERSON_NAME)) {
    const value = match[1];
    if (!value || looksLikeAllowedPhrase(value)) continue;
    const whole = match[0];
    const withinMatch = whole.lastIndexOf(value);
    // Lowercase prose such as "parent is awaiting confirmation" is not a named-person field.
    if (!/\bname\b|:/i.test(whole.slice(0, withinMatch)) && !/^\p{Lu}/u.test(value)) continue;
    const start = (match.index ?? 0) + Math.max(0, withinMatch);
    findings.push({ kind: "person_name", value, start, end: start + value.length });
  }

  PERSON_NAME.lastIndex = 0;
  for (const match of text.matchAll(PERSON_NAME)) {
    const value = match[0];
    if (looksLikeAllowedPhrase(value)) continue;
    const start = match.index ?? 0;
    if (
      mode === "narrative" &&
      !PERSON_CONTEXT_AFTER.test(text.slice(start + value.length).trimStart())
    ) {
      continue;
    }
    findings.push({ kind: "person_name", value, start, end: start + value.length });
  }
}

/**
 * Lightweight MVP safeguard for likely direct identifiers. This intentionally errs on the side of
 * review and is not a guarantee that text is de-identified.
 */
export function findLikelyIdentifiers(
  text: string,
  mode: "label" | "narrative" = "narrative",
): LikelyIdentifierFinding[] {
  const findings: LikelyIdentifierFinding[] = [];
  for (const pattern of PATTERNS) {
    addRegexFindings(text, pattern.kind, pattern.expression, findings);
  }
  addPersonNameFindings(text, mode, findings);

  return findings
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter(
      (finding, index, all) => {
        if (
          finding.kind === "person_name" &&
          all.some(
            (candidate) =>
              candidate.kind !== "person_name" &&
              candidate.start <= finding.start &&
              candidate.end >= finding.end,
          )
        ) {
          return false;
        }
        return (
          all.findIndex(
            (candidate) =>
              candidate.start === finding.start &&
              candidate.end === finding.end &&
              candidate.value.toLowerCase() === finding.value.toLowerCase(),
          ) === index
        );
      },
    );
}

export function findLikelyIdentifiersInFields(
  fields: PrivacyFieldInput[],
): PrivacyFieldFinding[] {
  return fields.flatMap((field) =>
    findLikelyIdentifiers(field.value ?? "", field.mode).map((finding) => ({
      ...finding,
      field: field.field,
      label: field.label,
    })),
  );
}

export function noPiiErrorMessage(findings: PrivacyFieldFinding[]): string | null {
  if (findings.length === 0) return null;
  const first = findings[0];
  const values = [...new Set(findings.map((finding) => finding.value.trim()))]
    .slice(0, 3)
    .map((value) => `“${value.replace(/\s+/g, " ")}”`)
    .join(", ");
  return `Remove likely identifying text from ${first.label}: ${values}. Use a non-identifying case label and general context only.`;
}

export function validateNoPii(fields: PrivacyFieldInput[]): {
  ok: boolean;
  findings: PrivacyFieldFinding[];
  error: string | null;
} {
  const findings = findLikelyIdentifiersInFields(fields);
  return { ok: findings.length === 0, findings, error: noPiiErrorMessage(findings) };
}

function textPrivacyFields(value: unknown, field: string, label: string): PrivacyFieldInput[] {
  if (typeof value === "string") return [{field,label,value}];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key,child])=>textPrivacyFields(child,`${field}.${key}`,label));
}

/** Directory contacts are source-validated separately and never sent as narrative to AI. */
export function planDetailsPrivacyFields(details: PlanStepDetails | null | undefined, prefix: string): PrivacyFieldInput[] {
  const narrative = {...details};
  delete narrative.contacts;
  return textPrivacyFields(narrative,prefix,"Plan details");
}

export function planStepPrivacyFields(step: Pick<PlanStepRow,"title" | "description" | "details" | "workflow_data"> & {
  action_items?: Array<Pick<PlanStepActionItemRow,"title" | "description" | "notes" | "outcome">>;
}, prefix: string): PrivacyFieldInput[] {
  return [
    {field:`${prefix}.title`,label:"Action title",value:step.title},
    {field:`${prefix}.description`,label:"Action description",value:step.description},
    ...planDetailsPrivacyFields(step.details,`${prefix}.details`),
    ...textPrivacyFields(step.workflow_data,`${prefix}.workflow_data`,"Action progress"),
    ...(step.action_items ?? []).flatMap((action,index)=>textPrivacyFields({title:action.title,description:action.description,notes:action.notes,outcome:action.outcome},`${prefix}.action_items.${index}`,"Action text")),
  ];
}

/** User-authored family and plan text, including historical content that might enter a later request. */
export function familyPrivacyFields(detail: FamilyDetail): PrivacyFieldInput[] {
  return [
    { field: "name", label: "Family label", value: detail.name, mode: "label" },
    { field: "summary", label: "Family summary", value: detail.summary },
    {
      field: "household_notes",
      label: "Current circumstances",
      value: detail.household_notes,
    },
    ...detail.goals.map((goal, index) => ({
      field: `goals.${index}.label`,
      label: "Goal",
      value: goal.label,
    })),
    ...detail.barriers.map((barrier, index) => ({
      field: `barriers.${index}.label`,
      label: "Barrier",
      value: barrier.label,
    })),
    ...detail.members.flatMap((member, index) => [
      {
        field: `members.${index}.display_name`,
        label: "Household member label",
        value: member.display_name,
        mode: "label" as const,
      },
      {
        field: `members.${index}.notes`,
        label: "Household member notes",
        value: member.notes,
      },
    ]),
    ...detail.caseNotes.map((note, index) => ({
      field: `caseNotes.${index}.body`,
      label: "Case note",
      value: note.body,
    })),
    {field:"plan.summary",label:"Plan summary",value:detail.plan?.summary},
    ...textPrivacyFields(detail.plan?.client_display, "plan.client_display", "Plan display text"),
    ...(detail.plan?.steps ?? []).flatMap((step,index)=>planStepPrivacyFields(step,`plan.steps.${index}`)),
    ...(detail.progressUpdates ?? []).flatMap((update, updateIndex) => [
      {
        field: `progressUpdates.${updateIndex}.summary`,
        label: "Progress update",
        value: update.summary,
      },
      ...update.plan_changes.flatMap((change, changeIndex) => [
        {
          field: `progressUpdates.${updateIndex}.changes.${changeIndex}.notes`,
          label: "Progress action note",
          value: change.current.notes,
        },
        {
          field: `progressUpdates.${updateIndex}.changes.${changeIndex}.outcome`,
          label: "Progress action outcome",
          value: change.current.outcome,
        },
      ]),
    ]),
  ];
}

export function validateFamilyNoPii(
  detail: FamilyDetail,
  additionalFields: PrivacyFieldInput[] = [],
): ReturnType<typeof validateNoPii> {
  return validateNoPii([...familyPrivacyFields(detail), ...additionalFields]);
}
