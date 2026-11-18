// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ParentApiError } from "./api";
import { ServiceError } from "./feedback";
import { ParentLocaleProvider } from "./parent-locale";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

it.each(["en", "es"] as const)("describes a temporary source failure without claiming the whole service has not launched (%s)", locale => {
  const retry = vi.fn();
  render(<ParentLocaleProvider initialLocale={locale}><ServiceError error={new ParentApiError("City listings unavailable.", 503)} retry={retry}/></ParentLocaleProvider>);
  expect(screen.getByRole("alert").textContent).toContain(locale === "es" ? "No pudimos completar este paso" : "We couldn’t finish this step");
  expect(screen.queryByText(/Live support isn’t available yet|El servicio conectado aún no está disponible/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: locale === "es" ? "Intentarlo de nuevo" : "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link").getAttribute("href")).toBe("/support/help");
});
