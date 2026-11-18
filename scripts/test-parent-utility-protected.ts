/** Actual isolated Auth, Vault, private HTTP and headless private-page checks. TEST DATA only; no provider/model calls. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServerClient } from "@supabase/ssr";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Client } from "pg";
import { withParentBrowserFixtures } from "./parent-browser-test-fixture";
import { fixtureIntake, fixtureMandate } from "../src/lib/parent/test-fixtures";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";
import { PECO_APPLICATION_NOTICE_VERSION } from "../src/lib/parent/peco-application-fields";
import { PGW_APPLICATION_NOTICE_VERSION } from "../src/lib/parent/pgw-application-fields";
import { WATER_APPLICATION_NOTICE_VERSION } from "../src/lib/parent/water-application-fields";
import { createLocalParentProtectedFrontdoor } from "../src/lib/parent/protected-frontdoor";
import { createUtilityProtectedHandler } from "../src/lib/parent/utility-protected-service";
import { storeUtilityProtectedInput } from "../src/lib/parent/utility-protected-client";
import { validateStoredUtilityIncomeProof } from "../src/lib/parent/utility-protected-preparation";
import { renderUtilityProtectedPage } from "../src/lib/parent/utility-protected-page";
import { UTILITY_INCOME_PROOF_VERSION } from "../src/lib/parent/utility-income-proof";
import { UTILITY_PROTECTED_INPUT_NOTICE_VERSION, utilityProtectedInputReferenceSchema, utilityProtectedWorkspaceSchema, type UtilityProtectedWorkspace } from "../src/lib/parent/utility-protected-input-contract";

const checks: string[] = [], accessibility: { state: string; width: number; overflow: boolean; violations: string[]; screenshot: string }[] = [];
let stage = "checking local protected utility prerequisites";
function check(value: unknown, label: string): asserts value { assert.ok(value, label); checks.push(label); }
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`;
}
async function close(server?: Server) { if (!server) return; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
async function waitFor<T>(action: () => Promise<T>, ready: (value: T) => boolean, label: string): Promise<T> {
  for (let count = 0; count < 120; count++) { const value = await action(); if (ready(value)) return value; await delay(100); }
  throw new Error(label);
}

async function main() {
  const appOrigin = process.env.PARENT_TEST_ORIGIN ?? "http://127.0.0.1:3200", app = new URL(appOrigin);
  check(app.origin === appOrigin && app.protocol === "http:" && app.hostname === "127.0.0.1" && Number(app.port) >= 1024 && !app.username && !app.password, "The ordinary application target is canonical loopback HTTP only.");
  const browser = await chromium.launch({ headless: true });
  try {
    await withParentBrowserFixtures(check, value => { stage = value; }, async ({ local, db, fixtures, approvedUntil }) => {
      const ready = (await db.query("select to_regclass('parent_private.utility_protected_inputs') is not null and to_regprocedure('public.parent_get_utility_protected_workspace(uuid,integer)') is not null ready")).rows[0].ready;
      check(ready, "Reviewed protected utility migration must already be installed on the isolated local database.");
      check((await db.query("select count(*)::int n from parent_private.worker_health where expires_at>clock_timestamp() and (planning_ready or assistant_ready)")).rows[0].n === 0, "No healthy model/service worker may overlap this synthetic capture test.");
      check((await db.query("select count(*)::int n from parent_private.provider_capabilities where enabled and transport_verified")).rows[0].n === 0, "No enabled provider transport may overlap this test.");
      const controls = (await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value as Record<string, unknown>;
      const policies = (await db.query("select to_jsonb(p) value from parent_private.utility_protected_policies p order by program_id")).rows.map(row => row.value as Record<string, unknown>);
      check(policies.length === 3 && policies.every(row => row.enabled === false), "Every protected utility purpose starts closed independently of SNAP and WIC.");
      check((await db.query("select (select count(*) from parent_private.utility_protected_inputs)+(select count(*) from parent_private.utility_protected_account_keys) n")).rows[0].n === "0", "No other protected utility capture may share this native retention rehearsal.");
      const reservations = (await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
      const vaultBefore = (await db.query("select count(*)::int n from vault.secrets")).rows[0].n;
      const login = `caselink_utility_test_${randomBytes(8).toString("hex")}`, password = randomBytes(32).toString("base64url");
      const probeLogin = `caselink_utility_probe_${randomBytes(8).toString("hex")}`, probePassword = randomBytes(32).toString("base64url");
      const dbUrl = new URL(process.env.CASELINK_PARENT_DB_TEST_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres");
      check(dbUrl.hostname === "127.0.0.1" && dbUrl.port === "55322" && dbUrl.pathname === "/postgres", "The private credential is created only for local port55322.");
      dbUrl.username = login; dbUrl.password = password;
      const probeUrl = new URL(dbUrl); probeUrl.username = probeLogin; probeUrl.password = probePassword;
      let roleCreated = false, probeCreated = false, privateServer: Server | undefined, frontdoor: Server | undefined, origin = "", handler: ((request: Request) => Promise<Response>) | undefined;
      let dropNextPutResponse = false;
      const contexts: BrowserContext[] = [];
      const output = resolve("tmp/parent-verification/utility-protected"); mkdirSync(output, { recursive: true });
      const fixtureOwner = fixtures[0], foreignOwner = fixtures[1], subjectId = randomUUID(), sourceId = randomUUID();
      let requestId = "", scope: NonNullable<UtilityProtectedWorkspace["scope"]> | undefined;
      const safeRefs = async () => { const reply = await fixtureOwner.client.rpc("parent_get_utility_protected_inputs", { p_request_id: requestId }); check(!reply.error, "The owner can read opaque protected references."); return utilityProtectedInputReferenceSchema.array().parse(reply.data); };
      try {
        await db.query(`create role ${identifier(login)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password ${literal(password)} valid until ${literal(approvedUntil)}`); roleCreated = true;
        await db.query(`grant parent_utility_protected to ${identifier(login)} with admin false,inherit false,set true`);
        await db.query(`create role ${identifier(probeLogin)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication connection limit 1 password ${literal(probePassword)} valid until ${literal(approvedUntil)}`); probeCreated = true;
        await db.query("update parent_private.processing_controls set peco_details_enabled=true,peco_details_approval_reference='test data only; isolated utility capture',peco_details_approved_until=$1,peco_details_notice_version=$2 where singleton", [approvedUntil, PECO_APPLICATION_NOTICE_VERSION]);
        const details = { accountNumber: "9000000001", applicant: { id: subjectId, firstName: "Synthetic", lastName: "Parent", dateOfBirth: "1990-01-01", income: { state: "sources", sources: [{ id: sourceId, kind: "employment" }] } }, address: { street: "1 Synthetic Lane", city: "Philadelphia", state: "PA", zip: "19147" } };
        const started = await fixtureOwner.client.rpc("parent_start_peco_application", { p_intake: fixtureIntake({ needs: ["electricity"], householdSize: null, utilityProviders: ["peco"], accountAuthority: "self" }),
          p_mandate: fixtureMandate({ mode: "prepare_only", recipientIds: ["peco-cap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility", "documents"], expiresAt: approvedUntil }),
          p_details: details, p_notice_version: PECO_APPLICATION_NOTICE_VERSION, p_idempotency_key: randomUUID(), p_subject_authority_declared: true, p_account_authority_declared: true });
        check(!started.error && typeof started.data === "string", "Real owned RPC atomically starts the document-scoped synthetic PECO private application."); requestId = started.data;
        const getWorkspace = async (version = 2) => { const reply = await fixtureOwner.client.rpc("parent_get_utility_protected_workspace", { p_request_id: requestId, p_expected_version: version }); check(!reply.error, "The actual owner-only workspace RPC responds."); return utilityProtectedWorkspaceSchema.parse(reply.data); };
        check(!(await getWorkspace()).collectionEnabled, "Enabling private application details does not open protected proof capture.");
        await db.query("update parent_private.utility_protected_policies set enabled=true,approval_reference='synthetic local utility proof test only',approved_until=$1,policy_version='synthetic-utility-1',retention_policy_version='synthetic-utility-1',max_retention_seconds=300,allowed_purposes=array['income_proof'],validator_versions=array[$2] where program_id='peco-cap'", [approvedUntil, UTILITY_INCOME_PROOF_VERSION]);
        const workspace = await getWorkspace(); check(workspace.collectionEnabled && workspace.scope && workspace.targets.length === 1, "Only the exact authorized employment-proof target is available."); scope = workspace.scope;

        privateServer = createServer({ maxHeaderSize: 16384 }, async (incoming, outgoing) => {
          const controller = new AbortController(), timer = setTimeout(() => { controller.abort(); outgoing.destroy(); }, 30000); let replyBytes: Uint8Array | undefined;
          incoming.once("aborted", () => controller.abort()); outgoing.once("close", () => { clearTimeout(timer); if (!outgoing.writableFinished) controller.abort(); replyBytes?.fill(0); });
          try {
            if (!handler || !["127.0.0.1", "::ffff:127.0.0.1"].includes(incoming.socket.remoteAddress ?? "")) { outgoing.writeHead(403); outgoing.end(); return; }
            const headers = new Headers(); for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
            const init: RequestInit & { duplex?: "half" } = { method: incoming.method, headers, signal: controller.signal,
              ...(["POST", "PUT", "DELETE"].includes(incoming.method ?? "") ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" as const } : {}) };
            const result = await handler(new Request(origin + incoming.url, init));
            if (dropNextPutResponse && incoming.method === "PUT" && result.status === 201) { dropNextPutResponse = false; outgoing.writeHead(503, { "Cache-Control": "private, no-store" }); outgoing.end("Synthetic acknowledgement unavailable after storage."); return; }
            const responseHeaders: Record<string, string | string[]> = Object.fromEntries([...result.headers].filter(([key]) => key !== "set-cookie"));
            const rotated = result.headers.getSetCookie(); if (rotated.length) responseHeaders["set-cookie"] = rotated;
            outgoing.writeHead(result.status, responseHeaders); replyBytes = new Uint8Array(await result.arrayBuffer()); outgoing.end(replyBytes, () => replyBytes?.fill(0));
          } catch { if (!outgoing.headersSent && !outgoing.destroyed) { outgoing.writeHead(503, { "Cache-Control": "private, no-store" }); outgoing.end("Synthetic private service unavailable."); } else outgoing.destroy(); }
          finally { clearTimeout(timer); }
        });
        const privateOrigin = await listen(privateServer); frontdoor = createLocalParentProtectedFrontdoor(appOrigin, privateOrigin); origin = await listen(frontdoor);
        handler = createUtilityProtectedHandler({ publicOrigin: origin, supabaseOrigin: local.API_URL, supabasePublicKey: local.ANON_KEY, utilityDatabaseUrl: dbUrl.toString() }, { workspace: renderUtilityProtectedPage, validate: validateStoredUtilityIncomeProof });
        async function ownerContext(fixture: typeof fixtureOwner) {
          const cookieValues: { name: string; value: string; options?: Record<string, unknown> }[] = [];
          const session = await fixture.client.auth.getSession(); check(session.data.session, "The actual fixture session is available only in memory.");
          const client = createServerClient(local.API_URL, local.ANON_KEY, { cookieOptions: { name: "caselink-parent-auth", httpOnly: true, sameSite: "lax", secure: false, path: "/" },
            cookies: { getAll: () => [], setAll: values => { cookieValues.push(...values); } }, global: { fetch: fetchWithTimeout } });
          const signed = await client.auth.setSession({ access_token: session.data.session.access_token, refresh_token: session.data.session.refresh_token }); check(!signed.error, "Existing actual Auth session is transferred through the real cookie codec.");
          const context = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" }); contexts.push(context);
          await context.addCookies(cookieValues.map(cookie => ({ name: cookie.name, value: cookie.value, url: origin, httpOnly: true, sameSite: "Lax", secure: false })));
          check((await context.cookies()).every(cookie => cookie.httpOnly && cookie.sameSite === "Lax"), "Private-page session cookies are HttpOnly and SameSite=Lax."); return context;
        }
        const owner = await ownerContext(fixtureOwner), foreign = await ownerContext(foreignOwner), page = await owner.newPage();
        const privateRequests: string[] = [], outsideOrigins = new Set<string>();
        page.on("request", request => { const target = new URL(request.url()); if (target.origin !== origin) outsideOrigins.add(target.origin); privateRequests.push(target.pathname); });
        const workspacePath = `/protected/utilities/requests/${requestId}/workspace?expectedVersion=2`;
        stage = "loading the actual consent-gated private page";
        await page.goto(origin + workspacePath, { waitUntil: "networkidle" });
        check((await page.locator('script[src*="/_next"]').count()) === 0, "The private page does not load the Next application bundle.");
        await page.locator("#protected-purpose").selectOption("income_proof"); await page.locator("#protected-target").selectOption("0");
        check(await page.locator("#protected-file").isDisabled(), "Raw file controls stay disabled before understandable document consent.");
        await page.locator("#protected-consent").check(); check(await page.locator("#protected-file").isEnabled(), "One informed consent enables only the selected exact proof target.");
        const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), sheet = pdf.addPage();
        ["SYNTHETIC PAY STUB", "Employee: Synthetic Parent", "Employer: Synthetic Works", "Gross Pay (USD): 1500.00", "Period Start: 2026-11-01", "Period End: 2026-11-07", "Issue Date: 2026-11-08", "Pay Frequency: weekly", "PRIVATE RAW CANARY: 123-45-6789"].forEach((line, index) => sheet.drawText(line, { x: 40, y: 760 - index * 24, size: 12, font }));
        const pdfBytes = Buffer.from(await pdf.save());
        await page.locator("#protected-file").setInputFiles({ name: "PRIVATE_FILENAME_MUST_NOT_BE_SENT.pdf", mimeType: "application/pdf", buffer: pdfBytes });
        stage = "saving and parsing a synthetic proof through the actual isolated service";
        await page.locator("#protected-save").click();
        const refs = await waitFor(safeRefs, refs => refs.some(ref => ref.state === "stored" && ref.validation !== null), "Actual isolated source validation did not finish.");
        const stored = refs.find(ref => ref.state === "stored" && ref.validation)!; check(stored.snapshotId === scope.snapshotId && stored.targets[0].sourceId === sourceId, "Actual UI capture stores an exact source/snapshot-bound opaque reference.");
        const checkedProjection = (await db.query("select projection from parent_private.utility_protected_validations where id=$1", [stored.validation!.id])).rows[0].projection;
        check(checkedProjection.version === UTILITY_INCOME_PROOF_VERSION && checkedProjection.subjectId === subjectId && checkedProjection.sourceId === sourceId && checkedProjection.grossCents === 150000 && checkedProjection.periodStart === "2026-11-01" && checkedProjection.periodEnd === "2026-11-07", "The actual trusted validator stores exact closed gross-income/source-period facts.");
        check(!/123-45-6789|PRIVATE RAW CANARY|Synthetic Parent|Employer:/.test(JSON.stringify(checkedProjection)), "The private projection excludes identifiers, names and raw document pages.");
        const cipher = (await db.query("select i.input_id,i.vault_secret_id,i.ciphertext,(v.secret is distinct from d.decrypted_secret) vault_encrypted from parent_private.utility_protected_inputs i join vault.secrets v on v.id=i.vault_secret_id join vault.decrypted_secrets d on d.id=v.id where i.input_id=$1", [stored.inputId])).rows[0];
        check(Buffer.isBuffer(cipher.ciphertext) && !cipher.ciphertext.includes(Buffer.from("123-45-6789")) && cipher.vault_encrypted, "Native document ciphertext excludes raw canaries and the actual Vault key is encrypted at rest.");
        for (const role of ["authenticated", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer", "parent_utility_protected"]) {
          const needsProbe = role.startsWith("parent_"), connection = needsProbe ? new Client({ connectionString: probeUrl.toString(), connectionTimeoutMillis: 3000, statement_timeout: 5000 }) : db;
          if (needsProbe) { await db.query(`grant ${identifier(role)} to ${identifier(probeLogin)} with admin false,inherit false,set true`); await connection.connect(); }
          let denied = false;
          try {
            await connection.query("begin"); await connection.query(`set local role ${identifier(role)}`);
            check((await connection.query("select current_user as role")).rows[0].role === role, `The native table-denial probe actually enters ${role}.`);
            try { await connection.query("select * from parent_private.utility_protected_inputs limit 1"); }
            catch (error) { denied = (error as { code?: string }).code === "42501"; }
          } finally {
            await connection.query("rollback");
            if (needsProbe) { await connection.end(); await db.query(`revoke ${identifier(role)} from ${identifier(probeLogin)}`); }
          }
          check(denied, `${role} cannot directly read private ciphertext or key references.`);
        }
        check((await db.query("select count(*)::int n from storage.objects where name like $1", [`%${stored.inputId}%`])).rows[0].n === 0, "Protected proofs never enter ordinary Supabase Storage.");
        stage = "checking native original privacy and stable retry";
        const original = await owner.request.get(`${origin}/protected/utilities/requests/${requestId}/inputs/${stored.inputId}/original?expectedVersion=2`);
        check(original.status() === 200 && (await original.body()).equals(pdfBytes) && original.headers()["content-disposition"].startsWith("attachment;"), "The actual owner privately downloads the exact original as an attachment.");
        const foreignRead = await foreign.request.get(`${origin}/protected/utilities/requests/${requestId}/inputs/${stored.inputId}/original?expectedVersion=2`); check(foreignRead.status() === 403, "Another real Auth household cannot read the original.");
        const replay = await owner.request.put(`${origin}/protected/utilities/requests/${requestId}/inputs/${stored.inputId}?expectedVersion=2`, { headers: { Origin: origin, "Content-Type": "application/pdf" }, data: pdfBytes });
        check(replay.status() === 201, "An identical actual upload retry reconciles the stored item.");
        const replayCipher = (await db.query("select vault_secret_id,ciphertext from parent_private.utility_protected_inputs where input_id=$1", [stored.inputId])).rows[0];
        check(replayCipher.vault_secret_id === cipher.vault_secret_id && replayCipher.ciphertext.equals(cipher.ciphertext), "Exact upload replay does not reseal, remint a key or extend storage.");
        const lostId = randomUUID(), authorization = { ...scope, inputId: lostId, purpose: "income_proof", targets: stored.targets, mediaType: "application/pdf", byteLength: pdfBytes.length,
          noticeVersion: UTILITY_PROTECTED_INPUT_NOTICE_VERSION, consentAccepted: true, subjectAuthorityDeclared: true, accountAuthorityDeclared: true };
        check((await owner.request.post(`${origin}/protected/utilities/requests/${requestId}/inputs?expectedVersion=2`, { headers: { Origin: origin }, data: authorization })).status() === 201, "An exact opaque intent is recorded before the network-loss rehearsal.");
        dropNextPutResponse = true; let lost = false;
        try { const result = await owner.request.put(`${origin}/protected/utilities/requests/${requestId}/inputs/${lostId}?expectedVersion=2`, { headers: { Origin: origin, "Content-Type": "application/pdf" }, data: pdfBytes }); lost = result.status() === 503; } catch { lost = true; }
        check(lost, "The native test withholds a successful acknowledgement after a real stored write, without mocking any API.");
        const reconciled = await owner.request.get(`${origin}/protected/utilities/requests/${requestId}/inputs/${lostId}?expectedVersion=2`);
        check(reconciled.status() === 200 && (await reconciled.json()).state === "stored", "Read-only actual status proves the lost acknowledgement stored exactly one item.");
        check((await db.query("select count(*)::int n from parent_private.utility_protected_inputs where input_id=$1", [lostId])).rows[0].n === 1, "An unknown acknowledgement produces no duplicate encrypted input.");
        const beforeCookies = await owner.cookies(), beforeSession = (await db.query("select s.id,s.not_after from auth.sessions s where s.user_id=$1 order by s.created_at desc limit 1", [fixtureOwner.id])).rows[0];
        await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [beforeSession.id]);
        try { check((await owner.request.get(`${origin}/protected/utilities/requests/${requestId}/inputs/${stored.inputId}/original?expectedVersion=2`)).status() === 401, "A retained real cookie cannot read private bytes after the actual session expires."); }
        finally { await db.query("update auth.sessions set not_after=$2 where id=$1", [beforeSession.id, beforeSession.not_after]); await owner.addCookies(beforeCookies); }
        const shortId = randomUUID(); await db.query("update parent_private.utility_protected_policies set approved_until=clock_timestamp()+interval '4 seconds' where program_id='peco-cap'");
        const short = await owner.request.post(`${origin}/protected/utilities/requests/${requestId}/inputs?expectedVersion=2`, { headers: { Origin: origin }, data: { ...authorization, inputId: shortId } });
        check(short.status() === 201, "A short original policy deadline is recorded on a real protected input.");
        const shortRef = utilityProtectedInputReferenceSchema.parse(await short.json());
        check((await storeUtilityProtectedInput(shortId, pdfBytes, { connectionString: dbUrl.toString(), deadline: new Date(Date.now() + 10000) })).state === "stored", "The true-expiry fixture stores actual encrypted bytes before its deadline.");
        await delay(Math.max(1, Date.parse(shortRef.expiresAt) - Date.now() + 60));
        await db.query("update parent_private.utility_protected_policies set approved_until=$1 where program_id='peco-cap'", [approvedUntil]);
        check((await owner.request.get(`${origin}/protected/utilities/requests/${requestId}/inputs/${shortId}/original?expectedVersion=2`)).status() === 403, "Reopening policy never extends an already expired original input or permits its raw read.");
        check((await safeRefs()).find(ref => ref.inputId === shortId)?.state === "expired", "Owned history reports actual original expiry rather than claiming a deletion guarantee.");
        for (const width of [320, 1280]) {
          await page.setViewportSize({ width, height: 950 }); await page.goto(origin + workspacePath, { waitUntil: "networkidle" });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
          const screenshot = resolve(output, `private-proof-saved-${width}.png`); await page.screenshot({ path: screenshot, fullPage: true });
          accessibility.push({ state: "saved", width, overflow, violations: axe.violations.map(item => item.id), screenshot });
          check(!overflow && axe.violations.length === 0, `Actual private proof page is accessible without horizontal overflow at ${width}px.`);
        }
        check(outsideOrigins.size === 0 && privateRequests.every(path => !path.startsWith("/api/parent")), "The private page sends no outside-origin request and no raw capture to a Next parent API.");
        const ordinary = (await db.query("select to_jsonb(r)::text value from public.parent_requests r where id=$1", [requestId])).rows[0].value;
        check(!/123-45-6789|PRIVATE RAW CANARY|PRIVATE_FILENAME_MUST_NOT_BE_SENT|keyBase64/.test(ordinary), "Private raw proof canaries stay out of ordinary request facts and metadata.");
        stage = "correcting, rebinding and withdrawing protected source information";
        const corrected = await fixtureOwner.client.rpc("parent_save_peco_application_details", { p_request_id: requestId, p_expected_version: 2, p_details: { ...details, address: { ...details.address, street: "2 Corrected Lane" } }, p_notice_version: PECO_APPLICATION_NOTICE_VERSION, p_idempotency_key: randomUUID(), p_subject_authority_declared: true, p_account_authority_declared: true });
        check(!corrected.error, "The real owner corrects an unrelated private application field.");
        const correctedWorkspace = await getWorkspace(3); check(correctedWorkspace.scope, "The correction produces a new exact source scope.");
        const reboundId = randomUUID(), rebound = await owner.request.post(`${origin}/protected/utilities/requests/${requestId}/inputs/${stored.inputId}/rebind?expectedVersion=3`, { headers: { Origin: origin }, data: { newInputId: reboundId, scope: correctedWorkspace.scope } });
        check(rebound.status() === 201, "A routine private rebind reuses the fresh original without another upload or consent prompt.");
        const reboundRef = utilityProtectedInputReferenceSchema.parse(await rebound.json());
        check(reboundRef.consentedAt === stored.consentedAt && Date.parse(reboundRef.expiresAt) <= Date.parse(stored.expiresAt) && reboundRef.validation === null, "Rebind preserves original consent/expiry and requires validation against corrected context.");
        const removed = await owner.request.delete(`${origin}/protected/utilities/requests/${requestId}/inputs/${reboundId}?expectedVersion=3`, { headers: { Origin: origin }, data: "" });
        check(removed.status() === 200, "The owner revokes the copied protected source without another processing approval.");
        check((await db.query("select count(*)::int n from parent_private.utility_protected_authorizations where input_id=any($1::uuid[]) and revoked_at is not null", [[stored.inputId, reboundId]])).rows[0].n === 2, "Source withdrawal revokes the original and every copied binding.");
        stage = "capturing exact PGW member identifiers and water access/recovery values privately";
        const gasCustomer = randomUUID(), gasMember = randomUUID(), waterApplicant = randomUUID();
        for (const program of [
          { id: "pgw-crp", prefix: "pgw", need: "gas", provider: "pgw", notice: PGW_APPLICATION_NOTICE_VERSION, purposes: ["required_identifier"],
            details: { accountNumber: "SYNTHETIC-GAS-ACCOUNT", customer: { id: gasCustomer, firstName: "Gas", lastName: "Customer" }, householdMembers: [{ id: gasMember, firstName: "Gas", lastName: "Child", dateOfBirth: "2018-01-01" }] } },
          { id: "pwd-tap", prefix: "water", need: "water", provider: "pwd", notice: WATER_APPLICATION_NOTICE_VERSION, purposes: ["account_access", "application_recovery"],
            details: { applicant: { id: waterApplicant, name: "Water Synthetic" }, propertyAddress: "1 Synthetic Lane, Philadelphia PA19147", journey: "pending", existingApplication: "saved" } },
        ] as const) {
          await db.query(`update parent_private.processing_controls set ${program.prefix}_details_enabled=true,${program.prefix}_details_approval_reference='synthetic protected scalar test only',${program.prefix}_details_approved_until=$1,${program.prefix}_details_notice_version=$2 where singleton`, [approvedUntil, program.notice]);
          await db.query("update parent_private.utility_protected_policies set enabled=true,approval_reference='synthetic protected scalar test only',approved_until=$1,policy_version='synthetic-utility-1',retention_policy_version='synthetic-utility-1',max_retention_seconds=300,allowed_purposes=$2 where program_id=$3", [approvedUntil, [...program.purposes], program.id]);
          const started = await fixtureOwner.client.rpc(`parent_start_${program.prefix}_application`, { p_intake: fixtureIntake({ needs: [program.need], householdSize: null, utilityProviders: [program.provider], accountAuthority: "self" }),
            p_mandate: fixtureMandate({ mode: "prepare_only", recipientIds: [program.id], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"], expiresAt: approvedUntil }),
            p_details: program.details, p_notice_version: program.notice, p_idempotency_key: randomUUID(), p_subject_authority_declared: true, p_account_authority_declared: true });
          check(!started.error && typeof started.data === "string", `The actual ${program.id} private request starts without document or submission permission.`);
          const scalarRequest = started.data as string, workspaceReply = await fixtureOwner.client.rpc("parent_get_utility_protected_workspace", { p_request_id: scalarRequest, p_expected_version: 2 });
          check(!workspaceReply.error, "The scalar workspace resolves the exact owned current snapshot."); const scalarWorkspace = utilityProtectedWorkspaceSchema.parse(workspaceReply.data);
          if (program.id === "pgw-crp") check(scalarWorkspace.targets.length === 1 && scalarWorkspace.targets[0].target.subjectId === gasMember, "PGW requests an identifier only for the non-customer child, never the exempt customer.");
          for (const purpose of program.purposes) {
            await page.goto(`${origin}/protected/utilities/requests/${scalarRequest}/workspace?expectedVersion=2`, { waitUntil: "networkidle" });
            await page.locator("#protected-purpose").selectOption(purpose); const index = scalarWorkspace.targets.findIndex(target => target.purpose === purpose); check(index >= 0, "Only a verified purpose/subject target is offered.");
            await page.locator("#protected-target").selectOption(String(index)); await page.locator("#protected-consent").check();
            if (purpose === "required_identifier") { await page.locator("#protected-identifier-type").selectOption("student_id"); await page.locator("#protected-identifier-value").fill("TEST-STUDENT-123"); }
            else if (purpose === "account_access") { await page.locator("#protected-water-code").fill("900000001"); await page.locator("#protected-water-zip").fill("19147"); }
            else await page.locator("#protected-recovery-id").fill("800001");
            await page.locator("#protected-save").click();
            const row = await waitFor(async () => { const reply = await fixtureOwner.client.rpc("parent_get_utility_protected_inputs", { p_request_id: scalarRequest }); check(!reply.error, "Owned scalar history is readable."); return utilityProtectedInputReferenceSchema.array().parse(reply.data).find(ref => ref.purpose === purpose && ref.state === "stored"); }, value => !!value, "The actual private scalar capture did not finish.");
            check(row && (purpose !== "account_access" || !!row.accountReference), "Raw scalar capture returns only an opaque current reference and a water account match reference.");
            const body = await owner.request.get(`${origin}/protected/utilities/requests/${scalarRequest}/inputs/${row.inputId}/original?expectedVersion=2`); check(body.status() === 200, "The exact owner can privately recover the protected scalar original.");
            const value = JSON.parse((await body.body()).toString("utf8")); check(value.purpose === purpose && (purpose === "required_identifier" ? value.type === "student_id" && value.value === "TEST-STUDENT-123" : purpose === "account_access" ? value.accessCode === "900000001" && value.zip === "19147" : value.applicationId === "800001"), "The original retains the exact selected source-supported scalar alternative/value.");
          }
          const ordinary = (await db.query("select to_jsonb(r)::text value from public.parent_requests r where id=$1", [scalarRequest])).rows[0].value;
          check(!/TEST-STUDENT-123|900000001|800001/.test(ordinary), "Gas identifiers and water codes never enter ordinary request facts.");
          const exported = await fixtureOwner.client.rpc("parent_export_utility_protected_inputs"); check(!exported.error && !/TEST-STUDENT-123|900000001|800001|fingerprint|keyBase64/.test(JSON.stringify(exported.data)), "The actual owner export includes safe references without raw scalars or matching secrets.");
        }
        await db.query("update parent_private.utility_protected_policies set enabled=false where program_id='peco-cap'");
        check((await owner.request.put(`${origin}/protected/utilities/requests/${requestId}/inputs/${lostId}?expectedVersion=2`, { headers: { Origin: origin, "Content-Type": "application/pdf" }, data: pdfBytes })).status() === 403, "Retained real Auth cookies cannot capture through a closed processing purpose.");
        const deleted = await fixtureOwner.client.rpc("parent_request_deletion"); check(!deleted.error, "Parent-purpose deletion remains available without reopening protected collection.");
        check((await db.query("select parent_private.parent_purge_utility_protected_inputs(100) n")).rows[0].n >= 1, "Native bounded erasure removes revoked/deleting ciphertext independently of collection gates.");
        check((await db.query("select count(*)::int n from parent_private.utility_protected_inputs i join parent_private.utility_protected_authorizations a on a.input_id=i.input_id where a.owner_id=$1", [fixtureOwner.id])).rows[0].n === 0, "All fixture-owned raw inputs are erased after withdrawal/deletion.");
        check((await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n === reservations, "Protected capture, deterministic parsing and correction make no model call or reservation.");
        pdfBytes.fill(0);
      } finally {
        let cleanupFailed = false;
        const cleanup = async (action: () => Promise<unknown>) => { try { await action(); } catch { cleanupFailed = true; } };
        for (const context of contexts) await cleanup(() => context.close());
        await cleanup(() => close(frontdoor)); await cleanup(() => close(privateServer));
        // Fixture-only memberships may be removed; no existing school identity or policy row is deleted.
        await cleanup(() => db.query("delete from public.parent_accounts where id=any($1::uuid[])", [fixtures.map(fixture => fixture.id)]));
        await cleanup(async () => {
          const policyColumns = (await db.query("select attname from pg_attribute where attrelid='parent_private.utility_protected_policies'::regclass and attnum>0 and not attisdropped and attname<>'program_id' order by attnum")).rows.map(row => row.attname as string);
          for (const policy of policies) await db.query(`update parent_private.utility_protected_policies p set (${policyColumns.map(identifier).join(",")})=(select ${policyColumns.map(name => `r.${identifier(name)}`).join(",")} from jsonb_populate_record(null::parent_private.utility_protected_policies,$1::jsonb) r) where program_id=$2`, [JSON.stringify(policy), policy.program_id]);
          assert.deepEqual((await db.query("select to_jsonb(p) value from parent_private.utility_protected_policies p order by program_id")).rows.map(row => row.value), policies); checks.push("All protected-policy rows are restored exactly.");
        });
        await cleanup(async () => {
          const controlColumns = (await db.query("select attname from pg_attribute where attrelid='parent_private.processing_controls'::regclass and attnum>0 and not attisdropped and attname<>'singleton' order by attnum")).rows.map(row => row.attname as string);
          await db.query(`update parent_private.processing_controls c set (${controlColumns.map(identifier).join(",")})=(select ${controlColumns.map(name => `r.${identifier(name)}`).join(",")} from jsonb_populate_record(null::parent_private.processing_controls,$1::jsonb) r) where singleton`, [JSON.stringify(controls)]);
          assert.deepEqual((await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value, controls); checks.push("The complete processing-control row is restored exactly before fixture cleanup.");
        });
        await cleanup(async () => check((await db.query("select count(*)::int n from vault.secrets")).rows[0].n === vaultBefore, "Fixture cascades erase every independently created Vault key."));
        if (roleCreated) await cleanup(async () => { await db.query("select pg_terminate_backend(pid) from pg_stat_activity where usename=$1 and pid<>pg_backend_pid()", [login]); await db.query(`drop role ${identifier(login)}`); });
        if (probeCreated) await cleanup(async () => { await db.query("select pg_terminate_backend(pid) from pg_stat_activity where usename=$1 and pid<>pg_backend_pid()", [probeLogin]); await db.query(`drop role ${identifier(probeLogin)}`); });
        if (cleanupFailed) throw new Error("Synthetic protected utility cleanup needs attention.");
      }
      writeFileSync(resolve(output, "results.json"), JSON.stringify({ checks, accessibility, limitations: ["Local synthetic Auth/Vault/private HTTP only; no legal compliance, provider receipt, proof authenticity or launch claim.", "A reviewed, installed migration and the existing isolated document parser are required."] }, null, 2));
    });
  } finally { await browser.close(); }
  console.log(`Protected utility verification passed: ${checks.length} assertions; only synthetic local data. Exact original controls restored.`);
}
void main().catch(error => { console.error(`Protected utility verification failed during ${stage}; private values and credentials withheld. Code: ${typeof error?.code === "string" && /^[A-Z0-9_]{1,12}$/.test(error.code) ? error.code : "CHECK_FAILED"}.`); process.exitCode = 1; });
