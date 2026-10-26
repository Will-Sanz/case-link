import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { listRequestOperations } from "./activity";

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
  it("projects the exact stored need without exposing the operation packet or changing request scope", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const rows = [{ id: "operation", need: "electricity", request_version: 2 }];
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const from = vi.fn().mockReturnValue(query);
    mocks.session.mockResolvedValue({ supabase: { from } });
    expect(await listRequestOperations(requestId)).toEqual({
      operations: rows,
      historyLimited: false,
    });
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("parent_operations");
    expect(query.eq).toHaveBeenCalledWith("request_id", requestId);
    const fields = query.select.mock.calls[0][0].split(",");
    expect(fields).toContain("need");
    expect(fields).toContain("request_version");
    expect(fields).not.toContain("packet");
    expect(query.limit).toHaveBeenCalledWith(101);
  });
});
