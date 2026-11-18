import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), operation: vi.fn(), summary: vi.fn(), packet: vi.fn(), locale: vi.fn() }));
vi.mock("@/lib/parent/data", () => ({ getSupportRequest: mocks.request }));
vi.mock("@/lib/parent/activity", () => ({ getExactOperation: mocks.operation }));
vi.mock("@/lib/parent/export", () => ({ renderParentSummary: mocks.summary, renderParentPacket: mocks.packet }));
vi.mock("@/lib/parent/locale-server", () => ({ readParentLocale: mocks.locale }));
import { GET as summary } from "./requests/[id]/export/route";
import { GET as packet } from "./requests/[id]/operations/[operationId]/export/route";
const id="d430cc02-d8d4-46cc-9900-5b397758fb16", operationId="b72df7ef-922d-43ee-9825-55e209e5b47d", input=new Request("https://app.example.test?ui=es");
beforeEach(()=>{vi.resetAllMocks();mocks.locale.mockResolvedValue("es");mocks.summary.mockResolvedValue(Buffer.from("%PDF-summary"));mocks.packet.mockResolvedValue(Buffer.from("%PDF-packet"));});
describe("owned printable display locale",()=>{
  it.each(["en","es"] as const)("passes only the server display locale after the owned summary read (%s)",async locale=>{
    mocks.locale.mockResolvedValue(locale);const record={id,intake:{language:"en"}};mocks.request.mockResolvedValue(record);
    const result=await summary(input,{params:Promise.resolve({id})});expect(result.status).toBe(200);expect(mocks.request).toHaveBeenCalledWith(id);expect(mocks.summary).toHaveBeenCalledWith(record,locale);
    expect(result.headers.get("cache-control")).toBe("private, no-store");expect(result.headers.get("content-language")).toBe(locale);expect(result.headers.get("content-disposition")).toContain("attachment;");
  });
  it("passes the exact owned packet unchanged with the server display locale",async()=>{
    const record={id:operationId,packet:{raw:"unchanged"}};mocks.operation.mockResolvedValue(record);
    const result=await packet(input,{params:Promise.resolve({id,operationId})});expect(result.status).toBe(200);expect(mocks.operation).toHaveBeenCalledWith(id,operationId);expect(mocks.packet).toHaveBeenCalledWith(record,"es");
    expect(result.headers.get("cache-control")).toBe("private, no-store");expect(result.headers.get("x-content-type-options")).toBe("nosniff");expect(result.headers.get("content-language")).toBe("es");
  });
  it("returns no attachment or locale-derived rendering without an owned record",async()=>{
    mocks.request.mockResolvedValue(null);mocks.operation.mockResolvedValue(null);
    for(const result of [await summary(input,{params:Promise.resolve({id})}),await packet(input,{params:Promise.resolve({id,operationId})})]){expect(result.status).toBe(404);expect(result.headers.get("content-disposition")).toBeNull();}
    expect(mocks.summary).not.toHaveBeenCalled();expect(mocks.packet).not.toHaveBeenCalled();expect(mocks.locale).not.toHaveBeenCalled();
  });
  it("keeps malformed identifiers and expired ownership closed before rendering",async()=>{
    expect((await packet(input,{params:Promise.resolve({id,operationId:"bad"})})).status).toBe(400);expect(mocks.operation).not.toHaveBeenCalled();
    mocks.request.mockRejectedValue(new Error("Authentication required"));expect((await summary(input,{params:Promise.resolve({id})})).status).toBe(401);expect(mocks.summary).not.toHaveBeenCalled();
  });
});
