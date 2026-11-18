// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HelpPage from "./page";
const locale = vi.hoisted(() => ({ value: "en" as "en" | "es" }));
vi.mock("@/lib/parent/locale-server", () => ({ readParentLocale: async () => locale.value }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  locale.value = "en";
});

it("explains password recovery when reusing existing CaseLink accounts", async () => {
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
  vi.stubEnv("CASELINK_PARENT_EMAIL_CODE_ENABLED", "1");
  render(await HelpPage());
  expect(
    screen.getByText(
      /For an existing CaseLink school account, use your email and password/,
    ),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "reset your existing password" })
      .getAttribute("href"),
  ).toBe("/forgot-password?ui=en");
  expect(
    screen.getByText(/it does not replace a school account’s password check/),
  ).toBeTruthy();
});

it("keeps password recovery and safety guidance without offering disabled email-code sign-in", async () => {
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
  vi.stubEnv("CASELINK_PARENT_EMAIL_CODE_ENABLED", "0");
  render(await HelpPage());
  expect(
    screen.getByRole("link", { name: "reset your existing password" }),
  ).toBeTruthy();
  expect(screen.queryByText(/Email-code sign-in is available/)).toBeNull();
  expect(screen.queryByText(/Use an email code instead/)).toBeNull();
  expect(screen.getByText(/Never share your password or codes/)).toBeTruthy();
});

it("keeps the email-code path without offering an unrelated school reset", async () => {
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "isolated");
  render(await HelpPage());
  expect(screen.getByText(/If you use email-code sign-in/)).toBeTruthy();
  expect(
    screen.queryByRole("link", { name: "reset your existing password" }),
  ).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Return to sign in" })
      .getAttribute("href"),
  ).toBe("/sign-in");
});
it("uses the same original recovery site as sign-in in the connected preview", async () => {
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
  vi.stubEnv("CASELINK_ENVIRONMENT", "connected");
  vi.stubEnv(
    "CASELINK_PARENT_RECOVERY_SITE_URL",
    "https://www.thecaselink.com",
  );
  render(await HelpPage());
  expect(
    screen
      .getByRole("link", { name: "reset your existing password" })
      .getAttribute("href"),
  ).toBe("https://www.thecaselink.com/forgot-password?ui=en");
});
it("carries Spanish to the original recovery host without changing its account purpose", async () => {
  locale.value = "es";
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing"); vi.stubEnv("CASELINK_ENVIRONMENT", "connected");
  vi.stubEnv("CASELINK_PARENT_RECOVERY_SITE_URL", "https://www.thecaselink.com");
  render(await HelpPage());
  expect(screen.getByRole("link", { name: "restablezca su contraseña actual" }).getAttribute("href")).toBe("https://www.thecaselink.com/forgot-password?ui=es");
  expect(screen.getByText(/No comparta nunca su contraseña ni sus códigos/)).toBeTruthy();
});
