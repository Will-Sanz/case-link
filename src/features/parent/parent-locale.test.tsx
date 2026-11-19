// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ParentLanguageSelector, ParentLocaleProvider, ParentRecoveryLocale, useParentLocale } from "./parent-locale";
import { ParentSignIn } from "./sign-in";
import { PARENT_LOCALE_COOKIE } from "@/lib/parent/locale";
import { ParentLoading } from "./feedback";
import { ParentShell } from "./parent-shell";
const { refresh, replace } = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }), usePathname: () => "/get-support" }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); document.cookie = `${PARENT_LOCALE_COOKIE}=; Path=/; Max-Age=0`; document.documentElement.lang = "en"; });
function Probe() { const { t } = useParentLocale(); return <h1>{t("Get support")}</h1>; }
it("marks unfinished body as English while translated sign-in and assistant use Spanish", () => {
  render(<ParentLocaleProvider initialLocale="es"><ParentShell><h1>Household ZIP code</h1><ParentSignIn emailCodeAvailable={false} /></ParentShell></ParentLocaleProvider>);
  expect(screen.getByText("Household ZIP code").closest("[lang]")?.getAttribute("lang")).toBe("en");
  expect(screen.getByLabelText("Su dirección de correo electrónico").closest("[lang]")?.getAttribute("lang")).toBe("es");
  expect(screen.getByRole("button", { name: "Pedir ayuda a CaseLink" }).closest("[lang]")?.getAttribute("lang")).toBe("es");
});
it("translates both the accessible loading name and its hidden text", () => {
  render(<ParentLocaleProvider initialLocale="es"><ParentLoading /></ParentLocaleProvider>);
  const status = screen.getByRole("status", { name: "Cargando su apoyo" });
  expect(status.textContent).toBe("Cargando su apoyo…");
  expect(status.getAttribute("lang")).toBe("es");
});
it("restores the original document language after temporary recovery leaves the school page", () => {
  document.documentElement.lang = "en";
  const view = render(<ParentRecoveryLocale requestedLocale="es"><Probe /></ParentRecoveryLocale>);
  expect(document.documentElement.lang).toBe("es");
  view.unmount();
  expect(document.documentElement.lang).toBe("en");
});
it.each(["/forgot-password?ui=es&next=%2Faccount#synthetic", "/reset-password?mode=recovery&ui=es&next=%2Faccount#synthetic"])("updates the recovery locale URL on an explicit choice without changing its other fields: %s", path => {
  window.history.replaceState(null, "", path);
  render(<ParentLocaleProvider initialLocale="es"><ParentLanguageSelector /><Probe /></ParentLocaleProvider>);
  fireEvent.change(screen.getByLabelText(/Idioma de pantalla/), { target: { value: "en" } });
  expect(replace).toHaveBeenCalledWith(path.replace("ui=es", "ui=en"), { scroll: false });
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Get support" })).toBeTruthy();
});
it("synchronizes a recovery link's display preference without navigating to the same URL again", () => {
  window.history.replaceState(null, "", "/forgot-password?ui=es");
  render(<ParentLocaleProvider initialLocale="en"><ParentRecoveryLocale requestedLocale="es"><Probe /></ParentRecoveryLocale></ParentLocaleProvider>);
  expect(screen.getByRole("heading", { name: "Pedir apoyo" })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("changes display and the locale-only cookie without a service write", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  render(<ParentLocaleProvider initialLocale="en"><ParentLanguageSelector /><Probe /></ParentLocaleProvider>);
  fireEvent.change(screen.getByLabelText(/Screen language/), { target: { value: "es" } });
  expect(screen.getByRole("heading", { name: "Pedir apoyo" })).toBeTruthy();
  await waitFor(() => expect(document.documentElement.lang).toBe("es"));
  expect(document.cookie).toContain(`${PARENT_LOCALE_COOKIE}=es`);
  expect(refresh).toHaveBeenCalledTimes(1); expect(fetcher).not.toHaveBeenCalled();
});
it("renders Spanish sign-in and keeps a safe translated failure with the original status", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ ok: false, error: "Too many sign-in attempts. Wait a few minutes and try again." }) }));
  render(<ParentLocaleProvider initialLocale="es"><ParentSignIn emailCodeAvailable={false} /></ParentLocaleProvider>);
  fireEvent.change(screen.getByLabelText("Su dirección de correo electrónico"), { target: { value: "synthetic@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "synthetic-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Demasiados intentos");
});
it("keeps public language choice usable when browser preference storage throws", () => {
  const setter = vi.spyOn(Document.prototype, "cookie", "set").mockImplementation(() => { throw new Error("Synthetic cookie restriction"); });
  try {
    render(<ParentLocaleProvider initialLocale="en"><ParentLanguageSelector /><Probe /></ParentLocaleProvider>);
    fireEvent.change(screen.getByLabelText(/Screen language/), { target: { value: "es" } });
    expect(screen.getByRole("heading", { name: "Pedir apoyo" })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  } finally { setter.mockRestore(); }
});
it("keeps the chosen display when a browser silently rejects the preference cookie", () => {
  const setter = vi.spyOn(Document.prototype, "cookie", "set").mockImplementation(() => {});
  try {
    render(<ParentLocaleProvider initialLocale="en"><ParentLanguageSelector /><Probe /></ParentLocaleProvider>);
    fireEvent.change(screen.getByLabelText(/Screen language/), { target: { value: "es" } });
    expect(screen.getByRole("heading", { name: "Pedir apoyo" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("es");
    expect(refresh).not.toHaveBeenCalled();
  } finally { setter.mockRestore(); }
});
it("uses one inherited choice when an original recovery link carries a locale", async () => {
  render(<ParentLocaleProvider initialLocale="en"><ParentRecoveryLocale requestedLocale="es"><ParentLanguageSelector /><Probe /></ParentRecoveryLocale></ParentLocaleProvider>);
  expect(await screen.findByRole("heading", { name: "Pedir apoyo" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Idioma de pantalla/), { target: { value: "en" } });
  expect(screen.getByRole("heading", { name: "Get support" })).toBeTruthy();
  expect(document.documentElement.lang).toBe("en");
});
