/** Actual local Auth, email, browser and Data API checks. One labeled lost ACK follows a real server write; no remote targets. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type BrowserContext, type Page, type Request as BrowserRequest, type APIResponse, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { PDFDocument } from "pdf-lib";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";
import { SNAP_APPLICATION_NOTICE_VERSION, WIC_APPLICATION_NOTICE_VERSION, WIC_SUBJECT_AUTHORITY_STATEMENT } from "../src/lib/parent/constants";
import { assessSnapApplicationFields, SNAP_APPLICATION_SOURCE } from "../src/lib/parent/snap-application-fields";
import { assessSnapApplicationSnapshot, snapApplicationSnapshotSchema, type SnapApplicationSnapshot } from "../src/lib/parent/snap-application-snapshot";
import { SNAP_EN_TEMPLATE_ID, SNAP_ES_TEMPLATE_ID, SNAP_SPANISH_APPLICATION_SOURCE } from "../src/lib/parent/snap-form-source";
import { renderSnapSigningCopy } from "../src/lib/parent/snap-signing-copy";
import { WIC_APPLICATION_SOURCE } from "../src/lib/parent/wic-application-fields";
import type { WicApplicationSnapshot } from "../src/lib/parent/wic-application-snapshot";
import { PECO_APPLICATION_NOTICE_VERSION, PECO_APPLICATION_SOURCE, PECO_SUBJECT_AUTHORITY_STATEMENT, PECO_ACCOUNT_AUTHORITY_STATEMENT } from "../src/lib/parent/peco-application-fields";
import type { PecoApplicationSnapshot } from "../src/lib/parent/peco-application-snapshot";
import { PGW_APPLICATION_NOTICE_VERSION, PGW_APPLICATION_SOURCE, PGW_SUBJECT_AUTHORITY_STATEMENT, PGW_ACCOUNT_AUTHORITY_STATEMENT } from "../src/lib/parent/pgw-application-fields";
import { pgwApplicationSnapshotSchema } from "../src/lib/parent/pgw-application-snapshot";
import { WATER_APPLICATION_NOTICE_VERSION, WATER_APPLICATION_REFERENCE, WATER_SUBJECT_AUTHORITY_STATEMENT, WATER_ACCOUNT_AUTHORITY_STATEMENT } from "../src/lib/parent/water-application-fields";
import { waterApplicationSnapshotSchema } from "../src/lib/parent/water-application-snapshot";
import { foodAccessPlanSchema, foodAccessReportSchema, SHARE_FOOD_ACCESS_PROGRAM } from "../src/lib/parent/food-access";
import { FAMILY_PROFILE_NOTICE_VERSION, familyProfileReadSchema } from "../src/lib/parent/family-profile";
import { projectFamilyProfileApplication, familyProfileApplicationValue, replaceFamilyProfileApplicationValue } from "../src/lib/parent/family-profile-application";
import { FOOD_DESCRIPTION_NOTICE_VERSION, foodDescriptionArchiveSchema } from "../src/lib/parent/food-description-draft";
import { FOOD_DESCRIPTION_FINGERPRINT, runOneFoodDescriptionTurn } from "../src/lib/parent/food-description-runtime";
import { buildFoodDescriptionProjection } from "../src/lib/parent/food-description";
import { foodDescriptionViewSchema } from "../src/lib/parent/food-description-view";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "../src/lib/parent/test-fixtures";
import type { SupportRequest } from "../src/lib/parent/domain";
import { runOneParentJob } from "../src/lib/parent/worker-runtime";
import { assertSyntheticParentAuthTargets, beginParentTestApproval } from "./parent-test-approval";
import { verifyNativeSupportUpdates } from "./parent-support-update-native";
import { verifyNativeFoodDirectory } from "./parent-food-directory-native-proof";

const origin = process.env.PARENT_TEST_ORIGIN ?? "http://127.0.0.1:3200";
const checks: string[] = [];
const snapAccessibility: { state: string; width: number; height: number; screenshot: string; overflow: boolean; violations: string[] }[] = [];
const wicAccessibility: typeof snapAccessibility = [];
const pecoAccessibility: typeof snapAccessibility = [];
const utilityAccessibility: (typeof snapAccessibility[number] & { program: "pgw" | "water" })[] = [];
let stage = "local service configuration";
function check(condition: unknown, label: string): asserts condition {
  assert.ok(condition, label);
  checks.push(label);
}

async function main() {
  const target = new URL(origin);
  check(
    target.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(target.hostname) &&
      target.origin === origin && !target.username && !target.password,
    "The actual Auth browser origin is a canonical loopback HTTP origin.",
  );
  const cli = process.env.CASELINK_SUPABASE_CLI;
  check(cli, "An explicit installed Supabase CLI is required.");
  const local = JSON.parse(
    execFileSync(
      cli,
      [
        "status",
        "--workdir",
        resolve("tmp/parent-runtime"),
        "--output",
        "json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000, env: { ...process.env, DO_NOT_TRACK: "1" } },
    ),
  ) as Record<string, string>;
  for (const [name, port] of [
    ["API_URL", "55321"],
    ["DB_URL", "55322"],
    ["MAILPIT_URL", "55324"],
  ]) {
    const url = new URL(local[name]);
    check(
      ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === port,
      `${name} is the isolated local parent service.`,
    );
  }
  check(
    local.ANON_KEY && local.SERVICE_ROLE_KEY,
    "Local Auth public and fixture-admin credentials are available.",
  );
  const syntheticApproval = process.argv.includes("--synthetic-approval");
  if (syntheticApproval) assertSyntheticParentAuthTargets(origin, local);
  const operator = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchWithTimeout },
  });
  const db = new Client({
    connectionString: local.DB_URL,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  await db.connect();
  const browser = await chromium
    .launch({ headless: true })
    .catch(async (error) => {
      await db.end();
      throw error;
    });
  const contexts: BrowserContext[] = [];
  const emails = [0, 1, 2, 3, 4, 5, 6].map(
    () => `parent-auth-${randomUUID()}@example.test`,
  );
  const seenMail = new Set<string>();
  let rateLimitObserved = false;
  let previousExistingAccounts: boolean | undefined;
  let fixtureApproval: Awaited<ReturnType<typeof beginParentTestApproval>> | undefined;

  async function deliveredCode(email: string): Promise<string> {
    for (let attempt = 0; attempt < 60; attempt++) {
      const response = await fetchWithTimeout(
        `${local.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      );
      check(
        response.status === 200,
        "The actual local test email inbox is available.",
      );
      const result = (await response.json()) as { messages: { ID: string }[] };
      for (const message of result.messages) {
        if (seenMail.has(message.ID)) continue;
        const detail = (await (
          await fetchWithTimeout(
            `${local.MAILPIT_URL}/api/v1/message/${message.ID}`,
          )
        ).json()) as { HTML: string; Subject: string };
        if (detail.Subject !== "Your CaseLink sign-in code") continue;
        const code = detail.HTML.match(/>\s*(\d{6,10})\s*</)?.[1];
        check(
          code,
          "The delivered parent email contains the expected numeric sign-in code.",
        );
        seenMail.add(message.ID);
        return code;
      }
      await delay(250);
    }
    throw new Error("The actual parent code email did not arrive.");
  }
  async function newParent(email: string) {
    stage = "opening the actual email-code sign-in form";
    const context = await browser.newContext({
      baseURL: origin,
      reducedMotion: "reduce",
    });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(`${origin}/sign-in`, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Use an email code instead" })
      .click();
    await page.getByLabel("Your email address").fill(email);
    stage = "sending the actual email code from the sign-in form";
    const sent = page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/auth` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Email me a code" }).click();
    check(
      (await sent).status() === 200,
      "The real parent UI requests a code successfully.",
    );
    await page.getByLabel("Email code").waitFor();
    stage = "reading the actual delivered local email code";
    const code = await deliveredCode(email);
    const user = (
      await db.query(
        "select id,email_confirmed_at from auth.users where email=$1",
        [email],
      )
    ).rows[0];
    check(
      user && !user.email_confirmed_at,
      "New parent email ownership remains unverified before the code is accepted.",
    );
    check(
      (
        await db.query(
          "select count(*)::int n from public.parent_accounts where id=$1",
          [user.id],
        )
      ).rows[0].n === 0,
      "Requesting a code does not provision a parent household before verification.",
    );
    return { context, page, code, id: user.id as string };
  }
  async function enterCode(page: Page, code: string) {
    await page.getByLabel("Email code").fill(code);
    const verified = page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/auth` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    return verified;
  }
  async function accessToken(context: BrowserContext) {
    const cookies = (await context.cookies()).filter((cookie) =>
      /^caselink-parent-auth(?:\.\d+)?$/.test(cookie.name),
    );
    check(
      cookies.length > 0 &&
        cookies.every(
          (cookie) =>
            cookie.httpOnly && cookie.sameSite === "Lax" && cookie.path === "/",
        ),
      "Actual parent session cookies are HttpOnly, SameSite=Lax and scoped to the site.",
    );
    const stored = cookies
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      )
      .map((cookie) => cookie.value)
      .join("");
    const session = JSON.parse(
      stored.startsWith("base64-")
        ? Buffer.from(stored.slice(7), "base64url").toString()
        : stored,
    ) as { access_token?: string };
    check(
      session.access_token,
      "The actual browser session can exercise direct retained-token authorization checks.",
    );
    return session.access_token;
  }
  async function rest(token: string, path: string, body?: unknown) {
    return fetchWithTimeout(`${local.API_URL}/rest/v1/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        apikey: local.ANON_KEY,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function showSection(page: Page, section: string) {
    await page.getByRole("navigation", { name: "Your application checklist" }).locator(`a[href="#${section}"]`).click();
  }
  async function startFoodRequest(page: Page) {
    await page.goto(`${origin}/get-support?need=food`, {
      waitUntil: "networkidle",
    });
    await page.getByLabel(/enough food for today and tomorrow/).selectOption("no");
    await page.getByLabel(/help paying for groceries/).selectOption("applied");
    await page.getByRole("button", { name: "See my options", exact: true }).click();
    await page.getByRole("button", { name: "Food for now", exact: true }).click();
    await page.getByLabel("Household ZIP code").waitFor();
    check(await page.getByLabel("Request timing").inputValue() === "today" &&
      page.url() === `${origin}/get-support?need=food`,
    "The actual guided shortage proposes today's priority without putting household answers in the URL.");
    await page.getByLabel("Household ZIP code").fill("");
    await page.getByLabel("Household ZIP code").fill("19104");
    await page.getByRole("checkbox", { name: /I’m 18 or older/ }).check();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Food for now", exact: true }).click();
    check(await page.getByLabel("Household ZIP code").inputValue() === "19104" &&
      await page.getByRole("checkbox", { name: /I’m 18 or older/ }).isChecked(),
    "Returning to the actual guide and chosen path preserves the typed request draft.");
    const assessed = page.waitForResponse(response => response.url() === `${origin}/api/parent/food-assessment` && response.request().method() === "POST");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const assessment = await assessed;
    const options = await assessment.json();
    check(assessment.status() === 200 && assessment.headers()["cache-control"] === "private, no-store" &&
      JSON.stringify(assessment.request().postDataJSON().needs) === JSON.stringify(["food_now"]) &&
      JSON.stringify(options.candidates.map((candidate: { need: string }) => candidate.need)) === JSON.stringify(["food_now"]),
    "The real authenticated web and Data API recompute only the selected food path before the exact mandate, without starting the proposed SNAP sibling.");
    await page.getByText("We can prepare. Applications are not connected yet.", { exact: true }).waitFor();
    check(
      await page
        .getByText("We can prepare. Applications are not connected yet.", {
          exact: true,
        })
        .isVisible(),
      "The actual permission screen describes the unconnected preparation-only scope honestly.",
    );
    await page
      .getByRole("checkbox", {
        name: /I authorize research and preparation only/,
      })
      .check();
    const started = page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/requests` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Start getting support" }).click();
    const start = await started;
    check(
      start.status() === 201,
      `The actual three-step intake and Start button record a bounded preparation-only request (HTTP ${start.status()}).`,
    );
    const startBody = start.request().postDataJSON();
    check(JSON.stringify(startBody.intake.needs) === JSON.stringify(["food_now"]) &&
      startBody.intake.urgency === "today" && !Object.hasOwn(startBody, "answers"),
    "The guided start freezes only the chosen typed food request; raw assessment answers and unchosen paths are not persisted as request data.");
    const id = (await start.json()).request.id as string;
    await page.waitForURL(`${origin}/support/${id}`);
    await showSection(page, "application-controls");
    return id;
  }

  try {
    if (syntheticApproval) {
      stage = "recording a bounded empty-stack synthetic Auth approval";
      fixtureApproval = await beginParentTestApproval(db, true);
    }
    check(
      (await db.query("select parent_private.processing_enabled() enabled"))
        .rows[0].enabled === true,
      "A genuine local synthetic processing approval is enabled before the rehearsal.",
    );
    stage = "new-parent code enrollment through the real browser UI";
    const first = await newParent(emails[0]);
    stage = "rejecting an incorrect actual email code";
    check(
      (
        await enterCode(
          first.page,
          first.code === "000000" ? "000001" : "000000",
        )
      ).status() === 400,
      "A wrong actual email code cannot sign in.",
    );
    await first.page
      .getByRole("alert")
      .filter({ hasText: "That code is incorrect or expired." })
      .waitFor();
    stage = "accepting the actual delivered email code";
    check(
      (await enterCode(first.page, first.code)).status() === 200,
      "The delivered actual email code completes parent sign-in.",
    );
    await first.page.waitForURL(`${origin}/my-support`);
    stage = "loading the actual authenticated account and browser cookie";
    const account = await first.page.request.get(
      `${origin}/api/parent/account`,
    );
    check(
      account.status() === 200 &&
        (await account.json()).account.email === emails[0],
      "The real account endpoint returns the authenticated parent's own account.",
    );
    check(
      account.headers()["cache-control"] === "private, no-store",
      "Authenticated parent account responses are private and never cached.",
    );
    await first.page.reload({ waitUntil: "networkidle" });
    const token = await accessToken(first.context);
    stage = "actual keyed support-update acknowledgement and two-connection CAS";
    await verifyNativeSupportUpdates({ origin, databaseUrl: local.DB_URL, api: first.page.request, token, ownerId: first.id, admin: db, check });
    stage = "checking actual parent-only membership";
    const membership = (
      await db.query(
        "select (select count(*)::int from public.parent_accounts where id=$1) accounts,(select count(*)::int from public.parent_households where owner_id=$1) households,(select count(*)::int from public.app_users where id=$1) school_roles,(select count(*)::int from public.families where created_by_id=$1) school_families",
        [first.id],
      )
    ).rows[0];
    check(
      membership.accounts === 1 &&
        membership.households === 1 &&
        membership.school_roles === 0 &&
        membership.school_families === 0,
      "Verified enrollment and reload create exactly one owned parent household and no school role or school family.",
    );
    check(
      (await rest(token, "rpc/ensure_app_user", {})).status === 403,
      "A real parent identity cannot provision a legacy school role through a direct RPC.",
    );

    stage = "actual owned public food request before other queued work";
    async function foodSetupStep<T>(label: string, operation: () => Promise<T>): Promise<T> {
      stage = label;
      try { return await operation(); }
      catch (error) {
        const name = error instanceof Error && ["Error", "TypeError", "SyntaxError", "RangeError", "TimeoutError", "AssertionError", "ZodError", "error"].includes(error.name)
          ? error.name : "unclassified";
        const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
        const code = typeof rawCode === "string" && ["42501", "23514", "23503", "23505", "42P01", "42703", "42883", "42804", "22007", "22023", "22P02", "PT409", "40001", "57014", "57P01", "53300", "08006", "28P01"].includes(rawCode)
          ? rawCode : "unclassified";
        process.stderr.write(`Native public food setup category: name=${name}, pg=${code}. No response or database values were logged.\n`);
        throw new Error("Native public food setup failed.");
      }
    }
    check((await foodSetupStep("counting existing requests before native public food", () => db.query("select count(*)::int n from public.parent_requests"))).rows[0].n === 0,
      "The public food rehearsal starts before any other request can be claimed by its worker.");
    const foodBudgetBefore = (await foodSetupStep("reading native public food model reservation baseline", () => db.query("select count(*)::int n from parent_private.model_call_reservations"))).rows[0].n;
    const foodWindowReply = await foodSetupStep("reading the actual native public food authorization window", () => first.page.request.get(`${origin}/api/parent/authorization-window`));
    check(foodWindowReply.status() === 200, `The public food mandate uses the actual server authorization deadline (HTTP${foodWindowReply.status()}).`);
    const foodWindow = await foodSetupStep("parsing the actual native public food authorization window", () => foodWindowReply.json());
    check(foodWindow?.ok === true && typeof foodWindow.authorization?.expiresAt === "string"
      && Number.isFinite(Date.parse(foodWindow.authorization.expiresAt)) && Date.parse(foodWindow.authorization.expiresAt) > Date.now(),
    "The actual authorization response supplies a current public food deadline before the request is created.");
    const foodDeadline = foodWindow.authorization.expiresAt as string;
    const foodStarting = await foodSetupStep("creating the actual owned preparation-only Share request", () => first.page.request.post(`${origin}/api/parent/requests`, {
      headers: { origin, "Idempotency-Key": randomUUID() },
      data: {
        intake: fixtureIntake({ needs: ["food_now"], zip: "19129", householdSize: null, utilityProviders: [], accountAuthority: "not_sure" }),
        mandate: fixtureMandate({ mode: "prepare_only", recipientIds: [SHARE_FOOD_ACCESS_PROGRAM],
          allowedActions: ["research", "prepare"], allowedData: ["household"], maxRecipients: 1,
          bookingPreference: "ask_me", expiresAt: foodDeadline }),
      },
    }));
    check(foodStarting.status() === 201, `The real owned API creates one preparation-only Share food request (HTTP${foodStarting.status()}).`);
    const foodCreated = await foodSetupStep("parsing the actual newly created Share request", () => foodStarting.json());
    check(foodCreated?.ok === true && typeof foodCreated.request?.id === "string"
      && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(foodCreated.request.id),
    "The actual creation response contains the owned food request identifier.");
    const foodRequestId = foodCreated.request.id as string;
    const completedFoodRoutingIds = [foodRequestId];
    const foodUrl = `${origin}/api/parent/requests/${foodRequestId}`;
    check((await foodSetupStep("checking the native Share request household ownership", () => db.query("select count(*)::int n from public.parent_requests r join public.parent_households h on h.id=r.household_id where r.id=$1 and h.owner_id=$2", [foodRequestId, first.id]))).rows[0].n === 1,
      "The native food request belongs only to the enrolled parent household.");
    async function readFoodRequest() {
      const response = await first.page.request.get(foodUrl);
      check(response.status() === 200 && response.headers()["cache-control"] === "private, no-store",
        "The actual owned HTTP API returns the public food plan privately.");
      const request = (await response.json()).request as SupportRequest;
      check(request.id === foodRequestId, "The food-plan response remains bound to this owned request.");
      return request;
    }
    const foodState = async (id = foodRequestId) => (await db.query(`select r.version,r.status,r.closed_reason,r.next_actor,r.next_trigger,r.next_run_at,r.updated_at request_updated_at,
      j.state job_state,j.request_version,j.run_at,j.updated_at job_updated_at,
      (select count(*)::int from public.parent_events e where e.request_id=r.id and e.kind='parent.outcome_reported') reports,
      (select count(*)::int from public.parent_operations o where o.request_id=r.id) operations,
      (select count(*)::int from parent_private.ai_calls a where a.request_id=r.id) model_calls,
      (select count(*)::int from parent_private.model_call_reservations) model_reservations
      from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1`, [id])).rows[0];
    const foodViewer = await foodSetupStep("creating the owned native food request viewer", () => first.context.newPage());
    const foodPage = await foodSetupStep("opening the owned native food request viewer", () => foodViewer.goto(`${origin}/support/${foodRequestId}`, { waitUntil: "networkidle" }));
    check(foodPage?.status() === 200, "The enrolled parent can open the actual owned food request viewer.");
    await foodSetupStep("closing the owned native food request viewer before work", () => foodViewer.close());
    check(foodViewer.isClosed(), "The owned request viewer closes before its durable food continuation runs.");
    const foodWorker = new Client({ connectionString: local.DB_URL, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
    let cityChecks = 0;
    async function foodTurn(requestId = foodRequestId, worker = foodWorker) {
      const before = cityChecks;
      const result = await runOneParentJob({
        database: { query: async (sql, values) => {
          const result = await worker.query(sql, values);
          if (sql.includes("parent_claim_job(")) check(result.rows[0]?.job?.request?.id === requestId,
            "The isolated continuation claims only this run's owned public food request.");
          return result;
        } },
        continuationOnly: true,
        brokerOrigin: "http://127.0.0.1:3310", brokerSecret: "isolated-public-food-fixture-no-real-broker", supabaseOrigin: local.API_URL,
        fetcher: async (input, init) => {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
          check(url.origin === "https://services.arcgis.com" && url.pathname === "/fLeGjb7u4uXqeF9q/arcgis/rest/services/free_meal_sites/FeatureServer/0/query"
            && url.searchParams.get("where") === "objectid=122" && (init?.method ?? "GET") === "GET",
          "The worker's only fetch is the fixed synthetic City122 public-record check; no broker, provider or model can be contacted.");
          cityChecks++;
          return Response.json({ features: [{ attributes: { objectid: 122, site_name: "Share Community Fridge", address: "2901 W Hunting Park Ave",
            zip_code: "19129", status: "Active", category_type: "Food Site", temporary_closure: null, seasonally_closed: null } }] });
        },
      });
      check(result.state === "saved" && cityChecks === before + 1,
        "A no-key native continuation saves one food turn using only the explicit City fixture.");
    }
    type FoodMembership = { role_name: string; grantor: string; admin_option: boolean; inherit_option: boolean; set_option: boolean };
    const foodMemberships = async () => (await db.query("select granted.rolname role_name,grantor.rolname grantor,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles member on member.oid=m.member join pg_roles granted on granted.oid=m.roleid join pg_roles grantor on grantor.oid=m.grantor where member.rolname=current_user order by granted.rolname,grantor.rolname")).rows as FoodMembership[];
    const foodIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
    let originalFoodMemberships: FoodMembership[] | undefined, foodOperator = "";
    let changedFoodMembership: { existed: boolean; set: boolean } | undefined;
    try {
      stage = "checking the isolated native public food fixture approval";
      check(syntheticApproval && !!fixtureApproval && Date.parse(fixtureApproval.approvedUntil) > Date.now(),
        "Temporary worker SET access requires the explicit current synthetic fixture approval.");
      assertSyntheticParentAuthTargets(origin, local);
      foodOperator = (await foodSetupStep("reading the native food fixture operator", () => db.query("select current_user name"))).rows[0].name as string;
      originalFoodMemberships = await foodSetupStep("reading the original native food fixture memberships", foodMemberships);
      const existing = originalFoodMemberships.filter(membership => membership.role_name === "parent_worker");
      check(existing.some(membership => membership.admin_option),
        "The local food fixture requires an existing ADMIN worker membership before temporarily changing SET.");
      if (!existing.some(membership => membership.set_option)) {
        const own = existing.find(membership => membership.grantor === foodOperator);
        changedFoodMembership = { existed: !!own, set: own?.set_option ?? false };
        await foodSetupStep("temporarily enabling existing native food fixture worker SET access", () => db.query(
          `grant parent_worker to ${foodIdentifier(foodOperator)} with ${own ? "" : "admin false, inherit false, "}set true`,
        ));
      }
      await foodSetupStep("connecting the isolated native public food worker", () => foodWorker.connect());
      await foodSetupStep("selecting the restricted native public food worker role", () => foodWorker.query("set role parent_worker"));
      check((await foodSetupStep("verifying the restricted native public food worker role", () => foodWorker.query("select current_user as role"))).rows[0].role === "parent_worker",
        "The native public food continuation runs under the actual restricted parent_worker role.");
      stage = "native food preparation without the request viewer";
      await foodTurn();
      const preparedFood = await readFoodRequest();
      const firstFoodPlan = foodAccessPlanSchema.parse(preparedFood.plan?.routes.find(route => route.need === "food_now")?.foodAccess);
      check(preparedFood.status === "active" && firstFoodPlan.requestId === foodRequestId && firstFoodPlan.requestVersion === preparedFood.version
        && firstFoodPlan.state === "prepared" && firstFoodPlan.site.stock === "unknown" && firstFoodPlan.site.reservation === "none",
      "Actual leased work prepares owned public directions with unknown stock and no reservation after the viewer closes.");
      stage = "actual food failure report and exact acknowledgement replay";
      const noFoodBody = JSON.stringify({ action: "food_visit", expectedVersion: preparedFood.version, siteId: firstFoodPlan.site.id,
        planHash: firstFoodPlan.planHash, reportKey: randomUUID(), result: "no_food" });
      const noFoodReply = await first.page.request.post(`${foodUrl}/outcome`, { headers: { origin, "Content-Type": "application/json" }, data: noFoodBody });
      check(noFoodReply.status() === 200, "The actual owned API records a site-bound no-food report.");
      const noFoodReport = foodAccessReportSchema.parse((await noFoodReply.json()).report), beforeFoodReplay = await foodState();
      const replayFoodReply = await first.page.request.post(`${foodUrl}/outcome`, { headers: { origin, "Content-Type": "application/json" }, data: noFoodBody });
      check(replayFoodReply.status() === 200, "The actual food-report API accepts an exact retry of the original body and key.");
      const replayFoodReport = foodAccessReportSchema.parse((await replayFoodReply.json()).report);
      check(JSON.stringify(replayFoodReport) === JSON.stringify(noFoodReport) && beforeFoodReplay.reports === 1
        && JSON.stringify(await foodState()) === JSON.stringify(beforeFoodReplay),
      "Exact replay preserves the same food event/time and database state without a duplicate report or job wake.");
      stage = "native continuation retains the unmet food need";
      await foodTurn();
      const unmetFood = await readFoodRequest(), unmetFoodState = await foodState();
      const unmetRoute = unmetFood.plan?.routes.find(route => route.need === "food_now");
      check(unmetFood.status === "active" && unmetFood.version === preparedFood.version && unmetFoodState.request_version === preparedFood.version
        && unmetRoute?.state === "unresolved" && unmetRoute.foodAccessReport?.eventId === noFoodReport.eventId,
      "The actual failure continuation keeps the owned need active and unresolved at its unchanged request/job version.");
      const currentFoodPlan = foodAccessPlanSchema.parse(unmetRoute.foodAccess);
      stage = "actual attributed enough-food report and scoped completion";
      const receivedFoodReply = await first.page.request.post(`${foodUrl}/outcome`, { headers: { origin }, data: {
        action: "food_visit", expectedVersion: unmetFood.version, siteId: currentFoodPlan.site.id,
        planHash: currentFoodPlan.planHash, reportKey: randomUUID(), result: "received_enough_food",
      } });
      check(receivedFoodReply.status() === 200, "The actual API records the later synthetic enough-food report against the current plan.");
      const receivedFood = foodAccessReportSchema.parse((await receivedFoodReply.json()).report);
      await foodTurn();
      const completedFood = await readFoodRequest(), completedFoodState = await foodState();
      check(completedFood.status === "closed" && completedFoodState.closed_reason === "completed" && completedFoodState.job_state === "cancelled"
        && receivedFood.attribution === "parent_reported" && completedFood.plan?.routes[0].foodAccessReport?.eventId === receivedFood.eventId
        && completedFoodState.reports === 2 && (await db.query("select count(*)::int n from public.parent_requests where id<>$1", [foodRequestId])).rows[0].n === 0,
      "The attributed enough-food report completes only this synthetic request and retains both distinct visit reports.");
      check(completedFoodState.operations === 0 && completedFoodState.model_calls === 0 && completedFoodState.model_reservations === foodBudgetBefore,
        "The complete native public food lifecycle creates no provider operation, request model call or model-budget reservation.");

      stage = "actual guided combined food and pending SNAP start";
      const mixedPage = await first.context.newPage();
      await mixedPage.goto(`${origin}/get-support?need=food`, { waitUntil: "networkidle" });
      await mixedPage.getByLabel(/enough food for today and tomorrow/).selectOption("no");
      await mixedPage.getByLabel(/help paying for groceries/).selectOption("applied");
      await mixedPage.getByRole("button", { name: "See my options", exact: true }).click();
      await mixedPage.getByRole("button", { name: "Continue with both options", exact: true }).click();
      await mixedPage.getByLabel("Household ZIP code").fill("19129");
      await mixedPage.getByRole("checkbox", { name: /I’m 18 or older/ }).check();
      const mixedAssessing = mixedPage.waitForResponse(response => response.url() === `${origin}/api/parent/food-assessment` && response.request().method() === "POST");
      await mixedPage.getByRole("button", { name: "Continue", exact: true }).click();
      const mixedAssessment = await mixedAssessing;
      check(mixedAssessment.status() === 200 && mixedAssessment.headers()["cache-control"] === "private, no-store"
        && JSON.stringify(mixedAssessment.request().postDataJSON().needs) === JSON.stringify(["food_now", "snap_pending"])
        && JSON.stringify((await mixedAssessment.json()).candidates.map((path: { need: string }) => path.need)) === JSON.stringify(["food_now", "snap_pending"]),
      "The actual guide validates both selected compatible paths without turning an existing SNAP case into a new application.");
      await mixedPage.getByRole("checkbox", { name: /I authorize research and preparation only/ }).check();
      const mixedStarting = mixedPage.waitForResponse(response => response.url() === `${origin}/api/parent/requests` && response.request().method() === "POST");
      await mixedPage.getByRole("button", { name: "Start getting support" }).click();
      const mixedStarted = await mixedStarting, mixedStartBody = mixedStarted.request().postDataJSON();
      check(mixedStarted.status() === 201 && mixedStartBody.kind === undefined && !Object.hasOwn(mixedStartBody, "answers")
        && JSON.stringify(mixedStartBody.intake.needs) === JSON.stringify(["food_now", "snap_pending"])
        && mixedStartBody.mandate.recipientIds.includes(SHARE_FOOD_ACCESS_PROGRAM) && mixedStartBody.mandate.recipientIds.includes("snap-pa")
        && mixedStartBody.mandate.mode === "prepare_only",
      "One actual Start records the named preparation-only food/SNAP mandate without raw guide answers or private new-application data.");
      const mixedId = (await mixedStarted.json()).request.id as string, mixedUrl = `${origin}/api/parent/requests/${mixedId}`;
      await mixedPage.waitForURL(`${origin}/support/${mixedId}`);
      const mixedReplay = await first.page.request.post(`${origin}/api/parent/requests`, {
        headers: { origin, "Idempotency-Key": mixedStarted.request().headers()["idempotency-key"] }, data: mixedStartBody });
      check(mixedReplay.status() === 201 && (await mixedReplay.json()).request.id === mixedId
        && (await db.query("select count(*)::int n from public.parent_jobs where request_id=$1", [mixedId])).rows[0].n === 1,
      "The actual exact combined start retry returns one request and one durable job.");
      await mixedPage.close();

      stage = "actual independent worker claim race and expired-lease recovery";
      const racingWorker = new Client({ connectionString: local.DB_URL, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
      let racedLease: { jobId: string; leaseToken: string; request: SupportRequest };
      try {
        await racingWorker.connect();
        await racingWorker.query("set role parent_worker");
        const claims = await Promise.all([foodWorker, racingWorker].map(client => client.query("select parent_private.parent_claim_job(15,true,false,false) job")));
        const admitted = claims.map(reply => reply.rows[0].job).filter(Boolean);
        check(admitted.length === 1 && admitted[0].request.id === mixedId && claims.filter(reply => reply.rows[0].job === null).length === 1,
          `Two actual restricted database connections admit only one lease for the same combined request (admitted=${admitted.length}, empty=${claims.filter(reply => reply.rows[0].job === null).length}, expected=${admitted.filter(job => job.request.id === mixedId).length}).`);
        racedLease = admitted[0];
      } finally { await racingWorker.end(); }
      await delay(15_100);
      await assert.rejects(foodWorker.query("select parent_private.parent_renew_job_lease($1,$2)", [racedLease.jobId, racedLease.leaseToken]), { code: "42501" });
      checks.push("An expired native worker lease cannot renew itself after the simulated process stops.");
      await foodTurn(mixedId);
      const mixedReply = await first.page.request.get(mixedUrl);
      check(mixedReply.status() === 200 && mixedReply.headers()["cache-control"] === "private, no-store",
        "The combined owned request remains privately readable after its viewer closes and a worker lease expires.");
      const mixedRequest = (await mixedReply.json()).request as SupportRequest, mixedState = await foodState(mixedId);
      const mixedPlan = foodAccessPlanSchema.parse(mixedRequest.plan?.routes.find(route => route.need === "food_now")?.foodAccess);
      check(mixedRequest.status === "active" && mixedRequest.version === racedLease.request.version
        && JSON.stringify(mixedRequest.plan?.routes.map(route => route.need)) === JSON.stringify(["food_now", "snap_pending"])
        && mixedPlan.state === "prepared" && mixedState.job_state === "waiting" && mixedState.request_version === mixedRequest.version
        && mixedState.operations === 0 && mixedState.model_calls === 0 && mixedState.model_reservations === foodBudgetBefore,
      "The recovered actual worker preserves both paths and prepares public food independently while the unavailable SNAP driver waits without model/provider work.");

      stage = "actual concurrent attributed food and SNAP completion reports";
      const mixedFoodBody = { action: "food_visit", expectedVersion: mixedRequest.version, siteId: mixedPlan.site.id,
        planHash: mixedPlan.planHash, reportKey: randomUUID(), result: "received_enough_food" };
      const reportReplies = await Promise.all([
        first.page.request.post(`${mixedUrl}/outcome`, { headers: { origin }, data: mixedFoodBody }),
        first.page.request.post(`${mixedUrl}/outcome`, { headers: { origin }, data: {
          need: "snap_pending", outcome: "support_received", reference: "Synthetic parent report; not agency confirmation." } }),
      ]);
      check(reportReplies.every(reply => reply.status() === 200), "Concurrent actual owned report APIs both finish without a lock-order deadlock.");
      const mixedCompleted = await foodState(mixedId);
      check(mixedCompleted.status === "closed" && mixedCompleted.closed_reason === "completed" && mixedCompleted.version === mixedRequest.version + 1
        && mixedCompleted.job_state === "cancelled" && mixedCompleted.reports === 2 && mixedCompleted.operations === 0
        && mixedCompleted.model_calls === 0 && mixedCompleted.model_reservations === foodBudgetBefore,
      "Both attributed reports close the combined request exactly once without a second worker attempt, model call or provider-status claim.");
      completedFoodRoutingIds.push(mixedId);
      stage = "native failed-food directory persistence, scheduled retry and corrected-report race";
      completedFoodRoutingIds.push(...await verifyNativeFoodDirectory({ origin, local, page: first.page, ownerId: first.id, db, worker: foodWorker,
        syntheticApproval, approvedUntil: fixtureApproval!.approvedUntil, check }));
    } finally {
      const foodOutcomeStage = stage;
      try { await foodSetupStep("closing the isolated native public food worker", () => foodWorker.end()); }
      finally {
        const changed = changedFoodMembership;
        if (changed) await foodSetupStep("restoring the original native food fixture worker SET access", () => db.query(
          changed.existed
            ? `grant parent_worker to ${foodIdentifier(foodOperator)} with set ${changed.set ? "true" : "false"}`
            : `revoke parent_worker from ${foodIdentifier(foodOperator)} granted by ${foodIdentifier(foodOperator)}`,
        ));
        if (originalFoodMemberships) {
          const restored = await foodSetupStep("verifying complete native food fixture membership restoration", foodMemberships);
          check(JSON.stringify(restored) === JSON.stringify(originalFoodMemberships),
            "The native food fixture restores every original role, grantor, ADMIN, INHERIT and SET membership value exactly.");
        }
      }
      stage = foodOutcomeStage;
    }

    // Dedicated disposable owners keep new profile/history/budget cases out of every original rehearsal.
    stage = "native optional-description fixture ownership and closed gates";
    check(syntheticApproval && !!fixtureApproval && Date.parse(fixtureApproval.approvedUntil) > Date.now(),
      "Description fixtures require the original explicit, still-current isolated synthetic approval.");
    assertSyntheticParentAuthTargets(origin, local);
    const descriptionControls = (await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value;
    const descriptionHealth = (await db.query("select to_jsonb(h) value from parent_private.worker_health h where singleton")).rows[0]?.value;
    const descriptionMemberships = await foodMemberships();
    let descriptionMembershipChange: { existed: boolean; set: boolean } | undefined;
    const descriptionWorkers = [0, 1].map(() => new Client({ connectionString: local.DB_URL, connectionTimeoutMillis: 3000, statement_timeout: 5000, idle_in_transaction_session_timeout: 10000 }));
    const descriptionRequests: { page: Page; id: string }[] = [];
    const descriptionPids: number[] = [];
    let descriptionFetches = 0;
    const descriptionReservationBaseline = (await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
    const descriptionColumns = ["existing_accounts_enabled", "food_description_enabled", "food_description_approval_reference", "food_description_approved_until", "food_description_notice_version",
      "food_description_processor_reference", "food_description_evaluation_reference", "food_description_evaluation_fingerprint", "food_description_retention_reference",
      "food_description_project_budget_reference", "food_description_project_id", "food_description_budget_reference", "food_description_budget_started_at", "food_description_call_limit",
      "model_budget_started_at", "model_call_limit", "snap_details_enabled", "snap_details_approval_reference", "snap_details_approved_until", "snap_details_notice_version",
      "family_profile_enabled", "family_profile_approval_reference", "family_profile_approved_until", "family_profile_notice_version"];
    const descriptionUrl = `${origin}/api/parent/food-description`;
    const descriptionHttp = (page: Page, method: string, path: string, data?: unknown, key?: string) => page.request.fetch(`${origin}/api/parent${path}`, {
      method, headers: { origin, ...(key ? { "Idempotency-Key": key } : {}) }, ...(data === undefined ? {} : { data }),
    });
    async function descriptionAccount(index: number, school = false, foreignDraftId?: string) {
      const password = `Isolated-description-${randomUUID()}-Aa9!`;
      const created = await operator.auth.admin.createUser({ email: emails[index], password, email_confirm: true });
      check(!created.error && created.data.user, "An additional disposable description identity exists only in the isolated local Auth project.");
      const id = created.data.user.id;
      if (school) {
        await db.query("insert into public.app_users(id,email,role,is_active) values($1,$2,'case_manager',true)", [id, emails[index]]);
        await db.query("insert into public.families(name,created_by_id) values('Synthetic description school separation',$1)", [id]);
        const schoolAuth = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchWithTimeout } });
        const signed = await schoolAuth.auth.signInWithPassword({ email: emails[index], password });
        check(!signed.error && signed.data.session, "The school-only fixture receives a real local Auth token before any parent enrollment.");
        check((await rest(signed.data.session.access_token, "rpc/parent_food_description_result", { p_draft: foreignDraftId ?? randomUUID() })).status === 403
          && (await db.query("select count(*)::int n from public.parent_accounts where id=$1", [id])).rows[0].n === 0,
        "School-only authority cannot open the private description port or silently enroll a parent account.");
        await schoolAuth.auth.signOut({ scope: "local" });
      }
      const context = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" }); contexts.push(context);
      const page = await context.newPage();
      const signed = await page.request.post(`${origin}/api/parent/auth`, { headers: { origin }, data: { action: "sign_in", email: emails[index], password } });
      check(signed.status() === 200, `The disposable description owner signs in through the real local Auth/web boundary (HTTP${signed.status()}).`);
      const owned = await page.request.get(`${origin}/api/parent/account`);
      check(owned.status() === 200 && (await owned.json()).account.id === id, "The actual web account binds the description session to its own household.");
      return { id, context, page, password, token: await accessToken(context) };
    }
    async function descriptionArchive(page: Page) {
      const response = await page.request.get(descriptionUrl);
      check(response.status() === 200 && response.headers()["cache-control"] === "private, no-store", "Actual retained description rights use an owned private HTTP read.");
      return foodDescriptionArchiveSchema.parse((await response.json()).archive);
    }
    async function descriptionCreate(owner: { id: string; page: Page }) {
      const body = { action: "create", expectedOwnerId: owner.id, idempotencyKey: randomUUID(), noticeVersion: FOOD_DESCRIPTION_NOTICE_VERSION, consentAccepted: true };
      const created = await descriptionHttp(owner.page, "POST", "/food-description", body);
      check(created.status() === 200, `The actual consent-first API creates an empty owned description (HTTP${created.status()}).`);
      const reply = await created.json();
      check(typeof reply.draftId === "string" && reply.revision === 0, "The server creates the description identifier before any prose is accepted.");
      const same = await descriptionHttp(owner.page, "POST", "/food-description", body);
      check(same.status() === 200 && (await same.json()).draftId === reply.draftId, "An exact create key acknowledges one server-created description.");
      return reply.draftId as string;
    }
    async function descriptionQueue(owner: { id: string; page: Page }, id: string, expectedRevision: number, input: { description: string; screenLocale: "en" | "es" }, routingAnswers?: unknown) {
      const body = { action: "queue", expectedOwnerId: owner.id, draftId: id, expectedRevision, idempotencyKey: randomUUID(), input, ...(routingAnswers ? { routingAnswers } : {}) };
      const response = await descriptionHttp(owner.page, "POST", `/food-description?draft=${id}`, body);
      check(response.status() === 200 && (await response.json()).revision === expectedRevision + 1, `A real owned queue freezes the exact current revision (HTTP${response.status()}).`);
      return body;
    }
    async function descriptionResult(page: Page, id: string, revision: number) {
      const response = await page.request.get(`${descriptionUrl}?draft=${id}&revision=${revision}`);
      check(response.status() === 200, `The actual owned result endpoint validates the current source revision (HTTP${response.status()}).`);
      return foodDescriptionViewSchema.parse((await response.json()).result);
    }
    const descriptionCount = async () => (await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n as number;
    const descriptionWorker = (worker = descriptionWorkers[0]) => ({ query: async (sql: string, values?: unknown[]) => {
      const result = await worker.query(sql, values); return { rows: result.rows };
    } });
    async function descriptionHeartbeat(ready = true) {
      await descriptionWorkers[0].query("select parent_private.parent_record_food_description_health($1,$2,'proj_synthetic')", [ready, FOOD_DESCRIPTION_FINGERPRINT]);
    }
    function descriptionExchange(selection: unknown, beforeReply?: () => Promise<void>): typeof fetch {
      return async (input, init) => {
        check(String(input) === "https://api.openai.com/v1/responses" && init?.method === "POST" && init.redirect === "error",
          "The in-process synthetic description exchange accepts only the fixed Responses request and never performs network I/O.");
        const headers = new Headers(init.headers), body = JSON.parse(String(init.body)), projection = JSON.parse(body.input[0].content);
        check(headers.get("OpenAI-Project") === "proj_synthetic" && headers.get("Authorization") === "Bearer isolated-native-no-provider-key"
          && body.model === "gpt-6.1-sol" && body.service_tier === "default" && body.store === false && body.max_output_tokens === 1500
          && body.text?.format?.strict === true && body.reasoning?.effort === "medium" && !["tools", "metadata", "conversation", "previous_response_id"].some(key => key in body),
        "The synthetic exchange verifies the exact pinned project/model/tier/schema, no storage and no tools before supplying fixture bytes.");
        check(!/DescriptionProfileCanary|DescriptionProfileCorrected|145 Synthetic Lane|primaryPerson|homeAddress|ownerId|requestId|household_id/.test(body.input[0].content)
          && typeof projection.description === "string", "Only minimized food routing information reaches the explicit synthetic exchange; private profile/application fields and IDs stay outside it.");
        descriptionFetches++; await beforeReply?.();
        return Response.json({ id: "resp_isolated_native_fixture", model: "gpt-6.1-sol", service_tier: "default", status: "completed",
          usage: { input_tokens: 200, output_tokens: 80, total_tokens: 280, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0,
            cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } },
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(selection) }] }] }, { headers: { "x-request-id": "req_isolated_native_fixture" } });
      };
    }
    async function descriptionTurn(selection: unknown, beforeReply?: () => Promise<void>) {
      await descriptionHeartbeat(); const before = descriptionFetches;
      check(await runOneFoodDescriptionTurn({ database: descriptionWorker(), apiKey: "isolated-native-no-provider-key", projectId: "proj_synthetic", fetcher: descriptionExchange(selection, beforeReply) })
        && descriptionFetches === before + 1, "The actual restricted native claim/prepare/reserve pipeline invokes exactly one in-process synthetic exchange.");
    }
    async function descriptionStart(page: Page, body: Record<string, unknown>, key = randomUUID()) {
      const response = await descriptionHttp(page, "POST", "/requests", body, key);
      check(response.status() === 201, `The actual description source creates only explicitly selected, named service work (HTTP${response.status()}).`);
      const request = (await response.json()).request as SupportRequest; descriptionRequests.push({ page, id: request.id });
      return { request, key, body };
    }
    async function descriptionStop(page: Page, id: string) {
      const response = await descriptionHttp(page, "POST", `/requests/${id}`, { action: "cancel" });
      check(response.status() === 200 && (await response.json()).request.status === "cancelled", "Only this fixture's owned synthetic work is stopped through actual parent controls.");
    }
    const descriptionPacket = (deadline: string, needs: SupportRequest["intake"]["needs"], recipients: string[], source?: { draftId: string; revision: number }) => ({
      ...(source ? { descriptionSource: source } : {}), intake: fixtureIntake({ needs, zip: "19104", householdSize: null, utilityProviders: [], accountAuthority: "not_sure" }),
      mandate: fixtureMandate({ mode: "prepare_only", recipientIds: recipients, allowedActions: ["research", "prepare"], allowedData: needs.includes("snap_new") ? ["household", "income"] : ["household"], maxRecipients: recipients.length, expiresAt: deadline }),
    });
    const descriptionErrors: unknown[] = [];
    try {
      const original = descriptionMemberships.filter(membership => membership.role_name === "parent_worker");
      check(original.some(membership => membership.admin_option), "Description native role selection requires the existing fixture ADMIN membership.");
      if (!original.some(membership => membership.set_option)) {
        const own = original.find(membership => membership.grantor === foodOperator);
        descriptionMembershipChange = { existed: !!own, set: own?.set_option ?? false };
        await db.query(`grant parent_worker to ${foodIdentifier(foodOperator)} with ${own ? "" : "admin false, inherit false, "}set true`);
      }
      for (const worker of descriptionWorkers) { await worker.connect(); await worker.query("set role parent_worker");
        check((await worker.query("select current_user role")).rows[0].role === "parent_worker", "Each native description connection actually runs as the restricted worker.");
        descriptionPids.push((await worker.query("select pg_backend_pid() pid")).rows[0].pid); }
      await db.query("update parent_private.processing_controls set existing_accounts_enabled=true where singleton");
      const descriptionOwner = await descriptionAccount(3), capOwner = await descriptionAccount(4);
      const deadline = (await (await descriptionOwner.page.request.get(`${origin}/api/parent/authorization-window`)).json()).authorization.expiresAt as string;
      const anon = await browser.newContext({ baseURL: origin }); contexts.push(anon); const anonPage = await anon.newPage();
      await anonPage.goto(`${origin}/get-support`, { waitUntil: "networkidle" });
      check(await anonPage.getByRole("link", { name: "Find food now", exact: true }).isVisible()
        && await anonPage.getByLabel(/enough food for today and tomorrow/).isVisible(), "The actual anonymous guide retains urgent official food help and manual questions with optional interpretation closed.");
      check((await anonPage.request.get(`${descriptionUrl}/availability`)).status() === 200 && !(await (await anonPage.request.get(`${descriptionUrl}/availability`)).json()).available,
        "New optional interpretation is actually unavailable before any fixture-specific purpose approval.");
      const deniedCreate = { action: "create", expectedOwnerId: descriptionOwner.id, idempotencyKey: randomUUID(), noticeVersion: FOOD_DESCRIPTION_NOTICE_VERSION, consentAccepted: true };
      check((await descriptionHttp(descriptionOwner.page, "POST", "/food-description", deniedCreate)).status() === 403,
        "A real authenticated caller cannot create a description under default-closed purpose controls.");
      await db.query(`update parent_private.processing_controls set food_description_enabled=true,
        food_description_approval_reference='isolated synthetic Auth description fixture; no processor call',food_description_approved_until=$1,
        food_description_notice_version=$2,food_description_processor_reference='synthetic exchange only',food_description_evaluation_reference='native guards only; no model-quality approval',
        food_description_evaluation_fingerprint=$3,food_description_retention_reference='synthetic original24h48h',food_description_project_budget_reference='synthetic project only',
        food_description_project_id='proj_synthetic',food_description_budget_reference='synthetic native counters only',food_description_budget_started_at=now()-interval '1 hour',
        food_description_call_limit=10000,model_budget_started_at=now()-interval '1 hour',model_call_limit=10000 where singleton`,
      [new Date(Math.min(Date.parse(fixtureApproval!.approvedUntil), Date.now() + 3600000)).toISOString(), FOOD_DESCRIPTION_NOTICE_VERSION, FOOD_DESCRIPTION_FINGERPRINT]);
      await descriptionHeartbeat();
      for (const column of ["food_description_approval_reference", "food_description_processor_reference", "food_description_evaluation_reference", "food_description_retention_reference",
        "food_description_project_budget_reference", "food_description_budget_reference", "food_description_notice_version", "food_description_project_id", "food_description_evaluation_fingerprint", "food_description_approved_until"] as const) {
        const before = (await db.query(`select ${column} value from parent_private.processing_controls where singleton`)).rows[0].value;
        await db.query(`update parent_private.processing_controls set ${column}=null where singleton`);
        check((await descriptionHttp(descriptionOwner.page, "POST", "/food-description", deniedCreate)).status() === 403,
          `The actual create boundary stays closed without ${column}.`);
        await db.query(`update parent_private.processing_controls set ${column}=$1 where singleton`, [before]);
      }
      await descriptionHeartbeat(false);
      check((await descriptionHttp(descriptionOwner.page, "POST", "/food-description", deniedCreate)).status() === 403, "Old/general worker readiness cannot replace the dedicated current description capability.");
      await descriptionHeartbeat();
      check((await descriptionHttp(anonPage, "POST", "/food-description", deniedCreate)).status() === 401,
        "An actual anonymous session cannot create the consented private draft even while the separate feature is available.");
      check((await db.query("select count(*)::int n from parent_private.food_description_drafts where owner_id=any($1::uuid[])", [[descriptionOwner.id, capOwner.id]])).rows[0].n === 0
        && await descriptionCount() === descriptionReservationBaseline, "Closed/foreign/anonymous setup attempts record no prose, draft or model reservation.");

      stage = "native shared final-slot locks and rolling account/description ceilings";
      const capRequest = await descriptionStart(capOwner.page, descriptionPacket(deadline, ["snap_pending"], ["snap-pa"]));
      const capJob = (await descriptionWorkers[1].query("select parent_private.parent_claim_job(300) job")).rows[0].job;
      check(capJob?.request?.id === capRequest.request.id, "The coordinator-cap fixture obtains its actual isolated current durable lease, without forcing a target row.");
      await descriptionWorkers[0].query("select parent_private.parent_record_worker_health(false,true)");
      const question = await rest(capOwner.token, "rpc/parent_ask_assistant", { p_request_id: capRequest.request.id, p_question: "What is recorded as the next permitted step?", p_idempotency_key: randomUUID(), p_consented: true });
      check(question.status === 200, "The real owned assistant RPC queues the bounded synthetic counter fixture.");
      const assistant = (await descriptionWorkers[1].query("select parent_private.parent_claim_assistant() value")).rows[0].value;
      check(assistant?.requestId === capRequest.request.id || assistant?.request?.id === capRequest.request.id,
        "The assistant-cap fixture claims only its real owned queued question.");
      const capDraft = await descriptionCreate(capOwner);
      const seededAccountCalls: string[] = [];
      try {
        for (let revision = 0; revision < 3; revision++) {
          await descriptionHeartbeat(); await descriptionQueue(capOwner, capDraft, revision, { description: `Food support with an explicit synthetic edit ${revision}.`, screenLocale: "en" });
          const [left, right] = await Promise.all(descriptionWorkers.map(worker => worker.query("select parent_private.parent_claim_food_description() value")));
          const claimed = [left.rows[0].value, right.rows[0].value].filter(Boolean);
          check(claimed.length === 1 && claimed[0].draftId === capDraft, "Two real restricted connections cannot claim the same description lease.");
          const claim = claimed[0], stored = (await db.query("select input from parent_private.food_description_drafts where id=$1", [capDraft])).rows[0].input;
          await descriptionWorkers[0].query("select parent_private.parent_prepare_food_description($1,$2,$3,$4)", [capDraft, claim.revision, claim.leaseToken, JSON.stringify(buildFoodDescriptionProjection(stored, claim.context, new Date()))]);
          if (revision === 2) {
            const seeded = await db.query("insert into parent_private.ai_calls(account_id,request_id) select $1,$2 from generate_series(1,57) returning id::text", [capOwner.id, capRequest.request.id]);
            seededAccountCalls.push(...seeded.rows.map(row => row.id));
            await db.query("update parent_private.processing_controls set model_call_limit=10000 where singleton");
          } else {
            const used = (await db.query("select greatest((select count(*) from parent_private.model_call_reservations),(select count(*) from parent_private.ai_calls)+(select count(*) from parent_private.assistant_calls)+(select count(*) from parent_private.food_description_calls))::int n")).rows[0].n;
            await db.query("update parent_private.processing_controls set model_call_limit=$1 where singleton", [used + 1]);
          }
          await descriptionWorkers[0].query("begin");
          let charge: string | undefined, competing: Promise<import("pg").QueryResult> | undefined;
          try {
            charge = (await descriptionWorkers[0].query("select parent_private.parent_reserve_food_description($1,$2,$3) value", [capDraft, claim.revision, claim.leaseToken])).rows[0].value;
            check(typeof charge === "string", "The native description reservation takes the final permitted slot under its real account/advisory locks.");
            competing = revision === 1
              ? descriptionWorkers[1].query("select parent_private.parent_reserve_assistant_call($1,$2) value", [assistant.messageId, assistant.leaseToken])
              : descriptionWorkers[1].query("select parent_private.parent_reserve_ai_call($1,$2) value", [capJob.jobId, capJob.leaseToken]);
            const blocked = await db.query("select pg_backend_pid() operator,(select pid from pg_stat_activity where pid=$1 and cardinality(pg_blocking_pids(pid))>0) blocked", [descriptionPids[1]]);
            // Observe an actual wait while the first transaction owns the account/global serialization lock.
            let waiting = Boolean(blocked.rows[0].blocked);
            for (let attempt = 0; !waiting && attempt < 50; attempt++) { await delay(10); waiting = (await db.query("select cardinality(pg_blocking_pids($1))>0 value", [descriptionPids[1]])).rows[0].value; }
            check(waiting, "The competing native reserve really waits on the held account/global transaction lock.");
            await descriptionWorkers[0].query("commit");
            check((await competing).rows[0].value === false, "Only one description/coordinator/assistant contender consumes the actual final shared slot.");
          } finally { await descriptionWorkers[0].query("rollback").catch(() => {}); await competing?.catch(() => {}); }
          await descriptionWorkers[0].query("select parent_private.parent_record_food_description_usage($1,$2)", [charge, JSON.stringify({ complete: false })]);
          if (revision === 0) {
            await db.query("update parent_private.food_description_drafts set lease_until=clock_timestamp()-interval '1 second' where id=$1", [capDraft]);
            let rejectedLease = false;
            try { await descriptionWorkers[0].query("select parent_private.parent_food_description_current($1,$2,$3)", [capDraft, claim.revision, claim.leaseToken]); }
            catch (error) { rejectedLease = (error as { code?: string }).code === "42501"; }
            check(rejectedLease && !(await descriptionWorkers[0].query("select parent_private.parent_claim_food_description() value")).rows[0].value,
              "The actual expired charged lease is rejected and never reclaimed for another dispatch.");
          } else await descriptionWorkers[0].query("select parent_private.parent_fail_food_description($1,$2,$3)", [capDraft, claim.revision, claim.leaseToken]);
          await db.query("update parent_private.processing_controls set model_call_limit=10000 where singleton");
          if (revision === 0) {
            const used = (await db.query("select count(*)::int n from parent_private.model_call_reservations where purpose='food_description'")).rows[0].n;
            await db.query("update parent_private.processing_controls set food_description_call_limit=$1 where singleton", [used]);
            check((await descriptionHttp(descriptionOwner.page, "POST", "/food-description", deniedCreate)).status() === 403, "Known feature-budget exhaustion rejects a different fresh owner before prose capture.");
            await db.query("update parent_private.processing_controls set food_description_call_limit=10000 where singleton");
          }
        }
      } finally {
        if (seededAccountCalls.length) await db.query("delete from parent_private.ai_calls where id=any($1::bigint[]) and account_id=$2", [seededAccountCalls, capOwner.id]);
      }
      check((await descriptionHttp(capOwner.page, "POST", "/food-description", { ...deniedCreate, expectedOwnerId: capOwner.id, idempotencyKey: randomUUID() })).status() === 403,
        "The actual third rolling description reservation still closes capture after synthetic account-cap history is removed; no anonymous reservation is refunded.");
      check((await descriptionHttp(capOwner.page, "DELETE", "/food-description", { action: "cancel", expectedOwnerId: capOwner.id, draftId: capDraft })).status() === 200,
        "Actual owned cancellation remains available after the final resource slot.");
      await descriptionStop(capOwner.page, capRequest.request.id);

      stage = "native description exact queue, clarification, source-bound lost acknowledgement and private receipt";
      await descriptionHeartbeat(); const a = await descriptionCreate(descriptionOwner);
      const aOriginal = (await descriptionArchive(descriptionOwner.page)).drafts.find(draft => draft.id === a)!;
      check(aOriginal.state === "empty" && aOriginal.input === null && Date.parse(aOriginal.contentExpiresAt) - Date.parse(aOriginal.createdAt) === 86400000
        && Date.parse(aOriginal.metadataExpiresAt) - Date.parse(aOriginal.createdAt) === 172800000, "The real consent draft fixes original24h/48h deadlines before prose.");
      check((await descriptionHttp(descriptionOwner.page, "POST", "/food-description", { ...deniedCreate, expectedOwnerId: capOwner.id })).status() === 403,
        "A different expected owner cannot create content under the actual signed-in identity.");
      const expiredAuth = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchWithTimeout } });
      const expiredSigned = await expiredAuth.auth.signInWithPassword({ email: emails[3], password: descriptionOwner.password });
      check(!expiredSigned.error && expiredSigned.data.session, "The expiry probe uses a separately issued actual local Auth session.");
      const expiredClaims = JSON.parse(Buffer.from(expiredSigned.data.session.access_token.split(".")[1], "base64url").toString());
      const sessionBefore = (await db.query("select not_after from auth.sessions where id=$1 and user_id=$2", [expiredClaims.session_id, descriptionOwner.id])).rows[0];
      check(sessionBefore, "The actual issued session exists before its owned fixture expiry.");
      try {
        await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1 and user_id=$2", [expiredClaims.session_id, descriptionOwner.id]);
        check((await rest(expiredSigned.data.session.access_token, "rpc/parent_food_description_result", { p_draft: a })).status === 403,
          "An actually expired issued session cannot read a description even though its signed JWT has not expired.");
      } finally {
        await db.query("update auth.sessions set not_after=$1 where id=$2 and user_id=$3", [sessionBefore.not_after, expiredClaims.session_id, descriptionOwner.id]);
        await expiredAuth.auth.signOut({ scope: "local" });
      }
      const aInput = { description: "Food help and grocery support, please.", screenLocale: "en" as const }, confirmedAt = new Date(Date.now() - 1000).toISOString();
      const aBody = { action: "queue", expectedOwnerId: descriptionOwner.id, draftId: a, expectedRevision: 0, idempotencyKey: randomUUID(), input: aInput,
        routingAnswers: { foodForTwoDays: { value: "no", confirmedAt } } };
      const aQueued = await Promise.all([0, 1].map(() => descriptionHttp(descriptionOwner.page, "POST", `/food-description?draft=${a}`, aBody)));
      check(aQueued.every(reply => reply.status() === 200) && (await db.query("select revision from parent_private.food_description_drafts where id=$1", [a])).rows[0].revision === 1,
        "Concurrent actual same-body/key queues acknowledge one immutable queued revision.");
      check((await descriptionHttp(first.page, "POST", `/food-description?draft=${a}`, aBody)).status() === 403
        && (await first.page.request.get(`${descriptionUrl}?draft=${a}&revision=1`)).status() === 403,
        "Actual foreign sessions cannot upload to or read another owner's description.");
      check((await descriptionHttp(descriptionOwner.page, "POST", `/food-description?draft=${a}`, { ...aBody, input: { ...aInput, description: "Different food support description." } })).status() === 409,
        "A changed body cannot reuse an actual queue key.");
      await descriptionTurn({ needIds: ["food_now"], selections: [], assertions: [], exclusions: [], questionIds: [], outOfScope: null });
      const aView = await descriptionResult(descriptionOwner.page, a, 1);
      check(aView.state === "needs_clarification" && JSON.stringify(aView.questionIds) === '["benefitHistory"]', "The actual validated result asks only its one unresolved vetted question.");
      const noReinterpret = await descriptionHttp(descriptionOwner.page, "POST", `/food-description?draft=${a}`, { ...aBody, expectedRevision: 1, idempotencyKey: randomUUID(), input: { ...aInput, screenLocale: "es" } });
      check(noReinterpret.status() === 409, "A locale/new key alone cannot dispatch the same already charged prose and current context again.");
      const beforeResolve = await descriptionCount(), resolveBody = { action: "resolve", expectedOwnerId: descriptionOwner.id, draftId: a, expectedRevision: 1,
        idempotencyKey: randomUUID(), answers: { foodForTwoDays: "no", benefitHistory: "never", existingIssue: null }, changedQuestionIds: ["benefitHistory"] };
      check((await descriptionHttp(first.page, "PATCH", `/food-description?draft=${a}`, resolveBody)).status() === 403
        && (await descriptionHttp(first.page, "DELETE", "/food-description", { action: "cancel", expectedOwnerId: descriptionOwner.id, draftId: a })).status() === 403,
        "Actual foreign sessions cannot clarify or cancel another owner's retained source.");
      const resolved = await descriptionHttp(descriptionOwner.page, "PATCH", `/food-description?draft=${a}`, resolveBody);
      check(resolved.status() === 200 && (await resolved.json()).revision === 2, "Actual deterministic clarification advances only the current owned revision.");
      check((await descriptionHttp(descriptionOwner.page, "PATCH", `/food-description?draft=${a}`, resolveBody)).status() === 200 && await descriptionCount() === beforeResolve,
        "Exact clarification replay uses zero additional reservations or model exchanges.");
      check((await descriptionHttp(descriptionOwner.page, "PATCH", `/food-description?draft=${a}`, { ...resolveBody, idempotencyKey: randomUUID() })).status() === 409,
        "A new clarification key cannot reuse a superseded source revision.");
      const aAfterResolve = (await descriptionArchive(descriptionOwner.page)).drafts.find(draft => draft.id === a)!;
      check(aAfterResolve.contentExpiresAt === aOriginal.contentExpiresAt && aAfterResolve.metadataExpiresAt === aOriginal.metadataExpiresAt && aAfterResolve.consentedAt === aOriginal.consentedAt,
        "Deterministic clarification never renews the original consent or content/metadata deadlines.");
      const aSource = { draftId: a, revision: 2 }, aResult = await descriptionResult(descriptionOwner.page, a, 2);
      check(aResult.state === "proposal" && JSON.stringify(aResult.needIds) === '["food_now","snap_new"]', "Actual clarification retains each independent supported proposed need.");
      const originalProjection = (await db.query("select model_projection from parent_private.food_description_calls where draft_id=$1", [a])).rows[0].model_projection;
      check(originalProjection.revision === 1 && Date.parse(originalProjection.routingFacts.foodForTwoDays.confirmedAt) === Date.parse(confirmedAt) && !originalProjection.routingFacts.benefitHistory,
        "The original charged projection and original supplied fact time survive deterministic clarification unchanged.");
      const routing = await descriptionStart(descriptionOwner.page, descriptionPacket(deadline, ["food_now"], ["philly-food"]));
      check((await descriptionHttp(descriptionOwner.page, "POST", `/requests/${routing.request.id}/outcome`, { need: "food_now", outcome: "support_received", reference: "Synthetic attributed report for an isolated routing-source fixture; no actual collection." })).status() === 200,
        "An existing generic source fixture uses a truthfully attributed synthetic parent report.");
      check((await descriptionHttp(descriptionOwner.page, "POST", `/requests/${routing.request.id}/outcome`, { action: "close", reason: "completed", detail: "Synthetic completed routing source only.", nextOwner: "parent", reentry: "Begin new support only when a new need exists." })).status() === 200,
        "Actual owned closure makes the known synthetic routing source independently readable without future work.");
      const defaults = await descriptionOwner.page.request.get(`${origin}/api/parent/intake-defaults`), reused = (await defaults.json()).zip;
      check(defaults.status() === 200 && reused?.sourceRequestId === routing.request.id && reused.value === "19104", "The real saved-routing endpoint selects only this owner's fresh recorded ZIP source.");
      const aFoodBody = { ...descriptionPacket(deadline, ["food_now"], ["philly-food"], aSource), reusedZip: { sourceRequestId: reused.sourceRequestId, sourceVersion: reused.sourceVersion } };
      const locker = new Client({ connectionString: local.DB_URL, connectionTimeoutMillis: 1000, statement_timeout: 2000, idle_in_transaction_session_timeout: 5000 });
      await locker.connect();
      try {
        await locker.query("begin"); await locker.query("select id from public.parent_requests where id=$1 for update", [routing.request.id]);
        const locked = await descriptionHttp(descriptionOwner.page, "POST", "/requests", aFoodBody, randomUUID());
        check(locked.status() === 412, "A genuinely held reused-ZIP source returns its bounded specific412 through native PostgREST, without inverse-lock waiting.");
      } finally { await locker.query("rollback").catch(() => {}); await locker.end(); }
      const beforeInvalidStarts = (await db.query("select count(*)::int n from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=$1", [descriptionOwner.id])).rows[0].n;
      for (const [invalid, status] of [
        [{ ...aFoodBody, descriptionSource: { draftId: a, revision: 1 } }, 409],
        [{ ...aFoodBody, mandate: { ...aFoodBody.mandate, recipientIds: ["philly-food", "uesf-benefits"], maxRecipients: 2 } }, 400],
        [{ ...aFoodBody, intake: { ...aFoodBody.intake, needs: ["food_now", "snap_new", "snap_renewal"] } }, 409],
      ] as const) check((await descriptionHttp(descriptionOwner.page, "POST", "/requests", invalid, randomUUID())).status() === status,
        "The actual source start rejects stale revision, expanded unselected recipients and contradictory SNAP scope before any partial service start.");
      check((await descriptionHttp(first.page, "POST", "/requests", aFoodBody, randomUUID())).status() === 409,
        "A real different owner cannot bind service work to this description source.");
      check((await descriptionHttp(descriptionOwner.page, "POST", "/requests", {
        ...descriptionPacket(deadline, ["wic_new"], ["wic-pa"], aSource), kind: "wic_application", details: {}, noticeVersion: WIC_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true,
      }, randomUUID())).status() === 403, "Description interpretation cannot open WIC private capture under its unrelated food permission.");
      check((await db.query("select count(*)::int n from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=$1", [descriptionOwner.id])).rows[0].n === beforeInvalidStarts,
        "Every rejected source/owner/program/need/private-purpose start leaves no partial request, mandate or job.");
      const aFoodKey = randomUUID(); let aFoodId = "", forwarded = 0;
      const dropDescriptionStartAck = async (route: Route) => {
        forwarded++; const response = await route.fetch(); check(response.status() === 201, "The native browser's intercepted acknowledgement follows a real committed description start.");
        aFoodId = (await response.json()).request.id; await route.abort("failed");
      };
      await descriptionOwner.page.goto(`${origin}/get-support`, { waitUntil: "networkidle" });
      await descriptionOwner.page.route(`${origin}/api/parent/requests`, dropDescriptionStartAck);
      try {
        const unknown = await descriptionOwner.page.evaluate(async ({ body, key }) => { try { await fetch("/api/parent/requests", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) }); return false; } catch { return true; } }, { body: aFoodBody, key: aFoodKey });
        check(unknown && forwarded === 1 && !!aFoodId, "Only the actual browser reply is dropped after its one source-bound request has committed.");
      } finally { await descriptionOwner.page.unroute(`${origin}/api/parent/requests`, dropDescriptionStartAck); }
      descriptionRequests.push({ page: descriptionOwner.page, id: aFoodId });
      const aFoodReplay = await descriptionStart(descriptionOwner.page, aFoodBody, aFoodKey);
      check(aFoodReplay.request.id === aFoodId && (await db.query("select count(*)::int n from public.parent_jobs where request_id=$1", [aFoodId])).rows[0].n === 1,
        "An exact native retry reconciles the lost start acknowledgement to one request and one current durable job.");
      const coveredFood = await descriptionResult(descriptionOwner.page, a, 2);
      check(JSON.stringify(coveredFood.needIds) === '["snap_new"]' && coveredFood.existingRequests.some(request => request.requestId === aFoodId && request.needIds.includes("food_now")),
        "Actual server-side current food coverage leaves uncovered SNAP separate, outside the minimized model history.");
      await db.query(`update parent_private.processing_controls set family_profile_enabled=true,family_profile_approval_reference='isolated native description profile fixture',
        family_profile_approved_until=$1,family_profile_notice_version=$2,snap_details_enabled=true,snap_details_approval_reference='isolated native description SNAP fixture',
        snap_details_approved_until=$1,snap_details_notice_version=$3 where singleton`, [deadline, FAMILY_PROFILE_NOTICE_VERSION, SNAP_APPLICATION_NOTICE_VERSION]);
      const profileDetails = { primaryPerson: { id: randomUUID(), firstName: "DescriptionProfileCanary", lastName: "Parent", dateOfBirth: "1988-04-15" },
        homeAddress: { street: "145 Synthetic Lane", city: "Philadelphia", state: "PA", zip: "19104", county: "Philadelphia" }, preferredLanguage: "en" };
      const profileBody = { expectedOwnerId: descriptionOwner.id, expectedRevision: 0, details: profileDetails, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, consentAccepted: true, subjectAuthorityDeclared: true };
      check((await descriptionHttp(descriptionOwner.page, "POST", "/family-profile", profileBody, randomUUID())).status() === 201, "The separate native description owner explicitly saves only its own permitted synthetic profile.");
      const profileRead = familyProfileReadSchema.parse((({ ok: _, ...read }) => { void _; return read; })(await (await descriptionOwner.page.request.get(`${origin}/api/parent/family-profile`)).json()));
      const projected = projectFamilyProfileApplication(profileRead.profile!, "snap-pa", { now: new Date(), useHomeAddress: true });
      const snapDetails = fixtureSnapApplication(new Date());
      snapDetails.household = [{ ...snapDetails.household![0], id: profileDetails.primaryPerson.id }];
      for (const field of projected.fields) replaceFamilyProfileApplicationValue(snapDetails, field.applicationPath, familyProfileApplicationValue(projected.details, field.applicationPath));
      const profileSource = { expectedOwnerId: descriptionOwner.id, revision: profileRead.revision, fields: projected.fields, options: { useHomeAddress: true } };
      const aSnapPacket = descriptionPacket(deadline, ["snap_new"], ["snap-pa"], aSource);
      const aSnapBody = { ...aSnapPacket, intake: { ...aSnapPacket.intake, householdSize: snapDetails.householdSize ?? null }, kind: "snap_application", details: snapDetails,
        noticeVersion: SNAP_APPLICATION_NOTICE_VERSION, documentTemplateId: SNAP_ES_TEMPLATE_ID, familyProfileSource: profileSource };
      const historyLocker = new Client({ connectionString: local.DB_URL, connectionTimeoutMillis: 1000, statement_timeout: 2000, idle_in_transaction_session_timeout: 5000 });
      await historyLocker.connect();
      try {
        await historyLocker.query("begin"); await historyLocker.query("select id from public.parent_requests where id=$1 for update", [aFoodId]);
        check((await descriptionHttp(descriptionOwner.page, "POST", "/requests", aSnapBody, randomUUID())).status() === 409,
          "A held relevant owned history request produces bounded native409 before a new private source start, without a partial request or inverse-lock deadlock.");
      } finally { await historyLocker.query("rollback").catch(() => {}); await historyLocker.end(); }
      const aSnap = await descriptionStart(descriptionOwner.page, aSnapBody), privateId = aSnap.request.id;
      const readPrivate = async () => snapApplicationSnapshotSchema.parse((await (await descriptionOwner.page.request.get(`${origin}/api/parent/requests/${privateId}/snap-application`)).json()).snapshot);
      const privateOriginal = await readPrivate();
      check(privateOriginal.source.templateId === SNAP_ES_TEMPLATE_ID && privateOriginal.details.applicant?.firstName === "DescriptionProfileCanary",
        "The actual disjoint private SNAP start binds its own Spanish form and owned profile fields without copying those fields into model context.");
      const [corrected, concurrentReceipt] = await Promise.all([
        descriptionHttp(descriptionOwner.page, "POST", "/family-profile", { ...profileBody, expectedRevision: 1,
          details: { ...profileDetails, primaryPerson: { ...profileDetails.primaryPerson, firstName: "DescriptionProfileCorrected" } } }, randomUUID()),
        descriptionHttp(descriptionOwner.page, "POST", "/requests", aSnapBody, aSnap.key),
      ]);
      check(corrected.status() === 201 && concurrentReceipt.status() === 201 && (await concurrentReceipt.json()).request.id === privateId,
        "Real profile propagation and the exact source-aware historical start complete concurrently under their native request/account lock order.");
      const privateCorrected = await readPrivate();
      check(privateCorrected.request_version === 4 && privateCorrected.revision === 2 && privateCorrected.base_version === 3,
        "Native profile correction invalidates version2 and saves the corrected immutable private snapshot at version4.");
      check((await descriptionHttp(descriptionOwner.page, "DELETE", "/family-profile", { expectedOwnerId: descriptionOwner.id, expectedRevision: 2 }, randomUUID())).status() === 200,
        "The independent source profile can be cleared without rewriting immutable request/application history.");
      check((await descriptionHttp(descriptionOwner.page, "DELETE", "/food-description", { action: "cancel", expectedOwnerId: descriptionOwner.id, draftId: a })).status() === 200,
        "Cancelling the optional interpretation clears its content rather than cancelling separately authorized service work.");
      const privateBeforeReceipt = (await db.query("select to_jsonb(r) value from public.parent_requests r where id=$1", [privateId])).rows[0].value;
      check(privateBeforeReceipt.version === privateCorrected.request_version + 1,
        "Clearing the linked profile advances the current request once while preserving its earlier immutable private snapshot.");
      const known = await descriptionStart(descriptionOwner.page, aSnapBody, aSnap.key);
      check(known.request.id === privateId && known.request.version === privateBeforeReceipt.version, "The original source/profile/ES start receipt acknowledges the corrected current request after profile clear and description cancellation.");
      assert.deepEqual((await db.query("select to_jsonb(r) value from public.parent_requests r where id=$1", [privateId])).rows[0].value, privateBeforeReceipt);
      assert.deepEqual(await readPrivate(), privateCorrected);
      const immutableRead = await descriptionOwner.page.request.get(`${origin}/api/parent/requests/${privateId}/snap-application?revision=${privateOriginal.id}`);
      check(immutableRead.status() === 200, "The owned original immutable application remains separately readable after correction and profile removal.");
      assert.deepEqual(snapApplicationSnapshotSchema.parse((await immutableRead.json()).snapshot), privateOriginal);
      for (const changed of [{ ...aSnapBody, documentTemplateId: SNAP_EN_TEMPLATE_ID }, { ...aSnapBody, descriptionSource: { draftId: a, revision: 999 } }])
        check((await descriptionHttp(descriptionOwner.page, "POST", "/requests", changed, aSnap.key)).status() === 409, "The same actual start key cannot change its official language/source provenance.");
      for (const id of [aFoodId, privateId]) await descriptionStop(descriptionOwner.page, id);

      stage = "native exact need coverage, reverse disjoint start and original-scope audit";
      const renewal = await descriptionStart(descriptionOwner.page, descriptionPacket(deadline, ["snap_renewal"], ["uesf-benefits"]));
      const b = await descriptionCreate(descriptionOwner), bSource = { draftId: b, revision: 1 };
      const bText = "Food now and a problem with the benefit card.";
      await descriptionQueue(descriptionOwner, b, 0, { description: bText, screenLocale: "es" }, {
        foodForTwoDays: { value: "no", confirmedAt }, benefitHistory: { value: "receiving", confirmedAt },
      });
      await descriptionTurn({ needIds: ["food_now", "snap_problem"], selections: [], assertions: [{ questionId: "existingIssue", value: "card", span: { text: "card" } }], exclusions: [], questionIds: [], outOfScope: null });
      const bView = await descriptionResult(descriptionOwner.page, b, 1);
      check(bView.needIds.includes("snap_problem") && bView.needIds.includes("food_now"), "A current renewal-only mandate cannot suppress a separately needed card-problem journey.");
      const problemBody = descriptionPacket(deadline, ["snap_problem"], ["uesf-benefits"], bSource), problemKeys = [randomUUID(), randomUUID()];
      const problemRace = await Promise.all(problemKeys.map(key => descriptionHttp(descriptionOwner.page, "POST", "/requests", problemBody, key)));
      check(problemRace.filter(response => response.status() === 201).length === 1 && problemRace.filter(response => response.status() === 409).length === 1,
        "Two real concurrent overlapping starts create one exact need/request/mandate/job and reject the losing source use.");
      const problem = (await problemRace.find(response => response.status() === 201)!.json()).request as SupportRequest;
      descriptionRequests.push({ page: descriptionOwner.page, id: problem.id });
      const foodOnly = await descriptionResult(descriptionOwner.page, b, 1);
      check(JSON.stringify(foodOnly.needIds) === '["food_now"]', "Starting the exact problem journey leaves the disjoint food need available under a separate mandate.");
      const bFood = await descriptionStart(descriptionOwner.page, descriptionPacket(deadline, ["food_now"], ["philly-food"], bSource));
      check(bFood.request.id !== problem.id && bFood.request.id !== renewal.request.id, "Reverse SNAP-then-food composition preserves each independently named durable request.");
      const bChargeCount = await descriptionCount();
      const changedHistory = await descriptionHttp(descriptionOwner.page, "PATCH", `/food-description?draft=${b}`, { action: "resolve", expectedOwnerId: descriptionOwner.id,
        draftId: b, expectedRevision: 1, idempotencyKey: randomUUID(), answers: { foodForTwoDays: "no", benefitHistory: "never", existingIssue: null }, changedQuestionIds: ["benefitHistory"] });
      const bCurrent = (await db.query("select routing_facts,selection from parent_private.food_description_drafts where id=$1", [b])).rows[0];
      check(changedHistory.status() === 200 && (await changedHistory.json()).revision === 2 && !bCurrent.routing_facts.existingIssue
        && !bCurrent.selection.assertions.some((assertion: { questionId: string }) => assertion.questionId === "existingIssue") && await descriptionCount() === bChargeCount,
        "A real typed history correction clears the obsolete model issue assertion without another interpretation charge or automatic service start.");
      for (const id of [renewal.request.id, problem.id, bFood.request.id]) await descriptionStop(descriptionOwner.page, id);
      check((await descriptionHttp(descriptionOwner.page, "POST", "/requests", problemBody, randomUUID())).status() === 409,
        "Closing or cancelling a request never permits the same original source/revision/need to start again.");
      await descriptionHttp(descriptionOwner.page, "DELETE", "/food-description", { action: "cancel", expectedOwnerId: descriptionOwner.id, draftId: b });
      const c = await descriptionCreate(descriptionOwner), cSource = { draftId: c, revision: 1 };
      await descriptionQueue(descriptionOwner, c, 0, { description: "Food now and the pending SNAP application.", screenLocale: "en" }, {
        foodForTwoDays: { value: "no", confirmedAt }, benefitHistory: { value: "applied", confirmedAt },
      });
      await descriptionTurn({ needIds: ["food_now", "snap_pending"], selections: [], assertions: [], exclusions: [], questionIds: [], outOfScope: null });
      const cBody = descriptionPacket(deadline, ["food_now", "snap_pending"], ["philly-food", "snap-pa"], cSource), cKey = randomUUID();
      const deleteLock = new Client({ connectionString: local.DB_URL, connectionTimeoutMillis: 1000, statement_timeout: 2000, idle_in_transaction_session_timeout: 5000 });
      await deleteLock.connect();
      let newDuringDeletion: Promise<APIResponse> | undefined, knownDuringDeletion: Promise<APIResponse> | undefined;
      const beforeDeletion = (await db.query("select to_jsonb(a) value from public.parent_accounts a where id=$1", [descriptionOwner.id])).rows[0].value;
      try {
        await deleteLock.query("begin"); await deleteLock.query("set local role authenticated");
        await deleteLock.query("select set_config('request.jwt.claims',$1,true)", [Buffer.from(descriptionOwner.token.split(".")[1], "base64url").toString()]);
        const deletingPid = (await deleteLock.query("select pg_backend_pid() pid")).rows[0].pid;
        await deleteLock.query("select public.parent_request_deletion()");
        newDuringDeletion = descriptionHttp(descriptionOwner.page, "POST", "/requests", cBody, cKey);
        knownDuringDeletion = descriptionHttp(descriptionOwner.page, "POST", "/requests", aSnapBody, aSnap.key);
        let blocked = false;
        for (let attempt = 0; !blocked && attempt < 50; attempt++) {
          blocked = (await db.query("select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) value", [deletingPid])).rows[0].value;
          if (!blocked) await delay(10);
        }
        check(blocked, "A real issued identity's deletion transaction holds the actual native request/account locks observed by concurrent source starts.");
      } finally {
        await deleteLock.query("rollback").catch(() => {}); await deleteLock.end();
        await Promise.allSettled([newDuringDeletion, knownDuringDeletion].filter(Boolean));
      }
      const [newAfterDeletion, knownAfterDeletion] = await Promise.all([newDuringDeletion!, knownDuringDeletion!]);
      check([201, 409].includes(newAfterDeletion.status()) && knownAfterDeletion.status() === 201 && (await knownAfterDeletion.json()).request.id === privateId,
        "Concurrent new/known starts finish within native bounds after deletion-lock rollback, preserving the existing exact receipt and normal conflict semantics.");
      assert.deepEqual((await db.query("select to_jsonb(a) value from public.parent_accounts a where id=$1", [descriptionOwner.id])).rows[0].value, beforeDeletion);
      const combined = await descriptionStart(descriptionOwner.page, cBody, cKey);
      const correctedIntake = { ...combined.request.intake, needs: ["snap_pending"] };
      const correction = await rest(descriptionOwner.token, "rpc/parent_correct_request", { p_request_id: combined.request.id, p_intake: correctedIntake, p_expected_version: combined.request.version });
      check(correction.status === 204 || correction.status === 200, "Actual current-intake correction may remove food while preserving the existing sibling authorization.");
      check((await descriptionHttp(descriptionOwner.page, "POST", "/requests", descriptionPacket(deadline, ["food_now"], ["philly-food"], cSource), randomUUID())).status() === 409,
        "The immutable original request-start audit prevents reusing a source need even after current intake removed it.");
      check((await descriptionHttp(descriptionOwner.page, "POST", "/requests", combined.body, combined.key)).status() === 409,
        "The existing plain non-profile historical packet remains a conflict after superseding its recorded intake.");
      await descriptionStop(descriptionOwner.page, combined.request.id);
      check(descriptionFetches === 3, "Three complete native result paths used exactly three explicit synthetic exchanges and no external model request.");

      const audit = (await db.query("select evidence from public.parent_events where request_id=$1 and kind='request.started'", [combined.request.id])).rows[0].evidence;
      assert.deepEqual(audit.descriptionSource, cSource); assert.deepEqual(audit.descriptionNeeds, ["food_now", "snap_pending"]);
      check(!JSON.stringify(audit).includes(aInput.description) && !/DescriptionProfileCanary|DescriptionProfileCorrected|145 Synthetic Lane/.test(JSON.stringify(audit))
        && (await db.query("select count(*)::int n from public.parent_operations where request_id=any($1::uuid[])", [[aFoodId, privateId, problem.id, bFood.request.id, combined.request.id]])).rows[0].n === 0,
        "Native request provenance keeps only the opaque source/original selected scope, with no prose/private-profile copying or invented provider execution.");

      stage = "native exact submitted-application pending follow-up coverage";
      const pendingOwner = await descriptionAccount(6);
      for (const underlying of ["snap_new", "snap_renewal"] as const) {
        const underlyingBody = descriptionPacket(deadline, [underlying], ["snap-pa"]);
        underlyingBody.mandate = { ...underlyingBody.mandate, mode: "full", allowedActions: ["research", "prepare", "follow_up"] };
        const prior = await descriptionStart(pendingOwner.page, underlyingBody);
        // This admin-only synthetic receipt is source-validation input, never a claim of real agency submission.
        await db.query("insert into public.parent_operations(request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,state,evidence) values($1,$2,'snap-pa',$3,'submit','{}',repeat('a',64),'{}',$4,'agency_submitted',jsonb_build_object('source','agency_receipt','reference','isolated synthetic native fixture; no agency action','recordedAt',clock_timestamp()))",
          [prior.request.id, prior.request.version, underlying, randomUUID()]);
        const id = await descriptionCreate(pendingOwner), source = { draftId: id, revision: 1 };
        await descriptionQueue(pendingOwner, id, 0, { description: `Check the recorded pending ${underlying} application.`, screenLocale: "en" }, {
          foodForTwoDays: { value: "yes", confirmedAt }, benefitHistory: { value: "applied", confirmedAt },
        });
        await descriptionTurn({ needIds: ["snap_pending"], selections: [], assertions: [], exclusions: [], questionIds: [], outOfScope: null });
        const current = await descriptionResult(pendingOwner.page, id, 1);
        check(current.state === "open_existing" && current.needIds.length === 0 && current.existingRequests.some(request => request.requestId === prior.request.id && request.needIds.includes(underlying)),
          "Actual current same-program submission evidence and follow-up scope reuse the underlying new/renewal application without expanding its mandate.");
        check((await descriptionHttp(pendingOwner.page, "POST", "/requests", descriptionPacket(deadline, ["snap_pending"], ["snap-pa"], source), randomUUID())).status() === 409,
          "A pending journey already covered by verified current follow-up cannot create duplicate service work.");
        await db.query("insert into public.parent_operations(request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,state,evidence,updated_at) values($1,$2,'snap-pa',$3,'follow_up','{}',repeat('b',64),'{}',$4,'declined',jsonb_build_object('source','agency_receipt','reference','isolated later synthetic denial','recordedAt',clock_timestamp()),clock_timestamp()+interval '1 second')",
          [prior.request.id, prior.request.version, underlying, randomUUID()]);
        const changed = await rest(pendingOwner.token, "rpc/parent_food_description_result", { p_draft: id });
        check(changed.status === 200 && !(await changed.json()).currentRequests.find((request: { requestId: string; pendingSnapFollowUp: boolean }) => request.requestId === prior.request.id).pendingSnapFollowUp
          && (await pendingOwner.page.request.get(`${descriptionUrl}?draft=${id}&revision=1`)).status() === 409,
          "A current later denial removes pending-follow-up compatibility and the old model source fails closed until refreshed.");
        await descriptionStop(pendingOwner.page, prior.request.id);
        await descriptionHttp(pendingOwner.page, "DELETE", "/food-description", { action: "cancel", expectedOwnerId: pendingOwner.id, draftId: id });
      }

      stage = "native late usage, cancellation, edit, revocation, retained rights and expiry";
      const lateOwner = await descriptionAccount(5, true, c);
      for (const mode of ["cancel", "edit", "delete"] as const) {
        const id = await descriptionCreate(lateOwner);
        await descriptionQueue(lateOwner, id, 0, { description: `Food help for this explicit ${mode} fixture.`, screenLocale: "en" });
        await descriptionTurn({ needIds: ["food_now"], selections: [], assertions: [], exclusions: [], questionIds: [], outOfScope: null }, async () => {
          if (mode === "edit") await descriptionQueue(lateOwner, id, 1, { description: "A genuinely changed food-help description.", screenLocale: "en" });
          else if (mode === "delete") {
            await db.query("update parent_private.processing_controls set food_description_project_id='proj_changed' where singleton");
            check((await descriptionHttp(lateOwner.page, "POST", "/account", { action: "delete", confirmation: "DELETE", expectedOwnerId: lateOwner.id })).status() === 200,
              "Actual parent-purpose deletion stops this synthetic owner's future work without deleting shared Auth/school records.");
          } else check((await descriptionHttp(lateOwner.page, "DELETE", "/food-description", { action: "cancel", expectedOwnerId: lateOwner.id, draftId: id })).status() === 200,
            "An actual owner cancellation occurs while the one synthetic response is still pending.");
        });
        const retained = (await db.query("select state,input,selection,revision from parent_private.food_description_drafts where id=$1", [id])).rows[0];
        check(retained.selection === null && (mode !== "edit" || retained.revision === 2), "A stale post-response lease cannot publish a result or restore superseded content.");
        check((await db.query("select count(*)::int n from parent_private.food_description_calls where draft_id=$1 and usage->'complete'='true'", [id])).rows[0].n === 1,
          "Late token evidence updates only its existing exact charge even after cancellation, edit or account revocation.");
        if (mode === "edit") {
          await descriptionHttp(lateOwner.page, "DELETE", "/food-description", { action: "cancel", expectedOwnerId: lateOwner.id, draftId: id });
          check(!(await descriptionWorkers[0].query("select parent_private.parent_claim_food_description() value")).rows[0].value,
            "Cancelled superseded work is not reclaimed or automatically dispatched a second time.");
        }
      }
      check((await db.query("select count(*)::int n from auth.users where id=$1", [lateOwner.id])).rows[0].n === 1
        && (await db.query("select count(*)::int n from public.families where created_by_id=$1", [lateOwner.id])).rows[0].n === 1,
        "Native parent-purpose deletion preserves the separate synthetic shared sign-in and school family.");
      await db.query("update parent_private.processing_controls set food_description_project_id='proj_synthetic',food_description_enabled=false where singleton");
      check((await descriptionArchive(descriptionOwner.page)).ownerId === descriptionOwner.id, "Actual owned retained rights remain available after description purpose closure.");
      const exportReply = await descriptionOwner.page.request.get(`${descriptionUrl}?download=1`);
      check(exportReply.status() === 200 && exportReply.headers()["cache-control"] === "private, no-store" && exportReply.headers()["content-disposition"]?.includes("attachment"),
        "The actual rights export remains private and downloadable after collection closure.");
      const retainedBeforeExpiry = (await descriptionArchive(descriptionOwner.page)).drafts.find(draft => draft.id === c);
      check(retainedBeforeExpiry?.input && retainedBeforeExpiry.projection && retainedBeforeExpiry.selection,
        "The retention probe starts from actual retained content, rather than already-erased cancelled records.");
      await db.query("update parent_private.processing_controls set food_description_enabled=true where singleton"); await descriptionHeartbeat();
      check((await descriptionOwner.page.request.get(`${descriptionUrl}?draft=${c}&revision=1`)).status() === 200,
        "The retained current result remains readable before the isolated fixture reaches its original expiry.");
      const reservations = await descriptionCount();
      // Shift only owned synthetic fixture dates together; no clock/function override or deadline renewal is used.
      await db.query("update parent_private.food_description_drafts set created_at=now()-interval '25 hours',content_expires_at=now()-interval '1 hour',metadata_expires_at=now()+interval '23 hours' where owner_id=any($1::uuid[])", [[descriptionOwner.id, capOwner.id, lateOwner.id, pendingOwner.id]]);
      check((await descriptionArchive(descriptionOwner.page)).drafts.every(draft => !draft.input && !draft.projection && !draft.selection), "Original24h expiry hides all retained content and derived source projections through actual owned HTTP rights.");
      check((await descriptionOwner.page.request.get(`${descriptionUrl}?draft=${c}&revision=1`)).status() === 403,
        "Original content expiry denies the previously readable owned result even while the synthetic collection gates remain open.");
      await db.query("select parent_private.parent_purge_food_descriptions(100)");
      check((await db.query("select count(*)::int n from parent_private.food_description_drafts where owner_id=any($1::uuid[]) and (input is not null or context is not null or projection is not null or selection is not null or payload_hash is not null)", [[descriptionOwner.id, capOwner.id, lateOwner.id, pendingOwner.id]])).rows[0].n === 0,
        "Actual native retention clears content, hashes and routing bindings for the known expired synthetic drafts.");
      await db.query("update parent_private.food_description_drafts set created_at=now()-interval '49 hours',content_expires_at=now()-interval '25 hours',metadata_expires_at=now()-interval '1 hour' where owner_id=any($1::uuid[])", [[descriptionOwner.id, capOwner.id, lateOwner.id, pendingOwner.id]]);
      await db.query("select parent_private.parent_purge_food_descriptions(100)");
      check((await descriptionArchive(descriptionOwner.page)).drafts.length === 0 && await descriptionCount() === reservations,
        "Original48h purge removes owned minimal evidence without refunding any anonymous reservation from this run.");
      await db.query("update parent_private.processing_controls set food_description_enabled=false where singleton");
      const historical = await descriptionStart(descriptionOwner.page, aSnapBody, aSnap.key);
      check(historical.request.id === privateId && historical.request.status === "cancelled", "The exact private source-aware receipt survives description purge without reviving revoked service work.");
      check((await db.query("select count(*)::int n from public.parent_jobs j join public.parent_requests r on r.id=j.request_id join public.parent_households h on h.id=r.household_id where h.owner_id=any($1::uuid[]) and j.state not in ('cancelled','done')", [[descriptionOwner.id, capOwner.id, lateOwner.id, pendingOwner.id]])).rows[0].n === 0,
        "Every additional synthetic service job is cancelled before the original native browser fixtures continue.");
      check(Number(descriptionFetches) === 8 && await descriptionCount() === descriptionReservationBaseline + 11,
        "Native proofs retain eleven exact internal reservations, eight synthetic exchanges and zero charged external model/provider calls.");
    } catch (error) {
      descriptionErrors.push(error); throw error;
    } finally {
      const failures: { step: string; error: unknown }[] = [];
      async function restore(step: string, run: () => Promise<unknown>) {
        try { await run(); } catch (error) { failures.push({ step, error }); }
      }
      for (const worker of descriptionWorkers) {
        await restore("worker rollback", () => worker.query("rollback"));
        await restore("worker close", () => worker.end());
      }
      for (const entry of descriptionRequests) await restore("owned request cancellation", async () => {
        const status = (await db.query("select status from public.parent_requests where id=$1", [entry.id])).rows[0]?.status;
        if (status === "active" || status === "paused") await descriptionStop(entry.page, entry.id);
      });
      await restore("processing controls restoration", async () => {
        const columns = descriptionColumns.join(",");
        await db.query(`update parent_private.processing_controls c set (${columns})=(select ${columns} from jsonb_populate_record(null::parent_private.processing_controls,$1::jsonb)) where singleton`, [JSON.stringify(descriptionControls)]);
        assert.deepEqual((await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value, descriptionControls);
      });
      await restore("worker health restoration", async () => {
        if (descriptionHealth) {
          const healthColumns = Object.keys(descriptionHealth).filter(column => column !== "singleton").map(foodIdentifier).join(",");
          await db.query(`update parent_private.worker_health set (${healthColumns})=(select ${healthColumns} from jsonb_populate_record(null::parent_private.worker_health,$1::jsonb)) where singleton`, [JSON.stringify(descriptionHealth)]);
          assert.deepEqual((await db.query("select to_jsonb(h) value from parent_private.worker_health h where singleton")).rows[0].value, descriptionHealth);
        } else await db.query("delete from parent_private.worker_health where singleton");
      });
      await restore("worker membership restoration", async () => {
        const changed = descriptionMembershipChange;
        if (changed) await db.query(changed.existed
          ? `grant parent_worker to ${foodIdentifier(foodOperator)} with set ${changed.set ? "true" : "false"}`
          : `revoke parent_worker from ${foodIdentifier(foodOperator)} granted by ${foodIdentifier(foodOperator)}`);
        assert.deepEqual(await foodMemberships(), descriptionMemberships);
      });
      if (failures.length) {
        process.stderr.write(`Native description fixture cleanup failed during ${failures.map(failure => failure.step).join(", ")}. No error values were logged.\n`);
        throw new AggregateError([...descriptionErrors, ...failures.map(failure => failure.error)], "Native description fixture cleanup failed.");
      }
      check(true, "All synthetic description controls, capability health and original native role memberships are restored before legacy cases.");
    }

    stage = "real data ownership and a preparation-only support request";
    await first.page.clock.setFixedTime(new Date(Date.now() + 2 * 86400000));
    const requestId = await startFoodRequest(first.page);
    await first.page
      .getByRole("button", { name: "Change or renew permission" })
      .click();
    await first.page
      .getByRole("checkbox", { name: /I authorize these programs/ })
      .check();
    const renewed = first.page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/requests/${requestId}` &&
        response.request().method() === "POST",
    );
    await first.page
      .getByRole("button", { name: "Save updated permission" })
      .click();
    check(
      (await renewed).status() === 200,
      "Actual intake and permission renewal succeed with the browser clock two days ahead using the database deadline.",
    );
    check(
      (
        await db.query(
          "select (mandate->>'expiresAt')::timestamptz>now() and (mandate->>'expiresAt')::timestamptz<=now()+interval '30 days' bounded from public.parent_requests where id=$1",
          [requestId],
        )
      ).rows[0].bounded,
      "The actual stored mandate retains the strict thirty-day database ceiling despite browser clock skew.",
    );
    for (const [button, status] of [
      ["Pause future work", "paused"],
      ["Resume support", "active"],
    ]) {
      const changed = first.page.waitForResponse(
        (response) =>
          response.url() === `${origin}/api/parent/requests/${requestId}` &&
          response.request().method() === "POST",
      );
      await first.page
        .getByRole("button", { name: button, exact: true })
        .click();
      check(
        (await changed).status() === 200,
        `The actual ${status} control succeeds through the request UI.`,
      );
      check(
        (
          await db.query(
            "select status,parent_private.current_grant(id,version) allowed from public.parent_requests where id=$1",
            [requestId],
          )
        ).rows[0].allowed ===
          (status === "active"),
        `The actual ${status} control updates durable permission in the database.`,
      );
    }
    stage = "actual cross-request routing reuse without retyping";
    const conflictingDefaults = await first.page.request.get(`${origin}/api/parent/intake-defaults`);
    check(conflictingDefaults.status() === 200 && conflictingDefaults.headers()["cache-control"] === "private, no-store"
      && (await conflictingDefaults.json()).zip === null,
    "The actual API does not choose between the completed 19129 food visit and the current 19104 routing fact.");
    // Age only the completed synthetic fixture's ZIP before testing reuse of an unambiguous current fact.
    for (const completedId of completedFoodRoutingIds) {
      const foodBeforeExpiry = await foodState(completedId);
      const expiredFoodZip = await db.query(`update public.parent_requests r
        set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}',to_jsonb(now()-interval '46 days'))
        where r.id=$1 and r.status='closed' and r.closed_reason='completed'
          and exists(select 1 from public.parent_households h where h.id=r.household_id and h.owner_id=$2)`, [completedId, first.id]);
      check(expiredFoodZip.rowCount === 1 && JSON.stringify(await foodState(completedId)) === JSON.stringify(foodBeforeExpiry),
        "Aging only an owned synthetic ZIP fixture preserves the food receipts, completion, version, job and retention clock.");
    }
    const reusePage = await first.context.newPage();
    const reuseSource = await startFoodRequest(reusePage);
    const defaultsReply = await reusePage.request.get(`${origin}/api/parent/intake-defaults`);
    const defaults = (await defaultsReply.json()).zip;
    check(defaultsReply.status() === 200 && defaultsReply.headers()["cache-control"] === "private, no-store" &&
      defaults?.sourceRequestId === reuseSource && defaults.value === "19104",
    "Actual owned intake defaults return only current routing provenance with private no-store caching.");
    await reusePage.goto(`${origin}/get-support?need=food_now`, { waitUntil: "networkidle" });
    check(await reusePage.getByLabel("Household ZIP code").inputValue() === "19104" &&
      await reusePage.getByText(/We filled your ZIP code/).isVisible(),
    "The actual intake fills the current saved ZIP automatically and explains its original date without another approval.");
    const reuseAccessibility = await new AxeBuilder({ page: reusePage }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    check(reuseAccessibility.violations.length === 0, "Actual saved-routing intake passes the accessibility scan.");
    await reusePage.getByRole("checkbox", { name: /I’m 18 or older/ }).check();
    await reusePage.getByRole("button", { name: "Continue", exact: true }).click();
    await reusePage.getByRole("checkbox", { name: /I authorize research and preparation only/ }).check();
    const reuseStarted = reusePage.waitForResponse(response => response.url() === `${origin}/api/parent/requests` && response.request().method() === "POST");
    await reusePage.getByRole("button", { name: "Start getting support" }).click();
    const reuseResponse = await reuseStarted;
    check(reuseResponse.status() === 201, "One actual Start action creates the reused request through real Auth, Next and SQL.");
    const reusedRequestId = (await reuseResponse.json()).request.id;
    assert.deepEqual(reuseResponse.request().postDataJSON().reusedZip, { sourceRequestId: defaults.sourceRequestId, sourceVersion: defaults.sourceVersion });
    const reusedRouting = (await db.query("select r.intake_confirmed_at,r.intake_reuse,j.request_version,r.version,j.state,(select count(*)::int from public.parent_operations o where o.request_id=r.id) operations from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1", [reusedRequestId])).rows[0];
    check(reusedRouting.intake_confirmed_at.zip === defaults.confirmedAt && reusedRouting.intake_reuse.zip.expiresAt === defaults.expiresAt &&
      reusedRouting.request_version === reusedRouting.version && reusedRouting.state === "queued" && reusedRouting.operations === 0,
    "Actual reuse keeps original source dates/expiry and queues permitted preparation without a provider operation.");
    await reusePage.goto(`${origin}/support/${reuseSource}`, { waitUntil: "networkidle" });
    await showSection(reusePage, "application-controls");
    await reusePage.getByRole("button", { name: "Cancel request & withdraw permission" }).click();
    const withdrawn = reusePage.waitForResponse(response => response.url() === `${origin}/api/parent/requests/${reuseSource}` && response.request().method() === "POST");
    await reusePage.getByRole("button", { name: "Yes, cancel this request" }).click();
    check((await withdrawn).status() === 200, "Actual source withdrawal succeeds through the family control.");
    const redactedRouting = (await db.query("select intake,intake_reuse,parent_private.current_intake_fields(id,'food_now') current from public.parent_requests where id=$1", [reusedRequestId])).rows[0];
    check(redactedRouting.intake.zip === null && redactedRouting.intake_reuse.zip.invalidated === true && redactedRouting.current.zip === undefined,
    "Source withdrawal removes the actual copied current ZIP and blocks further routing use without laundering its date.");
    const redactedReply = await reusePage.request.get(`${origin}/api/parent/requests/${reusedRequestId}`);
    check(redactedReply.status() === 200 && (await redactedReply.json()).request.intake.zip === null,
      "The actual owned request API safely returns the redacted stored-intake state.");
    await reusePage.close();
    stage = "actual browser save of synthetic grouped factual questions";
    const questions = [
      { id: "actual-bundle-zip", need: "food_now", field: "zip", reason: "missing_fact", title: "Current ZIP code", explanation: "Synthetic rehearsal question; this fixture is not an AI worker decision.", resolved: false },
      { id: "actual-bundle-size", need: "food_now", field: "householdSize", reason: "missing_fact", title: "Household size for this request", explanation: "Synthetic rehearsal question; no partner action is connected.", resolved: false },
    ];
    const seeded = await db.query(
      "update public.parent_requests r set required_actions=$2 where r.id=$1 and exists(select 1 from public.parent_households h where h.id=r.household_id and h.owner_id=$3) returning version",
      [requestId, JSON.stringify(questions), first.id],
    );
    check(seeded.rowCount === 1, "Only this run's owned synthetic request receives the factual-question fixture.");
    const originalVersion = seeded.rows[0].version as number;
    await first.page.reload({ waitUntil: "networkidle" });
    await showSection(first.page, "your-next-steps");
    const form = first.page.getByRole("form", { name: "Household questions" });
    await form.getByRole("region", { name: /Current ZIP code/ }).getByLabel("Your answer").fill("19103");
    await form.getByRole("region", { name: /Household size for this request/ }).getByLabel("Your answer").fill("4");
    const expectedAnswers = [
      { need: "food_now", field: "zip", value: "19103" },
      { need: "food_now", field: "householdSize", value: 4 },
    ];
    const requestUrl = `${origin}/api/parent/requests/${requestId}`;
    let bundlePosts = 0;
    const observeBundle = (request: BrowserRequest) => {
      if (request.url() === requestUrl && request.method() === "POST" && request.postDataJSON()?.action === "answer_facts") bundlePosts++;
    };
    first.page.on("request", observeBundle);
    const savingAnswers = first.page.waitForResponse((response) =>
      response.url() === requestUrl && response.request().method() === "POST" && response.request().postDataJSON()?.action === "answer_facts",
    );
    let bundleBody: { action: string; version: number; answers: unknown[] };
    try {
      await form.getByRole("button", { name: "Save all answers and continue", exact: true }).click();
      const response = await savingAnswers;
      check(response.status() === 200, "The actual browser saves both known factual questions through one successful web API request.");
      bundleBody = response.request().postDataJSON();
      await first.page.getByText("All your answers are saved. Permitted work can continue.", { exact: true }).waitFor();
      check(
        bundlePosts === 1 && bundleBody.action === "answer_facts" && bundleBody.version === originalVersion &&
          JSON.stringify(bundleBody.answers) === JSON.stringify(expectedAnswers) && Object.keys(bundleBody).length === 3,
        "One actual POST carries the original shared version and two typed answers without per-answer versions or extra fields.",
      );
    } finally {
      first.page.off("request", observeBundle);
    }
    const storedBundle = (
      await db.query(
        "select r.version,r.facts,r.required_actions,j.request_version,j.state job_state,(select count(*)::int from public.parent_operations o where o.request_id=r.id) operations from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1",
        [requestId],
      )
    ).rows[0];
    check(
      storedBundle.facts.length === 2 && storedBundle.facts.some((fact: Record<string, unknown>) => fact.need === "food_now" && fact.field === "zip" && fact.value === "19103" && fact.source === "parent") &&
        storedBundle.facts.some((fact: Record<string, unknown>) => fact.need === "food_now" && fact.field === "householdSize" && fact.value === 4 && fact.source === "parent"),
      "The actual database stores both typed parent facts from the one browser save.",
    );
    check(
      storedBundle.required_actions.length === 2 && storedBundle.required_actions.every((action: Record<string, unknown>) => questions.some((question) => question.id === action.id) && action.resolved === true) &&
        storedBundle.version > originalVersion && storedBundle.request_version === storedBundle.version && storedBundle.job_state === "queued" && storedBundle.operations === 0,
      "Both fixture questions resolve with the matching current queued job version and no provider operation.",
    );
    const replayedBundle = await first.page.request.post(requestUrl, { headers: { origin }, data: bundleBody! });
    check(
      replayedBundle.status() === 409,
      `Replaying the completed browser bundle's old version is rejected by the actual web API (HTTP ${replayedBundle.status()}).`,
    );
    const snapshotSql = "select to_jsonb(r) request,to_jsonb(j) job,(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]'::jsonb) from public.parent_events e where e.request_id=r.id) events from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1";
    const beforeInvalid = (await db.query(snapshotSql, [requestId])).rows[0];
    const invalidBundle = await first.page.request.post(requestUrl, {
      headers: { origin },
      data: { action: "answer_facts", version: storedBundle.version, answers: [
        { ...expectedAnswers[0], value: "19102" },
        { ...expectedAnswers[1], value: -1 },
      ] },
    });
    check(invalidBundle.status() === 400, "The actual web API refuses a bundle with an invalid later fact.");
    assert.deepEqual((await db.query(snapshotSql, [requestId])).rows[0], beforeInvalid);
    check(true, "Invalid bundle input leaves the actual request, source facts, questions, job and event history unchanged.");
    stage = "actual browser partial save of synthetic factual questions";
    const partialSeeded = await db.query(
      "update public.parent_requests r set required_actions=$2 where r.id=$1 and exists(select 1 from public.parent_households h where h.id=r.household_id and h.owner_id=$3) returning version",
      [requestId, JSON.stringify(questions.map((question) => ({ ...question, id: `${question.id}-partial` }))), first.id],
    );
    check(partialSeeded.rowCount === 1, "Only this run's synthetic request receives the partial-answer question fixture.");
    await first.page.reload({ waitUntil: "networkidle" });
    await form.getByRole("region", { name: /Current ZIP code/ }).getByLabel("Your answer").fill("19102");
    await form.getByRole("region", { name: /Household size for this request/ }).getByLabel("Your answer").fill("");
    bundlePosts = 0;
    first.page.on("request", observeBundle);
    const savingPartial = first.page.waitForResponse((response) =>
      response.url() === requestUrl && response.request().method() === "POST" && response.request().postDataJSON()?.action === "answer_facts",
    );
    try {
      await form.getByRole("button", { name: "Save all answers and continue", exact: true }).click();
      const response = await savingPartial;
      const body = response.request().postDataJSON();
      await first.page.getByText("Your provided answers are saved. Unanswered questions stay open; other permitted work can continue.", { exact: true }).waitFor();
      check(await first.page.getByRole("form", { name: "Household questions" }).getByRole("region", { name: /Household size for this request/ }).getByLabel("Your answer").inputValue() === "",
        "The actual partial-save UI keeps the explicitly deferred answer blank instead of refilling it from the retained source.");
      check(response.status() === 200 && bundlePosts === 1 && body.action === "answer_facts" && body.version === partialSeeded.rows[0].version &&
        JSON.stringify(body.answers) === JSON.stringify([{ ...expectedAnswers[0], value: "19102" }]) && Object.keys(body).length === 3,
      "One actual partial-save POST includes only the provided ZIP and current shared version; the blank size is omitted.");
    } finally {
      first.page.off("request", observeBundle);
    }
    const partialStored = (await db.query(
      "select r.version,r.intake,r.facts,r.required_actions,j.request_version,j.state job_state,(select count(*)::int from public.parent_operations o where o.request_id=r.id) operations from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1",
      [requestId],
    )).rows[0];
    assert.deepEqual(partialStored.facts.find((fact: Record<string, unknown>) => fact.field === "householdSize"), storedBundle.facts.find((fact: Record<string, unknown>) => fact.field === "householdSize"));
    check(partialStored.intake.householdSize === 4 && partialStored.facts.length === 2,
      "Leaving size blank preserves its existing typed value and exact confirmation time rather than saving zero or refreshing its source.");
    check(partialStored.required_actions.find((action: Record<string, unknown>) => action.field === "zip")?.resolved === true &&
      partialStored.required_actions.find((action: Record<string, unknown>) => action.field === "householdSize")?.resolved === false &&
      partialStored.request_version === partialStored.version && partialStored.job_state === "queued" && partialStored.operations === 0,
    "The provided ZIP resolves while the blank size question stays open and other permitted work remains queued without provider operations.");
    stage = "actual consented private PDF upload and immutable confirmation";
    const pdf = await PDFDocument.create();
    pdf
      .addPage([612, 792])
      .drawText(
        "Synthetic parent test notice. Balance due: $45.00. No real household data.",
        { x: 40, y: 740, size: 12 },
      );
    const pdfBytes = Buffer.from(await pdf.save());
    const file = {
      name: "synthetic-parent-notice.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes,
    };
    const documentsUrl = `${origin}/api/parent/requests/${requestId}/documents`;
    const noConsent = await first.page.request.post(documentsUrl, {
      headers: { origin, "Idempotency-Key": randomUUID() },
      multipart: { consent: "0", file },
    });
    check(
      noConsent.status() === 400,
      "Actual document upload refuses missing processing consent.",
    );
    await first.page.goto(`${origin}/support/${requestId}`, {
      waitUntil: "networkidle",
    });
    await showSection(first.page, "application-documents");
    await first.page
      .getByText("Add a document or take a photo", { exact: true })
      .click();
    check(
      (await first.page.getByLabel("Choose a bill or notice").count()) === 0,
      "The real document UI exposes no file capture before consent.",
    );
    await first.page
      .getByRole("checkbox", {
        name: /I agree to private storage and AI processing/,
      })
      .check();
    await first.page.getByLabel("Choose a bill or notice").setInputFiles(file);
    const uploaded = first.page.waitForResponse(
      (response) =>
        response.url() === documentsUrl &&
        response.request().method() === "POST",
    );
    await first.page.getByRole("button", { name: "Upload privately" }).click();
    const uploadResponse = await uploaded;
    check(
      uploadResponse.status() === 201,
      `The actual consented PDF upload completes through the parent UI (HTTP ${uploadResponse.status()}).`,
    );
    check(
      (await uploadResponse.json()).document.object_path === undefined,
      "The web upload response keeps the private Storage path out of its document payload.",
    );
    await first.page
      .getByText(
        "Document saved privately. Its processing status will appear here.",
      )
      .waitFor();
    const document = (
      await db.query(
        "select d.id,d.object_path,d.upload_confirmed_at,d.size_bytes,r.version,exists(select 1 from storage.objects o where o.bucket_id='parent-documents' and o.name=d.object_path and (o.metadata->>'size')::bigint=d.size_bytes and o.metadata->>'mimetype'=d.media_type) stored from public.parent_documents d join public.parent_requests r on r.id=d.request_id where d.request_id=$1",
        [requestId],
      )
    ).rows[0];
    check(
      document &&
        document.upload_confirmed_at &&
        document.stored &&
        document.size_bytes === pdfBytes.length,
      "The actual Storage bytes match the registered PDF before upload confirmation and resumption.",
    );
    const ownerStorage = createClient(local.API_URL, local.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: fetchWithTimeout,
        headers: { Authorization: `Bearer ${token}` },
      },
    });
    const ownerDownload = await ownerStorage.storage
      .from("parent-documents")
      .download(document.object_path);
    check(
      !ownerDownload.error &&
        ownerDownload.data &&
        Buffer.from(await ownerDownload.data.arrayBuffer()).equals(pdfBytes),
      "The parent can read their own exact private PDF bytes through actual Storage authorization.",
    );
    stage = "actual immutable upload receipt and exact retry";
    const uploadKey = uploadResponse.request().headers()["idempotency-key"];
    check(typeof uploadKey === "string" && /^[0-9a-f-]{36}$/.test(uploadKey), "The actual upload UI supplies one stable attempt key.");
    const uploadState = async () => (await db.query(
      "select to_jsonb(d) document,r.version,(select count(*)::int from public.parent_documents where request_id=r.id) documents,(select count(*)::int from storage.objects where bucket_id='parent-documents' and name=d.object_path) objects,(select count(*)::int from public.parent_events where request_id=r.id and kind='document.upload_confirmed' and evidence->>'documentId'=d.id::text) confirmations from public.parent_documents d join public.parent_requests r on r.id=d.request_id where d.id=$1",
      [document.id],
    )).rows[0];
    const savedUpload = await uploadState();
    const receiptResponse = await first.page.request.get(`${documentsUrl}?uploadKey=${uploadKey}`);
    const receiptBody = await receiptResponse.json();
    check(receiptResponse.status() === 200 && receiptBody.receipt?.state === "confirmed" && receiptBody.receipt.document.id === document.id &&
      receiptBody.receipt.document.upload_key === uploadKey && receiptBody.receipt.document.object_path === undefined && receiptBody.receipt.document.upload_sha256 === undefined,
    "The actual owned receipt reconciles the saved upload without exposing its private path or attempt hash.");
    const exactUpload = await first.page.request.post(documentsUrl, { headers: { origin, "Idempotency-Key": uploadKey }, multipart: { consent: "1", file } });
    check(exactUpload.status() === 201 && (await exactUpload.json()).receipt?.document.id === document.id, "An exact actual HTTP retry acknowledges the original immutable upload.");
    assert.deepEqual(await uploadState(), savedUpload);
    const changedPdfBytes = Buffer.from(pdfBytes);
    changedPdfBytes[7] = changedPdfBytes[7] === 0x37 ? 0x36 : 0x37;
    const changedUpload = await first.page.request.post(documentsUrl, {
      headers: { origin, "Idempotency-Key": uploadKey }, multipart: { consent: "1", file: { ...file, buffer: changedPdfBytes } },
    });
    check(changedUpload.status() === 409, "A changed actual file body cannot reuse the committed upload key.");
    assert.deepEqual(await uploadState(), savedUpload);
    check((await first.page.request.post(documentsUrl, { headers: { origin }, multipart: { consent: "1", file } })).status() === 400,
      "An obsolete web upload without a stable key cannot silently create a fresh attempt.");
    assert.deepEqual(await uploadState(), savedUpload);
    check(savedUpload.objects === 1 && savedUpload.confirmations === 1, "Receipt reads, exact retry and rejected changes leave one object and one confirmation with original dates and request version.");

    const reused = await browser.newContext({ baseURL: origin });
    contexts.push(reused);
    const replay = await reused.request.post(`${origin}/api/parent/auth`, {
      headers: { origin },
      data: { action: "verify_code", email: emails[0], token: first.code },
    });
    check(
      replay.status() === 400,
      "An already consumed actual email code cannot establish another session.",
    );

    stage = "actual expiration, resend and a second household";
    const second = await newParent(emails[1]);
    await db.query(
      "update auth.users set confirmation_sent_at=now()-interval '16 minutes',recovery_sent_at=now()-interval '16 minutes' where id=$1",
      [second.id],
    );
    check(
      (await enterCode(second.page, second.code)).status() === 400,
      "An expired actual Auth code cannot sign in.",
    );
    await second.page
      .getByRole("alert")
      .filter({ hasText: "That code is incorrect or expired." })
      .waitFor();
    const resend = second.page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/auth` &&
        response.request().method() === "POST",
    );
    await second.page.getByRole("button", { name: "Send a new code" }).click();
    check(
      (await resend).status() === 200,
      "The real resend action requests a fresh code after expiry.",
    );
    let fresh = await deliveredCode(emails[1]);
    await db.query(
      "update auth.users set confirmation_sent_at=now(),recovery_sent_at=now() where id=$1",
      [second.id],
    );
    const limited = await second.page.request.post(
      `${origin}/api/parent/auth`,
      { headers: { origin }, data: { action: "send_code", email: emails[1] } },
    );
    rateLimitObserved = limited.status() === 429;
    if (limited.status() === 200) fresh = await deliveredCode(emails[1]);
    else
      check(
        rateLimitObserved,
        "A bounded resend probe either succeeds or returns a provider rate limit.",
      );
    check(
      (await enterCode(second.page, fresh)).status() === 200,
      "The freshly delivered actual code establishes the second parent's session.",
    );
    await second.page.waitForURL(`${origin}/my-support`);
    const secondToken = await accessToken(second.context);
    const hidden = await rest(
      secondToken,
      `parent_requests?select=id&id=eq.${requestId}`,
    );
    check(
      hidden.status === 200 && (await hidden.json()).length === 0,
      "The actual Data API hides another household's support request.",
    );
    const denied = await rest(secondToken, "rpc/parent_control_request", {
      p_request_id: requestId,
      p_action: "cancel",
    });
    check(
      denied.status === 403,
      "The actual Data API denies changing another household's request.",
    );
    const direct = await rest(
      token,
      `parent_requests?select=id&id=eq.${requestId}`,
    );
    check(
      direct.status === 200 && (await direct.json()).length === 1,
      "The original parent retains access to their own request.",
    );
    const hiddenDocument = await rest(
      secondToken,
      `parent_documents?select=id&id=eq.${document.id}`,
    );
    check(
      hiddenDocument.status === 200 &&
        (await hiddenDocument.json()).length === 0,
      "The actual Data API hides another household's document metadata.",
    );
    const otherStorage = createClient(local.API_URL, local.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: fetchWithTimeout,
        headers: { Authorization: `Bearer ${secondToken}` },
      },
    });
    const otherDownload = await otherStorage.storage
      .from("parent-documents")
      .download(document.object_path);
    check(
      otherDownload.error && !otherDownload.data,
      "Actual Storage denies another household's private PDF download.",
    );
    check(
      (
        await second.page.request.delete(`${documentsUrl}/${document.id}`, {
          headers: { origin },
        })
      ).status() === 403,
      "The web API refuses deletion of another household's private document.",
    );

    check((await second.page.request.get(`${documentsUrl}?uploadKey=${uploadKey}`)).status() === 404 &&
      (await second.page.request.post(`${documentsUrl}/${document.id}`, { headers: { origin }, data: { uploadKey } })).status() === 404,
    "Actual owned receipt and confirmation routes reveal no other household's upload.");
    assert.deepEqual(await uploadState(), savedUpload);

    stage = "actual document deletion and queued-version invalidation";
    const deleted = first.page.waitForResponse(
      (response) =>
        response.url() === `${documentsUrl}/${document.id}` &&
        response.request().method() === "DELETE",
    );
    await first.page
      .getByRole("button", { name: "Delete synthetic-parent-notice.pdf" })
      .click();
    check(
      (await deleted).status() === 200,
      "The owner can request private document deletion through the real UI.",
    );
    const revokedDocument = (
      await db.query(
        "select d.status,d.expires_at<=now() expired,r.version,j.request_version,parent_private.current_grant(r.id,$2) old_grant from public.parent_documents d join public.parent_requests r on r.id=d.request_id join public.parent_jobs j on j.request_id=r.id where d.id=$1",
        [document.id, document.version],
      )
    ).rows[0];
    check(
      revokedDocument.status === "deletion_pending" &&
        revokedDocument.expired &&
        revokedDocument.version > document.version &&
        revokedDocument.request_version === revokedDocument.version &&
        revokedDocument.old_grant === false,
      "Document deletion immediately revokes reads and queued uses of the superseded request version.",
    );
    const removedDownload = await ownerStorage.storage
      .from("parent-documents")
      .download(document.object_path);
    check(
      removedDownload.error && !removedDownload.data,
      "Actual Storage denies the removed PDF even to the former owner before physical cleanup.",
    );
    stage = "actual pending upload read protection";
    const pending = await rest(token, "rpc/parent_register_document", {
      p_request_id: requestId,
      p_filename: "synthetic-pending-notice.pdf",
      p_media_type: "application/pdf",
      p_size_bytes: pdfBytes.length,
      p_page_count: null,
      p_consent_version: "2026-10-25",
    });
    check(
      pending.status === 200,
      "Actual Auth can register a second consented synthetic pending upload.",
    );
    const pendingDocument = await pending.json();
    const legacyIdentity = async () => (await db.query(
      "select id,request_id,filename,media_type,size_bytes,object_path,upload_key,upload_sha256,consent_version,consented_at,created_at,expires_at from public.parent_documents where id=$1", [pendingDocument.id],
    )).rows[0];
    const legacyOriginal = await legacyIdentity();
    const missingLegacy = await first.page.request.post(`${documentsUrl}/${pendingDocument.id}`, { headers: { origin }, data: { uploadKey: pendingDocument.id } });
    check(missingLegacy.status() === 202 && (await missingLegacy.json()).receipt?.state === "pending", "A real legacy upload with missing bytes stays pending instead of inventing completion.");
    assert.deepEqual(await legacyIdentity(), legacyOriginal);
    const pendingUpload = await ownerStorage.storage
      .from("parent-documents")
      .upload(pendingDocument.object_path, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    check(
      !pendingUpload.error,
      "Actual Storage accepts bytes only at the parent's registered pending document path.",
    );
    const pendingDownload = await ownerStorage.storage
      .from("parent-documents")
      .download(pendingDocument.object_path);
    check(
      pendingDownload.error && !pendingDownload.data,
      "Actual Storage prevents the owner from reading an unconfirmed upload.",
    );
    const legacyConfirmed = await first.page.request.post(`${documentsUrl}/${pendingDocument.id}`, { headers: { origin }, data: { uploadKey: pendingDocument.id } });
    check(legacyConfirmed.status() === 200 && (await legacyConfirmed.json()).receipt?.state === "confirmed", "The real owned legacy recovery route confirms already stored bytes without another upload.");
    assert.deepEqual(await legacyIdentity(), legacyOriginal);
    check(legacyOriginal.upload_key === null && legacyOriginal.upload_sha256 === null, "Legacy confirmation preserves null physical bindings and original identity, consent and expiry.");
    check(
      (
        await rest(token, "rpc/parent_confirm_document_upload", {
          p_request_id: requestId,
          p_document_id: pendingDocument.id,
        })
      ).status === 204,
      "Actual upload confirmation verifies final Storage metadata before enabling use.",
    );
    const confirmedDownload = await ownerStorage.storage
      .from("parent-documents")
      .download(pendingDocument.object_path);
    check(
      !confirmedDownload.error && confirmedDownload.data,
      "Actual Storage enables owner reads only after document upload confirmation.",
    );
    check(
      (
        await first.page.request.delete(
          `${documentsUrl}/${pendingDocument.id}`,
          { headers: { origin } },
        )
      ).status() === 200,
      "The confirmed synthetic pending-upload fixture can be revoked through the actual web API.",
    );

    stage = "actual missing-byte legacy upload adoption";
    const legacyMissing = await rest(token, "rpc/parent_register_document", {
      p_request_id: requestId, p_filename: "synthetic-legacy-missing.pdf", p_media_type: "application/pdf",
      p_size_bytes: pdfBytes.length, p_page_count: null, p_consent_version: "2026-10-25",
    });
    check(legacyMissing.status === 200, "The original six-argument native registration remains available for retained legacy uploads.");
    const legacyMissingDocument = await legacyMissing.json();
    const adoptionState = async () => (await db.query(
      "select to_jsonb(d)-array['upload_key','upload_sha256','upload_confirmed_at'] document,d.upload_key,d.upload_sha256,d.upload_confirmed_at,r.version,(select count(*)::int from public.parent_documents where request_id=r.id) documents,(select count(*)::int from storage.objects where bucket_id='parent-documents' and name=d.object_path) objects,(select count(*)::int from public.parent_events where request_id=r.id and kind='document.upload_confirmed' and evidence->>'documentId'=d.id::text) confirmations from public.parent_documents d join public.parent_requests r on r.id=d.request_id where d.id=$1",
      [legacyMissingDocument.id],
    )).rows[0];
    const beforeAdoption = await adoptionState();
    check(beforeAdoption.objects === 0 && beforeAdoption.upload_key === null && beforeAdoption.upload_confirmed_at === null,
      "The legacy recovery fixture has one genuine owned row and no stored object or completion.");
    const missingReceipt = await first.page.request.post(`${documentsUrl}/${legacyMissingDocument.id}`, { headers: { origin }, data: { uploadKey: legacyMissingDocument.id } });
    check(missingReceipt.status() === 202 && (await missingReceipt.json()).receipt?.state === "pending", "The actual missing-byte legacy check asks for the original file and does not create another document.");
    assert.deepEqual(await adoptionState(), beforeAdoption);
    const legacyFile = { ...file, name: legacyMissingDocument.filename };
    const adopted = await first.page.request.post(documentsUrl, { headers: { origin, "Idempotency-Key": legacyMissingDocument.id }, multipart: { consent: "1", file: legacyFile } });
    check(adopted.status() === 201 && (await adopted.json()).receipt?.document.id === legacyMissingDocument.id,
      "The exact original file resumes the actual legacy row instead of registering another upload.");
    const afterAdoption = await adoptionState();
    assert.deepEqual(afterAdoption.document, beforeAdoption.document);
    check(afterAdoption.upload_key === legacyMissingDocument.id && afterAdoption.upload_sha256 === createHash("sha256").update(pdfBytes).digest("hex") &&
      afterAdoption.upload_confirmed_at && afterAdoption.documents === beforeAdoption.documents && afterAdoption.objects === 1 && afterAdoption.confirmations === 1 && afterAdoption.version === beforeAdoption.version + 1,
    "Native legacy adoption pins one HTTP attempt while preserving identity, original consent/expiry, row count and one confirmed Storage write.");
    const adoptedBytes = await ownerStorage.storage.from("parent-documents").download(legacyMissingDocument.object_path);
    check(!adoptedBytes.error && adoptedBytes.data && Buffer.from(await adoptedBytes.data.arrayBuffer()).equals(pdfBytes), "The resumed legacy object contains the exact original bytes through actual owned Storage.");
    const adoptedReplay = await first.page.request.post(documentsUrl, { headers: { origin, "Idempotency-Key": legacyMissingDocument.id }, multipart: { consent: "1", file: legacyFile } });
    check(adoptedReplay.status() === 201 && (await adoptedReplay.json()).receipt?.document.id === legacyMissingDocument.id, "Actual adopted-legacy replay acknowledges the same document.");
    assert.deepEqual(await adoptionState(), afterAdoption);
    check((await first.page.request.delete(`${documentsUrl}/${legacyMissingDocument.id}`, { headers: { origin } })).status() === 200,
      "The additional synthetic legacy recovery document is revoked before later workflow checks.");

    stage = "actual outcome, preferences, exports and cancellation controls";
    await showSection(first.page, "application-receipts");
    await first.page
      .getByText("Tell us about an outcome", { exact: true })
      .click();
    await first.page.getByLabel("What happened?").selectOption("unresolved");
    await first.page
      .getByLabel("What did you receive or hear, and when?")
      .fill("Synthetic rehearsal: support is still needed today.");
    const reported = first.page.waitForResponse(
      (response) =>
        response.url() ===
          `${origin}/api/parent/requests/${requestId}/outcome` &&
        response.request().method() === "POST",
    );
    await first.page.getByRole("button", { name: "Save my report" }).click();
    check(
      (await reported).status() === 200,
      "The actual request UI saves an explicitly attributed parent outcome report.",
    );
    check(
      (
        await db.query(
          "select exists(select 1 from public.parent_events where request_id=$1 and kind='parent.outcome_reported' and evidence->>'attribution'='parent_reported' and evidence->>'outcome'='unresolved') recorded",
          [requestId],
        )
      ).rows[0].recorded,
      "A parent report remains parent-attributed in the actual database.",
    );
    const summaryDownload = first.page.waitForEvent("download");
    await first.page
      .getByRole("link", { name: "Download current summary" })
      .click();
    const summary = await summaryDownload;
    check(
      !(await summary.failure()),
      "The actual request summary link downloads its current export.",
    );
    await first.page.goto(`${origin}/account`, { waitUntil: "networkidle" });
    await first.page
      .getByLabel("Preferred service language")
      .selectOption("es");
    await first.page.getByLabel("Start", { exact: true }).selectOption("21");
    const saved = first.page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/account` &&
        response.request().method() === "POST",
    );
    await first.page.getByRole("button", { name: "Save preferences" }).click();
    check(
      (await saved).status() === 200,
      "The actual account UI saves notification and language preferences.",
    );
    await first.page.reload({ waitUntil: "networkidle" });
    check(
      (await first.page
        .getByLabel("Preferred service language")
        .inputValue()) === "es" &&
        (await first.page.getByLabel("Start", { exact: true }).inputValue()) ===
          "21",
      "Saved actual account preferences survive a browser reload.",
    );
    const exported = first.page.waitForEvent("download");
    await first.page
      .getByRole("link", { name: "Download my information" })
      .click();
    const information = await exported;
    check(
      !(await information.failure()),
      "The actual account information link downloads the parent's export.",
    );
    const cancelledId = await startFoodRequest(second.page);
    await second.page
      .getByRole("button", { name: "Cancel request & withdraw permission" })
      .click();
    const cancelled = second.page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/requests/${cancelledId}` &&
        response.request().method() === "POST",
    );
    await second.page
      .getByRole("button", { name: "Yes, cancel this request" })
      .click();
    const cancelledResponse = await cancelled;
    const cancellationState = (
      await db.query(
        "select status,mandate_revoked_at,parent_private.current_grant(id,version) allowed from public.parent_requests where id=$1",
        [cancelledId],
      )
    ).rows[0];
    check(
      cancelledResponse.status() === 200 &&
        cancellationState.status === "cancelled" &&
        cancellationState.mandate_revoked_at &&
        cancellationState.allowed === false,
      "The actual confirmation button cancels a request and stops its durable mandate.",
    );

    stage = "actual full SNAP intake, owned revisions and token authorization";
    const snapControls = (await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value;
    const snapBudgetBefore = (await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
    let snapDiagnosticRequestId: string | undefined;
    try {
      await db.query(`update parent_private.processing_controls set snap_details_enabled=true,
        snap_details_approval_reference='isolated synthetic Auth SNAP fixture',snap_details_approved_until=now()+interval '1 hour',snap_details_notice_version=$1 where singleton`,
      [SNAP_APPLICATION_NOTICE_VERSION]);
      const checkSnapPage = async (state: string) => {
        const viewport = first.page.viewportSize();
        const directory = "tmp/parent-verification/actual-auth";
        mkdirSync(directory, { recursive: true });
        try {
          for (const [name, width, height] of [["phone", 320, 820], ["laptop", 1280, 900]] as const) {
            await first.page.setViewportSize({ width, height });
            await first.page.evaluate(() => document.fonts.ready.then(() => undefined));
            const overflow = await first.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
            if (state === "intake" || state === "correction") {
              const flow = await first.page.getByRole("link", { name: "SNAP data notice", exact: true }).evaluate(link => {
                const paragraph = link.closest("p"), notice = paragraph?.parentElement;
                if (!paragraph || !notice) return null;
                const style = getComputedStyle(notice);
                return { display: getComputedStyle(paragraph).display, width: paragraph.getBoundingClientRect().width,
                  available: notice.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
              });
              check(flow?.display === "block" && Math.abs(flow.width - flow.available) <= 2,
                `The actual SNAP ${state} notice keeps all prose and links in normal paragraph flow across the available content width at ${width}px.`);
            }
            const axe = await new AxeBuilder({ page: first.page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
            const screenshot = `${directory}/snap-${state}-${name}.png`;
            await first.page.screenshot({ path: screenshot, fullPage: true });
            snapAccessibility.push({ state, width, height, screenshot, overflow, violations: axe.violations.map(item => item.id) });
            check(!overflow, `The actual SNAP ${state} has no horizontal page overflow at ${width}px.`);
            check(axe.violations.length === 0, `The actual SNAP ${state} has no automated WCAG A/AA violations at ${width}px (${axe.violations.map(item => item.id).join(", ") || "none"}).`);
          }
        } finally {
          if (viewport) await first.page.setViewportSize(viewport);
        }
      };
      await first.page.clock.setSystemTime(new Date());
      const snapClockStarted = await first.page.evaluate(() => Date.now());
      await first.page.goto(`${origin}/get-support?need=snap_new`, { waitUntil: "networkidle" });
      await first.page.getByLabel("Your first name").fill("AuthSnapCanary");
      await first.page.getByLabel("Your last name").fill("Parent");
      for (const [path, value] of Object.entries({ "address.street": "123 Synthetic Lane", "address.city": "Philadelphia", "address.state": "PA", zip: "19104", county: "Philadelphia" }))
        await first.page.locator(`[data-snap-path="${path}"]`).fill(value);
      for (const [path, value] of Object.entries({ language: "en", interpreter: "no", "income.hasIncome": "no",
        "screening.lowCashAndIncome": "no", "screening.migrantOrSeasonal": "no", "screening.belowShelterCosts": "no",
        "history.fleeingOrProbation.answer": "no", "history.welfareFraud.answer": "no", "history.otherStateDisqualification.answer": "no",
        "expenseClaims.household": "do_not_claim", "expenseClaims.medical": "not_applicable" }))
        await first.page.locator(`[data-snap-path="${path}"]`).selectOption(value);
      await first.page.getByLabel("Your date of birth").fill("1988-04-15");
      for (const [label, value] of [["Your sex, as requested on the form", "female"], ["Are you a student?", "no"], ["Are you applying for SNAP?", "yes"], ["Are you a U.S. citizen?", "yes"]])
        await first.page.getByLabel(label).selectOption(value);
      check(await first.page.getByLabel("Your first name").count() === 1 && await first.page.getByLabel("People in your household").count() === 0 &&
        await first.page.getByLabel("Household income before taxes ($)").count() === 0,
      "The actual full SNAP form asks supplied names once and derives the roster without duplicate count or aggregate-income questions.");
      await first.page.getByRole("checkbox", { name: /I’m 18 or older/ }).check();
      await checkSnapPage("intake");
      check(await first.page.evaluate(() => Date.now()) > snapClockStarted, "The actual SNAP browser clock advances so subsequently saved evidence is not misclassified as future-dated.");
      await first.page.getByRole("button", { name: "Continue", exact: true }).click();
      check(await first.page.getByRole("checkbox").count() === 1, "The actual full SNAP start uses one bounded authorization without a separate review-approval click.");
      await first.page.getByRole("checkbox", { name: /I authorize/ }).check();
      const snapStarting = first.page.waitForResponse(response => response.url() === `${origin}/api/parent/requests` && response.request().method() === "POST");
      await first.page.getByRole("button", { name: "Start getting support" }).click();
      const snapStarted = await snapStarting;
      check(snapStarted.status() === 201, "The actual full SNAP form and authorization atomically start the request with its private answers.");
      const snapRequestId = (await snapStarted.json()).request.id as string;
      snapDiagnosticRequestId = snapRequestId;
      const snapStartBody = snapStarted.request().postDataJSON();
      const snapStartHeaders = { origin, "Idempotency-Key": snapStarted.request().headers()["idempotency-key"] };
      check(snapStartBody.kind === "snap_application" && snapStartBody.noticeVersion === SNAP_APPLICATION_NOTICE_VERSION && !!snapStartHeaders["Idempotency-Key"],
        "The browser sends the explicit reviewed SNAP payload and a stable idempotency key.");
      await first.page.waitForURL(`${origin}/support/${snapRequestId}`);
      stage = "actual SNAP saved review and editable owned snapshot";
      await showSection(first.page, "application-review");
      await first.page.getByRole("button", { name: "Correct application answers" }).waitFor();
      await checkSnapPage("review");
      const snapUrl = `${origin}/api/parent/requests/${snapRequestId}/snap-application`;
      const readSnap = async (revision?: string, requestId = snapRequestId) => {
        const response = await first.page.request.get(`${origin}/api/parent/requests/${requestId}/snap-application${revision ? `?revision=${revision}` : ""}`);
        check(response.status() === 200 && response.headers()["cache-control"] === "private, no-store", "Owned SNAP revision reads succeed privately through the real web API.");
        return (await response.json()).snapshot as SnapApplicationSnapshot;
      };
      const originalSnap = await readSnap();
      check(originalSnap.revision === 1 && originalSnap.request_version === 2 && originalSnap.idempotency_key === snapStartHeaders["Idempotency-Key"] &&
        assessSnapApplicationFields(originalSnap.details, new Date()).nonProtectedDataReadyForReview,
      "The committed original revision includes all applicable nonprotected form answers before queued work can use it.");
      assert.deepEqual(originalSnap.details, snapStartBody.details);
      assert.deepEqual(originalSnap.source, SNAP_APPLICATION_SOURCE);
      const ownerSnap = await rest(token, `parent_snap_application_details?request_id=eq.${snapRequestId}`);
      check(ownerSnap.status === 200, "The issued owner Auth token reads its own private SNAP snapshot through actual PostgREST.");
      assert.deepEqual(await ownerSnap.json(), [originalSnap]);
      const snapState = async (requestId = snapRequestId) => (await db.query(`select to_jsonb(r) request,to_jsonb(j) job,
        (select jsonb_agg(to_jsonb(d) order by d.revision) from public.parent_snap_application_details d where d.request_id=r.id) snapshots,
        (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') from public.parent_events e where e.request_id=r.id) events,
        (select count(*)::int from public.parent_operations o where o.request_id=r.id) operations,
        (select count(*)::int from parent_private.ai_calls a where a.request_id=r.id) model_calls
        from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1`, [requestId])).rows[0];
      const snapBeforeRetry = await snapState();
      check(snapBeforeRetry.job.request_version === originalSnap.request_version && snapBeforeRetry.job.state === "queued" &&
        !JSON.stringify([snapBeforeRetry.request, snapBeforeRetry.job, snapBeforeRetry.events]).includes("AuthSnapCanary"),
      "Private answers remain outside ordinary request/job/event data while the queued job matches the committed snapshot version.");
      const startReplay = await first.page.request.post(`${origin}/api/parent/requests`, { headers: snapStartHeaders, data: snapStartBody });
      check(startReplay.status() === 201 && (await startReplay.json()).request.id === snapRequestId, "An exact real web start retry returns the same SNAP request.");
      const rpcStart = await rest(token, "rpc/parent_start_snap_application", { p_intake: snapStartBody.intake, p_mandate: snapStartBody.mandate,
        p_details: snapStartBody.details, p_notice_version: snapStartBody.noticeVersion, p_idempotency_key: snapStartHeaders["Idempotency-Key"] });
      check(rpcStart.status === 200 && await rpcStart.json() === snapRequestId, "The issued owner token can replay the exact atomic start through PostgREST without duplicating work.");
      assert.deepEqual(await snapState(), snapBeforeRetry);
      const hiddenSnap = await rest(secondToken, `parent_snap_application_details?request_id=eq.${snapRequestId}`);
      check(hiddenSnap.status === 200 && (await hiddenSnap.json()).length === 0 && (await second.page.request.get(snapUrl)).status() === 404,
        "Another authenticated household cannot read the private SNAP revision through PostgREST or the web API.");
      const foreignSave = await rest(secondToken, "rpc/parent_save_snap_application_details", { p_request_id: snapRequestId, p_expected_version: originalSnap.request_version,
        p_details: originalSnap.details, p_notice_version: SNAP_APPLICATION_NOTICE_VERSION, p_idempotency_key: randomUUID() });
      check(foreignSave.status === 403, "Another issued Auth token cannot save a correction to this household's SNAP application.");

      stage = "actual SNAP correction, immutable history and exact retry";
      await first.page.getByRole("button", { name: "Correct application answers" }).click();
      const snapForm = first.page.getByRole("form", { name: "Correct SNAP application answers" });
      await snapForm.locator('[data-snap-path="address.street"]').fill("124 Synthetic Lane");
      await checkSnapPage("correction");
      const snapSaving = first.page.waitForResponse(response => response.url() === snapUrl && response.request().method() === "POST");
      await snapForm.getByRole("button", { name: "Save application changes" }).click();
      const snapSaved = await snapSaving;
      check(snapSaved.status() === 201, "The real grouped application editor saves a private correction without asking for review approval.");
      const snapSaveBody = snapSaved.request().postDataJSON();
      const snapSaveHeaders = { origin, "Idempotency-Key": snapSaved.request().headers()["idempotency-key"] };
      const correctedSnap = await readSnap();
      check(correctedSnap.id === (await snapSaved.json()).snapshotId && correctedSnap.revision === 2 && correctedSnap.request_version === originalSnap.request_version + 1 &&
        correctedSnap.details.address?.street === "124 Synthetic Lane" && snapSaveBody.expectedVersion === originalSnap.request_version,
      "The correction creates a new immutable exact revision and invalidates the earlier request version.");
      assert.deepEqual({ ...correctedSnap.provenance, "address.street": originalSnap.provenance["address.street"] }, originalSnap.provenance);
      assert.deepEqual(await readSnap(originalSnap.id), originalSnap);
      const correctedState = await snapState();
      const correctionReplay = await first.page.request.post(snapUrl, { headers: snapSaveHeaders, data: snapSaveBody });
      check(correctionReplay.status() === 201 && (await correctionReplay.json()).snapshotId === correctedSnap.id,
        "An exact correction retry through the real web API returns the same saved revision.");
      const rpcCorrection = await rest(token, "rpc/parent_save_snap_application_details", { p_request_id: snapRequestId, p_expected_version: snapSaveBody.expectedVersion,
        p_details: snapSaveBody.details, p_notice_version: snapSaveBody.noticeVersion, p_idempotency_key: snapSaveHeaders["Idempotency-Key"] });
      check(rpcCorrection.status === 200 && await rpcCorrection.json() === correctedSnap.id, "The issued owner token replays the exact correction through PostgREST.");
      const oldVersion = await first.page.request.post(snapUrl, { headers: { origin, "Idempotency-Key": randomUUID() }, data: snapSaveBody });
      const oldStart = await first.page.request.post(`${origin}/api/parent/requests`, { headers: snapStartHeaders, data: snapStartBody });
      check(oldVersion.status() === 409 && oldStart.status() === 409, "Old-version corrections and a superseded initial-start retry are rejected instead of overwriting current private answers.");
      assert.deepEqual(await snapState(), correctedState);
      check(correctedState.operations === 0 && correctedState.model_calls === 0, "This actual intake/revision check creates no provider operation and calls no model.");
      const snapExport = await first.page.request.get(`${origin}/api/parent/account/export`);
      check(snapExport.status() === 200 && snapExport.headers()["cache-control"] === "private, no-store", "The actual owned information export includes private SNAP revisions without public caching.");
      const exportedSnap = (await snapExport.json()).requests.find((row: { id: string }) => row.id === snapRequestId);
      const exportedRevisions = exportedSnap?.snapApplicationDetails as SnapApplicationSnapshot[];
      check(exportedRevisions?.length === 2, "The actual owned export retains both original and corrected private application revisions.");
      assert.deepEqual(exportedRevisions.find(row => row.id === originalSnap.id), originalSnap);
      assert.deepEqual(exportedRevisions.find(row => row.id === correctedSnap.id), correctedSnap);
      const foreignExport = await second.page.request.get(`${origin}/api/parent/account/export`);
      check(foreignExport.status() === 200 && !(await foreignExport.text()).includes(snapRequestId), "Another household's actual export contains no private SNAP request or revision from this owner.");

      stage = "actual focused SNAP stale-answer reaffirmation from an explicit synthetic fixture";
      const staleProvenance = { ...correctedSnap.provenance, "address.street": { source: "parent", confirmedAt: "2026-01-01T12:00:00Z", asOf: "2026-01-01" } };
      const staleId = randomUUID();
      const staleSeed = await db.query(`insert into public.parent_snap_application_details(id,request_id,revision,base_version,request_version,details,provenance,source,notice_version,idempotency_key)
        select $1,d.request_id,d.revision+1,d.request_version,d.request_version,d.details,$2,d.source,d.notice_version,$3
        from public.parent_snap_application_details d join public.parent_requests r on r.id=d.request_id join public.parent_households h on h.id=r.household_id
        where d.id=$4 and h.owner_id=$5`, [staleId, JSON.stringify(staleProvenance), randomUUID(), correctedSnap.id, first.id]);
      const staleQuestion = [{ id: "actual-snap-stale-address", need: "snap_new", field: "snap_application_details", reason: "missing_fact", resolver: "parent", resolved: false,
        title: "Check an outdated SNAP application answer", explanation: "Explicit synthetic stale-answer fixture; this question is not an AI worker decision." }];
      const questionSeed = await db.query(`update public.parent_requests r set required_actions=$2 where r.id=$1
        and exists(select 1 from public.parent_households h where h.id=r.household_id and h.owner_id=$3)`, [snapRequestId, JSON.stringify(staleQuestion), first.id]);
      check(staleSeed.rowCount === 1 && questionSeed.rowCount === 1, "Only this run's owned synthetic SNAP request receives an immutable stale-address revision and an explicitly labeled fixture question.");
      const staleSnap = await readSnap();
      check(staleSnap.id === staleId && staleSnap.revision === 3, "The owned API reads the explicit immutable synthetic stale revision.");
      assert.deepEqual(staleSnap.details, correctedSnap.details);
      assert.deepEqual(staleSnap.provenance, staleProvenance);
      await first.page.reload({ waitUntil: "networkidle" });
      await showSection(first.page, "your-next-steps");
      await first.page.getByRole("link", { name: "Answer SNAP application questions" }).click();
      const focusedForm = first.page.getByRole("form", { name: "Correct SNAP application answers" });
      await focusedForm.getByLabel("Your address", { exact: true }).waitFor();
      check(await focusedForm.locator("input,select").count() === 1 && await focusedForm.getByLabel("Your address", { exact: true }).inputValue() === staleSnap.details.address?.street &&
        await first.page.getByRole("form", { name: "Household questions" }).count() === 0,
      "The actual focused editor asks only for the stale street answer and never opens generic answer_facts.");
      await focusedForm.getByRole("button", { name: "Still correct: Your address", exact: true }).click();
      const reaffirming = first.page.waitForResponse(response => response.url() === snapUrl && response.request().method() === "POST");
      await focusedForm.getByRole("button", { name: "Save application changes" }).click();
      const reaffirmed = await reaffirming;
      check(reaffirmed.status() === 201, "The actual focused Still correct answer saves through the owned application API.");
      const reaffirmBody = reaffirmed.request().postDataJSON(), reaffirmKey = reaffirmed.request().headers()["idempotency-key"];
      const latestSnap = await readSnap();
      check(latestSnap.id === (await reaffirmed.json()).snapshotId && latestSnap.revision === 4 && latestSnap.request_version === staleSnap.request_version + 1 && reaffirmBody.expectedVersion === staleSnap.request_version,
        "The current-version stale answer creates a new immutable revision and request version.");
      assert.deepEqual(reaffirmBody.confirmedPaths, ["address.street"]);
      assert.deepEqual(latestSnap.confirmed_paths, ["address.street"]);
      assert.deepEqual(latestSnap.details, staleSnap.details);
      assert.deepEqual({ ...latestSnap.provenance, "address.street": staleSnap.provenance["address.street"] }, staleSnap.provenance);
      check(Date.parse(latestSnap.provenance["address.street"].confirmedAt) > Date.parse(staleSnap.provenance["address.street"].confirmedAt), "Only the explicitly reaffirmed stale street evidence gains a current confirmation time.");
      const reaffirmedState = await snapState();
      check(reaffirmedState.request.version === latestSnap.request_version && reaffirmedState.job.request_version === latestSnap.request_version && reaffirmedState.job.state === "queued" &&
        reaffirmedState.operations === 0 && reaffirmedState.model_calls === 0, "The actual reaffirmation requeues only current-version permitted work without a model call or provider operation.");
      const tokenReaffirm = await rest(token, "rpc/parent_reaffirm_snap_application_details", { p_request_id: snapRequestId, p_expected_version: reaffirmBody.expectedVersion,
        p_details: reaffirmBody.details, p_notice_version: reaffirmBody.noticeVersion, p_idempotency_key: reaffirmKey, p_confirmed_paths: reaffirmBody.confirmedPaths });
      check(tokenReaffirm.status === 200 && await tokenReaffirm.json() === latestSnap.id, "The issued owner Auth token replays the exact reaffirmation through the real PostgREST RPC.");
      assert.deepEqual(await snapState(), reaffirmedState);
      assert.deepEqual(await readSnap(originalSnap.id), originalSnap);
      assert.deepEqual(await readSnap(correctedSnap.id), correctedSnap);
      assert.deepEqual(await readSnap(staleSnap.id), staleSnap);
      stage = "actual explicit Spanish SNAP source and immutable correction";
      const spanishKey = randomUUID(), spanishBody = { ...structuredClone(snapStartBody), documentTemplateId: SNAP_ES_TEMPLATE_ID,
        details: { ...snapStartBody.details, language: "en" } };
      const spanishStart = await first.page.request.post(`${origin}/api/parent/requests`, { headers: { origin, "Idempotency-Key": spanishKey }, data: spanishBody });
      check(spanishStart.status() === 201, "The actual owned SNAP API accepts an explicit fixed Spanish document source.");
      const spanishId = (await spanishStart.json()).request.id as string, spanishUrl = `${origin}/api/parent/requests/${spanishId}`;
      const spanishOriginal = await readSnap(undefined, spanishId), spanishBeforeReplay = await snapState(spanishId);
      check(Object.entries(SNAP_SPANISH_APPLICATION_SOURCE).every(([key, value]) => spanishOriginal.source[key as keyof typeof spanishOriginal.source] === value)
        && spanishOriginal.details.language === "en", "Actual Spanish source selection records the complete pinned tuple independently of English program contact language.");
      check((await db.query("select count(*)::int n from parent_private.provider_capabilities where snap_spanish_completion_validator_version is not null or snap_spanish_completion_evidence_reference is not null or snap_spanish_completion_verified_until is not null")).rows[0].n === 0,
        "The actual Spanish preparation does not install or activate any protected Spanish provider evidence.");
      const invalidSpanishKey = randomUUID(), invalidSpanish = await first.page.request.post(`${origin}/api/parent/requests`, {
        headers: { origin, "Idempotency-Key": invalidSpanishKey }, data: { ...spanishBody, documentTemplateId: "../../private" } });
      check(invalidSpanish.status() === 400 && (await db.query("select count(*)::int n from public.parent_requests where start_key=$1", [invalidSpanishKey])).rows[0].n === 0,
        "The actual API rejects an arbitrary source path before creating any request or job.");
      const spanishReplay = await first.page.request.post(`${origin}/api/parent/requests`, { headers: { origin, "Idempotency-Key": spanishKey }, data: spanishBody });
      check(spanishReplay.status() === 201 && (await spanishReplay.json()).request.id === spanishId && JSON.stringify(await snapState(spanishId)) === JSON.stringify(spanishBeforeReplay),
        "An exact real Spanish start retry keeps one request, immutable snapshot and job without changing dates.");
      const differentSource = await first.page.request.post(`${origin}/api/parent/requests`, { headers: { origin, "Idempotency-Key": spanishKey }, data: { ...spanishBody, documentTemplateId: SNAP_EN_TEMPLATE_ID } });
      check(differentSource.status() === 409, "The actual same start key cannot silently select the other document source.");
      const spanishCopyUrl = `${spanishUrl}/snap-signing-copy?expectedVersion=${spanishOriginal.request_version}&snapshotId=${spanishOriginal.id}`;
      const spanishCopy = await first.page.request.get(spanishCopyUrl);
      check(spanishCopy.status() === 200 && spanishCopy.headers()["cache-control"] === "private, no-store", "The actual owned Spanish signing-copy download is private and nonprotected.");
      const spanishBytes = await spanishCopy.body(), renderedSpanish = await renderSnapSigningCopy(readFileSync("data/verified-forms/snap-pa600fs-es-2019.pdf"), spanishOriginal.details, new Date(spanishOriginal.created_at), SNAP_ES_TEMPLATE_ID);
      check(!!renderedSpanish.bytes && spanishBytes.equals(Buffer.from(renderedSpanish.bytes)), "Actual downloaded Spanish bytes equal the source-bound renderer at the immutable preparation time.");
      const spanishPdf = await PDFDocument.load(spanishBytes);
      check(spanishPdf.getPageCount() === 12 && /solicitud|campos/i.test(spanishPdf.getTitle() ?? ""), "The actual Spanish download retains all twelve original pages and Spanish preparation metadata.");
      const spanishCopyRetry = await first.page.request.get(spanishCopyUrl);
      check(spanishCopyRetry.status() === 200 && createHash("sha256").update(await spanishCopyRetry.body()).digest("hex") === createHash("sha256").update(spanishBytes).digest("hex"),
        "Actual repeated Spanish download preserves identical bytes without new personal acts or model work.");
      const foreignSpanish = await second.page.request.get(`${spanishUrl}/snap-application`), foreignSpanishCopy = await second.page.request.get(spanishCopyUrl);
      check(foreignSpanish.status() === 404 && foreignSpanishCopy.status() === 403, "Actual foreign sessions cannot read the selected Spanish snapshot or its prepared bytes.");
      const correctionKey = randomUUID(), sourceCorrection = { expectedVersion: spanishOriginal.request_version, details: spanishOriginal.details,
        noticeVersion: SNAP_APPLICATION_NOTICE_VERSION, documentTemplateId: SNAP_EN_TEMPLATE_ID };
      const spanishCorrection = await first.page.request.post(`${spanishUrl}/snap-application`, { headers: { origin, "Idempotency-Key": correctionKey }, data: sourceCorrection });
      check(spanishCorrection.status() === 201, "The actual owned correction can change only the selected document source.");
      const selectedEnglish = await readSnap(undefined, spanishId), sourceAfterCorrection = await snapState(spanishId);
      check(selectedEnglish.source.templateId === SNAP_EN_TEMPLATE_ID && selectedEnglish.revision === spanishOriginal.revision + 1
        && selectedEnglish.request_version === spanishOriginal.request_version + 1 && JSON.stringify(selectedEnglish.details) === JSON.stringify(spanishOriginal.details)
        && JSON.stringify(selectedEnglish.provenance) === JSON.stringify(spanishOriginal.provenance)
        && sourceAfterCorrection.job.request_version === selectedEnglish.request_version && sourceAfterCorrection.job.state === "queued"
        && sourceAfterCorrection.operations === 0 && sourceAfterCorrection.model_calls === 0,
      "Source-only correction makes a new immutable revision/current version while preserving every unchanged fact and date.");
      check(JSON.stringify(await readSnap(spanishOriginal.id, spanishId)) === JSON.stringify(spanishOriginal), "The original Spanish revision remains exactly intact after source correction.");
      check((await first.page.request.get(spanishCopyUrl)).status() === 403, "The superseded source scope is unavailable before any prepared bytes are loaded.");
      const sourceCorrectionRetry = await first.page.request.post(`${spanishUrl}/snap-application`, { headers: { origin, "Idempotency-Key": correctionKey }, data: sourceCorrection });
      check(sourceCorrectionRetry.status() === 201 && JSON.stringify(await snapState(spanishId)) === JSON.stringify(sourceAfterCorrection), "Exact actual source correction retry changes no snapshot, job, grant or timestamp.");
      const changedCorrection = await first.page.request.post(`${spanishUrl}/snap-application`, { headers: { origin, "Idempotency-Key": correctionKey }, data: { ...sourceCorrection, documentTemplateId: SNAP_ES_TEMPLATE_ID } });
      check(changedCorrection.status() === 409 && JSON.stringify(await snapState(spanishId)) === JSON.stringify(sourceAfterCorrection), "Reusing the source-correction key for a different variant conflicts without changing retained work.");
      const foreignCorrection = await second.page.request.post(`${spanishUrl}/snap-application`, { headers: { origin, "Idempotency-Key": randomUUID() }, data: { ...sourceCorrection, expectedVersion: selectedEnglish.request_version } });
      check(foreignCorrection.status() === 403, "An actual foreign session cannot change another household's selected document source.");
      const stoppedSpanish = await first.page.request.post(spanishUrl, { headers: { origin }, data: { action: "cancel" } });
      check(stoppedSpanish.status() === 200 && (await stoppedSpanish.json()).request.status === "cancelled"
        && (await db.query("select state from public.parent_jobs where request_id=$1", [spanishId])).rows[0].state === "cancelled",
        "The known synthetic Spanish request is cancelled through actual owner control before subsequent worker fixtures.");
      stage = "actual mixed private SNAP, family reuse and lost start acknowledgement";
      await db.query(`update parent_private.processing_controls set family_profile_enabled=true,
        family_profile_approval_reference='isolated synthetic Auth family-profile fixture',family_profile_approved_until=now()+interval '1 hour',family_profile_notice_version=$1 where singleton`,
      [FAMILY_PROFILE_NOTICE_VERSION]);
      const profileUrl = `${origin}/api/parent/family-profile`;
      const readProfile = async () => {
        const response = await first.page.request.get(profileUrl);
        check(response.status() === 200 && response.headers()["cache-control"] === "private, no-store", "The actual owned family profile is read privately.");
        const { ok, ...value } = await response.json();
        check(ok === true, "The actual family-profile API confirms an owned read.");
        return familyProfileReadSchema.parse(value);
      };
      const emptyProfile = await readProfile();
      check(emptyProfile.ownerId === first.id && emptyProfile.revision === 0 && emptyProfile.profile === null && emptyProfile.collection.collectionEnabled,
        "This isolated owner has no saved profile before the explicitly approved synthetic write.");
      const profileDetails = { primaryPerson: { id: randomUUID(), firstName: "AuthProfileCanary", lastName: "Parent", dateOfBirth: "1988-04-15" },
        homeAddress: { street: "125 Synthetic Lane", city: "Philadelphia", state: "PA", zip: "19129", county: "Philadelphia" }, preferredLanguage: "en" };
      const profileWrite = { expectedOwnerId: first.id, expectedRevision: 0, details: profileDetails, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION,
        consentAccepted: true, subjectAuthorityDeclared: true };
      const profileSaved = await first.page.request.post(profileUrl, { headers: { origin, "Idempotency-Key": randomUUID() }, data: profileWrite });
      check(profileSaved.status() === 201 && (await profileSaved.json()).revision === 1, "The real owned API saves explicitly consented reusable family basics.");
      const originalProfile = (await readProfile()).profile!;
      await first.page.goto(`${origin}/get-support?need=food`, { waitUntil: "networkidle" });
      await first.page.getByLabel("Do you have enough food for today and tomorrow?").selectOption("no");
      await first.page.getByLabel(/Do you get help paying for groceries/).selectOption("never");
      await first.page.getByRole("button", { name: "See my options", exact: true }).click();
      await first.page.getByRole("button", { name: "Continue with both options", exact: true }).click();
      await first.page.waitForFunction(() => (document.querySelector('[data-snap-path="applicant.firstName"]') as HTMLInputElement | null)?.value === "AuthProfileCanary");
      check(await first.page.getByLabel("Your last name").inputValue() === "Parent" && await first.page.getByLabel("Your date of birth").inputValue() === "1988-04-15" &&
        await first.page.locator('[data-snap-path="address.street"]').inputValue() === "125 Synthetic Lane" && await first.page.locator('[data-snap-path="zip"]').inputValue() === "19129",
      "The actual mixed private form reuses the owned fresh profile without asking for the supplied names, birth date or address again.");
      await first.page.getByRole("button", { name: "Use applicant ZIP code for support routing", exact: true }).click();
      for (const [path, value] of Object.entries({ interpreter: "no", "income.hasIncome": "no",
        "screening.lowCashAndIncome": "no", "screening.migrantOrSeasonal": "no", "screening.belowShelterCosts": "no",
        "history.fleeingOrProbation.answer": "no", "history.welfareFraud.answer": "no", "history.otherStateDisqualification.answer": "no",
        "expenseClaims.household": "do_not_claim", "expenseClaims.medical": "not_applicable" }))
        await first.page.locator(`[data-snap-path="${path}"]`).selectOption(value);
      for (const [label, value] of [["Your sex, as requested on the form", "female"], ["Are you a student?", "no"], ["Are you applying for SNAP?", "yes"], ["Are you a U.S. citizen?", "yes"]])
        await first.page.getByLabel(label).selectOption(value);
      await first.page.getByRole("checkbox", { name: /I’m 18 or older/ }).check();
      await first.page.getByRole("button", { name: "Continue", exact: true }).click();
      await first.page.getByRole("checkbox", { name: /I authorize/ }).check();
      let resolveLostStart!: (value: { response: APIResponse; request: BrowserRequest }) => void, rejectLostStart!: (error: unknown) => void;
      const lostStart = new Promise<{ response: APIResponse; request: BrowserRequest }>((resolve, reject) => { resolveLostStart = resolve; rejectLostStart = reject; });
      const dropCommittedStartAck = async (route: Route) => {
        if (route.request().method() !== "POST") { await route.continue(); return; }
        try {
          const response = await route.fetch();
          // Only the browser acknowledgement is dropped; Auth, API and database work have actually finished.
          await route.abort("connectionreset");
          resolveLostStart({ response, request: route.request() });
        } catch (error) { rejectLostStart(error); await route.abort().catch(() => {}); }
      };
      await first.page.route(`${origin}/api/parent/requests`, dropCommittedStartAck);
      let committedStart: { response: APIResponse; request: BrowserRequest };
      try {
        const [, written] = await Promise.all([first.page.getByRole("button", { name: "Start getting support", exact: true }).click(), lostStart]);
        committedStart = written;
      } finally { await first.page.unroute(`${origin}/api/parent/requests`, dropCommittedStartAck); }
      check(committedStart.response.status() === 201, "The actual mixed private start commits successfully before only its browser acknowledgement is lost.");
      const privateMixedId = (await committedStart.response.json()).request.id as string;
      const privateMixedBody = committedStart.request.postDataJSON(), privateMixedKey = committedStart.request.headers()["idempotency-key"];
      assert.deepEqual(privateMixedBody.intake.needs, ["food_now", "snap_new"]);
      check(privateMixedBody.intake.zip === "19129" && privateMixedBody.details.zip === "19129" && !privateMixedBody.reusedZip,
        "This Share-specific lifecycle explicitly chooses the known applicant ZIP for routing instead of silently replacing the earlier saved routing ZIP.");
      check(privateMixedBody.kind === "snap_application" && privateMixedBody.noticeVersion === SNAP_APPLICATION_NOTICE_VERSION &&
        privateMixedBody.mandate.recipientIds.includes(SHARE_FOOD_ACCESS_PROGRAM) && privateMixedBody.mandate.recipientIds.includes("snap-pa") &&
        privateMixedBody.familyProfileSource.expectedOwnerId === first.id && privateMixedBody.familyProfileSource.revision === 1 && !!privateMixedKey,
      "The actual lost-acknowledgement packet contains the selected mixed needs, named programs, reviewed private purpose and exact owned profile source.");
      check(privateMixedBody.familyProfileSource.fields.some((field: { applicationPath: string; profilePaths: string[] }) => field.applicationPath === "applicant.firstName" && field.profilePaths.includes("primaryPerson.firstName")),
        "The actual browser binds its reused applicant name to the selected family-profile leaf.");
      await first.page.getByText(/The save result has not been confirmed/).waitFor();
      check(await first.page.getByRole("button", { name: "Back", exact: true }).isDisabled(), "An unknown committed start keeps Back disabled until the exact attempt is reconciled.");
      const privateMixedOriginal = await readSnap(undefined, privateMixedId), privateMixedBeforeRetry = await snapState(privateMixedId);
      check(privateMixedOriginal.revision === 1 && privateMixedOriginal.request_version === 2 && privateMixedOriginal.idempotency_key === privateMixedKey &&
        privateMixedBeforeRetry.job.request_version === 2 && privateMixedBeforeRetry.job.state === "queued" && privateMixedBeforeRetry.operations === 0 && privateMixedBeforeRetry.model_calls === 0,
      "The lost acknowledgement leaves exactly one current immutable private revision and queued job without a model or provider operation.");
      check((await db.query("select count(*)::int n from public.parent_requests where start_key=$1", [privateMixedKey])).rows[0].n === 1 &&
        (await db.query("select count(*)::int n from public.parent_jobs where request_id=$1", [privateMixedId])).rows[0].n === 1,
      "The real committed start creates one request and one durable job for its stable key.");
      const retriedMixed = first.page.waitForResponse(response => response.url() === `${origin}/api/parent/requests` && response.request().method() === "POST");
      await first.page.getByRole("button", { name: "Start getting support", exact: true }).click();
      const retriedMixedResponse = await retriedMixed;
      check(retriedMixedResponse.status() === 201 && (await retriedMixedResponse.json()).request.id === privateMixedId &&
        retriedMixedResponse.request().postData() === committedStart.request.postData() && retriedMixedResponse.request().headers()["idempotency-key"] === privateMixedKey,
      "The actual browser retries the identical mixed private body and key and acknowledges the original request.");
      await first.page.waitForURL(`${origin}/support/${privateMixedId}`);
      assert.deepEqual(await snapState(privateMixedId), privateMixedBeforeRetry);
      assert.deepEqual(await readSnap(undefined, privateMixedId), privateMixedOriginal);
      const privateMixedUrl = `${origin}/api/parent/requests/${privateMixedId}`;
      const readPrivateMixed = async () => {
        const response = await first.page.request.get(privateMixedUrl);
        check(response.status() === 200 && response.headers()["cache-control"] === "private, no-store", "The actual mixed request remains privately readable by its owner.");
        return (await response.json()).request as SupportRequest;
      };
      const profileSources = async (version: number) => (await db.query("select * from parent_private.family_profile_request_sources where request_id=$1 and request_version=$2 order by application_path,profile_path", [privateMixedId, version])).rows;
      const originalBindings = await profileSources(2);
      check(originalBindings.length > 0 && originalBindings.every(binding => binding.profile_revision === 1), "The committed mixed revision has actual versioned profile bindings.");
      const privateWorker = new Client({ connectionString: local.DB_URL, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
      const privateMemberships = await foodMemberships();
      let privateMembershipChange: { existed: boolean; set: boolean } | undefined;
      const pausedNativeRequests: { id: string; version: number }[] = [];
      try {
        for (const id of [requestId, reusedRequestId]) {
          const url = `${origin}/api/parent/requests/${id}`, read = await first.page.request.get(url);
          check(read.status() === 200, "The worker fixture reads only its earlier owned request before temporary isolation.");
          const current = (await read.json()).request as SupportRequest;
          if (current.status !== "active") continue;
          const paused = await first.page.request.post(url, { headers: { origin }, data: { action: "pause" } });
          check(paused.status() === 200, "The actual parent API temporarily pauses an earlier active fixture before the mixed worker can claim it.");
          pausedNativeRequests.push({ id, version: current.version });
          const value = (await paused.json()).request as SupportRequest;
          check(value.status === "paused" && value.version === current.version + 1, "Temporary fixture isolation advances only its own current version once.");
        }
        check(syntheticApproval && !!fixtureApproval && Date.parse(fixtureApproval.approvedUntil) > Date.now(), "Mixed private leased work requires the current isolated synthetic fixture approval.");
        assertSyntheticParentAuthTargets(origin, local);
        const existing = privateMemberships.filter(membership => membership.role_name === "parent_worker");
        check(existing.some(membership => membership.admin_option), "The mixed fixture uses the existing ADMIN worker membership before temporarily changing SET.");
        if (!existing.some(membership => membership.set_option)) {
          const own = existing.find(membership => membership.grantor === foodOperator);
          privateMembershipChange = { existed: !!own, set: own?.set_option ?? false };
          await db.query(`grant parent_worker to ${foodIdentifier(foodOperator)} with ${own ? "" : "admin false, inherit false, "}set true`);
        }
        await privateWorker.connect(); await privateWorker.query("set role parent_worker");
        check((await privateWorker.query("select current_user role")).rows[0].role === "parent_worker", "Mixed continuation uses the real restricted parent_worker role.");
        await foodTurn(privateMixedId, privateWorker);
        const privateMixedPrepared = await readPrivateMixed(), privateMixedPreparedState = await snapState(privateMixedId);
        const privateFoodPlan = foodAccessPlanSchema.parse(privateMixedPrepared.plan?.routes.find(route => route.need === "food_now")?.foodAccess);
        check(privateFoodPlan.state === "prepared" && privateFoodPlan.requestVersion === 2 && privateMixedPrepared.status === "active" &&
          privateMixedPreparedState.job.state === "waiting" && privateMixedPreparedState.operations === 0 && privateMixedPreparedState.model_calls === 0,
        "Actual no-key leased work prepares the public subpath while retaining the private SNAP journey and its single job.");
        assert.deepEqual(privateMixedPrepared.plan?.routes.map(route => route.need), ["food_now", "snap_new"]);
        check(!/AuthProfileCanary|125 Synthetic Lane/.test(JSON.stringify(privateMixedPrepared.plan?.routes.find(route => route.need === "food_now"))), "The public food route contains no reused private name or application address.");
        assert.deepEqual(await readSnap(undefined, privateMixedId), privateMixedOriginal);
        const profileCorrectionBody = { ...profileWrite, expectedRevision: 1, details: { ...profileDetails, primaryPerson: { ...profileDetails.primaryPerson, firstName: "AuthProfileCorrected" } } };
        const profileCorrected = await first.page.request.post(profileUrl, { headers: { origin, "Idempotency-Key": randomUUID() }, data: profileCorrectionBody });
        check(profileCorrected.status() === 201 && (await profileCorrected.json()).revision === 2, "The real family-profile API accepts an owned correction without new service authorization.");
        const correctedProfile = (await readProfile()).profile!, privateMixedCorrected = await readSnap(undefined, privateMixedId), privateMixedCorrectionState = await snapState(privateMixedId);
        // A changed source first invalidates version2; saving its corrected private details then advances version3 to4.
        check(privateMixedCorrected.revision === 2 && privateMixedCorrected.request_version === 4 && privateMixedCorrected.base_version === 3 &&
          privateMixedCorrected.details.applicant?.firstName === "AuthProfileCorrected" && privateMixedCorrectionState.request.version === 4 &&
          privateMixedCorrectionState.job.request_version === 4 && privateMixedCorrectionState.job.state === "queued",
        "A real profile correction atomically creates the next immutable mixed SNAP revision and queues only its current request version.");
        assert.deepEqual(privateMixedCorrectionState.request.mandate, privateMixedPreparedState.request.mandate);
        assert.deepEqual(privateMixedCorrectionState.request.plan, privateMixedPreparedState.request.plan);
        assert.deepEqual(privateMixedCorrectionState.request.intake, privateMixedPreparedState.request.intake);
        assert.deepEqual(privateMixedCorrectionState.request.facts, privateMixedPreparedState.request.facts);
        assert.deepEqual(await readSnap(privateMixedOriginal.id, privateMixedId), privateMixedOriginal);
        assert.deepEqual(await profileSources(2), originalBindings);
        const changedNamePaths = ["applicant.firstName", `household.${profileDetails.primaryPerson.id}.firstName`];
        for (const [path, evidence] of Object.entries(privateMixedOriginal.provenance))
          if (!changedNamePaths.includes(path)) assert.deepEqual(privateMixedCorrected.provenance[path], evidence);
        assert.deepEqual(correctedProfile.provenance["primaryPerson.lastName"], originalProfile.provenance["primaryPerson.lastName"]);
        assert.equal(new Date(privateMixedCorrected.provenance["applicant.firstName"].confirmedAt).toISOString(), new Date(correctedProfile.provenance["primaryPerson.firstName"].confirmedAt).toISOString());
        const currentBindings = await profileSources(4);
        check(currentBindings.some(binding => binding.application_path === "applicant.firstName" && binding.profile_revision === 2) &&
          (await db.query("select parent_private.current_grant($1,4) allowed", [privateMixedId])).rows[0].allowed,
        "The corrected mixed work retains current owned source bindings and its existing bounded mandate.");
        const privateStartReceipt = await first.page.request.post(`${origin}/api/parent/requests`, { headers: { origin, "Idempotency-Key": privateMixedKey }, data: privateMixedBody });
        check(privateStartReceipt.status() === 201, "An exact previously committed source-aware start remains an acknowledgement read after profile correction.");
        const acknowledgedPrivateRequest = (await privateStartReceipt.json()).request as SupportRequest;
        check(acknowledgedPrivateRequest.id === privateMixedId && acknowledgedPrivateRequest.version === 4,
          "The original start receipt returns the same owned request at its corrected current version without rewriting old answers.");
        const staleFoodReport = await first.page.request.post(`${privateMixedUrl}/outcome`, { headers: { origin }, data: { action: "food_visit", expectedVersion: 2,
          siteId: privateFoodPlan.site.id, planHash: privateFoodPlan.planHash, reportKey: randomUUID(), result: "no_food" } });
        check(staleFoodReport.status() === 409, "The older food plan cannot accept a report after the shared request version changed.");
        assert.deepEqual(await snapState(privateMixedId), privateMixedCorrectionState);
        await foodTurn(privateMixedId, privateWorker);
        const currentPrivateMixed = await readPrivateMixed(), currentPrivateFood = foodAccessPlanSchema.parse(currentPrivateMixed.plan?.routes.find(route => route.need === "food_now")?.foodAccess);
        check(currentPrivateMixed.version === 4 && currentPrivateMixed.status === "active" && currentPrivateFood.state === "prepared" && currentPrivateFood.requestVersion === 4,
          "The real worker resumes at the corrected version and rebuilds only current public directions without losing SNAP work.");
        assert.deepEqual(currentPrivateMixed.plan?.routes.map(route => route.need), ["food_now", "snap_new"]);
        assert.deepEqual(await readSnap(undefined, privateMixedId), privateMixedCorrected);
        const resumedPrivateState = await snapState(privateMixedId);
        check(resumedPrivateState.operations === 0 && resumedPrivateState.model_calls === 0 && !/AuthProfileCanary|AuthProfileCorrected|125 Synthetic Lane/.test(JSON.stringify(currentPrivateMixed.plan?.routes.find(route => route.need === "food_now"))),
          "Corrected public continuation keeps both private names and the application address out of the food route and creates no provider operation or model call.");
        check((await second.page.request.get(`${privateMixedUrl}/snap-application`)).status() === 404, "A second actual household cannot read the mixed private application.");
        const mixedExportResponse = await first.page.request.get(`${origin}/api/parent/account/export`);
        check(mixedExportResponse.status() === 200 && mixedExportResponse.headers()["cache-control"] === "private, no-store", "The actual owner can export the mixed private revision history privately.");
        const mixedExport = (await mixedExportResponse.json()).requests.find((row: { id: string }) => row.id === privateMixedId);
        assert.deepEqual(mixedExport.snapApplicationDetails.find((row: SnapApplicationSnapshot) => row.id === privateMixedOriginal.id), privateMixedOriginal);
        assert.deepEqual(mixedExport.snapApplicationDetails.find((row: SnapApplicationSnapshot) => row.id === privateMixedCorrected.id), privateMixedCorrected);
        const cancelledMixed = await first.page.request.post(privateMixedUrl, { headers: { origin }, data: { action: "cancel" } });
        check(cancelledMixed.status() === 200 && (await cancelledMixed.json()).request.status === "cancelled" &&
          !(await db.query("select parent_private.current_grant(id,version) allowed from public.parent_requests where id=$1", [privateMixedId])).rows[0].allowed &&
          (await snapState(privateMixedId)).job.state === "cancelled", "Cancellation stops the current combined mandate and its only durable job.");
      } finally {
        try { await privateWorker.end(); }
        finally {
          try {
            if (privateMembershipChange) await db.query(privateMembershipChange.existed
              ? `grant parent_worker to ${foodIdentifier(foodOperator)} with set ${privateMembershipChange.set ? "true" : "false"}`
              : `revoke parent_worker from ${foodIdentifier(foodOperator)} granted by ${foodIdentifier(foodOperator)}`);
            assert.deepEqual(await foodMemberships(), privateMemberships);
          } finally {
            for (const previous of pausedNativeRequests) {
              const resumed = await first.page.request.post(`${origin}/api/parent/requests/${previous.id}`, { headers: { origin }, data: { action: "resume" } });
              check(resumed.status() === 200, "The actual parent API restores each earlier fixture that this mixed test paused.");
              const value = (await resumed.json()).request as SupportRequest;
              const job = (await db.query("select state,request_version from public.parent_jobs where request_id=$1", [previous.id])).rows[0];
              check(value.status === "active" && value.version === previous.version + 2 && job.state === "queued" && job.request_version === value.version,
                "Each earlier fixture regains its original active status with a current versioned job; no old version is reused.");
            }
          }
        }
      }
      const clearedProfile = await first.page.request.delete(profileUrl, { headers: { origin, "Idempotency-Key": randomUUID() }, data: { expectedOwnerId: first.id, expectedRevision: 2 } });
      check(clearedProfile.status() === 200 && (await clearedProfile.json()).revision === 3 && (await readProfile()).profile === null,
        "The real owner clears this run's seeded profile before later standalone application tests.");

      await db.query("update parent_private.processing_controls set snap_details_enabled=false where singleton");
      assert.deepEqual(await readSnap(), latestSnap);
      check((await first.page.request.post(snapUrl, { headers: { origin, "Idempotency-Key": reaffirmKey }, data: reaffirmBody })).status() === 403,
        "Closing the SNAP purpose stops further private writes while the owner can still read their retained exact revision.");
    } catch (error) {
      try {
        const fieldName = (path: string) => path.replace(/[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}/gi, "record");
        const response = snapDiagnosticRequestId ? await first.page.request.get(`${origin}/api/parent/requests/${snapDiagnosticRequestId}/snap-application`) : null;
        const body = response?.ok() ? await response.json() : null;
        const parsed = snapApplicationSnapshotSchema.safeParse(body?.snapshot);
        const browserNow = await first.page.evaluate(() => Date.now());
        const assessmentCode = (now: number) => {
          if (!parsed.success) return "snap_snapshot_invalid";
          try { assessSnapApplicationSnapshot(parsed.data, new Date(now));return null; }
          catch (failure) { return failure instanceof Error && ["snap_snapshot_invalid", "snap_provenance_invalid"].includes(failure.message) ? failure.message : "assessment_failed"; }
        };
        mkdirSync("tmp/parent-verification/actual-auth", { recursive: true });
        writeFileSync("tmp/parent-verification/actual-auth/snap-failure.json", `${JSON.stringify({
          stage, status: response?.status() ?? null, snapshotParsed: parsed.success,
          parseIssues: parsed.success ? [] : parsed.error.issues.map(issue => ({ code: issue.code, field: fieldName(issue.path.map(String).join(".")) })),
          browserAssessmentCode: assessmentCode(browserNow), systemAssessmentCode: assessmentCode(Date.now()),
          futureProvenanceFields: parsed.success ? Object.entries(parsed.data.provenance).filter(([, evidence]) => Date.parse(evidence.confirmedAt) > browserNow).map(([path]) => fieldName(path)) : [],
          snapAccessibility,
        }, null, 2)}\n`);
      } catch { /* Diagnostics must not mask the original failure or stop fixture cleanup. */ }
      throw error;
    } finally {
      await db.query(`update parent_private.processing_controls c set
        (snap_details_enabled,snap_details_approval_reference,snap_details_approved_until,snap_details_notice_version,
         family_profile_enabled,family_profile_approval_reference,family_profile_approved_until,family_profile_notice_version)=
        (select r.snap_details_enabled,r.snap_details_approval_reference,r.snap_details_approved_until,r.snap_details_notice_version,
         r.family_profile_enabled,r.family_profile_approval_reference,r.family_profile_approved_until,r.family_profile_notice_version
        from jsonb_populate_record(null::parent_private.processing_controls,$1::jsonb) r) where singleton`, [JSON.stringify(snapControls)]);
      assert.deepEqual((await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value, snapControls);
      check((await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n === snapBudgetBefore,
        "All SNAP and family-profile purpose controls are restored exactly and model-budget reservations are unchanged.");
    }

    stage = "actual private WIC intake, owned history and correction";
    const wicControls = (await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value;
    const wicBudgetBefore = (await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
    const checkWicPage = async (state: string) => {
      const viewport = first.page.viewportSize(), directory = "tmp/parent-verification/actual-auth";
      mkdirSync(directory, { recursive: true });
      try {
        for (const [name, width, height] of [["phone", 320, 820], ["laptop", 1280, 900]] as const) {
          await first.page.setViewportSize({ width, height });
          await first.page.evaluate(() => document.fonts.ready.then(() => undefined));
          const overflow = await first.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
          if (state === "intake" || state === "correction") {
            const flow = await first.page.getByRole("region", { name: "WIC private information notice", exact: true }).evaluate(notice => {
              const paragraph = notice.querySelector("p");
              if (!paragraph) return null;
              const style = getComputedStyle(notice);
              return { display: getComputedStyle(paragraph).display, width: paragraph.getBoundingClientRect().width,
                available: notice.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
            });
            check(flow?.display === "block" && Math.abs(flow.width - flow.available) <= 2,
              `The actual WIC ${state} notice keeps prose in normal paragraph flow across the available content width at ${width}px.`);
          }
          const axe = await new AxeBuilder({ page: first.page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
          const screenshot = `${directory}/wic-${state}-${name}.png`;
          await first.page.screenshot({ path: screenshot, fullPage: true });
          wicAccessibility.push({ state, width, height, screenshot, overflow, violations: axe.violations.map(item => item.id) });
          check(!overflow, `The actual WIC ${state} has no horizontal page overflow at ${width}px.`);
          check(axe.violations.length === 0, `The actual WIC ${state} has no automated WCAG A/AA violations at ${width}px (${axe.violations.map(item => `${item.id}: ${item.nodes.flatMap(node => node.target).join(", ")}`).join("; ") || "none"}).`);
        }
      } finally {
        if (viewport) await first.page.setViewportSize(viewport);
      }
    };
    try {
      await db.query("update parent_private.processing_controls set wic_details_enabled=false where singleton");
      await first.page.goto(`${origin}/get-support?need=wic_new`, { waitUntil: "networkidle" });
      check(await first.page.getByLabel("Contact first name", { exact: true }).count() === 0 &&
        await first.page.locator('a[href="https://www.pa.gov/services/health/request-a-pre-application-appointment-with-a-wic-specialist"]').count() > 0,
      "The actual closed WIC purpose exposes official help without opening private contact or health fields.");
      await db.query(`update parent_private.processing_controls set wic_details_enabled=true,
        wic_details_approval_reference='isolated synthetic Auth WIC fixture',wic_details_approved_until=now()+interval '1 hour',wic_details_notice_version=$1 where singleton`, [WIC_APPLICATION_NOTICE_VERSION]);
      await first.page.reload({ waitUntil: "networkidle" });
      await first.page.getByLabel("Contact first name", { exact: true }).waitFor();
      const routingReply = await first.page.request.get(`${origin}/api/parent/intake-defaults`);
      const routingSource = (await routingReply.json()).zip;
      check(routingReply.status() === 200 && routingSource?.value === "19104" &&
        await first.page.getByLabel("Household ZIP code", { exact: true }).inputValue() === routingSource.value &&
        await first.page.getByLabel("Contact postal ZIP code", { exact: true }).inputValue() === "",
      "The actual WIC intake reuses known household routing without retyping or inferring the separate contact postal ZIP.");
      await first.page.getByLabel("Preferred service language", { exact: true }).selectOption("en");
      await first.page.getByLabel("WIC application status", { exact: true }).selectOption("new");
      await first.page.getByLabel("Who is applying for WIC?", { exact: true }).selectOption("children");
      for (const [label, value] of [["Contact first name", "AuthWicCanary"], ["Contact last name", "Parent"], ["Contact date of birth", "1990-01-01"],
        ["Contact street address", "200 Synthetic Lane"], ["Contact city", "Philadelphia"], ["Contact postal ZIP code", "19147"],
        ["Contact email address", "fictional@example.test"], ["Contact phone number", "215-555-0101"]])
        await first.page.getByLabel(label, { exact: true }).fill(value);
      await first.page.getByLabel("Contact county", { exact: true }).selectOption("Philadelphia");
      await first.page.getByLabel("Preferred time for a WIC appointment", { exact: true }).selectOption("morning");
      await first.page.getByRole("button", { name: "Add a child", exact: true }).click();
      for (const [label, value] of [["Child 1 first name", "AuthWicChildCanary"], ["Child 1 last name", "Parent"], ["Child 1 date of birth", "2024-01-01"]])
        await first.page.getByLabel(label, { exact: true }).fill(value);
      check(await first.page.getByLabel("People in your household", { exact: true }).count() === 0 &&
        await first.page.getByLabel("Household income before taxes ($)", { exact: true }).count() === 0 &&
        await first.page.getByLabel("Mother’s WIC status", { exact: true }).count() === 0,
      "The actual selected child WIC route groups its known questions without unrelated household-income or maternal questions.");
      await first.page.getByRole("checkbox", { name: /I’m 18 or older/ }).check();
      await checkWicPage("intake");
      await first.page.getByRole("button", { name: "Continue", exact: true }).click();
      const wicConsent = first.page.getByRole("checkbox", { name: /I authorize/ });
      check(await first.page.getByRole("checkbox").count() === 1 &&
        (await wicConsent.evaluate(input => input.closest("label")?.textContent ?? "")).includes(WIC_SUBJECT_AUTHORITY_STATEMENT),
      "The actual WIC start uses the existing single authorization checkbox with the declared authority for everyone named.");
      await wicConsent.check();
      const wicStarting = first.page.waitForResponse(response => response.url() === `${origin}/api/parent/requests` && response.request().method() === "POST");
      await first.page.getByRole("button", { name: "Start getting support", exact: true }).click();
      const wicStarted = await wicStarting;
      check(wicStarted.status() === 201, "The actual grouped WIC intake and authorization atomically save the private request.");
      const wicRequestId = (await wicStarted.json()).request.id as string;
      const wicStartBody = wicStarted.request().postDataJSON();
      const wicStartHeaders = { origin, "Idempotency-Key": wicStarted.request().headers()["idempotency-key"] };
      check(wicStartBody.kind === "wic_application" && wicStartBody.noticeVersion === WIC_APPLICATION_NOTICE_VERSION &&
        wicStartBody.subjectAuthorityDeclared === true && wicStartBody.reusedZip?.sourceRequestId === routingSource.sourceRequestId &&
        !!wicStartHeaders["Idempotency-Key"] && wicStartBody.intake.householdSize === null && wicStartBody.intake.incomeAmount === null &&
        wicStartBody.details.contact.zip === "19147" && wicStartBody.intake.zip === "19104",
      "The real WIC start keeps explicit subject authority, private postal data and the unchanged ordinary routing source separate.");
      await first.page.waitForURL(`${origin}/support/${wicRequestId}`);
      const wicUrl = `${origin}/api/parent/requests/${wicRequestId}/wic-application`;
      const readWic = async (revision?: string) => {
        const response = await first.page.request.get(`${wicUrl}${revision ? `?revision=${revision}` : ""}`);
        check(response.status() === 200 && response.headers()["cache-control"] === "private, no-store", "Owned WIC revision reads succeed privately through the real web API.");
        return (await response.json()).snapshot as WicApplicationSnapshot;
      };
      const wicState = async () => (await db.query(`select to_jsonb(r) request,to_jsonb(j) job,
        (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') from public.parent_events e where e.request_id=r.id) events,
        (select count(*)::int from public.parent_operations o where o.request_id=r.id) operations,
        (select count(*)::int from parent_private.ai_calls a where a.request_id=r.id) model_calls
        from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1`, [wicRequestId])).rows[0];
      const originalWic = await readWic(), originalWicState = await wicState();
      assert.deepEqual(originalWic.details, wicStartBody.details);
      assert.deepEqual(originalWic.source, WIC_APPLICATION_SOURCE);
      check(originalWic.revision === 1 && originalWic.request_version === 2 && originalWicState.job.request_version === 2 &&
        originalWic.consent_evidence.subjectAuthorityDeclared && originalWic.consent_evidence.actorId === first.id &&
        !/AuthWicCanary|AuthWicChildCanary|1990-01-01|2024-01-01|19147/.test(JSON.stringify([originalWicState.request, originalWicState.job, originalWicState.events])),
      "The actual committed WIC snapshot binds the owner declaration while private answers stay out of ordinary requests, jobs and events.");
      const wicReplay = await first.page.request.post(`${origin}/api/parent/requests`, { headers: wicStartHeaders, data: wicStartBody });
      check(wicReplay.status() === 201 && (await wicReplay.json()).request.id === wicRequestId, "An exact real web WIC start retry returns the existing private request.");
      assert.deepEqual(await wicState(), originalWicState);
      const ownWic = await rest(token, `parent_wic_application_details?request_id=eq.${wicRequestId}`);
      check(ownWic.status === 200, "The issued owner Auth token reads the owned private WIC revision through actual PostgREST.");
      assert.deepEqual(await ownWic.json(), [originalWic]);
      const foreignWic = await rest(secondToken, `parent_wic_application_details?request_id=eq.${wicRequestId}`);
      check(foreignWic.status === 200 && (await foreignWic.json()).length === 0 && (await second.page.request.get(wicUrl)).status() === 404,
        "Another authenticated household cannot read private WIC history through PostgREST or the web API.");
      const foreignWicSave = await rest(secondToken, "rpc/parent_save_wic_application_details", { p_request_id: wicRequestId,
        p_expected_version: originalWic.request_version, p_details: originalWic.details, p_notice_version: WIC_APPLICATION_NOTICE_VERSION,
        p_idempotency_key: randomUUID(), p_subject_authority_declared: true });
      check(foreignWicSave.status === 403, "Another issued Auth token cannot correct the owner's WIC request.");
      const wicDocument = await first.page.request.post(`${origin}/api/parent/requests/${wicRequestId}/documents`, {
        headers: { origin }, multipart: { consent: "1", file: { name: "synthetic-wic.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-SYNTHETIC") } },
      });
      check(wicDocument.status() === 403 && (await db.query("select count(*)::int n from public.parent_documents where request_id=$1", [wicRequestId])).rows[0].n === 0,
        "Even with private WIC answers enabled, the actual upload API does not open the ordinary document or AI-processing channel.");
      assert.deepEqual(await wicState(), originalWicState);

      stage = "actual WIC saved answers and immutable correction";
      await showSection(first.page, "application-review");
      await first.page.getByRole("button", { name: "Correct WIC answers", exact: true }).waitFor();
      await checkWicPage("review");
      await first.page.getByRole("button", { name: "Correct WIC answers", exact: true }).click();
      const wicForm = first.page.getByRole("form", { name: "Correct WIC application answers", exact: true });
      check(await wicForm.getByLabel("Contact first name", { exact: true }).inputValue() === "AuthWicCanary" &&
        await wicForm.getByLabel("Contact postal ZIP code", { exact: true }).inputValue() === "19147" &&
        await wicForm.getByRole("checkbox", { name: /I authorize/ }).count() === 0,
      "The actual WIC editor reopens saved answers without retyping or another routine authority checkbox.");
      await wicForm.getByLabel("Contact street address", { exact: true }).fill("201 Synthetic Lane");
      await checkWicPage("correction");
      const wicSaving = first.page.waitForResponse(response => response.url() === wicUrl && response.request().method() === "POST");
      await wicForm.getByRole("button", { name: "Save WIC changes", exact: true }).click();
      const wicSaved = await wicSaving;
      check(wicSaved.status() === 201, "The actual WIC editor saves an in-scope correction without another approval step.");
      const wicSaveBody = wicSaved.request().postDataJSON();
      const wicSaveHeaders = { origin, "Idempotency-Key": wicSaved.request().headers()["idempotency-key"] };
      const correctedWic = await readWic();
      check(correctedWic.revision === 2 && correctedWic.request_version === originalWic.request_version + 1 &&
        correctedWic.details.contact?.street === "201 Synthetic Lane", "A real WIC correction creates a new immutable revision and invalidates the preceding request version.");
      assert.deepEqual({ ...correctedWic.provenance, "contact.street": originalWic.provenance["contact.street"] }, originalWic.provenance);
      assert.deepEqual(await readWic(originalWic.id), originalWic);
      const correctedWicState = await wicState();
      const wicCorrectionReplay = await first.page.request.post(wicUrl, { headers: wicSaveHeaders, data: wicSaveBody });
      check(wicCorrectionReplay.status() === 201 && (await wicCorrectionReplay.json()).snapshotId === correctedWic.id,
        "The actual WIC correction API reconciles an exact retry without duplicating a private revision.");
      assert.deepEqual(await wicState(), correctedWicState);

      stage = "actual paused WIC correction and closed-purpose history";
      await showSection(first.page, "application-controls");
      const wicPausing = first.page.waitForResponse(response => response.url() === `${origin}/api/parent/requests/${wicRequestId}` && response.request().method() === "POST");
      await first.page.getByRole("button", { name: "Pause future work", exact: true }).click();
      check((await wicPausing).status() === 200, "The actual WIC request can be paused through its standard control.");
      await first.page.getByRole("button", { name: "Resume support", exact: true }).waitFor();
      const pausedWicState = await wicState();
      await showSection(first.page, "application-review");
      await first.page.getByRole("button", { name: "Correct WIC answers", exact: true }).click();
      const pausedWicForm = first.page.getByRole("form", { name: "Correct WIC application answers", exact: true });
      stage = "editing the actual current paused WIC revision";
      await pausedWicForm.getByLabel("Contact phone number", { exact: true }).fill("215-555-0102");
      const pausedWicSaving = first.page.waitForResponse(response => response.url() === wicUrl && response.request().method() === "POST");
      await pausedWicForm.getByRole("button", { name: "Save WIC changes", exact: true }).click();
      check((await pausedWicSaving).status() === 201, "The actual paused WIC editor accepts a correction without resuming execution.");
      const pausedWic = await readWic(), finalWicState = await wicState();
      check(finalWicState.request.status === "paused" && finalWicState.job.state === "cancelled" &&
        finalWicState.request.version === pausedWicState.request.version + 1 && pausedWic.details.contact?.phone === "215-555-0102" &&
        finalWicState.operations === 0 && finalWicState.model_calls === 0,
      "The corrected WIC request remains paused with no model call or provider operation.");
      const wicExport = await first.page.request.get(`${origin}/api/parent/account/export`);
      check(wicExport.status() === 200 && wicExport.headers()["cache-control"] === "private, no-store", "The actual owner export includes private WIC history without public caching.");
      const exportedWic = (await wicExport.json()).requests.find((row: { id: string }) => row.id === wicRequestId);
      const exportedWicRevisions = exportedWic?.wicApplicationDetails as WicApplicationSnapshot[];
      check(exportedWicRevisions?.length === 3, "The actual owner export retains each original and corrected WIC revision.");
      assert.deepEqual(exportedWicRevisions.find(row => row.id === originalWic.id), originalWic);
      assert.deepEqual(exportedWicRevisions.find(row => row.id === correctedWic.id), correctedWic);
      assert.deepEqual(exportedWicRevisions.find(row => row.id === pausedWic.id), pausedWic);
      const foreignWicExport = await second.page.request.get(`${origin}/api/parent/account/export`);
      check(foreignWicExport.status() === 200 && !(await foreignWicExport.text()).includes(wicRequestId), "Another household's actual export excludes this private WIC request.");
      await db.query("update parent_private.processing_controls set wic_details_enabled=false where singleton");
      assert.deepEqual(await readWic(), pausedWic);
      const closedWicWrite = await first.page.request.post(wicUrl, { headers: { origin, "Idempotency-Key": randomUUID() },
        data: { expectedVersion: finalWicState.request.version, details: pausedWic.details, noticeVersion: WIC_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true } });
      check(closedWicWrite.status() === 403, "Closing only WIC collection denies new private writes while the owner retains their saved history.");
      await first.page.reload({ waitUntil: "networkidle" });
      await showSection(first.page, "application-review");
      const closedWicEditor = first.page.getByRole("button", { name: "Correct WIC answers", exact: true });
      check(await closedWicEditor.count() === 0 || await closedWicEditor.isDisabled(), "The actual WIC history does not offer an enabled editor after collection closes.");
      await checkWicPage("closed-history");
    } finally {
      await db.query(`update parent_private.processing_controls c set
        (wic_details_enabled,wic_details_approval_reference,wic_details_approved_until,wic_details_notice_version)=
        (select r.wic_details_enabled,r.wic_details_approval_reference,r.wic_details_approved_until,r.wic_details_notice_version
        from jsonb_populate_record(null::parent_private.processing_controls,$1::jsonb) r) where singleton`, [JSON.stringify(wicControls)]);
      assert.deepEqual((await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value, wicControls);
      check((await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n === wicBudgetBefore,
        "All four WIC-purpose controls are restored exactly and model-budget reservations are unchanged.");
    }

    stage = "actual private PECO intake, owned history and correction";
    const pecoControls = (await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value;
    const pecoBudgetBefore = (await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
    const choosePecoPreparation = async () => {
      await first.page.getByLabel("Household ZIP code", { exact: true }).waitFor();
      await first.page.getByRole("checkbox", { name: "PECO", exact: true }).check();
      await first.page.getByLabel("Your authority for the selected utility accounts", { exact: true }).selectOption("self");
      await first.page.getByLabel(/Prepare PECO CAP help for this electricity account/).check();
    };
    const checkPecoPage = async (state: string) => {
      const viewport = first.page.viewportSize(), directory = "tmp/parent-verification/actual-auth";
      mkdirSync(directory, { recursive: true });
      try {
        for (const [name, width, height] of [["phone", 320, 820], ["laptop", 1280, 900]] as const) {
          await first.page.setViewportSize({ width, height });
          await first.page.evaluate(() => document.fonts.ready.then(() => undefined));
          const overflow = await first.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
          if (state === "intake" || state === "correction") {
            const flow = await first.page.getByRole("region", { name: "PECO private information notice", exact: true }).evaluate(notice => {
              const paragraph = notice.querySelector("p");
              if (!paragraph) return null;
              const style = getComputedStyle(notice);
              return { display: getComputedStyle(paragraph).display, width: paragraph.getBoundingClientRect().width,
                available: notice.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
            });
            check(flow?.display === "block" && Math.abs(flow.width - flow.available) <= 2,
              `The actual PECO ${state} notice keeps normal paragraph flow across the available content width at ${width}px.`);
          }
          const axe = await new AxeBuilder({ page: first.page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
          const screenshot = `${directory}/peco-${state}-${name}.png`;
          await first.page.screenshot({ path: screenshot, fullPage: true });
          pecoAccessibility.push({ state, width, height, screenshot, overflow, violations: axe.violations.map(item => item.id) });
          check(!overflow, `The actual PECO ${state} has no horizontal page overflow at ${width}px.`);
          check(axe.violations.length === 0, `The actual PECO ${state} has no automated WCAG A/AA violations at ${width}px (${axe.violations.map(item => item.id).join(", ") || "none"}).`);
        }
      } finally {
        if (viewport) await first.page.setViewportSize(viewport);
      }
    };
    try {
      check(pecoControls.peco_details_enabled === false, "Private PECO collection is initially closed on the actual local runtime.");
      const databaseNow = new Date((await db.query("select clock_timestamp() value")).rows[0].value).getTime();
      check(databaseNow >= Date.parse(PECO_APPLICATION_SOURCE.sourceCheckedAt) && databaseNow < Date.parse(PECO_APPLICATION_SOURCE.verifiedUntil),
        "The actual current UTC time falls within the reviewed PECO source window; the rehearsal does not invent an eligibility date.");
      await first.page.clock.setSystemTime(new Date());
      await first.page.goto(`${origin}/get-support?need=electricity`, { waitUntil: "networkidle" });
      await choosePecoPreparation();
      check(await first.page.getByLabel("Applicant first name", { exact: true }).count() === 0 &&
        await first.page.getByLabel("PECO account number", { exact: true }).count() === 0 &&
        await first.page.getByRole("link", { name: "Open official PECO help", exact: true }).count() > 0,
      "The actual closed PECO purpose exposes official help without collecting private account or household answers.");
      await db.query(`update parent_private.processing_controls set peco_details_enabled=true,
        peco_details_approval_reference='isolated synthetic Auth PECO fixture',peco_details_approved_until=now()+interval '1 hour',peco_details_notice_version=$1 where singleton`, [PECO_APPLICATION_NOTICE_VERSION]);
      await first.page.reload({ waitUntil: "networkidle" });
      await choosePecoPreparation();
      await first.page.getByLabel("Applicant first name", { exact: true }).waitFor();
      const routingReply = await first.page.request.get(`${origin}/api/parent/intake-defaults`), routingSource = (await routingReply.json()).zip;
      check(routingReply.status() === 200 && routingSource?.value === "19104" &&
        await first.page.getByLabel("Household ZIP code", { exact: true }).inputValue() === routingSource.value &&
        await first.page.getByLabel("PECO service ZIP code", { exact: true }).inputValue() === "",
      "The actual PECO intake reuses current household routing without retyping or inferring the service-address ZIP.");
      const pecoAuthorization = (await (await first.page.request.get(`${origin}/api/parent/authorization-window`)).json()).authorization.pecoApplication;
      check(pecoAuthorization.collectionEnabled && pecoAuthorization.noticeVersion === PECO_APPLICATION_NOTICE_VERSION &&
        Date.parse(pecoAuthorization.expiresAt) > Date.now() && Date.parse(pecoAuthorization.expiresAt) <= Date.parse(PECO_APPLICATION_SOURCE.verifiedUntil),
      "The real web authorization window exposes the separately approved and source-bounded PECO deadline.");
      await first.page.getByLabel("Preferred service language", { exact: true }).selectOption("en");
      await first.page.getByLabel("What PECO CAP help is needed?", { exact: true }).selectOption("new_enrollment");
      await first.page.getByLabel("Is this account already enrolled in CAP?", { exact: true }).selectOption("not_enrolled");
      for (const [label, value] of [["Applicant first name", "AuthPecoCanary"], ["Applicant last name", "Parent"], ["Applicant date of birth", "1990-01-01"],
        ["PECO account number", "9000000001"], ["PECO service street address", "300 Synthetic Lane"], ["PECO service city", "Philadelphia"],
        ["PECO service ZIP code", "19147"], ["Home phone number", "215-555-0101"], ["Mobile phone number", "215-555-0102"]])
        await first.page.getByLabel(label, { exact: true }).fill(value);
      await first.page.getByLabel("PECO service state", { exact: true }).selectOption("PA");
      await first.page.getByLabel("Applicant income sources", { exact: true }).selectOption("sources");
      await first.page.getByLabel("Add applicant income source", { exact: true }).selectOption("employment");
      await first.page.getByLabel("Add applicant income source", { exact: true }).selectOption("pension");
      await first.page.getByRole("button", { name: "Add a household member", exact: true }).click();
      for (const [label, value] of [["Household member 1 first name", "AuthPecoAdultCanary"], ["Household member 1 last name", "Parent"],
        ["Household member 1 date of birth", "1988-01-01"], ["Household member 1 relationship to applicant", "Spouse"]])
        await first.page.getByLabel(label, { exact: true }).fill(value);
      await first.page.getByLabel("Household member 1 income sources", { exact: true }).selectOption("none");
      await first.page.getByRole("button", { name: "Add a household member", exact: true }).click();
      for (const [label, value] of [["Household member 2 first name", "AuthPecoChildCanary"], ["Household member 2 last name", "Parent"],
        ["Household member 2 date of birth", "2020-01-01"], ["Household member 2 relationship to applicant", "Child"]])
        await first.page.getByLabel(label, { exact: true }).fill(value);
      await first.page.getByLabel("Is this the full household list?", { exact: true }).selectOption("true");
      check(await first.page.getByLabel("Household member 2 income sources", { exact: true }).count() === 0 &&
        await first.page.getByLabel("People in your household", { exact: true }).count() === 0 &&
        await first.page.getByLabel("Household income before taxes ($)", { exact: true }).count() === 0,
      "The actual PECO form groups private names and adult income inventories without asking a child or collecting irrelevant generic income amounts.");
      await first.page.getByRole("checkbox", { name: /I’m 18 or older/ }).check();
      await checkPecoPage("intake");
      await first.page.getByRole("button", { name: "Continue", exact: true }).click();
      const pecoConsent = first.page.getByRole("checkbox", { name: /I authorize/ });
      const pecoConsentText = await pecoConsent.evaluate(input => input.closest("label")?.textContent ?? "");
      check(await first.page.getByRole("checkbox").count() === 1 && pecoConsentText.includes(PECO_SUBJECT_AUTHORITY_STATEMENT) && pecoConsentText.includes(PECO_ACCOUNT_AUTHORITY_STATEMENT),
        "The actual PECO start uses one normal mandate checkbox containing both exact subject and account declarations.");
      await pecoConsent.check();
      const pecoStarting = first.page.waitForResponse(response => response.url() === `${origin}/api/parent/requests` && response.request().method() === "POST");
      await first.page.getByRole("button", { name: "Start getting support", exact: true }).click();
      const pecoStarted = await pecoStarting;
      check(pecoStarted.status() === 201, "The actual grouped PECO intake and mandate atomically save the owned private request.");
      const pecoRequestId = (await pecoStarted.json()).request.id as string, pecoStartBody = pecoStarted.request().postDataJSON();
      const pecoStartHeaders = { origin, "Idempotency-Key": pecoStarted.request().headers()["idempotency-key"] };
      check(pecoStartBody.kind === "peco_application" && pecoStartBody.noticeVersion === PECO_APPLICATION_NOTICE_VERSION &&
        pecoStartBody.subjectAuthorityDeclared === true && pecoStartBody.accountAuthorityDeclared === true && !!pecoStartHeaders["Idempotency-Key"] &&
        pecoStartBody.reusedZip?.sourceRequestId === routingSource.sourceRequestId && pecoStartBody.details.address.zip === "19147" && pecoStartBody.intake.zip === "19104" &&
        pecoStartBody.intake.householdSize === null && pecoStartBody.intake.incomeAmount === null && pecoStartBody.intake.pregnantOrPostpartum === null &&
        pecoStartBody.mandate.mode === "prepare_only" && pecoStartBody.mandate.allowedData.includes("documents") && pecoConsentText.includes("each protected document needs its separate processing consent"),
      "The real PECO start binds actual declarations while private values and the service ZIP remain separate from reused ordinary routing.");
      await first.page.waitForURL(`${origin}/support/${pecoRequestId}`);
      const pecoUrl = `${origin}/api/parent/requests/${pecoRequestId}/peco-application`;
      const readPeco = async (revision?: string) => {
        const response = await first.page.request.get(`${pecoUrl}${revision ? `?revision=${revision}` : ""}`);
        check(response.status() === 200 && response.headers()["cache-control"] === "private, no-store", "Owned PECO revision reads succeed privately through the real web API.");
        return (await response.json()).snapshot as PecoApplicationSnapshot;
      };
      const pecoState = async () => (await db.query(`select to_jsonb(r) request,to_jsonb(j) job,
        (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') from public.parent_events e where e.request_id=r.id) events,
        (select count(*)::int from public.parent_operations o where o.request_id=r.id) operations,
        (select count(*)::int from parent_private.ai_calls a where a.request_id=r.id) model_calls
        from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1`, [pecoRequestId])).rows[0];
      const originalPeco = await readPeco(), originalPecoState = await pecoState();
      assert.deepEqual(originalPeco.details, pecoStartBody.details); assert.deepEqual(originalPeco.source, PECO_APPLICATION_SOURCE);
      check(originalPeco.revision === 1 && originalPeco.request_version === 2 && originalPecoState.job.request_version === 2 &&
        originalPeco.consent_evidence.actorId === first.id && originalPeco.consent_evidence.subjectAuthorityDeclared && originalPeco.consent_evidence.accountAuthorityDeclared &&
        originalPeco.details.applicant?.income?.sources.length === 2 && originalPeco.details.householdMembers?.[0].income?.state === "none" && !originalPeco.details.householdMembers?.[1].income &&
        !/AuthPecoCanary|AuthPecoAdultCanary|AuthPecoChildCanary|9000000001|1990-01-01|1988-01-01|2020-01-01|19147/.test(JSON.stringify([originalPecoState.request, originalPecoState.job, originalPecoState.events])),
      "The committed PECO revision binds exact people and account authority while private answers stay out of ordinary requests, jobs and events.");
      const sourceDates = (await db.query("select intake_confirmed_at->'zip' value from public.parent_requests where id=$1", [routingSource.sourceRequestId])).rows[0].value;
      check(originalPecoState.request.intake_confirmed_at.zip === sourceDates, "Reusing household routing preserves its actual original date instead of confirming it again for PECO.");
      const pecoReplay = await first.page.request.post(`${origin}/api/parent/requests`, { headers: pecoStartHeaders, data: pecoStartBody });
      check(pecoReplay.status() === 201 && (await pecoReplay.json()).request.id === pecoRequestId, "An exact real web PECO start retry returns the existing private request.");
      assert.deepEqual(await pecoState(), originalPecoState);
      const ownPeco = await rest(token, `parent_peco_application_details?request_id=eq.${pecoRequestId}`);
      check(ownPeco.status === 200, "The issued owner Auth token reads the owned PECO revision through actual PostgREST."); assert.deepEqual(await ownPeco.json(), [originalPeco]);
      const foreignPeco = await rest(secondToken, `parent_peco_application_details?request_id=eq.${pecoRequestId}`);
      check(foreignPeco.status === 200 && (await foreignPeco.json()).length === 0 && (await second.page.request.get(pecoUrl)).status() === 404,
        "Another issued Auth token cannot read PECO history through PostgREST or the web API.");
      const foreignPecoSave = await rest(secondToken, "rpc/parent_save_peco_application_details", { p_request_id: pecoRequestId, p_expected_version: originalPeco.request_version,
        p_details: originalPeco.details, p_notice_version: PECO_APPLICATION_NOTICE_VERSION, p_idempotency_key: randomUUID(), p_subject_authority_declared: true, p_account_authority_declared: true });
      check(foreignPecoSave.status === 403, "Another household's issued Auth token cannot correct the exact private PECO account.");
      const pecoDocument = await first.page.request.post(`${origin}/api/parent/requests/${pecoRequestId}/documents`, { headers: { origin },
        multipart: { consent: "1", file: { name: "synthetic-peco.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-SYNTHETIC") } } });
      const pecoDocuments = (await db.query(`select (select count(*)::int from public.parent_documents where request_id=$1) documents,
        (select count(*)::int from storage.objects where bucket_id='parent-documents' and name like $2) objects`, [pecoRequestId, `${first.id}/${pecoRequestId}/%`])).rows[0];
      check(pecoDocument.status() === 403 && pecoDocuments.documents === 0 && pecoDocuments.objects === 0,
        "Even with PECO answers enabled, the real upload API creates no private document metadata or stored objects.");
      assert.deepEqual(await pecoState(), originalPecoState);

      stage = "actual PECO saved answers and immutable corrections";
      await showSection(first.page, "application-review");
      await first.page.getByRole("button", { name: "Correct PECO answers", exact: true }).waitFor();
      await checkPecoPage("review");
      await first.page.getByRole("button", { name: "Correct PECO answers", exact: true }).click();
      const pecoForm = first.page.getByRole("form", { name: "Correct PECO application answers", exact: true });
      check(await pecoForm.getByLabel("Applicant first name", { exact: true }).inputValue() === "AuthPecoCanary" &&
        await pecoForm.getByLabel("PECO account number", { exact: true }).inputValue() === "9000000001" && await pecoForm.getByRole("checkbox").count() === 0,
      "The real PECO editor reopens saved facts without retyping or another approval checkbox.");
      await pecoForm.getByLabel("PECO service street address", { exact: true }).fill("301 Synthetic Lane");
      await checkPecoPage("correction");
      const pecoSaving = first.page.waitForResponse(response => response.url() === pecoUrl && response.request().method() === "POST");
      await pecoForm.getByRole("button", { name: "Save PECO changes", exact: true }).click();
      const pecoSaved = await pecoSaving;
      check(pecoSaved.status() === 201, "The actual PECO editor saves an in-scope correction without another approval step.");
      const pecoSaveBody = pecoSaved.request().postDataJSON(), pecoSaveHeaders = { origin, "Idempotency-Key": pecoSaved.request().headers()["idempotency-key"] };
      const correctedPeco = await readPeco(), correctedPecoState = await pecoState();
      check(correctedPeco.revision === 2 && correctedPeco.request_version === originalPeco.request_version + 1 && correctedPeco.details.address?.street === "301 Synthetic Lane" &&
        pecoSaveBody.subjectAuthorityDeclared === true && pecoSaveBody.accountAuthorityDeclared === true,
      "A genuine PECO save binds both declarations to its new immutable revision and invalidates superseded request work.");
      assert.deepEqual({ ...correctedPeco.provenance, "address.street": originalPeco.provenance["address.street"] }, originalPeco.provenance);
      assert.deepEqual(await readPeco(originalPeco.id), originalPeco);
      const pecoCorrectionReplay = await first.page.request.post(pecoUrl, { headers: pecoSaveHeaders, data: pecoSaveBody });
      check(pecoCorrectionReplay.status() === 201 && (await pecoCorrectionReplay.json()).snapshotId === correctedPeco.id,
        "The real PECO correction API reconciles an exact retry without duplicating its private revision.");
      assert.deepEqual(await pecoState(), correctedPecoState);
      await first.page.reload({ waitUntil: "networkidle" });
      await showSection(first.page, "application-review");
      await first.page.getByRole("button", { name: "Correct PECO answers", exact: true }).click();
      const accountForm = first.page.getByRole("form", { name: "Correct PECO application answers", exact: true });
      await accountForm.getByLabel("PECO account number", { exact: true }).fill("9000000002");
      const accountSaving = first.page.waitForResponse(response => response.url() === pecoUrl && response.request().method() === "POST");
      await accountForm.getByRole("button", { name: "Save PECO changes", exact: true }).click();
      check((await accountSaving).status() === 201, "The actual PECO editor can correct the account under a genuine new account declaration.");
      const accountPeco = await readPeco(), accountPecoState = await pecoState();
      check(accountPeco.revision === 3 && accountPeco.request_version === correctedPeco.request_version + 1 && accountPecoState.job.request_version === accountPeco.request_version &&
        accountPeco.details.accountNumber === "9000000002" && accountPeco.consent_evidence.accountNumberSha256 !== correctedPeco.consent_evidence.accountNumberSha256,
      "An exact account correction changes the immutable account binding and invalidates the old request version.");
      assert.deepEqual({ ...accountPeco.provenance, accountNumber: correctedPeco.provenance.accountNumber }, correctedPeco.provenance);
      check((await first.page.request.post(pecoUrl, { headers: pecoSaveHeaders, data: pecoSaveBody })).status() === 409,
        "A superseded exact PECO save cannot revive the preceding account or preparation revision.");

      stage = "actual paused PECO correction and closed-purpose history";
      await first.page.reload({ waitUntil: "networkidle" });
      await showSection(first.page, "application-controls");
      const pecoPausing = first.page.waitForResponse(response => response.url() === `${origin}/api/parent/requests/${pecoRequestId}` && response.request().method() === "POST");
      await first.page.getByRole("button", { name: "Pause future work", exact: true }).click();
      check((await pecoPausing).status() === 200, "The actual PECO request pauses through its existing request control.");
      await first.page.getByRole("button", { name: "Resume support", exact: true }).waitFor();
      const pausedPecoState = await pecoState();
      await showSection(first.page, "application-review");
      await first.page.getByRole("button", { name: "Correct PECO answers", exact: true }).click();
      const pausedPecoForm = first.page.getByRole("form", { name: "Correct PECO application answers", exact: true });
      await pausedPecoForm.getByLabel("Mobile phone number", { exact: true }).fill("215-555-0103");
      const pausedPecoSaving = first.page.waitForResponse(response => response.url() === pecoUrl && response.request().method() === "POST");
      await pausedPecoForm.getByRole("button", { name: "Save PECO changes", exact: true }).click();
      check((await pausedPecoSaving).status() === 201, "The actual paused PECO editor saves corrections without resuming execution.");
      const pausedPeco = await readPeco(), finalPecoState = await pecoState();
      check(pausedPeco.revision === 4 && finalPecoState.request.status === "paused" && finalPecoState.job.state === "cancelled" &&
        finalPecoState.request.version === pausedPecoState.request.version + 1 && pausedPeco.details.cellPhone === "215-555-0103" &&
        finalPecoState.operations === 0 && finalPecoState.model_calls === 0,
      "The corrected PECO request stays paused with no model call, provider operation or autonomous continuation.");
      await db.query("update parent_private.processing_controls set peco_details_enabled=false where singleton");
      assert.deepEqual(await readPeco(), pausedPeco);
      const closedPecoWrite = await first.page.request.post(pecoUrl, { headers: { origin, "Idempotency-Key": randomUUID() },
        data: { expectedVersion: finalPecoState.request.version, details: pausedPeco.details, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true, accountAuthorityDeclared: true } });
      check(closedPecoWrite.status() === 403, "Closing only PECO collection blocks private writes while retained owner history remains readable.");
      const pecoExport = await first.page.request.get(`${origin}/api/parent/account/export`);
      check(pecoExport.status() === 200 && pecoExport.headers()["cache-control"] === "private, no-store", "The real owner export includes retained PECO history without public caching after its collection closes.");
      const exportedPeco = (await pecoExport.json()).requests.find((row: { id: string }) => row.id === pecoRequestId)?.pecoApplicationDetails as PecoApplicationSnapshot[];
      check(exportedPeco?.length === 4, "The real owner export retains all original, corrected-account and paused PECO revisions.");
      for (const revision of [originalPeco, correctedPeco, accountPeco, pausedPeco]) assert.deepEqual(exportedPeco.find(row => row.id === revision.id), revision);
      const foreignPecoExport = await second.page.request.get(`${origin}/api/parent/account/export`);
      check(foreignPecoExport.status() === 200 && !(await foreignPecoExport.text()).includes(pecoRequestId), "Another household's real export excludes these private PECO revisions.");
      const ownPecoHistory = await rest(token, `parent_peco_application_details?request_id=eq.${pecoRequestId}&order=revision.asc`);
      check(ownPecoHistory.status === 200 && (await ownPecoHistory.json()).length === 4,
        "The issued owner token retains access to all exact PECO revisions after private collection closes.");
      await first.page.reload({ waitUntil: "networkidle" });
      await showSection(first.page, "application-review");
      const closedPecoEditor = first.page.getByRole("button", { name: "Correct PECO answers", exact: true });
      check(await closedPecoEditor.count() === 0 || await closedPecoEditor.isDisabled(), "Closed PECO history does not offer an enabled private editor.");
      check(await first.page.getByRole("heading", { name: "Your private PECO CAP answers", exact: true }).count() === 1,
        "The closed PECO collection flag preserves the actual owned-answer checklist and retained history.");
      await checkPecoPage("closed-history");
    } finally {
      await db.query(`update parent_private.processing_controls c set
        (peco_details_enabled,peco_details_approval_reference,peco_details_approved_until,peco_details_notice_version)=
        (select r.peco_details_enabled,r.peco_details_approval_reference,r.peco_details_approved_until,r.peco_details_notice_version
        from jsonb_populate_record(null::parent_private.processing_controls,$1::jsonb) r) where singleton`, [JSON.stringify(pecoControls)]);
      assert.deepEqual((await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value, pecoControls);
      check((await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n === pecoBudgetBefore,
        "All four PECO-purpose controls are restored exactly, the entire control row is unchanged and model-budget reservations are unchanged.");
    }

    for (const program of ["pgw", "water"] as const) {
      const name = program === "pgw" ? "PGW" : "water", need = program === "pgw" ? "gas" : "water";
      const provider = program === "pgw" ? "PGW" : "Philadelphia Water";
      const notice = program === "pgw" ? PGW_APPLICATION_NOTICE_VERSION : WATER_APPLICATION_NOTICE_VERSION;
      const source = program === "pgw" ? PGW_APPLICATION_SOURCE : WATER_APPLICATION_REFERENCE;
      const subjectStatement = program === "pgw" ? PGW_SUBJECT_AUTHORITY_STATEMENT : WATER_SUBJECT_AUTHORITY_STATEMENT;
      const accountStatement = program === "pgw" ? PGW_ACCOUNT_AUTHORITY_STATEMENT : WATER_ACCOUNT_AUTHORITY_STATEMENT;
      const control = `${program}_details`, table = `parent_${program}_application_details`;
      const controls = (await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value;
      const budget = (await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
      const choose = async () => {
        await first.page.getByLabel("Household ZIP code", { exact: true }).waitFor();
        await first.page.getByRole("checkbox", { name: provider, exact: true }).check();
        await first.page.getByLabel("Your authority for the selected utility accounts", { exact: true }).selectOption("self");
        await first.page.getByLabel(program === "pgw" ? /Prepare PGW CRP help/ : /Prepare Philadelphia water assistance/).check();
      };
      const checkPage = async (state: string) => {
        const viewport = first.page.viewportSize(), directory = "tmp/parent-verification/actual-auth";
        mkdirSync(directory, { recursive: true });
        try {
          for (const [size, width, height] of [["phone", 320, 820], ["laptop", 1280, 900]] as const) {
            await first.page.setViewportSize({ width, height });
            await first.page.evaluate(() => document.fonts.ready.then(() => undefined));
            const overflow = await first.page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
            const axe = await new AxeBuilder({ page: first.page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
            const screenshot = `${directory}/${program}-${state}-${size}.png`;
            await first.page.screenshot({ path: screenshot, fullPage: true });
            utilityAccessibility.push({ program, state, width, height, screenshot, overflow, violations: axe.violations.map(item => item.id) });
            check(!overflow, `The actual ${name} ${state} has no horizontal overflow at ${width}px.`);
            check(axe.violations.length === 0, `The actual ${name} ${state} has no automated WCAG A/AA violations at ${width}px (${axe.violations.map(item => item.id).join(", ") || "none"}).`);
          }
        } finally { if (viewport) await first.page.setViewportSize(viewport); }
      };
      try {
        stage = `actual closed ${name} collection and grouped private intake`;
        check(controls[`${control}_enabled`] === false, `Private ${name} collection is initially closed on the actual local runtime.`);
        const now = new Date((await db.query("select clock_timestamp() value")).rows[0].value).getTime();
        check(now >= Date.parse(source.sourceCheckedAt) && now < Date.parse(source.verifiedUntil), `The actual ${name} rehearsal stays inside its reviewed source window.`);
        await first.page.clock.setSystemTime(new Date());
        await first.page.goto(`${origin}/get-support?need=${need}`, { waitUntil: "networkidle" }); await choose();
        check(await first.page.getByLabel(program === "pgw" ? "Customer first name" : "Applicant full name", { exact: true }).count() === 0,
          `The actual closed ${name} purpose collects no private household answers.`);
        check(await first.page.getByRole("link", { name: program === "pgw" ? /official PGW help/ : /official water.*help/i }).count() > 0,
          `The actual closed ${name} purpose keeps official help available.`);
        await db.query(`update parent_private.processing_controls set ${control}_enabled=true,${control}_approval_reference=$1,
          ${control}_approved_until=now()+interval '1 hour',${control}_notice_version=$2 where singleton`, [`isolated synthetic Auth ${name} fixture`, notice]);
        await first.page.reload({ waitUntil: "networkidle" }); await choose();
        await first.page.getByLabel(program === "pgw" ? "Customer first name" : "Applicant full name", { exact: true }).waitFor();
        const routingResponse = await first.page.request.get(`${origin}/api/parent/intake-defaults`), routing = (await routingResponse.json()).zip;
        check(routingResponse.status() === 200 && routing?.value === "19104" && await first.page.getByLabel("Household ZIP code", { exact: true }).inputValue() === "19104" &&
          await first.page.getByLabel(program === "pgw" ? "PGW service ZIP code" : "Water property address", { exact: true }).inputValue() === "",
        `The actual ${name} intake reuses routing without retyping or inventing its private service address.`);
        const authorization = (await (await first.page.request.get(`${origin}/api/parent/authorization-window`)).json()).authorization[`${program}Application`];
        check(authorization.collectionEnabled && authorization.noticeVersion === notice && Date.parse(authorization.expiresAt) > Date.now() && Date.parse(authorization.expiresAt) <= Date.parse(source.verifiedUntil),
          `The actual ${name} web deadline is independently approved and bounded by its source review.`);
        await first.page.getByLabel("Preferred service language", { exact: true }).selectOption("en");
        if (program === "pgw") {
          await first.page.getByLabel("What PGW CRP help is needed?", { exact: true }).selectOption("new_enrollment");
          await first.page.getByLabel("What is this account’s CRP enrollment?", { exact: true }).selectOption("not_enrolled");
          for (const [label, value] of [["Customer first name", "AuthPgwCanary"], ["Customer last name", "Parent"], ["PGW account number", "FICT-AUTH-PGW-01"],
            ["PGW service street address", "400 Synthetic Utility Lane"], ["PGW service city", "Philadelphia"], ["PGW service state", "PA"], ["PGW service ZIP code", "19147"], ["PGW contact phone", "215-555-0101"]])
            await first.page.getByLabel(label, { exact: true }).fill(value);
          await first.page.getByLabel("Is the customer of record under 18?", { exact: true }).selectOption("false");
          await first.page.getByLabel("Customer income sources", { exact: true }).selectOption("sources");
          await first.page.getByLabel("Add customer income source", { exact: true }).selectOption("employment");
          await first.page.getByRole("button", { name: "Add a household member", exact: true }).click();
          for (const [label, value] of [["Household member 1 first name", "AuthPgwChildCanary"], ["Household member 1 last name", "Child"],
            ["Household member 1 date of birth", "2020-01-01"], ["Household member 1 relationship to customer", "Child"]]) await first.page.getByLabel(label, { exact: true }).fill(value);
          await first.page.getByLabel("Household member 1 income sources", { exact: true }).selectOption("sources");
          await first.page.getByLabel("Add household member 1 income source", { exact: true }).selectOption("social_security");
          await first.page.getByLabel("Does someone outside this household provide financial support?", { exact: true }).selectOption("true");
          for (const [label, value] of [["Outside supporter first name", "AuthPgwSupporterCanary"], ["Outside supporter last name", "Supporter"],
            ["Outside supporter street address", "402 Synthetic Utility Lane"], ["Outside supporter city", "Philadelphia"], ["Outside supporter state", "PA"],
            ["Outside supporter ZIP code", "19148"], ["Outside supporter phone", "215-555-0102"], ["Outside support monthly amount", "0.29"]]) await first.page.getByLabel(label, { exact: true }).fill(value);
          await first.page.getByLabel("Did the entire household have no income in the past 30 days?", { exact: true }).selectOption("false");
          await first.page.getByLabel("Does the household receive SNAP?", { exact: true }).selectOption("true");
          await first.page.getByLabel("SNAP monthly amount", { exact: true }).fill("300.29");
          await first.page.getByLabel("Does the household receive housing subsidy?", { exact: true }).selectOption("false");
          check(await first.page.getByLabel("Customer date of birth", { exact: true }).count() === 0 && await first.page.getByLabel(/Social Security|passport|student ID|identifier number/i).count() === 0,
            "The real PGW form preserves the customer exemption and keeps all required member identifiers outside ordinary inputs.");
        } else {
          await first.page.getByLabel("What water assistance help is needed?", { exact: true }).selectOption("new_application");
          await first.page.getByLabel("Have you already started or sent a City water assistance application?", { exact: true }).selectOption("none_known");
          for (const [label, value] of [["Applicant full name", "AuthWaterCanary Parent"], ["Applicant date of birth", "1990-01-01"], ["Applicant gross monthly income in dollars", "0"],
            ["Water property address", "500 Synthetic Utility Lane, Philadelphia PA 19147"], ["Daytime phone number", "215-555-0101"]]) await first.page.getByLabel(label, { exact: true }).fill(value);
          await first.page.getByLabel("Applicant income sources", { exact: true }).selectOption("none");
          await first.page.getByLabel("Have you been approved for an Owner Occupied Payment Agreement (OOPA)?", { exact: true }).selectOption("unknown");
          await first.page.getByRole("button", { name: "Add a household member", exact: true }).click();
          for (const [label, value] of [["Household member 1 full name", "AuthWaterChildCanary Child"], ["Household member 1 date of birth", "2020-01-01"], ["Household member 1 relationship to applicant", "Child"]])
            await first.page.getByLabel(label, { exact: true }).fill(value);
          await first.page.getByLabel("Does someone in the household receive child support?", { exact: true }).selectOption("no");
          await first.page.getByLabel("Does anyone in the household receive financial support from someone outside the household?", { exact: true }).selectOption("no");
          for (const [label, value] of [["How does the applicant pay for food?", "Using savings\nHousehold savings buy groceries"], ["How does the applicant pay for housing?", "Using savings"], ["How does the applicant pay for utility service?", "Using savings"]])
            await first.page.getByLabel(label, { exact: true }).fill(value);
          check(await first.page.getByLabel("Does the applicant report zero income for this application?", { exact: true }).count() === 0 &&
            await first.page.getByLabel(/water access code|application id|Social Security|tax ID/i).count() === 0,
          "The real water form uses supplied applicant zero income without a repeat confirmation, optional identifiers or account recovery secrets.");
        }
        await first.page.getByLabel("Is this the full household list?", { exact: true }).selectOption("true");
        await first.page.getByRole("checkbox", { name: /I’m 18 or older/ }).check(); await checkPage("intake");
        await first.page.getByRole("button", { name: "Continue", exact: true }).click();
        const consent = first.page.getByRole("checkbox", { name: /I authorize/ }), consentText = await consent.evaluate(input => input.closest("label")?.textContent ?? "");
        check(await first.page.getByRole("checkbox").count() === 1 && consentText.includes(subjectStatement) && consentText.includes(accountStatement),
          `The actual ${name} start has one authority act containing both exact declarations.`);
        await consent.check();
        const starting = first.page.waitForResponse(response => response.url() === `${origin}/api/parent/requests` && response.request().method() === "POST");
        void starting.catch(() => {}); // The awaited UI action can fail before this observation finishes.
        await first.page.getByRole("button", { name: "Start getting support", exact: true }).click(); const started = await starting;
        check(started.status() === 201, `The actual ${name} grouped private form starts through Next, Auth and PostgreSQL.`);
        const id = (await started.json()).request.id as string, startBody = started.request().postDataJSON();
        await first.page.waitForURL(`${origin}/support/${id}`);
        const url = `${origin}/api/parent/requests/${id}/${program}-application`;
        const read = async (revision?: string) => {
          const response = await first.page.request.get(`${url}${revision ? `?revision=${revision}` : ""}`);
          check(response.status() === 200 && response.headers()["cache-control"] === "private, no-store", `Owned ${name} immutable history is private through the real web API.`);
          const record = (await response.json()).snapshot;
          return program === "pgw" ? pgwApplicationSnapshotSchema.parse(record) : waterApplicationSnapshotSchema.parse(record);
        };
        const state = async () => (await db.query(`select to_jsonb(r) request,to_jsonb(j) job,
          (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') from public.parent_events e where e.request_id=r.id) events,
          (select count(*)::int from public.parent_operations o where o.request_id=r.id) operations,
          (select count(*)::int from parent_private.ai_calls a where a.request_id=r.id) model_calls
          from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1`, [id])).rows[0];
        const original = await read(), originalState = await state();
        assert.deepEqual(original.details, startBody.details); assert.deepEqual(original.source, source);
        check(startBody.kind === `${program}_application` && startBody.subjectAuthorityDeclared && startBody.accountAuthorityDeclared &&
          startBody.reusedZip?.sourceRequestId === routing.sourceRequestId && startBody.intake.zip === "19104" && startBody.intake.householdSize === null && startBody.intake.incomeAmount === null &&
          startBody.mandate.mode === "prepare_only" && JSON.stringify(startBody.mandate.allowedData) === JSON.stringify(["household", "income", "utility", "documents"]) &&
          original.revision === 1 && original.consent_evidence.actorId === first.id && originalState.job.request_version === original.request_version &&
          originalState.request.intake_confirmed_at.zip === routing.confirmedAt && !/AuthPgw|AuthWater|Synthetic Utility|19147|1990-01-01|2020-01-01|FICT-AUTH/.test(JSON.stringify([originalState.request, originalState.job, originalState.events])),
        `The actual ${name} revision keeps exact declarations and original routing dates while private canaries stay out of ordinary state and worker payloads.`);
        check(!(await db.query("select has_table_privilege('parent_worker',$1,'SELECT') allowed", [`public.${table}`])).rows[0].allowed,
          `The ordinary worker has no raw ${name} application table privilege.`);
        const own = await rest(token, `${table}?request_id=eq.${id}`), foreign = await rest(secondToken, `${table}?request_id=eq.${id}`);
        check(own.status === 200 && foreign.status === 200 && (await foreign.json()).length === 0 && (await second.page.request.get(url)).status() === 404,
          `Actual Auth and PostgREST restrict private ${name} history to its household.`); assert.deepEqual(await own.json(), [original]);
        check((await rest(secondToken, `rpc/parent_save_${program}_application_details`, { p_request_id: id, p_expected_version: original.request_version,
          p_details: original.details, p_notice_version: notice, p_idempotency_key: randomUUID(), p_subject_authority_declared: true, p_account_authority_declared: true })).status === 403,
        `Another actual household cannot correct private ${name} answers.`);
        await showSection(first.page, "application-review"); await first.page.getByRole("button", { name: `Correct ${name} answers`, exact: true }).waitFor(); await checkPage("review");
        await first.page.getByRole("button", { name: `Correct ${name} answers`, exact: true }).click();
        const form = first.page.getByRole("form", { name: `Correct ${name} application answers`, exact: true });
        check(await form.getByRole("checkbox").count() === 0, `The actual ${name} editor reuses saved answers without another permission checkbox.`);
        await form.getByLabel(program === "pgw" ? "PGW service street address" : "Water property address", { exact: true }).fill(program === "pgw" ? "401 Synthetic Utility Lane" : "501 Synthetic Utility Lane, Philadelphia PA 19147");
        await checkPage("correction");

        stage = `actual uncertain ${name} save and exact reconciliation`;
        const locker = new Client({ connectionString: local.DB_URL, connectionTimeoutMillis: 1000, statement_timeout: 2000, idle_in_transaction_session_timeout: 3000 });
        let lockFailed = false;
        locker.on("error", () => { lockFailed = true; });
        let pendingRequest: BrowserRequest | undefined;
        try {
          await locker.connect(); await locker.query("begin"); await locker.query("select id from public.parent_requests where id=$1 for update", [id]);
          const requested = first.page.waitForRequest(request => request.url() === url && request.method() === "POST");
          void requested.catch(() => {}); // The awaited UI action can fail before this observation finishes.
          await form.getByRole("button", { name: `Save ${name} changes`, exact: true }).click(); pendingRequest = await requested;
          let waiting = false;
          for (let probe = 0; probe < 24 && !waiting; probe++) {
            waiting = (await db.query("select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like $1) waiting", [`%parent_save_${program}_application_details%`])).rows[0].waiting;
            if (!waiting) await delay(25);
          }
          check(waiting && !lockFailed, `The actual ${name} private write reaches PostgreSQL before the browser loses its save result.`);
          await first.page.clock.setSystemTime(new Date(Date.parse(authorization.expiresAt) + 1000));
          await first.page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await first.page.getByText(/Your unsaved draft remains on this page/).waitFor({ timeout: 1000 });
        } finally {
          await locker.query("rollback").catch(() => {}); await locker.end().catch(() => {});
          await first.page.clock.setSystemTime(new Date()); await first.page.evaluate(() => window.dispatchEvent(new Event("focus")));
        }
        check(pendingRequest, `The actual ${name} uncertain attempt retains its exact body and idempotency key.`);
        const uncertainBody = pendingRequest.postData(), uncertainKey = pendingRequest.headers()["idempotency-key"];
        check(uncertainBody && /^[0-9a-f-]{36}$/.test(uncertainKey), `The actual ${name} uncertain write has a body and request-specific key.`);
        let committed = false;
        for (let probe = 0; probe < 30 && !committed; probe++) {
          committed = (await db.query(`select exists(select 1 from public.${table} where request_id=$1 and idempotency_key=$2) stored`, [id, uncertainKey])).rows[0].stored;
          if (!committed) await delay(50);
        }
        check(committed, `The real ${name} write commits while the browser's acknowledgement remains unknown.`);
        await first.page.getByText(program === "pgw" ? /Your private PGW CRP answers are saved as a new revision/ : /Your private water assistance answers are saved as a new revision/).waitFor({ timeout: 15000 });
        check(await first.page.getByRole("button", { name: `Load latest saved ${name} answers`, exact: true }).count() === 0 && await form.count() === 0,
          `The actual ${name} browser automatically recognizes its exact committed revision from the latest owned GET without another click.`);
        const retried = await first.page.request.post(url, { headers: { origin, "content-type": "application/json", "Idempotency-Key": uncertainKey }, data: uncertainBody! });
        check(retried.status() === 201,
          `The actual ${name} API reconciles the same captured uncertain body and idempotency key without creating a second revision.`);
        const corrected = await read(); check(corrected.revision === 2, `The actual ${name} uncertain retry creates exactly one new immutable revision.`);
        assert.deepEqual(await read(original.id), original);
        const changedPath = program === "pgw" ? "address.street" : "propertyAddress";
        assert.deepEqual({ ...corrected.provenance, [changedPath]: original.provenance[changedPath] }, original.provenance);
        await first.page.reload({ waitUntil: "networkidle" }); await showSection(first.page, "application-review");
        await first.page.getByRole("button", { name: `Correct ${name} answers`, exact: true }).click();
        await form.getByLabel(program === "pgw" ? "PGW account number" : "Daytime phone number", { exact: true }).fill(program === "pgw" ? "FICT-AUTH-PGW-02" : "215-555-0102");
        const savingAgain = first.page.waitForResponse(response => response.url() === url && response.request().method() === "POST");
        void savingAgain.catch(() => {}); // The awaited UI action can fail before this observation finishes.
        await form.getByRole("button", { name: `Save ${name} changes`, exact: true }).click(); check((await savingAgain).status() === 201, `The actual ${name} editor saves the next exact in-scope correction.`);
        const next = await read(), beforeStale = await state();
        check((await first.page.request.post(url, { headers: { origin, "content-type": "application/json", "Idempotency-Key": uncertainKey }, data: uncertainBody! })).status() === 409,
          `The actual ${name} API refuses a superseded uncertain attempt after a later correction.`); assert.deepEqual(await state(), beforeStale);
        await first.page.reload({ waitUntil: "networkidle" }); await showSection(first.page, "application-controls");
        const pausing = first.page.waitForResponse(response => response.url() === `${origin}/api/parent/requests/${id}` && response.request().method() === "POST");
        void pausing.catch(() => {}); // The awaited UI action can fail before this observation finishes.
        await first.page.getByRole("button", { name: "Pause future work", exact: true }).click(); check((await pausing).status() === 200, `The actual ${name} request pauses through its owned control.`);
        await first.page.getByRole("button", { name: "Resume support", exact: true }).waitFor(); await showSection(first.page, "application-review");
        await first.page.getByRole("button", { name: `Correct ${name} answers`, exact: true }).click();
        check(await form.getByRole("checkbox").count() === 0, `Paused ${name} correction requires no repeated approval checkbox.`);
        await form.getByLabel(program === "pgw" ? "PGW contact phone" : "Daytime phone number", { exact: true }).fill("215-555-0103");
        const pausedSaving = first.page.waitForResponse(response => response.url() === url && response.request().method() === "POST");
        void pausedSaving.catch(() => {}); // The awaited UI action can fail before this observation finishes.
        await form.getByRole("button", { name: `Save ${name} changes`, exact: true }).click(); check((await pausedSaving).status() === 201, `The actual paused ${name} editor saves without resuming work.`);
        const paused = await read(), finalState = await state();
        check(paused.revision === 4 && finalState.request.status === "paused" && finalState.job.state === "cancelled" && finalState.operations === 0 && finalState.model_calls === 0,
          `The final ${name} request stays paused without a model call, provider operation or enrollment claim.`);
        const upload = await first.page.request.post(`${origin}/api/parent/requests/${id}/documents`, { headers: { origin }, multipart: { consent: "1", file: { name: `synthetic-${program}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-SYNTHETIC") } } });
        const documents = (await db.query(`select (select count(*)::int from public.parent_documents where request_id=$1) documents,
          (select count(*)::int from storage.objects where bucket_id='parent-documents' and name like $2) objects`, [id, `${first.id}/${id}/%`])).rows[0];
        check(upload.status() === 403 && documents.documents === 0 && documents.objects === 0, `The real ordinary ${name} upload path creates no private document metadata or Storage objects.`);
        await db.query(`update parent_private.processing_controls set ${control}_enabled=false where singleton`); assert.deepEqual(await read(), paused);
        check((await first.page.request.post(url, { headers: { origin, "Idempotency-Key": randomUUID() }, data: { expectedVersion: finalState.request.version, details: paused.details, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true } })).status() === 403,
          `Closing only ${name} collection blocks writes while keeping owned history.`);
        const exported = await first.page.request.get(`${origin}/api/parent/account/export`), exportBody = await exported.json();
        check(exported.status() === 200 && exported.headers()["cache-control"] === "private, no-store", `The real ${name} owner export remains private after collection closes.`);
        const history = exportBody.requests.find((request: { id: string }) => request.id === id)?.[`${program}ApplicationDetails`];
        check(history?.length === 4, `The actual owner export contains every original and corrected ${name} revision.`);
        for (const revision of [original, corrected, next, paused]) assert.deepEqual(history.find((row: { id: string }) => row.id === revision.id), revision);
        check(!(await (await second.page.request.get(`${origin}/api/parent/account/export`)).text()).includes(id), `Another actual household's export excludes ${name} private history.`);
        await first.page.reload({ waitUntil: "networkidle" }); await showSection(first.page, "application-review");
        check(await first.page.getByRole("button", { name: `Correct ${name} answers`, exact: true }).count() === 0, `The real closed ${name} purpose offers no private editor.`); await checkPage("closed-history");
      } finally {
        await db.query(`update parent_private.processing_controls c set (${control}_enabled,${control}_approval_reference,${control}_approved_until,${control}_notice_version)=
          (select r.${control}_enabled,r.${control}_approval_reference,r.${control}_approved_until,r.${control}_notice_version from jsonb_populate_record(null::parent_private.processing_controls,$1::jsonb) r) where singleton`, [JSON.stringify(controls)]);
        assert.deepEqual((await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value, controls);
        check((await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n === budget,
          `All four ${name} purpose controls and the entire control row are restored exactly without a model-budget change.`);
        await first.page.clock.setSystemTime(new Date());
      }
    }

    stage = "actual browser sign-out and retained-token denial";
    await first.page.goto(`${origin}/account`, { waitUntil: "networkidle" });
    await first.page
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await first.page.waitForURL(`${origin}/sign-in`);
    check(
      (
        await first.page.request.get(`${origin}/api/parent/account`)
      ).status() === 401,
      "Signing out through the actual account UI removes interactive account access.",
    );
    check(
      (await rest(token, "rpc/parent_ensure_account", {})).status === 403,
      "An unexpired retained JWT cannot restore a revoked actual parent session.",
    );
    check(
      (
        await db.query(
          "select parent_private.current_grant(r.id,r.version) allowed from public.parent_requests r where r.id=$1",
          [requestId],
        )
      ).rows[0].allowed === true,
      "Normal sign-out preserves only the recorded bounded service mandate.",
    );

    stage = "actual legacy password identity and independent parent household";
    previousExistingAccounts = (
      await db.query(
        "select existing_accounts_enabled from parent_private.processing_controls where singleton",
      )
    ).rows[0].existing_accounts_enabled;
    await db.query(
      "update parent_private.processing_controls set existing_accounts_enabled=true where singleton",
    );
    const password = `Local-only-${randomUUID()}-Aa9!`;
    const legacy = await operator.auth.admin.createUser({
      email: emails[2],
      password,
      email_confirm: true,
    });
    check(
      !legacy.error && legacy.data.user,
      "A disposable verified legacy identity is created only in the isolated parent Auth service.",
    );
    const legacyId = legacy.data.user.id;
    await db.query(
      "insert into public.app_users(id,email,role,is_active) values($1,$2,'case_manager',true)",
      [legacyId, emails[2]],
    );
    await db.query(
      "insert into public.families(name,created_by_id) values('Synthetic existing school family',$1)",
      [legacyId],
    );
    const legacyContext = await browser.newContext({
      baseURL: origin,
      reducedMotion: "reduce",
    });
    contexts.push(legacyContext);
    const legacyPage = await legacyContext.newPage();
    await legacyPage.goto(`${origin}/sign-in`, { waitUntil: "networkidle" });
    await legacyPage.getByLabel("Your email address").fill(emails[2]);
    await legacyPage
      .getByLabel("Password", { exact: true })
      .fill(`${password}-incorrect`);
    const wrongPassword = legacyPage.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/auth` &&
        response.request().method() === "POST",
    );
    await legacyPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    check(
      (await wrongPassword).status() === 400,
      "The actual existing-account UI rejects an incorrect legacy password.",
    );
    await legacyPage.getByLabel("Password", { exact: true }).fill(password);
    const signedIn = legacyPage.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/auth` &&
        response.request().method() === "POST",
    );
    await legacyPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    check(
      (await signedIn).status() === 200,
      "The actual existing-account UI accepts the same verified legacy identity and password.",
    );
    await legacyPage.waitForURL(`${origin}/my-support`);
    const legacyToken = await accessToken(legacyContext);
    const legacyHousehold = (
      await db.query(
        "select (select count(*)::int from public.parent_households where owner_id=$1) households,(select count(*)::int from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=$1) requests,(select count(*)::int from public.families where created_by_id=$1) school_families",
        [legacyId],
      )
    ).rows[0];
    check(
      legacyHousehold.households === 1 &&
        legacyHousehold.requests === 0 &&
        legacyHousehold.school_families === 1,
      "Reusing a real Auth identity creates one independent parent household and preserves its separate school family.",
    );
    const legacyHidden = await rest(
      legacyToken,
      `parent_requests?select=id&id=eq.${requestId}`,
    );
    check(
      legacyHidden.status === 200 && (await legacyHidden.json()).length === 0,
      "The actual legacy school role inherits no access to another parent's request.",
    );
    const legacyRequest = await startFoodRequest(legacyPage);
    const otpClient = createClient(local.API_URL, local.ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: fetchWithTimeout },
    });
    const legacyCodeSent = await otpClient.auth.signInWithOtp({
      email: emails[2],
      options: { shouldCreateUser: false },
    });
    check(
      !legacyCodeSent.error,
      "Actual Auth can deliver a code to the synthetic legacy identity for the bypass check.",
    );
    const legacyCode = await deliveredCode(emails[2]);
    const legacyOtp = await otpClient.auth.verifyOtp({
      email: emails[2],
      token: legacyCode,
      type: "email",
    });
    check(
      !legacyOtp.error && legacyOtp.data.session,
      "The legacy bypass test uses a genuine live OTP session from actual Auth.",
    );
    check(
      (
        await rest(
          legacyOtp.data.session.access_token,
          "rpc/parent_ensure_account",
          {},
        )
      ).status === 403,
      "A genuine legacy OTP session cannot bypass the password-method requirement through the Data API.",
    );
    await otpClient.auth.signOut({ scope: "local" });
    await db.query("update public.app_users set is_active=false where id=$1", [
      legacyId,
    ]);
    check(
      (
        await legacyPage.request.get(`${origin}/api/parent/account`)
      ).status() === 401,
      "Deactivating an existing account immediately denies its actual interactive parent session.",
    );
    check(
      (await rest(legacyToken, "rpc/parent_ensure_account", {})).status === 403,
      "Deactivating an existing account denies its retained password token through the actual Data API.",
    );
    check(
      (
        await db.query(
          "select parent_private.current_grant(id,version) allowed from public.parent_requests where id=$1",
          [legacyRequest],
        )
      ).rows[0].allowed === false,
      "Deactivating a shared identity stops its already recorded durable parent mandate.",
    );
  } finally {
    try {
      if (previousExistingAccounts !== undefined)
        await db.query(
          "update parent_private.processing_controls set existing_accounts_enabled=$1 where singleton",
          [previousExistingAccounts],
        );
      for (const context of contexts) await context.close();
      await browser.close();
      // Only this run's disposable synthetic identities are erased; no production account is accepted.
      const identities = (
        await db.query(
          "select id from auth.users where email=any($1::text[])",
          [emails],
        )
      ).rows;
      await db.query(
        "delete from public.families where created_by_id=any($1::uuid[])",
        [identities.map((identity) => identity.id)],
      );
      const objects = (
        await db.query(
          "select d.object_path from public.parent_documents d join public.parent_requests r on r.id=d.request_id join public.parent_households h on h.id=r.household_id where h.owner_id=any($1::uuid[])",
          [identities.map((identity) => identity.id)],
        )
      ).rows;
      if (objects.length) {
        const removed = await operator.storage
          .from("parent-documents")
          .remove(objects.map((object) => object.object_path));
        check(
          !removed.error,
          "This run's synthetic private PDF objects are erased during fixture cleanup.",
        );
      }
      for (const identity of identities) {
        const deleted = await operator.auth.admin.deleteUser(identity.id);
        check(
          !deleted.error,
          "Disposable synthetic Auth identities and cascaded parent fixture records are cleaned up.",
        );
      }
    } finally {
      try { await fixtureApproval?.restore(); }
      finally { await db.end(); }
    }
  }
  const result = {
    checkedAt: new Date().toISOString(),
    mode: "actual-local-auth-browser-data-api",
    apiInterception: false,
    origin,
    services: { auth: "55321", database: "55322", email: "55324" },
    assertions: [...new Set(checks)],
    rateLimitObserved,
    snapAccessibility,
    wicAccessibility,
    pecoAccessibility,
    utilityAccessibility,
    limitations: [
      "Loopback HTTP cannot establish hosted Secure-cookie, domain, SMTP or redirect-allowlist behavior.",
      "Hosted shared-account migration, recovery/session coexistence and scheduled retention erasure require separate checks; the password case uses a synthetic school role only on the isolated parent service.",
      "Document parsing/extraction is not established by private PDF upload and Storage authorization.",
      "Grouped factual questions are explicitly seeded synthetic fixtures; the test does not establish AI question selection or partner execution.",
      "The public food lifecycle uses actual local Auth/API/SQL and a restricted worker, with an explicit City-response fixture and synthetic family reports. It does not establish current stock, physical access, actual collection or provider confirmation.",
      "The full SNAP form check establishes owned nonprotected intake, atomic start, revision correction and export, not protected identifiers/signatures, worker preparation or a genuine provider submission.",
      "The WIC form check establishes isolated private intake, correction and owned history, not provider submission, a booked appointment, enrollment or specialist assessment.",
      "The PECO form check establishes isolated private preparation, correction, account binding and owned history, not a trusted renderer/income adapter, provider submission, CAP enrollment, a payment change or shutoff protection.",
      "PGW and water form checks establish owned private preparation, real interrupted-save reconciliation and immutable corrections/exports. They do not establish protected identifier insertion, validated proof assembly, signatures, financial assent, agency submission, enrollment or shutoff protection; water still uses a public sample reference, not an account-issued form.",
      "Optional-description checks use eight in-process synthetic Responses exchanges and visibly synthetic agency-evidence rows with actual local Auth/HTTP/SQL; they do not evaluate model quality, processor retention or real agency status. Expiry uses only owned synthetic timestamp fixtures, not49 hours of elapsed time.",
      "No external application or model provider was called.",
    ],
  };
  mkdirSync("tmp/parent-verification/actual-auth", { recursive: true });
  writeFileSync(
    "tmp/parent-verification/actual-auth/results.json",
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(
    `Actual local parent Auth passed (${result.assertions.length} assertions; rate limit ${rateLimitObserved ? "observed" : "not observed by one bounded probe"}).\n`,
  );
}

void main().catch((error: unknown) => {
  mkdirSync("tmp/parent-verification/actual-auth", { recursive: true });
  writeFileSync("tmp/parent-verification/actual-auth/failure.json", `${JSON.stringify({
    checkedAt: new Date().toISOString(), mode: "actual-local-auth-browser-data-api", apiInterception: false,
    failedStage: stage, completedAssertions: [...new Set(checks)],
  }, null, 2)}\n`);
  const assertion =
    error instanceof assert.AssertionError ? ` ${error.message}` : "";
  const browserFailure =
    error instanceof Error && /^(locator\.|page\.)/.test(error.message)
      ? ` ${error.message.split("\n")[0]}`
      : "";
  process.stderr.write(
    `Actual parent Auth verification failed during ${stage}.${assertion}${browserFailure} No credential values were logged.\n`,
  );
  process.exitCode = 1;
});
