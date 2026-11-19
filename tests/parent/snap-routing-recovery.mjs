import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import localeCopy from '../../src/lib/parent/locale.ts';
const { parentText } = localeCopy;
// Actual built UI with explicitly synthetic account/authorization/API responses; no native identity or provider claim.
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3312', target = new URL(origin);
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password);
const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
const cases = ['ordinary-private', 'applicant-choice', 'source-refresh', 'source-gone', 'owner-before', 'owner-after', 'same-owner-403', 'late-owner', 'late-unmount'].filter(name => !selectedCase || name === selectedCase);
assert.ok(cases.length, 'Select an existing synthetic proof case.');
const evidence = 'tmp/parent-verification/snap-routing-recovery/browser' + (selectedCase ? '-' + selectedCase : ''), results = [], findings = [];
await mkdir(evidence, { recursive: true });
const ownerA = '55555555-5555-4555-8555-555555555555', ownerB = '66666666-6666-4666-8666-666666666666';
const sourceId = '44444444-4444-4444-8444-444444444444', requestId = '11111111-1111-4111-8111-111111111111';
const documentId = 'pa-snap-pa600fs-sg-2019-es';
const browser = await chromium.launch({ headless: true });
try {
 for (const locale of ['es', 'en']) for (const [width, largeText] of [[320, true], [320, false], [390, false], [1280, false]]) for (const scenario of cases) {
  const t = text => parentText(locale, text), name = `${locale}-${width}${largeText ? '-full200' : ''}-${scenario}`;
  const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage(), errors = [], blocked = [], posts = [], reads = [], quotes = [];
  let owner = ownerA, defaultsReads = 0, refreshReads = 0, releaseAccount, releaseProfile, releasePost, holdAccount = false;
  const now = Date.now(), expiresAt = new Date(now + 3600000).toISOString();
  const source = { sourceRequestId: sourceId, sourceVersion: 3, value: '19129', confirmedAt: new Date(now - 86400000).toISOString(), expiresAt: new Date(now + 86400000).toISOString() };
  const current = { ...source, sourceVersion: 4, value: '19103', confirmedAt: new Date(now - 43200000).toISOString() };
  const emptyProfile = id => ({ ownerId: id, revision: 0, lastMutationKey: null, profile: null, collection: { collectionEnabled: true, noticeVersion: 'family-profile-2026-11-17.v1', expiresAt, retentionDays: 45 } });
  await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin) return route.continue(); blocked.push(url.origin); return route.abort(); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/parent/**', async route => {
   const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
   const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
   if (path === '/api/parent/requests' && method === 'POST') {
    posts.push({ body: request.postData(), key: request.headers()['idempotency-key'] });
    if (scenario === 'source-refresh' && posts.length === 1 || scenario === 'source-gone' && posts.length === 1) return json({ ok: false, error: 'Saved routing information changed before this request was created.' }, 412);
    if (scenario === 'owner-after') { owner = ownerB; return json({ ok: false, error: 'This support request is unavailable, or its permission has changed.' }, 403); }
    if (scenario === 'same-owner-403' && posts.length === 1) return json({ ok: false, error: 'This support request is unavailable, or its permission has changed.' }, 403);
    if (scenario === 'late-unmount') { await new Promise(resolve => { releasePost = resolve; }); try { return await json({ request: { id: requestId } }, 201); } catch { return; } }
    return json({ request: { id: requestId } }, 201);
   }
   assert.equal(method, 'GET', 'No other mutation is authorized by this synthetic proof.'); reads.push(path);
   if (path.endsWith('/account')) {
    if (holdAccount) { holdAccount = false; await new Promise(resolve => { releaseAccount = resolve; }); try { return await json({ account: { id: ownerA, email: 'synthetic@example.invalid', preferences: { language: 'en', contactPreference: 'in_app' } } }); } catch { return; } }
    return json({ account: { id: owner, email: 'synthetic@example.invalid', preferences: { language: 'en', contactPreference: 'in_app' } } });
   }
   if (path.endsWith('/authorization-window')) {
    const quoteExpiresAt = scenario === 'same-owner-403' && posts.length ? new Date(now + 7200000).toISOString() : expiresAt;
    quotes.push(quoteExpiresAt); return json({ authorization: { issuedAt: new Date(now).toISOString(), expiresAt: quoteExpiresAt, snapApplication: { collectionEnabled: true, noticeVersion: 'snap-application-details-2026-11-03.v1' } } });
   }
   if (path.endsWith('/intake-defaults')) { defaultsReads++; if (posts.length === 1) refreshReads++; return json({ ownerId: owner, zip: posts.length && scenario === 'source-gone' ? null : posts.length && scenario === 'source-refresh' ? current : source }); }
   if (path.endsWith('/family-profile')) {
    if (scenario === 'late-owner') { await new Promise(resolve => { releaseProfile = resolve; }); return json(emptyProfile(ownerB)); }
    return json(emptyProfile(owner));
   }
   if (path.endsWith('/capabilities')) return json({ capabilities: [] });
   if (path.endsWith('/requests')) return json({ requests: [] });
   if (path === `/api/parent/requests/${requestId}`) return json({ ok: false, error: 'Synthetic start observed; request-detail integration is outside this proof.' }, 404);
   return json({ ok: false, error: 'Synthetic boundary: no connected account operation.' }, 401);
  });
  const main = page.locator('#main-content'), form = main.locator('form').first(), field = path => main.locator(`[data-snap-path="${path}"]`);
  async function check(state, scope = main) {
   await page.evaluate(() => document.fonts.ready.then(() => undefined));
   const issues = await scope.evaluate(root => {
    const found = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node; node = walker.nextNode();) {
     const el = node.parentElement; if (!el?.checkVisibility() || el.closest('select,textarea,a[href^="mailto:"]')) continue;
     const box = el.getBoundingClientRect(), css = getComputedStyle(el); if (box.width <= 1 && box.height <= 1 && (css.clip !== 'auto' || css.clipPath !== 'none')) continue;
     for (const word of node.textContent.matchAll(/\p{L}{4,}/gu)) { const range = document.createRange(); range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length); const rects = [...range.getClientRects()].filter(r => r.width > 0); if (new Set(rects.map(r => Math.round(r.top))).size > 1 || rects.some(r => r.left < -1 || r.right > innerWidth + 1)) { if (!found.length) el.dataset.routingFracture = 'true'; found.push({ word: word[0], text: el.textContent, width: box.width }); } }
    }
    return found;
   });
   const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
   const violations = axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }));
   if (issues.length) await scope.locator('[data-routing-fracture]').first().scrollIntoViewIfNeeded();
   await page.screenshot({ path: `${evidence}/${name}-${state}-viewport.png` });
   if (issues.length || violations.length) await writeFile(`${evidence}/${name}-${state}-failure.json`, JSON.stringify({ issues, violations }, null, 2));
   const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
   if (issues.length || violations.length || viewportOverflow) findings.push({ kind: 'built visual/accessibility failure', locale, width, largeText, scenario, state, issues, violations, viewportOverflow });
   assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
   results.push({ locale, width, largeText, scenario, state, axeViolations: violations.length, wordFractures: issues.length, viewportOverflow });
  }
  async function keyboardActivate(button) {
   await button.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
   assert.equal(await button.evaluate(el => document.activeElement === el), true);
   const focus = await button.evaluate(el => { const b = el.getBoundingClientRect(), css = getComputedStyle(el); return { top: b.top, bottom: b.bottom, viewport: innerHeight, outlineStyle: css.outlineStyle, outlineWidth: css.outlineWidth, text: el.textContent }; });
   const visible = focus.top >= -1 && focus.bottom <= focus.viewport + 1 && focus.outlineStyle !== 'none' && parseFloat(focus.outlineWidth) > 0;
   if (!visible) { await page.screenshot({ path: `${evidence}/${name}-keyboard-before-viewport.png` }); await writeFile(`${evidence}/${name}-keyboard-before.json`, JSON.stringify(focus, null, 2)); }
   assert.equal(visible, true, JSON.stringify(focus));
   await page.keyboard.press('Enter');
  }
  async function complete() {
   for (const [path, value] of Object.entries({ 'applicant.firstName': 'Proof', 'applicant.lastName': 'Parent', 'address.street': '123 Synthetic Lane', 'address.city': 'Philadelphia', 'address.state': 'PA', zip: '19104', county: 'Philadelphia' })) await field(path).fill(value);
   await main.locator('#snap-document-language').selectOption(documentId);
   await field('language').selectOption('en'); await field('interpreter').selectOption('no');
   for (const [end, value] of [['dateOfBirth', '1988-04-15'], ['sex', 'female'], ['student', 'no'], ['requestingSnap', 'yes'], ['citizen', 'yes']]) { const input = main.locator(`[data-snap-path^="household."][data-snap-path$=".${end}"]`); if (end === 'dateOfBirth') await input.fill(value); else await input.selectOption(value); }
   await field('income.hasIncome').selectOption('no');
   for (const path of ['screening.lowCashAndIncome', 'screening.migrantOrSeasonal', 'screening.belowShelterCosts', 'history.fleeingOrProbation.answer', 'history.welfareFraud.answer', 'history.otherStateDisqualification.answer']) await field(path).selectOption('no');
   await field('expenseClaims.household').selectOption('do_not_claim'); await field('expenseClaims.medical').selectOption('not_applicable');
   await main.getByRole('checkbox', { name: t('I’m 18 or older and requesting support for my household or as an authorized caregiver.'), exact: true }).check();
  }
  async function permission() { await keyboardActivate(form.getByRole('button', { name: t('Continue'), exact: true })); await form.getByRole('checkbox', { name: new RegExp(t('I authorize')) }).check(); }
  async function start() { await form.getByRole('button', { name: t('Start getting support'), exact: true }).click(); }
  async function gateReady(ready) { for (let attempt = 0; attempt < 500 && !ready(); attempt++) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(!!ready(), true, 'Synthetic response gate must be reached within five seconds.'); }
  async function redacted() { await main.getByRole('heading', { name: t('Your sign-in changed'), exact: true }).waitFor(); assert.equal(await main.locator('[data-snap-path]').count(), 0); assert.equal(await page.locator('input').evaluateAll(inputs => inputs.some(input => ['Proof', '19104', '123 Synthetic Lane'].includes(input.value))), false); await check('redacted'); }
  await page.goto(origin + '/get-support?need=snap_new', { waitUntil: scenario === 'late-owner' ? 'domcontentloaded' : 'networkidle' });
  await field('applicant.firstName').waitFor(); await main.getByText(t('We will use your saved ZIP for support routing:'), { exact: false }).waitFor();
  const sourceNotice = main.getByText(t('We will use your saved ZIP for support routing:'), { exact: false }).locator('..');
  const sourceDate = new Date(source.confirmedAt).toLocaleDateString(locale === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  assert.ok((await sourceNotice.textContent()).includes(`${locale === 'es' ? 'Proporcionado' : 'Provided'} ${sourceDate}`));
  if (largeText) { await page.addStyleTag({ content: 'html{font-size:200%}' }); await main.evaluate(el => { el.parentElement.style.fontSize = '32px'; }); }
  assert.equal(await main.evaluate(el => getComputedStyle(el).fontSize), largeText ? '32px' : '16px');
  await page.getByRole('button', { name: t('Ask CaseLink for assistance'), exact: true }).click(); await page.getByRole('button', { name: t('Hide floating button'), exact: true }).click();
  assert.equal(await field('zip').inputValue(), '', 'Ordinary routing must never fill the private home.');
  await complete();
  if (scenario === 'ordinary-private' && largeText) { await main.getByRole('list', { name: t('Support request steps'), exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/${name}-progress-viewport.png` }); }
  if (scenario === 'applicant-choice' || scenario === 'owner-before') await keyboardActivate(main.getByRole('button', { name: t('Use applicant ZIP code for support routing'), exact: true }));
  if (['ordinary-private', 'applicant-choice'].includes(scenario)) { await field('zip').scrollIntoViewIfNeeded(); await check('private-home'); }
  await permission();
  if (scenario === 'owner-before') owner = ownerB;
  if (scenario === 'late-owner') holdAccount = true;
  await start();
  if (scenario === 'source-gone') {
   const message = 'A current household ZIP code is needed. Your other answers are kept.';
   await main.getByText(t(message), { exact: true }).waitFor();
   assert.equal(await main.getByText(t(message), { exact: true }).getAttribute('lang'), locale);
   assert.equal(posts.length, 1); assert.equal(await field('zip').inputValue(), '19104'); assert.equal(await field('applicant.firstName').inputValue(), 'Proof'); assert.equal(await main.locator('#snap-document-language').inputValue(), documentId);
   if (locale === 'es' && t(message) === message) {
    const finding = { scenario, locale, width, largeText, kind: 'known CaseLink recovery copy remains English', message, lang: await main.getByText(message, { exact: true }).getAttribute('lang') }; findings.push(finding);
    await main.getByText(message, { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/${name}-known-copy-before-viewport.png` }); await writeFile(`${evidence}/${name}-known-copy-before.json`, JSON.stringify(finding, null, 2));
   }
   await main.getByText(t(message), { exact: true }).scrollIntoViewIfNeeded(); await check('source-gone-kept');
   await keyboardActivate(main.getByRole('button', { name: t('Use applicant ZIP code for support routing'), exact: true })); await permission(); await start();
  } else if (scenario === 'owner-before' || scenario === 'owner-after') {
   await redacted(); assert.equal(posts.length, scenario === 'owner-before' ? 0 : 1); await page.evaluate(() => dispatchEvent(new Event('focus'))); assert.equal(await main.locator('[data-snap-path]').count(), 0);
  } else if (scenario === 'same-owner-403') {
   await main.getByText(t('The save result has not been confirmed. Retry the same request before changing answers or starting another request.'), { exact: false }).waitFor();
   assert.equal(await form.getByRole('button', { name: t('Back'), exact: true }).isDisabled(), true); assert.equal(posts.length, 1);
   if (largeText) { await main.getByText(t('Named programs for this request'), { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/${name}-program-labels-viewport.png` }); }
   const message = 'This support request is unavailable, or its permission has changed.';
   assert.equal(await main.getByText(t(message), { exact: true }).getAttribute('lang'), locale);
   if (locale === 'es' && t(message) === message) {
    const finding = { scenario, locale, width, largeText, kind: 'known CaseLink denial copy remains English', message, lang: await main.getByText(message, { exact: true }).getAttribute('lang') }; findings.push(finding);
    await main.getByText(message, { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/${name}-known-copy-before-viewport.png` }); await writeFile(`${evidence}/${name}-known-copy-before.json`, JSON.stringify(finding, null, 2));
   }
   await main.getByText(t('The save result has not been confirmed. Retry the same request before changing answers or starting another request.'), { exact: false }).scrollIntoViewIfNeeded(); await check('unknown-403-frozen'); await start();
  } else if (scenario === 'late-owner') {
   await gateReady(() => releaseAccount && releaseProfile);
   releaseProfile(); await redacted(); releaseAccount(); await page.waitForLoadState('networkidle'); assert.equal(posts.length, 0); await redacted();
  } else if (scenario === 'late-unmount') {
   await gateReady(() => releasePost);
   await main.locator('a[href="/support/privacy"]').last().click(); await page.waitForURL(origin + '/support/privacy'); releasePost(); await page.waitForLoadState('networkidle');
   assert.equal(new URL(page.url()).pathname, '/support/privacy'); assert.equal(posts.length, 1); results.push({ locale, width, largeText, scenario, state: 'late-post-ignored-after-unmount' });
  }
  if (!['owner-before', 'owner-after', 'late-owner', 'late-unmount'].includes(scenario)) {
   await page.waitForURL(origin + '/support/' + requestId);
   const first = JSON.parse(posts[0].body), last = JSON.parse(posts.at(-1).body);
   assert.equal(first.expectedOwnerId, ownerA); assert.equal(last.expectedOwnerId, ownerA); assert.equal(last.kind, 'snap_application'); assert.equal(last.details.zip, '19104'); assert.equal(last.details.applicant.firstName, 'Proof'); assert.equal(last.details.language, 'en'); assert.equal(last.intake.language, 'en'); assert.equal(last.documentTemplateId, documentId); assert.equal(last.mandate.accepted, true); assert.equal(last.mandate.mode, 'prepare_only'); assert.deepEqual(last.mandate.recipientIds, ['snap-pa']); assert.equal(last.mandate.expiresAt, expiresAt);
   if (scenario === 'source-refresh') { assert.equal(first.intake.zip, source.value); assert.deepEqual(first.reusedZip, { sourceRequestId: sourceId, sourceVersion: source.sourceVersion }); assert.equal(posts.length, 2); assert.equal(refreshReads, 1); assert.equal(posts[1].key, posts[0].key); assert.deepEqual(last, { ...first, intake: { ...first.intake, zip: current.value }, reusedZip: { sourceRequestId: sourceId, sourceVersion: current.sourceVersion } }); }
   else if (scenario === 'applicant-choice' || scenario === 'source-gone') { assert.equal(last.intake.zip, '19104'); assert.equal(last.reusedZip, undefined); }
   else { assert.equal(last.intake.zip, '19129'); assert.deepEqual(last.reusedZip, { sourceRequestId: sourceId, sourceVersion: 3 }); }
   if (scenario === 'same-owner-403') { assert.equal(posts.length, 2); assert.deepEqual(posts[1], posts[0]); assert.ok(quotes.includes(new Date(now + 7200000).toISOString())); }
   results.push({ locale, width, largeText, scenario, state: 'exact-packet-start-observed', posts: posts.length, defaultsReads });
  }
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []); assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await writeFile(`${evidence}/${name}-requests.json`, JSON.stringify({ boundary: 'Synthetic client HTTP; no real commit or native Auth proof.', ownerA, source, current, expiresAt, quotes, posts, reads }, null, 2));
  releaseAccount?.(); releaseProfile?.(); releasePost?.(); await context.close(); console.log(name + ': passed.');
 }
} finally { await browser.close(); }
await writeFile(`${evidence}/results.json`, JSON.stringify({ boundary: 'Exact reviewed built source; synthetic Auth/API; outbound blocked; no native/provider/model/real-family or released-composition claim.', cases: cases.length * 8, results, findings }, null, 2));
console.log(JSON.stringify({ scenarios: cases.length * 8, checks: results.length, findings }));
if (findings.length) process.exitCode = 1;
