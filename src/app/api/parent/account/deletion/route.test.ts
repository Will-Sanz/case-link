import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), normalSession: vi.fn() }));
vi.mock("@/lib/parent/auth", () => ({ createParentClient: mocks.create, requireParentSession: mocks.normalSession }));
import { GET } from "./route";
import { POST } from "../route";
beforeEach(() => {
  vi.resetAllMocks();vi.stubEnv("NEXT_PUBLIC_SITE_URL","https://caselink.example.test");
  mocks.normalSession.mockRejectedValue(new Error("processing closed"));
  mocks.create.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
  mocks.getUser.mockResolvedValue({ data: { user: { id:"11111111-1111-4111-8111-111111111111",email:"synthetic@example.test",email_confirmed_at:"2026-11-07",is_anonymous:false } }, error:null });
});
afterEach(()=>vi.unstubAllEnvs());
const request=(body:unknown,origin="https://caselink.example.test")=>new Request("https://caselink.example.test/api/parent/account",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
describe("deletion-only account API",()=>{
  it("returns minimal uncached status without ordinary account reads or enrollment",async()=>{
    mocks.rpc.mockResolvedValue({data:"active",error:null});const result=await GET();
    expect(result.status).toBe(200);expect(await result.json()).toEqual({ok:true,ownerId:"11111111-1111-4111-8111-111111111111",status:"active"});
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.normalSession).not.toHaveBeenCalled();expect(mocks.rpc.mock.calls).toEqual([["parent_get_deletion_status"]]);
  });
  it("records confirmed deletion with the narrow live identity path even when normal processing rejects the session",async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:null});const result=await POST(request({action:"delete",confirmation:"DELETE",expectedOwnerId:"11111111-1111-4111-8111-111111111111"}));
    expect(result.status).toBe(200);expect(mocks.normalSession).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls).toEqual([["parent_request_deletion"]]);
  });
  it("preserves same-origin and exact confirmation before any identity or deletion call",async()=>{
    for(const req of [request({action:"delete",confirmation:"DELETE",expectedOwnerId:"11111111-1111-4111-8111-111111111111"},"https://attacker.example.test"),request({action:"delete",confirmation:"delete",expectedOwnerId:"11111111-1111-4111-8111-111111111111"}),request({action:"delete",confirmation:"DELETE",expectedOwnerId:"11111111-1111-4111-8111-111111111111",ownerId:"another-parent"})])
      expect((await POST(req)).status).toBeGreaterThanOrEqual(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects a stale confirmed form after an account switch and asks for a fresh confirmation",async()=>{
    const result=await POST(request({action:"delete",confirmation:"DELETE",expectedOwnerId:"22222222-2222-4222-8222-222222222222"}));
    expect(result.status).toBe(409);expect((await result.json()).error).toContain("Reload before confirming deletion");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps identity-service failure distinct from a missing session without exposing provider details",async()=>{
    mocks.getUser.mockResolvedValue({data:{user:null},error:{status:503,message:"PRIVATE-CANARY"}});
    const result=await GET();expect(result.status).toBe(503);expect(await result.text()).not.toContain("PRIVATE-CANARY");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
