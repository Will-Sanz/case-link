import { afterEach, expect, it, vi } from "vitest";
const get = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));
import { readParentLocale } from "./locale-server";
import { PARENT_LOCALE_COOKIE } from "./locale";
afterEach(() => vi.clearAllMocks());
it("reads only the non-sensitive interface preference and validates it", async () => {
  get.mockReturnValue({ value: "es" }); expect(await readParentLocale()).toBe("es");
  get.mockReturnValue({ value: "es; other=value" }); expect(await readParentLocale()).toBe("en");
  expect(get.mock.calls).toEqual([[PARENT_LOCALE_COOKIE], [PARENT_LOCALE_COOKIE]]);
});
