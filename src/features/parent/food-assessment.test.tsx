// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParentLanguageSelector, ParentLocaleProvider } from "./parent-locale";
import type { ReactNode } from "react";
import { FoodAssessment } from "./food-assessment";
import { FoodAssessmentQuestions } from "./food-assessment-questions";
import { ParentIntake } from "./intake";
import { foodAssessmentInputSchema } from "@/lib/parent/food-assessment";
import { getProgramsForNeeds } from "@/lib/parent/programs";
import { foodDescriptionRoutingAnswersSchema } from "@/lib/parent/food-description-draft";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const renderGuide = (children: ReactNode) => render(<ParentLocaleProvider initialLocale="en"><header><ParentLanguageSelector /></header>{children}</ParentLocaleProvider>);
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function answer(label: RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
describe("public guided food entry", () => {
  it.each(["en", "es"] as const)("offers both compatible food and pending SNAP paths in one handoff in %s", language => {
    const onChoose = vi.fn(); renderGuide(<FoodAssessment onChoose={onChoose} />);
    fireEvent.change(screen.getByLabelText(/Screen language|Idioma de pantalla/), { target: { value: language } });
    answer(/enough food|suficiente comida/, "no"); answer(/help paying|ayuda para comprar/, "applied");
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "See my options" : "Ver mis opciones" }));
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "Continue with both options" : "Continuar con ambas opciones" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith({ needs: ["food_now", "snap_pending"], answers: { foodForTwoDays: "no", benefitHistory: "applied", existingIssue: null } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("hands only the exact current answers to the typed form without navigation or persistence", () => {
    const onChoose = vi.fn(); renderGuide(<FoodAssessment onChoose={onChoose}/>);
    fireEvent.change(screen.getByLabelText(/Screen language|Idioma de pantalla/), { target: { value: "es" } });
    answer(/suficiente comida/, "not_sure"); answer(/ayuda para comprar/, "applied");
    fireEvent.click(screen.getByRole("button", { name: "Ver mis opciones" }));
    fireEvent.click(screen.getByRole("button", { name: "Consultar una solicitud pendiente" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith({ needs: ["snap_pending"], answers: { foodForTwoDays: "not_sure", benefitHistory: "applied", existingIssue: null } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("moves keyboard focus to results and back to the first answer when editing", async () => {
    renderGuide(<FoodAssessment />); answer(/enough food/, "no"); answer(/help paying/, "applied");
    fireEvent.click(screen.getByRole("button", { name: "See my options" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your proposed next steps" })));
    fireEvent.click(screen.getByRole("button", { name: "Change my answers" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/enough food/)));
  });
  it.each(["en", "es"])("lets someone whose benefits ended answer honestly in %s", language => {
    renderGuide(<FoodAssessment />);
    fireEvent.change(screen.getByLabelText(/Screen language|Idioma de pantalla/), { target: { value: language } });
    expect(screen.getByRole("option", { name: language === "en" ? /received it before/ : /la recibí antes/ })).toBeTruthy();
    answer(language === "en" ? /enough food/ : /suficiente comida/, "yes");
    answer(language === "en" ? /help paying/ : /ayuda para comprar/, "receiving");
    answer(language === "en" ? /What has happened/ : /Qué ha ocurrido/, "stopped");
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "See my options" : "Ver mis opciones" }));
    expect(screen.getByRole("link", { name: language === "en" ? "Help with SNAP benefits" : "Ayuda con los beneficios de SNAP" }).getAttribute("href")).toBe("/get-support?need=snap_problem");
    expect(screen.queryByRole("link", { name: language === "en" ? "Apply for SNAP" : "Solicitar SNAP" })).toBeNull();
  });

  it("offers urgent help without account access and routes a waiting family without another application", () => {
    renderGuide(<FoodAssessment />);
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
    renderGuide(<FoodAssessment />);
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
    renderGuide(<FoodAssessment />);
    fireEvent.change(screen.getByLabelText(/Screen language|Idioma de pantalla/), { target: { value: "es" } });
    expect(screen.getByRole("heading", { name: "Busquemos apoyo alimentario para su familia." }).closest("section")?.lang).toBe("es");
    answer(/suficiente comida/, "yes"); answer(/ayuda para comprar/, "receiving"); answer(/Qué ha ocurrido/, "stopped");
    fireEvent.click(screen.getByRole("button", { name: "Ver mis opciones" }));
    expect(screen.getByRole("link", { name: "Ayuda con los beneficios de SNAP" }).getAttribute("href")).toBe("/get-support?need=snap_problem");
    expect(screen.getByText(/pantallas de solicitud y materiales de los programas siguen en inglés/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["en", "es"] as const)("offers an honest denial option and exact problem handoff in %s without a received-benefits question", language => {
    const onChoose = vi.fn(); renderGuide(<FoodAssessment onChoose={onChoose} />);
    fireEvent.change(screen.getByLabelText(/Screen language|Idioma de pantalla/), { target: { value: language } });
    const label = language === "en" ? "I applied and received a denial notice" : "Presenté una solicitud y recibí un aviso de denegación";
    expect(screen.getByRole("option", { name: label })).toBeTruthy();
    answer(/enough food|suficiente comida/, "yes"); answer(/help paying|ayuda para comprar/, "denied");
    expect(screen.queryByLabelText(/What has happened|Qué ha ocurrido/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "See my options" : "Ver mis opciones" }));
    expect(screen.getByText(language === "en" ? /denial notice for your SNAP application/ : /aviso de denegación de su solicitud de SNAP/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "Help with SNAP benefits" : "Ayuda con los beneficios de SNAP" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith({ needs: ["snap_problem"], answers: { foodForTwoDays: "yes", benefitHistory: "denied", existingIssue: null } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["never", "applied", "denied"].flatMap(benefit => ["en", "es"].map(language => ({ benefit, language }))))("continues only known $benefit SNAP with unanswered food in $language and remembers no food date", ({ benefit, language }) => {
    const onChoose = vi.fn(), remembered = vi.spyOn(foodDescriptionRoutingAnswersSchema, "parse"); renderGuide(<FoodAssessment onChoose={onChoose} />);
    fireEvent.change(screen.getByLabelText(/Screen language|Idioma de pantalla/), { target: { value: language } });
    answer(/help paying|ayuda para comprar/, benefit);
    const enough = screen.getByLabelText(/enough food|suficiente comida/) as HTMLSelectElement;
    expect(enough.value).toBe(""); expect(enough.required).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "See my options" : "Ver mis opciones" }));
    const need = benefit === "never" ? "snap_new" : benefit === "applied" ? "snap_pending" : "snap_problem";
    const titles = language === "en" ? { snap_new: "Apply for SNAP", snap_pending: "Check a pending application", snap_problem: "Help with SNAP benefits" } : { snap_new: "Solicitar SNAP", snap_pending: "Consultar una solicitud pendiente", snap_problem: "Ayuda con los beneficios de SNAP" };
    expect(screen.queryByRole("button", { name: language === "en" ? "Food for now" : "Comida para ahora" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue with both|Continuar con ambas/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: titles[need as keyof typeof titles] }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith({ needs: [need], answers: { foodForTwoDays: "not_sure", benefitHistory: benefit, existingIssue: null } });
    expect(remembered).toHaveBeenCalledOnce(); expect(remembered.mock.calls[0][0]).not.toHaveProperty("foodForTwoDays");
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "Change my answers" : "Cambiar mis respuestas" }));
    expect((screen.getByLabelText(/enough food|suficiente comida/) as HTMLSelectElement).value).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["en", "es"])("continues only food while SNAP history is unanswered in %s", language => {
    const onChoose = vi.fn(), remembered = vi.spyOn(foodDescriptionRoutingAnswersSchema, "parse"); renderGuide(<FoodAssessment onChoose={onChoose} />);
    fireEvent.change(screen.getByLabelText(/Screen language|Idioma de pantalla/), { target: { value: language } }); answer(/enough food|suficiente comida/, "no");
    expect((screen.getByLabelText(/help paying|ayuda para comprar/) as HTMLSelectElement).required).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "See my options" : "Ver mis opciones" }));
    expect(screen.queryByRole("button", { name: /Continue with both|Continuar con ambas/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "Food for now" : "Comida para ahora" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith({ needs: ["food_now"], answers: { foodForTwoDays: "no", benefitHistory: "not_sure", existingIssue: null } });
    expect(remembered).toHaveBeenCalledOnce(); expect(remembered.mock.calls[0][0]).not.toHaveProperty("benefitHistory"); expect(fetch).not.toHaveBeenCalled();
  });
  it("continues only food while a receiving-benefits issue is unanswered without inventing a problem fact", () => {
    const onChoose = vi.fn(), remembered = vi.spyOn(foodDescriptionRoutingAnswersSchema, "parse"); renderGuide(<FoodAssessment onChoose={onChoose} />);
    answer(/enough food/, "no"); answer(/help paying/, "receiving");
    expect((screen.getByLabelText(/What has happened/) as HTMLSelectElement).required).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "See my options" }));
    expect(screen.queryByRole("button", { name: "Help with SNAP benefits" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Food for now" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith({ needs: ["food_now"], answers: { foodForTwoDays: "no", benefitHistory: "receiving", existingIssue: "not_sure" } });
    expect(remembered.mock.calls.every(call => !Object.hasOwn(call[0] as object, "existingIssue"))).toBe(true);
  });
  it.each(["renewal", "card"])("continues a known receiving %s SNAP route while food is unanswered", issue => {
    const onChoose = vi.fn(); renderGuide(<FoodAssessment onChoose={onChoose} />); answer(/help paying/, "receiving"); answer(/What has happened/, issue);
    expect((screen.getByLabelText(/enough food/) as HTMLSelectElement).required).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "See my options" }));
    fireEvent.click(screen.getByRole("button", { name: issue === "renewal" ? "Renew SNAP" : "Help with SNAP benefits" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith({ needs: [issue === "renewal" ? "snap_renewal" : "snap_problem"], answers: { foodForTwoDays: "not_sure", benefitHistory: "receiving", existingIssue: issue } });
  });
  it.each(["", "none"])("keeps all unavailable work closed when receiving issue is %s and food is unanswered", issue => {
    const onChoose = vi.fn(); renderGuide(<FoodAssessment onChoose={onChoose} />); answer(/help paying/, "receiving"); if (issue) answer(/What has happened/, issue);
    expect((screen.getByLabelText(/enough food/) as HTMLSelectElement).required).toBe(true);
    fireEvent.submit(screen.getByRole("button", { name: "See my options" }).closest("form")!);
    expect(screen.queryByRole("heading", { name: "Your proposed next steps" })).toBeNull(); expect(onChoose).not.toHaveBeenCalled();
  });

  it.each(["none", "unknown"])("keeps the useful fully answered %s result even when no new work is proposed", kind => {
    renderGuide(<FoodAssessment />); answer(/enough food/, "yes"); answer(/help paying/, kind === "none" ? "receiving" : "not_sure");
    if (kind === "none") answer(/What has happened/, "none");
    fireEvent.click(screen.getByRole("button", { name: "See my options" }));
    expect(screen.getByRole("heading", { name: "Your proposed next steps" })).toBeTruthy();
    expect(screen.getByText(kind === "none" ? /No new benefit action is proposed/ : /benefit history is still unknown/)).toBeTruthy();
  });
  it("keeps the description question's required-field default unchanged", () => {
    renderGuide(<FoodAssessmentQuestions answers={{ foodForTwoDays: "", benefitHistory: "never", existingIssue: null }} questionIds={["foodForTwoDays"]} onChange={vi.fn()} />);
    expect((screen.getByLabelText(/enough food/) as HTMLSelectElement).required).toBe(true);
    expect(screen.getByLabelText(/enough food/).getAttribute("aria-describedby")).toBeNull();
  });

  it.each(["food", "snap"])("sends the real parent-intake %s preflight for only the ready need with honest unknown representation", async mode => {
    const posts: unknown[] = [], ownerId = "11111111-1111-4111-8111-111111111111", issuedAt = new Date().toISOString(), expiresAt = new Date(Date.parse(issuedAt) + 86400000).toISOString();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (url.endsWith("/account")) return json({ account: { id: ownerId, email: "synthetic@example.invalid", preferences: { language: "en", contactPreference: "in_app" } } });
      if (url.endsWith("/food-description/availability")) return json({ available: false });
      if (url.endsWith("/authorization-window")) return json({ authorization: { issuedAt, expiresAt, snapApplication: { collectionEnabled: false, noticeVersion: null } } });
      if (url.endsWith("/intake-defaults")) return json({ ownerId, zip: null });
      if (url.endsWith("/food-assessment")) {
        const value = foodAssessmentInputSchema.parse(JSON.parse(String(init?.body))); posts.push(value);
        return json({ ownerId, candidates: value.needs.map(need => ({ need, reason: need === "food_now" ? "immediate" : "problem", programs: getProgramsForNeeds([need]).map(program => ({ programId: program.id, actions: [] })) })) });
      }
      if (init?.method === "POST") throw new Error("Unexpected synthetic mutation");
      return json({ capabilities: [] });
    }));
    renderGuide(<ParentIntake initialNeed="food" />); await screen.findByLabelText(/enough food/);
    if (mode === "food") answer(/enough food/, "no"); else answer(/help paying/, "denied");
    fireEvent.click(screen.getByRole("button", { name: "See my options" }));
    fireEvent.click(screen.getByRole("button", { name: mode === "food" ? "Food for now" : "Help with SNAP benefits" }));
    const zip = await screen.findByLabelText("Household ZIP code"); fireEvent.change(zip, { target: { value: "19104" } });
    fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
    if (mode === "snap") fireEvent.change(screen.getByLabelText("Request timing"), { target: { value: "soon" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ needs: [mode === "food" ? "food_now" : "snap_problem"], answers: { foodForTwoDays: mode === "food" ? "no" : "not_sure", benefitHistory: mode === "food" ? "not_sure" : "denied", existingIssue: null } });
    expect(await screen.findByLabelText(/I authorize/)).toBeTruthy();
  });

});
