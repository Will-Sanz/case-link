import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRequest } from "./test-fixtures";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import {
  exportParentInformation,
  getSupportRequest,
  listSupportRequests,
} from "./data";
const id = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let protectedReferences: unknown[];
let profileReply: unknown;
let pending = 0,
  maxPending = 0;
const calls: {
  table: string;
  after: string | undefined;
  limit: number | undefined;
}[] = [];
function client() {
  return {
    rpc: async (name: string) => {
      if (name === "parent_get_family_profile") return { data: profileReply, error: null };
      if (name !== "parent_export_utility_protected_inputs") throw new Error("unexpected RPC"); return { data: protectedReferences, error: null };
    },
    from(table: string) {
      const conditions: ((row: Row) => boolean)[] = [];
      const orders: { key: string; ascending: boolean }[] = [];
      let pageLimit: number | undefined, after: string | undefined;
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          conditions.push((row) => row[key] === value);
          return query;
        },
        neq(key: string, value: unknown) {
          conditions.push((row) => row[key] !== value);
          return query;
        },
        gt(key: string, value: string) {
          after = value;
          conditions.push((row) => String(row[key]) > value);
          return query;
        },
        order(key: string, options: { ascending: boolean }) {
          orders.push({ key, ...options });
          return query;
        },
        limit(value: number) {
          pageLimit = value;
          return query;
        },
        async run() {
          pending++;
          maxPending = Math.max(maxPending, pending);
          await Promise.resolve();
          const rows = (tables[table] ?? [])
            .filter((row) => conditions.every((condition) => condition(row)))
            .sort((a, b) => {
              for (const { key, ascending } of orders) {
                const delta = String(a[key]).localeCompare(String(b[key]));
                if (delta) return ascending ? delta : -delta;
              }
              return 0;
            });
          calls.push({ table, after, limit: pageLimit });
          pending--;
          return {
            data: pageLimit ? rows.slice(0, pageLimit) : rows,
            error: null,
          };
        },
        async maybeSingle() {
          const result = await query.run();
          return { ...result, data: result.data[0] ?? null };
        },
        async single() {
          return query.maybeSingle();
        },
        then(onResolve: (value: { data: Row[]; error: null }) => unknown) {
          return query.run().then(onResolve);
        },
      };
      return query;
    },
  };
}
beforeEach(() => {
  protectedReferences = [];
  profileReply = { ownerId: id(2), revision: 0, lastMutationKey: null, profile: null,
    collection: { collectionEnabled: false, noticeVersion: null, expiresAt: null, retentionDays: 45 } };
  pending = 0;
  maxPending = 0;
  calls.length = 0;
  tables = {
    parent_households: [{ id: id(1), owner_id: id(2) }],
    parent_accounts: [
      {
        id: id(2),
        preferences: {
          contactPreference: "in_app",
          language: "en",
          quietHoursStart: 19,
          quietHoursEnd: 9,
        },
      },
    ],
  };
  mocks.session.mockResolvedValue({ user: { id: id(2) }, supabase: client() });
});
describe("complete parent data pagination", () => {
  it("exports the current owned profile and original dates, rejecting foreign or malformed records", async () => {
    const confirmedAt = new Date(Date.now() - 1000).toISOString(), expiresAt = new Date(Date.now() + 60000).toISOString();
    const profile = { revision: 1, idempotencyKey: id(3), details: { primaryPerson: { id: id(4), firstName: "Saved family name" } },
      provenance: { "primaryPerson.firstName": { confirmedAt, expiresAt } } };
    const base = { ownerId: id(2), revision: 1, lastMutationKey: id(3), profile,
      collection: { collectionEnabled: false, noticeVersion: null, expiresAt: null, retentionDays: 45 } };
    profileReply = base;
    expect((await exportParentInformation()).familyProfile).toEqual(profile);
    for (const invalid of [{ ...base, ownerId: id(5) }, { ...base, rawIdentifier: "PRIVATE_CANARY" }]) {
      profileReply = invalid;
      await expect(exportParentInformation()).rejects.toThrow("CaseLink could not export your family profile.");
    }
  });
  it("lists beyond100 requests using stable sequential pages", async () => {
    tables.parent_requests = Array.from({ length: 105 }, (_, index) => ({
      ...fixtureRequest(),
      id: id(index + 1),
      created_at: `2026-10-${String(1 + Math.floor(index / 10)).padStart(2, "0")}T12:00:00Z`,
    }));
    const requests = await listSupportRequests();
    expect(requests).toHaveLength(105);
    expect(new Set(requests.map((row) => row.id)).size).toBe(105);
    expect(
      calls
        .filter((call) => call.table === "parent_requests")
        .map((call) => call.after),
    ).toEqual([undefined, id(100)]);
    expect(maxPending).toBe(1);
  });
  it("exports every retained request, event and document plus immutable histories without parallel fanout", async () => {
    tables.parent_requests = Array.from({ length: 105 }, (_, index) => ({
      ...fixtureRequest(),
      id: id(index + 1),
    }));
    tables.parent_events = Array.from({ length: 205 }, (_, index) => ({
      id: id(index + 1),
      request_id: id(105),
      kind: "operation.sent",
      created_at: `2026-10-25T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`,
    }));
    tables.parent_documents = Array.from({ length: 102 }, (_, index) => ({
      id: id(index + 1),
      request_id: id(105),
      status: index === 101 ? "deletion_pending" : "uploaded",
    }));
    for (const table of [
      "parent_assistant_messages",
      "parent_operations",
      "parent_receipts",
      "parent_mandates",
      "parent_form_artifacts",
    ])
      tables[table] = [{ id: id(1), request_id: id(105) }];
    tables.parent_snap_application_details = Array.from({ length: 102 }, (_, index) => ({
      id: id(index + 1),
      request_id: id(105),
      revision: index + 1,
      details: { applicant: { firstName: "Sample" } },
      provenance: { "applicant.firstName": { source: "parent", asOf: "2026-11-03T12:00:00.000Z" } },
    }));
    tables.parent_wic_application_details = Array.from({ length: 103 }, (_, index) => ({
      id: id(index + 1), request_id: id(105), revision: index + 1,
      details: { contact: { firstName: "WicExportCanary" } },
      provenance: { "contact.firstName": { source: "parent", confirmedAt: "2026-11-13T19:00:00Z", asOf: "2026-11-13" } },
      consent_evidence: { revision: index + 1, subjectAuthorityDeclared: true, subjects: ["contact"] },
    }));
    tables.parent_peco_application_details = Array.from({ length: 104 }, (_, index) => ({
      id: id(index + 1), request_id: id(105), revision: index + 1,
      details: { accountNumber: "9000000001", applicant: { firstName: "PecoExportCanary" } },
      provenance: { accountNumber: { source: "parent", confirmedAt: "2026-11-13T20:06:00Z", asOf: "2026-11-13" } },
      consent_evidence: { revision: index + 1, accountAuthorityDeclared: true, subjectAuthorityDeclared: true },
    }));
    for (const [table, name] of [["parent_pgw_application_details", "GasExportCanary"], ["parent_water_application_details", "WaterExportCanary"]])
      tables[table] = Array.from({ length: 106 }, (_, index) => ({ id: id(index + 1), request_id: id(105), revision: index + 1,
        details: { applicant: { name } }, provenance: { answer: { confirmedAt: "2026-11-13T22:10:00Z" } }, consent_evidence: { subjectAuthorityDeclared: true, accountAuthorityDeclared: true } }));
    const exported = await exportParentInformation();
    expect(exported.requests).toHaveLength(105);
    const last = exported.requests.find((request) => request.id === id(105))!;
    expect(last.events).toHaveLength(205);
    expect(last.documents).toHaveLength(102);
    expect(last.operations).toHaveLength(1);
    expect(last.receipts).toHaveLength(1);
    expect(last.mandates).toHaveLength(1);
    expect(last.forms).toHaveLength(1);
    expect(last.assistant).toHaveLength(1);
    expect(last.snapApplicationDetails).toHaveLength(102);
    expect(last.wicApplicationDetails).toHaveLength(103);
    expect(last.pecoApplicationDetails).toHaveLength(104);
    expect((last.pecoApplicationDetails as Row[]).at(-1)).toEqual(tables.parent_peco_application_details.at(-1));
    expect((last.wicApplicationDetails as Row[]).at(-1)?.provenance).toEqual(tables.parent_wic_application_details.at(-1)?.provenance);
    expect((last.wicApplicationDetails as Row[]).at(-1)?.consent_evidence).toEqual(tables.parent_wic_application_details.at(-1)?.consent_evidence);
    expect((last.snapApplicationDetails as Row[]).at(-1)?.provenance).toEqual(tables.parent_snap_application_details.at(-1)?.provenance);
    for (const [key, table] of [["pgwApplicationDetails", "parent_pgw_application_details"], ["waterApplicationDetails", "parent_water_application_details"]]) {
      expect(last[key]).toHaveLength(106); expect((last[key] as Row[]).at(-1)).toEqual(tables[table].at(-1));
      expect(calls.filter(call => call.table === table)).toHaveLength(2);
    }
    expect(maxPending).toBeLessThanOrEqual(2); // Only the established household/account pair runs together.
    expect(calls.filter((call) => call.table === "parent_events")).toHaveLength(
      3,
    );
    expect(calls.filter((call) => call.table === "parent_snap_application_details")).toHaveLength(2);
    expect(calls.filter((call) => call.table === "parent_wic_application_details")).toHaveLength(2);
    expect(calls.filter((call) => call.table === "parent_peco_application_details")).toHaveLength(2);
  });
  it("returns only the presence of private PECO history even when its current mandate has changed", async () => {
    const request = { ...fixtureRequest(), id: id(1), mandate: { ...fixtureRequest().mandate, recipientIds: ["uesf-utilities"] } };
    tables.parent_requests = [request];
    tables.parent_peco_application_details = [{ id: id(2), request_id: id(1), details: { accountNumber: "9000000001", applicant: { firstName: "PrivateCanary" } } }];
    const saved = await getSupportRequest(id(1));
    expect(saved?.has_peco_application_details).toBe(true);
    expect(JSON.stringify(saved)).not.toMatch(/9000000001|PrivateCanary/);
    tables.parent_peco_application_details = [];
    expect((await getSupportRequest(id(1)))?.has_peco_application_details).toBe(false);
  });
  it("shows the newest200 events chronologically and reports that earlier history exists", async () => {
    tables.parent_requests = [{ ...fixtureRequest(), id: id(1) }];
    tables.parent_events = Array.from({ length: 205 }, (_, index) => ({
      id: id(index + 1),
      request_id: id(1),
      created_at: "2026-10-25T12:00:00Z",
    }));
    const request = await getSupportRequest(id(1));
    expect(calls.some(call => call.table === "parent_snap_application_details")).toBe(false);
    expect(request?.events).toHaveLength(200);
    expect(request?.events?.[0].id).toBe(id(6));
    expect(request?.events?.at(-1)?.id).toBe(id(205));
    expect(request).toHaveProperty("events_truncated", true);
  });
});

it.each([["parent_pgw_application_details", "has_pgw_application_details"], ["parent_water_application_details", "has_water_application_details"]])("returns only the retained purpose marker from %s after mandate changes", async (table, flag) => {
  tables.parent_requests = [{ ...fixtureRequest(), id: id(1), mandate: { ...fixtureRequest().mandate, recipientIds: ["uesf-utilities"] } }];
  tables[table] = [{ id: id(2), request_id: id(1), details: { accountNumber: "PrivateAccountCanary", name: "PrivateFamilyCanary" } }];
  const saved = await getSupportRequest(id(1)); expect(saved).toHaveProperty(flag, true); expect(JSON.stringify(saved)).not.toMatch(/PrivateAccountCanary|PrivateFamilyCanary/);
  tables[table] = []; expect(await getSupportRequest(id(1))).toHaveProperty(flag, false);
});

it("exports only owned opaque protected references, rejecting raw or cross-owner responses without echoing them", async () => {
  tables.parent_requests = [{ ...fixtureRequest(), id: id(1) }];
  const reference = { inputId: id(3), authorizationId: id(4), ownerId: id(2), requestId: id(1), requestVersion: 2, programId: "pgw-crp", snapshotId: id(5), snapshotRevision: 1, snapshotHash: "a".repeat(64),
    purpose: "income_proof", targets: [{ subjectId: id(6), sourceId: id(7), field: "income" }], state: "stored", consentedAt: "2026-11-13T22:20:00Z", expiresAt: "2026-11-13T22:25:00Z", accountReference: null, validation: null };
  protectedReferences = [reference];
  expect((await exportParentInformation()).requests[0].utilityProtectedInputs).toEqual([reference]);
  for (const invalid of [{ ...reference, raw: "PrivateInputCanary" }, { ...reference, ownerId: id(99) }, { ...reference, requestId: id(99) }]) {
    protectedReferences = [invalid]; await expect(exportParentInformation()).rejects.toThrow("CaseLink could not export protected document references. Please try again.");
  }
});
