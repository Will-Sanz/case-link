// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParentLanguageSelector, ParentLocaleProvider } from "./parent-locale";
import type { ReactNode } from "react";
import { ParentIntake } from "./intake";
import { assessFoodSupport } from "@/lib/parent/food-assessment";
import { getProgramsForNeeds } from "@/lib/parent/programs";
import axe from "axe-core";
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const renderGuide = (children: ReactNode) => render(<ParentLocaleProvider initialLocale="en"><header><ParentLanguageSelector /></header>{children}</ParentLocaleProvider>);
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const reply = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value });
function api(options: { assessment?: (body: unknown) => unknown | Promise<unknown>; post?: (init: RequestInit) => unknown; signedIn?: boolean; description?: boolean } = {}) {
  const state = { owner, signedIn: options.signedIn ?? true };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/food-description/availability")) return reply({available:options.description===true});
    if(url.includes("/food-description?draft="))return reply({result:{state:"proposal",proposedAnswers:{foodForTwoDays:"no",benefitHistory:"applied",existingIssue:null},needIds:["food_now","snap_pending"],questionIds:[],existingRequests:[],excludedNeedIds:[],outOfScope:null,executionGranted:false}});
    if(url.endsWith("/food-description"))return reply({archive:{ownerId:state.owner,available:options.description===true,drafts:options.description?[{id:other,revision:2,state:"result",noticeVersion:"food-description-2026-11-18.v1",consentedAt:new Date().toISOString(),createdAt:new Date().toISOString(),contentExpiresAt:new Date(Date.now()+86400000).toISOString(),metadataExpiresAt:new Date(Date.now()+172800000).toISOString(),input:{description:"Food help",screenLocale:"en"},projection:null,selection:null,queueKey:null,sameChargedContext:true,usage:[]}]:[]}});
    if (url.endsWith("/auth")) { state.signedIn = true; return reply({ ok: true }); }
    if (url.endsWith("/account")) return state.signedIn ? reply({ account: { id: state.owner, email: "fixture@example.invalid", preferences: { language: "en", contactPreference: "in_app" } } }) : reply({ ok: false, error: "Sign in to continue." }, 401);
    if (url.endsWith("/authorization-window")) return reply({ authorization: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), snapApplication: { collectionEnabled: false, noticeVersion: null } } });
    if (url.endsWith("/intake-defaults")) return reply({ ownerId: state.owner, zip: null });
    if (url.endsWith("/food-assessment")) {
      const body = JSON.parse(String(init?.body));
      if (options.assessment) return reply(await options.assessment(body));
      return reply({ ownerId: state.owner, candidates: assessFoodSupport(body.answers).filter(path => body.needs.includes(path.need)).map(path => ({ ...path,
        programs: getProgramsForNeeds([path.need]).map(program => ({ programId: program.id, actions: [] })) })) });
    }
    if (url.endsWith("/requests") && init?.method === "POST") return options.post ? options.post(init) : reply({ request: { id: "33333333-3333-4333-8333-333333333333" } });
    return reply({ capabilities: [] });
  });
  vi.stubGlobal("fetch", fetcher); return { fetcher, state };
}
async function choose({ enough = "no", language = "en", both = false }: { enough?: string; language?: "en" | "es"; both?: boolean } = {}) {
  if (language === "es") fireEvent.change(screen.getByLabelText(/Screen language|Idioma de pantalla/), { target: { value: "es" } });
  fireEvent.change(screen.getByLabelText(/enough food|suficiente comida/), { target: { value: enough } });
  fireEvent.change(screen.getByLabelText(/help paying|ayuda para comprar/), { target: { value: "applied" } });
  fireEvent.click(screen.getByRole("button", { name: language === "es" ? "Ver mis opciones" : "See my options" }));
  fireEvent.click(screen.getByRole("button", { name: both ? language === "es" ? "Continuar con ambas opciones" : "Continue with both options" : language === "es" ? "Consultar una solicitud pendiente" : "Check a pending application" }));
}
async function facts(language: "en" | "es" = "en") {
  fireEvent.change(await screen.findByLabelText(language === "es" ? "Código postal del hogar" : "Household ZIP code"), { target: { value: "19104" } });
  fireEvent.click(screen.getByLabelText(language === "es" ? /Tengo 18 años/ : /I’m 18 or older/));
}
async function permission(language: "en" | "es" = "en") {
  fireEvent.click(screen.getByRole("button", { name: language === "es" ? "Continuar" : "Continue" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: language === "es" ? /Autorizo/ : /I authorize/ }));
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("guided food handoff into the owned typed request", () => {
  it("carries a declared shortage and Spanish interface without changing service language without inventing another SNAP application", async () => {
    const { fetcher } = api(); renderGuide(<main><ParentIntake initialNeed="food"/></main>); await choose({ language: "es" }); await facts("es");
    expect((screen.getByLabelText("Prioridad de la solicitud") as HTMLSelectElement).value).toBe("today");
    expect((screen.getByLabelText("Idioma preferido para el servicio") as HTMLSelectElement).value).toBe("en");
    expect(screen.getByText(/Se propone dar prioridad hoy/)).toBeTruthy();
    expect((await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
    await permission("es"); fireEvent.click(screen.getByRole("button", { name: "Comenzar a recibir apoyo" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const packet = JSON.parse(String(fetcher.mock.calls.find(([url, init]) => url.endsWith("/requests") && init?.method === "POST")![1]!.body));
    expect(packet.intake).toMatchObject({ needs: ["snap_pending"], urgency: "today", language: "en" });
    expect(packet.mandate.mode).toBe("prepare_only"); expect(packet.answers).toBeUndefined();
  });
  it("leaves unknown timing unresolved until a real choice and preserves typed facts on Back", async () => {
    api(); renderGuide(<ParentIntake initialNeed="food"/>); await choose({ enough: "not_sure" }); await facts();
    expect((screen.getByLabelText("Request timing") as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/An unknown food answer does not set a deadline/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Request timing"), { target: { value: "soon" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Check a pending application" }));
    expect((screen.getByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("19104");
    expect((screen.getByLabelText("Request timing") as HTMLSelectElement).value).toBe("soon");
    await permission(); expect(screen.getByText(/Unselected food options have not started/)).toBeTruthy();
  });
  it("rejects a stale language response instead of opening permission for old choices", async () => {
    let release!: (value: unknown) => void;
    const { fetcher } = api({ assessment: () => new Promise(resolve => { release = resolve; }) });
    renderGuide(<ParentIntake initialNeed="food"/>); await choose(); await facts();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(release).toBeTypeOf("function"));
    fireEvent.change(screen.getByLabelText("Preferred service language"), { target: { value: "es" } });
    await act(async () => release({ ownerId: owner, candidates: [] }));
    expect(screen.queryByRole("checkbox", { name: /I authorize/ })).toBeNull();
    expect(fetcher.mock.calls.some(([url, init]) => url.endsWith("/requests") && init?.method === "POST")).toBe(false);
  });
  it("preserves answers and direct alternatives when deterministic preflight cannot connect", async () => {
    const { fetcher } = api({ assessment: async () => { throw new Error("source unavailable"); } });
    renderGuide(<ParentIntake initialNeed="food"/>); await choose(); await facts();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("link", { name: "See direct support options" })).toBeTruthy();
    expect((screen.getByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("19104");
    expect(screen.queryByRole("checkbox", { name: /I authorize/ })).toBeNull();
    expect(fetcher.mock.calls.some(([url, init]) => url.endsWith("/requests") && init?.method === "POST")).toBe(false);
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
  it.each(["en", "es"] as const)("clears the earlier household when account ownership changes without a profile (%s)", async language => {
    const { state, fetcher } = api(); renderGuide(<ParentIntake initialNeed="food"/>); await choose({ language }); await facts(language);
    state.owner = other; fireEvent(window, new Event("focus"));
    const notice = await screen.findByText(language === "es" ? /Se borraron las respuestas anteriores/ : /earlier answers were cleared/);
    expect(notice.closest("[lang]")?.getAttribute("lang")).toBe(language);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect((screen.getByLabelText(/enough food|suficiente comida/) as HTMLSelectElement).value).toBe("");
    expect(fetcher.mock.calls.some(([url, init]) => url.endsWith("/requests") && init?.method === "POST")).toBe(false);
  });
  it("reconciles a combined uncertain start with its complete exact body and key without rerunning assessment", async () => {
    let first = true; const { fetcher } = api({ post: () => { if (first) { first = false; throw new Error("lost acknowledgement"); } return reply({ request: { id: owner } }); } });
    renderGuide(<ParentIntake initialNeed="food"/>); await choose({ both: true }); await facts(); await permission();
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await screen.findByText(/save result has not been confirmed/);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Screen language|Idioma de pantalla/), { target: { value: "es" } });
    const checks = fetcher.mock.calls.filter(([url]) => url.endsWith("/food-assessment")).length;
    fireEvent.click(screen.getByRole("button", { name: "Comenzar a recibir apoyo" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const posts = fetcher.mock.calls.filter(([url, init]) => url.endsWith("/requests") && init?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[1][1]?.body).toBe(posts[0][1]?.body); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers);
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ intake: { needs: ["food_now", "snap_pending"] }, mandate: { recipientIds: expect.arrayContaining(["philly-food", "snap-pa"]) } });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/food-assessment"))).toHaveLength(checks);
  });
  it("requires every selected sibling to survive the account preflight", async () => {
    const { fetcher } = api({ assessment: () => ({ ownerId: owner, candidates: [{ need: "food_now", reason: "immediate", programs: [] }] }) });
    renderGuide(<ParentIntake initialNeed="food"/>); await choose({ both: true }); await facts();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/These proposed options changed/);
    expect(screen.queryByRole("checkbox", { name: /I authorize/ })).toBeNull();
    expect(fetcher.mock.calls.some(([url, init]) => url.endsWith("/requests") && init?.method === "POST")).toBe(false);
  });
  it("keeps guide answers through existing inline sign-in with the original recovery settings", async () => {
    api({ signedIn: false }); renderGuide(<ParentIntake initialNeed="food" signInOptions={{ existingAccountRecovery: true, recoveryHref: "https://original.example.invalid/forgot-password", emailCodeAvailable: false }}/>);
    await choose({ language: "es" }); await screen.findByLabelText(/Password|Contraseña/);
    expect(screen.queryByRole("button", { name: "Use an email code instead" })).toBeNull();
    expect(screen.getByRole("link", { name: /Forgot your password|Olvidó su contraseña/ }).getAttribute("href")).toBe("https://original.example.invalid/forgot-password?ui=es");
    fireEvent.change(screen.getByLabelText(/Your email address|Su dirección de correo/), { target: { value: "existing@example.invalid" } });
    fireEvent.change(screen.getByLabelText(/Password|Contraseña/), { target: { value: "synthetic-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^(Sign in|Iniciar sesión)$/ }));
    await screen.findByLabelText("Código postal del hogar");
    expect((screen.getByLabelText("Idioma preferido para el servicio") as HTMLSelectElement).value).toBe("en");
    expect((screen.getByLabelText("Prioridad de la solicitud") as HTMLSelectElement).value).toBe("today");
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe("guided food recovery and keyboard handoff", () => {
  it("focuses the household heading once secure access finishes loading", async () => {
    api(); renderGuide(<ParentIntake initialNeed="food"/>); await choose();
    const heading = await screen.findByRole("heading", { name: "Your household details, in one place" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
  it("moves focus back to proposed paths and into the retained form", async () => {
    api(); renderGuide(<ParentIntake initialNeed="food"/>); await choose(); await facts();
    const back = screen.getByRole("button", { name: "Back" }); back.focus(); fireEvent.click(back);
    const results = screen.getByRole("heading", { name: "Your proposed next steps" });
    await waitFor(() => expect(document.activeElement).toBe(results));
    fireEvent.click(screen.getByRole("button", { name: "Check a pending application" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your household details, in one place" })));
    expect((screen.getByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("19104");
  });
  it("keeps inline recovery and permission when authentication expires at final preflight", async () => {
    const { state, fetcher } = api(); renderGuide(<ParentIntake initialNeed="food"/>); await choose(); await facts(); await permission();
    const previous = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => url.endsWith("/food-assessment") && !state.signedIn
      ? Promise.resolve(reply({ error: "Sign in again to continue." }, 401)) : previous(url, init)));
    state.signedIn = false; fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await screen.findByLabelText(/Password|Contraseña/);
    expect(screen.queryByRole("link", { name: "Sign in to continue" })).toBeNull();
    expect(fetcher.mock.calls.some(([url, init]) => url.endsWith("/requests") && init?.method === "POST")).toBe(false);
    fireEvent.change(screen.getByLabelText(/Your email address|Su dirección de correo/), { target: { value: "fixture@example.invalid" } });
    fireEvent.change(screen.getByLabelText(/Password|Contraseña/), { target: { value: "synthetic-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^(Sign in|Iniciar sesión)$/ }));
    expect((await screen.findByRole("checkbox", { name: /I authorize/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
  });
  it("shows a failed post-sign-in owner check and retries it without repeating authentication", async () => {
    const { fetcher } = api({ signedIn: false }); renderGuide(<ParentIntake initialNeed="food"/>); await choose({ language: "es" }); await screen.findByLabelText(/Password|Contraseña/);
    let unavailable = true;
    const previous = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => url.endsWith("/account") && unavailable
      ? Promise.resolve(reply({ error: "Synthetic account recheck unavailable" }, 503)) : previous(url, init)));
    fireEvent.change(screen.getByLabelText(/Your email address|Su dirección de correo/), { target: { value: "fixture@example.invalid" } });
    fireEvent.change(screen.getByLabelText(/Password|Contraseña/), { target: { value: "synthetic-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^(Sign in|Iniciar sesión)$/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    unavailable = false; fireEvent.click(screen.getByRole("button", { name: /Retry account check|Reintentar la comprobación/ }));
    await screen.findByLabelText("Código postal del hogar");
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/auth"))).toHaveLength(1);
    expect((screen.getByLabelText("Idioma preferido para el servicio") as HTMLSelectElement).value).toBe("en");
    expect(navigation.replace).not.toHaveBeenCalled();
  });
  it("preserves an unknown start's exact packet through inline authentication recovery", async () => {
    let first = true;
    const { state, fetcher } = api({ post: () => { if (first) { first = false; throw new Error("lost acknowledgement"); } return reply({ request: { id: owner } }); } });
    renderGuide(<ParentIntake initialNeed="food"/>); await choose(); await facts(); await permission();
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" })); await screen.findByText(/save result has not been confirmed/);
    fireEvent.change(screen.getByLabelText(/Screen language|Idioma de pantalla/), { target: { value: "es" } });
    const checks = fetcher.mock.calls.filter(([url]) => url.endsWith("/food-assessment")).length;
    state.signedIn = false; fireEvent.click(screen.getByRole("button", { name: "Comenzar a recibir apoyo" })); await screen.findByLabelText(/Password|Contraseña/);
    fireEvent.change(screen.getByLabelText(/Your email address|Su dirección de correo/), { target: { value: "fixture@example.invalid" } });
    fireEvent.change(screen.getByLabelText(/Password|Contraseña/), { target: { value: "synthetic-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^(Sign in|Iniciar sesión)$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Comenzar a recibir apoyo" })); await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const posts = fetcher.mock.calls.filter(([url, init]) => url.endsWith("/requests") && init?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[1][1]?.body).toBe(posts[0][1]?.body); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/food-assessment"))).toHaveLength(checks);
  });
  it.each([401, 403])("keeps a dispatched ordinary start fixed after an uncertain %s response", async status => {
    let first = true;
    const { fetcher } = api({ post: () => {
      if (first) { first = false; return reply({ error: "Sign in again to continue." }, status); }
      return reply({ request: { id: owner } });
    } });
    renderGuide(<ParentIntake initialNeed="food"/>); await choose(); await facts(); await permission();
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await screen.findByLabelText(/Password|Contraseña/);
    fireEvent.change(screen.getByLabelText(/Your email address|Su dirección de correo/), { target: { value: "fixture@example.invalid" } });
    fireEvent.change(screen.getByLabelText(/Password|Contraseña/), { target: { value: "synthetic-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^(Sign in|Iniciar sesión)$/ }));
    await screen.findByRole("button", { name: "Start getting support" });
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const posts = fetcher.mock.calls.filter(([url, init]) => url.endsWith("/requests") && init?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[1][1]?.body).toBe(posts[0][1]?.body); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers);
  });
});

it("carries only the opaque owned description pair through preflight and the complete exact unknown combined-start retry",async()=>{
  let first=true;const {fetcher}=api({description:true,post:()=>{if(first){first=false;throw new Error("lost start acknowledgement");}return reply({request:{id:owner}});}});
  renderGuide(<ParentIntake initialNeed="food"/>);fireEvent.click(await screen.findByRole("button",{name:/Open this saved draft/}));
  fireEvent.click(await screen.findByRole("button",{name:"Continue with both options"}));await facts();await permission();
  fireEvent.click(screen.getByRole("button",{name:"Start getting support"}));await screen.findByText(/save result has not been confirmed/);
  const checks=fetcher.mock.calls.filter(([url])=>url.endsWith("/food-assessment")).length;
  fireEvent.change(screen.getByLabelText(/Screen language/),{target:{value:"es"}});fireEvent.click(screen.getByRole("button",{name:"Comenzar a recibir apoyo"}));
  await waitFor(()=>expect(navigation.push).toHaveBeenCalled());
  const posts=fetcher.mock.calls.filter(([url,init])=>url.endsWith("/requests")&&init?.method==="POST");
  expect(posts).toHaveLength(2);expect(posts[0][1]?.body).toBe(posts[1][1]?.body);expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers);
  expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({descriptionSource:{draftId:other,revision:2},intake:{needs:["food_now","snap_pending"]}});
  expect(String(posts[0][1]?.body)).not.toContain("Food help");
  const preflight=fetcher.mock.calls.find(([url])=>url.endsWith("/food-assessment"))!;
  expect(JSON.parse(String(preflight[1]?.body)).descriptionSource).toEqual({draftId:other,revision:2});
  expect(fetcher.mock.calls.filter(([url])=>url.endsWith("/food-assessment"))).toHaveLength(checks);
  expect(fetcher.mock.calls.some(([url,init])=>url.includes("/food-description")&&init?.method)).toBe(false);
});
