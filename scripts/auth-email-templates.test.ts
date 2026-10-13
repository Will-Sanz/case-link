import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const config = readFileSync("supabase/config.toml", "utf8");
it.each([["invite", "setup"], ["recovery", "recovery"]])("%s emails use the canonical confirmation screen without a token in the request URL", (type, mode) => {
  const html = readFileSync(`supabase/email-templates/${type}.html`, "utf8");
  expect(config).toContain(`content_path = "./supabase/email-templates/${type}.html"`);
  expect(html).toContain("15 minutes");
  expect(config).toContain("otp_expiry = 900");
  expect(html).not.toContain(".ConfirmationURL");
  const rendered = html.replaceAll("{{ .SiteURL }}", "https://school.example").replaceAll("{{ .TokenHash }}", "synthetic-token");
  const links = [...rendered.matchAll(/href="([^"]+)"/g)];
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const url = new URL(link[1].replaceAll("&amp;", "&"));
    expect(url.origin + url.pathname).toBe("https://school.example/auth/callback");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("type")).toBe(type);
    expect(new URLSearchParams(url.hash.slice(1)).get("next")).toBe(`/reset-password?mode=${mode}`);
  }
});
it("every configured email exists, and security notifications contain no sign-in credential", () => {
  for (const match of config.matchAll(/content_path = "(.+)"/g)) {
    const html = readFileSync(match[1].includes("notification") ? `supabase/${match[1]}` : match[1], "utf8");
    expect(html).toContain('<html lang="en">');
    if (match[1].includes("notification")) expect(html).not.toMatch(/\.(Token|TokenHash|ConfirmationURL)\s/);
  }
});
