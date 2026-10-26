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
