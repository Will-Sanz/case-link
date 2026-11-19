import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { ParentPacketDocument, ParentSummaryDocument, renderParentSummary, type RecordedPacket } from "./export";
import { buildSupportPlan } from "./planning";
import { fixtureNow, fixtureRequest } from "./test-fixtures";
import type { SupportRequest } from "./domain";
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
const operation: RecordedPacket = { id: "b72df7ef-922d-43ee-9825-55e209e5b47d", request_id: fixtureRequest().id, request_version: 3,
  program_id: "peco-cap", action: "submit", packet: { amountDue: 123.45, dueDate: "2026-11-01", familyNote: "María pidió apoyo; do not translate my words.", nested: { raw: "source_original" }, originalItems: [{ note: "María ñ" }, { amount: 123.45 }] },
  packet_hash: "a".repeat(64), state: "agency_submitted", evidence: { source: "authenticated_partner", reference: "RECIBO-Ñ-123", recordedAt: "2026-11-18T14:12:00Z", reason: "Original agency wording", attribution: { original: "Family wording" } },
  created_at: "2026-11-18T14:00:00Z", executed_at: "2026-11-18T14:01:00Z" };
const summary = (request: SupportRequest, locale?: "en" | "es") => text(ParentSummaryDocument({ request, locale }));
const packet = (locale?: "en" | "es") => text(ParentPacketDocument({ operation, locale }));
describe("localized private printable helpers", () => {
  it.each((["en", "es"] as const).flatMap(locale => ["constructor", "__proto__", "toString", "Saved"].map(raw => ({ locale, raw }))))("preserves literal own packet labels and unknown action/state/actor ($locale $raw)", ({ locale, raw }) => {
    const rawPacket = JSON.parse('{"constructor":"RAW_CONSTRUCTOR","__proto__":"RAW_PROTO","toString":"RAW_TO_STRING"}') as Record<string, unknown>;
    const unknown = { ...operation, action: raw, state: raw, packet: rawPacket };
    const before = structuredClone(unknown), result = text(ParentPacketDocument({ operation: unknown, locale }));
    expect(result).not.toContain("[native code]");
    for (const exact of ["constructorRAW_CONSTRUCTOR", "__proto__RAW_PROTO", "toStringRAW_TO_STRING"]) expect(result).toContain(exact);
    expect(result).toContain(`${locale === "es" ? "Estado registrado" : "Recorded state"}: ${raw}`);
    expect(result).toContain(`${locale === "es" ? "Acción" : "Action"}: ${raw} ·`);
    expect(unknown).toEqual(before);
    const request = fixtureRequest({ events: [{ id: "original-actor", request_id: fixtureRequest().id,
      actor: raw as NonNullable<SupportRequest["events"]>[number]["actor"], kind: "original.actor", summary: "Original event", created_at: operation.created_at, evidence: {} }] });
    expect(summary(request, locale)).toContain(`2026-11-18 · ${raw}`);
  });
  it("defaults to the existing English helper and retains preparation and attribution limits", () => {
    const result = summary(fixtureRequest());
    expect(result).toContain("Your support, in one place."); expect(result).toContain("not an agency application");
    expect(packet()).toContain("Your recorded support packet"); expect(packet()).toContain("different states");
  });
  it("uses Spanish help and status copy without changing request language or recorded wording", () => {
    const request = fixtureRequest({ intake: { ...fixtureRequest().intake, language: "en" }, events: [{ id: "event", request_id: fixtureRequest().id, actor: "parent", kind: "parent.outcome_reported",
      summary: "Original family statement with ñ and á", created_at: "2026-11-18T14:12:00Z", evidence: { outcome: "support_received", reference: "Please keep my original reference." } }] });
    const before = structuredClone(request), result = summary(request, "es");
    expect(result).toContain("Su apoyo, en un solo lugar."); expect(result).toContain("Su permiso"); expect(result).toContain("Actividad y evidencia");
    expect(result).toContain("Alimentos para ahora"); expect(result).toContain("Original family statement with ñ and á"); expect(result).toContain("Please keep my original reference.");
    expect(result).toContain("no es una solicitud oficial"); expect(result).toContain("idioma original"); expect(request).toEqual(before);
  });
  it("translates only packet helper labels and preserves all original values, references, amounts, dates and hashes", () => {
    const before = structuredClone(operation), result = packet("es");
    expect(result).toContain("Su paquete de apoyo registrado"); expect(result).toContain("Solicitud presentada"); expect(result).toContain("Evidencia atribuida");
    for (const exact of ["123.45", "2026-11-01", "María pidió apoyo; do not translate my words.", '{"raw":"source_original"}', '[{"note":"María ñ"},{"amount":123.45}]', "authenticated_partner", "RECIBO-Ñ-123", "Original agency wording", '{"original":"Family wording"}', operation.packet_hash, operation.created_at, operation.executed_at!]) expect(result).toContain(exact);
    expect(result).toContain("traducción oficial"); expect(operation).toEqual(before);
  });
  it("translates the known required personal steps while leaving program names and unknown recorded narratives original", () => {
    const request = fixtureRequest({ mandate: { ...fixtureRequest().mandate, mode: "prepare_only", allowedActions: ["research", "prepare"] } }), plan = buildSupportPlan(request, fixtureNow);
    const result = summary({ ...request, plan }, "es");
    expect(result).toContain("No se enviará nada."); expect(result).toContain("Confirme una opción de recogida o entrega");
    expect(result).toContain(plan.routes[0].title);
  });
  it.each(["paused", "cancelled", "closed"] as const)("does not describe a stopped request's recorded permission as currently valid (%s)", status => {
    const result = summary(fixtureRequest({ status }), "es");
    expect(result).toContain("Vencimiento registrado"); expect(result).not.toContain("Válida hasta");
    if (status === "closed") expect(result).toContain("Esta solicitud está cerrada");
    if (status === "cancelled") expect(result).toContain("El trabajo futuro está detenido");
  });
  it("sets the actual Spanish PDF title, document language and page helper while keeping English the default", async () => {
    const es = await PDFDocument.load(await renderParentSummary(fixtureRequest(), "es")), en = await PDFDocument.load(await renderParentSummary(fixtureRequest()));
    expect(es.getTitle()).toBe("Su resumen de apoyo de CaseLink"); expect(es.catalog.lookup(PDFName.of("Lang"), PDFString).asString()).toBe("es");
    expect(en.getTitle()).toBe("Your CaseLink support summary");
  });
});
