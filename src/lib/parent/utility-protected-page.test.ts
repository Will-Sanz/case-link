import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderUtilityProtectedPage } from "./utility-protected-page";
import { UTILITY_PROTECTED_INPUT_NOTICE_VERSION, type UtilityProtectedWorkspace } from "./utility-protected-input-contract";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const nonce = "a".repeat(32), requestId = id(1);
type Call = { method: string; path: string; body: Buffer };
let workspace: UtilityProtectedWorkspace, calls: Call[], page: Page, context: BrowserContext, browser: Browser, origin: string, pdf: Uint8Array;
let respond: (call: Call, response: ServerResponse) => void;
let actualHtml: string | null = null;
const errors: string[] = [];
const reference = (inputId: string, state: "authorized" | "stored" = "authorized") => ({ inputId, authorizationId: id(8), ownerId: id(9), requestId, requestVersion: 2, programId: workspace.programId!,
  snapshotId: id(2), snapshotRevision: 1, snapshotHash: "a".repeat(64), purpose: workspace.targets[0].purpose, targets: [workspace.targets[0].target], state,
  consentedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: workspace.expiresAt!, accountReference: null, validation: null });
const json = (response: ServerResponse, value: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "private, no-store" }); response.end(JSON.stringify(value)); };
const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const path = request.url ?? "/", method = request.method ?? "GET";
  if (path.startsWith("/fonts/utility-protected/") || path.startsWith("/favicon.svg")) {
    const files: Record<string, string> = { "/favicon.svg?v=4": "public/favicon.svg", "/fonts/utility-protected/Geist-Regular.woff2": "public/fonts/utility-protected/Geist-Regular.woff2",
      "/fonts/utility-protected/newsreader-latin-wght-normal.woff2": "public/fonts/utility-protected/newsreader-latin-wght-normal.woff2" };
    if (!files[path]) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": path.includes("woff2") ? "font/woff2" : "image/svg+xml" }); response.end(readFileSync(files[path])); return;
  }
  if (method === "GET" && path.includes("/workspace?")) {
    const expectedVersion = Number(new URL(path, origin).searchParams.get("expectedVersion"));
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "private, no-store", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'` });
    response.end(actualHtml ?? renderUtilityProtectedPage(workspace, { requestId, expectedVersion, nonce })); return;
  }
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const call = { method, path, body: Buffer.concat(chunks) }; calls.push(call); respond(call, response);
});
describe("protected HTML boundary", () => {
  const closed: UtilityProtectedWorkspace = { requestVersion: 2, collectionEnabled: false, scope: null, programId: null, programLabel: null,
    noticeVersion: null, expiresAt: null, retentionSeconds: null, targets: [], references: [] };
  it("omits every raw entry control when collection is closed while preserving history and account controls", () => {
    const html = renderUtilityProtectedPage(closed, { requestId, expectedVersion: 2, nonce });
    expect(html).not.toContain('<form id="protected-form"'); expect(html).not.toMatch(/<input\b|<select\b/); expect(html).toContain('id="protected-history"'); expect(html).toContain(`/support/${requestId}`);
  });
  it("refuses an unrelated snapshot context before rendering a private page", () => {
    expect(() => renderUtilityProtectedPage({ ...closed, scope: { requestId: id(90), expectedVersion: 2, programId: "pgw-crp", snapshotId: id(2), snapshotRevision: 1, snapshotHash: "a".repeat(64) } }, { requestId, expectedVersion: 2, nonce })).toThrow("The protected workspace is unavailable.");
  });
  it("rejects an injected nonce instead of creating a second script or attribute", () => {
    expect(() => renderUtilityProtectedPage(closed, { requestId, expectedVersion: 2, nonce: '"><script>attack()</script>' })).toThrow();
  });
});
describe.skipIf(process.env.CASELINK_PARENT_TEST_PROTECTED_PAGE_BROWSER !== "1")("standalone protected utility page in a real browser with synthetic HTTP fixtures", () => {
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); }); const address = server.address(); if (!address || typeof address === "string") throw new Error(); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true }); const document = await PDFDocument.create(); document.addPage(); pdf = await document.save();
}, 15000);
afterAll(async () => { await browser?.close(); if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(async () => {
  calls = []; errors.length = 0; actualHtml = null;
  workspace = { requestVersion: 2, collectionEnabled: true, scope: { requestId, expectedVersion: 2, programId: "pgw-crp", snapshotId: id(2), snapshotRevision: 1, snapshotHash: "a".repeat(64) },
    programId: "pgw-crp", programLabel: "PGW CRP", noticeVersion: UTILITY_PROTECTED_INPUT_NOTICE_VERSION, expiresAt: new Date(Date.now() + 60000).toISOString(), retentionSeconds: 3600,
    targets: [{ purpose: "required_identifier", target: { subjectId: id(3), sourceId: null, field: "pgw_household_identifier" }, displayName: "Fictional Child", sourceLabel: null, available: true, reason: null, mediaTypes: ["application/octet-stream"], maxBytes: 1024 }], references: [] };
  respond = (_call, response) => json(response, {}, 403);
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" }); page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
});
afterEach(async () => { await context.close(); expect(errors).toEqual([]); });
const load = () => page.goto(`${origin}/protected/utilities/requests/${requestId}/workspace?expectedVersion=2`, { waitUntil: "networkidle" });
async function choose(purpose = "required_identifier") { await page.locator("#protected-purpose").selectOption(purpose); await page.locator("#protected-target").selectOption("0"); await page.locator("#protected-consent").check(); }
async function identifier() { await choose(); await page.locator("#protected-identifier-type").selectOption("passport"); await page.locator("#protected-identifier-value").fill("FICTIONAL-PASSPORT-CANARY"); }
  it("executes the actual tsx-rendered nonce script without relying on transform-only helper globals", async () => {
    actualHtml = execFileSync(process.execPath, ["--import", "tsx", "-e", 'const {readFileSync}=require("node:fs"); const {renderUtilityProtectedPage}=require("./src/lib/parent/utility-protected-page.ts"); const value=JSON.parse(readFileSync(0,"utf8")); process.stdout.write(renderUtilityProtectedPage(value.workspace,value.route));'],
      { input: JSON.stringify({ workspace, route: { requestId, expectedVersion: 2, nonce } }), encoding: "utf8", timeout: 10000 });
    await load(); await choose(); expect(await page.locator("#protected-identifier-value").isEnabled()).toBe(true);
  });
  it("escapes untrusted labels and JSON, runs only nonce scripts and enables no secret input before per-item consent", async () => {
    workspace.programLabel = "PGW </script><script>window.attack=true</script>";
    workspace.targets[0].displayName = 'Child </option><img src=x onerror="window.attack=true">';
    await load(); expect(await page.locator("#protected-purpose").inputValue()).toBe("required_identifier"); expect(await page.locator("#protected-target").inputValue()).toBe("0");
    expect(await page.locator("#protected-target option:checked").textContent()).toBe(workspace.targets[0].displayName);
    expect(await page.locator("#protected-identifier-value").isDisabled()).toBe(true); expect(await page.locator("#protected-consent").isChecked()).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { attack?: boolean }).attack)).toBeUndefined(); expect(await page.locator("script").count()).toBe(2);
    await page.locator("#protected-consent").check(); expect(await page.locator("#protected-identifier-value").isEnabled()).toBe(true);
    expect(await page.locator("#protected-identifier-type").inputValue()).toBe(""); expect(await page.locator("#protected-identifier-type option").count()).toBe(8); expect(calls).toHaveLength(0);
  });
  it("records only metadata before scalar bytes and reconciles unknown storage without a duplicate upload or approval", async () => {
    let savedId = "", stored = false;
    respond = (call, response) => {
      if (call.method === "POST" && /\/inputs\?/.test(call.path)) { const body = JSON.parse(call.body.toString()); savedId = body.inputId; expect(call.body.toString()).not.toContain("PASSPORT-CANARY"); json(response, reference(savedId), 201); }
      else if (call.method === "PUT") { expect(JSON.parse(call.body.toString())).toEqual({ purpose: "required_identifier", type: "passport", value: "FICTIONAL-PASSPORT-CANARY" }); stored = true; json(response, { state: "storage_unconfirmed", inputId: savedId }, 202); }
      else if (call.method === "GET" && stored) json(response, reference(savedId, "stored")); else json(response, {}, 403);
    };
    await load(); await identifier(); await page.locator("#protected-save").click(); await page.getByText(/The save result is unconfirmed/).waitFor();
    expect(await page.locator("#protected-identifier-value").isDisabled()).toBe(true); await page.getByRole("button", { name: "Check and retry same item" }).click();
    await page.getByText(/Your item is stored privately/).waitFor(); expect(calls.filter(call => call.method === "PUT")).toHaveLength(1); expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(calls.at(-1)?.method).toBe("GET"); expect(await page.locator("#protected-identifier-value").inputValue()).toBe(""); expect(await page.getByRole("button", { name: /Approve|Validate/i }).count()).toBe(0);
  });
  it("retries unknown authorization with the identical item ID and body before sending private bytes", async () => {
    let savedId = "", authorizations = 0;
    respond = (call, response) => {
      if (call.method === "POST") { const value = JSON.parse(call.body.toString()); savedId = value.inputId; if (++authorizations === 1) json(response, {}, 503); else json(response, reference(savedId), 201); }
      else if (call.method === "GET" && savedId) json(response, reference(savedId)); else if (call.method === "PUT") json(response, reference(savedId, "stored"), 201); else json(response, {}, 403);
    };
    await load(); await identifier(); await page.locator("#protected-save").click(); await page.getByText(/The save result is unconfirmed/).waitFor();
    expect(calls.filter(call => call.method === "PUT")).toHaveLength(0); await page.getByRole("button", { name: "Check and retry same item" }).click(); await page.getByText(/Your item is stored privately/).waitFor();
    const posts = calls.filter(call => call.method === "POST"); expect(posts).toHaveLength(2); expect(posts[1].body.equals(posts[0].body)).toBe(true); expect(calls.filter(call => call.method === "PUT")).toHaveLength(1);
  });
  it.each(["account_access", "application_recovery"] as const)("keeps %s only in the protected scalar bytes, with no guessed or coerced value", async purpose => {
    workspace.programId = "pwd-tap"; workspace.scope!.programId = "pwd-tap"; workspace.programLabel = "Philadelphia water assistance";
    workspace.targets = [{ ...workspace.targets[0], purpose, target: { subjectId: id(3), sourceId: null, field: purpose === "account_access" ? "water_access_code" : "water_application_recovery" } }];
    let savedId = "";
    respond = (call, response) => {
      if (call.method === "POST") { const body = JSON.parse(call.body.toString()); savedId = body.inputId; expect(body).not.toHaveProperty("accessCode"); expect(body).not.toHaveProperty("zip"); expect(body).not.toHaveProperty("applicationId"); json(response, reference(savedId), 201); }
      else if (call.method === "PUT") { expect(JSON.parse(call.body.toString())).toEqual(purpose === "account_access" ? { purpose, accessCode: "000000001", zip: "19147" } : { purpose, applicationId: "00001" }); workspace.references = [reference(savedId, "stored")]; json(response, workspace.references[0], 201); }
      else json(response, {}, 403);
    };
    await load(); await choose(purpose);
    if (purpose === "account_access") {
      await page.locator("#protected-water-code").fill("00000001"); await page.locator("#protected-water-zip").fill("19147"); await page.locator("#protected-save").click();
      await page.getByText(/Choose the exact person and item/).waitFor(); expect(calls).toHaveLength(0); await page.locator("#protected-water-code").fill("000000001");
    } else await page.locator("#protected-recovery-id").fill("00001");
    await page.locator("#protected-save").click(); await expect.poll(() => calls.filter(call => call.method === "PUT").length).toBe(1);
    await expect.poll(() => page.locator("#protected-history").textContent()).toMatch(/Stored privately/);
    expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
  });
  it("authorizes a file before reading any byte, never sends its filename and checks source fields automatically", async () => {
    workspace.targets = [{ ...workspace.targets[0], purpose: "income_proof", target: { subjectId: id(3), sourceId: id(4), field: "income" }, mediaTypes: ["application/pdf", "image/jpeg", "image/png"], maxBytes: 10485760 }];
    let authorize!: () => void, savedId = "";
    respond = (call, response) => {
      if (call.method === "POST" && call.path.includes("/validate?")) json(response, { ...reference(savedId, "stored"), validation: { id: id(11), validatorVersion: "synthetic.v1", validatedAt: new Date().toISOString(), expiresAt: workspace.expiresAt } });
      else if (call.method === "POST") { savedId = JSON.parse(call.body.toString()).inputId; authorize = () => json(response, reference(savedId), 201); }
      else if (call.method === "PUT") { expect(call.body.equals(Buffer.from(pdf))).toBe(true); json(response, reference(savedId, "stored"), 201); } else json(response, {}, 403);
    };
    await load(); await page.evaluate(() => { const original = File.prototype.arrayBuffer; (window as unknown as { reads: number }).reads = 0; File.prototype.arrayBuffer = function () { (window as unknown as { reads: number }).reads++; return original.call(this); }; });
    await choose("income_proof"); await page.locator("#protected-file").setInputFiles({ name: "FILENAME-PRIVATE-CANARY.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) });
    await page.locator("#protected-save").click(); await expect.poll(() => typeof authorize).toBe("function");
    expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(0); authorize();
    await page.getByText(/Your item is stored privately and source fields were checked/).waitFor(); expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(1);
    expect(calls.some(call => call.path.includes("FILENAME") || call.method === "POST" && call.body.toString().includes("FILENAME"))).toBe(false);
    expect(calls.filter(call => call.path.includes("/validate?") && call.method === "POST")).toHaveLength(1);
  });
  it("automatically reuses a compatible saved item without another capture or consent and preserves original expiry", async () => {
    const original = { ...reference(id(14), "stored"), requestVersion: 1, snapshotId: id(15), snapshotHash: "b".repeat(64), state: "superseded" as const, expiresAt: new Date(Date.now() + 30000).toISOString() }; workspace.references = [original];
    respond = (call, response) => { if (call.method === "POST" && call.path.includes("/rebind?")) { const value = JSON.parse(call.body.toString()); json(response, { ...reference(value.newInputId, "stored"), consentedAt: original.consentedAt, expiresAt: original.expiresAt }, 201); } else json(response, {}, 403); };
    await load(); await page.getByText(/Your item is stored privately/).waitFor();
    expect(calls.filter(call => call.method === "POST")).toHaveLength(1); expect(calls.some(call => call.method === "PUT")).toBe(false); expect(await page.locator("#protected-consent").isChecked()).toBe(false);
    expect(await page.locator("#protected-history").textContent()).toContain(new Date(original.expiresAt).toLocaleString());
  });
  it("keeps closed history usable for revocation and refreshes the actual request version without secret controls", async () => {
    workspace.references = [reference(id(16), "stored")]; workspace.collectionEnabled = false; workspace.scope = null;
    respond = (call, response) => { if (call.method === "DELETE") { expect(call.body.length).toBe(0); workspace.requestVersion = 3; workspace.references[0].state = "revoked"; json(response, { inputId: id(16), state: "revoked", requestVersion: 3 }); } else json(response, {}, 403); };
    await load(); expect(await page.locator('input,select,input[type="file"]').count()).toBe(0); expect(await page.getByRole("button", { name: "Download private original" }).count()).toBe(0);
    await page.getByRole("button", { name: "Stop using this item" }).click(); await page.waitForURL(/expectedVersion=3$/); expect(await page.locator("#protected-history").textContent()).toContain("revoked");
  });
  it("stops raw transfer at expiry while preserving the uncertain reference and ignores a late authorization", async () => {
    workspace.expiresAt = new Date(Date.now() + 60000).toISOString(); let authorize!: () => void;
    respond = (call, response) => { if (call.method === "POST") { const value = JSON.parse(call.body.toString()); authorize = () => json(response, reference(value.inputId), 201); } else json(response, {}, 403); };
    await load(); await identifier(); await page.locator("#protected-save").click(); await expect.poll(() => typeof authorize).toBe("function");
    await page.clock.setSystemTime(new Date(Date.parse(workspace.expiresAt) + 1000)); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); authorize();
    await page.getByRole("button", { name: "Check and retry same item" }).waitFor(); expect(await page.locator("#protected-identifier-value").inputValue()).toBe(""); expect(calls.some(call => call.method === "PUT")).toBe(false);
  });
  it("wipes a draft on pagehide and sends no raw byte after a late authorization completes", async () => {
    let authorize!: () => void; respond = (call, response) => { if (call.method === "POST") { const value = JSON.parse(call.body.toString()); authorize = () => json(response, reference(value.inputId), 201); } else json(response, {}, 403); };
    await load(); await identifier(); await page.locator("#protected-save").click(); await expect.poll(() => typeof authorize).toBe("function");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide"))); authorize(); await page.waitForTimeout(40);
    expect(await page.locator("#protected-identifier-value").inputValue()).toBe(""); expect(calls.some(call => call.method === "PUT")).toBe(false);
  });
  it("reloads fresh owned metadata after a restored back-forward page while keeping its earlier secret draft wiped", async () => {
    await load(); await identifier(); workspace.targets[0].displayName = "Fresh owned person after return";
    const loaded = page.waitForEvent("domcontentloaded");
    await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
    await loaded; await page.waitForLoadState("networkidle");
    expect(await page.locator("#protected-target option:checked").textContent()).toBe("Fresh owned person after return");
    expect(await page.locator("#protected-identifier-value").inputValue()).toBe(""); expect(await page.locator("#protected-consent").isChecked()).toBe(false); expect(calls).toHaveLength(0);
  });
  it("uses the shared identity and passes responsive overflow and accessibility checks at 320 and 1280 pixels", async () => {
    await load(); await choose(); mkdirSync("tmp/parent-verification/utility-protected-page", { recursive: true });
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze(); expect(result.violations.map(value => value.id)).toEqual([]);
      await page.screenshot({ path: `tmp/parent-verification/utility-protected-page/pgw-${width}.png`, fullPage: true });
    }
    expect(await page.evaluate(() => document.fonts.check('16px Geist') && document.fonts.check('20px "Newsreader Variable"'))).toBe(true);
    expect(await page.getByRole("link", { name: "Contact CaseLink" }).getAttribute("href")).toBe("mailto:willsanz23@gmail.com");
  });
});
