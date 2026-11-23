import { afterEach, expect, it, vi } from "vitest";
const { get, acceptLanguage } = vi.hoisted(() => ({ get: vi.fn(), acceptLanguage: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get }), headers: async () => ({ get: acceptLanguage }) }));
import { readParentLocale } from "./locale-server";
import { PARENT_LOCALE_COOKIE } from "./locale";
afterEach(() => vi.resetAllMocks());
it("reads only the non-sensitive interface preference and validates it", async () => {
  acceptLanguage.mockReturnValue("en-US");
  get.mockReturnValue({ value: "es" }); expect(await readParentLocale()).toBe("es");
  expect(acceptLanguage).not.toHaveBeenCalled();
  get.mockReturnValue({ value: "es; other=value" }); expect(await readParentLocale()).toBe("en");
  expect(get.mock.calls).toEqual([[PARENT_LOCALE_COOKIE], [PARENT_LOCALE_COOKIE]]);
});

it.each([
  ["fr-CA, es-US;q=0.8, en;q=0.6", "es"],
  ["es-MX;q=0.3, en-GB;q=0.9", "en"],
  ["ES-MX, en-US", "es"],
  ["es;q=0, es-MX;q=2, fr", "en"],
  [null, "en"],
])("matches the first supported preference by quality for %s", async (header, locale) => {
  acceptLanguage.mockReturnValue(header);
  expect(await readParentLocale()).toBe(locale);
});
