import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { listRequestOperations } from "./activity";
import { fixtureProtectedSnapOperation } from "./test-fixtures";

describe("owned operation history", () => {
  it.each([100, 101])(
    "marks whether %s fetched rows leave earlier history outside the response",
    async (count) => {
      const rows = Array.from({ length: count }, (_, index) => ({
        id: `operation-${index}`,
        need: "snap_new",
      }));
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
      };
      mocks.session.mockResolvedValue({
        supabase: { from: vi.fn().mockReturnValue(query) },
      });
      const history = await listRequestOperations(
        "11111111-1111-4111-8111-111111111111",
      );
      expect(history.operations).toHaveLength(100);
      expect(history.historyLimited).toBe(count > 100);
      expect(history.operations[99].id).toBe("operation-99");
      expect(query.limit).toHaveBeenCalledWith(101);
    },
  );
  it("projects the exact stored need and draft flag without exposing packets or storage paths or changing request scope", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const rows = [{ id: "operation", need: "electricity", request_version: 2, form: { preparation_only: true } }];
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const from = vi.fn().mockReturnValue(query);
    mocks.session.mockResolvedValue({ supabase: { from } });
    expect(await listRequestOperations(requestId)).toEqual({
      operations: rows.map(row => ({ ...row, protected_packet: null })),
      historyLimited: false,
    });
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("parent_operations");
    expect(query.eq).toHaveBeenCalledWith("request_id", requestId);
    const fields = query.select.mock.calls[0][0].split(",");
    expect(fields).toContain("need");
    expect(fields).toContain("request_version");
    expect(query.select.mock.calls[0][0]).toContain("form:parent_form_artifacts(preparation_only,snap_snapshot_id,snap_snapshot_hash)");
    expect(fields).not.toContain("details"); expect(fields).not.toContain("provenance");
    expect(fields).not.toContain("packet");
    expect(fields).toContain("protected_packet:packet->protectedSnapPacket");
    expect(fields).not.toContain("object_path");
    expect(query.limit).toHaveBeenCalledWith(101);
  });
  it("returns only a strict canonical reference and drops malformed or unrelated protected metadata", async () => {
    const reference = fixtureProtectedSnapOperation().packet.protectedSnapPacket;
    const base = { id: "operation", need: "snap_new", program_id: "snap-pa", action: "submit", artifact_id: null, protected_packet: reference };
    const rows = [base, { ...base, protected_packet: { ...reference, raw: "PRIVATE-CANARY" } }, { ...base, need: "snap_renewal" }, { ...base, program_id: "philly-food" }, { ...base, action: "follow_up" }, { ...base, artifact_id: "ordinary-form" }];
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: rows, error: null }) };
    mocks.session.mockResolvedValue({ supabase: { from: vi.fn().mockReturnValue(query) } });
    const result = await listRequestOperations("11111111-1111-4111-8111-111111111111");
    expect(result.operations.map(row => row.protected_packet)).toEqual([reference, null, null, null, null, null]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-CANARY");
  });
});
