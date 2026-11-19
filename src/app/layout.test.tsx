import { afterEach, expect, it, vi } from "vitest";
const readLocale = vi.hoisted(() => vi.fn(async () => "es"));
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "synthetic-font" } }));
vi.mock("@/lib/parent/locale-server", () => ({ readParentLocale: readLocale }));
import RootLayout from "./layout";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("renders the parent document in the validated browser locale", async () => {
  vi.stubEnv("CASELINK_PRODUCT", "parent");
  const page = await RootLayout({ children: "Synthetic child" });
  expect(page.props.lang).toBe("es");
  expect(readLocale).toHaveBeenCalledOnce();
});
it("preserves the legacy document language and does not read a parent preference", async () => {
  vi.stubEnv("CASELINK_PRODUCT", "school");
  const page = await RootLayout({ children: "Synthetic child" });
  expect(page.props.lang).toBe("en");
  expect(readLocale).not.toHaveBeenCalled();
  expect(page.props.children.props.children).toBe("Synthetic child");
});
