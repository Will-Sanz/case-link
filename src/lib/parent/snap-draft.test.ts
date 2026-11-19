import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, PDFName, decodePDFRawStream, PDFRawStream, PDFArray } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { SNAP_DRAFT_CONTRACT, SNAP_DRAFT_ERROR, assessSnapPreparationDraft, renderSnapPreparationDraft, type SnapDraftInput } from "./snap-draft";

const template=readFileSync(resolve('data/verified-forms/snap-pa600fs-2019.pdf'));
const now=new Date('2026-11-03T21:00:00Z');
const full: SnapDraftInput={
  kind:'synthetic_rehearsal',zip:'19104',language:'en',householdSize:2,
  applicant:{firstName:'Maria',lastName:'Rivera'},
  address:{street:'123 Synthetic Lane',city:'Philadelphia',state:'PA'},county:'Philadelphia',phone:'215-555-0101',bestTimeToCall:'Weekday mornings',interpreter:false,
  screening:{lowCashAndIncome:false,migrantOrSeasonal:false,belowShelterCosts:true},
  household:[
    {firstName:'Maria',lastName:'Rivera',dateOfBirth:'1988-04-15',relationship:'SELF',requestingSnap:true,sex:'female',student:false,citizen:true},
    {firstName:'Leo',lastName:'Rivera',dateOfBirth:'2018-03-12',relationship:'Child',requestingSnap:true,sex:'male',student:true,citizen:true},
  ],
  income:{hasIncome:true,entries:[{personIndex:0,source:'Employment',amount:680,frequency:'biweekly',receivedOn:'2026-11-01'}]},
  history:{fleeingOrProbation:{answer:true,names:'Maria Rivera',date:'2020-05-01',state:'PA'},welfareFraud:{answer:true,names:'Maria Rivera',date:'2019-02-01',state:'PA'},otherStateDisqualification:{answer:true,names:'Maria Rivera'}},
  expenses:{childSupport:true,courtOrdered:true,mealsIncludedInRent:false,heat:true,housingAssistance:true,housingAssistanceKind:'Rental assistance',utilityAllowance:false,outsidePayer:true,outsideExpenses:'Partial water bill',outsideAmount:20,outsideFrequency:'Monthly',outsidePayee:'Water utility',airConditioning:true,utilities:['electric','water','other'],otherUtility:'Other household utility',care:true,careMonthlyAmount:120,careRecipient:'Leo Rivera',rent:850,condoFees:15,mortgage:0,propertyFees:0,homeownersInsurance:0,medical:['dental','other'],otherMedical:'Other qualifying medical cost'},
};

async function drawnText(bytes: Uint8Array,pageIndex:number){
  const doc=await PDFDocument.load(bytes),page=doc.getPage(pageIndex);
  // Embedded source content is separate; these are the formatter's direct drawing operators.
  const contents=page.node.lookup(PDFName.of('Contents'),PDFArray);
  return contents.asArray().map(ref=>{
    const stream=doc.context.lookup(ref);
    if(!(stream instanceof PDFRawStream))throw new Error('Expected a PDF content stream.');
    return Buffer.from(decodePDFRawStream(stream).decode()).toString();
  }).join('\n');
}

describe('official unsigned SNAP preparation',()=>{
  it('binds the official bytes, preserves every source page and never produces a sendable or signed result',async()=>{
    const result=await renderSnapPreparationDraft(template,full,now),pdf=await PDFDocument.load(result.bytes);
    expect(createHash('sha256').update(template).digest('hex')).toBe(SNAP_DRAFT_CONTRACT.sha256);
    expect(pdf.getPageCount()).toBe(12);
    expect(pdf.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    for(const page of pdf.getPages())expect(page.getSize()).toEqual({width:612,height:792});
    expect(result.readiness.submissionReady).toBe(false);
    expect(result.readiness.unresolvedGroups).toEqual(['required_applicant_identifiers_through_protected_entry','exact_packet_personal_certifications','permitted_delivery_and_actual_agency_receipt']);
    for(const [,object]of pdf.context.enumerateIndirectObjects())expect(object.toString()).not.toMatch(/\/FT\s*\/Sig|\/Subtype\s*\/Widget|\/JavaScript|\/EmbeddedFile/);
  });

  it('allows only the established scoped projection and does not turn size or aggregate income into invented roster or income rows',async()=>{
    const result=await renderSnapPreparationDraft(template,{kind:'current_scoped_facts',zip:'19104',language:'es',householdSize:3,incomeAmount:680,incomeFrequency:'biweekly'},now);
    expect(result.readiness.unmappedKnownFacts).toEqual(['householdSize','incomeAmount','incomeFrequency']);
    expect(result.readiness.unresolvedGroups).toContain('household_roster_and_applicants');
    expect(result.readiness.unresolvedGroups).toContain('current_month_per_person_income');
    expect(result.readiness.unresolvedGroups).toContain('applicant_name');
    const output=await PDFDocument.load(result.bytes);
    expect(output.getPageCount()).toBe(12);
    expect(await drawnText(result.bytes,3)).not.toContain(Buffer.from('680.00').toString('hex').toUpperCase());
  });

  it('does not mark unknown answers as No or count an empty expense/history group as complete',()=>{
    const result=assessSnapPreparationDraft({kind:'synthetic_rehearsal',zip:'19104',history:{},expenses:{}},now);
    expect(result.unresolvedGroups).toContain('applicable_household_expenses');
    expect(result.unresolvedGroups).toContain('applicable_history_answers');
    expect(result.unresolvedGroups).toContain('medical_deduction_applicability');
  });

  it('keeps undefined answers and missing conditional details unresolved',()=>{
    const result=assessSnapPreparationDraft({...full,screening:{lowCashAndIncome:undefined,migrantOrSeasonal:false,belowShelterCosts:true},history:{fleeingOrProbation:{answer:true,names:'Maria Rivera'},welfareFraud:{answer:false},otherStateDisqualification:{answer:false}}},now);
    expect(result.unresolvedGroups).toContain('expedited_screening_answers');
    expect(result.unresolvedGroups).toContain('applicable_history_answers');
  });

  it('retains zero amounts and does not annualize a supplied pay-period amount',async()=>{
    if(full.kind!=='synthetic_rehearsal')throw new Error();
    const result=await renderSnapPreparationDraft(template,{...full,income:{hasIncome:true,entries:[{...full.income!.entries[0],amount:0}]},expenses:{...full.expenses,rent:0}},now);
    expect(result.bytes.length).toBeGreaterThan(10000);
    expect(result.readiness.submissionReady).toBe(false);
  });

  it('keeps a non-applicant’s citizenship and identity areas untouched',async()=>{
    if(full.kind!=='synthetic_rehearsal')throw new Error();
    const household=[...full.household!];household[1]={...household[1],requestingSnap:false,citizen:undefined};
    await expect(renderSnapPreparationDraft(template,{...full,household},now)).resolves.toHaveProperty('bytes');
    await expect(renderSnapPreparationDraft(template,{...full,household:[household[0],{...household[1],citizen:false}]},now)).rejects.toThrow(SNAP_DRAFT_ERROR);
  });

  it.each([
    {kind:'current_scoped_facts',zip:'bad'},
    {kind:'current_scoped_facts',applicant:{firstName:'Private',lastName:'Name'}},
    {...full,ssn:'PRIVATE_IDENTIFIER'},
    {...full,signature:'PRIVATE_SIGNATURE'},
    {...full,applicant:{firstName:'123-45-6789',lastName:'Private'}},
    {...full,applicant:{firstName:'１２３-４５-６７８９',lastName:'Private'}},
    {...full,applicant:{firstName:'Private\nName',lastName:'Name'}},
    {...full,applicant:{firstName:'🙂',lastName:'Name'}},
    {...full,applicant:{firstName:'W'.repeat(80),lastName:'W'.repeat(80)}},
    {...full,householdSize:3},
    {...full,household:[{firstName:'Maria',lastName:'Rivera',dateOfBirth:'2026-02-30',relationship:'SELF',requestingSnap:true}]},
    {...full,household:[{firstName:'Maria',lastName:'Rivera',dateOfBirth:'2027-01-01',relationship:'SELF',requestingSnap:true}]},
    {...full,household:[{firstName:'Other',lastName:'Person',dateOfBirth:'1988-01-01',relationship:'SELF',requestingSnap:true}]},
    {...full,income:{hasIncome:false,entries:[{personIndex:0,source:'Employment',amount:680,frequency:'biweekly',receivedOn:'2026-11-01'}]}},
    {...full,income:{hasIncome:true,entries:[{personIndex:7,source:'Employment',amount:680,frequency:'biweekly',receivedOn:'2026-11-01'}]}},
    {...full,income:{hasIncome:true,entries:[{personIndex:0,source:'Employment',amount:680,frequency:'biweekly',receivedOn:'2026-10-31'}]}},
    {...full,income:{hasIncome:true,entries:[{personIndex:0,source:'Employment',amount:680,frequency:'biweekly',receivedOn:'2026-11-04'}]}},
    {...full,expenses:{housingAssistance:false,housingAssistanceKind:'Private'}},
    {...full,expenses:{outsidePayer:false,outsideAmount:400}},
    {...full,expenses:{care:false,careMonthlyAmount:400}},
    {...full,expenses:{utilities:['electric','electric']}},
    {...full,history:{welfareFraud:{answer:false,names:'Private name'}}},
  ])('rejects malformed, contradictory, unsupported or protected input without echoing it: %#',async input=>{
    await expect(renderSnapPreparationDraft(template,input,now)).rejects.toMatchObject({message:SNAP_DRAFT_ERROR});
  });

  it('rejects overflow instead of dropping household or income rows',async()=>{
    if(full.kind!=='synthetic_rehearsal')throw new Error();
    await expect(renderSnapPreparationDraft(template,{...full,householdSize:9,household:Array.from({length:9},()=>full.household![0])},now)).rejects.toThrow(SNAP_DRAFT_ERROR);
    await expect(renderSnapPreparationDraft(template,{...full,income:{hasIncome:true,entries:Array.from({length:6},()=>full.income!.entries[0])}},now)).rejects.toThrow(SNAP_DRAFT_ERROR);
  });

  it('fills the final supported household and income rows without overflow',async()=>{
    if(full.kind!=='synthetic_rehearsal')throw new Error();
    const household=[full.household![0],...Array.from({length:7},(_,i)=>({...full.household![1],firstName:`Demo${i+1}`}))];
    const income={hasIncome:true,entries:Array.from({length:5},(_,i)=>({...full.income!.entries[0],personIndex:i}))};
    await expect(renderSnapPreparationDraft(template,{...full,householdSize:8,household,income},now)).resolves.toHaveProperty('bytes');
  });

  it.each([new Date('2026-11-02T12:00:00Z'),new Date(SNAP_DRAFT_CONTRACT.verifiedUntil),new Date('bad')])('rejects an unreviewed, expired or invalid time %s',async at=>{
    await expect(renderSnapPreparationDraft(template,full,at)).rejects.toThrow(SNAP_DRAFT_ERROR);
  });

  it('rejects changed or truncated templates before returning any artifact',async()=>{
    await expect(renderSnapPreparationDraft(template.subarray(0,template.length-1),full,now)).rejects.toThrow(SNAP_DRAFT_ERROR);
    const changed=Uint8Array.from(template);changed[100]^=1;
    await expect(renderSnapPreparationDraft(changed,full,now)).rejects.toThrow(SNAP_DRAFT_ERROR);
  });

  it.skipIf(!process.env.CASELINK_PYTHON_BIN)('renders three official-form cases, validates exact field regions and keeps protected areas visually unchanged',async()=>{
    const dir=resolve('tmp/parent-verification/snap-drafts');mkdirSync(dir,{recursive:true});
    writeFileSync(`${dir}/source.pdf`,template);
    const fullResult=await renderSnapPreparationDraft(template,full,now);
    const minimalResult=await renderSnapPreparationDraft(template,{kind:'current_scoped_facts',zip:'19104',language:'es',householdSize:3,incomeAmount:680,incomeFrequency:'biweekly'},now);
    const emptyResult=await renderSnapPreparationDraft(template,{kind:'current_scoped_facts'},now);
    writeFileSync(`${dir}/full.pdf`,fullResult.bytes);writeFileSync(`${dir}/scoped.pdf`,minimalResult.bytes);writeFileSync(`${dir}/empty.pdf`,emptyResult.bytes);
    const script=String.raw`
import sys, json
from pathlib import Path
import pdfplumber
import pypdfium2 as pdfium
d=Path(sys.argv[1])
with pdfplumber.open(d/'full.pdf') as p:
 assert len(p.pages)==12
 for page in p.pages: assert 'INCOMPLETE UNSIGNED PREPARATION - NOT SENT' in (page.extract_text() or '')
 text='\n'.join(page.extract_text() or '' for page in p.pages)
 for item in ['INCOMPLETE UNSIGNED PREPARATION - NOT SENT','Maria','Rivera','19104','680.00','Every two weeks','11/01/2026','850.00','Rental assistance','Partial water bill','20.00','120.00','Other qualifying medical cost','rights and responsibilities']: assert item.lower() in text.lower(),item
 def words(page,box): return ' '.join(w['text'] for w in page.crop(box).extract_words())
 # Coordinates include the renderer's 0.92 scale and preparation margin.
 assert 'Rivera' in words(p.pages[2],(47,174,249,196))
 assert '19104' in words(p.pages[2],(505,205,566,227))
 assert '680.00' in words(p.pages[3],(337,193,414,221))
 assert '850.00' in words(p.pages[4],(81,474,157,493))
 for word,line_y in [('Partial',539.36),('20.00',518.36),('Leo',337.47),('qualifying',109.4)]:
  placed=next(w for w in p.pages[4].extract_words() if w['text']==word)
  line_top=792-(32+line_y*.92)
  assert placed['bottom']<line_top-.2,(word,placed,line_top)
with pdfplumber.open(d/'scoped.pdf') as p:
 text='\n'.join(page.extract_text() or '' for page in p.pages)
 assert '19104' in text
 assert '680.00' not in text and 'Every two weeks' not in text
full=pdfium.PdfDocument(d/'full.pdf');empty=pdfium.PdfDocument(d/'empty.pdf')
for i in [0,2,3,4,6,11]: full[i].render(scale=1.5).to_pil().save(d/f'full-page-{i+1}.png')
# Protected original regions must have identical raster pixels in filled and empty drafts.
regions={2:[(443,144,522,318),(92,41,345,70),(405,41,520,70)],6:[(31,294,581,336),(31,251,581,292)],5:[(22,438,590,785)]}
checks=0
for index,boxes in regions.items():
 a=full[index].render(scale=2).to_pil();b=empty[index].render(scale=2).to_pil()
 for x0,y0,x1,y1 in boxes:
  # Source coordinates use PDF bottom-left. Convert after the uniform transform.
  box=(round((24.48+x0*.92)*2),round((792-(32+y1*.92))*2),round((24.48+x1*.92)*2),round((792-(32+y0*.92))*2))
  assert a.crop(box).tobytes()==b.crop(box).tobytes(),(index,box)
  checks+=1
print(json.dumps({'pages':12,'cases':3,'protectedRegionChecks':checks,'renderedPages':6}))
`;
    const result=JSON.parse(execFileSync(process.env.CASELINK_PYTHON_BIN!,['-c',script,dir],{encoding:'utf8'}));
    expect(result).toMatchObject({pages:12,cases:3,protectedRegionChecks:6,renderedPages:6});
    writeFileSync(`${dir}/verification.json`,JSON.stringify({passed:true,...result},null,2));
  },30000);
});
