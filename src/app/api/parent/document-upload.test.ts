import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  register: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@/lib/parent/auth", () => ({ requireParentSession: mocks.session }));
vi.mock("@/lib/parent/data", () => ({
  registerParentDocument: mocks.register,
  confirmParentDocumentUpload: mocks.confirm,
  deleteParentDocument: mocks.remove,
  getSupportRequest: mocks.request,
  PARENT_DOCUMENT_BUCKET: "parent-documents",
}));
import { POST } from "./requests/[id]/documents/route";
const id = fixtureRequest().id,
  documentId = "79dac7b7-53ef-4606-97b7-cb539948b206",
  context = { params: Promise.resolve({ id }) };
const request = (consent = "1") => {
  const form = new FormData();
  form.set("consent", consent);
  form.set(
    "file",
    new File(["%PDF-SYNTHETIC-QUARANTINE"], "synthetic.pdf", {
      type: "application/pdf",
    }),
  );
  return new Request(
    `https://app.example.test/api/parent/requests/${id}/documents`,
    {
      method: "POST",
      headers: { Origin: "https://app.example.test" },
      body: form,
    },
  );
};
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.test");
  vi.clearAllMocks();
  mocks.request.mockResolvedValue(fixtureRequest());
  mocks.session.mockResolvedValue({
    supabase: { storage: { from: () => ({ upload: mocks.upload }) } },
  });
  mocks.register.mockResolvedValue({
    id: documentId,
    request_id: id,
    object_path: "private-synthetic-path",
    status: "uploaded",
  });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.confirm.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe("consented quarantined upload", () => {
  it("denies an owned private PECO request before reading or storing any file", async () => {
    mocks.request.mockResolvedValue(fixtureRequest({ has_peco_application_details: true }));
    const input = request();
    expect((await POST(input, context)).status).toBe(403); expect(input.bodyUsed).toBe(false);
    expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("fails closed before reading a file if private-purpose metadata is unavailable", async () => {
    mocks.request.mockRejectedValue(new Error("database PecoPrivateCanary"));
    const input = request(), response = await POST(input, context);
    expect(response.status).toBe(500); expect(input.bodyUsed).toBe(false); expect(await response.text()).not.toContain("PecoPrivateCanary");
    expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("preserves separate document consent for an ordinary utility request without a private PECO marker", async () => {
    const support = fixtureRequest(); support.intake.needs = ["electricity"]; support.intake.utilityProviders = ["peco"]; support.mandate.allowedData = ["household", "income", "utility"];
    mocks.request.mockResolvedValue(support);
    expect((await POST(request(), context)).status).toBe(201);
    expect(mocks.upload).toHaveBeenCalledOnce();
  });
  it.each(["wic_new", "wic_continuing"] as const)("rejects %s documents before parsing or storing any file", async need => {
    mocks.request.mockResolvedValue(fixtureRequest({ intake: { ...fixtureRequest().intake, needs: [need] } }));
    const input = request();
    expect((await POST(input, context)).status).toBe(403);
    expect(input.bodyUsed).toBe(false);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("does not parse uploads for an unavailable owned request", async () => {
    mocks.request.mockResolvedValue(null);
    const input = request();
    expect((await POST(input, context)).status).toBe(404);
    expect(input.bodyUsed).toBe(false);
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("confirms and resumes only after private bytes exist, without exposing their storage path", async () => {
    const result = await POST(request(), context);
    expect(result.status).toBe(201);
    expect(mocks.confirm).toHaveBeenCalledWith(id, documentId);
    expect(mocks.register.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upload.mock.invocationCallOrder[0],
    );
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.confirm.mock.invocationCallOrder[0],
    );
    expect(mocks.register.mock.calls[0][0].pageCount).toBeNull();
    expect(await result.text()).not.toContain("private-synthetic-path");
  });
  it("never queues processing without consent or after failed storage", async () => {
    expect((await POST(request("0"), context)).status).toBe(400);
    expect(mocks.register).not.toHaveBeenCalled();
    mocks.upload.mockResolvedValue({
      error: new Error("synthetic interrupted storage"),
    });
    expect((await POST(request(), context)).status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledWith(id, documentId);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("invalidates a quarantined upload if permission changes before confirmation", async () => {
    mocks.confirm.mockRejectedValueOnce(
      new Error("This request is unavailable, or its permission has changed."),
    );
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.remove).toHaveBeenCalledWith(id, documentId);
  });
});
