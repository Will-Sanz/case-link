// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HelpPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("explains password recovery when reusing existing CaseLink accounts", () => {
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
  vi.stubEnv("CASELINK_PARENT_EMAIL_CODE_ENABLED", "1");
  render(<HelpPage />);
  expect(
    screen.getByText(
      /For an existing CaseLink school account, use your email and password/,
    ),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "reset your existing password" })
      .getAttribute("href"),
  ).toBe("/forgot-password");
  expect(
    screen.getByText(/it does not replace a school account’s password check/),
  ).toBeTruthy();
});

it("keeps password recovery and safety guidance without offering disabled email-code sign-in", () => {
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
  vi.stubEnv("CASELINK_PARENT_EMAIL_CODE_ENABLED", "0");
  render(<HelpPage />);
  expect(
    screen.getByRole("link", { name: "reset your existing password" }),
  ).toBeTruthy();
  expect(screen.queryByText(/Email-code sign-in is available/)).toBeNull();
  expect(screen.queryByText(/Use an email code instead/)).toBeNull();
  expect(screen.getByText(/Never share your password or codes/)).toBeTruthy();
});

it("keeps the email-code path without offering an unrelated school reset", () => {
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "isolated");
  render(<HelpPage />);
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
