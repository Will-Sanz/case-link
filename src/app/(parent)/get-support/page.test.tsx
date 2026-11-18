// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import GetSupportPage from "./page";
import { safeReturnPath } from "@/features/parent/api";

afterEach(cleanup);
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
