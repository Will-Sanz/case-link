// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GetSupportPage from "./page";
import { safeReturnPath } from "@/features/parent/api";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("preserves the existing account recovery origin and closed email-code mode for inline sign-in", async () => {
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
  vi.stubEnv("CASELINK_PARENT_RECOVERY_SITE_URL", "https://original.example.invalid");
  vi.stubEnv("CASELINK_PARENT_EMAIL_CODE_ENABLED", "0");
  const page = await GetSupportPage({ searchParams: Promise.resolve({}) });
  expect(page.props.signInOptions).toEqual({ existingAccountRecovery: true, recoveryHref: "https://original.example.invalid/forgot-password", emailCodeAvailable: false });
});
it("offers all support options after the short intake", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "Sign in required." }, { status: 401 })));
  const page = await GetSupportPage({ searchParams: Promise.resolve({}) });
  render(page);
  expect(screen.queryByRole("button", { name: "See all support options" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "No" }));
  fireEvent.change(screen.getByLabelText("ZIP code"), { target: { value: "19104" } });
  fireEvent.click(screen.getByRole("button", { name: "Find support" }));
  fireEvent.click(await screen.findByRole("button", { name: "See all support options" }));
  expect(await screen.findByRole("heading", { name: "Let’s make the next steps easier." })).toBeTruthy();
  expect(await screen.findByLabelText("Your email address")).toBeTruthy();
});
it("preserves the direct all-support destination through sign-in", async () => {
  expect(safeReturnPath("/get-support?need=all")).toBe("/get-support?need=all");
  const destination = await GetSupportPage({ searchParams: Promise.resolve({ need: "all" }) });
  expect(destination.props.initialNeed).toBe("all");
});
