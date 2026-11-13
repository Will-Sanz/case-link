import { createHash } from "node:crypto";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFPage,
  PDFObject,
  PDFStream,
  PDFString,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { z } from "zod";
import { inspectDocument, MAX_DOCUMENT_BYTES } from "./documents";
import { assessPecoCapIncomeEvidence, pecoCapIncomeBindingSchema, pecoCapPreparationReferenceSchema, type PecoCapIncomeInput } from "./peco-cap-income";

export const PECO_CAP_TEMPLATE_SHA256 =
  "87d4a25f808eac9e79eaf49197bb38c1e375d22b18ce0533995eca81698099cc";

const text = (maximum = 160) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value));
const person = z
  .object({
    firstName: text(80),
    lastName: text(80),
    middleInitial: text(2).optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    incomeSource: z.string().trim().max(160).refine((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !/liheap/i.test(value)).optional(),
  })
  .strict();
const inputSchema = z
  .object({
    accountNumber: text(80),
    applicant: person,
    address: z
      .object({
        street: text(),
        apartment: text(80).optional(),
        city: text(80),
        state: text(40),
        zip: text(20),
      })
      .strict(),
    homePhone: text(80).optional(),
    cellPhone: text(80).optional(),
    smsUpdates: z.boolean().optional(),
    householdMembers: z
      .array(person.extend({ relationship: text(80) }).strict())
      .max(100),
  })
  .strict();

export type PecoCapDraftInput = z.infer<typeof inputSchema>;
export const pecoCapPreparationSnapshotSchema = z.object({
  id: pecoCapPreparationReferenceSchema.shape.id,
  revision: pecoCapPreparationReferenceSchema.shape.revision,
  binding: pecoCapIncomeBindingSchema,
  subjectIds: z.array(pecoCapPreparationReferenceSchema.shape.id).min(1).max(100),
  confirmedAt: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true }),
  retentionUntil: z.iso.datetime({ offset: true }),
  details: inputSchema,
}).strict();
export type PecoCapPreparationSnapshot = z.infer<typeof pecoCapPreparationSnapshotSchema>;
type Person = z.infer<typeof person>;
type Row = Person & { relationship: string };
type Box = [number, number, number, number];

function fullName(person: Person) {
  return `${person.lastName}, ${person.firstName}${person.middleInitial ? `, ${person.middleInitial}` : ""}`;
}

function validBirthDate(value: string, today: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    value > today
  )
    throw new Error("Invalid birth date.");
}

function drawBox(
  page: PDFPage,
  font: PDFFont,
  value: string,
  [x, y, width, height]: Box,
  maximumLines = 1,
  size = 8.5,
) {
  font.encodeText(value);
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
    } else {
      if (!line || font.widthOfTextAtSize(word, size) > width)
        throw new Error("Text does not fit.");
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  const leading = size + 1;
  if (lines.length > maximumLines || lines.length * leading > height)
    throw new Error("Text does not fit.");
  const firstY = y + (height - lines.length * leading) / 2 + leading - size;
  for (const [index, text] of lines.entries())
    page.drawText(text, {
      x,
      y: firstY + (lines.length - index - 1) * leading,
      font,
      size,
      color: rgb(0, 0, 0),
    });
}

function drawRow(
  page: PDFPage,
  font: PDFFont,
  row: Row,
  y: number,
  printedSelf = false,
) {
  drawBox(page, font, fullName(row), [39, y, 154, 21], 2);
  drawBox(
    page,
    font,
    `${row.dateOfBirth.slice(5, 7)}/${row.dateOfBirth.slice(8)}/${row.dateOfBirth.slice(0, 4)}`,
    [334, y, 60, 21],
  );
  if (!printedSelf)
    drawBox(page, font, row.relationship, [400, y, 64, 21], 2);
  if (row.incomeSource) drawBox(page, font, row.incomeSource, [470, y, 118, 21], 2);
}

/** Synthetic rehearsal only; no signing, government-identifier, persistence or transport channel. */
async function preparePecoCapDraft(
  template: Uint8Array,
  input: unknown,
  now: Date,
): Promise<{ document: PDFDocument; font: PDFFont; data: PecoCapDraftInput }> {
  if (
    createHash("sha256").update(template).digest("hex") !==
    PECO_CAP_TEMPLATE_SHA256
  )
    throw new Error("The PECO CAP template differs from its reviewed source.");
  try {
    const data = inputSchema.parse(input);
    const today = agencyDate.format(now);
    const rows: Row[] = [
      { ...data.applicant, relationship: "SELF" },
      ...data.householdMembers,
    ];
    for (const row of rows) {
      validBirthDate(row.dateOfBirth, today);
      const age = Number(today.slice(0, 4)) - Number(row.dateOfBirth.slice(0, 4)) - (today.slice(5) < row.dateOfBirth.slice(5) ? 1 : 0);
      if (age >= 18 && !row.incomeSource) throw new Error("Required adult income information is missing.");
    }
    const birth = data.applicant.dateOfBirth;
    const age =
      Number(today.slice(0, 4)) -
      Number(birth.slice(0, 4)) -
      (today.slice(5) < birth.slice(5) ? 1 : 0);
    if (age < 18 || (data.smsUpdates === true && !data.cellPhone))
      throw new Error("Required applicant information is missing.");

    const source = await PDFDocument.load(template, { updateMetadata: false });
    const links: { page: number; rectangle: number[] }[] = [];
    // The reviewed source has ambiguous orphan/duplicate widgets; static drawing avoids stale logical field values.
    for (const [index, page] of source.getPages().entries()) {
      const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annotations) continue;
      for (let i = annotations.size() - 1; i >= 0; i--) {
        const annotation = source.context.lookup(annotations.get(i), PDFDict);
        if (annotation.get(PDFName.of("Subtype"))?.toString() === "/Widget")
          annotations.remove(i);
        else {
          const action = annotation.lookup(PDFName.of("A"), PDFDict);
          const uri = action.lookup(PDFName.of("URI"), PDFString);
          if (
            annotation.get(PDFName.of("Subtype"))?.toString() !== "/Link" ||
            action.get(PDFName.of("S"))?.toString() !== "/URI" ||
            uri.decodeText() !== "mailto:PECOCAP@exeloncorp.com"
          )
            throw new Error("The reviewed source link changed.");
          const rectangle = annotation
            .lookup(PDFName.of("Rect"), PDFArray)
            .asArray()
            .map((coordinate) => Number(coordinate.toString()));
          links.push({ page: index, rectangle });
        }
      }
    }
    source.catalog.delete(PDFName.of("AcroForm"));
    const font = await source.embedFont(StandardFonts.Helvetica);
    const firstPage = source.getPage(0);
    const fields: [string | undefined, Box][] = [
      [data.accountNumber, [39, 511, 261, 12]],
      [data.homePhone, [307, 511, 280, 12]],
      [data.applicant.lastName, [39, 487, 205, 12]],
      [data.applicant.firstName, [250, 487, 213, 12]],
      [data.applicant.middleInitial, [469, 487, 118, 12]],
      [data.address.street, [39, 465, 425, 12]],
      [data.address.apartment, [469, 465, 118, 12]],
      [data.address.city, [39, 442, 204, 12]],
      [data.address.state, [249, 442, 214, 12]],
      [data.address.zip, [469, 442, 118, 12]],
      [data.cellPhone, [39, 419, 204, 12]],
    ];
    for (const [value, box] of fields)
      if (value !== undefined) drawBox(firstPage, font, value, box);
    firstPage.drawRectangle({
      x: 298.875,
      y: 422.125,
      width: 12.875,
      height: 15.125,
      borderWidth: 0.75,
      borderColor: rgb(0, 0, 0),
    });
    if (data.smsUpdates === true)
      drawBox(firstPage, font, "X", [301, 424, 9, 12]);
    const sourceRowYs = [301.5, 277.875, 254, 230.625, 206.25];
    rows.slice(0, 5).forEach((row, index) => {
      drawRow(firstPage, font, row, sourceRowYs[index], index === 0);
    });

    const result = await PDFDocument.create();
    result.setCreationDate(now);
    result.setModificationDate(now);
    result.setTitle("Unsigned PECO CAP preparation draft - not sent");
    const outputFont = await result.embedFont(StandardFonts.Helvetica);
    for (const [index, page] of source.getPages().entries()) {
      const embedded = await result.embedPage(page);
      const output = result.addPage([612, 792]);
      output.drawPage(embedded, {
        x: 18.36,
        y: 32,
        width: 612 * 0.94,
        height: 792 * 0.94,
      });
      for (const link of links.filter((link) => link.page === index)) {
        const [left, bottom, right, top] = link.rectangle;
        output.node.addAnnot(
          result.context.register(
            result.context.obj({
              Type: "Annot",
              Subtype: "Link",
              Rect: [
                left * 0.94 + 18.36,
                bottom * 0.94 + 32,
                right * 0.94 + 18.36,
                top * 0.94 + 32,
              ],
              Border: [0, 0, 0],
              A: {
                Type: "Action",
                S: "URI",
                URI: PDFString.of("mailto:PECOCAP@exeloncorp.com"),
              },
            }),
          ),
        );
      }
    }
    for (let offset = 5; offset < rows.length; offset += 22) {
      const page = result.addPage([612, 792]);
      page.drawText("PECO CAP - additional household members", {
        x: 36,
        y: 742,
        size: 14,
        font: outputFont,
      });
      page.drawText("Continuation of the unsigned application preparation draft.", {
        x: 36,
        y: 722,
        size: 9,
        font: outputFont,
      });
      const columns = [36, 196, 332, 398, 468, 590];
      const headings = [
        "Name (Last, First, M.I.)",
        "Optional SSN/ITIN",
        "Birth date",
        "Relationship",
        "Source of income",
      ];
      headings.forEach((heading, index) =>
        drawBox(
          page,
          outputFont,
          heading,
          [columns[index] + 3, 687, columns[index + 1] - columns[index] - 6, 24],
          2,
          8,
        ),
      );
      const members = rows.slice(offset, offset + 22);
      for (let i = 0; i <= members.length; i++)
        page.drawLine({
          start: { x: 36, y: 684 - i * 28 },
          end: { x: 590, y: 684 - i * 28 },
          thickness: 0.5,
        });
      for (const x of columns)
        page.drawLine({
          start: { x, y: 711 },
          end: { x, y: 684 - members.length * 28 },
          thickness: 0.5,
        });
      page.drawLine({
        start: { x: 36, y: 711 },
        end: { x: 590, y: 711 },
        thickness: 0.5,
      });
      members.forEach((row, index) =>
        drawRow(page, outputFont, row, 658 - index * 28),
      );
    }
    return { document: result, font: outputFont, data };
  } catch {
    // PDF/font/schema errors can echo private values or unknown input keys.
    throw new Error(
      "The PECO CAP preparation draft could not be created from the supplied information.",
    );
  }
}

export type PecoCapIncomePreparationManifest = {
  kind: "unsigned_preparation_rehearsal";
  scope: PecoCapIncomeInput["scope"]["binding"];
  applicantSubjectId: string;
  incomeConsentVersion: string;
  documentConsentVersion: string;
  preparationSnapshot: z.infer<typeof pecoCapPreparationReferenceSchema>;
  formInputSha256: string;
  templateSha256: string;
  certificationTemplateSha256: string;
  basis: "30_days" | "12_months";
  applicationAsOf: string;
  validUntil: string;
  retentionUntil: string;
  pageCount: number;
  originals: {
    documentId: string;
    sourceSha256: string;
    pageCount: number;
    outputStartPage: number;
    outputEndPage: number;
  }[];
  artifactSha256: string;
};

const originalSchema = z.array(z.object({
  documentId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/),
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.length > 0 && bytes.length <= MAX_DOCUMENT_BYTES),
}).strict()).min(1).max(10);
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const agencyDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

// Search the date boundary itself: Pennsylvania's DST days can have 23 or 25 hours.
function nextAgencyMidnight(now: Date) {
  const today = agencyDate.format(now);
  let low = now.getTime();
  let high = low + 26 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (agencyDate.format(new Date(middle)) === today) low = middle;
    else high = middle;
  }
  return high;
}

async function inspectStaticProof(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) throw new Error();
  const proof = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  await inspectDocument(bytes, "application/pdf");
  const unsupported = new Set([
    "AcroForm", "FT", "ByteRange", "DocMDP", "Perms", "AA", "OpenAction", "JavaScript", "JS",
    "Launch", "EmbeddedFile", "EmbeddedFiles", "RichMedia", "XFA", "OCProperties", "OC",
    "Collection", "NeedsRendering",
  ]);
  const inspect = (object: PDFObject) => {
    if (object instanceof PDFStream) inspect(object.dict);
    else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        const resolved = proof.context.lookup(value);
        if (unsupported.has(key.decodeText())) throw new Error();
        if (key.decodeText() === "Type" && ["Sig", "Annot", "OCG", "OCMD"].includes(
          resolved instanceof PDFName ? resolved.decodeText() : "",
        )) throw new Error();
        if (key.decodeText() === "Subtype" && resolved instanceof PDFName && resolved.decodeText() === "Widget")
          throw new Error();
        inspect(value);
      }
    } else if (object instanceof PDFArray) object.asArray().forEach(inspect);
    else if (object instanceof PDFName && unsupported.has(object.decodeText())) throw new Error();
  };
  for (const [, object] of proof.context.enumerateIndirectObjects()) inspect(object);
  for (const page of proof.getPages()) {
    if (page.getRotation().angle !== 0) throw new Error();
    for (const box of [page.getMediaBox(), page.getCropBox(), page.getTrimBox(), page.getBleedBox(), page.getArtBox()])
      if (box.x !== 0 || box.y !== 0 || box.width !== 612 || box.height !== 792) throw new Error();
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annotations?.size()) throw new Error();
    const unit = page.node.get(PDFName.of("UserUnit"));
    if (unit && unit.toString() !== "1") throw new Error();
  }
  return proof;
}

/**
 * Offline synthetic formatter, not an intake, identifier-clearance, signing or transport channel.
 * The trusted adapter records the expected snapshot reference; a caller-supplied hash cannot establish authority.
 * Static Letter proofs are this formatter's support limit, not a PECO evidence requirement.
 */
export async function renderPecoCapIncomePreparationPacket(
  template: Uint8Array,
  preparationSnapshot: unknown,
  incomeInput: PecoCapIncomeInput,
  originals: { documentId: string; bytes: Uint8Array }[],
  now: Date,
): Promise<{ bytes: Uint8Array; manifest: PecoCapIncomePreparationManifest }> {
  try {
    const at = new Date(now);
    if (template.length !== 269140) throw new Error();
    const source = Uint8Array.from(template);
    const snapshot = pecoCapPreparationSnapshotSchema.parse(preparationSnapshot);
    const data = snapshot.details;
    const income = structuredClone(incomeInput);
    const supplied = originalSchema.parse(originals).map((original) => ({
      documentId: original.documentId, bytes: Uint8Array.from(original.bytes),
    }));
    const assessment = assessPecoCapIncomeEvidence(income, at);
    if (!assessment.preparationComplete || assessment.route !== "standard_proof" || !assessment.basis)
      throw new Error();
    const reference = { id: snapshot.id, revision: snapshot.revision, sha256: sha256(JSON.stringify(snapshot)) };
    const expected = income.scope.preparationSnapshot;
    if (!expected || expected.id !== reference.id || expected.revision !== reference.revision || expected.sha256 !== reference.sha256 ||
      Object.entries(snapshot.binding).some(([key, value]) => income.scope.binding[key as keyof typeof snapshot.binding] !== value) ||
      Date.parse(snapshot.confirmedAt) > at.getTime() ||
      Date.parse(snapshot.validUntil) <= at.getTime() || Date.parse(snapshot.retentionUntil) <= at.getTime())
      throw new Error();
    const today = agencyDate.format(at);
    const formPeople = [data.applicant, ...data.householdMembers];
    const adultFlags = formPeople.map((person) => {
      validBirthDate(person.dateOfBirth, today);
      const age = Number(today.slice(0, 4)) - Number(person.dateOfBirth.slice(0, 4)) -
        (today.slice(5) < person.dateOfBirth.slice(5) ? 1 : 0);
      return age >= 18;
    });
    if (!adultFlags[0] || formPeople.length !== income.household.people.length ||
      snapshot.subjectIds.length !== formPeople.length || new Set(snapshot.subjectIds).size !== snapshot.subjectIds.length ||
      snapshot.subjectIds[0] !== income.scope.applicantSubjectId ||
      snapshot.subjectIds.some((subjectId, index) => income.household.people.find(person => person.subjectId === subjectId)?.adult !== adultFlags[index]))
      throw new Error();
    const selected = assessment.selectedOriginals;
    if (!selected.length || selected.length > 10 || supplied.length !== selected.length ||
      new Set(supplied.map((original) => original.documentId)).size !== supplied.length)
      throw new Error();
    const exact = selected.map((reference) => {
      const original = supplied.find((original) => original.documentId === reference.documentId);
      if (!original || sha256(original.bytes) !== reference.sha256) throw new Error();
      return original;
    });
    const bundle = income.bundles.find((bundle) => bundle.basis === assessment.basis)!;
    const deadlines = [
      income.scope.mandate.expiresAt, income.scope.grant.expiresAt,
      income.scope.incomeConsent.expiresAt, income.scope.documentConsent!.expiresAt,
      income.household.validUntil, bundle.validUntil,
      snapshot.validUntil, snapshot.retentionUntil,
      ...income.household.people.filter((person) => person.adult || (person.inventory?.sources.length ?? 0) > 0)
        .map((person) => person.inventory!.validUntil),
    ].map(Date.parse);
    for (const reference of selected) {
      const document = income.documents.find((document) => document.documentId === reference.documentId)!;
      deadlines.push(Date.parse(document.expiresAt), Date.parse(document.validatedAt!) + 86400000);
    }
    const retention = Math.min(...deadlines);
    if (!Number.isFinite(retention) || retention <= at.getTime()) throw new Error();
    const prepared = await preparePecoCapDraft(source, data, at);
    const ranges: PecoCapIncomePreparationManifest["originals"] = [];
    const copies = new Map<string, PecoCapIncomePreparationManifest["originals"][number]>();
    for (const original of exact) {
      const sourceSha256 = sha256(original.bytes);
      const existing = copies.get(sourceSha256);
      if (existing) {
        ranges.push({ ...existing, documentId: original.documentId });
        continue;
      }
      const proof = await inspectStaticProof(original.bytes);
      const start = prepared.document.getPageCount() + 1;
      for (const [pageIndex, page] of proof.getPages().entries()) {
        const copy = prepared.document.addPage([612, 792]);
        copy.drawPage(await prepared.document.embedPage(page), {
          x: 24.48, y: 36, width: 612 * 0.92, height: 792 * 0.92,
        });
        drawBox(copy, prepared.font,
          `Evidence copy ${copies.size + 1} | Original page ${pageIndex + 1} of ${proof.getPageCount()}`,
          [36, 768, 554, 10], 1, 7);
      }
      ranges.push({
        documentId: original.documentId,
        sourceSha256: sha256(original.bytes),
        pageCount: proof.getPageCount(),
        outputStartPage: start,
        outputEndPage: prepared.document.getPageCount(),
      });
      copies.set(sourceSha256, ranges[ranges.length - 1]);
    }
    applyPreparationBands(prepared.document, prepared.font, prepared.data);
    const bytes = await prepared.document.save();
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error();
    return {
      bytes,
      manifest: {
        kind: "unsigned_preparation_rehearsal",
        scope: income.scope.binding,
        applicantSubjectId: income.scope.applicantSubjectId,
        incomeConsentVersion: income.scope.incomeConsent.version,
        documentConsentVersion: income.scope.documentConsent!.version,
        preparationSnapshot: reference,
        formInputSha256: sha256(JSON.stringify(data)),
        templateSha256: PECO_CAP_TEMPLATE_SHA256,
        certificationTemplateSha256: PECO_CAP_TEMPLATE_SHA256,
        basis: assessment.basis,
        applicationAsOf: bundle.periodEnd,
        validUntil: new Date(Math.min(retention, nextAgencyMidnight(at))).toISOString(),
        retentionUntil: new Date(retention).toISOString(),
        pageCount: prepared.document.getPageCount(),
        originals: ranges,
        artifactSha256: sha256(bytes),
      },
    };
  } catch {
    throw new Error("The PECO income preparation packet could not be created from the supplied information.");
  }
}

function applyPreparationBands(result: PDFDocument, outputFont: PDFFont, data: PecoCapDraftInput) {
  const pages = result.getPages();
  for (const [index, page] of pages.entries()) {
    drawBox(
      page,
      outputFont,
      "UNSIGNED PREPARATION DRAFT - NOT SENT",
      [36, 780, 554, 11],
      1,
      9,
    );
    drawBox(
      page,
      outputFont,
      `Applicant: ${fullName(data.applicant)}`,
      [36, 16, 554, 11],
      1,
      7.5,
    );
    drawBox(
      page,
      outputFont,
      `PECO account: ${data.accountNumber} | Page ${index + 1} of ${pages.length}`,
      [36, 5, 554, 10],
      1,
      7.5,
    );
  }
}

/** Synthetic rehearsal only; no signing, government-identifier, persistence or transport channel. */
export async function renderPecoCapPreparationDraft(
  template: Uint8Array,
  input: unknown,
  now: Date,
): Promise<Uint8Array> {
  const prepared = await preparePecoCapDraft(Uint8Array.from(template), input, new Date(now));
  try {
    applyPreparationBands(prepared.document, prepared.font, prepared.data);
    return await prepared.document.save();
  } catch {
    // PDF/font/schema errors can echo private values or unknown input keys.
    throw new Error(
      "The PECO CAP preparation draft could not be created from the supplied information.",
    );
  }
}
