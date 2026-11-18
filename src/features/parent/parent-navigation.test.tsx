// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ParentNavigation } from "./parent-navigation";
vi.mock("next/navigation", () => ({
  usePathname: () => "/support/11111111-1111-4111-8111-111111111111",
}));
afterEach(cleanup);
it("marks the support location and closes the mobile menu when a route is chosen", () => {
  render(<ParentNavigation signedIn />);
  const mobile = screen.getByRole("navigation", { name: "Mobile navigation" });
  const details = mobile.closest("details")!;
  details.open = true;
  const supportLink = within(mobile).getByRole("link", { name: "My support" });
  expect(supportLink.getAttribute("aria-current")).toBe("page");
  supportLink.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(supportLink);
  expect(details.open).toBe(false);
});
it("offers private family information in both signed-in navigation layouts", () => {
  render(<ParentNavigation signedIn/>);
  for (const name of ["Main navigation", "Mobile navigation"])
    expect(within(screen.getByRole("navigation", { name })).getByRole("link", { name: "Family information" }).getAttribute("href")).toBe("/family-profile");
});
it("keeps the private family information entry out of signed-out navigation", () => {
  render(<ParentNavigation signedIn={false}/>);
  expect(screen.queryByRole("link", { name: "Family information" })).toBeNull();
});
