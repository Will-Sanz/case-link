import { describe, expect, it } from "vitest";
import { fixtureIntake, fixtureProtectedSnapOperation, fixtureRequest } from "@/lib/parent/test-fixtures";
import { currentApplicationState, type OperationHistory, type RecordedOperation } from "./support-activity";
const request = fixtureRequest({ intake: fixtureIntake({ needs: ["snap_new"] }), controlled_test: true });
const operation: RecordedOperation = { id: "test", request_id: request.id, request_version: request.version, need: "snap_new", program_id: "snap-pa", state: "sent", action: "submit", artifact_id: null, protected_packet: fixtureProtectedSnapOperation().packet.protectedSnapPacket, created_at: request.updated_at, evidence: { source: "provider_api", reference: "sinch-emulation:fixture", recordedAt: request.updated_at } };
const history = (ops = [operation]) => ({ data: { operations: ops, historyLimited: false }, loading: false, error: null });
describe("one evidence-backed application projection", () => {
  it("requires current-version verified transport evidence for fictional completion", () => {
    expect(currentApplicationState(request, history()).label).toBe("Free emulator test completed · no agency filing");
    for (const change of [{ request_version: 0 }, { request_id: "other" }, { state: "prepared" }, { evidence: { ...operation.evidence, source: "parent_reported" } }, { evidence: null }]) {
      expect(currentApplicationState(request, history([{ ...operation, ...change }])).label).not.toContain("completed");
    }
  });
  it.each([{ loading: true, error: null, label: "Checking application records…" }, { loading: false, error: new Error("offline"), label: "Application records unavailable" }])("never overrides unavailable evidence with cached emulator completion: $label", ({ label, ...state }) => {
    expect(currentApplicationState(request, { ...history(), ...state }).label).toBe(label);
  });
  it("separates a Submit decision, unknown delivery, transport and agency submission", () => {
    const real = { ...request, controlled_test: false }, review = fixtureProtectedSnapOperation({ snapSubmissionAuthorized: true });
    expect(currentApplicationState(real, history([{ ...operation, state: "prepared", evidence: null }]), review).label).toBe("Submit decision recorded");
    expect(currentApplicationState(real, history([{ ...operation, state: "delivery_unknown", evidence: null }]), review).label).toBe("Agency submission not confirmed");
    expect(currentApplicationState(real, history()).label).toBe("Transport acknowledgment recorded");
    const submitted = { ...operation, state: "agency_submitted", evidence: { ...operation.evidence, source: "agency_receipt", reference: "synthetic-agency-receipt" } };
    expect(currentApplicationState(real, history([submitted])).label).toBe("Application submission recorded");
    expect(currentApplicationState({ ...real, version: 2 }, history([submitted])).label).toBe("An earlier application version was submitted");
  });
  it("preserves incomplete history instead of inferring a fresh application", () => {
    const h: Pick<OperationHistory, "data" | "loading" | "error"> = { ...history([]), data: { operations: [], historyLimited: true } };
    expect(currentApplicationState(request, h).label).toBe("Earlier application history needs checking");
  });
});
