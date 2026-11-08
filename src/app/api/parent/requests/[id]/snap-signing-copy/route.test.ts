import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureSnapSnapshot } from "@/lib/parent/test-fixtures";
import { assessSnapApplicationSnapshot } from "@/lib/parent/snap-application-snapshot";
const mocks = vi.hoisted(() => ({ context: vi.fn(), details: vi.fn() }));
vi.mock("@/lib/parent/snap-capture-data", () => ({ getSnapCaptureContext: mocks.context }));
vi.mock("@/lib/parent/snap-application-data", () => ({ getSnapApplicationDetails: mocks.details }));
import { GET } from "./route";
import { GET as contextGet } from "../snap-application/context/route";

const now = new Date("2026-11-04T21:00:00Z"), saved = fixtureSnapSnapshot(now), requestId = saved.request_id;
const scope = { expectedVersion: saved.request_version, snapshotId: saved.id };
const context = { requestVersion: saved.request_version, snapshotId: saved.id, snapshotHash: "a".repeat(64), source: saved.source,
  applyingSubjectIds: saved.details.household!.filter(person => person.requestingSnap).map(person => person.id) };
const params = { params: Promise.resolve({ id: requestId }) }, origin = "https://caselink.test";
function request(headers?: HeadersInit, query = new URLSearchParams({ expectedVersion: String(scope.expectedVersion), snapshotId: scope.snapshotId }).toString()) {
  return new Request(`${origin}/api/parent/requests/${requestId}/snap-signing-copy?${query}`, { headers });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.context.mockResolvedValue(structuredClone(context)); mocks.details.mockResolvedValue(structuredClone(saved));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("current official SNAP signing-copy download", () => {
  it("renders the existing saved facts on all twelve original-size pages with protected steps blank", async () => {
    const response = await GET(request({ origin }), params);
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="caselink-snap-signing-copy.pdf"');
    const bytes = new Uint8Array(await response.arrayBuffer()), pdf = await PDFDocument.load(bytes);
    expect(response.headers.get("x-caselink-snap-prepared-at")).toBe(now.toISOString());
    expect(response.headers.get("x-caselink-snap-unsigned-sha256")).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(Number(response.headers.get("content-length"))).toBe(bytes.length);
    expect(response.headers.get("x-caselink-snap-unsigned-byte-length")).toBe(String(bytes.length)); expect(pdf.getPageCount()).toBe(12);
    for (const page of pdf.getPages()) expect(page.getSize()).toEqual({ width: 612, height: 792 });
    expect(pdf.getTitle()).toContain("protected fields blank - not submission-ready - not sent");
    expect(mocks.details).toHaveBeenCalledExactlyOnceWith(requestId, saved.id);
    expect(mocks.context).toHaveBeenNthCalledWith(1, requestId, scope); expect(mocks.context).toHaveBeenCalledTimes(2);
  });
  it("keeps actual PDF bytes, preparation time and unsigned hash stable after the clock advances", async () => {
    const first = await GET(request(), params), firstBytes = new Uint8Array(await first.arrayBuffer());
    vi.setSystemTime(new Date(now.getTime() + 3600000));
    const second = await GET(request(), params), secondBytes = new Uint8Array(await second.arrayBuffer());
    expect(first.status).toBe(200); expect(second.status).toBe(200); expect(secondBytes).toEqual(firstBytes);
    expect(second.headers.get("x-caselink-snap-prepared-at")).toBe(now.toISOString());
    expect(second.headers.get("x-caselink-snap-unsigned-sha256")).toBe(first.headers.get("x-caselink-snap-unsigned-sha256"));
    const pdf = await PDFDocument.load(secondBytes, { updateMetadata: false });
    expect(pdf.getCreationDate()?.toISOString()).toBe(now.toISOString()); expect(pdf.getModificationDate()?.toISOString()).toBe(now.toISOString());
  });
  it("normalizes the immutable snapshot timestamp to UTC milliseconds", async () => {
    mocks.details.mockResolvedValue({ ...structuredClone(saved), created_at: "2026-11-04T16:00:00.123456-05:00" });
    vi.setSystemTime(new Date("2026-11-04T21:01:00.000Z"));
    const response = await GET(request(), params);
    expect(response.status).toBe(200); expect(response.headers.get("x-caselink-snap-prepared-at")).toBe("2026-11-04T21:00:00.123Z");
  });
  it.each(["invalid", "future"])("rejects an %s snapshot preparation date without a descriptor or PDF", async kind => {
    mocks.details.mockResolvedValue({ ...structuredClone(saved), created_at: kind === "invalid" ? "PRIVATE-CANARY" : new Date(now.getTime() + 1).toISOString() });
    const response = await GET(request(), params);
    expect(response.status).toBe(409); expect(response.headers.get("x-caselink-snap-prepared-at")).toBeNull();
    expect(response.headers.get("x-caselink-snap-unsigned-sha256")).toBeNull(); expect(response.headers.get("x-caselink-snap-unsigned-byte-length")).toBeNull(); expect(response.headers.get("content-type")).not.toBe("application/pdf");
    expect(await response.text()).not.toContain("PRIVATE-CANARY");
  });
  it("checks freshness at the current time rather than letting the old preparation date revive stale answers", async () => {
    const changed = structuredClone(saved);
    for (const value of Object.values(changed.provenance)) { value.confirmedAt = "2026-09-25T12:00:00Z"; value.asOf = "2026-09-25"; }
    expect(assessSnapApplicationSnapshot(changed, new Date(changed.created_at)).readiness.nonProtectedDataReadyForReview).toBe(true);
    mocks.details.mockResolvedValue(changed); vi.setSystemTime(new Date("2026-11-20T21:00:00.000Z"));
    const response = await GET(request(), params);
    expect(response.status).toBe(409); expect(response.headers.get("x-caselink-snap-prepared-at")).toBeNull();
    expect(response.headers.get("content-type")).not.toBe("application/pdf");
  });
  it("returns only the exact context metadata through the companion route", async () => {
    const response = await contextGet(request(), params);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, context });
    expect(mocks.details).not.toHaveBeenCalled();
  });
  it.each(["origin", "cross-site", "same-site", "duplicate", "unknown", "missing"])("rejects unsafe %s input before reading household facts", async kind => {
    const headers: Record<string, string> | undefined = kind === "origin" ? { origin: "https://other.test" } : ["cross-site", "same-site"].includes(kind) ? { "sec-fetch-site": kind } : undefined;
    const base = new URL(request().url).searchParams.toString(), query = kind === "duplicate" ? base + "&expectedVersion=4" : kind === "unknown" ? base + "&ssn=PRIVATE-CANARY" : kind === "missing" ? "" : base;
    for (const route of [GET, contextGet]) expect((await route(request(headers, query), params)).status).toBe(kind === "origin" || kind.endsWith("site") ? 403 : 400);
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.details).not.toHaveBeenCalled();
  });
  it.each(["no_snapshot", "request", "snapshot", "future_version", "stale", "incomplete"])("does not generate an apparent current form for %s evidence", async kind => {
    const changed = structuredClone(saved);
    if (kind === "request") changed.request_id = saved.id;
    if (kind === "snapshot") changed.id = saved.request_id;
    if (kind === "future_version") changed.request_version++;
    if (kind === "stale") for (const value of Object.values(changed.provenance)) { value.confirmedAt = "2026-09-01T12:00:00Z"; value.asOf = "2026-09-01"; }
    if (kind === "incomplete") { delete changed.details.applicant!.firstName; delete changed.details.household![0].firstName; delete changed.provenance["applicant.firstName"]; delete changed.provenance[`household.${changed.details.household![0].id}.firstName`]; }
    mocks.details.mockResolvedValue(kind === "no_snapshot" ? null : changed);
    const result = await GET(request(), params); expect(result.status).toBe(409); expect(result.headers.get("content-type")).not.toBe("application/pdf");
  });
  it.each(["correction", "revocation"])("rechecks current authority after rendering to catch %s", async kind => {
    if (kind === "correction") mocks.context.mockResolvedValueOnce(context).mockResolvedValue({ ...context, snapshotHash: "b".repeat(64) });
    else mocks.context.mockResolvedValueOnce(context).mockRejectedValue(new Error("This request is unavailable, or its permission has changed."));
    expect((await GET(request(), params)).status).toBe(kind === "correction" ? 409 : 403);
  });
  it("refuses a mismatched applying-household scope", async () => {
    mocks.context.mockResolvedValue({ ...context, applyingSubjectIds: [saved.id] });
    expect((await GET(request(), params)).status).toBe(409);
  });
  it("compares the same UUID scope when a saved applicant ID uses uppercase letters", async () => {
    const details = structuredClone(saved.details), id = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
    details.household![0].id = id.toUpperCase();
    mocks.details.mockResolvedValue(fixtureSnapSnapshot(now, details)); mocks.context.mockResolvedValue({ ...context, applyingSubjectIds: [id] });
    expect((await GET(request(), params)).status).toBe(200);
  });
  it("keeps sign-in and private provider failures out of document responses", async () => {
    mocks.context.mockRejectedValue(new Error("Sign in again")); expect((await GET(request(), params)).status).toBe(401);
    mocks.context.mockRejectedValue(new Error("PRIVATE-CANARY"));
    const result = await GET(request(), params); expect(result.status).toBe(500); expect(await result.text()).not.toContain("PRIVATE-CANARY");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE-CANARY");
  });
});
