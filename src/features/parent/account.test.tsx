// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParentAccount } from "./account";
import { ParentLocaleProvider } from "./parent-locale";
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const account = {
  ok: true,
  account: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "synthetic@example.test",
    preferences: {
      contactPreference: "in_app",
      language: "en",
      quietHoursStart: 21,
      quietHoursEnd: 8,
    },
  },
};
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("parent account controls", () => {
  it("shows Spanish account controls without changing the stored program contact preference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(account)); vi.stubGlobal("fetch", fetchMock);
    render(<ParentLocaleProvider initialLocale="es"><ParentAccount /></ParentLocaleProvider>);
    expect((await screen.findByLabelText("Avisos sobre su apoyo") as HTMLSelectElement).value).toBe("in_app");
    expect((screen.getByLabelText("Idioma preferido para el servicio") as HTMLSelectElement).value).toBe("en");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Gestionar la información familiar" }).getAttribute("href")).toBe("/family-profile");
    fireEvent.change(screen.getByLabelText("Inicio"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar preferencias" }));
    await screen.findByText("Sus preferencias se guardaron para futuras solicitudes de apoyo y avisos.");
    const posted = fetchMock.mock.calls.find(call => call[1]?.method === "POST");
    expect(JSON.parse(posted![1].body)).toEqual({ action: "preferences", preferences: { ...account.account.preferences, quietHoursStart: 20 } });
    expect(screen.getByRole("link", { name: "Descargar mi información" }).getAttribute("href")).toBe("/api/parent/account/export");
  });
  it("keeps exact DELETE, owner binding and separate school access in Spanish deletion", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(account)).mockResolvedValueOnce(ok({ ok: true })).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<ParentLocaleProvider initialLocale="es"><ParentAccount /></ParentLocaleProvider>);
    fireEvent.click(await screen.findByText("Eliminar mis datos de apoyo familiar y detener el trabajo futuro"));
    const button = screen.getByRole("button", { name: "Eliminar datos de apoyo familiar y detener el trabajo" });
    fireEvent.change(screen.getByLabelText("Escriba DELETE para confirmar"), { target: { value: "ELIMINAR" } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Escriba DELETE para confirmar"), { target: { value: "DELETE" } });
    fireEvent.click(button);
    const heading = await screen.findByRole("heading", { name: "Se registró su solicitud de eliminación" });
    expect(heading).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("no pudimos confirmar el cierre de sesión"));
    expect(document.activeElement).toBe(screen.getByRole("alert"));
    expect(screen.getByText(/Su inicio de sesión actual de CaseLink y los registros escolares se mantienen separados/)).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "delete", confirmation: "DELETE", expectedOwnerId: account.account.id });
    expect(screen.queryByRole("button", { name: "Guardar preferencias" })).toBeNull();
    expect(screen.getByRole("link", { name: "Volver al inicio" }).getAttribute("href")).toBe("/");
  });
  it("brings a rejected preference save into focus without losing the chosen values", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(account)).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "We couldn’t save your preferences. Please try again." }) });
    vi.stubGlobal("fetch", fetchMock); render(<ParentAccount />);
    fireEvent.change(await screen.findByLabelText("Start"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect((screen.getByLabelText("Start") as HTMLSelectElement).value).toBe("20");
  });
  it("offers the optional family profile separately from contact and sign-in preferences", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(account)));
    render(<ParentAccount/>);
    expect((await screen.findByRole("link", { name: "Manage family information" })).getAttribute("href")).toBe("/family-profile");
    expect(screen.getByLabelText("Support updates")).toBeTruthy();
  });
  it("saves chosen notification and quiet-hour preferences through the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(account));
    vi.stubGlobal("fetch", fetchMock);
    render(<ParentAccount />);
    fireEvent.change(await screen.findByLabelText("Support updates"), {
      target: { value: "email" },
    });
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await screen.findByRole("status");
    const post = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(JSON.parse(post![1].body)).toEqual({
      action: "preferences",
      preferences: {
        contactPreference: "email",
        language: "en",
        quietHoursStart: 20,
        quietHoursEnd: 8,
      },
    });
  });
  it("requires exact deletion confirmation and preserves a sign-out warning after deletion succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(account))
      .mockResolvedValueOnce(ok({ ok: true }))
      .mockRejectedValueOnce(new Error("Connection interrupted"));
    vi.stubGlobal("fetch", fetchMock);
    render(<ParentAccount />);
    fireEvent.click(
      await screen.findByText(
        "Delete my parent-support data & stop future work",
      ),
    );
    const button = screen.getByRole("button", {
      name: "Delete parent-support data & stop work",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByText(
        /keeps your existing CaseLink sign-in and school records/,
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.click(button);
    expect(
      await screen.findByRole("heading", {
        name: "Your deletion request is recorded",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Your existing CaseLink sign-in and school records are kept separate/,
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "couldn’t confirm sign-out",
      ),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      action: "delete",
      confirmation: "DELETE",
      expectedOwnerId: "11111111-1111-4111-8111-111111111111",
    });
  });
});
