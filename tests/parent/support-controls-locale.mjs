import { chooseScreenLanguage } from "./screen-language.mjs";
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixtures from '../../src/lib/parent/test-fixtures.ts';
const { fixtureIntake, fixtureMandate, fixtureRequest } = fixtures;
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3308';
const url = new URL(origin), evidence = 'tmp/parent-verification/support-controls-locale/browser';
assert.ok(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.origin === origin && !url.username && !url.password);
const requestId = 'd430cc02-d8d4-46cc-9900-5b397758fb16';
const stale = '2026-01-01T00:00:00Z';
const changed = 'This request changed. Reload it before saving your correction so newer information stays safe.';
const copy = {
  en: { group: 'Household questions', save: 'Save all answers and continue', empty: 'Enter at least one answer before saving.', partial: 'Enter both the income amount and frequency', frequency: 'How often is this income received?', saved: 'Your provided answers are saved. Unanswered questions stay open; other permitted work can continue.', latest: 'Review latest questions', draft: 'Your draft is still here.', permission: 'Change or renew permission', only: 'Prepare only', accept: /I authorize these programs, actions and information for up to 30 days/, permissionSave: 'Save updated permission', keep: 'Keep existing permission', saving: 'Saving…', permissionSaved: 'Your updated permission is saved.', documents: 'Consented documents and extracted facts', correctionSave: 'Save account answer', bookingSave: 'Save and continue', bookingLabel: 'Preferred appointment window' },
  es: { group: 'Preguntas del hogar', save: 'Guardar todas las respuestas y continuar', empty: 'Ingrese al menos una respuesta antes de guardar.', partial: 'Ingrese tanto la cantidad de ingresos como la frecuencia', frequency: '¿Con qué frecuencia recibe estos ingresos?', saved: 'Las respuestas que proporcionó están guardadas. Las preguntas sin responder siguen abiertas; el resto del trabajo permitido puede continuar.', latest: 'Revisar las preguntas más recientes', draft: 'Su borrador sigue aquí.', permission: 'Cambiar o renovar el permiso', only: 'Solo preparar', accept: /Autorizo estos programas, acciones e información por hasta 30 días/, permissionSave: 'Guardar el permiso actualizado', keep: 'Mantener el permiso existente', saving: 'Guardando…', permissionSaved: 'Su permiso actualizado está guardado.', documents: 'Documentos autorizados y datos extraídos', correctionSave: 'Guardar respuesta de la cuenta', bookingSave: 'Guardar y continuar', bookingLabel: 'Horario preferido para la cita' },
};
const question = (field, title) => ({ id: `fixture-${field}`, need: 'snap_pending', field, reason: 'missing_fact', resolver: 'parent', title, explanation: 'Enter a current fact you know. This does not sign a form or certify an agency declaration.' });
const initialQuestions = () => [question('zip', 'Household ZIP code'), question('householdSize', 'Household size'), question('income', 'Household income')];
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true }), results = [], keyboardChecks = [];
try {
  for (const locale of ['en', 'es']) for (const width of [320, 390, 1280]) for (const largeText of [false, true]) {
    if (process.argv.includes('--large-mobile-only') && (width !== 320 || !largeText)) continue;
    if (process.argv.includes('--desktop-only') && width !== 1280) continue;
    const c = copy[locale], suffix = `${locale}-${width}${largeText ? '-large-text' : ''}`;
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    const errors = [], blockedOrigins = [], writes = [];
    let questions = initialQuestions(), version = 1, mode = 'group', saveMode = 'success', readFails = false, ownedReadDenied = 0, releaseSave;
    const receipts = new Map(), attempts = [];
    const ownerId = '11111111-1111-4111-8111-111111111111';
    let mandate = fixtureMandate({ recipientIds: ['snap-pa'], expiresAt: new Date(Date.now() + 86400000).toISOString(), maxRecipients: 1 });
    const current = () => fixtureRequest({ id: requestId, version, status: mode === 'correction' ? 'paused' : 'active', intake: fixtureIntake({ needs: mode === 'correction' ? ['electricity'] : mode === 'booking' ? ['food_now'] : ['snap_pending'], utilityProviders: mode === 'correction' ? ['peco'] : [], householdSize: null }), mandate,
      intake_confirmed_at: { zip: stale, householdSize: stale, incomeAmount: stale, incomeFrequency: stale }, required_actions: questions });
    await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      if (target.origin === origin) return route.continue();
      if (target.origin === 'http://127.0.0.1:55321') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Synthetic Auth; no live service."}' });
      blockedOrigins.push(target.origin); return route.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/parent/**', async route => {
      const target = new URL(route.request().url()), path = target.pathname, method = route.request().method();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: JSON.stringify(body) });
      if (path === '/api/parent/account') return json({ account: { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.invalid', preferences: { language: 'en', contactPreference: 'in_app' } } });
      if (path === '/api/parent/authorization-window') return json({ authorization: { expiresAt: new Date(Date.now() + 86400000).toISOString() } });
      if (path === `/api/parent/requests/${requestId}` && method === 'POST') {
        const body = route.request().postDataJSON(), key = route.request().headers()['idempotency-key'];
        assert.match(key, /^[0-9a-f-]{36}$/i); attempts.push({ key, bytes: route.request().postData() });
        const known = receipts.get(key);
        if (known) { assert.equal(known.bytes, route.request().postData()); return json({ update: { ownerId, receipt: known.receipt } }); }
        writes.push(body); assert.equal(body.version, version);
        assert.ok(['answer_facts', 'answer_fact', 'replace_mandate', 'booking_preference'].includes(body.action));
        if (saveMode === 'pending') await new Promise(resolve => { releaseSave = resolve; });
        if (saveMode === 'conflict') { version++; return json({ ok: false, error: changed }, 409); }
        if (saveMode === 'unknown') return json({ ok: false, error: 'Unrecognized synthetic service issue' }, 503);
        version += body.action === 'answer_facts' ? body.answers.length : 1;
        if (body.action === 'answer_facts') questions = questions.filter(action => !body.answers.some(answer => answer.field === action.field));
        if (body.action === 'replace_mandate') mandate = body.mandate;
        if (body.action === 'booking_preference') mandate = { ...mandate, bookingPreference: body.preference };
        const receipt = { id: randomUUID(), key, requestId, action: body.action, baseVersion: body.version, resultVersion: version, recordedAt: new Date().toISOString() };
        receipts.set(key, { receipt, bytes: route.request().postData() });
        if (saveMode === 'post_then_forbidden') { ownedReadDenied = 403; saveMode = 'success'; }
        if (saveMode === 'lost_ack') { saveMode = 'success'; return json({ ok: false, error: 'Unrecognized synthetic service issue' }, 503); }
        return json({ update: { ownerId, receipt } });
      }
      assert.equal(method, 'GET', 'Only explicit synthetic control actions are allowed.');
      if (path.endsWith('/operations')) return json({ operations: [], historyLimited: false });
      if (path === `/api/parent/requests/${requestId}` && ownedReadDenied) return json({ ok: false, error: 'This support request is unavailable, or its permission has changed.' }, ownedReadDenied);
      if (path === `/api/parent/requests/${requestId}`) return readFails ? json({ ok: false, error: 'We couldn’t load the latest questions. Your draft is still here.' }, 503) : json({ request: current(), ...(target.searchParams.has('updateKey') ? { update: { ownerId, receipt: receipts.get(target.searchParams.get('updateKey'))?.receipt ?? null, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+86400000).toISOString() } } : {}), progress: { state: 'waiting', summary: 'Synthetic controls only; no real program or model work.', canContinueAfterClosing: false, nextRunAt: null } });
      if (path === '/api/parent/food-sites') return json({ sites: [], sourceUrl: 'https://www.phila.gov/food/', checkedAt: new Date().toISOString(), availability: 'city_listed_unconfirmed', moreSitesAvailable: false });
      return json({ capabilities: [] });
    });
    async function scale() {
      if(largeText){await page.addStyleTag({content:'html { font-size: 200%; }'});await page.evaluate(()=>{document.querySelector('main').parentElement.style.fontSize='32px';});}
      assert.equal(await page.locator('main').evaluate(element=>getComputedStyle(element).fontSize),largeText?'32px':'16px');
    }
    async function open(section) {
      await page.goto('about:blank'); // Fixture phase changes must load a fresh document, not only change the hash.
      await page.goto(`${origin}/support/${requestId}#${section}`, { waitUntil: 'networkidle' });
      await scale();await page.waitForFunction(()=>document.title==='Your support | CaseLink');
      await page.locator(`#${section}`).waitFor({ state: 'visible' });
      await page.evaluate(() => { const note = document.createElement('aside'); note.lang = 'en'; note.textContent = 'Synthetic controls rehearsal: no real account, program, permission or model is connected.'; document.body.prepend(note); });
    }
    async function check(scope, name) {
      console.log(JSON.stringify({ checking: name, locale, width, largeText }));
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      assert.equal(await page.locator('main').evaluate(element=>getComputedStyle(element).fontSize),largeText?'32px':'16px');
      const findings = await scope.locator('button,label,p,h3,legend').evaluateAll(elements => elements.flatMap(element => {
        if (!element.checkVisibility()) return [];
        const issues = [], box = element.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element); const text = range.getBoundingClientRect();
        if (text.width > 0 && (text.left < box.left - 2 || text.right > box.right + 2)) issues.push(`clipped:${element.textContent}`);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const word of node.textContent.matchAll(/\p{L}{4,}/gu)) {
          const r = document.createRange(); r.setStart(node, word.index); r.setEnd(node, word.index + word[0].length);
          if (r.getClientRects().length > 1) issues.push(`fractured:${word[0]}`);
        }
        return issues;
      }));
      await scope.scrollIntoViewIfNeeded();
      const screenshot = `${evidence}/${name}-${suffix}.png`; await page.screenshot({ path: screenshot, fullPage: true });
      const viewportScreenshot = `${evidence}/${name}-${suffix}-viewport.png`; await page.screenshot({ path: viewportScreenshot });
      assert.deepEqual([...new Set(findings)], [], `${name}/${suffix} readable controls`);
      const clippedChoices=await scope.locator('select').evaluateAll(selects=>selects.filter(select=>{
        if(!select.checkVisibility()||!select.value)return false;
        const selected=select.selectedOptions[0]?.textContent??'',style=getComputedStyle(select),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=style.font;
        const available=select.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-24;
        if(context.measureText(selected).width<=available)return false;
        return !(select.getAttribute('aria-describedby')??'').split(/\s+/).some(id=>document.getElementById(id)?.textContent===selected);
      }).map(select=>select.selectedOptions[0]?.textContent));
      assert.deepEqual(clippedChoices,[],`${name}/${suffix} full selected choices must remain readable beside a clipped native select`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}/${suffix} page overflow`);
      assert.ok(await scope.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name}/${suffix} scope overflow`);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), [], `${name}/${suffix} accessibility`);
      results.push({ name, locale, width, largeText, screenshot, viewportScreenshot, axeViolations: 0 });
    }
    try {
      await open('your-next-steps');
      let group = page.getByRole('form', { name: c.group }); await group.waitFor();
      await check(group, 'questions-empty');
      const before = writes.length; await group.getByRole('button', { name: c.save, exact: true }).focus(); await page.keyboard.press('Enter');
      await group.getByRole('alert').filter({ hasText: c.empty }).waitFor(); assert.equal(writes.length, before); await check(group, 'questions-empty-error');
      await group.locator('#answer-fixture-income').fill('0'); await group.getByRole('button', { name: c.save, exact: true }).click();
      await group.getByRole('alert').filter({ hasText: c.partial }).waitFor(); assert.equal(await group.locator('#frequency-fixture-income').evaluate(element => element === document.activeElement), true); await check(group, 'questions-partial-income');
      await group.getByLabel(c.frequency, { exact: true }).selectOption('biweekly');
      await check(group, 'questions-selected-frequency');
      saveMode = 'pending'; await group.getByRole('button', { name: c.save, exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('form[aria-label] button')].some(button => button.disabled));
      if(width===1280){
        const scroller=page.locator('[data-workspace-panel="your-next-steps"]').locator('..');await scroller.evaluate(element=>{element.scrollTop=0;});
        await page.keyboard.press('Tab');await scroller.focus();
        const outline=await scroller.evaluate(element=>({style:getComputedStyle(element).outlineStyle,width:parseFloat(getComputedStyle(element).outlineWidth)}));
        assert.notEqual(outline.style,'none');assert.ok(outline.width>0,'The focused scrollable workspace has a visible native outline.');
        await page.keyboard.press('PageDown');await page.waitForFunction(()=>document.querySelector('[data-workspace-panel="your-next-steps"]').parentElement.scrollTop>0);
        keyboardChecks.push({locale,width,largeText,scrollTop:await scroller.evaluate(element=>element.scrollTop),outline});
      }
      await check(group, 'questions-pending'); assert.equal(typeof releaseSave, 'function'); saveMode = 'success'; releaseSave(); releaseSave = undefined;
      await group.getByRole('status').filter({ hasText: c.saved }).waitFor();
      assert.deepEqual(writes.at(-1).answers, [{ need: 'snap_pending', field: 'income', value: { amount: 0, frequency: 'biweekly' } }]); await check(group, 'questions-partial-saved');
      await group.locator('#answer-fixture-zip').fill('19129'); saveMode = 'conflict'; await group.getByRole('button', { name: c.save, exact: true }).click();
      await group.getByRole('alert').waitFor(); assert.equal(await group.locator('#answer-fixture-zip').inputValue(), '19129'); await check(group, 'questions-conflict');
      if(width===320&&largeText){
        const other=locale==='en'?'es':'en',before=writes.length;
        const refreshed=page.waitForResponse(response=>response.request().headers().rsc==='1'&&new URL(response.url()).pathname===`/support/${requestId}`);
        await chooseScreenLanguage(page, other);await refreshed;await page.waitForLoadState('networkidle');await page.waitForFunction(()=>document.title==='Your support | CaseLink');await scale();await page.waitForFunction(value=>document.documentElement.lang===value,other);
        const switched=page.getByRole('form',{name:copy[other].group});await switched.getByRole('alert').waitFor();assert.equal(await switched.locator('#answer-fixture-zip').inputValue(),'19129');assert.equal(writes.length,before);
        const restored=page.waitForResponse(response=>response.request().headers().rsc==='1'&&new URL(response.url()).pathname===`/support/${requestId}`);
        await chooseScreenLanguage(page, locale);await restored;await page.waitForLoadState('networkidle');await page.waitForFunction(()=>document.title==='Your support | CaseLink');await scale();await page.waitForFunction(value=>document.documentElement.lang===value,locale);
        group=page.getByRole('form',{name:c.group});assert.equal(await group.locator('#answer-fixture-zip').inputValue(),'19129');assert.equal(writes.length,before);
      }
      readFails = true; await group.getByRole('button', { name: c.latest, exact: true }).click();
      await group.getByRole('alert').filter({ hasText: c.draft }).waitFor(); assert.equal(await group.locator('#answer-fixture-zip').inputValue(), '19129'); await check(group, 'questions-read-failure');
      readFails = false; saveMode = 'success'; await group.getByRole('button', { name: c.latest, exact: true }).click();
      await group.getByRole('status').waitFor(); assert.equal(await group.locator('#answer-fixture-zip').inputValue(), ''); await check(group, 'questions-latest');
      await open('application-controls');
      let controls = page.locator('#application-controls'), editor = controls.locator('div[lang]').filter({ has: page.getByRole('button', { name: c.permission, exact: true }) }).last();
      await controls.getByRole('button', { name: c.permission, exact: true }).focus(); await page.keyboard.press('Enter');
      editor = controls.locator('form').filter({ has: page.getByRole('checkbox', { name: c.accept }) });
      await editor.waitFor(); assert.equal(await editor.locator('input').first().evaluate(element => element === document.activeElement), true); await check(editor, 'permission-open');
      await editor.getByRole('radio', { name: new RegExp(c.only) }).check();
      await editor.getByLabel(c.documents, { exact: true }).uncheck();
      await editor.getByLabel(c.accept).focus(); await page.keyboard.press('Space');
      await check(editor, 'permission-selected'); saveMode = 'pending'; await editor.getByRole('button', { name: c.permissionSave, exact: true }).click();
      await editor.getByRole('button', { name: c.saving, exact: true }).waitFor(); await check(editor, 'permission-pending');
      assert.equal(typeof releaseSave, 'function'); saveMode = 'conflict'; releaseSave(); releaseSave = undefined;
      await controls.getByRole('alert').waitFor(); await check(editor.locator('..'), 'permission-conflict');
      assert.equal(await editor.getByLabel(c.accept).isChecked(), true); assert.equal(await editor.getByRole('radio', { name: new RegExp(c.only) }).isChecked(), true);
      saveMode = 'success'; await controls.getByRole('button', { name: locale === 'es' ? 'Revisar la información guardada actual' : 'Review current saved information', exact: true }).click();
      await controls.getByRole('button', { name: locale === 'es' ? 'Revisar la información guardada actual' : 'Review current saved information', exact: true }).waitFor({ state: 'hidden' });
      await editor.getByRole('radio', { name: new RegExp(c.only) }).check(); await editor.getByLabel(c.documents, { exact: true }).uncheck(); await editor.getByLabel(c.accept).check();
      await editor.getByRole('button', { name: c.permissionSave, exact: true }).click();
      await controls.getByRole('status').filter({ hasText: c.permissionSaved }).waitFor();
      assert.deepEqual(writes.at(-1).mandate.allowedActions, ['research', 'prepare']); assert.ok(!writes.at(-1).mandate.allowedData.includes('documents'));
      editor = controls.getByRole('button', { name: c.permission, exact: true }).locator('..'); await check(editor, 'permission-saved');
      await controls.getByRole('button', { name: c.permission, exact: true }).click();
      editor = controls.locator('form').filter({ has: page.getByRole('checkbox', { name: c.accept }) });
      assert.equal(await editor.getByRole('radio', { name: new RegExp(c.only) }).isChecked(), true); assert.equal(await editor.getByLabel(c.accept).isChecked(), false);
      await editor.getByRole('button', { name: c.keep, exact: true }).click();
      assert.equal(await controls.getByRole('button', { name: c.permission, exact: true }).count(), 1);
      await controls.getByRole('button',{name:c.permission,exact:true}).click();editor=controls.locator('form').filter({has:page.getByRole('checkbox',{name:c.accept})});
      await editor.getByLabel(c.accept).check();saveMode='unknown';await editor.getByRole('button',{name:c.permissionSave,exact:true}).click();
      await controls.getByRole('alert').filter({hasText:'Unrecognized synthetic service issue'}).waitFor();assert.equal(await controls.getByRole('alert').locator('span[lang]').getAttribute('lang'),'');await check(editor.locator('..'),'permission-unknown-display');
      await editor.getByRole('button',{name:locale==='es'?'Cerrar el editor; se sigue comprobando este cambio':'Close editor; this save is still being checked',exact:true}).click();
      await controls.getByRole('button',{name:c.permission,exact:true}).click(); assert.equal(await editor.getByLabel(c.accept).isDisabled(),true);
      await check(editor.locator('..'),'permission-unknown-reopened');
      await open('application-controls'); controls=page.locator('#application-controls'); await controls.getByRole('button',{name:c.permission,exact:true}).click();
      editor=controls.locator('form').filter({has:page.getByRole('checkbox',{name:c.accept})});await editor.getByLabel(c.accept).check();saveMode='lost_ack';
      const beforeLost=writes.length;await editor.getByRole('button',{name:c.permissionSave,exact:true}).click();
      await controls.getByRole('alert').waitFor();await check(editor.locator('..'),'permission-committed-unknown');
      await controls.getByRole('button',{name:locale==='es'?'Comprobar el resultado guardado':'Check saved result',exact:true}).click();
      await controls.getByRole('status').filter({hasText:c.permissionSaved}).waitFor();assert.equal(writes.length,beforeLost+1);assert.deepEqual(attempts.at(-1),attempts.at(-2));
      await check(controls.getByRole('button',{name:c.permission,exact:true}).locator('..'),'permission-reconciled-exact');
      mode='correction';questions=[];saveMode='success';version++;mandate=fixtureMandate({recipientIds:['peco-cap'],expiresAt:new Date(Date.now()+86400000).toISOString(),maxRecipients:1});
      await open('application-controls');controls=page.locator('#application-controls');await controls.getByText('Review or correct account answers',{exact:true}).click();
      const correction=controls.locator('form').filter({has:page.getByRole('button',{name:c.correctionSave,exact:true})});
      await correction.getByLabel('Amount due ($)',{exact:true}).fill('0');await check(correction,'correction-zero');
      saveMode='conflict';await correction.getByRole('button',{name:c.correctionSave,exact:true}).click();await correction.getByRole('alert').waitFor();assert.equal(await correction.getByLabel('Amount due ($)',{exact:true}).inputValue(),'0');await check(correction,'correction-conflict');
      saveMode='success';await correction.getByRole('button',{name:locale==='es'?'Revisar la pregunta más reciente':'Review latest question',exact:true}).click();
      await correction.getByLabel('Amount due ($)',{exact:true}).fill('0');await correction.getByRole('button',{name:c.correctionSave,exact:true}).click();
      await correction.getByRole('status').waitFor();assert.deepEqual(writes.at(-1),{action:'answer_fact',need:'electricity',field:'amountDue',value:0,version:version-1});assert.equal(current().status,'paused');
      assert.ok((await correction.getByRole('status').innerText()).includes(locale==='es'?'sigue en pausa':'remains paused'));await check(correction,'correction-saved-paused');
      await correction.getByLabel('Amount due ($)',{exact:true}).fill('867.53');saveMode='post_then_forbidden';
      const deniedRead=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/parent/requests/${requestId}`&&new URL(response.url()).searchParams.has('updateKey')&&response.status()===403);
      await correction.getByRole('button',{name:c.correctionSave,exact:true}).click();await deniedRead;
      await page.waitForFunction(()=>![...document.querySelectorAll('input')].some(input=>input.value==='867.53'));
      assert.equal(await page.locator('input').evaluateAll(inputs=>inputs.some(input=>input.value==='867.53')),false);
      await page.getByRole('alert').first().waitFor();await check(page.getByRole('alert').first().locator('..'),'correction-access-lost');
      ownedReadDenied=0;mode='booking';version++;mandate=fixtureMandate({recipientIds:['philly-food'],bookingPreference:'ask_me',expiresAt:new Date(Date.now()+86400000).toISOString(),maxRecipients:1});
      questions=[{id:'fixture-booking',need:'food_now',reason:'meaningful_choice',resolver:'parent',field:'bookingPreference',title:'Choose an appointment time',explanation:'A confirmed appointment choice is required before booking. Other permitted preparation can continue.'}];
      await open('your-next-steps');const booking=page.locator('#your-next-steps form');await booking.getByLabel(c.bookingLabel,{exact:true}).selectOption('weekday_afternoon');await check(booking,'booking-choice');
      await booking.getByRole('button',{name:c.bookingSave,exact:true}).click();await booking.getByRole('status').waitFor();assert.deepEqual(writes.at(-1),{action:'booking_preference',preference:'weekday_afternoon',version:version-1});await check(booking,'booking-choice-saved');
      assert.deepEqual(errors, []); assert.deepEqual(blockedOrigins, []);
      console.log(JSON.stringify({ context: suffix, checks: results.filter(result => result.locale === locale && result.width === width && result.largeText === largeText).length }));
    } finally { if (releaseSave) releaseSave(); await context.close(); }
  }
  await writeFile(`${evidence}/results.json`, JSON.stringify({ kind: 'Built Next UI + explicit synthetic HTTP fixtures; no native Auth/database/provider/model claim; metadata/exact-attempt recovery is synthetic HTTP proof only; actual native Auth/database concurrency remains separate.', checks: results, keyboardChecks }, null, 2));
  console.log(JSON.stringify({ checks: results.length, axeViolations: 0, evidence }));
} finally { await browser.close(); }
