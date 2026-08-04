/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LegalDocumentBody } from "@/components/layout/legal-doc-layout";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { DemoRequestForm } from "@/features/marketing/demo-request-form";
import { HomePageContent } from "@/features/marketing/home-page-content";
import { ProductPageContent } from "@/features/marketing/product-page-content";

describe("public site content contract", () => {
  it("keeps the approved homepage language and OpenAI recognition without the rejected warning", () => {
    const { container } = render(
      <PublicSiteShell>
        <HomePageContent />
      </PublicSiteShell>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Turn family needs into clear plans and prepared paperwork.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", {
        name: /Selected for OpenAI's inaugural ChatGPT Futures Class of 2026/,
      }),
    ).toBeTruthy();
    expect(screen.getByText("Supported through an OpenAI grant")).toBeTruthy();
    expect(
      screen.queryByText(/CaseLink prepares paperwork for human review and manual submission/i),
    ).toBeNull();

    const icons = Array.from(container.querySelectorAll("svg"));
    expect(icons.length).toBeGreaterThan(0);
    expect(icons.every((icon) => icon.classList.contains("lucide"))).toBe(true);

    const workflow = container.querySelector("#workflow");
    expect(workflow).toBeTruthy();
    expect(workflow?.querySelectorAll("svg")).toHaveLength(0);

    expect(screen.getByRole("link", { name: "Learn More" }).getAttribute("href")).toBe("/product");
    expect(screen.getByRole("link", { name: "Request a Demo" }).getAttribute("href")).toBe("/request-demo");

    const primaryNavigation = screen.getByRole("navigation", { name: "Primary" });
    expect(primaryNavigation.textContent).not.toContain("How it works");
    expect(primaryNavigation.textContent).not.toContain("For districts");
    expect(
      Array.from(primaryNavigation.querySelectorAll("a"), (link) => link.textContent?.trim()),
    ).toEqual(["Product", "Sign in", "Request a demo"]);
    expect(
      screen.queryByRole("heading", {
        level: 2,
        name: "The administrative work should not crowd out the human work.",
      }),
    ).toBeNull();
    expect(screen.getAllByRole("link", { name: "Request a demo" }).length).toBeGreaterThan(0);
  });

  it("keeps the current product, demo, and legal page language", () => {
    const { rerender } = render(<ProductPageContent />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "A review process, not a black box.",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("What CaseLink offers")).toBeNull();
    expect(
      screen.queryByRole("heading", {
        level: 2,
        name: "Let's look at your current paperwork process.",
      }),
    ).toBeNull();
    expect(screen.getByRole("img", { name: "Three members of the CaseLink team" })).toBeTruthy();

    rerender(<DemoRequestForm />);
    expect(screen.getByRole("button", { name: "Open email draft" })).toBeTruthy();
    expect(screen.getByLabelText("School or district")).toBeTruthy();

    rerender(
      <LegalDocumentBody title="Privacy Policy" lastUpdated="April 2026">
        <p>Policy body</p>
      </LegalDocumentBody>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy();
    expect(screen.getByText("Last updated: April 2026")).toBeTruthy();
  });
});
