// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GetSupportPage from "./page";
import { safeReturnPath } from "@/features/parent/api";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
it("preserves the existing account recovery origin and closed email-code mode for inline sign-in", async () => {
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
  vi.stubEnv("CASELINK_PARENT_RECOVERY_SITE_URL", "https://original.example.invalid");
  vi.stubEnv("CASELINK_PARENT_EMAIL_CODE_ENABLED", "0");
  const page = await GetSupportPage({ searchParams: Promise.resolve({}) });
  expect(page.props.signInOptions).toEqual({ existingAccountRecovery: true, recoveryHref: "https://original.example.invalid/forgot-password", emailCodeAvailable: false });
});
it("opens guided food help by default and preserves the all-support destination through sign-in", async () => {
  const page = await GetSupportPage({ searchParams: Promise.resolve({}) });
  render(page);
  const href = screen.getByRole("link", { name: /See all support options/ }).getAttribute("href")!;
  expect(href).toBe("/get-support?need=all");
  expect(safeReturnPath(href)).toBe(href);
  const destination = await GetSupportPage({ searchParams: Promise.resolve({ need: new URL(href, "https://example.invalid").searchParams.get("need")! }) });
  expect(destination.props.initialNeed).toBe("all");
  expect(destination.props.initialNeed).not.toBe(page.props.initialNeed);
});
