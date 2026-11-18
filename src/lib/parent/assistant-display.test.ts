import { describe, expect, it } from "vitest";
import { assistantIntroDisplay, assistantParagraphDisplay, assistantSourceDisplay } from "./assistant-display";
import { buildAssistantFacts, type AssistantSnapshot } from "./assistant";
import { fixtureRequest, fixtureNow } from "./test-fixtures";
import { ANSWER_FIELDS } from "./answers";
import { NEEDS, intakeSchema } from "./domain";
import { PROGRAMS } from "./programs";
import { parentText } from "./locale";

function snapshot(): AssistantSnapshot {
  const request = fixtureRequest();
  request.intake.needs = [...NEEDS]; request.intake.utilityProviders = ["peco", "pgw", "pwd"];
  request.mandate.recipientIds = PROGRAMS.map(program => program.id); request.mandate.maxRecipients = PROGRAMS.length; request.mandate.allowedData = ["household", "income", "utility", "documents"];
  request.next_run_at = "2026-10-26T17:35:00.000Z";
  request.required_actions = [{ id: "synthetic-step", need: "electricity", reason: "personal_step", resolver: "parent", title: "Original provider title", explanation: "Original provider explanation." }];
  request.facts = [{ need: "electricity", field: "amountDue", value: 0.01, source: "parent", asOf: "2026-10-25", confirmedAt: fixtureNow.toISOString() }];
  return { request, account: { language: "es", contactPreference: "email", quietHoursStart: 20, quietHoursEnd: 8, updatedAt: fixtureNow.toISOString() }, runtime: { planningReady: false, assistantReady: true }, progress: { summary: "A provider's original, unverified narrative." },
    operations: ["sent", "partner_received", "partner_accepted", "agency_submitted", "assistance_approved", "support_received", "declined", "delivery_unknown", "prepared", "unresolved"].map((state, index) => ({ id: `synthetic-${index}`, program_id: "snap-pa", need: "snap_new", state, evidence: { source: "agency_receipt", reference: "SYNTHETIC TEST ONLY", recordedAt: fixtureNow.toISOString() }, updated_at: fixtureNow.toISOString() })),
    reports: ["support_received", "assistance_approved", "declined", "unresolved"].map(outcome => ({ need: "snap_new", outcome, created_at: fixtureNow.toISOString() })),
    documents: ["uploaded", "processing", "validated", "unreadable", "raw_deleted", "deletion_pending", "deleted"].map(status => ({ status, total: 2 })), history: [] };
}
const content = (display: ReturnType<typeof assistantParagraphDisplay>) => display.parts.map(part => part.text).join("");
describe("source-bound deterministic assistant display, with no model or mutable request context", () => {
  const facts = buildAssistantFacts(snapshot(), fixtureNow).facts;
  it.each(["philly-food", "share-community-fridge-19129", "snap-pa"])("reuses the shared program explanation for %s", id => {
    const program = PROGRAMS.find(program => program.id === id)!;
    const fact = { text: `${program.name}: ${program.description} Program eligibility, capacity and approval are determined by the program.`, sourceLabel: "Official program information", sourceUrl: program.sourceUrl };
    expect(content(assistantParagraphDisplay(fact, "es"))).toContain(parentText("es", program.description));
  });
  it.each(facts)("keeps the original English bytes and covers current fact $id", fact => {
    expect(content(assistantParagraphDisplay(fact, "en"))).toBe(fact.text);
    if (fact.id.startsWith("program-") || fact.id.startsWith("personal-")) expect(assistantParagraphDisplay(fact, "en").parts[0].language).toBe("en");
    const display = assistantParagraphDisplay(fact, "es");
    if (fact.id === "progress-summary") {
      expect(display).toMatchObject({ translated: false, parts: [{ text: fact.text, language: "" }] });
    } else {
      expect(display.translated).toBe(true);
      expect(display.parts.some(part => part.language === "es")).toBe(true);
      if (display.original) expect(display.original.text).toBe(fact.text);
    }
  });
  it.each(["active", "paused", "cancelled", "closed"] as const)("preserves the %s request boundary in both languages", status => {
    const state = snapshot(); state.request.status = status;
    const fact = buildAssistantFacts(state, fixtureNow).facts.find(fact => fact.id === "request-status")!;
    expect(assistantParagraphDisplay(fact, "es").translated).toBe(true);
    expect(content(assistantParagraphDisplay(fact, "en"))).toBe(fact.text);
  });
  it.each(intakeSchema.shape.incomeFrequency.options.filter(value => value !== "unknown"))("preserves amounts and the original %s income period", frequency => {
    const fact = { text: `Your saved income is $0.01 (${frequency.replaceAll("_", " ")}). This is information you provided, not an agency eligibility decision.`, sourceLabel: "Your intake" };
    const display = assistantParagraphDisplay(fact, "es");
    expect(display.translated).toBe(true); expect(content(display)).toContain("$0.01"); expect(display.original?.text).toBe(fact.text);
  });
  it.each(ANSWER_FIELDS)("validates the exact recorded %s answer without renewing its date", field => {
    const values: Record<string, unknown> = { zip: "01904", householdSize: 30, income: { amount: 0, frequency: "weekly" }, incomeAmount: 0, incomeFrequency: "twice_monthly", utilityProvider: "other", accountAuthority: "authorized_caregiver", amountDue: 1000000, totalBalance: 0, dueDate: "2026-10-31", shutoffDate: "2026-11-01" };
    const value = typeof values[field] === "object" ? JSON.stringify(values[field]) : String(values[field]);
    const fact = { text: `Electric bill — your current ${field.replace(/([A-Z])/g, " $1").toLowerCase()} answer is ${value}. This is information you supplied for this need, as of 2026-10-25.`, sourceLabel: "Your saved answer" };
    const display = assistantParagraphDisplay(fact, "es"); expect(display.translated).toBe(true);
    expect(display.parts).toEqual(expect.arrayContaining([{ text: value, language: "" }, { text: "2026-10-25", language: "" }]));
    expect(display.original?.text).toBe(fact.text);
  });
  it.each(["provider api", "authenticated partner", "agency receipt", "operator confirmed"])("translates %s receipt meaning without turning transport into filing", source => {
    const program = PROGRAMS.find(program => program.id === "snap-pa")!;
    const fact = { text: `${program.name}: Delivery was recorded. This does not establish agency submission or approval.`, sourceLabel: `Recorded ${source} evidence`, sourceUrl: program.sourceUrl };
    expect(content(assistantParagraphDisplay(fact, "es"))).toContain("no demuestra la presentación ante una agencia ni la aprobación");
  });
  it.each(["19199", "00000", null])("matches only the recorded official program text with routing %s, preserving its original source", zip => {
    const state = snapshot(); state.request.intake.zip = zip;
    for (const fact of buildAssistantFacts(state, fixtureNow).facts.filter(fact => fact.id.startsWith("program-") || fact.id.startsWith("personal-"))) {
      const display = assistantParagraphDisplay(fact, "es"); expect(display.translated).toBe(true); expect(display.original).toEqual({ text: fact.text, language: "en" });
    }
  });
  it("handles expired permission and source-review warnings without claiming a fresh decision", () => {
    const state = snapshot(); state.request.mandate.mode = "full"; state.request.mandate.expiresAt = "2026-10-25T15:00:00Z";
    const later = new Date("2026-12-25T16:00:00Z");
    for (const fact of buildAssistantFacts(state, later).facts.filter(fact => ["permission", "permission-expired"].includes(fact.id) || fact.id.startsWith("program-"))) expect(assistantParagraphDisplay(fact, "es").translated).toBe(true);
  });
  it.each([
    { sourceLabel: "Current recorded work status", text: "Your saved household ZIP code is 19104." },
    { sourceLabel: "Unverified family note", text: "Your saved household ZIP code is 19104." },
    { sourceLabel: "Your account preferences", text: "Your saved household ZIP code is 19104." },
    { sourceLabel: "Your intake", text: 'The provider said: "Your saved household ZIP code is 19104."' },
    { sourceLabel: "Your intake", text: "Your saved household ZIP code is 19104.\n" },
    { sourceLabel: "Your intake", text: "Your saved household size is 31." },
    { sourceLabel: "Your intake", text: "Your saved income is $Infinity (weekly). This is information you provided, not an agency eligibility decision." },
    { sourceLabel: "Your saved answer", text: "Electric bill — your current amount due answer is 1000001. This is information you supplied for this need, as of 2026-10-25." },
    { sourceLabel: "__proto__", text: "constructor" },
  ])("never translates or drops an unknown/template-like original: $sourceLabel / $text", fact => {
    expect(assistantParagraphDisplay(fact, "es")).toEqual({ parts: [{ text: fact.text, language: "" }], translated: false });
  });
  it("keeps template-like personal-step wording original and rejects a changed source URL", () => {
    const text = "Your saved household ZIP code is 00000.. Use the matching next-step control in this request; chat does not save an application answer.";
    expect(assistantParagraphDisplay({ text, sourceLabel: "Your current necessary step" }, "es").parts[0]).toEqual({ text: "Your saved household ZIP code is 00000..", language: "" });
    const program = facts.find(fact => fact.id === "program-snap-pa")!;
    expect(assistantParagraphDisplay({ ...program, sourceUrl: "https://untrusted.invalid/" }, "es")).toEqual({ parts: [{ text: program.text, language: "" }], translated: false });
  });
  it("does not translate unknown source labels or introductions just because they match other interface copy", () => {
    expect(assistantSourceDisplay("Terms of service", "es")).toEqual({ text: "Terms of service", language: "" });
    expect(assistantIntroDisplay("Send", "es")).toEqual({ text: "Send", language: "" });
    expect(assistantIntroDisplay("Here is the latest recorded information for your request.", "es").language).toBe("es");
    expect(assistantSourceDisplay("Recorded agency receipt evidence", "es").language).toBe("es");
  });
});
