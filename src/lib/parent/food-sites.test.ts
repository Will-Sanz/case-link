import { afterEach, describe, expect, it, vi } from "vitest";
import { findFoodSites, findShareFoodAccessObservation } from "./food-sites";

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
const shareSite = { ...site, objectid: 122, site_name: "Share Food Program Community Fridge & Pantry",
  address: "2901 W Hunting Park Ave", zip_code: "19129", hours_mon_start1: null, hours_mon_end1: null, hours_mon_exceptions: null };
afterEach(() => vi.unstubAllGlobals());
describe("real City food directory boundary", () => {
  it.each([
    [{ status: "Permanently Closed" }, "closed"], [{ temporary_closure: "yes" }, "closed"],
    [{ seasonally_closed: "yes" }, "closed"], [{ category_type: "Delivery Only" }, "delivery_only"],
    [{ hours_mon_start1: "09:00", hours_mon_end1: "11:00" }, "conflicting_hours"],
    [{}, "listed_unconfirmed"],
  ])("checks the fixed Share record, including closure evidence excluded by the general Active query %#", async (change, state) => {
    const current = { ...shareSite, ...change };
    const fetcher = vi.fn<typeof fetch>(async () => payload([current]));
    expect(await findShareFoodAccessObservation(fetcher)).toMatchObject({ recordId: 122, state });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("where")).toBe("objectid=122");
    expect(url.searchParams.get("resultRecordCount")).toBe("1");
  });
  it.each([
    { address: "999 Other Avenue" }, { site_name: "Unrelated Food Operator" }, { category_type: "School Meal Site" },
    { category_type: "Senior Meal Site" }, { zip_code: "19104" }, { site_name: "" }, { address: "" },
  ])("blocks stale Share instructions when the selected City record changes identity or service %#", async change => {
    expect(await findShareFoodAccessObservation(async () => payload([{ ...shareSite, ...change }])))
      .toMatchObject({ recordId: 122, state: "identity_conflict" });
  });
  it("does not hide a moved record behind the old ZIP query filter", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const where = new URL(String(input)).searchParams.get("where");
      return payload(where === "objectid=122" ? [{ ...shareSite, zip_code: "19104" }] : []);
    };
    expect(await findShareFoodAccessObservation(fetcher)).toMatchObject({ state: "identity_conflict" });
  });
  it.each(["Not open 24 hours", "24 hours except Monday", "Open 24/7 except holidays"])("does not erase the actual City hours exception: %s", async note => {
    expect(await findShareFoodAccessObservation(async () => payload([{ ...shareSite,hours_mon_exceptions:note }])))
      .toMatchObject({ state:"conflicting_hours" });
  });
  it.each([{ hours_mon_start1:"9am" },{ hours_mon_end1:"6pm" },{ hours_mon_start1:9 }])("does not discard incomplete or malformed selected-site hours %#",async change=>{
    expect(await findShareFoodAccessObservation(async()=>payload([{ ...shareSite,...change }]))).toMatchObject({ state:"conflicting_hours" });
  });
  it.each(["Open 24 hours","24/7"])("retains only an unambiguous all-day note: %s",async note=>{
    expect(await findShareFoodAccessObservation(async()=>payload([{ ...shareSite,hours_mon_exceptions:note }]))).toMatchObject({ state:"listed_unconfirmed" });
  });
  it.each([
    { site_name: "Share Community Fridge", address: "2901 W Hunting Park Ave", category_type: "Food Site" },
    { site_name: "SHARE FOOD PROGRAM COMMUNITY FRIDGE & PANTRY", address: "2901 W. HUNTING PARK AVENUE", category_type: "food site" },
    { site_name: "Share Food Program Community Fridge and Pantry", address: "2901 West Hunting Park Avenue, Philadelphia, PA 19129", category_type: "Community Fridge" },
  ])("keeps the observed City identity and documented operator alias compatible %#", async change => {
    expect(await findShareFoodAccessObservation(async () => payload([{ ...shareSite, ...change }])))
      .toMatchObject({ recordId: 122, state: "listed_unconfirmed" });
  });
  it("keeps absent and failed City retrieval distinct from a known closure and omits another record's status", async () => {
    expect(await findShareFoodAccessObservation(async () => payload([{ ...site, objectid: 123, zip_code: "19129", temporary_closure: "yes" }]))).toMatchObject({ state: "not_returned" });
    expect(await findShareFoodAccessObservation(async () => new Response("unavailable", { status: 503 }))).toMatchObject({ state: "unavailable" });
  });
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
