import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixtures from '../../src/lib/parent/test-fixtures.ts';
import wicFields from '../../src/lib/parent/wic-application-fields.ts';
import constants from '../../src/lib/parent/constants.ts';
import profile from '../../src/lib/parent/family-profile.ts';
const { fixtureIntake, fixtureMandate, fixtureRequest } = fixtures;
const { WIC_APPLICATION_SOURCE, wicApplicationLeaves } = wicFields;
const { WIC_APPLICATION_NOTICE_VERSION, WIC_SUBJECT_AUTHORITY_STATEMENT } = constants;
const { FAMILY_PROFILE_NOTICE_VERSION } = profile;
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3308';
const target = new URL(origin), evidence = 'tmp/parent-verification/wic-locale/browser';
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password);
await mkdir(evidence, { recursive: true });
const copy = {
 en: { contact: 'Contact first name', zip: 'Household ZIP code', adult: /I’m 18 or older/, next: 'Continue', start: 'Start getting support', authorize: /^I authorize/,
   notSubmitted: 'No application submission recorded', responseUnknown: 'Agency submission not confirmed', loading: 'Loading saved WIC answers', answers: 'Your WIC answers', correct: 'Correct WIC answers', save: 'Save WIC changes', saving: 'Saving WIC answers…', retry: 'Retry the same WIC save',
   saved: /Your private WIC answers are saved as a new revision/, confirm: /^Still correct for this WIC request today: Contact first name/, read: 'Read privately saved WIC answers',
   official: 'Open the official program', report: 'Tell us about an outcome', reportQuestion: 'What did you receive or hear, and when?', reportSave: 'Save my report', attributed: /Your report is saved as information from you/, notice: 'Before you share private WIC answers', closed: /Private WIC changes are closed/, unchanged: /The request changed. Your unsaved draft/, unavailable: /Private WIC questions are not available/ },
 es: { contact: 'Nombre de la persona de contacto', zip: 'Código postal del hogar', adult: /Tengo 18 años o más/, next: 'Continuar', start: 'Comenzar a recibir apoyo', authorize: /^Autorizo/,
   notSubmitted: 'No hay un envío de solicitud registrado', responseUnknown: 'No se ha confirmado el envío a la agencia', loading: 'Cargando las respuestas guardadas de WIC', answers: 'Sus respuestas de WIC', correct: 'Corregir respuestas de WIC', save: 'Guardar cambios de WIC', saving: 'Guardando las respuestas de WIC…', retry: 'Reintentar el mismo guardado de WIC',
   saved: /Sus respuestas privadas de WIC se guardaron como una nueva versión/, confirm: /^Sigue siendo correcto para esta solicitud de WIC hoy: Contacto nombre/, read: 'Leer las respuestas privadas guardadas de WIC',
   official: 'Abrir el programa oficial', report: 'Cuéntenos qué ocurrió', reportQuestion: '¿Qué recibió o qué le dijeron, y cuándo?', reportSave: 'Guardar mi informe', attributed: /Su informe se guardó como información proporcionada por usted/, notice: 'Antes de compartir respuestas privadas de WIC', closed: /La edición privada de WIC está cerrada/, unchanged: /La solicitud cambió. Su borrador sin guardar/, unavailable: /Las preguntas privadas de WIC no están disponibles/ },
};
const browser = await chromium.launch({ headless: true }), results = [];
try {
 for (const locale of ['en', 'es']) for (const [width, largeText] of [[320, true], [320, false], [390, false], [1280, false]]) {
  const c = copy[locale], suffix = `${locale}-${width}${largeText ? '-large-text' : ''}`;
  const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
  const id = 'd430cc02-d8d4-46cc-9900-5b397758fb16', owner = '11111111-1111-4111-8111-111111111111', snapshotId = '22222222-2222-4222-8222-222222222222', childId = '33333333-3333-4333-8333-333333333333';
  const now = new Date().toISOString(), expiry = new Date(Date.now() + 86400000).toISOString(), errors = [], posts = [];
  let mode = 'active', status = 'active', enabled = true, release, releaseRead, version = 2;
  const details = { applicationType: 'new', beneficiaries: 'children', contact: { firstName: 'María', lastName: 'García', dateOfBirth: '1992-04-06', zip: '19147' }, children: [{ id: childId, firstName: 'Lucía', dateOfBirth: '2023-07-09' }], appointmentPreference: 'morning' };
  const record = { id: snapshotId, request_id: id, revision: 1, base_version: 1, request_version: 2, details,
   provenance: Object.fromEntries(Object.keys(wicApplicationLeaves(details)).map(path => [path, { source: 'parent', confirmedAt: '2026-11-13T19:00:00Z', asOf: '2026-11-13' }])),
   source: WIC_APPLICATION_SOURCE, notice_version: WIC_APPLICATION_NOTICE_VERSION, created_at: '2026-11-13T19:00:00Z', idempotency_key: childId,
   consent_evidence: { subjectAuthorityDeclared: true, statement: WIC_SUBJECT_AUTHORITY_STATEMENT, actorId: owner, noticeVersion: WIC_APPLICATION_NOTICE_VERSION, declaredAt: '2026-11-13T19:00:00Z', revision: 1, detailsSha256: 'a'.repeat(64), subjects: ['contact', `children.${childId}`] } };
  const request = () => ({ ...fixtureRequest({ version, status, intake: fixtureIntake({ needs: ['wic_new'], zip: '19104', householdSize: null, utilityProviders: [], accountAuthority: 'self', pregnantOrPostpartum: null, childrenUnderFive: null }),
   mandate: fixtureMandate({ mode: 'prepare_only', recipientIds: ['wic-pa'], allowedActions: ['research', 'prepare'], allowedData: ['household'], expiresAt: expiry }) }), id, required_actions: mode === 'personal' ? [{ id: 'wic-specialist', need: 'wic_new', reason: 'personal_step', resolver: 'parent', title: 'Synthetic WIC specialist assessment — original English source', explanation: 'Synthetic source: a specialist assessment is still required. No appointment has been booked.', url: 'https://www.pa.gov/services/health/request-a-pre-application-appointment-with-a-wic-specialist', resolved: false }] : [], plan: null });
  await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/parent/**', async route => {
   const path = new URL(route.request().url()).pathname, method = route.request().method();
   const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: JSON.stringify(value) });
   if (method === 'POST') {
    assert.ok(path === `/api/parent/requests/${id}/wic-application` || path === `/api/parent/requests/${id}/outcome` || path === '/api/parent/requests', 'Only synthetic WIC fixture writes are permitted.');
    posts.push({ path, body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
    if (mode === 'saving') await new Promise(resolve => { release = resolve; });
    if (mode === 'unknown') return route.abort('connectionfailed');
    return json(path.endsWith('/wic-application') ? { snapshotId } : { request: { id } });
   }
   assert.equal(method, 'GET');
   if (path === '/api/parent/account') return json({ account: { id: owner, email: 'synthetic@example.invalid', preferences: { language: 'en', contactPreference: 'in_app' } } });
   if (path === '/api/parent/authorization-window') return json({ authorization: { issuedAt: now, expiresAt: expiry, wicApplication: { collectionEnabled: enabled, noticeVersion: enabled ? WIC_APPLICATION_NOTICE_VERSION : null, expiresAt: enabled ? expiry : null } } });
   if (path.endsWith('/family-profile-source')) return json({ fields: [{ applicationPath: 'contact.firstName', profilePaths: ['primaryPerson.firstName'] }] });
   if (path === '/api/parent/family-profile') return json({ ownerId: owner, revision: 2, lastMutationKey: snapshotId, collection: { collectionEnabled: true, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, expiresAt: expiry, retentionDays: 45 }, profile: null });
   if (path.endsWith('/wic-application') && mode === 'loading') await new Promise(resolve => { releaseRead = resolve; });
   if (path.endsWith('/wic-application') && mode === 'read-error') return json({ error: 'This support request is unavailable.' }, 503);
   if (path.endsWith('/wic-application')) return mode === 'missing' ? json({ error: 'This saved application is unavailable.' }, 404) : mode === 'malformed' ? json({ snapshot: {} }) : json({ snapshot: record, routingContext: { label: "Household routing ZIP only; this does not establish the contact's postal address.", zip: '19104' } });
   if (path === `/api/parent/requests/${id}`) return json({ request: request() });
   if (path.endsWith('/operations')) return json({ operations: mode === 'callback' || mode === 'report' ? [{ id: snapshotId, request_id: id, request_version: version, program_id: 'wic-pa', need: 'wic_new', action: 'refer', state: 'partner_received', artifact_id: null, created_at: now, evidence: { source: 'operator_confirmed', reference: 'SYNTHETIC receipt display only', recordedAt: now } }] : [], historyLimited: false });
   if (path === '/api/parent/requests') return json({ requests: [request()] });
   if (path === '/api/parent/intake-defaults') return json({ zip: null });
   if (path === '/api/parent/partners') return json({ partners: [] });
   return json({ capabilities: [] });
  });
  async function open(path) {
   await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
   if (largeText) {
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await page.locator('main').evaluate(element => { element.parentElement.style.fontSize = '32px'; });
    assert.equal(await page.locator('main').evaluate(element => getComputedStyle(element).fontSize), '32px');
   }
   const skip = page.locator('a[href="#main-content"]');
   for (let i = 0; i < 30 && !await skip.evaluate(element => document.activeElement === element); i++) await page.keyboard.press('Shift+Tab');
   assert.equal(await skip.evaluate(element => document.activeElement === element), true, `${suffix} keyboard skip link`);
   await page.keyboard.press('Tab');
  }
  async function check(state, panel) {
   await page.evaluate(() => document.fonts.ready.then(() => undefined));
   const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
   if (axe.violations.length) await page.screenshot({ path: `${evidence}/${suffix}-${state}-axe.png`, fullPage: true });
   assert.deepEqual(axe.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), [], `${suffix}/${state} accessibility`);
   const bounds = await panel.evaluate(element => ({ page: document.documentElement.scrollWidth, viewport: innerWidth, width: element.clientWidth, scroll: element.scrollWidth, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }));
   if (!(bounds.page <= bounds.viewport && bounds.scroll <= bounds.width + 1 && bounds.left >= 0 && bounds.right <= bounds.viewport + 1)) { await writeFile(`${evidence}/${suffix}-${state}-bounds.json`, JSON.stringify(bounds, null, 2)); await page.screenshot({ path: `${evidence}/${suffix}-${state}-bounds.png`, fullPage: true }); }
   assert.ok(bounds.page <= bounds.viewport && bounds.scroll <= bounds.width + 1 && bounds.left >= 0 && bounds.right <= bounds.viewport + 1, `${suffix}/${state} viewport and panel bounds`);
   assert.deepEqual(errors, [], `${suffix}/${state} browser errors`);
   const skip = page.locator('a[href="#main-content"]');
   await skip.evaluate(element => { if (document.activeElement === element) element.blur(); });
   assert.ok(await skip.evaluate(element => element.getBoundingClientRect().bottom <= 0), `${suffix}/${state} unfocused skip link stays offscreen`);
   await panel.screenshot({ path: `${evidence}/${suffix}-${state}.png` });
   await panel.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY));
   await page.screenshot({ path: `${evidence}/${suffix}-${state}-viewport.png` });
   const words = await panel.locator('p,label,legend,h2,h3,summary,button,a').evaluateAll(elements => {
    const split=[]; for(const element of elements) { if(!element.getBoundingClientRect().height)continue;
     const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT); while(walker.nextNode()) {const text=walker.currentNode; for(const match of text.textContent.matchAll(/\p{L}{4,}/gu)){const range=document.createRange();range.setStart(text,match.index);range.setEnd(text,match.index+match[0].length);if(range.getClientRects().length>1)split.push({ word: match[0], tag: element.tagName, width: element.getBoundingClientRect().width, padding: getComputedStyle(element).padding, font: getComputedStyle(element).fontSize, display: getComputedStyle(element).display, direction: getComputedStyle(element).flexDirection, gap: getComputedStyle(element).gap });}}
    } return split;
   });
   assert.deepEqual(words, [], `${suffix}/${state} ordinary words stay intact`);
   results.push({ locale, width, largeText, state, axeViolations: 0, bounds, splitWords: words });
  }
  await open('/get-support?need=wic_new');
  const form = page.locator('form').first();
  await form.getByLabel(c.contact, { exact: true }).fill('María José');
  await form.getByLabel(c.zip, { exact: true }).fill('19104');
  await form.getByLabel(c.adult).check(); await check('intake', form);
  await form.getByRole('button', { name: c.next, exact: true }).click();
  await form.getByRole('button', { name: c.start, exact: true }).waitFor();
  assert.ok((await form.innerText()).includes('Pennsylvania WIC'));
  assert.equal(await form.locator('[lang=en]').filter({ hasText: WIC_SUBJECT_AUTHORITY_STATEMENT }).count(), locale === 'es' ? 1 : 0);
  await check('permission', form);
  mode = 'loading'; await page.goto(`${origin}/support/${id}`, { waitUntil: 'domcontentloaded' });
  if (largeText) {
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await page.locator('main').evaluate(element => { element.parentElement.style.fontSize = '32px'; });
    assert.equal(await page.locator('main').evaluate(element => getComputedStyle(element).fontSize), '32px');
   }
  await page.locator('#application-overview').getByText(c.notSubmitted, { exact: true }).waitFor(); await check('overview', page.locator('#application-overview'));
  await page.getByText(c.answers, { exact: true }).first().click();
  const panel = page.locator('#wic-application-review'); await panel.getByRole('status', { name: c.loading }).waitFor(); await check('loading', panel);
  mode = 'active'; releaseRead();
  await open(`/support/${id}`); await page.getByText(c.answers, { exact: true }).first().click();
 await panel.getByRole('button', { name: c.correct, exact: true }).waitFor();
  await panel.getByText(c.read, { exact: true }).click(); await check('saved', panel);
  assert.ok((await panel.innerText()).includes('María')); assert.ok((await panel.innerText()).includes('Lucía'));
  await panel.getByRole('button', { name: c.correct, exact: true }).click();
  await panel.getByRole('checkbox', { name: c.confirm }).check();
  assert.equal(await panel.locator('input[type=date]').first().inputValue(), '1992-04-06'); await check('reaffirmation', panel);
  mode = 'saving'; await panel.getByRole('button', { name: c.save, exact: true }).click(); await panel.getByRole('button', { name: c.saving, exact: true }).waitFor(); await check('saving', panel);
  mode = 'unknown'; release(); await panel.getByRole('button', { name: c.retry, exact: true }).waitFor(); await check('unknown', panel);
  mode = 'active'; await panel.getByRole('button', { name: c.retry, exact: true }).click(); await panel.getByText(c.saved).waitFor(); await check('success', panel);
  assert.equal(posts.at(-1).body, posts.at(-2).body); assert.equal(posts.at(-1).key, posts.at(-2).key);
  const body = JSON.parse(posts.at(-1).body); assert.deepEqual(body.confirmedPaths, ['contact.firstName']); assert.equal(body.details.contact.firstName, 'María'); assert.equal(body.details.contact.dateOfBirth, '1992-04-06'); assert.equal(body.subjectAuthorityDeclared, true); assert.equal(body.noticeVersion, WIC_APPLICATION_NOTICE_VERSION);
  for (const state of ['paused', 'closed', 'gate-closed', 'missing', 'malformed', 'read-error']) {
   mode = state; status = state === 'paused' ? 'paused' : state === 'closed' ? 'closed' : 'active'; enabled = state !== 'gate-closed';
   await open(`/support/${id}`); await page.getByText(c.answers, { exact: true }).first().click();
   if (state === 'closed' || state === 'gate-closed') await panel.getByText(c.closed).waitFor();
   else if (state === 'paused') await panel.getByRole('button', { name: c.correct, exact: true }).waitFor();
   await check(state, panel);
  }
  mode = 'personal'; status = 'active'; enabled = true; await open(`/support/${id}`); await check('personal-overview', page.locator('#application-overview')); await page.locator('a[href="#your-next-steps"]').first().click();
  const personal = page.locator('#your-next-steps'); await personal.getByRole('link', { name: c.official, exact: true }).waitFor();
  assert.equal(await personal.getByText('Synthetic WIC specialist assessment — original English source', { exact: true }).getAttribute('lang'), ''); await check('personal-step', personal);
  mode = 'callback'; await open(`/support/${id}`); await page.locator('#application-overview').getByText(c.responseUnknown, { exact: true }).waitFor(); await check('response-overview', page.locator('#application-overview')); await page.locator('a[href="#application-receipts"]').click();
  const receipts = page.locator('#application-receipts'); await check('recorded-response', receipts);
  await receipts.getByText(c.report, { exact: true }).click(); await receipts.getByLabel(c.reportQuestion, { exact: true }).fill('El 18 de noviembre pedí una llamada; todavía no hay cita.');
  await receipts.locator('#report-outcome').selectOption('unresolved');
  await receipts.getByRole('button', { name: c.reportSave, exact: true }).click(); await receipts.getByText(c.attributed).waitFor(); await check('family-report', receipts);
  const reported = JSON.parse(posts.at(-1).body); assert.deepEqual(reported, { need: 'wic_new', outcome: 'unresolved', reference: 'El 18 de noviembre pedí una llamada; todavía no hay cita.' });
  mode = 'active'; status = 'active'; enabled = false; await open('/get-support?need=wic_new'); await page.getByText(c.unavailable).waitFor();
  assert.equal(await page.getByLabel(c.contact, { exact: true }).count(), 0);
  await check('intake-gate-closed', page.locator('form').filter({ has: page.getByLabel(c.zip, { exact: true }) }));
  enabled = true; await open('/get-support?need=wic_continuing'); await page.getByText(c.unavailable).waitFor();
  assert.equal(await page.getByLabel(c.contact, { exact: true }).count(), 0); await check('continuing', page.locator('form').first());
  await context.close();
 }
} finally { await browser.close(); }
await writeFile(`${evidence}/results.json`, JSON.stringify({ boundary: 'Actual built UI; synthetic intercepted Auth/API only. No real database, Storage, model, submission, clinic callback, enrollment or benefits evidence.', results }, null, 2));
console.log(`WIC: ${results.length} EN/ES viewport, exact retry, reaffirmation, waiting and access display checks passed.`);
