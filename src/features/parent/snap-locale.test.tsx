// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SNAP_EN_TEMPLATE_ID, SNAP_ES_TEMPLATE_ID } from "@/lib/parent/snap-form-source";
import type { SnapApplicationFields } from "@/lib/parent/snap-application-fields";
import { fixtureSnapApplication } from "@/lib/parent/test-fixtures";
import { ParentLocaleProvider, ParentLanguageSelector } from "./parent-locale";
import { SnapApplicationFormFields, SnapApplicationSummary } from "./snap-application-form";
import { SnapApplicationNotice } from "./snap-application-review";
import { SnapDocumentLanguage, type SnapFormTemplateId } from "./snap-document-language";
import { SavedFamilyProfileNotice } from "./use-saved-family-profile";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
const changed=vi.fn(), now=new Date("2026-11-18T12:00:00Z");
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);changed.mockClear();});
afterEach(()=>{cleanup();vi.useRealTimers();});
function Choice(){const[value,setValue]=useState<SnapFormTemplateId>(SNAP_EN_TEMPLATE_ID);return <><ParentLanguageSelector/><SnapDocumentLanguage value={value} onChange={id=>{changed(id);setValue(id)}}/></>}
describe("Spanish SNAP family copy and independent document choice",()=>{
 it("keeps document choice independent of screen locale and requires an actual selection callback",()=>{
  render(<ParentLocaleProvider initialLocale="es"><Choice/></ParentLocaleProvider>);
  const choice=screen.getByLabelText("Idioma del documento oficial de SNAP") as HTMLSelectElement;
  expect(choice.value).toBe(SNAP_EN_TEMPLATE_ID);expect(changed).not.toHaveBeenCalled();
  fireEvent.change(choice,{target:{value:SNAP_ES_TEMPLATE_ID}});expect(changed).toHaveBeenLastCalledWith(SNAP_ES_TEMPLATE_ID);
  fireEvent.change(screen.getByLabelText("Idioma de pantalla / Screen language"),{target:{value:"en"}});
  expect((screen.getByLabelText("Official SNAP document language") as HTMLSelectElement).value).toBe(SNAP_ES_TEMPLATE_ID);expect(changed).toHaveBeenCalledTimes(1);
 });
 it("translates applicable fields while preserving supplied names, contact preference, unknowns and raw income facts",()=>{
  const value:SnapApplicationFields=fixtureSnapApplication(now);value.applicant={firstName:"English"};value.household![0].firstName="English";value.household![0].lastName=undefined;value.language="en";value.interpreter=undefined;
  value.income={month:"2026-11",hasIncome:true,entries:[{id:"44444444-4444-4444-8444-444444444444",personId:value.household![0].id,amount:680.005,source:"English",frequency:"Irregular",status:"expected",date:"2026-11-22"}]};
  render(<ParentLocaleProvider initialLocale="es"><SnapApplicationFormFields value={value} onChange={changed}/></ParentLocaleProvider>);
  expect((screen.getByLabelText("Su nombre") as HTMLInputElement).value).toBe("English");expect((screen.getByLabelText("Idioma de contacto para la solicitud") as HTMLSelectElement).value).toBe("en");
  expect((screen.getByLabelText("¿Necesita intérprete?") as HTMLSelectElement).value).toBe("");
  expect(screen.getByText("Elijo no solicitar estas deducciones del hogar",{selector:"p"})).toBeTruthy();
  const people=screen.getByLabelText("Persona que recibe el pago 1");expect(within(people).getByRole("option",{name:"English"})).toBeTruthy();
  expect((screen.getByLabelText("Cantidad del pago 1 antes de impuestos ($)") as HTMLInputElement).value).toBe("680.005");
  fireEvent.change(screen.getByLabelText("Su nombre"),{target:{value:"José"}});expect(changed.mock.calls[0][0].language).toBe("en");expect(changed.mock.calls[0][0].interpreter).toBeUndefined();
  expect(screen.getByLabelText("Datos de la solicitud de SNAP").getAttribute("lang")).toBe("es");
 });
 it("uses the selected official Spanish source while keeping the same privacy scope and retention notice",()=>{
  render(<ParentLocaleProvider initialLocale="es"><SnapApplicationNotice templateId={SNAP_ES_TEMPLATE_ID}/></ParentLocaleProvider>);
  expect(screen.getByRole("link",{name:"formulario revisado de SNAP de Pensilvania"}).getAttribute("href")).toContain("pa-600-fs-s.pdf");
  expect(screen.getByRole("link",{name:"aviso de datos de SNAP"}).getAttribute("href")).toBe("/support/privacy#snap-application");
  expect(document.body.textContent).toContain("hasta 90 días después");expect(document.body.textContent).toContain("No escriba aquí números de Seguro Social");
 });
 it("shows bilingual saved-family recovery with the same refresh action and source dates",()=>{
  const refresh=vi.fn();render(<ParentLocaleProvider initialLocale="es"><SavedFamilyProfileNotice reuse={{notice:"Saved family sources could not be checked. Your existing application answers remain available with their original dates.",loading:false,blocked:false,canReload:false}} disabled={false} refresh={refresh}/></ParentLocaleProvider>);
  expect(screen.getByText(/con sus fechas originales/)).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Actualizar respuestas familiares vinculadas"}));expect(refresh).toHaveBeenCalledOnce();
 });
 it("summarizes unknown and deliberately declined deductions without translating free household values",()=>{
  const value:SnapApplicationFields=fixtureSnapApplication(now);value.applicant={firstName:"English"};value.household![0].firstName="English";value.household![0].lastName=undefined;value.expenseClaims={household:"do_not_claim",medical:undefined};
  render(<ParentLocaleProvider initialLocale="es"><SnapApplicationSummary value={value}/></ParentLocaleProvider>);
  expect(screen.getAllByText("English").length).toBeGreaterThan(0);expect(screen.getByText("Eligió no solicitar estas deducciones")).toBeTruthy();expect(screen.getByText("No se indicó una opción")).toBeTruthy();
 });
});
