import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  maybeSingle: vi.fn(),
  download: vi.fn(),
  eq: vi.fn(),
  bucket: vi.fn(),
}));
vi.mock("@/lib/parent/auth", () => ({ requireParentSession: mocks.session }));
import { GET } from "./requests/[id]/forms/[artifactId]/route";
const id = "d430cc02-d8d4-46cc-9900-5b397758fb16",
  artifactId = "79dac7b7-53ef-4606-97b7-cb539948b206";
const context = { params: Promise.resolve({ id, artifactId }) },
  request = new Request("https://app.example.test");
afterEach(() => vi.clearAllMocks());
function session() {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: mocks.eq.mockReturnThis(),
    maybeSingle: mocks.maybeSingle,
  };
  mocks.session.mockResolvedValue({
    supabase: {
      from: () => builder,
      storage: {
        from: mocks.bucket.mockReturnValue({ download: mocks.download }),
      },
    },
  });
}
describe("private immutable form download", () => {
  it("checks live ownership metadata, exact artifact and actual bytes before returning an uncached PDF", async () => {
    session();
    const bytes = Buffer.from("%PDF-SYNTHETIC-ONLY");
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: artifactId,
        object_path: `${id}/${artifactId}.pdf`,
        content_sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      error: null,
    });
    mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
    const result = await GET(request, context);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("content-type")).toBe("application/pdf");
    expect(mocks.eq.mock.calls).toEqual([
      ["request_id", id],
      ["id", artifactId],
      ["status", "stored"],
    ]);
    expect(mocks.bucket).toHaveBeenCalledWith("parent-form-artifacts");
    expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes);
    mocks.download.mockResolvedValue({
      data: new Blob(["changed bytes"]),
      error: null,
    });
    expect((await GET(request, context)).status).toBe(500);
  });
  it("returns no bytes without an authorized artifact or live session", async () => {
    session();
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(request, context)).status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
    mocks.session.mockRejectedValue(new Error("Authentication required"));
    expect((await GET(request, context)).status).toBe(401);
  });
});
