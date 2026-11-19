import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { runOneParentJob } from "../src/lib/parent/worker-runtime";
import type { SupportRequest } from "../src/lib/parent/domain";
import { foodAccessPlanSchema, foodAccessReportSchema, SHARE_FOOD_ACCESS_PROGRAM, SHARE_FOOD_ACCESS_SOURCE, type FoodAccessReport } from "../src/lib/parent/food-access";
import { currentFoodAccessAlternatives, foodAccessAlternativesSchema } from "../src/lib/parent/food-access-alternatives";
import { FOOD_DIRECTORY_CACHE_SECONDS } from "../src/lib/parent/food-sites-core";
import { fixtureIntake, fixtureMandate } from "../src/lib/parent/test-fixtures";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";
import { assertSyntheticParentAuthTargets } from "./parent-test-approval";

const cityPath = "/fLeGjb7u4uXqeF9q/arcgis/rest/services/free_meal_sites/FeatureServer/0/query";
const share = { objectid: 122, site_name: "Share Community Fridge", address: "2901 W Hunting Park Ave", zip_code: "19129", status: "Active", category_type: "Food Site" };
const alternate = (id: number) => ({ ...share, objectid: id, site_name: `Synthetic City alternate ${id}`, address: `${id} Synthetic Avenue` });

/** Explicit public-source fixture only; it never dispatches a network request or supplies Auth/API data. */
export function foodDirectoryNativeSource() {
  let entered: (() => void) | undefined, release: (() => void) | undefined, held: Promise<void> | undefined;
  const source = {
    mode: "listed" as "listed" | "unavailable" | "held",
    selected: 0, directory: 0, unexpected: 0,
    hold() {
      assert.notEqual(source.mode, "held"); source.mode = "held";
      const reached = new Promise<void>(resolve => { entered = resolve; });
      held = new Promise<void>(resolve => { release = resolve; });
      return { reached, release: () => { release?.(); source.mode = "listed"; } };
    },
    fetcher: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let url: URL;
      try { url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); }
      catch { source.unexpected++; throw new Error("Unexpected request in the native public-source fixture"); }
      const where = url.searchParams.get("where");
      const selected = where === "objectid=122", directory = where === "zip_code='19129' AND status='Active'";
      if (url.origin !== "https://services.arcgis.com" || url.username || url.password || url.hash || url.pathname !== cityPath || (!selected && !directory)
        || (init?.method ?? "GET") !== "GET" || init?.body != null || url.searchParams.get("resultRecordCount") !== (selected ? "1" : "50")
        || url.searchParams.get("returnGeometry") !== "false" || url.searchParams.get("f") !== "json") {
        source.unexpected++; throw new Error("Unexpected request in the native public-source fixture");
      }
      if (selected) { source.selected++; return Response.json({ features: [{ attributes: share }] }); }
      source.directory++;
      if (source.mode === "unavailable") throw new Error("Synthetic public directory interruption");
      if (source.mode === "held") {
        entered?.();
        await new Promise<void>((resolve, reject) => {
          const aborted = () => reject(init?.signal?.reason ?? new Error("Public lookup aborted"));
          if (init?.signal?.aborted) return aborted();
          init?.signal?.addEventListener("abort", aborted, { once: true });
          held!.then(() => { init?.signal?.removeEventListener("abort", aborted); resolve(); });
        });
      }
      return Response.json({ features: [share, alternate(148), { ...alternate(149), temporary_closure: "yes" },
        { ...alternate(150), seasonally_closed: "yes" }, { ...alternate(151), category_type: "Delivery Only" },
        { ...alternate(152), zip_code: "19104" }, { ...alternate(153), category_type: "School Meal Site" }, alternate(155)].map(attributes => ({ attributes })) });
    },
  };
  return source;
}

/** Native proof only. Root owns enrollment, bounded approval and the original worker membership restoration. */
export async function verifyNativeFoodDirectory(input: {
  origin: string; local: Record<string, string>; page: Page; ownerId: string; db: Client; worker: Client;
  syntheticApproval: boolean; approvedUntil: string; check(condition: unknown, label: string): void;
}): Promise<string[]> {
  const { origin, local, page, db, worker, check } = input;
  assertSyntheticParentAuthTargets(origin, local);
  assert.ok(input.syntheticApproval && Date.parse(input.approvedUntil) > Date.now(), "Native directory proof requires the existing current synthetic approval");
  z.uuid().parse(input.ownerId);
  const startKey = randomUUID(), source = foodDirectoryNativeSource(), failures: unknown[] = [];
  const contender = new Client({ connectionString: local.DB_URL, connectionTimeoutMillis: 3000, statement_timeout: 5000, idle_in_transaction_session_timeout: 10000 });
  let contenderConnected = false, viewer: Page | undefined, id: string | undefined, held: ReturnType<typeof source.hold> | undefined;
  let inFlight: ReturnType<typeof runOneParentJob> | undefined;
  const originalWorkerRole = (await worker.query("select current_user role")).rows[0].role as string;
  check(originalWorkerRole === "parent_worker", "The directory proof receives the actual restricted parent_worker connection.");
  const budgetBefore = (await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
  const url = () => `${origin}/api/parent/requests/${id}`;
  async function read() {
    const reply = await page.request.get(url());
    check(reply.status() === 200 && reply.headers()["cache-control"] === "private, no-store", "The directory plan uses the actual owned private no-store HTTP read.");
    const body = await reply.json(); check(body.ok === true && body.request?.id === id, "The directory API read remains bound to its owned request.");
    return body.request as SupportRequest;
  }
  const state = async () => (await db.query(`select to_jsonb(r) request,to_jsonb(j) job,
    (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.parent_events e where e.request_id=r.id) events,
    (select count(*)::int from public.parent_operations o where o.request_id=r.id) operations,
    (select count(*)::int from parent_private.ai_calls a where a.request_id=r.id) model_calls,
    (select count(*)::int from parent_private.model_call_reservations) reservations
    from public.parent_requests r join public.parent_jobs j on j.request_id=r.id join public.parent_households h on h.id=r.household_id
    where r.id=$1 and h.owner_id=$2`, [id, input.ownerId])).rows[0];
  async function report(result: FoodAccessReport["result"]) {
    const request = await read(), plan = foodAccessPlanSchema.parse(request.plan?.routes[0].foodAccess);
    const body = JSON.stringify({ action: "food_visit", expectedVersion: request.version, siteId: plan.site.id, planHash: plan.planHash, reportKey: randomUUID(), result });
    const reply = await page.request.post(`${url()}/outcome`, { headers: { origin, "Content-Type": "application/json" }, data: body });
    check(reply.status() === 200, `The real owned API records the synthetic ${result} food report.`);
    return { body, value: foodAccessReportSchema.parse((await reply.json()).report) };
  }
  async function work() {
    const result = await runOneParentJob({ continuationOnly: true,
      database: { query: async (sql, values) => {
        const result = await worker.query(sql, values);
        if (sql.includes("parent_claim_job(") && result.rows[0]?.job) check(result.rows[0].job.request.id === id, "The native directory worker claims only its dedicated owned request.");
        return result;
      } }, brokerOrigin: "http://127.0.0.1:3310", brokerSecret: "native-directory-fixture-never-a-real-broker", supabaseOrigin: local.API_URL, fetcher: source.fetcher });
    check(source.unexpected === 0, "The no-key directory worker attempts no broker, model or other external request.");
    return result;
  }
  try {
    check((await db.query("select count(*)::int n from public.parent_requests where status in ('active','paused')")).rows[0].n === 0,
      "The dedicated directory native proof begins after all prior request lifecycles finish.");
    await contender.connect(); contenderConnected = true; await contender.query("set role parent_worker");
    check((await contender.query("select current_user role")).rows[0].role === "parent_worker", "The competing directory claim uses a second actual restricted PG connection.");
    const windowReply = await page.request.get(`${origin}/api/parent/authorization-window`), window = await windowReply.json();
    check(windowReply.status() === 200 && window.ok === true && Date.parse(window.authorization?.expiresAt) > Date.now(), "The directory mandate uses the real current server deadline.");
    const created = await page.request.post(`${origin}/api/parent/requests`, { headers: { origin, "Idempotency-Key": startKey }, data: {
      intake: fixtureIntake({ needs: ["food_now"], zip: "19129", householdSize: null, utilityProviders: [], accountAuthority: "not_sure" }),
      mandate: fixtureMandate({ mode: "prepare_only", recipientIds: [SHARE_FOOD_ACCESS_PROGRAM], allowedActions: ["research", "prepare"], allowedData: ["household"], maxRecipients: 1, bookingPreference: "ask_me", expiresAt: window.authorization.expiresAt }),
    } });
    check(created.status() === 201, "The dedicated directory request starts through actual Auth, HTTP and DataAPI.");
    id = z.uuid().parse((await created.json()).request?.id);
    check((await work()).state === "saved", "The native worker prepares the original public food plan without a viewer or model key.");
    const original = await report("no_food"), checkedAfter = Date.now();
    check((await work()).state === "saved", "The real failed report wakes an autonomous native public-directory check.");
    const request = await read(), observation = foodAccessAlternativesSchema.parse(request.plan?.routes[0].foodAccessAlternatives);
    assert.deepEqual(observation.sourceReport, original.value);
    check(observation.availability === "city_listed_unconfirmed" && observation.state === "listed" && observation.sourceUrl === SHARE_FOOD_ACCESS_SOURCE.cityUrl
      && observation.requestId === id && observation.requestVersion === request.version && observation.queriedZip === "19129"
      && JSON.stringify(observation.sites.map(site => site.id)) === JSON.stringify([148, 155])
      && Date.parse(observation.checkedAt) >= checkedAfter && Date.parse(observation.checkedAt) <= Date.now(),
    "The actual saved DTO preserves exact report/time/source and excludes failed, closed, seasonal, delivery-only, wrong-ZIP and restricted entries; no food is confirmed.");
    const beforeReplay = await state(), callsBeforeReopen = { selected: source.selected, directory: source.directory };
    const replay = await page.request.post(`${url()}/outcome`, { headers: { origin, "Content-Type": "application/json" }, data: original.body });
    check(replay.status() === 200, "The real API acknowledges an exact negative-report retry after the plan changed.");
    assert.deepEqual(foodAccessReportSchema.parse((await replay.json()).report), original.value); assert.deepEqual(await state(), beforeReplay);
    const denied = await fetchWithTimeout(url());
    check([401, 403].includes(denied.status), "The saved directory observation is unavailable without the parent's actual Auth session.");
    viewer = await page.context().newPage(); let sourceReads = 0, outsideRequests = 0;
    await viewer.route("**/*", route => {
      const target = new URL(route.request().url());
      if (target.origin !== origin && target.origin !== local.API_URL) { outsideRequests++; return route.abort(); }
      if (target.origin === origin && target.pathname === "/api/parent/food-sites") { sourceReads++; return route.abort(); }
      return route.continue();
    });
    const opened = await viewer.goto(`${origin}/support/${id}`, { waitUntil: "networkidle" });
    check(opened?.status() === 200, "The parent reopens the actual saved directory request.");
    await viewer.locator('a[href="#application-programs"]').first().click();
    await viewer.locator("#food-access-directory-results").getByRole("heading", { name: "Synthetic City alternate 148", exact: true }).waitFor();
    check(sourceReads === 0 && outsideRequests === 0 && source.selected === callsBeforeReopen.selected && source.directory === callsBeforeReopen.directory,
      "Reopening reads the persisted directory entries without querying the source, fabricating an API result or repeating a report.");
    await viewer.close(); viewer = undefined;

    await report("could_not_access"); source.mode = "unavailable";
    const outageAt = Date.now(); check((await work()).state === "saved", "A temporary directory outage is retained as a CaseLink issue.");
    const unavailable = await state(), unavailableRequest = await read();
    check(unavailable.job.state === "waiting" && unavailable.job.attempts === 3 && unavailable.request.next_actor === "caselink"
      && unavailable.request.next_trigger === "scheduled_follow_up" && Date.parse(unavailable.job.run_at) >= outageAt + FOOD_DIRECTORY_CACHE_SECONDS * 1000
      && foodAccessAlternativesSchema.parse(unavailableRequest.plan?.routes[0].foodAccessAlternatives).state === "unavailable",
    "Native persistence schedules the owned retry no sooner than the existing cache window without resetting attempts or asking the parent to reapprove.");
    const directoryBeforeIdle = source.directory;
    check((await work()).state === "idle" && source.directory === directoryBeforeIdle, "The actual native claim respects the saved retry deadline instead of immediately polling.");

    await report("some_food_still_needed"); held = source.hold(); inFlight = work();
    await Promise.race([held.reached, inFlight.then(() => { throw new Error("Native worker finished before its expected held directory read"); })]);
    check((await contender.query("select parent_private.parent_claim_job(300,true,false,false) job")).rows[0].job === null,
      "A second actual PG connection cannot take the leased directory job while the public lookup is pending.");
    const corrected = await report("received_enough_food"), during = await state();
    check(during.job.state === "leased" && during.job.receipt_wake_lease_token === during.job.lease_token,
      "The real positive-report transaction records a wake for the existing native lease.");
    held.release(); check((await inFlight).state === "saved", "The original native turn reconciles the report wake."); inFlight = undefined;
    const afterRace = await read(), afterRaceState = await state();
    assert.deepEqual(foodAccessReportSchema.parse(afterRace.plan?.routes[0].foodAccessReport), corrected.value);
    check(afterRaceState.job.state === "queued" && afterRaceState.job.receipt_wake_lease_token === null
      && currentFoodAccessAlternatives(afterRace.plan?.routes[0].foodAccessAlternatives, afterRace, corrected.value) === null
      && afterRace.plan?.routes[0].foodAccessAlternatives?.sourceReport.eventId !== corrected.value.eventId,
    "The stale negative-directory completion cannot overwrite the corrected positive report or appear as current food access; a fresh turn stays queued.");
    const directoryBeforePositive = source.directory; check((await work()).state === "saved", "The resumed native turn handles the current positive food outcome.");
    const completed = await state();
    check(completed.request.status === "closed" && completed.request.closed_reason === "completed" && completed.request.version === request.version + 1
      && completed.job.state === "cancelled" && completed.events.filter((event: { kind: string }) => event.kind === "parent.outcome_reported").length === 4
      && source.directory === directoryBeforePositive && completed.operations === 0 && completed.model_calls === 0 && completed.reservations === budgetBefore,
    "The attributed native outcome closes once, retains all four reports, and creates no provider operation, model call, reservation or further negative-source query.");
  } catch (error) { failures.push(error); }
  finally {
    held?.release();
    const cleanup = [
      async () => { if (inFlight) await inFlight; },
      async () => {
        const owned = (await db.query("select r.id,r.status from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=$1 and r.start_key=$2", [input.ownerId, startKey])).rows;
        for (const request of owned) if (["active", "paused"].includes(request.status)) {
          const reply = await page.request.post(`${origin}/api/parent/requests/${request.id}`, { headers: { origin }, data: { action: "cancel" } });
          check(reply.status() === 200, "Cleanup cancels only the dedicated owned directory request through its actual API.");
        }
      },
      async () => { if (viewer && !viewer.isClosed()) await viewer.close(); },
      async () => { try { if (contenderConnected) await contender.query("reset role"); } finally { await contender.end(); } },
      async () => { check((await worker.query("select current_user role")).rows[0].role === originalWorkerRole, "The directory helper preserves the caller's exact worker-role baseline; Root restores membership outside it."); },
    ];
    for (const restore of cleanup) try { await restore(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Native food-directory proof or independent cleanup failed");
  return [id!];
}
