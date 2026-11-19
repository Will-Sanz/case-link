// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureSnapSnapshot, fixtureMandate, fixtureIntake, fixtureRequest } from "@/lib/parent/test-fixtures";
import { snapApplicationSnapshotSchema } from "@/lib/parent/snap-application-snapshot";
import { SNAP_SPANISH_APPLICATION_SOURCE } from "@/lib/parent/snap-form-source";
import { ParentLocaleProvider } from "./parent-locale";
import { SnapManualSigningCopy } from "./snap-manual-signing-copy";
const mocks=vi.hoisted(()=>({load:vi.fn(),view:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/lib/parent/snap-signing-copy-file",()=>({loadSnapSigningCopyFile:mocks.load}));
vi.mock("./snap-review-pdf",()=>({SnapReviewPdf:(props:unknown)=>{mocks.view(props);return <div>Exact PDF fixture</div>}}));
const now=new Date("2026-11-18T12:01:00Z"), source=SNAP_SPANISH_APPLICATION_SOURCE;
const snapshot=snapApplicationSnapshotSchema.parse({...fixtureSnapSnapshot(now),source});
const request=fixtureRequest({id:snapshot.request_id,version:snapshot.request_version,status:"active",intake:fixtureIntake({needs:["snap_new"],utilityProviders:[]}),mandate:fixtureMandate({recipientIds:["snap-pa"],expiresAt:"2026-11-19T12:00:00Z"})});
const context={requestVersion:request.version,snapshotId:snapshot.id,snapshotHash:"a".repeat(64),source,applyingSubjectIds:snapshot.details.household!.filter(p=>p.requestingSnap).map(p=>p.id)};
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("No network in manual UI fixture")}));URL.createObjectURL=vi.fn(()=>"blob:synthetic-unsigned");URL.revokeObjectURL=vi.fn();mocks.load.mockReset();mocks.view.mockReset();});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
describe("exact unsigned manual alternative (synthetic bytes, no protected capture)",()=>{
 it("renders the selected Spanish official source and print path without personal inputs or sending",async()=>{
  const bytes=new Uint8Array([1,2,3]);mocks.load.mockResolvedValue({bytes});
  render(<ParentLocaleProvider initialLocale="es"><SnapManualSigningCopy request={request} snapshot={snapshot} context={context}/></ParentLocaleProvider>);
  const link=await screen.findByRole("link",{name:"Abrir el PDF exacto sin firmar para imprimir o guardar"});
  expect(link.getAttribute("href")).toBe("blob:synthetic-unsigned");expect(link.getAttribute("target")).toBe("_blank");
  expect(screen.getByText("PA 600 FS-S (SG) 9/19").getAttribute("lang")).toBe("es");
  expect(screen.getByRole("link",{name:"Abrir el formulario oficial en blanco y las instrucciones"}).getAttribute("href")).toContain("pa-600-fs-s.pdf");
  expect(document.querySelector("input,textarea,form")).toBeNull();expect(fetch).not.toHaveBeenCalled();expect([...bytes]).toEqual([0,0,0]);
  expect(mocks.load.mock.calls[0][0]).toMatchObject({snapshot:{source},context:{source}});
  expect(document.body.textContent).toContain("Esta copia no se ha enviado");expect(mocks.view.mock.calls[0][0]).toMatchObject({documentLanguage:"es"});
 });
 it("discards a late file after leaving this exact application scope",async()=>{
  let finish!:(value:{bytes:Uint8Array})=>void;mocks.load.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  const view=render(<SnapManualSigningCopy request={request} snapshot={snapshot} context={context}/>);view.unmount();
  const bytes=new Uint8Array([8,9]);await act(async()=>finish({bytes}));expect([...bytes]).toEqual([0,0]);expect(URL.createObjectURL).not.toHaveBeenCalled();
 });
 it("does not load a new manual copy after the request is paused",()=>{
  render(<SnapManualSigningCopy request={{...request,status:"paused"}} snapshot={snapshot} context={context}/>);expect(mocks.load).not.toHaveBeenCalled();expect(document.body.textContent).toBe("");
 });
});


it("rechecks live access on return and removes the old private copy before a denied read",async()=>{
 const bytes=new Uint8Array([1,2,3]);mocks.load.mockResolvedValueOnce({bytes}).mockRejectedValueOnce(new Error("closed owner fixture"));
 render(<SnapManualSigningCopy request={request} snapshot={snapshot} context={context}/>);await screen.findByRole("link",{name:"Open the exact unsigned PDF to print or save"});
 fireEvent(window,new Event("focus"));expect(screen.queryByRole("link",{name:"Open the exact unsigned PDF to print or save"})).toBeNull();
 await screen.findByRole("alert");expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-unsigned");expect(mocks.load).toHaveBeenCalledTimes(2);
});
