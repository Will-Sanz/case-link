import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "pg";
import type { Page } from "@playwright/test";
import { findFoodSites, findShareFoodAccessObservation } from "../src/lib/parent/food-sites-core";
import { buildFoodAccessAlternatives } from "../src/lib/parent/food-access-alternatives";
import { bindFoodAccessReport, buildFoodAccessPlanBody, SHARE_FOOD_ACCESS_PROGRAM } from "../src/lib/parent/food-access";
import { fixtureIntake, fixtureMandate, fixtureRequest } from "../src/lib/parent/test-fixtures";

const mocked = vi.hoisted(() => ({ clients: [] as { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }[], fail: "", work: vi.fn() }));
vi.mock("pg", () => ({ Client: class {
  connect = vi.fn(async () => {});
  query = vi.fn(async (sql: string) => { if (sql === "reset role" && mocked.fail === "reset") throw new Error("synthetic reset failure"); return { rows: [{ role: "parent_worker" }] }; });
  end = vi.fn(async () => { if (mocked.fail === "end") throw new Error("synthetic close failure"); });
  constructor() { mocked.clients.push(this); }
} }));
vi.mock("../src/lib/parent/worker-runtime", () => ({ runOneParentJob: mocked.work }));
import { foodDirectoryNativeSource, verifyNativeFoodDirectory } from "./parent-food-directory-native-proof";
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); mocked.clients.length = 0; mocked.fail = ""; });

describe("native directory fixture containment (not a native integration claim)", () => {
  it("uses the actual reader and DTO to exclude unsupported entries without performing a network request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const source = foodDirectoryNativeSource(), now = new Date("2026-11-18T12:00:00Z");
    const request = fixtureRequest({ created_at: now.toISOString(), intake: fixtureIntake({ needs: ["food_now"], zip: "19129" }),
      mandate: fixtureMandate({ recipientIds: [SHARE_FOOD_ACCESS_PROGRAM], expiresAt: "2026-11-25T12:00:00Z" }) });
    const plan = { ...buildFoodAccessPlanBody({ requestId: request.id, requestVersion: request.version, generatedAt: now.toISOString(), sourceReviewCurrent: true }), planHash: "a".repeat(64) };
    const report = bindFoodAccessReport(plan, { expectedVersion: request.version, siteId: plan.site.id, planHash: plan.planHash, reportKey: request.id, result: "no_food" }, { eventId: request.id, reportedAt: now.toISOString() });
    expect(await findShareFoodAccessObservation(source.fetcher)).toMatchObject({ recordId: 122, state: "listed_unconfirmed" });
    const result = await findFoodSites("19129", source.fetcher), observation = buildFoodAccessAlternatives({ request, report, zip: "19129", now, result });
    expect(observation.sites.map(site => site.id)).toEqual([148, 155]); expect(observation.sourceReport).toEqual(report);
    expect(source).toMatchObject({ selected: 1, directory: 1, unexpected: 0 }); expect(fetcher).not.toHaveBeenCalled();
    source.mode = "unavailable"; await expect(findFoodSites("19129", source.fetcher)).rejects.toThrow("Synthetic public directory interruption");
  });
  it.each(["https://example.invalid/private", "https://services.arcgis.com/other", "http://127.0.0.1:3310/private", "not-a-url"])("refuses an unexpected source request: %s", async url => {
    const source = foodDirectoryNativeSource(); await expect(source.fetcher(url)).rejects.toThrow("Unexpected request");
    expect(source.unexpected).toBe(1); expect(source.selected + source.directory).toBe(0);
  });
  it("bounds the held public fixture by the supplied abort signal", async () => {
    const source = foodDirectoryNativeSource(), held = source.hold(), controller = new AbortController();
    const pending = findFoodSites("19129", (input, init) => source.fetcher(input, { ...init, signal: controller.signal }));
    await held.reached; controller.abort(new Error("synthetic source deadline"));
    await expect(pending).rejects.toThrow("synthetic source deadline"); held.release();
  });
  it("rejects a changed bound even on the otherwise exact public query", async () => {
    const source = foodDirectoryNativeSource();
    await expect(findFoodSites("19129", (input, init) => {
      const url = new URL(String(input)); url.searchParams.set("resultRecordCount", "999"); return source.fetcher(url, init);
    })).rejects.toThrow("Unexpected request");
    expect(source.unexpected).toBe(1); expect(source.directory).toBe(0);
  });
  it.each(["none", "read", "cancel", "reset", "end"])("attempts independent request/connection/role cleanup after a forced failure (%s)", async kind => {
    mocked.fail = kind; mocked.work.mockResolvedValue({ state: "idle" });
    const id = fixtureRequest().id, worker = { query: vi.fn(async () => ({ rows: [{ role: "parent_worker" }] })) };
    const db = { query: vi.fn(async (sql: string) => {
      if (sql.includes("where h.owner_id")) { if (kind === "read") throw new Error("synthetic cleanup read failure"); return { rows: [{ id, status: "active" }] }; }
      return { rows: [{ n: 0 }] };
    }) };
    const response = (value: unknown) => ({ status: () => 200, json: async () => value });
    const page = { request: {
      get: vi.fn(async () => response({ ok: true, authorization: { expiresAt: new Date(Date.now() + 600000).toISOString() } })),
      post: vi.fn(async (url: string) => {
        if (url.endsWith(id) && kind === "cancel") throw new Error("synthetic cleanup cancel failure");
        return url.endsWith("/requests") ? { ...response({ request: { id } }), status: () => 201 } : response({ ok: true });
      }),
    } };
    await expect(verifyNativeFoodDirectory({ origin: "http://127.0.0.1:3200", local: { API_URL: "http://127.0.0.1:55321", MAILPIT_URL: "http://127.0.0.1:55324", DB_URL: "postgresql://127.0.0.1:55322/postgres" },
      page: page as unknown as Page, ownerId: id, db: db as unknown as Client, worker: worker as unknown as Client, syntheticApproval: true,
      approvedUntil: new Date(Date.now() + 600000).toISOString(), check: (condition, label) => assert.ok(condition, label) })).rejects.toBeInstanceOf(AggregateError);
    expect(mocked.clients).toHaveLength(1); expect(mocked.clients[0].query.mock.calls.map(([sql]) => sql)).toEqual(["set role parent_worker", "select current_user role", "reset role"]);
    expect(mocked.clients[0].end).toHaveBeenCalledOnce(); expect(worker.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls.some(([sql]) => sql.includes("where h.owner_id"))).toBe(true);
    if (kind !== "read") expect(page.request.post).toHaveBeenCalledTimes(2);
  });
});
