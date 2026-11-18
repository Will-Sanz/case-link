// Synthetic request-route metadata around the existing UI tests' write handlers.
// Those handlers continue to assert application write count/body; owned-read and
// exact-receipt behavior are separately exercised by the real-hook tests.
import { fixtureNow, fixtureRequest } from "@/lib/parent/test-fixtures";
import type { SupportRequest } from "@/lib/parent/domain";
import type { SupportUpdate, SupportUpdateReceipt } from "@/lib/parent/support-update";
type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
export function withSupportUpdateReceipts(handler: (url: string, init?: RequestInit) => Promise<unknown>, initial = fixtureRequest(), options: { permission?: boolean; commitUnknown?: boolean } = {}) {
  let current = initial, reviewPending = false, quoted = false;
  let expiresAt = new Date(fixtureNow.getTime() + 86400000).toISOString();
  const receipts = new Map<string, { body: string; receipt: SupportUpdateReceipt }>();
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const response = (body: unknown): Reply => ({ ok: true, status: 200, json: async () => body });
  return async (url: string, init?: RequestInit) => {
    const key = new URL(url, "https://app.example.test").searchParams.get("updateKey");
    if (key) {
      if (options.permission && !quoted) {
        quoted = true;
        const result = await handler("/api/parent/authorization-window") as Reply;
        const body = await result.json() as { authorization?: { expiresAt: string } };
        if (!result.ok) return result;
        expiresAt = body.authorization?.expiresAt ?? expiresAt;
      }
      if (reviewPending) {
        reviewPending = false;
        const result = await handler(url, init) as Reply;
        if (!result.ok) return result;
        const body = await result.json() as { request?: SupportRequest };
        if (body.request) current = body.request;
      }
      return response({ request: current, update: { ownerId, receipt: receipts.get(key)?.receipt ?? null, expiresAt, issuedAt: fixtureNow.toISOString() } });
    }
    if (init?.method !== "POST") return handler(url, init);
    const writeKey = (init.headers as Record<string, string>)["Idempotency-Key"], body = String(init.body);
    const known = receipts.get(writeKey);
    if (known) return known.body === body ? response({ update: { ownerId, receipt: known.receipt } })
      : { ok: false, status: 409, json: async () => ({ error: "This request changed." }) };
    const value = JSON.parse(body) as SupportUpdate;
    let result: Reply, payload: { request?: SupportRequest };
    try {
      result = await handler(url, init) as Reply;
      if (!result.ok && !options.commitUnknown) { reviewPending = result.status === 409; return result; }
      payload = await result.json() as { request?: SupportRequest };
    } catch (cause) {
      if (!options.commitUnknown) throw cause;
      result = { ok: false, status: 500, json: async () => ({ error: "We couldn’t confirm this save." }) }; payload = {};
    }
    const provided = value.action === "answer_facts" ? value.answers : value.action === "answer_fact" ? [value] : [];
    current = payload.request ?? { ...current, version: value.version + 1,
      required_actions: current.required_actions.filter(action => !provided.some(answer => answer.need === action.need && answer.field === action.field)) };
    const receipt: SupportUpdateReceipt = { id: crypto.randomUUID(), key: writeKey, requestId: initial.id, action: value.action,
      baseVersion: value.version, resultVersion: current.version, recordedAt: fixtureNow.toISOString() };
    receipts.set(writeKey, { body, receipt });
    return options.commitUnknown ? result : response({ update: { ownerId, receipt } });
  };
}
