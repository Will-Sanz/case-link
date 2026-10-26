/** Actual local Auth, email, browser and Data API checks. No API interception or remote targets. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { PDFDocument } from "pdf-lib";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";

const origin = "http://127.0.0.1:3200";
const checks: string[] = [];
let stage = "local service configuration";
function check(condition: unknown, label: string): asserts condition {
  assert.ok(condition, label);
  checks.push(label);
}

async function main() {
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
    await page.getByRole("checkbox", { name: /Food for now/ }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
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
    limitations: [
      "Loopback HTTP cannot establish hosted Secure-cookie, domain, SMTP or redirect-allowlist behavior.",
      "Hosted shared-account migration, recovery/session coexistence and scheduled retention erasure require separate checks; the password case uses a synthetic school role only on the isolated parent service.",
      "Document parsing/extraction is not established by private PDF upload and Storage authorization.",
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
