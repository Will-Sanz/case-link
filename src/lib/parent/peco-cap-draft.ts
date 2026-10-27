import { createHash } from "node:crypto";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFPage,
  PDFString,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { z } from "zod";

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
    incomeSource: text().refine((value) => !/liheap/i.test(value)),
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
  drawBox(page, font, row.incomeSource, [470, y, 118, 21], 2);
}

/** Synthetic rehearsal only; no signing, government-identifier, persistence or transport channel. */
export async function renderPecoCapPreparationDraft(
  template: Uint8Array,
  input: unknown,
  now: Date,
): Promise<Uint8Array> {
  if (
    createHash("sha256").update(template).digest("hex") !==
    PECO_CAP_TEMPLATE_SHA256
  )
    throw new Error("The PECO CAP template differs from its reviewed source.");
  try {
    const data = inputSchema.parse(input);
    const today = now.toISOString().slice(0, 10);
    const rows: Row[] = [
      { ...data.applicant, relationship: "SELF" },
      ...data.householdMembers,
    ];
    for (const row of rows) validBirthDate(row.dateOfBirth, today);
    const birth = data.applicant.dateOfBirth;
    const age =
      now.getUTCFullYear() -
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
    return await result.save();
  } catch {
    // PDF/font/schema errors can echo private values or unknown input keys.
    throw new Error(
      "The PECO CAP preparation draft could not be created from the supplied information.",
    );
  }
}
