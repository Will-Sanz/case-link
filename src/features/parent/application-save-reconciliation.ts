type Attempt = { key: string; body: string };
type Snapshot = {
  request_id: string; base_version: number; request_version: number; idempotency_key: string;
  notice_version: string; details: unknown; confirmed_paths?: string[];
  consent_evidence?: { subjectAuthorityDeclared: true; accountAuthorityDeclared?: true };
};

// PostgreSQL JSON objects need not retain the browser's property order. Array order still matters.
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}

/** The caller supplies a validated latest owner GET; this recognizes its own write, never authorizes a new one. */
export function applicationSaveConfirmed(attempt: Attempt | null, snapshot: Snapshot | null | undefined, requestId: string, currentVersion: number): boolean {
  if (!attempt || !snapshot || snapshot.request_id !== requestId || snapshot.idempotency_key !== attempt.key ||
    !Number.isInteger(currentVersion) || snapshot.request_version > currentVersion || snapshot.request_version < snapshot.base_version) return false;
  try {
    const body = JSON.parse(attempt.body);
    if (!body || Array.isArray(body) || typeof body !== "object" ||
      Object.keys(body).some(key => !["expectedVersion", "details", "noticeVersion", "confirmedPaths", "subjectAuthorityDeclared", "accountAuthorityDeclared"].includes(key))) return false;
    return body.expectedVersion === snapshot.base_version && body.noticeVersion === snapshot.notice_version &&
      sameJson(body.details, snapshot.details) && sameJson(body.confirmedPaths ?? [], snapshot.confirmed_paths ?? []) &&
      body.subjectAuthorityDeclared === snapshot.consent_evidence?.subjectAuthorityDeclared &&
      body.accountAuthorityDeclared === snapshot.consent_evidence?.accountAuthorityDeclared;
  } catch { return false; }
}
