import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
import { chromium, type Browser } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FAMILY_PROFILE_NOTICE_VERSION, familyProfileDetailsSchema, familyProfileLeaves, type FamilyProfileRead } from "@/lib/parent/family-profile";

let browser: Browser, origin: string, files: Record<string, Uint8Array>, profile: FamilyProfileRead;
let writes: { key: string; body: string }[], loseAcknowledgement: boolean;
const dates = (confirmedAt: string) => ({ confirmedAt, expiresAt: new Date(Date.parse(confirmedAt) + 45 * 86400000).toISOString() });
const owner = "11111111-1111-4111-8111-111111111111", person = "22222222-2222-4222-8222-222222222222";
const json = (response: ServerResponse, body: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "private, no-store" }); response.end(JSON.stringify(body)); };
const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");
  if (url.pathname === "/family-profile") {
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'" });
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family information test fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return;
  }
  if (files[url.pathname]) { response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : url.pathname.endsWith(".css") ? "text/css" : "font/woff2" }); response.end(files[url.pathname]); return; }
  if (url.pathname !== "/api/parent/family-profile") { response.writeHead(404); response.end(); return; }
  if (request.method === "GET") { json(response, { ok: true, ...profile }); return; }
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString(), value = JSON.parse(body), key = String(request.headers["idempotency-key"]);
  writes.push({ key, body });
  if (value.expectedOwnerId !== profile.ownerId || value.expectedRevision !== profile.revision) { json(response, { ok: false, error: "This profile changed" }, 409); return; }
  const revision = profile.revision + 1;
  profile = { ...profile, revision, lastMutationKey: key, profile: request.method === "DELETE" ? null
    : { revision, details: familyProfileDetailsSchema.parse(value.details), provenance: Object.fromEntries(Object.keys(familyProfileLeaves(value.details)).map(path => [path, dates(new Date().toISOString())])), idempotencyKey: key } };
  if (loseAcknowledgement) { loseAcknowledgement = false; json(response, { ok: false, error: "Synthetic lost acknowledgement" }, 503); }
  else json(response, { ok: true, revision });
});

describe.skipIf(process.env.CASELINK_PARENT_TEST_PROFILE_BROWSER !== "1")("family profile in a headless browser with synthetic HTTP fixtures", () => {
  beforeAll(async () => {
    const result = await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {FamilyProfile} from "./src/features/parent/family-profile"; import styles from "./src/features/parent/parent.module.css"; import "./tokens.css"; createRoot(document.getElementById("root")).render(<div className={styles.shell}><main><FamilyProfile/></main></div>);', resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, platform: "browser", format: "iife", write: false, outdir: "/fixture", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent" });
    const js = result.outputFiles.find(file => file.path.endsWith(".js")), css = result.outputFiles.find(file => file.path.endsWith(".css"));
    if (!js || !css) throw new Error("The actual profile browser fixture did not compile.");
    files = { "/fixture.js": js.contents, "/fixture.css": Buffer.concat([css.contents, Buffer.from('\n@font-face{font-family:Geist;src:url(/geist.woff2)}@font-face{font-family:"Newsreader Variable";src:url(/newsreader.woff2)}:root{--font-geist-sans:Geist}body{margin:0}button,input,select{font:inherit}')]),
      "/geist.woff2": readFileSync("public/fonts/utility-protected/Geist-Regular.woff2"), "/newsreader.woff2": readFileSync("public/fonts/utility-protected/newsreader-latin-wght-normal.woff2") };
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Local fixture unavailable"); origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  }, 20000);
  afterAll(async () => { await browser?.close(); if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  beforeEach(() => {
    writes = []; loseAcknowledgement = false;
    profile = { ownerId: owner, revision: 1, collection: { collectionEnabled: true, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, expiresAt: new Date(Date.now() + 120_000).toISOString(), retentionDays: 45 },
      profile: { revision: 1, details: { primaryPerson: { id: person, firstName: "Morgan", lastName: "Example" }, homeAddress: { street: "100 Fictional Street", city: "Philadelphia", state: "PA", zip: "19104" },
        members: [{ id: "44444444-4444-4444-8444-444444444444", firstName: "Casey", lastName: "Example", relationship: "Child" }] },
        provenance: { "primaryPerson.firstName": { confirmedAt: new Date(Date.now() - 86_400_000).toISOString(), expiresAt: new Date(Date.now() + 44 * 86_400_000).toISOString() } }, idempotencyKey: "33333333-3333-4333-8333-333333333333" }, lastMutationKey: "33333333-3333-4333-8333-333333333333" };
    profile.profile!.provenance = Object.fromEntries(Object.keys(familyProfileLeaves(profile.profile!.details)).map(path => [path, dates(new Date(Date.now() - 86_400_000).toISOString())]));
  });

  it.each([320, 1280])("uses the actual profile editor with labeled controls, no overflow and clear access at %spx", async width => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" }), page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(`${origin}/family-profile`, { waitUntil: "networkidle" });
      expect(await page.getByLabel("Your first name", { exact: true }).inputValue()).toBe("Morgan");
      mkdirSync("tmp/parent-verification/family-profile", { recursive: true }); await page.screenshot({ path: `tmp/parent-verification/family-profile/profile-${width}-initial.png`, fullPage: true });
      await page.getByText("Your income sources (optional)", { exact: true }).click();
      await page.getByLabel("Your income source inventory", { exact: true }).selectOption("sources");
      await page.getByLabel("Add your income source", { exact: true }).selectOption("employment");
      await page.getByText("Home address (optional)", { exact: true }).click();
      await page.getByText("Mailing address (optional)", { exact: true }).click();
      expect(await page.getByRole("button", { name: "Save and finish later", exact: true }).isDisabled()).toBe(true);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(); expect(axe.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.evaluate(() => document.fonts.check("16px Geist") && document.fonts.check('24px "Newsreader Variable"'))).toBe(true);
      await page.screenshot({ path: `tmp/parent-verification/family-profile/profile-${width}.png`, fullPage: true });
      await page.getByRole("checkbox", { name: /I have permission to provide these family details/ }).check();
      loseAcknowledgement = true; await page.getByRole("button", { name: "Save and finish later", exact: true }).click();
      await page.getByText("Your family information is saved. You can finish it later or continue to support.", { exact: true }).waitFor();
      expect(writes).toHaveLength(1); expect(profile.profile?.details.primaryPerson.id).toBe(person);
      expect(await page.getByRole("button", { name: "Retry the same family save", exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0); expect(errors).toEqual([]);
    } finally { await context.close(); }
  }, 20000);
});
