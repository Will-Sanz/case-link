// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ParentShell } from "./parent-shell";
import { ParentLanding } from "./landing";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
afterEach(cleanup);

it("keeps the original recognition and complete policy/contact access on the homepage", () => {
  render(
    <ParentShell showRecognition>
      <p>Parent support</p>
    </ParentShell>,
  );
  expect(
    screen
      .getByRole("link", { name: /Selected for OpenAI's inaugural/ })
      .getAttribute("href"),
  ).toBe("https://openai.com/index/introducing-chatgpt-futures-class-of-2026/");
  expect(screen.getAllByRole("link", { name: "CaseLink home" })).toHaveLength(
    2,
  );
  const footer = within(screen.getByRole("navigation", { name: "Footer" }));
  expect(
    footer.getByRole("link", { name: "Data policy" }).getAttribute("href"),
  ).toBe("/support/privacy#data-policy");
  expect(
    footer.getByRole("link", { name: "Privacy policy" }).getAttribute("href"),
  ).toBe("/support/privacy");
  expect(
    footer.getByRole("link", { name: "Terms of service" }).getAttribute("href"),
  ).toBe("/support/terms");
  expect(
    footer.getByRole("link", { name: "Contact CaseLink" }).getAttribute("href"),
  ).toBe("mailto:willsanz23@gmail.com");
});

it("provides working food and urgent entry paths alongside the approved illustration", () => {
  render(
    <ParentShell>
      <ParentLanding />
    </ParentShell>,
  );
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
    "Food support for your family,",
  );
  expect(
    screen
      .getByRole("link", { name: /Find support for my family/ })
      .getAttribute("href"),
  ).toBe("/get-support");
  expect(
    screen.getByRole("link", { name: /Food & benefits/ }).getAttribute("href"),
  ).toBe("/get-support?need=food");
  expect(screen.queryByRole("link", { name: /Help with utility bills/ })).toBeNull();
  expect(screen.queryByRole("heading", { name: "A few things you might be wondering" })).toBeNull();
  expect(screen.queryByText(/Live assistance is preparing to launch/)).toBeNull();
  expect(
    screen
      .getByRole("link", { name: /Need immediate help/ })
      .getAttribute("href"),
  ).toBe("/support/help#urgent");
  expect(
    screen
      .getByRole("img", {
        name: /Illustration of a family unpacking groceries/,
      })
      .getAttribute("src"),
  ).toBeTruthy();
});

it("omits the recognition banner from the regular parent shell", () => {
  render(<ParentShell><p>Support page</p></ParentShell>);
  expect(screen.queryByRole("link", { name: /Selected for OpenAI's inaugural/ })).toBeNull();
});
