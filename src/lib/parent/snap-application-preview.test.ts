import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { assessSnapApplicationFields, type SnapApplicationFields } from "./snap-application-fields";
import { renderSnapApplicationPreview, renderSnapPreparationDraft, SNAP_DRAFT_CONTRACT, SNAP_DRAFT_ERROR } from "./snap-draft";

const template=readFileSync('data/verified-forms/snap-pa600fs-2019.pdf');
const now=new Date('2026-11-03T21:00:00Z');
const personId='11111111-1111-4111-8111-111111111111';
const incomeId='22222222-2222-4222-8222-222222222222';
function complete(): SnapApplicationFields {
  return {
    zip:'19104',language:'en',householdSize:2,
    applicant:{firstName:'Maria',lastName:'Rivera',middleInitial:'A'},
    address:{street:'123 Synthetic Lane',city:'Philadelphia',state:'PA'},county:'Philadelphia',
    phone:'215-555-0101',otherPhone:'215-555-0102',bestTimeToCall:'Weekday mornings',interpreter:false,
    screening:{lowCashAndIncome:false,migrantOrSeasonal:false,belowShelterCosts:true},
    household:[
      {id:personId,firstName:'Maria',lastName:'Rivera',middleInitial:'A',dateOfBirth:'1988-04-15',relationship:'SELF',requestingSnap:true,sex:'female',student:false,citizen:true},
      {id:'33333333-3333-4333-8333-333333333333',firstName:'Leo',lastName:'Rivera',dateOfBirth:'2018-03-12',relationship:'Child',requestingSnap:false,sex:'male',student:true},
    ],
    income:{month:'2026-11',hasIncome:true,entries:[{id:incomeId,personId,source:'Employment',amount:680,frequency:'Every two weeks',status:'received',date:'2026-11-01'}]},
    history:{fleeingOrProbation:{answer:true,names:'Maria Rivera',date:'2020-05-01',state:'PA'},welfareFraud:{answer:true,names:'Maria Rivera',date:'2019-02-01',state:'PA'},otherStateDisqualification:{answer:true,names:'Maria Rivera'}},
    expenseClaims:{household:'claim',housing:['rent','condoFees','mortgage','propertyFees','homeownersInsurance'],medical:'claim'},
    expenses:{childSupport:true,courtOrdered:true,mealsIncludedInRent:false,heat:true,housingAssistance:true,housingAssistanceKind:'Rental assistance',utilityAllowance:false,outsidePayer:true,outsideExpenses:'Partial water bill',outsideAmount:20,outsideFrequency:'Monthly',outsidePayee:'Water utility',airConditioning:true,utilities:['electric','water','other'],otherUtility:'Other household utility',care:true,careMonthlyAmount:120,careRecipient:'Leo Rivera',rent:850,condoFees:15,mortgage:0,propertyFees:0,homeownersInsurance:0,medical:['dental','other'],otherMedical:'Other qualifying medical cost'},
  };
}

describe('real saved SNAP application nonprotected preview',()=>{
  it.each(['application','routing'] as const)('registers written-answer fonts before embedding the %s preview pages',async kind=>{
    const result=kind==='application' ? await renderSnapApplicationPreview(template,complete(),now)
      : await renderSnapPreparationDraft(template,{kind:'current_scoped_facts',zip:'19104',language:'en'},now);
    expect(result.bytes).not.toBeNull();const pdf=await PDFDocument.load(result.bytes!);let answerFonts=0;
    for(const page of pdf.getPages()){
      const objects=page.node.Resources()?.lookupMaybe(PDFName.of('XObject'),PDFDict);
      for(const[,reference]of objects?.entries()??[]){
        const stream=pdf.context.lookup(reference);
        if(!(stream instanceof PDFRawStream))throw new Error('Expected an embedded page stream.');
        const resources=stream.dict.lookup(PDFName.of('Resources'),PDFDict);
        const fonts=resources.lookupMaybe(PDFName.of('Font'),PDFDict);
        for(const[name,fontRef]of fonts?.entries()??[]){
          if(!name.asString().startsWith('/Helvetica-'))continue;
          const font=pdf.context.lookup(fontRef);expect(font).toBeInstanceOf(PDFDict);
          expect((font as PDFDict).get(PDFName.of('BaseFont'))).toEqual(PDFName.of('Helvetica'));answerFonts++;
        }
      }
    }
    expect(answerFonts).toBeGreaterThan(0);
  });
  it('renders the real value contract without a synthetic label or submission claim',async()=>{
    const value=complete(),result=await renderSnapApplicationPreview(template,value,now);
    expect(result.bytes).not.toBeNull();
    expect(result.readiness).toMatchObject({
      kind:'unsigned_nonprotected_application_preview',protectedIncomplete:true,
      nonProtectedDataReadyForReview:true,submissionReady:false,renderingRequirements:[],
      missingFields:assessSnapApplicationFields(value,now).missingFields,
    });
    const pdf=await PDFDocument.load(result.bytes!);
    expect(pdf.getPageCount()).toBe(12);
    expect(pdf.getTitle()).toContain('protected fields incomplete');
    expect(pdf.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    for(const page of pdf.getPages())expect(page.getSize()).toEqual({width:612,height:792});
    for(const [,object]of pdf.context.enumerateIndirectObjects())expect(object.toString()).not.toMatch(/\/FT\s*\/Sig|\/Subtype\s*\/Widget|\/JavaScript|\/EmbeddedFile/);
  });
  it('maps expected income, supplied frequency, Other language and a real representative without creating designation',async()=>{
    const value=complete();value.language='other';value.otherLanguage='French';value.interpreter=true;value.interpreterLanguage='French';
    value.income!.entries!.push({id:'44444444-4444-4444-8444-444444444444',personId,source:'Self employment',amount:100,frequency:'Irregular',status:'expected',date:'2026-11-20'});
    value.authorizedRepresentative={name:'Jamie Sample',address:{street:'20 Synthetic Lane',city:'Philadelphia',state:'PA',zip:'19104'},phone:'215-555-0103'};
    const result=await renderSnapApplicationPreview(template,value,now);
    expect(result.bytes).not.toBeNull();
    expect(result.readiness.renderingRequirements).toEqual([]);
    expect(result.readiness.protectedSteps).toContainEqual({step:'genuine_representative_designation_and_personal_act'});
    expect(result.readiness.submissionReady).toBe(false);
  });
  it('keeps absent phone optional and explicit waived deductions blank',async()=>{
    const value=complete();delete value.phone;delete value.otherPhone;delete value.expenses;
    value.expenseClaims={household:'do_not_claim',medical:'do_not_claim'};
    const result=await renderSnapApplicationPreview(template,value,now);
    expect(result.bytes).not.toBeNull();
    expect(result.readiness.nonProtectedDataReadyForReview).toBe(true);
    expect(result.readiness.optionalContactNotes).toEqual(['phone_not_supplied']);
  });
  it('retains partial readiness and never invents people, payments, No answers or zero expenses from routing context',async()=>{
    const result=await renderSnapApplicationPreview(template,{zip:'19104',householdSize:3,incomeAmount:680,incomeFrequency:'biweekly'},now);
    expect(result.bytes).not.toBeNull();
    expect(result.readiness.nonProtectedDataReadyForReview).toBe(false);
    expect(result.readiness.unmappedContextFields).toEqual(['householdSize','incomeAmount','incomeFrequency']);
    expect(result.readiness.missingFields).toEqual(expect.arrayContaining(['household','income','expenseClaims.household']));
  });
  it('does not claim a payment status for a partial saved income row',async()=>{
    const value=complete();delete value.income!.entries![0].status;
    const result=await renderSnapApplicationPreview(template,value,now);
    expect(result.bytes).not.toBeNull();
    expect(result.readiness.nonProtectedDataReadyForReview).toBe(false);
    expect(result.readiness.missingFields).toContain(`income.entries.${incomeId}.status`);
  });
  it.each(['income','outsideAmount','careMonthlyAmount','rent'] as const)('does not silently round a saved %s amount',async field=>{
    const value=complete();
    if(field==='income')value.income!.entries![0].amount=680.005;
    else value.expenses![field]=0.001;
    const original=structuredClone(value);
    const result=await renderSnapApplicationPreview(template,value,now);
    expect(result.bytes===null).toBe(true);
    expect(result.readiness.renderingRequirements).toContain('exact_amount_rendering');
    expect(result.readiness.submissionReady).toBe(false);
    expect(value).toEqual(original);
  });
  it('still renders ordinary exact cent amounts',async()=>{
    const value=complete();value.income!.entries![0].amount=680.01;value.expenses!.rent=850.25;
    const result=await renderSnapApplicationPreview(template,value,now);
    expect(result.bytes!==null).toBe(true);
    expect(result.readiness.renderingRequirements).toEqual([]);
  });
  it.each(['household','income'] as const)('reports %s overflow without creating a truncated preview',async field=>{
    const value=complete();
    if(field==='household'){
      value.householdSize=9;
      value.household=[value.household![0],...Array.from({length:8},(_,i)=>({...value.household![1],id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`}))];
    }else value.income!.entries=Array.from({length:6},(_,i)=>({...value.income!.entries![0],id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));
    const result=await renderSnapApplicationPreview(template,value,now);
    expect(result.bytes).toBeNull();
    expect(result.readiness.nonProtectedDataReadyForReview).toBe(true);
    expect(result.readiness.renderingRequirements).toEqual([field==='household'?'accepted_household_continuation':'accepted_income_continuation']);
  });
  it('renders exactly the existing eight-person/five-income capacity',async()=>{
    const value=complete();value.householdSize=8;
    value.household=[value.household![0],...Array.from({length:7},(_,i)=>({...value.household![1],id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,firstName:`Demo${i+1}`}))];
    value.income!.entries=Array.from({length:5},(_,i)=>({...value.income!.entries![0],id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,personId:value.household![i].id}));
    expect((await renderSnapApplicationPreview(template,value,now)).bytes).not.toBeNull();
  });
  it.each([
    (v:SnapApplicationFields)=>{v.applicant!.firstName='W'.repeat(80);v.household![0].firstName='W'.repeat(80);},
    (v:SnapApplicationFields)=>{v.income!.entries![0].frequency='W'.repeat(60);},
    (v:SnapApplicationFields)=>{v.language='other';v.otherLanguage='中文';},
    (v:SnapApplicationFields)=>{v.authorizedRepresentative={name:'W'.repeat(160)};},
  ])('reports unsupported layout or glyphs without returning partial bytes %#',async change=>{
    const value=complete();change(value);const result=await renderSnapApplicationPreview(template,value,now);
    expect(result.bytes).toBeNull();
    expect(result.readiness.renderingRequirements).toEqual(['field_layout_or_font_support']);
  });
  it.each([
    {ssn:'PRIVATE_IDENTIFIER'}, {signature:'PRIVATE_SIGNATURE'}, {password:'PRIVATE_PASSWORD'},
    {applicant:{firstName:'123-45-6789',lastName:'Private'}},
    {income:{month:'2026-10',hasIncome:false}},
    {household:[{id:personId,dateOfBirth:'2026-02-30'}]},
  ])('generically rejects invalid/protected values without echoing them %#',async extra=>{
    await expect(renderSnapApplicationPreview(template,{...complete(),...extra},now)).rejects.toMatchObject({message:SNAP_DRAFT_ERROR});
  });
  it.each([new Date('bad'),new Date('2026-11-02T12:00:00Z'),new Date(SNAP_DRAFT_CONTRACT.verifiedUntil)])('retains the exact source review window %s',async at=>{
    await expect(renderSnapApplicationPreview(template,{},at)).rejects.toThrow(SNAP_DRAFT_ERROR);
  });
  it('rejects changed or truncated pinned bytes, including before reporting an overflow requirement',async()=>{
    await expect(renderSnapApplicationPreview(template.subarray(0,-1),{},now)).rejects.toThrow(SNAP_DRAFT_ERROR);
    const changed=Uint8Array.from(template);changed[100]^=1;
    await expect(renderSnapApplicationPreview(changed,{},now)).rejects.toThrow(SNAP_DRAFT_ERROR);
    const overflow=complete();overflow.income!.entries=Array.from({length:6},(_,i)=>({...overflow.income!.entries![0],id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));
    await expect(renderSnapApplicationPreview(changed,overflow,now)).rejects.toThrow(SNAP_DRAFT_ERROR);
  });
  it.skipIf(!process.env.CASELINK_PYTHON_BIN)('preserves every original text page, exact filled fields and protected pixels across real application variants',async()=>{
    const dir=resolve('tmp/parent-verification/snap-application-preview');mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/source.pdf`,template);
    const value=complete();value.language='other';value.otherLanguage='French';value.interpreter=true;value.interpreterLanguage='French';
    value.income!.entries!.push({id:'44444444-4444-4444-8444-444444444444',personId,source:'Self employment',amount:100,frequency:'Irregular',status:'expected',date:'2026-11-20'});
    value.authorizedRepresentative={name:'Jamie Sample',address:{street:'20 Synthetic Lane',city:'Philadelphia',state:'PA',zip:'19104'},phone:'215-555-0103'};
    const noPhone=complete();delete noPhone.phone;delete noPhone.otherPhone;delete noPhone.expenses;noPhone.expenseClaims={household:'do_not_claim',medical:'do_not_claim'};
    for(const [key,input]of Object.entries({full:value,empty:{},waived:noPhone,context:{zip:'19104',householdSize:3,incomeAmount:680,incomeFrequency:'biweekly'}})){
      const output=await renderSnapApplicationPreview(template,input,now);expect(output.bytes).not.toBeNull();writeFileSync(`${dir}/${key}.pdf`,output.bytes!);
    }
    const script=String.raw`
import sys,json
from collections import Counter
from pathlib import Path
import pdfplumber
import pypdfium2 as pdfium
d=Path(sys.argv[1])
with pdfplumber.open(d/'source.pdf') as original,pdfplumber.open(d/'full.pdf') as output:
 assert len(output.pages)==len(original.pages)==12
 for a,b in zip(original.pages,output.pages):
  # Embedding keeps every original glyph; grouping added answers cannot hide lost source text.
  assert not Counter(c['text'] for c in a.chars)-Counter(c['text'] for c in b.chars)
  assert 'UNSIGNED SNAP PREVIEW - PROTECTED FIELDS INCOMPLETE - NOT SENT' in b.extract_text()
 text='\n'.join(page.extract_text() or '' for page in output.pages)
 for item in ['Maria','Rivera','19104','680.00','Every two weeks','11/01/2026','EXPECTED','11/20/2026','Irregular','French','Jamie Sample','20 Synthetic Lane','215-555-0103','850.00','Rental assistance','Partial water bill','Other qualifying medical cost']:
  assert item in text,item
 assert '11111111-1111' not in text and '22222222-2222' not in text
 def words(page,box): return ' '.join(w['text'] for w in page.crop(box).extract_words())
 # Source-coordinate regions transformed by the existing 0.92 margin wrapper.
 def field(page,x0,y0,x1,y1): return words(page,(24.48+x0*.92,792-(32+y1*.92),24.48+x1*.92,792-(32+y0*.92)))
 assert field(output.pages[2],530,676.5,583,690)=='French'
 assert field(output.pages[2],530,660.3,583,674)=='French'
 assert field(output.pages[3],506,563,587,585)=='EXPECTED 11/20/2026'
 assert 'Jamie Sample' in field(output.pages[6],23,157,243,183)
 assert '20 Synthetic Lane' in field(output.pages[6],243,157,472,183)
 assert field(output.pages[6],472,157,590,183)=='215-555-0103'
 assert 'not a signed designation' in output.pages[6].extract_text()
with pdfplumber.open(d/'waived.pdf') as p:
 text='\n'.join(page.extract_text() or '' for page in p.pages)
 assert '215-555-0101' not in text and '850.00' not in text
 assert not any(w['text']=='0.00' for page in p.pages for w in page.extract_words())
with pdfplumber.open(d/'context.pdf') as p:
 text='\n'.join(page.extract_text() or '' for page in p.pages)
 assert '680.00' not in text and 'Every two weeks' not in text
full=pdfium.PdfDocument(d/'full.pdf');empty=pdfium.PdfDocument(d/'empty.pdf');waived=pdfium.PdfDocument(d/'waived.pdf')
regions={2:[(443,144,522,318),(92,41,345,70),(405,41,520,70)],6:[(31,294,581,336),(31,251,581,292)],5:[(22,438,590,785)]}
def pixels(pdf,index,box):
 x0,y0,x1,y1=box
 region=(round((24.48+x0*.92)*2),round((792-(32+y1*.92))*2),round((24.48+x1*.92)*2),round((792-(32+y0*.92))*2))
 return pdf[index].render(scale=2).to_pil().crop(region).tobytes()
checks=0
for index,boxes in regions.items():
 for box in boxes:
  assert pixels(full,index,box)==pixels(empty,index,box),(index,box)
  checks+=1
for box in [(154,533,290,566),(309,533,414,566)]: assert pixels(waived,2,box)==pixels(empty,2,box)
# An explicit deduction decline adds no forged No marks or zeros anywhere on the expense page.
assert pixels(waived,4,(22,95,590,732))==pixels(empty,4,(22,95,590,732))
# Other is marked, English/Spanish remain unchanged, and non-applicant citizenship stays untouched.
assert pixels(full,2,(398,674,408,686))!=pixels(empty,2,(398,674,408,686))
for box in [(243,674,254,686),(315,674,326,686),(530,282,581,299)]: assert pixels(full,2,box)==pixels(empty,2,box)
for i in [0,2,3,4,6,11]: full[i].render(scale=1.5).to_pil().save(d/f'full-page-{i+1}.png')
print(json.dumps({'pages':12,'cases':4,'sourceTextPages':12,'protectedRegionChecks':checks,'renderedPages':6}))
`;
    const result=JSON.parse(execFileSync(process.env.CASELINK_PYTHON_BIN!,['-c',script,dir],{encoding:'utf8'}));
    expect(result).toMatchObject({pages:12,cases:4,sourceTextPages:12,protectedRegionChecks:6,renderedPages:6});
    writeFileSync(`${dir}/verification.json`,JSON.stringify({passed:true,...result},null,2));
  },30000);
});
