const MANUAL_ONLY_FIELD =
  /\b(name|signature|initials?|date of birth|dob|address|phone|e-?mail|student id|participant id|social security|ssn|consent|attest|certif|site name)\b/i;

export function isManualOnlyPaperworkField(fieldName: string, label: string): boolean {
  const normalized = `${fieldName} ${label}`.replace(/[_\-.]+/g, " ");
  if (MANUAL_ONLY_FIELD.test(normalized)) return true;
  return /\b(case manager|case worker)\b.{0,30}\b(name|signature|initials?|phone|e-?mail|id)\b/i.test(
    normalized,
  );
}
