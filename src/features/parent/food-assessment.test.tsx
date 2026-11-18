// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoodAssessment } from "./food-assessment";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function answer(label: RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
describe("public guided food entry", () => {
  it("moves keyboard focus to results and back to the first answer when editing", async () => {
    render(<FoodAssessment />); answer(/enough food/, "no"); answer(/help paying/, "applied");
    fireEvent.click(screen.getByRole("button", { name: "See my options" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your proposed next steps" })));
    fireEvent.click(screen.getByRole("button", { name: "Change my answers" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/enough food/)));
  });
  it.each(["en", "es"])("lets someone whose benefits ended answer honestly in %s", language => {
    render(<FoodAssessment />);
    fireEvent.change(screen.getByLabelText("Language / Idioma"), { target: { value: language } });
    expect(screen.getByRole("option", { name: language === "en" ? /received it before/ : /la recibí antes/ })).toBeTruthy();
    answer(language === "en" ? /enough food/ : /suficiente comida/, "yes");
    answer(language === "en" ? /help paying/ : /ayuda para comprar/, "receiving");
    answer(language === "en" ? /What has happened/ : /Qué ha ocurrido/, "stopped");
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "See my options" : "Ver mis opciones" }));
    expect(screen.getByRole("link", { name: language === "en" ? "Help with SNAP benefits" : "Ayuda con los beneficios de SNAP" }).getAttribute("href")).toBe("/get-support?need=snap_problem");
    expect(screen.queryByRole("link", { name: language === "en" ? "Apply for SNAP" : "Solicitar SNAP" })).toBeNull();
  });

  it("offers urgent help without account access and routes a waiting family without another application", () => {
    render(<FoodAssessment />);
    expect(screen.getByRole("link", { name: "Find food now" }).getAttribute("href")).toBe("https://www.phila.gov/food/");
    answer(/enough food/, "no"); answer(/help paying/, "applied");
    fireEvent.click(screen.getByRole("button", { name: "See my options" }));
    expect(screen.getByRole("link", { name: "Check a pending application" }).getAttribute("href")).toBe("/get-support?need=snap_pending");
    expect(screen.getByRole("link", { name: "Food for now" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Apply for SNAP" })).toBeNull();
    expect(screen.getByText(/Nothing has started/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("clears the old branch after a correction, retains unrelated answers and treats unknown as unknown", () => {
    render(<FoodAssessment />);
    answer(/enough food/, "no"); answer(/help paying/, "receiving"); answer(/What has happened/, "renewal");
    fireEvent.click(screen.getByRole("button", { name: "See my options" }));
    expect(screen.getByRole("link", { name: "Renew SNAP" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change my answers" }));
    answer(/help paying/, "not_sure");
    expect(screen.queryByLabelText(/What has happened/)).toBeNull();
    expect((screen.getByLabelText(/enough food/) as HTMLSelectElement).value).toBe("no");
    fireEvent.click(screen.getByRole("button", { name: "See my options" }));
    expect(screen.queryByRole("link", { name: "Renew SNAP" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Apply for SNAP" })).toBeNull();
    expect(screen.getByText(/benefit history is still unknown/)).toBeTruthy();
  });
  it("keeps Spanish routing understandable and discloses the downstream language limit", () => {
    render(<FoodAssessment />);
    fireEvent.change(screen.getByLabelText("Language / Idioma"), { target: { value: "es" } });
    expect(screen.getByRole("heading", { name: "Busquemos apoyo alimentario para su familia." }).closest("section")?.lang).toBe("es");
    answer(/suficiente comida/, "yes"); answer(/ayuda para comprar/, "receiving"); answer(/Qué ha ocurrido/, "stopped");
    fireEvent.click(screen.getByRole("button", { name: "Ver mis opciones" }));
    expect(screen.getByRole("link", { name: "Ayuda con los beneficios de SNAP" }).getAttribute("href")).toBe("/get-support?need=snap_problem");
    expect(screen.getByText(/pantallas de cuenta y solicitud todavía están en inglés/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
