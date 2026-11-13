import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  remove: vi.fn(),
  session: vi.fn(),
}));
vi.mock("./auth", () => ({ requireParentSession: mock.session }));
import {
  correctSupportRequest,
  confirmParentDocumentUpload,
  deleteParentDocument,
  getSupportRequest,
  registerParentDocument,
  resolveParentAction,
  startSupportRequest,
  getReusableZip,
} from "./data";
import type { ServiceMandate, SupportIntake } from "./domain";
const requestId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const intake: SupportIntake = {
  needs: ["food_now"],
  urgency: "today",
  zip: "19104",
  language: "en",
  householdSize: null,
  childrenUnderFive: null,
  pregnantOrPostpartum: null,
  incomeAmount: null,
  incomeFrequency: "unknown",
  utilityProviders: [],
  shutoffDate: null,
  accountAuthority: "self",
  contactPreference: "in_app",
  adultConfirmed: true,
};
const mandate: ServiceMandate = {
  version: 1,
  mode: "prepare_only",
  recipientIds: ["philly-food"],
  allowedActions: ["research", "prepare"],
  allowedData: ["household"],
  expiresAt: "2026-11-24T12:00:00Z",
  maxAttempts: 12,
  maxRecipients: 1,
  bookingPreference: "ask_me",
  accepted: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.session.mockResolvedValue({
    user: { id: "owner" },
    supabase: {
      rpc: mock.rpc,
      from: mock.from,
      storage: { from: () => ({ remove: mock.remove }) },
    },
  });
  mock.rpc.mockResolvedValue({ data: requestId, error: null });
  mock.remove.mockResolvedValue({ data: [], error: null });
});
describe("parent data boundary", () => {
  it("fails closed when owned private-history metadata cannot be checked", async () => {
    mock.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      maybeSingle: async () => table === "parent_requests" ? { data: { id: requestId }, error: null }
        : { data: null, error: { code: "XX000", message: "PrivateMarkerCanary" } },
      then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    }));
    await expect(getSupportRequest(requestId)).rejects.toThrow("CaseLink could not save or load this information. Please try again.");
  });
  it("keeps reused routing server-owned and rejects malformed default responses without echoing them", async () => {
    const source = { sourceRequestId: requestId, sourceVersion: 2 };
    await startSupportRequest(intake, mandate, documentId, source);
    expect(mock.rpc).toHaveBeenCalledWith("parent_start_request_with_reused_zip", {
      p_intake: intake, p_mandate: mandate, p_idempotency_key: documentId,
      p_source_request_id: requestId, p_source_version: 2,
    });
    mock.rpc.mockResolvedValue({ data: { value: "private-invalid-value" }, error: null });
    await expect(getReusableZip()).rejects.toThrow("could not load saved routing information");
    mock.rpc.mockResolvedValue({ data: null, error: null });
    expect(await getReusableZip()).toBeNull();
    mock.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "parent_reuse_source_changed" } });
    await expect(startSupportRequest(intake, mandate, documentId, source)).rejects.toThrow("parent_reuse_source_changed");
  });
  it("validates exact intake and permission before dispatch and binds the start retry key", async () => {
    expect(await startSupportRequest(intake, mandate, documentId)).toBe(
      requestId,
    );
    expect(mock.rpc).toHaveBeenCalledWith("parent_start_request", {
      p_intake: intake,
      p_mandate: mandate,
      p_idempotency_key: documentId,
    });
    mock.rpc.mockClear();
    await expect(
      startSupportRequest({ ...intake, zip: "private prose" }, mandate),
    ).rejects.toThrow();
    await expect(
      startSupportRequest(intake, { ...mandate, allowedActions: ["submit"] }),
    ).rejects.toThrow();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("preserves optimistic version checking and does not expose database details", async () => {
    mock.rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "database-sensitive-detail" },
    });
    await expect(correctSupportRequest(requestId, intake, 3)).rejects.toThrow(
      "Reload",
    );
    expect(mock.rpc).toHaveBeenCalledWith("parent_correct_request", {
      p_request_id: requestId,
      p_intake: intake,
      p_expected_version: 3,
    });
    mock.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "database-sensitive-detail" },
    });
    await expect(correctSupportRequest(requestId, intake, 3)).rejects.toThrow(
      "permission has changed",
    );
  });
  it("does not fetch events or documents for an unavailable request", async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mock.from.mockReturnValue(builder);
    expect(await getSupportRequest(requestId)).toBeNull();
    expect(mock.from).toHaveBeenCalledTimes(1);
    expect(mock.from).toHaveBeenCalledWith("parent_requests");
  });
  it("requires explicit document processing consent and bounded source metadata", async () => {
    const valid = {
      requestId,
      filename: "bill.pdf",
      mediaType: "application/pdf" as const,
      sizeBytes: 400,
      pageCount: 1,
      consentVersion: "2026-10-25" as const,
    };
    mock.rpc.mockResolvedValue({
      data: { id: documentId, object_path: `owner/${requestId}/${documentId}` },
      error: null,
    });
    expect((await registerParentDocument(valid)).id).toBe(documentId);
    mock.rpc.mockClear();
    for (const invalid of [
      { ...valid, filename: "../bill.pdf" },
      { ...valid, sizeBytes: 10485761 },
      { ...valid, pageCount: 6 },
      { ...valid, consentVersion: "" },
    ]) {
      await expect(
        registerParentDocument(invalid as typeof valid),
      ).rejects.toThrow();
    }
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("confirms completed upload bytes through the scoped RPC before work resumes", async () => {
    await confirmParentDocumentUpload(requestId, documentId);
    expect(mock.rpc).toHaveBeenCalledWith("parent_confirm_document_upload", {
      p_request_id: requestId,
      p_document_id: documentId,
    });
    mock.rpc.mockClear();
    await expect(
      confirmParentDocumentUpload(requestId, "not-a-document-id"),
    ).rejects.toThrow();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("revokes document use through the audited RPC and leaves physical erasure to retention", async () => {
    mock.rpc.mockResolvedValue({
      data: `owner/${requestId}/${documentId}`,
      error: null,
    });
    await deleteParentDocument(requestId, documentId);
    expect(mock.rpc).toHaveBeenCalledWith("parent_delete_document", {
      p_request_id: requestId,
      p_document_id: documentId,
    });
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it("routes parent updates through attributed reports rather than accepting an outcome state", async () => {
    await resolveParentAction(
      requestId,
      "identity-step",
      "I completed the provider step",
    );
    expect(mock.rpc).toHaveBeenCalledWith("parent_resolve_action", {
      p_request_id: requestId,
      p_action_id: "identity-step",
      p_value: "I completed the provider step",
    });
  });
});
