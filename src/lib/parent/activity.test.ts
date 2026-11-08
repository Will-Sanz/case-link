import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), client: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session, createParentClient: mocks.client }));
import { listRequestOperations, trustedReferral } from "./activity";
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


describe("scoped SNAP agency next-step ingestion", () => {
  const operationId = "11111111-1111-4111-8111-111111111111";
  const observedAt = "2026-11-07T12:00:00Z";
  const status = { state: "agency_submitted", reference: "Synthetic SNAP notice", observedAt,
    agencyStatus: { reference: "Synthetic SNAP notice", observedAt, documents: [{ name: "Proof of income", dueDate: "2026-11-18" }],
      interview: { scheduledAt: "2026-11-19T10:00:00-05:00", channel: "phone" } } };
  function client() {
    const rpc = vi.fn().mockResolvedValue({ data: "receipt-id", error: null });
    mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { email_confirmed_at: observedAt } }, error: null }) }, rpc });
    return rpc;
  }
  it("forwards the actual observation and absolute deadlines without inventing source or refreshing observation time", async () => {
    const rpc = client();
    expect(await trustedReferral(operationId, status)).toBe("receipt-id");
    expect(rpc).toHaveBeenCalledWith("parent_record_referral_status", {
      p_operation_id: operationId, p_state: status.state,
      p_evidence: { reference: status.reference, observedAt, agencyStatus: status.agencyStatus },
    });
  });
  it("trims JavaScript whitespace before sending canonical notice labels to the database", async () => {
    const rpc = client();
    await trustedReferral(operationId, { ...status, reference: "\u00a0Synthetic SNAP notice\t", agencyStatus: { ...status.agencyStatus, reference: "\tSynthetic SNAP notice\ufeff", documents: [{ name: "\tProof of income\u00a0" }] } });
    expect(rpc.mock.calls[0][1].p_evidence).toMatchObject({ reference: status.reference, agencyStatus: { reference: status.reference, documents: [{ name: "Proof of income" }] } });
  });
  it.each([
    { ...status, source: "agency_receipt" },
    { ...status, reason: "provider_declined" },
    { ...status, state: "partner_received" },
    { ...status, agencyStatus: { ...status.agencyStatus, observedAt: "2026-11-07T13:00:00Z" } },
    { ...status, agencyStatus: { ...status.agencyStatus, reference: "Different notice" } },
    { ...status, agencyStatus: { ...status.agencyStatus, program: "Medicaid" } },
    { ...status, agencyStatus: { ...status.agencyStatus, documents: [{ name: "SSN: 123-45-6789" }] } },
    { ...status, agencyStatus: { ...status.agencyStatus, interview: {} } },
    { ...status, state: "assistance_approved", agencyStatus: { ...status.agencyStatus, waitingForDecision: true } },
  ])("rejects inconsistent or unrelated next-step evidence %# before RPC", async input => {
    const rpc = client(); await expect(trustedReferral(operationId, input)).rejects.toThrow(); expect(rpc).not.toHaveBeenCalled();
  });
  it("retains the existing non-SNAP referral input contract", async () => {
    const rpc = client();
    await trustedReferral(operationId, { state: "partner_received", reference: "Synthetic legacy receipt", observedAt });
    expect(rpc).toHaveBeenCalledWith("parent_record_referral_status", { p_operation_id: operationId, p_state: "partner_received", p_evidence: { reference: "Synthetic legacy receipt", observedAt } });
  });
});
