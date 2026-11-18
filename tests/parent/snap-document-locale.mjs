import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixtures from '../../src/lib/parent/test-fixtures.ts';
import sources from '../../src/lib/parent/snap-form-source.ts';
import renderer from '../../src/lib/parent/snap-signing-copy.ts';
import completionRenderer from '../../src/lib/parent/snap-direct-completion.ts';
import constants from '../../src/lib/parent/constants.ts';
const { fixtureRequest, fixtureIntake, fixtureMandate, fixtureSnapSnapshot, fixtureProtectedSnapOperation } = fixtures;
const { SNAP_EN_TEMPLATE_ID: EN, SNAP_ES_TEMPLATE_ID: ES, snapFormSource } = sources;
const { renderSnapSigningCopy } = renderer;
const origin=process.env.PARENT_TEST_ORIGIN??'http://127.0.0.1:3304', target=new URL(origin), evidence='tmp/parent-verification/snap-document-locale/browser';
assert.ok(target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname)&&target.origin===origin&&!target.username&&!target.password,'Loopback synthetic SNAP rehearsal only.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'), owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', requestId='d430cc02-d8d4-46cc-9900-5b397758fb16';
const copy={en:{next:'Continue',start:'Start getting support',adult:/I’m 18 or older/,authorize:/I authorize/,app:/^Your application/,edit:'Correct application answers',save:'Save application changes',retry:'Retry the same save',unknown:/save result has not been confirmed/,print:'Open the exact unsigned PDF to print or save',pdfPage:'Page 1 of 12',nextPage:'Next page',saved:'Your SNAP application answers',doc:'Official SNAP document language',submit:'Submit',recorded:/Your Submit decision is recorded/,page:n=>`Page ${n} of 12`,image:n=>`SNAP application page ${n}`},es:{next:'Continuar',start:'Comenzar a recibir apoyo',adult:/Tengo 18 años/,authorize:/Autorizo/,app:/^Su solicitud/,edit:'Corregir respuestas de la solicitud',save:'Guardar cambios de la solicitud',retry:'Reintentar el mismo guardado',unknown:/resultado del guardado no está confirmado/,print:'Abrir el PDF exacto sin firmar para imprimir o guardar',pdfPage:'Página 1 de 12',nextPage:'Página siguiente',saved:'Sus respuestas de la solicitud de SNAP',doc:'Idioma del documento oficial de SNAP',submit:'Enviar',recorded:/Su decisión de Enviar quedó registrada/,page:n=>`Página ${n} de 12`,image:n=>`Página ${n} de la solicitud de SNAP`}};
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true}), results=[];
try {
 for(const locale of (process.argv.includes('--large-smoke')?['en']:process.argv.includes('--smoke')?['es']:['en','es'])) for(const [width,large] of (process.argv.includes('--large-smoke')?[[320,true]]:process.argv.includes('--smoke')?[[320,false]]:[[320,false],[390,false],[1280,false],[320,true]])){
  const c=copy[locale],suffix=`${locale}-${width}${large?'-large-text':''}`,context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  const now=new Date(), expiry=new Date(Math.min(now.getTime()+3600000,Date.parse(snapFormSource(ES).contract.verifiedUntil))).toISOString();
  let request=fixtureRequest({id:requestId,version:2,intake:fixtureIntake({needs:['snap_new'],utilityProviders:[],zip:'19104'}),mandate:fixtureMandate({mode:'prepare_only',recipientIds:['snap-pa'],allowedActions:['research','prepare'],allowedData:['household','income'],expiresAt:expiry})});
  let saved=null, startBodies=[],saveBodies=[],startKeys=[],saveKeys=[], unsignedReads=0, finalReview=null, finalBytes=null, submitCount=0, errors=[], blocked=[], consoleErrors=[];
  page.on('console', message => { if(message.type()==='error') consoleErrors.push(message.text().slice(0,1000)); });
  const records=new Map();
  const snapshot=(details,id=ES,revision=1)=>({...fixtureSnapSnapshot(new Date(now.getTime()-60000),details),id:randomUUID(),request_id:requestId,revision,base_version:request.version-1,request_version:request.version,source:snapFormSource(id).source});
  const progress={state:'waiting',summary:'Synthetic SNAP display fixture; no Auth, program, model or sending is connected.',updatedAt:now.toISOString(),nextRunAt:null,canContinueAfterClosing:false};
  await context.addCookies([{name:'caselink-parent-ui-locale',value:locale,url:origin}]);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(url.origin==='http://127.0.0.1:55321')return route.fulfill({status:401,contentType:'application/json',body:'{"message":"Synthetic Auth fixture"}'});blocked.push(url.origin);return route.abort();});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/protected/snap/**',route=>{assert.ok(finalBytes);return route.fulfill({status:200,contentType:'application/pdf',headers:{'Content-Length':String(finalBytes.length),'Cache-Control':'private, no-store'},body:Buffer.from(finalBytes)});});
  await page.route('**/api/parent/**',async route=>{
   const req=route.request(), url=new URL(req.url()),path=url.pathname,method=req.method(),json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Cache-Control':'private, no-store'},body:JSON.stringify(body)});
   if(path==='/api/parent/account')return json({account:{id:owner,email:'synthetic@example.invalid',preferences:{language:'en',contactPreference:'in_app'}}});
   if(path==='/api/parent/authorization-window')return json({authorization:{issuedAt:now.toISOString(),expiresAt:expiry,snapApplication:{collectionEnabled:true,noticeVersion:constants.SNAP_APPLICATION_NOTICE_VERSION}}});
   if(path==='/api/parent/capabilities')return json({capabilities:[]});
   if(path==='/api/parent/partners')return json({ok:true,partners:[]});
   if(path==='/api/parent/family-profile')return json({ok:true,ownerId:owner,revision:0,lastMutationKey:null,profile:null,collection:{collectionEnabled:false,noticeVersion:null,expiresAt:null,retentionDays:45}});
   if(path.endsWith('/family-profile-source'))return json({ok:true,fields:[]});
   if(path==='/api/parent/requests'&&method==='POST'){
    const body=req.postData();startBodies.push(body);startKeys.push(req.headers()['idempotency-key']);const input=JSON.parse(body);assert.equal(input.documentTemplateId,ES);assert.equal(input.details.language,'en');assert.equal(input.intake.language,'en');
    if(startBodies.length===1)return json({ok:false,error:'We couldn\'t confirm that change. Refresh to check the latest saved information, then try again.'},503);
    assert.equal(body,startBodies[0]);assert.equal(startKeys.at(-1),startKeys[0]);request={...request,intake:input.intake,mandate:input.mandate};saved=snapshot(input.details);records.set(saved.id,saved);return json({ok:true,request,progress},201);
   }
   if(path===`/api/parent/requests/${requestId}/snap-application`){
    if(method==='POST'){
     const body=req.postData();saveBodies.push(body);saveKeys.push(req.headers()['idempotency-key']);const input=JSON.parse(body);assert.equal(input.documentTemplateId,EN);assert.deepEqual(input.details,saved.details);
     if(saveBodies.length===1)return json({ok:false,error:'We couldn\'t confirm that change. Refresh to check the latest saved information, then try again.'},503);
     assert.equal(body,saveBodies[0]);assert.equal(saveKeys.at(-1),saveKeys[0]);const old=saved;request={...request,version:request.version+1};saved={...snapshot(input.details,EN,2),provenance:old.provenance};records.set(saved.id,saved);return json({ok:true,snapshotId:saved.id},201);
    }
    return json({ok:true,snapshot:url.searchParams.has('revision')?records.get(url.searchParams.get('revision')):saved});
   }
   if(path.endsWith('/snap-submission')&&method==='POST'){assert.ok(finalReview);const input=req.postDataJSON();assert.equal(input.operationId,finalReview.operationId);assert.equal(input.packetId,finalReview.packet.protectedSnapPacket.packetId);assert.equal(input.contentSha256,sha(finalBytes));assert.deepEqual(input.completedActs,['applicant_signature_printed_page_1','rights_certification_printed_page_5']);submitCount++;assert.equal(submitCount,1);finalReview={...finalReview,snapSubmissionAuthorized:true,personalActsComplete:true};return json({ok:true,operationId:finalReview.operationId,state:'authorization_recorded'});}
   if(path.endsWith('/snap-application/capture'))return json({ok:true,capture:null});
   if(path.endsWith('/snap-application/context'))return json({ok:true,context:{requestVersion:request.version,snapshotId:saved.id,snapshotHash:'a'.repeat(64),source:saved.source,applyingSubjectIds:saved.details.household.filter(p=>p.requestingSnap).map(p=>p.id)}});
   if(path.endsWith('/snap-acquisition')){assert.equal(method,'GET','Closed protected method never receives a consent/capture POST.');return json({ok:false,error:'This support request is unavailable, or its permission has changed.'},403);}
   if(path.endsWith('/snap-signing-copy')){
    assert.equal(method,'GET');unsignedReads++;const form=snapFormSource(saved.source.templateId),file=await readFile(`data/verified-forms/${form.language==='es'?'snap-pa600fs-es-2019.pdf':'snap-pa600fs-2019.pdf'}`),rendered=await renderSnapSigningCopy(file,saved.details,new Date(saved.created_at),saved.source.templateId);assert.ok(rendered.bytes);if(locale==='es'&&width===1280&&saved.source.templateId===ES)await writeFile(`${evidence}/synthetic-es-unsigned.pdf`,rendered.bytes);
    return route.fulfill({status:200,contentType:'application/pdf',headers:{'Cache-Control':'private, no-store','X-CaseLink-SNAP-Unsigned-Byte-Length':String(rendered.bytes.length),'X-CaseLink-SNAP-Unsigned-SHA256':sha(rendered.bytes),'X-CaseLink-SNAP-Prepared-At':saved.created_at},body:Buffer.from(rendered.bytes)});
   }
   assert.equal(method,'GET',`Unexpected synthetic write ${path}`);
   if(path.endsWith('/operations'))return json({operations:[],historyLimited:false});
   if(path===`/api/parent/requests/${requestId}/browser`)return json({ok:true,available:false,reason:'Synthetic fixture: no browser service is connected.',session:null});
   if(path.endsWith('/snap-submission'))return json({ok:true,review:finalReview});
   if(path===`/api/parent/requests/${requestId}`)return json({ok:true,request,progress});
   if(path==='/api/parent/requests')return json({ok:true,requests:[request],progress:{[requestId]:progress}});
   assert.fail(`Unexpected synthetic read ${path}`);
  });
  async function check(state,section=page.locator('main')){
   await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
   if(width===320&&['details','mandate','start-unknown'].includes(state))assert.deepEqual(await page.locator('[class*="snapIntake"]').evaluate(root=>({container:getComputedStyle(root).paddingLeft,surface:getComputedStyle(root.querySelector('section[class*="surface"]')).paddingLeft})),{container:'12px',surface:'12px'},`${suffix}/${state} actual reading-width cascade`);
   const axe=await new AxeBuilder({page}).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],`${suffix}/${state} axe`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${suffix}/${state} page overflow`);
   const fractured=await section.evaluate(root=>{const found=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let node;node=walker.nextNode();){const element=node.parentElement;if(!element?.closest('p,label,legend,button,h1,h2,h3,h4')||element.closest('select,textarea,[hidden]')||!element.checkVisibility())continue;for(const match of node.textContent.matchAll(/\p{L}{3,}/gu)){const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);const rows=[...range.getClientRects()].filter(r=>r.width>0).map(r=>Math.round(r.top));if(new Set(rows).size>1){if(!found.length)element.dataset.snapFracture="true";found.push({word:match[0],width:element.getBoundingClientRect().width,fontSize:getComputedStyle(element).fontSize});}}}return found;});
   if(fractured.length){await page.locator("[data-snap-fracture]").first().scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/${suffix}-${state}-fracture-viewport.png`});await writeFile(`${evidence}/${suffix}-${state}-word-fractures.json`,JSON.stringify(fractured));}assert.deepEqual(fractured,[],`${suffix}/${state} ordinary word fractures`);
   assert.deepEqual(errors,[],`${suffix}/${state} page errors`);assert.deepEqual(blocked,[],`${suffix}/${state} external requests`);
   await section.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/${suffix}-${state}-viewport.png`});
   results.push({locale,width,large,state,axe:0,pageOverflow:false});
  }
  await page.goto(`${origin}/get-support?need=snap_new`,{waitUntil:'networkidle'});if(large)await page.addStyleTag({content:'html{font-size:200%}'});
  await page.locator('[data-snap-path="applicant.firstName"]').fill('José Ángel');await page.locator('[data-snap-path="applicant.lastName"]').fill('Muñoz Rivera');
  for(const[path,value]of Object.entries({'address.street':'123 Synthetic Lane','address.city':'Philadelphia','address.state':'PA',zip:'19104',county:'Philadelphia'}))await page.locator(`[data-snap-path="${path}"]`).fill(value);
  await page.locator('[data-snap-path$=".dateOfBirth"]').fill('1988-04-15');
  for(const[path,value]of Object.entries({language:'en',interpreter:'no','income.hasIncome':'no','screening.lowCashAndIncome':'no','screening.migrantOrSeasonal':'no','screening.belowShelterCosts':'no','history.fleeingOrProbation.answer':'no','history.welfareFraud.answer':'no','history.otherStateDisqualification.answer':'no','expenseClaims.household':'do_not_claim','expenseClaims.medical':'not_applicable'}))await page.locator(`[data-snap-path="${path}"]`).selectOption(value);
  for(const[suffix,value]of [['.sex','female'],['.student','no'],['.requestingSnap','yes'],['.citizen','yes']])await page.locator(`[data-snap-path$="${suffix}"]`).selectOption(value);
  assert.equal(await page.getByLabel(c.doc).inputValue(),EN,'Screen language never silently selects an official document.');await page.getByLabel(c.doc).selectOption(ES);assert.equal(await page.locator('[data-snap-path="language"]').inputValue(),'en');
  await page.getByRole('checkbox',{name:c.adult}).check();await page.locator('p').getByText(locale==='es'?'Solo en Mi apoyo':'Only in My support',{exact:true}).waitFor();await check('details',page.locator('form'));
  await page.getByRole('button',{name:c.next,exact:true}).click();await page.getByRole('checkbox',{name:c.authorize}).check();await check('mandate',page.locator('form'));
  await page.getByRole('button',{name:c.start,exact:true}).click();await page.getByText(c.unknown).waitFor();await check('start-unknown',page.locator('form'));await page.getByRole('button',{name:c.start,exact:true}).click();await page.waitForURL(`${origin}/support/${requestId}`);
  if(large)await page.addStyleTag({content:'html{font-size:200%}'});
  await page.getByRole('navigation',{name:locale==='es'?'Lista de pasos de su solicitud':'Your application checklist'}).getByRole('link',{name:c.app}).click();
  const panel=page.locator('#application-answers');await panel.getByRole('heading',{name:c.saved}).waitFor();await panel.getByRole('link',{name:c.print}).waitFor();await page.getByText(c.pdfPage,{exact:true}).waitFor();
  assert.equal(await panel.locator('input[type=password]').count(),0,'Closed Spanish source evidence mounts no protected input.');assert.ok(unsignedReads>0);await check('spanish-manual',panel);
  await panel.getByRole('button',{name:c.edit,exact:true}).click();await panel.getByLabel(c.doc).selectOption(EN);await check('source-correction',panel);
  await panel.getByRole('button',{name:c.save,exact:true}).click();await panel.getByRole('button',{name:c.retry,exact:true}).waitFor();assert.equal(await panel.getByLabel(c.doc).isDisabled(),true);await check('save-unknown',panel);
  await panel.getByRole('button',{name:c.retry,exact:true}).click();await panel.getByRole('button',{name:c.edit,exact:true}).waitFor();await check('english-current',panel);
  assert.equal(startBodies.length,2);assert.equal(saveBodies.length,2);
  // A separately labeled synthetic ready packet rehearses review/Submit only; no real private route is enabled.
  request={...request,version:4,required_actions:[{id:'synthetic-ready-review',need:'snap_new',field:'snap_final_submit',reason:'submission_review',resolver:'parent',title:'Synthetic exact-packet review',explanation:'Fixture-only readiness; no actual personal acts or agency connection is established.'}]};
  saved=snapshot(saved.details,ES,3);records.set(saved.id,saved);
  const template=await readFile('data/verified-forms/snap-pa600fs-es-2019.pdf'),preparedAt=new Date(saved.created_at),unsigned=(await renderSnapSigningCopy(template,saved.details,preparedAt,ES)).bytes;
  const binding={requestVersion:request.version,snapshotId:saved.id,snapshotHash:'a'.repeat(64),source:saved.source,applyingSubjectIds:saved.details.household.filter(p=>p.requestingSnap).map(p=>p.id)},trusted={requestId,context:binding,snapshot:saved,preparedAt:saved.created_at,unsignedContentSha256:sha(unsigned)};
  const completion={requestId,requestVersion:request.version,snapshotId:saved.id,snapshotHash:binding.snapshotHash,source:saved.source,unsignedContentSha256:trusted.unsignedContentSha256,signingRoute:'applicant_name_handwriting',identifiers:binding.applyingSubjectIds.map(personId=>({personId,kind:'provide_to_agency_later'})),certifications:['applicant_signature_printed_page_1','rights_certification_printed_page_5'].map((actId,i)=>{const started=new Date(preparedAt.getTime()+10000+i*20000),completed=new Date(started.getTime()+10000);return {actId,provenance:'caller_reported_fresh_parent_drawing',startedAt:started.toISOString(),completedAt:completed.toISOString(),date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(completed),strokes:[[{x:.05,y:.2},{x:.35,y:.65},{x:.95,y:.8}]]};})};
  const rendered=await completionRenderer.renderSnapDirectCompletion(template,trusted,completion,new Date());assert.ok(rendered.bytes);finalBytes=rendered.bytes;if(locale==='es'&&width===1280)await writeFile(`${evidence}/synthetic-es-review.pdf`,finalBytes);
  const base=fixtureProtectedSnapOperation();finalReview={...base,requestId,requestVersion:request.version,packet:{protectedSnapPacket:{...base.packet.protectedSnapPacket,snapshotId:saved.id,contentSha256:sha(finalBytes),byteLength:finalBytes.length}},snapSubmissionAuthorized:false};
  await page.reload({waitUntil:'networkidle'});if(large)await page.addStyleTag({content:'html{font-size:200%}'});
  await page.getByRole('navigation',{name:locale==='es'?'Lista de pasos de su solicitud':'Your application checklist'}).getByRole('link',{name:c.app}).click();
  const review=page.locator('#snap-final-review');await review.getByRole('button',{name:c.submit,exact:true}).waitFor();assert.equal(submitCount,0);
  for(let n=2;n<=7;n++){
   await review.getByRole('button',{name:c.nextPage,exact:true}).click();
   try { await review.getByRole('img',{name:c.image(n),exact:true}).waitFor(); }
   catch(error){
    await review.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/${suffix}-page-${n}-render-failure.png`});
    await writeFile(`${evidence}/${suffix}-page-${n}-render-failure.json`,JSON.stringify({page:n,text:(await review.innerText()).slice(0,4000),errors,consoleErrors},null,2));
    throw error;
   }
   if(n===3||n===7)await check(`exact-review-page-${n}`,review);
  }
  await review.getByRole('button',{name:c.submit,exact:true}).click();await review.getByText(c.recorded).waitFor();assert.equal(submitCount,1);await check('submit-decision',review);
  await context.close();
 }
}finally{await browser.close();}
await writeFile(`${evidence}/results.json`,JSON.stringify(results,null,2));console.log(`SNAP document source: ${results.length} bilingual form, mandate, immutable-choice retry and actual unsigned-PDF browser checkpoints passed. Synthetic HTTP only; no Auth, model, protected capture, sending or agency outcome.`);
