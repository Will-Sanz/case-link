import { afterEach, describe, expect, it, vi } from "vitest";
import { findFoodSites } from "./food-sites";

const site = {
  objectid: 71,
  site_name: "Synthetic source site",
  address: "Test location",
  zip_code: "19104",
  status: "Active",
  temporary_closure: null,
  seasonally_closed: null,
  category_type: "Food Site",
  website: "https://example.org/",
  phone_number: "(215) 555-0100",
  hours_mon_start1: "09:30",
  hours_mon_end1: "11:30",
  hours_mon_exceptions: "Call first",
  zip_code_exceptions: "Confirm the service area",
  unrelated_private_field: "SHOULD-NOT-BE-RETURNED",
};
const payload = (attributes: Record<string, unknown>[]) =>
  Response.json({ features: attributes.map((row) => ({ attributes: row })) });
afterEach(() => vi.unstubAllGlobals());
describe("real City food directory boundary", () => {
  it("queries only the fixed City API with a validated ZIP and returns attributed public facts", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => payload([site]));
    vi.stubGlobal("fetch", fetcher);
    const result = await findFoodSites("19104");
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin).toBe("https://services.arcgis.com");
    expect(url.searchParams.get("where")).toBe(
      "zip_code='19104' AND status='Active'",
    );
    expect(url.searchParams.get("outFields")).not.toContain("email");
    expect(result).toMatchObject({
      sourceUrl: "https://www.phila.gov/food/",
      availability: "city_listed_unconfirmed",
      moreSitesAvailable: false,
      sites: [
        {
          id: 71,
          name: site.site_name,
          hours: [
            { day: "mon", windows: ["09:30–11:30"], notes: "Call first" },
          ],
          serviceAreaNotes: "Confirm the service area",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("SHOULD-NOT-BE-RETURNED");
  });
  it("does not show closed, wrong-area or malformed sites, or unsafe links", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        payload([
          { ...site, status: "Permanently Closed" },
          { ...site, temporary_closure: "yes" },
          { ...site, seasonally_closed: "yes" },
          { ...site, zip_code: "19103" },
          { ...site, site_name: "" },
          { ...site, website: "javascript:alert(1)", phone_number: "bad link" },
        ]),
      ),
    );
    expect((await findFoodSites("19104")).sites).toMatchObject([
      { id: 71, website: null, phoneNumber: null },
    ]);
  });
  it("rejects ZIP injection before any network request and fails visibly on real source errors", async () => {
    const fetcher = vi.fn(async () => payload([]));
    vi.stubGlobal("fetch", fetcher);
    await expect(findFoodSites("19104' OR 1=1")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(Response.json({ error: { code: 500 } }));
    await expect(findFoodSites("19104")).rejects.toThrow();
    fetcher.mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(findFoodSites("19104")).rejects.toThrow("food_directory");
    fetcher.mockResolvedValue(new Response("x".repeat(512001)));
    await expect(findFoodSites("19104")).rejects.toThrow();
  });
});
