import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { type SnapApplicationFields } from "./snap-application-fields";
import { renderSnapApplicationPreview, SNAP_DRAFT_CONTRACT } from "./snap-draft";
import { renderSnapSigningCopy, SNAP_SIGNING_COPY_ERROR } from "./snap-signing-copy";
import { fixtureSnapApplication } from "./test-fixtures";

const template=readFileSync('data/verified-forms/snap-pa600fs-2019.pdf');
const now=new Date('2026-11-03T21:00:00Z');
function full(): SnapApplicationFields {
  const value=fixtureSnapApplication(now);
  value.applicant={firstName:'Maria',lastName:'Rivera',middleInitial:'A'};
  Object.assign(value.household![0],value.applicant);
  value.phone='215-555-0101';value.otherPhone='215-555-0102';value.bestTimeToCall='Weekday mornings';
  value.language='other';value.otherLanguage='French';value.interpreter=true;value.interpreterLanguage='French';
  value.income={month:'2026-11',hasIncome:true,entries:[
    {id:'22222222-2222-4222-8222-222222222222',personId:value.household![0].id,source:'Employment',amount:680.01,frequency:'Every two weeks',status:'received',date:'2026-11-01'},
    {id:'44444444-4444-4444-8444-444444444444',personId:value.household![0].id,source:'Self employment',amount:100,frequency:'Irregular',status:'expected',date:'2026-11-20'},
  ]};
  value.expenseClaims={household:'claim',housing:['rent'],medical:'claim'};
  value.expenses={childSupport:false,mealsIncludedInRent:false,heat:true,housingAssistance:false,outsidePayer:false,airConditioning:false,utilities:['electric'],care:false,rent:850.25,medical:['dental']};
  value.authorizedRepresentative={name:'Jamie Sample',address:{street:'20 Synthetic Lane',city:'Philadelphia',state:'PA',zip:'19104'},phone:'215-555-0103'};
  return value;
}

describe('official SNAP signing copy, before protected completion',()=>{
  it('preserves original page boxes and distinguishes its incomplete, unsigned role',async()=>{
    const value=full(),before=structuredClone(value),source=await PDFDocument.load(template);
    const result=await renderSnapSigningCopy(template,value,now);
    expect(result.bytes).not.toBeNull();
    expect(value).toEqual(before);
    expect(result.readiness).toMatchObject({kind:'unsigned_nonprotected_official_signing_copy',protectedIncomplete:true,submissionReady:false,nonProtectedDataReadyForReview:true,renderingRequirements:[],source:{templateSha256:SNAP_DRAFT_CONTRACT.sha256}});
    expect(result.readiness.protectedSteps).toEqual(expect.arrayContaining([
      {step:'required_identifier_or_verified_exception',personId:value.household![0].id},
      {step:'genuine_applicant_certifications_printed_pages_1_and_5'},
      {step:'genuine_representative_designation_and_personal_act'},
      {step:'permitted_delivery_and_actual_agency_receipt'},
    ]));
    const pdf=await PDFDocument.load(result.bytes!,{updateMetadata:false});
    expect(pdf.getPageCount()).toBe(12);
    expect(pdf.getTitle()).toBe('SNAP official signing copy - protected fields blank - not submission-ready - not sent');
    expect(pdf.getSubject()).toContain('signatures/dates remain blank');
    expect(pdf.getKeywords()).toContain(result.readiness.kind);
    expect([pdf.getTitle(),pdf.getSubject(),pdf.getKeywords()].join(' ')).not.toMatch(/Maria|Rivera|Jamie|19104/);
    expect(pdf.getCreationDate()).toEqual(now);expect(pdf.getModificationDate()).toEqual(now);
    expect(pdf.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    pdf.getPages().forEach((page,i)=>{
      for(const box of ['getMediaBox','getCropBox','getBleedBox','getTrimBox','getArtBox'] as const)expect(page[box]()).toEqual(source.getPage(i)[box]());
      expect(page.getRotation()).toEqual(source.getPage(i).getRotation());
    });
    for(const [,object]of pdf.context.enumerateIndirectObjects())expect(object.toString()).not.toMatch(/\/FT\s*\/Sig|\/Subtype\s*\/Widget|\/JavaScript|\/EmbeddedFile/);
  });
  it('keeps the existing wrapped preview type and title unchanged',async()=>{
    const [copy,preview]=await Promise.all([renderSnapSigningCopy(template,full(),now),renderSnapApplicationPreview(template,full(),now)]);
    expect(preview.readiness).toEqual({...copy.readiness,kind:'unsigned_nonprotected_application_preview'});
    expect((await PDFDocument.load(preview.bytes!)).getTitle()).toBe('Unsigned SNAP application preview - protected fields incomplete - not sent');
  });
  it.each([{}, {zip:'19104',householdSize:3,incomeAmount:680,incomeFrequency:'biweekly'}])('does not issue a signing copy while nonprotected answers remain missing %#',async input=>{
    const result=await renderSnapSigningCopy(template,input,now);
    expect(result.bytes).toBeNull();
    expect(result.readiness).toMatchObject({kind:'unsigned_nonprotected_official_signing_copy',nonProtectedDataReadyForReview:false,submissionReady:false});
    expect(result.readiness.missingFields).toContain('household');
    expect((await renderSnapApplicationPreview(template,input,now)).bytes).not.toBeNull();
  });
  it('permits omitted optional contacts and explicitly declined deductions',async()=>{
    const result=await renderSnapSigningCopy(template,fixtureSnapApplication(now),now);
    expect(result.bytes).not.toBeNull();expect(result.readiness.optionalContactNotes).toEqual(['phone_not_supplied']);
  });
  it.each(['income','household'] as const)('preserves %s continuation requirements without truncating',async group=>{
    const value=full();
    if(group==='income')value.income!.entries=Array.from({length:6},(_,i)=>({...value.income!.entries![0],id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));
    else {
      value.householdSize=9;
      value.household=Array.from({length:9},(_,i)=>({...value.household![0],id:i?`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`:value.household![0].id,relationship:i?'Child':'SELF'}));
    }
    const result=await renderSnapSigningCopy(template,value,now);
    expect(result.bytes).toBeNull();expect(result.readiness.renderingRequirements).toEqual([group==='income'?'accepted_income_continuation':'accepted_household_continuation']);
  });
  it.each([
    [(v:SnapApplicationFields)=>{v.income!.entries![0].amount=680.005;},'exact_amount_rendering'],
    [(v:SnapApplicationFields)=>{v.expenses!.rent=850.001;},'exact_amount_rendering'],
    [(v:SnapApplicationFields)=>{v.otherLanguage='中文';},'field_layout_or_font_support'],
    [(v:SnapApplicationFields)=>{v.applicant!.firstName='W'.repeat(80);v.household![0].firstName='W'.repeat(80);},'field_layout_or_font_support'],
  ] as const)('retains exact monetary and supported-layout checks %#',async(change,requirement)=>{
    const value=full();change(value);const before=structuredClone(value);
    const result=await renderSnapSigningCopy(template,value,now);
    expect(result.bytes).toBeNull();expect(result.readiness.renderingRequirements).toEqual([requirement]);expect(value).toEqual(before);
  });
  it.each([
    {ssn:'PRIVATE_IDENTIFIER'}, {signature:'PRIVATE_SIGNATURE'}, {signatureDate:'PRIVATE_DATE'}, {password:'PRIVATE_PASSWORD'},
    {applicant:{firstName:'123-45-6789',lastName:'Private'}},
    {household:[{...fixtureSnapApplication(now).household![0],ssn:'PRIVATE_IDENTIFIER'}]},
    {income:{month:'2026-10',hasIncome:false}},
  ])('rejects protected or invalid inputs with a content-free error %#',async extra=>{
    await expect(renderSnapSigningCopy(template,{...full(),...extra},now)).rejects.toMatchObject({message:SNAP_SIGNING_COPY_ERROR});
  });
  it.each([new Date('bad'),new Date('2026-11-02T12:00:00Z'),new Date(SNAP_DRAFT_CONTRACT.verifiedUntil)])('requires the current reviewed source window %s',async at=>{
    await expect(renderSnapSigningCopy(template,{},at)).rejects.toThrow(SNAP_SIGNING_COPY_ERROR);
  });
  it('rejects changed or truncated source bytes before readiness can be returned',async()=>{
    const changed=Uint8Array.from(template);changed[100]^=1;
    await expect(renderSnapSigningCopy(changed,{},now)).rejects.toThrow(SNAP_SIGNING_COPY_ERROR);
    await expect(renderSnapSigningCopy(template.subarray(0,-1),full(),now)).rejects.toThrow(SNAP_SIGNING_COPY_ERROR);
  });
  it.skipIf(!process.env.CASELINK_PYTHON_BIN)('proves native source placement, exact fields and untouched personal regions by text and rendered pixels',async()=>{
    const directory=resolve('tmp/parent-verification/snap-signing-copy');mkdirSync(directory,{recursive:true});
    writeFileSync(`${directory}/source.pdf`,template);
    for(const [key,value]of Object.entries({full:full(),waived:fixtureSnapApplication(now)})){
      const result=await renderSnapSigningCopy(template,value,now);expect(result.bytes).not.toBeNull();writeFileSync(`${directory}/${key}.pdf`,result.bytes!);
    }
    const script=String.raw`
import sys,json
from collections import Counter
from pathlib import Path
import pdfplumber
import pypdfium2 as pdfium
d=Path(sys.argv[1])
def glyphs(page): return Counter((c['text'],round(c['x0'],3),round(c['top'],3),round(c['x1'],3),round(c['bottom'],3)) for c in page.chars)
with pdfplumber.open(d/'source.pdf') as original,pdfplumber.open(d/'full.pdf') as output:
 assert len(original.pages)==len(output.pages)==12
 for a,b in zip(original.pages,output.pages):
  assert (a.width,a.height)==(b.width,b.height)==(612,792)
  assert not glyphs(a)-glyphs(b),'source glyph removed or moved'
  assert 'UNSIGNED SNAP PREVIEW' not in (b.extract_text() or '')
 def field(page,x0,y0,x1,y1): return ' '.join(w['text'] for w in page.crop((x0,792-y1,x1,792-y0)).extract_words())
 for index,box,wanted in [
  (2,(254,617,453,632),'Maria'),(2,(26,617,245,632),'Rivera'),
  (2,(526,585,580,600),'19104'),(2,(530,676.5,583,690),'French'),
  (2,(530,660.3,583,674),'French'),(3,(346,591,418,610),'680.01'),
  (3,(506,563,587,585),'EXPECTED 11/20/2026'),(4,(65,295,140,308),'850.25'),
  (6,(23,157,243,183),'Jamie Sample'),(6,(472,157,590,183),'215-555-0103')]:
  assert field(output.pages[index],*box)==wanted,(index,box,wanted,field(output.pages[index],*box))
 text='\n'.join(p.extract_text() or '' for p in output.pages)
 assert 'Irregular' in text and 'rights and responsibilities' in text
 for identifier in ['11111111-1111','22222222-2222','44444444-4444']: assert identifier not in text
original=pdfium.PdfDocument(d/'source.pdf');full=pdfium.PdfDocument(d/'full.pdf');waived=pdfium.PdfDocument(d/'waived.pdf')
original_pixels=[p.render(scale=2).to_pil() for p in original]
full_pixels=[p.render(scale=2).to_pil() for p in full]
waived_pixels=[p.render(scale=2).to_pil() for p in waived]
def pixels(images,index,box):
 x0,y0,x1,y1=box
 return images[index].crop((round(x0*2),round((792-y1)*2),round(x1*2),round((792-y0)*2))).tobytes()
# All SSN rows, both applicant certifications/dates, witness and representative signatures/dates.
regions={2:[(443,144,522,318),(92,41,345,70),(405,41,520,70)],6:[(31,294,581,336),(31,251,581,292)]}
checks=0
for images in [full_pixels,waived_pixels]:
 for index,boxes in regions.items():
  for box in boxes:
   assert pixels(images,index,box)==pixels(original_pixels,index,box),(index,box)
   checks+=1
# Every non-input page, including agency-only/optional demographics, stays pixel-identical.
untouched=[0,1,5,7,8,9,10,11]
for index in untouched:
 assert full_pixels[index].tobytes()==original_pixels[index].tobytes(),index
 assert waived_pixels[index].tobytes()==original_pixels[index].tobytes(),index
# Optional contacts and waived deductions are blank, not invented zero/No entries.
for box in [(154,533,290,566),(309,533,414,566)]: assert pixels(waived_pixels,2,box)==pixels(original_pixels,2,box)
assert waived_pixels[4].tobytes()==original_pixels[4].tobytes()
for index in [0,2,3,4,6,11]: full[index].render(scale=1.5).to_pil().save(d/f'full-page-{index+1}.png')
print(json.dumps({'pages':12,'sourceGlyphPositionPages':12,'cases':2,'protectedRegionChecks':checks,'unchangedWholePages':len(untouched),'renderedPages':6}))
`;
    const result=JSON.parse(execFileSync(process.env.CASELINK_PYTHON_BIN!,['-c',script,directory],{encoding:'utf8',timeout:30000}));
    expect(result).toEqual({pages:12,sourceGlyphPositionPages:12,cases:2,protectedRegionChecks:10,unchangedWholePages:8,renderedPages:6});
    writeFileSync(`${directory}/verification.json`,JSON.stringify({passed:true,...result},null,2));
  },30000);
});
