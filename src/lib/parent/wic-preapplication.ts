import { z } from "zod";
import contract from "../../../data/verified-forms/wic-pa-preapplication-2026-11-13.json";
import { wicApplicationFieldsShape, wicContactFieldsSchema, wicPersonFieldsSchema, wicFieldConditions } from "./wic-application-fields";

export const WIC_PREAPPLICATION_CONTRACT = contract;
export const WIC_PREAPPLICATION_ERROR = "The fictional WIC preparation could not be checked from the supplied information.";

const fields = contract.fields;
const inputSchema = z.object({
  ...wicApplicationFieldsShape,
  kind: z.literal("synthetic_rehearsal"),
  contact: wicContactFieldsSchema.extend({ zip: z.string().regex(/^191\d{2}$/).optional() }).strict().optional(),
  children: z.array(wicPersonFieldsSchema).max(30).optional(),
}).strict().superRefine(wicFieldConditions);
export type WicPreapplicationInput = z.infer<typeof inputSchema>;
const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const displayedDate = (value: string) => `${value.slice(5, 7)}/${value.slice(8)}/${value.slice(0, 4)}`;

/** Offline fictional preparation only; no input reaches collection, storage, models or the provider. */
export function prepareWicPreapplication(input: unknown, now: Date) {
  try {
    if (!Number.isFinite(now.getTime()) || now.getTime() < Date.parse(contract.sourceCheckedAt) || now.getTime() >= Date.parse(contract.verifiedUntil))
      throw new Error();
    const value = inputSchema.parse(input);
    const today = localDate.format(now);
    if ([value.contact, value.mother, ...(value.children ?? [])].some(person => person?.dateOfBirth && person.dateOfBirth > today)) throw new Error();
    const preparedFields: Record<string, string | boolean> = {};
    const missingFactGroups: { group: string; fields: string[] }[] = [];
    const missing = (group: string, names: string[]) => {
      if (names.length) missingFactGroups.push({ group, fields: names });
    };
    const set = (id: string, item: string | undefined, isDate = false) => {
      if (item !== undefined) preparedFields[id] = isDate ? displayedDate(item) : item;
    };
    missing("application_type", value.applicationType ? [] : ["applicationType"]);
    if (value.applicationType) preparedFields[contract.applicationTypes[value.applicationType].id] = true;
    missing("beneficiaries", value.beneficiaries ? [] : ["beneficiaries"]);
    if (value.beneficiaries) {
      preparedFields[contract.beneficiaryControls.mother] = value.beneficiaries !== "children";
      preparedFields[contract.beneficiaryControls.children] = value.beneficiaries !== "mother";
    }
    missing("contact", ["firstName", "lastName", "street", "city", "zip", "county", "email", "phone", "dateOfBirth"].filter(key =>
      value.contact?.[key as keyof NonNullable<typeof value.contact>] === undefined).map(key => `contact.${key}`));
    set(fields.contactFirstName.id, value.contact?.firstName);
    set(fields.contactLastName.id, value.contact?.lastName);
    set(fields.street.id, value.contact?.street);
    set(fields.city.id, value.contact?.city);
    set(fields.zip.id, value.contact?.zip);
    if (value.contact?.county) preparedFields[fields.county.id] = fields.county.value;
    set(fields.email.id, value.contact?.email);
    set(fields.phone.id, value.contact?.phone);
    set(fields.contactBirthDate.id, value.contact?.dateOfBirth, true);
    missing("appointment_preference", value.appointmentPreference ? [] : ["appointmentPreference"]);
    if (value.appointmentPreference) preparedFields[contract.appointmentPreferences[value.appointmentPreference].id] = true;
    if (["mother", "mother_and_children"].includes(value.beneficiaries ?? "")) {
      missing("mother", ["firstName", "lastName", "dateOfBirth", "status"].filter(key =>
        value.mother?.[key as keyof NonNullable<typeof value.mother>] === undefined).map(key => `mother.${key}`));
      set(fields.motherFirstName.id, value.mother?.firstName);
      set(fields.motherLastName.id, value.mother?.lastName);
      set(fields.motherBirthDate.id, value.mother?.dateOfBirth, true);
      if (value.mother?.status) preparedFields[contract.motherStatuses[value.mother.status].id] = true;
      if (value.mother?.status === "pregnant") {
        missing("pregnancy_date", value.mother.expectedDeliveryDate ? [] : ["mother.expectedDeliveryDate"]);
        set(fields.expectedDeliveryDate.id, value.mother.expectedDeliveryDate, true);
      }
    }
    const childRows: Record<string, string>[] = [];
    if (["children", "mother_and_children"].includes(value.beneficiaries ?? "")) {
      missing("children", value.children?.length ? [] : ["children"]);
      for (const [index, child] of (value.children ?? []).entries()) {
        missing(`child_${index + 1}`, ["firstName", "lastName", "dateOfBirth"].filter(key =>
          child[key as keyof typeof child] === undefined).map(key => `children.${index}.${key}`));
        const row: Record<string, string> = {};
        if (child.firstName !== undefined) row[fields.childFirstName.id] = child.firstName;
        if (child.lastName !== undefined) row[fields.childLastName.id] = child.lastName;
        if (child.dateOfBirth !== undefined) row[fields.childBirthDate.id] = displayedDate(child.dateOfBirth);
        childRows.push(row);
      }
    }
    return {
      kind: "fictional_only_preparation" as const,
      contractId: contract.id, contractVersion: contract.version,
      sourceCheckedAt: contract.sourceCheckedAt, verifiedUntil: contract.verifiedUntil,
      preparedFields, childRows, missingFactGroups,
      preparationFieldsComplete: missingFactGroups.length === 0,
      personalAcknowledgment: { id: contract.acknowledgment.id, text: contract.acknowledgment.text, state: "not_recorded" as const },
      submissionReady: false as const, callbackRequest: "not_sent" as const,
      appointment: "unconfirmed" as const, enrollment: "unconfirmed" as const,
      unverifiedRequirements: ["backend_validation_and_omitted_fields", "permitted_delegation_and_delivery", "receipt_and_unknown_delivery_reconciliation", "appointment_and_enrollment_evidence"],
    };
  } catch {
    throw new Error(WIC_PREAPPLICATION_ERROR);
  }
}
