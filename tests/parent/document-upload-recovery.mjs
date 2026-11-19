/** Real built UI; explicitly synthetic Auth/HTTP receipts and file bytes. No provider or Storage integration claim. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const origin=process.env.PARENT_RECOVERY_ORIGIN??'http://127.0.0.1:3304';
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const evidence='tmp/parent-verification/document-upload-recovery/browser',id='11111111-1111-4111-8111-111111111111';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true}),results=[];
try {
for(const locale of ['en','es']) for(const view of [{width:320,font:100},{width:390,font:100},{width:1280,font:100},{width:320,font:200}]){
  const context=await browser.newContext({viewport:{width:view.width,height:900}}),page=await context.newPage();
  await context.addCookies([{name:'caselink-parent-ui-locale',value:locale,url:origin}]);
  const copy=locale==='es'?{add:'Añadir un documento o tomar una foto',choose:'Elegir una factura o un aviso',camera:'Tomar una foto',upload:'Cargar de forma privada',saved:'El documento se guardó de forma privada',alreadySaved:'La carga original ya estaba guardada. No se añadió ningún archivo nuevo.',retry:'Reintentar esta carga',pending:'Carga sin confirmar',check:'Verificar la carga',original:'Elija el archivo original'}:{add:'Add a document or take a photo',choose:'Choose a bill or notice',camera:'Take a photo',upload:'Upload privately',saved:'Document saved privately',alreadySaved:'The original upload was already saved. No new file was added.',retry:'Retry this upload',pending:'Upload not confirmed',check:'Check upload',original:'Choose the original file'};
  page.setDefaultTimeout(10000);const errors=[],posts=[],confirms=[];let documents=[],mode='lost_ack',closed=false;
  const now=new Date().toISOString(),expires=new Date(Date.now()+604800000).toISOString();
  const support=()=>({id,version:1,status:closed?'closed':'active',intake:{needs:['food_now'],urgency:'today',zip:'19104',language:'en',householdSize:null,childrenUnderFive:null,pregnantOrPostpartum:null,incomeAmount:null,incomeFrequency:'unknown',utilityProviders:[],shutoffDate:null,accountAuthority:'self',contactPreference:'in_app',adultConfirmed:true},mandate:{version:1,mode:'prepare_only',recipientIds:['philly-food'],allowedActions:['research','prepare'],allowedData:['household','documents'],expiresAt:expires,maxAttempts:12,maxRecipients:1,bookingPreference:'ask_me',accepted:true},plan:null,required_actions:[],documents,events:[],created_at:now,updated_at:now,closed_at:closed?now:null,closure_reason:closed?'unresolved':null,has_peco_application_details:false,has_pgw_application_details:false,has_water_application_details:false});
  const receipt=document=>({state:document.upload_confirmed_at?'confirmed':'pending',document:{...document,upload_key:document.upload_key??document.id}});
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(url.origin==='http://127.0.0.1:55321')return route.fulfill({status:401,contentType:'application/json',body:'{}'});return route.abort();});
  await page.route('**/api/parent/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Cache-Control':'private, no-store'},body:JSON.stringify(body)});
    if(path===`/api/parent/requests/${id}/documents`&&method==='POST'){
      assert.equal(closed,false);const key=request.headers()['idempotency-key'];assert.match(key,/^[0-9a-f-]{36}$/);
      assert.ok(request.postDataBuffer()?.includes(Buffer.from('SYNTHETIC ORIGINAL FILE')));posts.push({key,body:request.postDataBuffer()});
      let document=documents.find(value=>value.upload_key===key || value.id===key && value.upload_key===null);
      if(!document){document={id:crypto.randomUUID(),request_id:id,filename:'Aviso de José.pdf',media_type:'application/pdf',size_bytes:23,status:'uploaded',expires_at:expires,created_at:now,upload_key:key,upload_confirmed_at:null};documents.push(document);}
      if(mode==='completed_before_retry'){document.upload_confirmed_at=now;return json({ok:false,error:'This request is unavailable, or its permission has changed.'},403);}
      document.upload_key=key;
      if(mode==='pending')return json({ok:false,error:'The upload result is not confirmed. Check its status before sending another copy.',receipt:receipt(document)},503);
      document.upload_confirmed_at=now;
      if(mode==='lost_ack'){mode='saved';return route.abort('connectionreset');}
      return json({ok:true,receipt:receipt(document),document},201);
    }
    if(path===`/api/parent/requests/${id}/documents`&&url.searchParams.has('uploadKey')){const document=documents.find(value=>value.upload_key===url.searchParams.get('uploadKey') || value.id===url.searchParams.get('uploadKey') && value.upload_key===null);return document?json({ok:true,receipt:receipt(document)}):json({ok:false,error:'This upload is unavailable.'},404);}
    if(path.startsWith(`/api/parent/requests/${id}/documents/`)){
      const document=documents.find(value=>value.id===path.split('/').at(-1));assert.ok(document);
      if(method==='POST'){assert.equal(closed,false);assert.equal(request.postDataJSON().uploadKey,(document.upload_key??document.id));confirms.push(document.id);if(mode!=='pending')document.upload_confirmed_at=now;return json({ok:true,receipt:receipt(document)},document.upload_confirmed_at?200:202);}
      assert.equal(method,'DELETE');documents=documents.filter(value=>value!==document);return json({ok:true});
    }
    assert.equal(method,'GET');
    if(path==='/api/parent/account')return json({account:{id,email:'synthetic@example.invalid',preferences:{language:'en',contactPreference:'in_app'}}});
    if(path==='/api/parent/requests')return json({requests:[support()],progress:{}});
    if(path===`/api/parent/requests/${id}`)return json({request:support(),progress:{state:'waiting',summary:'Synthetic document recovery fixture',updatedAt:now,nextRunAt:null,canContinueAfterClosing:false}});
    if(path.endsWith('/operations'))return json({operations:[],historyLimited:false});
    if(path==='/api/parent/food-sites')return json({sites:[],sourceUrl:'https://www.phila.gov/food/',checkedAt:now,availability:'city_listed_unconfirmed',moreSitesAvailable:false});
    return json({capabilities:[]});
  });
  async function open(){await page.goto(`${origin}/support/${id}`,{waitUntil:'networkidle'});await page.evaluate(font=>document.documentElement.style.fontSize=`${font}%`,view.font);await page.getByText('Your documents',{exact:true}).click();}
  const section=page.locator('#application-documents');
  async function picture(state){await section.scrollIntoViewIfNeeded();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);const axe=await new AxeBuilder({page}).include('#application-documents').analyze();assert.deepEqual(axe.violations,[]);const broken=await section.locator('p,label span,button,summary').evaluateAll(elements=>elements.flatMap(element=>{if(!element.checkVisibility())return[];const words=[],walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);for(let node=walker.nextNode();node;node=walker.nextNode()){if(node.parentElement.closest('strong'))continue;for(const word of node.textContent.matchAll(/\p{L}{4,}/gu)){const range=document.createRange();range.setStart(node,word.index);range.setEnd(node,word.index+word[0].length);if(range.getClientRects().length>1)words.push(word[0]);}}return words;}));assert.deepEqual(broken,[],`${state} ${locale} ordinary words stay readable`);const file=`${evidence}/${state}-${locale}-${view.width}-${view.font}.png`;await page.screenshot({path:file,fullPage:state==='return-pending'});results.push({state,locale,...view,axe:0,overflow:false,file});}
  const file={name:'Aviso de José.pdf',mimeType:'application/pdf',buffer:Buffer.from('SYNTHETIC ORIGINAL FILE')};
  async function choose(){await section.getByText(copy.add,{exact:true}).click();await section.getByRole('checkbox').check();await section.getByLabel(copy.choose,{exact:true}).setInputFiles(file);}
  try{
    await open();await choose();await section.getByRole('button',{name:copy.upload,exact:true}).click();await section.getByRole('status').filter({hasText:copy.saved}).waitFor();assert.equal(posts.length,1);assert.equal(documents.length,1);await picture('lost-ack-reconciled');
    // A different synthetic document is deliberately left pending by the server fixture.
    mode='pending';await section.getByRole('checkbox').check();await section.getByLabel(copy.choose,{exact:true}).setInputFiles(file);await section.getByRole('button',{name:copy.upload,exact:true}).click();await section.getByRole('button',{name:copy.retry,exact:true}).waitFor();assert.equal(await section.getByLabel(copy.choose,{exact:true}).isDisabled(),true);const pending=documents[1];assert.ok(pending);const original={...pending};await picture('unfinished-transfer');
    mode='saved';await section.getByRole('button',{name:copy.retry,exact:true}).click();await section.getByRole('status').filter({hasText:copy.saved}).waitFor();assert.equal(posts.length,3);assert.equal(posts[1].key,posts[2].key);assert.equal(documents.length,2);assert.equal(pending.created_at,original.created_at);assert.equal(pending.expires_at,original.expires_at);await picture('exact-retry');
    pending.upload_confirmed_at=null;await open();await section.getByText(copy.pending,{exact:true}).waitFor();await picture('return-pending');mode='saved';await section.getByRole('button',{name:`${copy.check} Aviso de José.pdf`,exact:true}).click();await section.getByRole('status').filter({hasText:copy.saved}).waitFor();assert.equal(confirms.length,1);assert.equal(posts.length,3);await picture('return-confirmed');
    pending.upload_confirmed_at=null;mode='pending';await open();await section.getByRole('button',{name:`${copy.check} Aviso de José.pdf`,exact:true}).click();await section.getByRole('status').filter({hasText:copy.original}).waitFor();assert.equal(await section.getByRole('checkbox').isChecked(),true);assert.equal(await section.getByRole('checkbox').isDisabled(),true);assert.equal(await section.getByLabel(copy.camera,{exact:true}).isDisabled(),true);await picture('original-file-needed');
    closed=true;await open();assert.equal(await section.locator('details,input[type=file]').count(),0);assert.equal(await section.getByRole('button',{name:new RegExp(copy.check)}).count(),0);await picture('closed-pending');
    closed=false;mode='saved';const legacy={...pending,id:crypto.randomUUID(),upload_key:null,upload_confirmed_at:null};documents=[legacy];await open();await section.getByText(copy.pending,{exact:true}).waitFor();await picture('legacy-pending');const beforeLegacyPosts=posts.length;await section.getByRole('button',{name:`${copy.check} Aviso de José.pdf`,exact:true}).click();await section.getByRole('status').filter({hasText:copy.saved}).waitFor();assert.equal(posts.length,beforeLegacyPosts);assert.equal(legacy.upload_key,null);await picture('legacy-stored-confirmed');
    mode='pending';const missingLegacy={...legacy,id:crypto.randomUUID(),upload_confirmed_at:null};documents=[missingLegacy];await open();await section.getByRole('button',{name:`${copy.check} Aviso de José.pdf`,exact:true}).click();await section.getByRole('status').filter({hasText:copy.original}).waitFor();assert.equal(await section.getByRole('checkbox').isChecked(),true);assert.equal(await section.getByRole('checkbox').isDisabled(),true);await picture('legacy-original-needed');await section.getByLabel(copy.choose,{exact:true}).setInputFiles(file);mode='saved';await section.getByRole('button',{name:copy.upload,exact:true}).click();await section.getByRole('status').filter({hasText:copy.saved}).waitFor();assert.equal(posts.at(-1).key,missingLegacy.id);assert.equal(documents.length,1);assert.equal(documents[0].id,missingLegacy.id);assert.equal(documents[0].expires_at,expires);assert.equal(documents[0].created_at,now);await picture('legacy-resumed');
    const racingLegacy={...missingLegacy,id:crypto.randomUUID(),upload_key:null,upload_confirmed_at:null};documents=[racingLegacy];mode='pending';await open();await section.getByRole('button',{name:`${copy.check} Aviso de José.pdf`,exact:true}).click();await section.getByRole('status').filter({hasText:copy.original}).waitFor();await section.getByLabel(copy.choose,{exact:true}).setInputFiles(file);const beforeRacePosts=posts.length;mode='completed_before_retry';await section.getByRole('button',{name:copy.upload,exact:true}).click();await section.getByRole('status').filter({hasText:copy.alreadySaved}).waitFor();assert.equal(posts.length,beforeRacePosts+1);assert.equal(documents.length,1);assert.equal(racingLegacy.upload_key,null);assert.equal(await section.locator('input[type=file]').count(),0);await picture('legacy-completed-before-resend');assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
await writeFile(`${evidence}/results.json`,JSON.stringify({kind:'Built UI with synthetic Auth/HTTP/file fixtures only; actual handler/data/SQL covered separately',origin,checks:results},null,2)+'\n');console.log(JSON.stringify({checks:results.length,evidence}));
}finally{await browser.close();}
