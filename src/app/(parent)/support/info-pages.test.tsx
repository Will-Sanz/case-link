// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import HelpPage, * as help from "./help/page";
import PrivacyPage, * as privacy from "./privacy/page";
import TermsPage, * as terms from "./terms/page";
import { publicInfoText } from "@/lib/parent/public-info-copy";
const locale = vi.hoisted(() => ({ value: "es" as "en" | "es" }));
vi.mock("@/lib/parent/locale-server", () => ({ readParentLocale: async () => locale.value }));
vi.mock("@/features/parent/food-sites", () => ({ FoodSites: () => <p>Original food-location tool</p> }));
afterEach(() => { cleanup(); locale.value = "es"; });

it.each([
  [HelpPage, help, "Ayuda sin más obstáculos.", "Ayuda y apoyo directo"],
  [PrivacyPage, privacy, "Su información. Su control.", "Privacidad y política de datos"],
  [TermsPage, terms, "Expectativas claras para recibir apoyo.", "Términos del servicio"],
] as const)("renders the selected Spanish public information and metadata %#", async (Page, module, heading, title) => {
  const view = render(await Page());
  expect(screen.getByRole("heading", { name: heading, level: 1 })).toBeTruthy();
  expect(view.container.firstElementChild?.getAttribute("lang")).toBe("es");
  expect((await module.generateMetadata()).title).toBe(title);
});

it("preserves policy/contact/program destinations and anchor IDs in both languages", async () => {
  for (const Page of [HelpPage, PrivacyPage, TermsPage]) {
    locale.value = "en"; const english = render(await Page());
    const before = [...english.container.querySelectorAll("a")].map(link => link.getAttribute("href"));
    const anchors = [...english.container.querySelectorAll("[id]")].map(element => element.id);
    english.unmount(); locale.value = "es"; const spanish = render(await Page());
    expect([...spanish.container.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual(before);
    expect([...spanish.container.querySelectorAll("[id]")].map(element => element.id)).toEqual(anchors);
    spanish.unmount();
  }
});

it.each(["en", "es"] as const)("links policy and Help controls to existing parent routes (%s)", async value => {
  locale.value = value;
  const routes = ["/support/help", "/support/privacy", "/account", "/my-support", "/sign-in", "/forgot-password"];
  for (const path of routes) {
    const group = path === "/forgot-password" ? "" : "/(parent)";
    expect(existsSync(resolve(process.cwd(), `src/app${group}${path}/page.tsx`)), path).toBe(true);
  }
  for (const Page of [HelpPage, PrivacyPage, TermsPage]) {
    const view = render(await Page());
    for (const link of view.container.querySelectorAll('a[href^="/"]')) {
      expect(routes, link.textContent ?? "").toContain(new URL(link.getAttribute("href")!, "https://caselink.test").pathname);
    }
    expect(view.container.querySelector('a[href="/support/help"], a[href="/support/privacy"]')).not.toBeNull();
    view.unmount();
  }
});

it.each(["en", "es"] as const)("lets the food tool use the selected display language without an outdated English-only notice (%s)", async value => {
  locale.value = value;
  render(await HelpPage());
  expect(screen.getByText("Original food-location tool").closest("[lang]")?.getAttribute("lang")).toBe(value);
  expect(screen.queryByText(/The food-location tool below remains in English|La herramienta para buscar lugares con alimentos que aparece abajo sigue en inglés/)).toBeNull();
});

it("keeps purpose closure and distinct family, application, protected and proposed retention limits in Spanish", async () => {
  const view = render(await PrivacyPage()), text = view.container.textContent!;
  expect(text).toContain("El procesamiento de datos personales reales no está abierto de forma predeterminada");
  for (const period of ["45 días", "90 días", "30 días", "365 días", "siete días", "24 horas"]) expect(text).toContain(period);
  expect(text).toContain("calendario propuesto");
  expect(text).toContain("no es una prueba de que se haya completado la eliminación");
  expect(text).toContain("no constituye una aprobación de Retención Cero de Datos");
  expect(screen.getByRole("link", { name: "willsanz23@gmail.com" }).getAttribute("href")).toBe("mailto:willsanz23@gmail.com");
});

it.each(["__proto__", "constructor", "toString"])("keeps unknown public copy as text: %s", key => {
  expect(publicInfoText("es", key)).toBe(key);
});
