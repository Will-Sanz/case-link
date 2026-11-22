// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoodSites } from "./food-sites";
import { ParentLocaleProvider, useParentLocale } from "./parent-locale";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
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
  it("keeps the reviewed fridge distinct from a reservation, stock or delivery-only listing", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<FoodSites />);
    fireEvent.click(screen.getByText("More food and WIC resources"));
    expect(screen.getByText(/2901 W. Hunting Park Avenue/)).toBeTruthy();
    expect(screen.getByText(/stock is unknown and nothing is reserved/)).toBeTruthy();
    expect(screen.getByText(/Other fridges can have different hours/)).toBeTruthy();
    expect(screen.getByText(/Some finder locations offer delivery only/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read Share’s fridge access instructions" }).getAttribute("href")).toBe("https://www.sharefoodprogram.org/community-fridges/");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["en", "More food and WIC resources", "Feeding America’s WIC guide", "Request a Pennsylvania WIC appointment"],
    ["es", "Más recursos de alimentos y WIC", "Guía de WIC de Feeding America", "Solicitar una cita de WIC en Pensilvania"],
  ] as const)("offers the four forwarded resources and the official state WIC action without lookup in %s", (locale, summary, guide, appointment) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<ParentLocaleProvider initialLocale={locale}><FoodSites /></ParentLocaleProvider>);
    fireEvent.click(screen.getByText(summary));
    const destinations = screen.getAllByRole("link").map(link => link.getAttribute("href"));
    expect(destinations).toEqual(expect.arrayContaining([
      "https://www.phila.gov/food/",
      "https://www.sharefoodprogram.org/community-fridges/",
      "https://www.feedingamerica.org/need-help-find-food",
      "https://www.feedingamerica.org/need-help-find-food/wic",
    ]));
    expect(screen.getByRole("link", { name: guide }).getAttribute("href")).toBe("https://www.feedingamerica.org/need-help-find-food/wic");
    expect(screen.getByRole("link", { name: appointment }).getAttribute("href")).toBe("https://www.pa.gov/services/health/request-a-pre-application-appointment-with-a-wic-specialist");
    expect(fetch).not.toHaveBeenCalled();
  });
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

describe("Spanish public food listings", () => {
  it("localizes directory guidance and dates while preserving original source names, notes and links", async () => {
    const fetch = vi.fn().mockResolvedValue(response(result)); vi.stubGlobal("fetch", fetch);
    render(<ParentLocaleProvider initialLocale="es"><FoodSites zip="19104"/></ParentLocaleProvider>);
    await screen.findByRole("heading", { name: "City-listed location" });
    expect(screen.getByRole("heading", { name: "Alimentos cerca de su código postal" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Llamar al 215-555-0123" }).getAttribute("href")).toBe("tel:2155550123");
    fireEvent.click(screen.getByText("Horarios y detalles publicados"));
    expect(screen.getByText("Lunes")).toBeTruthy();
    expect(screen.getByText("Confirm who this site serves.").getAttribute("lang")).toBe("");
    expect(screen.getByRole("heading", { name: "City-listed location" }).getAttribute("lang")).toBe("");
    expect(document.body.textContent).toContain("26 oct");
    expect(fetch.mock.calls[0][0]).toBe("/api/parent/food-sites?zip=19104");
    expect(screen.getByText(/no es una reserva ni una recogida confirmada/)).toBeTruthy();
  });
  it("keeps public urgent access and empty-result alternatives readable without an account", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...result, sites: [] })); vi.stubGlobal("fetch", fetch);
    render(<ParentLocaleProvider initialLocale="es"><FoodSites/></ParentLocaleProvider>);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Código postal de Filadelfia"), { target: { value: "19104" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar lugares con alimentos" }));
    await screen.findByText(/Puede haber ayuda en lugares cercanos/);
    expect(screen.getByRole("link", { name: "Abrir el buscador de alimentos de la Ciudad" }).getAttribute("href")).toBe("https://www.phila.gov/food/");
    expect(fetch.mock.calls.every(call => !String(call[0]).includes("account"))).toBe(true);
  });
  it("links an invalid ZIP error to the input without making a source request", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<ParentLocaleProvider initialLocale="es"><FoodSites/></ParentLocaleProvider>);
    const input = screen.getByLabelText("Código postal de Filadelfia");
    fireEvent.change(input, { target: { value: "19000" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar lugares con alimentos" }));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    expect(screen.getByRole("alert").textContent).toContain("191");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("changes display language without re-fetching or losing the searched ZIP and expanded locations", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...result, sites: Array.from({ length: 4 }, (_, i) => ({ ...result.sites[0], id: i + 1, name: `Source location ${i + 1}` })) })); vi.stubGlobal("fetch", fetch);
    function Switch() { const { chooseLocale } = useParentLocale(); return <button onClick={() => chooseLocale("es")}>Español</button>; }
    render(<ParentLocaleProvider initialLocale="en"><Switch/><FoodSites/></ParentLocaleProvider>);
    const input = screen.getByLabelText("Philadelphia ZIP code");
    fireEvent.change(input, { target: { value: "19104" } }); fireEvent.click(screen.getByRole("button", { name: "Find food locations" }));
    await screen.findByRole("heading", { name: "Source location 1" });
    fireEvent.click(screen.getByRole("button", { name: "See 1 more city-listed locations" }));
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    expect((screen.getByLabelText("Código postal de Filadelfia") as HTMLInputElement).value).toBe("19104");
    expect(screen.getByRole("button", { name: "Mostrar menos lugares" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading", { name: "Source location 4" })).toBeTruthy();
    expect(document.body.textContent).toContain("26 oct");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
