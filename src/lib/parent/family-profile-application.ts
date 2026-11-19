import { familyProfileSnapshotSchema, type FamilyProfileDetails, type FamilyProfileSnapshot } from "./family-profile";
import { snapApplicationFieldsValueSchema, type SnapApplicationFields } from "./snap-application-fields";
import { wicApplicationFieldsValueSchema, type WicApplicationFields } from "./wic-application-fields";
import { pecoApplicationFieldsValueSchema, type PecoApplicationFields } from "./peco-application-fields";
import { pgwApplicationFieldsValueSchema, type PgwApplicationFields } from "./pgw-application-fields";
import { waterApplicationFieldsValueSchema, type WaterApplicationFields } from "./water-application-fields";

export type FamilyProfileApplicationProgram = "snap-pa" | "wic-pa" | "peco-cap" | "pgw-crp" | "pwd-tap";
export type FamilyProfileApplicationDetails = SnapApplicationFields | WicApplicationFields | PecoApplicationFields | PgwApplicationFields | WaterApplicationFields;
export type FamilyProfileApplicationField = { applicationPath: string; profilePaths: string[] };
export type FamilyProfileApplicationOptions = {
  now: Date; accountAuthority?: "self" | "authorized_caregiver" | "not_sure"; accountPersonId?: string;
  useHomeAddress?: boolean; wicBeneficiaries?: WicApplicationFields["beneficiaries"]; wicChildIds?: string[];
  pecoPhoneType?: "home" | "cell";
};
type ObjectValue = Record<string, unknown>;
const schemas = { "snap-pa": snapApplicationFieldsValueSchema, "wic-pa": wicApplicationFieldsValueSchema,
  "peco-cap": pecoApplicationFieldsValueSchema, "pgw-crp": pgwApplicationFieldsValueSchema, "pwd-tap": waterApplicationFieldsValueSchema };

/** Paths use stable person IDs; income inventories remain indivisible facts. */
export function familyProfileApplicationValue(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) current = current.find(item => item && typeof item === "object" && item.id === part);
    else if (current && typeof current === "object") current = (current as ObjectValue).id === part ? current : (current as ObjectValue)[part];
    else return undefined;
  }
  return current;
}

/** Mutate only the selected leaf in a cloned draft; person paths select stable IDs. */
export function replaceFamilyProfileApplicationValue(value: unknown, path: string, answer: unknown): void {
  const parts = path.split("."), parent = parts.length === 1 ? value : familyProfileApplicationValue(value, parts.slice(0, -1).join("."));
  if (parent && typeof parent === "object" && !Array.isArray(parent)) {
    if (answer === undefined) delete (parent as Record<string, unknown>)[parts.at(-1)!];
    else (parent as Record<string, unknown>)[parts.at(-1)!] = structuredClone(answer);
  }
}

/** Checked shared facts only; this supplies no beneficiary, account, completeness, eligibility or income-period decision. */
export function projectFamilyProfileApplication(input: FamilyProfileSnapshot, programId: FamilyProfileApplicationProgram, options: FamilyProfileApplicationOptions) {
  const profile = familyProfileSnapshotSchema.parse(input), at = options.now.getTime();
  if (!Number.isFinite(at)) throw new Error("A current profile assessment time is required.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(options.now);
  const details: ObjectValue = {}, fields: FamilyProfileApplicationField[] = [];
  const fresh = (path: string) => {
    const source = profile.provenance[path];
    return source && Date.parse(source.confirmedAt) <= at && at < Date.parse(source.expiresAt);
  };
  const add = (target: ObjectValue, key: string, targetPath: string, sourcePaths: string[], value: unknown) => {
    if (value === undefined || !sourcePaths.length || !sourcePaths.every(fresh)) return;
    target[key] = structuredClone(value);
    if (schemas[programId].safeParse(details).success) fields.push({ applicationPath: targetPath, profilePaths: [...sourcePaths] });
    else delete target[key];
  };
  const copy = (target: ObjectValue, key: string, targetPath: string, sourcePath: string) =>
    add(target, key, targetPath, [sourcePath], familyProfileApplicationValue(profile.details, sourcePath));
  const person = (source: FamilyProfileDetails["primaryPerson"], sourcePath: string, target: ObjectValue, targetPath: string, settings: { fullName?: boolean; birth?: boolean; middle?: boolean; relationship?: boolean; income?: boolean } = {}) => {
    if (settings.fullName) add(target, "name", `${targetPath}.name`, [`${sourcePath}.firstName`, `${sourcePath}.lastName`],
      source.firstName && source.lastName ? `${source.firstName} ${source.lastName}` : undefined);
    else for (const key of ["firstName", "lastName", ...(settings.middle ? ["middleInitial"] as const : [])]) copy(target, key, `${targetPath}.${key}`, `${sourcePath}.${key}`);
    if (settings.birth) copy(target, "dateOfBirth", `${targetPath}.dateOfBirth`, `${sourcePath}.dateOfBirth`);
    if (settings.relationship) copy(target, "relationship", `${targetPath}.relationship`, `${sourcePath}.relationship`);
    if (settings.income) copy(target, "income", `${targetPath}.income`, `${sourcePath}.income`);
  };
  const street = (address: NonNullable<FamilyProfileDetails["homeAddress"]>, path: string) => {
    const keys = ["street", ...(address.apartment ? ["apartment"] : [])];
    return { paths: keys.map(key => `${path}.${key}`), value: address.street ? keys.map(key => address[key as keyof typeof address]).join(", ") : undefined };
  };
  const postal = profile.details.mailingAddressSameAsHome === true
    ? { value: profile.details.homeAddress, path: "homeAddress", extra: ["mailingAddressSameAsHome"] }
    : { value: profile.details.mailingAddress, path: "mailingAddress", extra: [] };
  if (programId === "snap-pa") {
    const applicant: ObjectValue = {}; details.applicant = applicant;
    person(profile.details.primaryPerson, "primaryPerson", applicant, "applicant", { middle: true });
    const household: ObjectValue[] = [{ id: profile.details.primaryPerson.id, relationship: "SELF" }]; details.household = household;
    person(profile.details.primaryPerson, "primaryPerson", household[0], `household.${profile.details.primaryPerson.id}`, { birth: true, middle: true });
    for (const member of profile.details.members ?? []) {
      const row: ObjectValue = { id: member.id }; household.push(row);
      person(member, `members.${member.id}`, row, `household.${member.id}`, { birth: true, middle: true, relationship: true });
    }
    const address = profile.details.homeAddress;
    if (address) {
      const target: ObjectValue = {}; details.address = target; const joined = street(address, "homeAddress");
      add(target, "street", "address.street", joined.paths, joined.value);
      for (const key of ["city", "state"] as const) copy(target, key, `address.${key}`, `homeAddress.${key}`);
      for (const key of ["zip", "county"] as const) copy(details, key, key, `homeAddress.${key}`);
    }
    copy(details, "phone", "phone", "contact.phone");
    copy(details, "language", "language", "preferredLanguage");
    if (profile.details.preferredLanguage === "other") copy(details, "otherLanguage", "otherLanguage", "otherLanguage");
  } else if (programId === "wic-pa") {
    const contact: ObjectValue = {}; details.contact = contact;
    person(profile.details.primaryPerson, "primaryPerson", contact, "contact", { birth: true });
    copy(contact, "phone", "contact.phone", "contact.phone"); copy(contact, "email", "contact.email", "contact.email");
    if (postal.value) {
      const joined = street(postal.value, postal.path);
      add(contact, "street", "contact.street", [...postal.extra, ...joined.paths], joined.value);
      for (const key of ["city", "zip", "county"] as const) add(contact, key, `contact.${key}`, [...postal.extra, `${postal.path}.${key}`], postal.value[key]);
    }
    if (["children", "mother_and_children"].includes(options.wicBeneficiaries ?? "") && options.wicChildIds?.length) {
      details.beneficiaries = options.wicBeneficiaries; const children: ObjectValue[] = []; details.children = children;
      for (const child of profile.details.members ?? []) if (options.wicChildIds.includes(child.id)) {
        const row: ObjectValue = { id: child.id }; children.push(row);
        person(child, `members.${child.id}`, row, `children.${child.id}`, { birth: true });
      }
    }
  } else {
    const primary = profile.details.primaryPerson;
    const selected = options.accountAuthority === "self" ? primary : options.accountAuthority === "authorized_caregiver"
      ? [primary, ...(profile.details.members ?? [])].find(value => value.id === options.accountPersonId) : undefined;
    if (selected) {
      const sourcePath = selected.id === primary.id ? "primaryPerson" : `members.${selected.id}`;
      const key = programId === "pgw-crp" ? "customer" : "applicant", target: ObjectValue = { id: selected.id }; details[key] = target;
      person(selected, sourcePath, target, `${key}.${selected.id}`, { fullName: programId === "pwd-tap", birth: programId !== "pgw-crp", middle: programId === "peco-cap", income: true });
      const members: ObjectValue[] = []; details.householdMembers = members;
      for (const member of [primary, ...(profile.details.members ?? [])].filter(value => value.id !== selected.id)) {
        const row: ObjectValue = { id: member.id }; members.push(row);
        const memberPath = member.id === primary.id ? "primaryPerson" : `members.${member.id}`;
        const adult = member.dateOfBirth && Number(today.slice(0, 4)) - Number(member.dateOfBirth.slice(0, 4)) - (today.slice(5) < member.dateOfBirth.slice(5) ? 1 : 0) >= 18;
        person(member, memberPath, row, `householdMembers.${member.id}`, { fullName: programId === "pwd-tap", birth: true, middle: programId === "peco-cap",
          relationship: selected.id === primary.id && member.id !== primary.id, income: programId !== "peco-cap" || Boolean(adult && fresh(`${memberPath}.dateOfBirth`)) });
      }
      if (selected.id === primary.id) {
        if (programId === "pgw-crp" || programId === "pwd-tap") copy(details, "phone", "phone", "contact.phone");
        if (programId === "pwd-tap") copy(details, "email", "email", "contact.email");
        if (programId === "peco-cap" && options.pecoPhoneType) copy(details, options.pecoPhoneType === "cell" ? "cellPhone" : "homePhone", options.pecoPhoneType === "cell" ? "cellPhone" : "homePhone", "contact.phone");
      }
    }
    if (options.useHomeAddress && profile.details.homeAddress) {
      const address = profile.details.homeAddress;
      if (programId === "pwd-tap") {
        const keys = ["street", "apartment", "city", "state", "zip"].filter(key => address[key as keyof typeof address] !== undefined);
        add(details, "propertyAddress", "propertyAddress", keys.map(key => `homeAddress.${key}`), address.street ? keys.map(key => address[key as keyof typeof address]).join(", ") : undefined);
      } else {
        const target: ObjectValue = {}; details.address = target;
        if (programId === "peco-cap") {
          for (const key of ["street", "apartment", "city", "state", "zip"] as const) copy(target, key, `address.${key}`, `homeAddress.${key}`);
        } else {
          const joined = street(address, "homeAddress"); add(target, "street", "address.street", joined.paths, joined.value);
          for (const key of ["city", "state", "zip"] as const) copy(target, key, `address.${key}`, `homeAddress.${key}`);
        }
      }
    }
    if (programId === "pwd-tap" && selected?.id === primary.id && postal.value) {
      const address = postal.value, keys = ["street", "apartment", "city", "state", "zip"].filter(key => address[key as keyof typeof address] !== undefined);
      add(details, "mailingAddress", "mailingAddress", [...postal.extra, ...keys.map(key => `${postal.path}.${key}`)], address.street ? keys.map(key => address[key as keyof typeof address]).join(", ") : undefined);
    }
  }
  if (!fields.length) return { details: {} as FamilyProfileApplicationDetails, fields };
  for (const key of ["household", "householdMembers", "children"]) if (Array.isArray(details[key])) {
    const rows = details[key] as ObjectValue[];
    details[key] = rows.filter((row, index) => (key === "household" && index === 0 && fields.some(field => field.applicationPath.startsWith("household."))) ||
      fields.some(field => field.applicationPath.startsWith(`${key}.${row.id}.`)));
    if (!(details[key] as ObjectValue[]).length) delete details[key];
  }
  for (const key of ["applicant", "customer", "contact", "address"]) if (details[key] && Object.keys(details[key] as object).length === 0) delete details[key];
  return { details: schemas[programId].parse(details) as FamilyProfileApplicationDetails, fields };
}

export function sameFamilyProfileApplicationValue(left: unknown, right: unknown, path: string): boolean {
  if (left === undefined || right === undefined) return false;
  const comparable = (value: unknown) => {
    if (!path.endsWith(".income") || !value || typeof value !== "object" || Array.isArray(value)) return value;
    const { state, sources, ...other } = value as ObjectValue;
    if (!Array.isArray(sources) || sources.some(source => !source || typeof source.id !== "string")) return value;
    // PGW's separate explanation is a new programme answer, not a change to the shared inventory.
    delete other.noIncomeSituation;
    return { state, sources: [...sources].sort((a, b) => a.id.localeCompare(b.id)), ...other };
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function matchingFamilyProfileFields(details: FamilyProfileApplicationDetails, projection: ReturnType<typeof projectFamilyProfileApplication>): FamilyProfileApplicationField[] {
  return projection.fields.filter(field => sameFamilyProfileApplicationValue(familyProfileApplicationValue(details, field.applicationPath), familyProfileApplicationValue(projection.details, field.applicationPath), field.applicationPath));
}

/** Keep the value behind every original binding until that answer actually changes. */
export function mergeFamilyProfileApplicationProjection(previous: ReturnType<typeof projectFamilyProfileApplication> | undefined, next: ReturnType<typeof projectFamilyProfileApplication>): ReturnType<typeof projectFamilyProfileApplication> {
  if (!previous) return next;
  const merge = (old: unknown, fresh: unknown): unknown => {
    if (Array.isArray(old) && Array.isArray(fresh)) {
      return [...fresh.map(row => merge(old.find(value => value.id === row.id), row)), ...old.filter(row => !fresh.some(value => value.id === row.id))];
    }
    if (old && fresh && typeof old === "object" && typeof fresh === "object" && !Array.isArray(old) && !Array.isArray(fresh)) {
      const result = { ...old } as ObjectValue;
      for (const [key, value] of Object.entries(fresh)) result[key] = key === "income" ? structuredClone(value) : merge(result[key], value);
      return result;
    }
    return fresh;
  };
  return { details: merge(previous.details, next.details) as FamilyProfileApplicationDetails,
    fields: [...previous.fields.filter(field => !next.fields.some(value => value.applicationPath === field.applicationPath)), ...next.fields] };
}
