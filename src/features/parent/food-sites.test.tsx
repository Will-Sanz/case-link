// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoodSites } from "./food-sites";
const result = {
  sites: [
    {
      id: 1,
      name: "City-listed location",
      address: "100 Example Street",
      zip: "19104",
      category: "Senior Meal Site",
      phoneNumber: "215-555-0123",
      website: "https://example.test/",
      hours: [{ day: "mon", windows: ["09:00–11:00"], notes: "Call first" }],
      serviceAreaNotes: "Confirm who this site serves.",
    },
  ],
  sourceUrl: "https://www.phila.gov/food/",
  checkedAt: "2026-10-26T16:00:00Z",
  availability: "city_listed_unconfirmed",
  moreSitesAvailable: false,
};
const response = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("connected City food listings", () => {
  it("keeps a long directory compact while making every returned location available", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({
            ...result,
            sites: Array.from({ length: 6 }, (_, i) => ({
              ...result.sites[0],
              id: i + 1,
              name: `City-listed site ${i + 1}`,
            })),
          }),
        ),
    );
    render(<FoodSites zip="19104" />);
    await screen.findByRole("heading", { name: "City-listed site 1" });
    expect(
      screen.queryByRole("heading", { name: "City-listed site 4" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "See 3 more city-listed locations" }),
    );
    expect(
      screen.getByRole("heading", { name: "City-listed site 6" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Show fewer locations" }),
    );
    expect(
      screen.queryByRole("heading", { name: "City-listed site 4" }),
    ).toBeNull();
  });
  it("loads corrected request ZIP information without retaining the old location list", async () => {
    const fetch = vi.fn().mockResolvedValue(response(result));
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<FoodSites zip="19104" />);
    await screen.findByRole("heading", { name: "City-listed location" });
    fetch.mockResolvedValue(response({ ...result, sites: [] }));
    rerender(<FoodSites zip="19103" />);
    expect(
      await screen.findByText(
        /No current City listings were returned for 19103/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "City-listed location" }),
    ).toBeNull();
    expect(fetch.mock.calls.at(-1)?.[0]).toBe(
      "/api/parent/food-sites?zip=19103",
    );
  });
  it("reads exact ZIP listings, retains eligibility and hours, and never implies confirmed food", async () => {
    const fetch = vi.fn().mockResolvedValue(response(result));
    vi.stubGlobal("fetch", fetch);
    render(<FoodSites zip="19104" />);
    expect(
      await screen.findByRole("heading", { name: "City-listed location" }),
    ).toBeTruthy();
    expect(fetch.mock.calls[0][0]).toBe("/api/parent/food-sites?zip=19104");
    expect(screen.getByText("Senior Meal Site")).toBeTruthy();
    expect(
      screen.getByText(/not a reservation or a confirmed pickup/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Call 215-555-0123" })
        .getAttribute("href"),
    ).toBe("tel:2155550123");
    fireEvent.click(screen.getByText("Listed hours & service details"));
    expect(screen.getByText("Monday")).toBeTruthy();
    expect(screen.getByText("Confirm who this site serves.")).toBeTruthy();
  });
  it("accepts a public ZIP search without collecting household details or requiring an account", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...result, sites: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<FoodSites />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Philadelphia ZIP code"), {
      target: { value: "19104" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Find food locations" }),
    );
    expect(
      await screen.findByText(/Nearby help may still be available/),
    ).toBeTruthy();
    expect(
      fetch.mock.calls.every((call) => !String(call[0]).includes("account")),
    ).toBe(true);
  });
  it("keeps official access available when the source is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ ok: false, error: "City listings unavailable." }, 503),
        ),
    );
    render(<FoodSites zip="19104" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open the City’s full food finder" })
        .getAttribute("href"),
    ).toBe("https://www.phila.gov/food/");
    expect(screen.queryByText("City-listed location")).toBeNull();
  });
});
