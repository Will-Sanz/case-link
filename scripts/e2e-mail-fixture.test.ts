import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type MailHarness = { emailLink(email: string, type: "invite" | "recovery"): Promise<string> };
const captured = vi.hoisted(() => ({ local: undefined as undefined | ((input: unknown, provide: (state: MailHarness) => Promise<void>) => Promise<void>) }));
vi.mock("@playwright/test", async () => ({ expect: (await import("vitest")).expect,
  test: { extend: (fixtures: { local: typeof captured.local }) => { captured.local = fixtures.local; return {}; } } }));
vi.mock("../tests/e2e/local-stack.mjs", () => ({ TEST_ORIGIN: "http://127.0.0.1:3100", MAIL_ORIGIN: "http://127.0.0.1:3000",
  localStack: () => ({ API_URL: "http://127.0.0.1:54321", DB_URL: "unused", MAILPIT_URL: "http://127.0.0.1:54324", SERVICE_ROLE_KEY: "synthetic" }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
vi.mock("pg", () => ({ Client: class { async connect() {} async query() {} async end() {} } }));
vi.mock("node:fs", async importOriginal => ({ ...await importOriginal<typeof import("node:fs")>(), writeFileSync: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));
import "../tests/e2e/helpers";

const email = "browser-synthetic@example.test", fetcher = vi.fn();
const config = readFileSync("supabase/config.toml", "utf8");
function delivered(type: "invite" | "recovery") {
  const Subject = config.match(new RegExp(`\\[auth\\.email\\.template\\.${type}\\]\\nsubject = "([^"]+)"`))?.[1];
  expect(Subject).toBeTruthy();
  const HTML = readFileSync(`supabase/email-templates/${type}.html`, "utf8")
    .replaceAll("{{ .SiteURL }}", "http://127.0.0.1:3000").replaceAll("{{ .TokenHash }}", "synthetic-token");
  return { Subject, HTML };
}
function mailbox(mail: ReturnType<typeof delivered>) {
  fetcher.mockImplementation(async (address: string) => {
    const url = new URL(address);
    expect(url.origin).toBe("http://127.0.0.1:54324");
    if (url.pathname === "/api/v1/search") {
      expect(url.searchParams.get("query")).toBe(`to:${email}`);
      return { json: async () => ({ messages: [{ ID: "synthetic-message" }] }) };
    }
    expect(url.pathname).toBe("/api/v1/message/synthetic-message");
    return { json: async () => mail };
  });
}
async function withMailbox(run: (state: MailHarness) => Promise<void>) {
  await captured.local!({ context: { route: async () => {}, pages: () => [] } }, run);
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => vi.unstubAllGlobals());

it.each(["invite", "recovery"] as const)("recognizes the configured %s email and keeps its credential in the fragment", async type => {
  mailbox(delivered(type));
  await withMailbox(async state => {
    const url = new URL(await state.emailLink(email, type));
    expect(url.origin + url.pathname).toBe("http://127.0.0.1:3100/auth/callback");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("token_hash")).toBe("synthetic-token");
    expect(new URLSearchParams(url.hash.slice(1)).get("type")).toBe(type);
  });
});
it.each(["wrong subject", "wrong type", "wrong origin", "query credential"])("does not accept %s", async kind => {
  const mail = delivered("invite");
  if (kind === "wrong subject") mail.Subject = "Unrelated notification";
  if (kind === "wrong type") mail.HTML = mail.HTML.replaceAll("type=invite", "type=recovery");
  if (kind === "wrong origin") mail.HTML = mail.HTML.replaceAll("http://127.0.0.1:3000", "https://untrusted.example");
  if (kind === "query credential") mail.HTML = mail.HTML.replaceAll("/auth/callback#", "/auth/callback?token_hash=synthetic-token#");
  mailbox(mail);
  await withMailbox(async state => { await expect(state.emailLink(email, "invite")).rejects.toThrow(); });
});
