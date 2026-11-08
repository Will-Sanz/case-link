import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { z } from "zod";
import contract from "../../../data/verified-forms/snap-pa600fs-2019.json";
import {
  assessSnapApplicationFields, snapApplicationFieldsSchema,
  snapPreparationInputSchema as schema,
  type SnapApplicationFields,
} from "./snap-application-fields";

export const SNAP_DRAFT_CONTRACT = contract;
export const SNAP_DRAFT_ERROR = "The unsigned SNAP preparation draft could not be created from the supplied information.";

export type SnapDraftInput = z.infer<typeof schema>;
export type SnapDraftReadiness = {
  kind: "incomplete_unsigned_preparation";
  templateId: string;
  templateVersion: string;
  templateSha256: string;
  submissionReady: false;
  unresolvedGroups: string[];
  unmappedKnownFacts: string[];
  personalActs: string[];
};
type Person = Omit<NonNullable<SnapApplicationFields["household"]>[number], "id">;
type IncomeRow = { person?: Person; source?: string; amount?: number; frequency?: string; date?: string; status?: "received" | "expected" };
type FormFields = Omit<SnapApplicationFields, "household" | "income"> & {
  household?: Person[];
  income?: { hasIncome?: boolean; entries?: IncomeRow[] };
};
type Box = [number, number, number, number];
const frequencyText = { weekly: "Weekly", biweekly: "Every two weeks", twice_monthly: "Twice monthly", monthly: "Monthly", yearly: "Yearly" };
const agencyDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

function validated(input: unknown, now: Date) {
  if (!Number.isFinite(now.getTime()) || now.getTime() < Date.parse(`${contract.sourceCheckedAt}T00:00:00Z`) || now.getTime() >= Date.parse(contract.verifiedUntil)) throw new Error();
  const value = schema.parse(input);
  if (value.kind === "synthetic_rehearsal") {
    const today = agencyDate.format(now);
    if (value.household?.some((p) => p.dateOfBirth > today)) throw new Error();
    if (value.household && value.householdSize !== undefined && value.household.length !== value.householdSize) throw new Error();
    if (value.household && (!value.household.some(p=>p.requestingSnap) || value.household[0].relationship.toUpperCase() !== "SELF")) throw new Error();
    if (value.household && value.applicant && ["firstName","lastName","middleInitial"].some(key=>value.applicant![key as keyof typeof value.applicant] !== value.household![0][key as "firstName"|"lastName"|"middleInitial"])) throw new Error();
    if (value.income?.hasIncome === false && value.income.entries.length) throw new Error();
    for (const entry of value.income?.entries ?? []) {
      if (!value.household?.[entry.personIndex] || entry.receivedOn.slice(0, 7) !== today.slice(0, 7) || entry.receivedOn > today) throw new Error();
    }
    const expenses = value.expenses;
    if (expenses?.childSupport === false && expenses.courtOrdered !== undefined) throw new Error();
    if (expenses?.housingAssistance === false && (expenses.housingAssistanceKind !== undefined || expenses.utilityAllowance !== undefined)) throw new Error();
    if (expenses?.outsidePayer === false && [expenses.outsideExpenses, expenses.outsideAmount, expenses.outsideFrequency, expenses.outsidePayee].some(v => v !== undefined)) throw new Error();
    if (expenses?.care === false && (expenses.careMonthlyAmount !== undefined || expenses.careRecipient !== undefined)) throw new Error();
    if (expenses?.otherUtility && !expenses.utilities?.includes("other")) throw new Error();
    if (expenses?.otherMedical && !expenses.medical?.includes("other")) throw new Error();
    if ([expenses?.utilities,expenses?.medical].some(values=>values&&new Set(values).size!==values.length)) throw new Error();
    for (const answer of Object.values(value.history ?? {}))
      if ((answer?.answer === false && Object.keys(answer).some(key => key !== "answer")) || (answer && 'date' in answer && answer.date && answer.date > today)) throw new Error();
  }
  return value;
}

function readiness(value: SnapDraftInput): SnapDraftReadiness {
  const full = value.kind === "synthetic_rehearsal" ? value : undefined;
  const expenses=full?.expenses;
  const expenseMissing=!expenses||expenses.utilities===undefined||[expenses.childSupport,expenses.mealsIncludedInRent,expenses.heat,expenses.housingAssistance,expenses.outsidePayer,expenses.airConditioning,expenses.care].some(v=>v===undefined)||
    (expenses.childSupport&&expenses.courtOrdered===undefined)||
    (expenses.housingAssistance&&(!expenses.housingAssistanceKind||expenses.utilityAllowance===undefined))||
    (expenses.outsidePayer&&[expenses.outsideExpenses,expenses.outsideAmount,expenses.outsideFrequency,expenses.outsidePayee].some(v=>v===undefined))||
    (expenses.care&&[expenses.careMonthlyAmount,expenses.careRecipient].some(v=>v===undefined))||
    (expenses.utilities?.includes('other')&&!expenses.otherUtility)||
    (expenses.medical?.includes('other')&&!expenses.otherMedical);
  const unresolvedGroups = [
    ...(!full?.applicant ? ["applicant_name"] : []),
    ...(!full?.address || !value.zip ? ["applicant_address"] : []),
    ...(!full?.phone || !value.language || full.interpreter===undefined || (full.interpreter&&!full.interpreterLanguage) ? ["contact_and_language_preferences"] : []),
    ...(!full?.household ? ["household_roster_and_applicants"] : []),
    ...(full?.household?.some(person=>person.sex===undefined||person.student===undefined||(person.requestingSnap&&person.citizen===undefined)) ? ["household_member_details"] : []),
    ...(!full?.income || (full.income.hasIncome !== false && !full.income.entries.length) ? ["current_month_per_person_income"] : []),
    ...(!full?.screening || [full.screening.lowCashAndIncome,full.screening.migrantOrSeasonal,full.screening.belowShelterCosts].some(answer=>answer===undefined) ? ["expedited_screening_answers"] : []),
    ...(!full?.history || [full.history.fleeingOrProbation,full.history.welfareFraud,full.history.otherStateDisqualification].some(answer=>answer===undefined) ||
      [full.history.fleeingOrProbation,full.history.welfareFraud].some(answer=>answer?.answer&&(!answer.names||!answer.date||!answer.state)) ||
      (full.history.otherStateDisqualification?.answer&&!full.history.otherStateDisqualification.names) ? ["applicable_history_answers"] : []),
    ...(expenseMissing ? ["applicable_household_expenses"] : []),
    ...(expenses?.medical===undefined ? ["medical_deduction_applicability"] : []),
    "required_applicant_identifiers_through_protected_entry",
    "exact_packet_personal_certifications",
    "permitted_delivery_and_actual_agency_receipt",
  ];
  return {
    kind: "incomplete_unsigned_preparation", templateId: contract.id, templateVersion: contract.version, templateSha256: contract.sha256, submissionReady: false,
    unresolvedGroups,
    unmappedKnownFacts: ["householdSize", "incomeAmount", "incomeFrequency"].filter(field => Object.hasOwn(value, field)),
    personalActs: ["applicant_signature_printed_page_1", "rights_certification_printed_page_5"],
  };
}

export function assessSnapPreparationDraft(input: unknown, now: Date): SnapDraftReadiness {
  try { return readiness(validated(input, now)); }
  catch { throw new Error(SNAP_DRAFT_ERROR); }
}

class FieldRenderingError extends Error {}
function draw(page: PDFPage, font: PDFFont, value: string | undefined, [x, y, width, height]: Box, size = 8.5) {
  if (value === undefined) return;
  try { font.encodeText(value); } catch { throw new FieldRenderingError(); }
  if (font.widthOfTextAtSize(value, size) > width || height < size) throw new FieldRenderingError();
  page.drawText(value, { x, y: y + (height - size) / 2, font, size, color: rgb(0, 0, 0) });
}
function mark(page: PDFPage, value: boolean | undefined, yes: Box, no?: Box) {
  if (value === undefined || (!value && !no)) return;
  const [x, y, width, height] = value ? yes : no!;
  page.drawLine({ start: { x: x + 2, y: y + 1.5 }, end: { x: x + width - 2, y: y + height - 1.5 }, thickness: .8 });
  page.drawLine({ start: { x: x + 2, y: y + height - 1.5 }, end: { x: x + width - 2, y: y + 1.5 }, thickness: .8 });
}
const money = (n: number | undefined) => n === undefined ? undefined : n.toFixed(2);
const name = (p: Person | undefined) => p && [p.lastName, p.firstName, p.middleInitial].filter(Boolean).join(", ") || undefined;
const address = (p: SnapApplicationFields["address"], zip?: string) => [p?.street, p?.city, [p?.state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || undefined;
const printedDate = (value: string) => `${value.slice(5,7)}/${value.slice(8)}/${value.slice(0,4)}`;

function fillRouting(page: PDFPage, font: PDFFont, value: Pick<SnapApplicationFields, "zip" | "language" | "otherLanguage">) {
  draw(page,font,value.zip,[526,585,54,15]);
  if(value.language)mark(page,true,[value.language==='en'?243.87:value.language==='es'?315.6:398.16,675.14,9.36,9.36]);
  draw(page,font,value.otherLanguage,[531,677,50,11],7.5);
}

function fillFormFields(pages: PDFPage[], font: PDFFont, value: FormFields) {
  const first = pages[2], incomePage = pages[3], expensesPage = pages[4];
  draw(first,font,value.applicant?.lastName,[26,617,219,15]);
  draw(first,font,value.applicant?.firstName,[254,617,199,15]);
  draw(first,font,value.applicant?.middleInitial,[465,617,120,15]);
  draw(first,font,address(value.address),[26,585,480,15]);
  draw(first,font,value.county,[26,554,121,15]); draw(first,font,value.phone,[160,554,130,15]);
  draw(first,font,value.otherPhone,[313,554,100,15]); draw(first,font,value.bestTimeToCall,[425,554,160,15]);
  mark(first,value.interpreter,[243.87,658.98,9.36,9.36],[286.66,658.98,9.36,9.36]);
  draw(first,font,value.interpreterLanguage,[531,661,50,11],7.5);
  for(const [i,answer] of [value.screening?.lowCashAndIncome,value.screening?.migrantOrSeasonal,value.screening?.belowShelterCosts].entries())
    mark(first,answer,[98.49,476.72-i*25.02,17,8.36],[141.37,476.72-i*25.02,17,8.36]);
  value.household?.forEach((person,i)=>{
    const y=307.5-i*23.4;
    draw(first,font,name(person),[26,y,178,12],8);
    if(person.sex)mark(first,true,[person.sex==='male'?212.59:234.56,308.22-i*23.4,8.68,8.36]);
    mark(first,person.student,[259.5,308.22-i*23.4,8.68,8.36],[287.16,308.22-i*23.4,8.68,8.36]);
    draw(first,font,person.dateOfBirth ? printedDate(person.dateOfBirth) : undefined,[315,y,56,12],8);
    if(i>0)draw(first,font,person.relationship,[377,y,63,12],8);
    if(person.requestingSnap)mark(first,person.citizen,[531.69,308.22-i*23.4,8.68,8.36],[559.36,308.22-i*23.4,8.68,8.36]);
  });
  mark(incomePage,value.income?.entries?.length ? true : value.income?.hasIncome,[166.96,741.59,17,8.36],[209.84,741.59,17,8.36]);
  value.income?.entries?.forEach((entry,i)=>{
    const y=591-i*26.93;
    draw(incomePage,font,name(entry.person),[26,y,181,19],8);
    draw(incomePage,font,entry.source,[217,y,111,19],8);
    draw(incomePage,font,money(entry.amount),[346,y,72,19],8);
    draw(incomePage,font,entry.frequency,[426,y,75,19],8);
    if(entry.date) {
      if(entry.status !== 'received')draw(incomePage,font,entry.status==='expected'?'EXPECTED':'STATUS UNKNOWN',[508,y+10,77,9],7);
      draw(incomePage,font,printedDate(entry.date),[508,y,77,entry.status==='received'?19:9],8);
    }
  });
  const history=[value.history?.fleeingOrProbation,value.history?.welfareFraud,value.history?.otherStateDisqualification];
  const historyYs=[379.81,260.96,163.04];
  for(const [i,answer] of history.entries()){
    mark(incomePage,answer?.answer,[31.96,historyYs[i],17,8.36],[74.84,historyYs[i],17,8.36]);
    if(answer?.answer){
      draw(incomePage,font,answer.names,[i===2?209:270,i===0?317:i===1?221:134,i===2?357:296,13],8);
      if('date' in answer && typeof answer.date==='string')draw(incomePage,font,printedDate(answer.date),[154,i===0?296:200,90,13],8);
      if('state' in answer && typeof answer.state==='string')draw(incomePage,font,answer.state,[300,i===0?296:200,58,13],8);
    }
  }
  const e=value.expenses;if(!e)return;
  const yesNo=(answer:boolean|undefined,y:number)=>mark(expensesPage,answer,[31.96,y,17,8.36],[74.84,y,17,8.36]);
  yesNo(e.childSupport,716.28);if(e.childSupport)mark(expensesPage,e.courtOrdered,[246.1,700.16,17,8.36],[288.98,700.16,17,8.36]);
  yesNo(e.mealsIncludedInRent,676.85);yesNo(e.heat,651.98);yesNo(e.housingAssistance,626.42);
  if(e.housingAssistance){draw(expensesPage,font,e.housingAssistanceKind,[205,608,370,13]);mark(expensesPage,e.utilityAllowance,[269.18,584.67,17,8.36],[312.06,584.67,17,8.36]);}
  yesNo(e.outsidePayer,558.74);
  if(e.outsidePayer){draw(expensesPage,font,e.outsideExpenses,[230,540,342,13]);draw(expensesPage,font,money(e.outsideAmount),[182,519,151,13]);draw(expensesPage,font,e.outsideFrequency,[437,519,134,13]);draw(expensesPage,font,e.outsidePayee,[174,498,396,13]);}
  yesNo(e.airConditioning,471.2);
  const utilityBoxes={telephone:[31.96,431.19],water:[115.96,431.19],garbage:[179.96,431.19],installation:[258.96,431.19],electric:[379.96,431.19],oil:[451.96,431.19],sewer:[31.96,410.19],gas:[115.96,410.19],propane:[179.96,410.19],other:[258.96,410.19]};
  for(const utility of e.utilities??[]){const[x,y]=utilityBoxes[utility];mark(expensesPage,true,[x,y,17,8.36]);}
  draw(expensesPage,font,e.otherUtility,[309,413,263,13]);yesNo(e.care,385.28);
  if(e.care){draw(expensesPage,font,money(e.careMonthlyAmount),[272,360,73,13]);draw(expensesPage,font,e.careRecipient,[214,339,361,13]);}
  for(const [amount,box] of [[e.rent,[65,295,75,13]],[e.condoFees,[255,295,76,13]],[e.mortgage,[87,278,75,13]],[e.propertyFees,[265,278,75,13]],[e.homeownersInsurance,[492,278,74,13]]] as [number|undefined,Box][])
    draw(expensesPage,font,money(amount),box);
  const medicalBoxes={dental:[26.96,186.59],doctor:[122.96,186.59],equipment:[217.96,186.59],premiums:[347.96,186.59],hospital:[26.96,170.09],prescriptions:[122.96,170.09],homeAide:[261.96,170.09],supplies:[26.96,153.59],transport:[26.96,137.09],other:[26.96,108.59]};
  for(const medical of e.medical??[]){const[x,y]=medicalBoxes[medical];mark(expensesPage,true,[x,y,17,8.36]);}
  draw(expensesPage,font,e.otherMedical,[80,111,492,13]);
}

async function loadTemplate(template: Uint8Array) {
  if(template.length!==contract.byteLength||createHash('sha256').update(template).digest('hex')!==contract.sha256)throw new Error();
  const source=await PDFDocument.load(Uint8Array.from(template),{updateMetadata:false});
  if(source.getPageCount()!==12||source.getPages().some(p=>p.getWidth()!==612||p.getHeight()!==792||p.getRotation().angle!==0)||source.getForm().getFields().length)throw new Error();
  return source;
}

async function wrappedPages(pages: PDFPage[], now: Date, applicationPreview = false) {
  // Embedding pages does not flush their source document's pending fonts.
  await pages[0].doc.flush();
  const result=await PDFDocument.create();result.setCreationDate(now);result.setModificationDate(now);
  result.setTitle(applicationPreview ? 'Unsigned SNAP application preview - protected fields incomplete - not sent' : 'Incomplete unsigned SNAP preparation - not sent');
  const font=await result.embedFont(StandardFonts.Helvetica);
  for(const [i,page]of pages.entries()){
    const output=result.addPage([612,792]);
    if(page.node.Contents())output.drawPage(await result.embedPage(page),{x:24.48,y:32,width:612*.92,height:792*.92});
    draw(output,font,applicationPreview ? 'UNSIGNED SNAP PREVIEW - PROTECTED FIELDS INCOMPLETE - NOT SENT' : 'INCOMPLETE UNSIGNED PREPARATION - NOT SENT',[29,777,554,11],9);
    draw(output,font,applicationPreview
      ? `Official SNAP form ${i+1} of 12 | ${i===6?'Representative details are not a signed designation.':'Identifiers and certification signatures/dates remain blank.'}`
      : `Official SNAP form ${i+1} of 12 | Identity and signature fields remain blank.`,[29,13,554,11],8);
  }
  return result.save();
}

/** Full private-field mapping is an offline synthetic proof; workers may project only current_scoped_facts. */
export async function renderSnapPreparationDraft(template: Uint8Array, input: unknown, now: Date): Promise<{bytes:Uint8Array;readiness:SnapDraftReadiness}> {
  try {
    const value=validated(input,now);
    const source=await loadTemplate(template);
    const font=await source.embedFont(StandardFonts.Helvetica);
    const pages=source.getPages();
    fillRouting(pages[2],font,value);
    if(value.kind==='synthetic_rehearsal')fillFormFields(pages,font,{
      ...value, income: value.income && { ...value.income, entries: value.income.entries.map(entry => ({
        ...entry, person: value.household![entry.personIndex], frequency: frequencyText[entry.frequency], date: entry.receivedOn, status: 'received',
      })) },
    });
    return {bytes:await wrappedPages(pages,now),readiness:readiness(value)};
  }catch{throw new Error(SNAP_DRAFT_ERROR);}
}

export type SnapApplicationPageReadiness = ReturnType<typeof assessSnapApplicationFields> & {
  protectedIncomplete: true;
  unmappedContextFields: string[];
};
export type SnapApplicationPreviewReadiness = SnapApplicationPageReadiness & {
  kind: "unsigned_nonprotected_application_preview";
};

/** Shared nonprotected mapping only; no identifiers, signatures or delivery authority. */
export async function prepareSnapApplicationPages(template: Uint8Array, input: unknown, now: Date): Promise<{document:PDFDocument|null;readiness:SnapApplicationPageReadiness}> {
  try {
    const value=snapApplicationFieldsSchema(now).parse(input);
    const assessment=assessSnapApplicationFields(value,now);
    if(!assessment.sourceReviewCurrent)throw new Error();
    const source=await loadTemplate(template);
    const readiness: SnapApplicationPageReadiness={
      ...assessment, protectedIncomplete:true,
      renderingRequirements:assessment.renderingRequirements.filter(item=>item!=='explicit_expected_income_rendering'&&item!=='other_language_field_mapping'),
      unmappedContextFields:['householdSize','incomeAmount','incomeFrequency'].filter(field=>Object.hasOwn(value,field)),
    };
    // The current two-decimal layout must not change a saved monetary answer.
    const amounts=[...(value.income?.entries?.map(entry=>entry.amount)??[]),...Object.values(value.expenses??{}).filter(amount=>typeof amount==='number')];
    if(amounts.some(amount=>amount!==undefined&&Number(amount.toFixed(2))!==amount))readiness.renderingRequirements.push('exact_amount_rendering');
    if(readiness.renderingRequirements.length)return {document:null,readiness};
    try {
      const font=await source.embedFont(StandardFonts.Helvetica),pages=source.getPages();
      fillRouting(pages[2],font,value);
      fillFormFields(pages,font,{
        ...value, income:value.income && { ...value.income,entries:value.income.entries?.map(entry=>({
          ...entry,person:value.household?.find(person=>person.id===entry.personId),
        })) },
      });
      const representative=value.authorizedRepresentative;
      if(representative){
        draw(pages[6],font,representative.name,[26,161,212,18],8);
        draw(pages[6],font,address(representative.address,representative.address?.zip),[247,161,220,18],8);
        draw(pages[6],font,representative.phone,[477,161,108,18],8);
      }
      return {document:source,readiness};
    }catch(error){
      if(!(error instanceof FieldRenderingError))throw error;
      return {document:null,readiness:{...readiness,renderingRequirements:['field_layout_or_font_support']}};
    }
  }catch{throw new Error(SNAP_DRAFT_ERROR);}
}

/** Pure preview only; this does not acquire protected values, establish designation or permit delivery. */
export async function renderSnapApplicationPreview(template: Uint8Array, input: unknown, now: Date): Promise<{bytes:Uint8Array|null;readiness:SnapApplicationPreviewReadiness}> {
  try {
    const result=await prepareSnapApplicationPages(template,input,now);
    return {
      bytes:result.document ? await wrappedPages(result.document.getPages(),now,true) : null,
      readiness:{...result.readiness,kind:'unsigned_nonprotected_application_preview'},
    };
  }catch{throw new Error(SNAP_DRAFT_ERROR);}
}
