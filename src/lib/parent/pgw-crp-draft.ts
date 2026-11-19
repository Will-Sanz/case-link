import { createHash } from "node:crypto";
import { z } from "zod";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { MAX_DOCUMENT_BYTES } from "./constants";
import { PGW_APPLICATION_SOURCE } from "./pgw-application-fields";
import { prepareFictionalPgwApplication, assessPgwApplicationFields, pgwUnder18, PGW_PREPARATION_ERROR } from "./pgw-application-preparation";

import { utilityProtectedScalarSchema } from "./utility-protected-input-contract";

const identifierSchema = z.object({ subjectId: z.uuid(), identifier: utilityProtectedScalarSchema }).strict().refine(value => value.identifier.purpose === "required_identifier");
export type PgwProtectedIdentifier = z.infer<typeof identifierSchema>;
type Box = [number, number, number, number];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function linesFor(font: PDFFont, value: string, width: number, size: number) {
  font.encodeText(value);
  const lines: string[] = []; let line = "";
  for (const word of value.split(" ")) {
    if (font.widthOfTextAtSize(word, size) > width) throw new Error();
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width) { lines.push(line); line = word; } else line = next;
  }
  return [...lines, line];
}
function draw(page: PDFPage, font: PDFFont, value: string | undefined, [x, y, width, height]: Box, maxLines = 1, size = 8.5) {
  if (value === undefined) return;
  const lines = linesFor(font, value, width, size), leading = size + 1;
  if (lines.length > maxLines || lines.length * leading > height) throw new Error();
  const firstY = y + (height - lines.length * leading) / 2 + leading - size;
  lines.forEach((text, index) => page.drawText(text, { x, y: firstY + (lines.length - index - 1) * leading, font, size, color: rgb(0, 0, 0) }));
}
const dollars = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

async function renderPgwCrpDraft(template: Uint8Array, input: unknown, now: Date, privateIdentifiers?: PgwProtectedIdentifier[]) {
  try {
    const at = new Date(now), sourceBytes = Uint8Array.from(template), prepared = privateIdentifiers === undefined ? prepareFictionalPgwApplication(input, at)
      : { kind: "owned_unsigned_preparation" as const, ...assessPgwApplicationFields(input, at) };
    const identifiers = privateIdentifiers === undefined ? [] : z.array(identifierSchema).max(99).parse(structuredClone(privateIdentifiers));
    const identifierBySubject = new Map(identifiers.map(item => [item.subjectId, item.identifier]));
    if (privateIdentifiers !== undefined && (identifierBySubject.size !== identifiers.length ||
      identifiers.some(item => !prepared.fields.householdMembers?.some(member => member.id === item.subjectId)) ||
      (prepared.fields.householdMembers ?? []).some(member => !identifierBySubject.has(member.id)))) throw new Error();
    if (sourceBytes.length !== PGW_APPLICATION_SOURCE.sourceByteLength || hash(sourceBytes) !== PGW_APPLICATION_SOURCE.sourceSha256) throw new Error();
    if (!prepared.formFieldsReady) return { ...prepared, bytes: null, manifest: null };
    const value = prepared.fields, customer = value.customer!, source = await PDFDocument.load(sourceBytes, { updateMetadata: false });
    if (source.isEncrypted || source.getPageCount() !== 4 || source.catalog.has(PDFName.of("AcroForm"))) throw new Error();
    const font = await source.embedFont(StandardFonts.Helvetica), form = source.getPage(2), extra = source.getPage(3);
    draw(form, font, `${customer.firstName} ${customer.lastName}`, [72, 458, 225, 13]);
    draw(form, font, value.accountNumber, [410, 458, 181, 13]);
    draw(form, font, value.address!.street, [63, 420, 233, 13]);
    draw(form, font, value.address!.city, [328, 420, 147, 13]);
    draw(form, font, value.address!.state, [514, 420, 77, 13]);
    draw(form, font, value.address!.zip, [42, 383, 254, 13]);
    draw(form, font, value.phone, [340, 383, 251, 13]);
    const people = [{ ...customer, dateOfBirth: undefined, relationship: "Self" }, ...(value.householdMembers ?? [])];
    const row = (page: PDFPage, usedFont: PDFFont, person: typeof people[number], y: number, isCustomer: boolean, continuation = false) => {
      const boxes = continuation ? [[36, 140], [179, 140], [322, 90], [492, 63], [560, 30]] : [[21, 115], [141, 115], [261, 80], [478, 67], [554, 36]];
      draw(page, usedFont, person.lastName, [boxes[0][0], y, boxes[0][1], 21], 2);
      draw(page, usedFont, person.firstName, [boxes[1][0], y, boxes[1][1], 21], 2);
      if (!isCustomer || continuation) draw(page, usedFont, person.relationship, [boxes[2][0], y, boxes[2][1], 21], 2);
      const identifier = !isCustomer ? identifierBySubject.get(person.id) : undefined;
      if (identifier?.purpose === "required_identifier") {
        const type = String(PGW_APPLICATION_SOURCE.identifierTypes.indexOf(identifier.type) + 1);
        if (continuation) draw(page, usedFont, `${type}: ${identifier.value}`, [415, y, 74, 21], 2, 7);
        else {
          draw(page, usedFont, type, [347, y, 35, 21]);
          draw(page, usedFont, identifier.value, [390, y, 80, 21], 2, 7.5);
        }
      }
      if (!isCustomer && person.dateOfBirth) draw(page, usedFont, `${person.dateOfBirth.slice(5, 7)}/${person.dateOfBirth.slice(8)}/${person.dateOfBirth.slice(0, 4)}`, [boxes[3][0], y, boxes[3][1], 21], 1, 7.5);
      const under18 = isCustomer ? customer.under18 : pgwUnder18(person.dateOfBirth!, prepared.today);
      draw(page, usedFont, under18 === undefined ? undefined : under18 ? "Y" : "N", [boxes[4][0], y, boxes[4][1], 21]);
    };
    people.slice(0, 8).forEach((person, index) => row(form, font, person, 240.5 - index * (209 / 9), index === 0));
    const supporter = value.outsideSupport?.supporter;
    if (value.outsideSupport?.receives && supporter) {
      draw(extra, font, `${supporter.firstName} ${supporter.lastName}`, [191, 621, 233, 12]);
      draw(extra, font, supporter.phone, [465, 621, 126, 12]);
      draw(extra, font, supporter.address!.street, [63, 584, 528, 12]);
      draw(extra, font, supporter.address!.city, [44, 547, 198, 12]);
      draw(extra, font, supporter.address!.state, [280, 547, 142, 12]);
      draw(extra, font, supporter.address!.zip, [450, 547, 141, 12]);
      draw(extra, font, dollars(supporter.monthlyAmountCents!), [320, 510, 122, 12]);
    }
    if (value.zeroIncomePast30Days) {
      draw(extra, font, value.livingExpenses!.food, [23, 249, 182, 111], 10);
      draw(extra, font, value.livingExpenses!.housing, [215, 249, 182, 111], 10);
      draw(extra, font, value.livingExpenses!.utilities, [407, 249, 182, 111], 10);
    }
    for (const [key, y] of [["snap", 134], ["housingSubsidy", 107]] as const) if (value[key]?.receives) {
      draw(extra, font, "X", [20, y + 1, 8, 10], 1, 8);
      draw(extra, font, dollars(value[key].monthlyAmountCents!), [474, y + 2, 117, 11]);
    }
    const otherIdentifiers = identifiers.filter(item => item.identifier.purpose === "required_identifier" && item.identifier.type === "other");
    if (otherIdentifiers.length) draw(form, font, "See ID type notes", [254, 290, 91, 12], 1, 8);
    const output = await PDFDocument.create(); output.setCreationDate(at); output.setModificationDate(at);
    output.setTitle("Unsigned PGW CRP preparation draft - not sent");
    const outputFont = await output.embedFont(StandardFonts.Helvetica);
    for (const page of source.getPages()) {
      if (page.getWidth() !== 612 || page.getHeight() !== 792 || page.getRotation().angle !== 0) throw new Error();
      const copy = output.addPage([612, 792]); copy.drawPage(await output.embedPage(page), { x: 18.36, y: 32, width: 612 * .94, height: 792 * .94 });
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      for (const ref of annots?.asArray() ?? []) {
        const annotation = source.context.lookup(ref, PDFDict), action = annotation.lookup(PDFName.of("A"), PDFDict);
        if (annotation.get(PDFName.of("Subtype"))?.toString() !== "/Link" || action.get(PDFName.of("S"))?.toString() !== "/URI" || action.lookup(PDFName.of("URI"), PDFString).decodeText() !== "https://www.pgworks.com/customer-care/crp") throw new Error();
        const rect = annotation.lookup(PDFName.of("Rect"), PDFArray).asArray().map(item => Number(item.toString()));
        copy.node.addAnnot(output.context.register(output.context.obj({ Type: "Annot", Subtype: "Link", Rect: [rect[0] * .94 + 18.36, rect[1] * .94 + 32, rect[2] * .94 + 18.36, rect[3] * .94 + 32], Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of("https://www.pgworks.com/customer-care/crp") } })));
      }
    }
    for (let offset = 8; offset < people.length; offset += 20) {
      const page = output.addPage([612, 792]);
      draw(page, outputFont, privateIdentifiers === undefined ? "PGW household continuation - required identifier cells remain blank" : "PGW household continuation - protected identifiers inserted", [36, 735, 554, 18], 1, 10);
      const headers: [string, number, number][] = [["Last name", 36, 140], ["First name", 179, 140], ["Relationship", 322, 90], ["ID type / number", 415, 74], ["Birth date", 492, 63], ["Under18", 560, 30]];
      for (const [label, x, width] of headers) draw(page, outputFont, label, [x, 708, width, 18], 1, 7);
      people.slice(offset, offset + 20).forEach((person, index) => row(page, outputFont, person, 680 - index * 29, false, true));
    }
    if (otherIdentifiers.length) {
      let page: PDFPage | null = null, position = 700;
      for (const item of otherIdentifiers) {
        const person = people.find(person => person.id === item.subjectId)!;
        const identifier = item.identifier;
        if (identifier.purpose !== "required_identifier" || identifier.type !== "other" || !identifier.otherType) throw new Error();
        const text = `${person.lastName}, ${person.firstName}: ${identifier.otherType}`, lines = linesFor(outputFont, text, 554, 9), height = lines.length * 11 + 16;
        if (!page || position - height < 52) { page = output.addPage([612, 792]); draw(page, outputFont, "Other identifier descriptions - preparation only", [36, 735, 554, 18], 1, 10); position = 700; }
        draw(page, outputFont, text, [36, position - height, 554, height], lines.length, 9); position -= height + 8;
      }
    }
    let notePage: PDFPage | null = null, noteY = 0;
    for (const [index, person] of people.entries()) {
      const isAdult = index === 0 ? customer.under18 === false : !pgwUnder18(person.dateOfBirth!, prepared.today);
      if (!isAdult || person.income?.state !== "none" || !person.income.noIncomeSituation) continue;
      const text = `${person.lastName}, ${person.firstName}: ${person.income.noIncomeSituation}`, lines = linesFor(outputFont, text, 554, 9), height = lines.length * 11 + 16;
      if (!notePage || noteY - height < 52) { notePage = output.addPage([612, 792]); draw(notePage, outputFont, "Adult no-income preparation notes - not a personal certification", [36, 735, 554, 18], 1, 10); noteY = 700; }
      draw(notePage, outputFont, text, [36, noteY - height, 554, height], lines.length, 9); noteY -= height + 8;
    }
    for (const [index, page] of output.getPages().entries()) {
      draw(page, outputFont, "UNSIGNED PGW PREPARATION DRAFT - NOT SENT", [36, 780, 554, 11], 1, 9);
      draw(page, outputFont, `Customer: ${customer.lastName}, ${customer.firstName}`, [36, 16, 554, 11], 1, 7.5);
      draw(page, outputFont, `PGW account: ${value.accountNumber} | Page ${index + 1} of ${output.getPageCount()}`, [36, 5, 554, 10], 1, 7.5);
    }
    const bytes = await output.save(); if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error();
    return { ...prepared, bytes, manifest: { kind: prepared.kind, sourceContractId: PGW_APPLICATION_SOURCE.id, sourceContractVersion: PGW_APPLICATION_SOURCE.version,
      sourceSha256: PGW_APPLICATION_SOURCE.sourceSha256, sourceCheckedAt: PGW_APPLICATION_SOURCE.sourceCheckedAt, sourceVerifiedUntil: PGW_APPLICATION_SOURCE.verifiedUntil,
      formInputSha256: hash(JSON.stringify(value)), artifactSha256: hash(bytes), pageCount: output.getPageCount(), subjectIds: people.map(person => person.id),
      requiredIdentifierSubjects: prepared.protectedRequirements.map(target => target.subjectId), personalActs: prepared.personalActs,
      requiredIdentifiersInserted: privateIdentifiers !== undefined, signed: false as const, financialAssentRecorded: false as const, submissionReady: false as const } };
  } catch { throw new Error(PGW_PREPARATION_ERROR); }
}

/** Fictional-only unsigned base form. Raw identifiers, signatures and financial assent are not accepted inputs. */
export async function renderFictionalPgwCrpDraft(template: Uint8Array, input: unknown, now: Date) {
  return renderPgwCrpDraft(template, input, now);
}

/** Internal deterministic renderer for the isolated owned factory, which resolves and rechecks authority separately. */
export async function renderOwnedPgwCrpDraft(template: Uint8Array, fields: unknown, identifiers: PgwProtectedIdentifier[], now: Date) {
  return renderPgwCrpDraft(template, fields, now, identifiers);
}
