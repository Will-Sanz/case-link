import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  renderParentPacket,
  renderParentSummary,
  type RecordedPacket,
} from "../src/lib/parent/export";
import { fillVerifiedForm } from "../src/lib/parent/forms";
import {
  fixtureIntake,
  fixtureMandate,
  fixtureNow,
  fixtureRequest,
} from "../src/lib/parent/test-fixtures";
import { buildSupportPlan } from "../src/lib/parent/planning";
import { NEEDS, NEED_LABELS } from "../src/lib/parent/domain";

async function main() {
  const directory = resolve("tmp/parent-verification/pdfs");
  mkdirSync(directory, { recursive: true });
  const cases: { name: string; required: string[]; minimumPages: number }[] =
    [];
  const intake = fixtureIntake({ needs: [...NEEDS] }),
    mandate = fixtureMandate({
      mode: "prepare_only",
      allowedActions: ["research", "prepare"],
      recipientIds: [
        "philly-food",
        "snap-pa",
        "wic-pa",
        "peco-cap",
        "pgw-crp",
        "pwd-tap",
      ],
    });
  const request = fixtureRequest({
    intake,
    mandate,
    plan: buildSupportPlan(intake, mandate, fixtureNow),
  });
  writeFileSync(
    resolve(directory, "combined-summary.pdf"),
    await renderParentSummary(request),
  );
  cases.push({
    name: "combined-summary",
    required: [
      "Your support, in one place.",
      ...NEEDS.map((need) => NEED_LABELS[need]),
      "Preparation only",
      "not an agency application",
    ],
    minimumPages: 2,
  });
  const operation: RecordedPacket = {
    id: "b72df7ef-922d-43ee-9825-55e209e5b47d",
    request_id: request.id,
    request_version: 3,
    program_id: "peco-cap",
    action: "submit",
    packet: {
      zip: "19104",
      householdSize: 3,
      amountDue: 123.45,
      totalBalance: 678.9,
      dueDate: "2026-11-01",
    },
    packet_hash: "a".repeat(64),
    state: "agency_submitted",
    evidence: {
      source: "authenticated_partner",
      reference: "SYNTHETIC-RECEIPT-123",
      recordedAt: fixtureNow.toISOString(),
    },
    created_at: fixtureNow.toISOString(),
    executed_at: fixtureNow.toISOString(),
  };
  writeFileSync(
    resolve(directory, "exact-packet.pdf"),
    await renderParentPacket(operation),
  );
  cases.push({
    name: "exact-packet",
    required: [
      "Your recorded support packet",
      "Application submitted",
      "123.45",
      "678.9",
      "2026-11-01",
      "SYNTHETIC-RECEIPT-123",
      "authenticated_partner",
      "Household information version: 3",
    ],
    minimumPages: 1,
  });
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  form
    .createTextField("amount-due")
    .addToPage(page, { x: 60, y: 650, width: 220, height: 30 });
  form
    .createTextField("parent-signature")
    .addToPage(page, { x: 60, y: 590, width: 300, height: 30 });
  const source = await pdf.save();
  const filled = await fillVerifiedForm(
    {
      programId: "peco-cap",
      templateId: "synthetic",
      version: "v1",
      templateSha256: createHash("sha256").update(source).digest("hex"),
      verifiedUntil: "2026-12-01T00:00:00Z",
      fields: { "amount-due": "amountDue" },
      requiredFields: ["amountDue"],
      personalFields: ["parent-signature"],
    },
    source,
    { amountDue: 123.45 },
    fixtureNow,
  );
  const check = (await PDFDocument.load(filled)).getForm();
  if (
    check.getTextField("amount-due").getText() !== "123.45" ||
    check.getTextField("parent-signature").getText()
  )
    throw new Error("Exact form facts or required personal field changed.");
  writeFileSync(resolve(directory, "known-form.pdf"), filled);
  const visualCopy = await PDFDocument.load(filled);
  visualCopy.getForm().flatten();
  writeFileSync(
    resolve(directory, "known-form-render.pdf"),
    await visualCopy.save(),
  );
  cases.push({
    name: "known-form-render",
    required: ["123.45"],
    minimumPages: 1,
  });
  writeFileSync(
    resolve(directory, "manifest.json"),
    JSON.stringify(cases, null, 2),
  );
  execFileSync(
    process.env.CASELINK_PYTHON_BIN ?? "python3",
    [resolve("scripts/verify-parent-pdfs.py"), directory],
    { stdio: "inherit" },
  );
}
main().catch(() => {
  process.stderr.write("Synthetic parent PDF verification failed.\n");
  process.exitCode = 1;
});
