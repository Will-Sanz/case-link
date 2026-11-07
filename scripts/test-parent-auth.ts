/** Actual local Auth, email, browser and Data API checks. No API interception or remote targets. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type BrowserContext, type Page, type Request as BrowserRequest } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { PDFDocument } from "pdf-lib";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";
import { SNAP_APPLICATION_NOTICE_VERSION } from "../src/lib/parent/constants";
import { assessSnapApplicationFields, SNAP_APPLICATION_SOURCE } from "../src/lib/parent/snap-application-fields";
import { assessSnapApplicationSnapshot, snapApplicationSnapshotSchema, type SnapApplicationSnapshot } from "../src/lib/parent/snap-application-snapshot";

const origin = process.env.PARENT_TEST_ORIGIN ?? "http://127.0.0.1:3200";
const checks: string[] = [];
const snapAccessibility: { state: string; width: number; height: number; screenshot: string; overflow: boolean; violations: string[] }[] = [];
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
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
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
  const emails = [0, 1, 2].map(
    () => `parent-auth-${randomUUID()}@example.test`,
  );
  const seenMail = new Set<string>();
  let rateLimitObserved = false;
  let previousExistingAccounts: boolean | undefined;

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
  async function startFoodRequest(page: Page) {
    await page.goto(`${origin}/get-support?need=food`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("link", { name: "Ask CaseLink for food-access support" }).click();
    await page.getByLabel("Household ZIP code").fill("19104");
    await page.getByRole("checkbox", { name: /I’m 18 or older/ }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
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
    const id = (await start.json()).request.id as string;
    await page.waitForURL(`${origin}/support/${id}`);
    return id;
  }

  try {
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
    check(
      (await first.page.request.post(requestUrl, { headers: { origin }, data: bundleBody! })).status() === 409,
      "Replaying the completed browser bundle's old version is rejected by the actual web API.",
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
      headers: { origin },
      multipart: { consent: "0", file },
    });
    check(
      noConsent.status() === 400,
      "Actual document upload refuses missing processing consent.",
    );
    await first.page.goto(`${origin}/support/${requestId}`, {
      waitUntil: "networkidle",
    });
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

    stage = "actual outcome, preferences, exports and cancellation controls";
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
      await first.page.getByRole("button", { name: "Correct application answers" }).waitFor();
      await checkSnapPage("review");
      const snapUrl = `${origin}/api/parent/requests/${snapRequestId}/snap-application`;
      const readSnap = async (revision?: string) => {
        const response = await first.page.request.get(`${snapUrl}${revision ? `?revision=${revision}` : ""}`);
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
      const snapState = async () => (await db.query(`select to_jsonb(r) request,to_jsonb(j) job,
        (select jsonb_agg(to_jsonb(d) order by d.revision) from public.parent_snap_application_details d where d.request_id=r.id) snapshots,
        (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') from public.parent_events e where e.request_id=r.id) events,
        (select count(*)::int from public.parent_operations o where o.request_id=r.id) operations,
        (select count(*)::int from parent_private.ai_calls a where a.request_id=r.id) model_calls
        from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1`, [snapRequestId])).rows[0];
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
      await first.page.getByRole("button", { name: "Answer SNAP application questions" }).click();
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
        (snap_details_enabled,snap_details_approval_reference,snap_details_approved_until,snap_details_notice_version)=
        (select r.snap_details_enabled,r.snap_details_approval_reference,r.snap_details_approved_until,r.snap_details_notice_version
        from jsonb_populate_record(null::parent_private.processing_controls,$1::jsonb) r) where singleton`, [JSON.stringify(snapControls)]);
      assert.deepEqual((await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value, snapControls);
      check((await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n === snapBudgetBefore,
        "All four SNAP-purpose controls are restored exactly and model-budget reservations are unchanged.");
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
      await db.end();
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
    limitations: [
      "Loopback HTTP cannot establish hosted Secure-cookie, domain, SMTP or redirect-allowlist behavior.",
      "Hosted shared-account migration, recovery/session coexistence and scheduled retention erasure require separate checks; the password case uses a synthetic school role only on the isolated parent service.",
      "Document parsing/extraction is not established by private PDF upload and Storage authorization.",
      "Grouped factual questions are explicitly seeded synthetic fixtures; the test does not establish AI question selection or partner execution.",
      "The full SNAP form check establishes owned nonprotected intake, atomic start, revision correction and export, not protected identifiers/signatures, worker preparation or a genuine provider submission.",
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
