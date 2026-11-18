import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixtures from '../../src/lib/parent/test-fixtures.ts';
import assistant from '../../src/lib/parent/assistant.ts';
import localeCopy from '../../src/lib/parent/locale.ts';
const { fixtureRequest, fixtureIntake, fixtureMandate } = fixtures, { buildAssistantFacts } = assistant, { parentText } = localeCopy;
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3308', authOrigin = 'http://127.0.0.1:3318';
assert.equal(origin, 'http://127.0.0.1:3308');
const evidence = 'tmp/parent-verification/assistant-locale/browser'; await mkdir(evidence, { recursive: true });
const owner = '11111111-1111-4111-8111-111111111111', firstId = 'd430cc02-d8d4-46cc-9900-5b397758fb16', secondId = 'a430cc02-d8d4-46cc-9900-5b397758fb16';
const now = new Date().toISOString(), expiry = new Date(Date.now() + 86400000).toISOString(), issued = Math.floor(Date.now() / 1000), authCalls = [], unexpectedAuth = [];
const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: owner, aud: 'authenticated', role: 'authenticated', exp: issued + 3600, iat: issued })).toString('base64url')}.c3ludGhldGlj`;
const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', email_confirmed_at: now, confirmed_at: now, is_anonymous: false, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now };
// Explicit synthetic SSR Auth fixture. It certifies no native Auth, enrollment, database or provider integration.
const auth = createServer((request, response) => {
  const path = new URL(request.url, authOrigin).pathname; authCalls.push({ path, method: request.method });
  const allowed = request.socket.remoteAddress === '127.0.0.1' && request.headers.authorization === `Bearer ${token}`;
  const userRead = path === '/auth/v1/user' && request.method === 'GET', accountRead = path === '/rest/v1/rpc/parent_ensure_account' && request.method === 'POST';
  if (!allowed || (!userRead && !accountRead)) { unexpectedAuth.push({ path, method: request.method }); response.writeHead(403); response.end('{}'); return; }
  response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(userRead ? user : owner));
});
await new Promise((resolve, reject) => { auth.once('error', reject); auth.listen(3318, '127.0.0.1', resolve); });
const browser = await chromium.launch({ headless: true }), results = [];
try {
  const variants = process.env.PARENT_ASSISTANT_QUICK === '1' ? [[320, true]] : [[320, false], [390, false], [1280, false], [320, true]];
  for (const locale of ['en', 'es']) for (const [width, large] of variants) {
    const t = key => parentText(locale, key), suffix = `${locale}-${width}${large ? '-full200' : ''}`;
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage(), errors = [], posts = [], cancels = [];
    let mode = 'answered', releaseRead, releasePost, status = 'active';
    const request = id => ({ ...fixtureRequest({ id, status, intake: fixtureIntake({ needs: id === secondId ? ['wic_continuing'] : ['snap_new', 'food_now'], language: 'en', incomeAmount: 0.01, incomeFrequency: 'monthly', pregnantOrPostpartum: null, childrenUnderFive: null }), mandate: fixtureMandate({ mode: 'prepare_only', recipientIds: id === secondId ? ['wic-pa'] : ['snap-pa', 'philly-food'], allowedActions: ['research', 'prepare'], expiresAt: expiry }) }), created_at: '2026-11-13T19:00:00Z', updated_at: now, next_run_at: '2026-11-20T17:35:00.000Z', required_actions: [{ id: 'synthetic-step', need: id === secondId ? 'wic_continuing' : 'snap_new', reason: 'personal_step', resolver: 'parent', title: 'SYNTHETIC original program step', explanation: 'SYNTHETIC original provider wording; no personal act has been completed.', resolved: false }] });
    const snapshot = { request: request(firstId), account: { language: 'en', contactPreference: 'in_app', quietHoursStart: 21, quietHoursEnd: 8, updatedAt: '2026-11-13T19:00:00Z' }, runtime: { planningReady: false, assistantReady: true }, progress: { summary: 'Your saved household ZIP code is 00000.' },
      operations: [{ id: 'synthetic-operation', program_id: 'snap-pa', need: 'snap_new', state: 'delivery_unknown', updated_at: now }], reports: [{ need: 'snap_new', outcome: 'unresolved', created_at: now }], documents: [], history: [] };
    const facts = buildAssistantFacts(snapshot, new Date('2026-11-18T12:00:00Z')).facts;
    const fact = id => { const found = facts.find(fact => fact.id === id); assert.ok(found, id); return { text: found.text, sourceLabel: found.sourceLabel, sourceUrl: found.sourceUrl, recordedAt: found.recordedAt }; };
    const message = (messageStatus = 'answered') => ({ id: '55555555-5555-4555-8555-555555555555', question: 'SYNTHETIC family question — original wording', status: messageStatus, error: mode === 'cancelled' ? 'You cancelled this question. Your support request is unchanged.' : messageStatus === 'failed' ? 'The assistant could not confirm an answer. Your support request has not changed. Try again.' : null,
      answer: messageStatus === 'answered' ? { intro: 'Here is the latest recorded information for your request.', paragraphs: [fact('request-status'), fact('account-language'), fact('household-zip'), fact('household-size'), fact('income'), fact('follow-up-time'), fact('program-snap-pa'), fact('operation-synthetic-operation'), fact('report-0'), fact('progress-summary'), fact('action-synthetic-step'), fact('chat-scope')], actionIds: ['synthetic-step'] } : null,
      created_at: '2026-11-13T19:00:00Z', updated_at: now });
    const conversation = () => ({ available: mode !== 'offline', unavailableReason: mode === 'offline' ? 'The assistant is not currently connected. Your saved support is still available; sending questions will resume when the service is connected.' : null,
      messages: ['empty', 'pending-save', 'unknown-save', 'saved'].includes(mode) ? [] : [message(mode === 'running' ? 'running' : ['queued', 'offline', 'cancelling', 'cancel-error'].includes(mode) ? 'queued' : ['failed', 'cancelled'].includes(mode) ? 'failed' : 'answered')], historyLimited: mode === 'history' });
    const session = { access_token: token, refresh_token: 'synthetic-refresh', expires_at: issued + 3600, expires_in: 3600, token_type: 'bearer', user };
    await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }, { name: 'caselink-parent-auth', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), url: origin, httpOnly: true }]);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/parent/**', async route => {
      const path = new URL(route.request().url()).pathname, method = route.request().method();
      const json = (value, code = 200) => route.fulfill({ status: code, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: JSON.stringify(value) });
      if (method === 'POST') {
        assert.ok(path === `/api/parent/requests/${firstId}/assistant` || path === `/api/parent/requests/${secondId}/assistant`, 'Only the synthetic assistant save may mutate.');
        posts.push({ path, body: route.request().postData() });
        if (mode === 'pending-save') await new Promise(resolve => { releasePost = resolve; });
        if (mode === 'unknown-save') return route.abort('connectionfailed');
        return json({ ok: true, id: message().id }, 202);
      }
      if (method === 'DELETE') {
        assert.equal(path, `/api/parent/requests/${firstId}/assistant`); cancels.push(route.request().postDataJSON());
        if (mode === 'cancelling') await new Promise(resolve => { releasePost = resolve; });
        if (mode === 'cancel-error') return route.abort('connectionfailed');
        mode = 'cancelled';
        return json({ ok: true });
      }
      assert.equal(method, 'GET');
      if (path === '/api/parent/account') return json({ account: { id: owner, email: user.email, preferences: { language: 'en', contactPreference: 'in_app', quietHoursStart: 21, quietHoursEnd: 8 } } });
      if (path === '/api/parent/requests') {
        if (mode === 'list-loading') await new Promise(resolve => { releaseRead = resolve; });
        if (mode === 'list-error') return json({ error: 'We couldn’t finish that step. Please try again.' }, 503);
        return json({ requests: mode === 'no-requests' ? [] : [request(firstId), request(secondId)] });
      }
      if (path.endsWith('/assistant')) {
        if (mode === 'conversation-loading') await new Promise(resolve => { releaseRead = resolve; });
        if (mode === 'denied') return json({ error: 'Sign in again' }, 401);
        return json(conversation());
      }
      if (path === `/api/parent/requests/${firstId}` || path === `/api/parent/requests/${secondId}`) {
        if (mode === 'request-loading') await new Promise(resolve => { releaseRead = resolve; });
        return json({ request: request(path.split('/').at(-1)) });
      }
      if (path.endsWith('/operations')) return json({ operations: [], historyLimited: false });
      if (path === '/api/parent/authorization-window') return json({ authorization: { issuedAt: now, expiresAt: expiry } });
      return json({ capabilities: [], available: false });
    });
    async function open(path = '/account', selected = firstId) {
      await page.goto(origin + path, { waitUntil: 'networkidle' });
      if (large) { await page.addStyleTag({ content: 'html { font-size: 200%; }' }); await page.locator('main').evaluate(element => { element.parentElement.style.fontSize = '32px'; }); assert.equal(await page.locator('main').evaluate(element => getComputedStyle(element).fontSize), '32px'); }
      const launcher = page.getByRole('button', { name: t('Ask CaseLink for assistance'), exact: true }); await launcher.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: t('Ask CaseLink'), exact: true }); await dialog.waitFor();
      assert.equal(await dialog.getAttribute('lang'), locale);
      if (selected && !['list-loading', 'list-error', 'no-requests'].includes(mode)) { const picker = dialog.getByLabel(t('Which request can we help with?')); await picker.waitFor(); await picker.selectOption(selected); }
      return dialog;
    }
    async function check(state, dialog) {
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const bounds = await dialog.evaluate(element => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, width: element.clientWidth, scroll: element.scrollWidth, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }));
      const layout = await dialog.locator('header,header>*,div,select,section,ol,p').evaluateAll(elements => elements.slice(0, 24).map(element => { const style = getComputedStyle(element), rect = element.getBoundingClientRect(); return {tag: element.tagName, class: element.className, left:rect.left,width:rect.width,font:style.fontSize,display:style.display,flex:style.flex,align:style.alignSelf,padding:style.padding,overflowWrap:style.overflowWrap}; }));
      const splits = await dialog.locator('p,label,summary,button,a,h2,span').evaluateAll(elements => {
        const results = []; for (const element of elements) { if (!element.getClientRects().length || !element.getBoundingClientRect().height) continue; const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); while (walker.nextNode()) for (const word of walker.currentNode.textContent.matchAll(/\p{L}{4,}/gu)) { const range = document.createRange(); range.setStart(walker.currentNode, word.index); range.setEnd(walker.currentNode, word.index + word[0].length); if (range.getClientRects().length > 1) results.push(word[0]); } } return [...new Set(results)];
      });
      await page.screenshot({ path: `${evidence}/${suffix}-${state}.png` });
      const detail = state === 'access-recovery' ? dialog.getByRole('link', { name: t('Sign in to continue') }) : await dialog.getByRole('alert').count() ? dialog.getByRole('alert').last() : state.includes('answer') || state === 'original-source' || state === 'history' ? dialog.locator('ol') : dialog.locator('form,[role="status"]').first();
      if (await detail.count()) { await detail.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/${suffix}-${state}-detail.png` }); }
      if (axe.violations.length || bounds.page > bounds.viewport || bounds.scroll > bounds.width + 1 || bounds.left < 0 || bounds.right > bounds.viewport + 1 || splits.length || errors.length) await writeFile(`${evidence}/${suffix}-${state}-diagnostic.json`, JSON.stringify({ bounds, layout, splits, errors, axe: axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })) }, null, 2));
      assert.deepEqual(axe.violations.map(v => v.id), [], `${suffix}/${state} axe`); assert.ok(bounds.page <= bounds.viewport && bounds.scroll <= bounds.width + 1 && bounds.left >= 0 && bounds.right <= bounds.viewport + 1, `${suffix}/${state} bounds`); assert.deepEqual(splits, [], `${suffix}/${state} ordinary words`); assert.deepEqual(errors, [], `${suffix}/${state} browser errors`);
      results.push({ locale, width, full200: large, state, axeViolations: 0, ordinaryWordSplits: 0, bounds });
    }
    mode = 'answered'; let dialog = await open(); await dialog.getByText(t('Answer recorded'), { exact: false }).waitFor();
    assert.equal(await dialog.getByText('SYNTHETIC family question — original wording', { exact: true }).getAttribute('lang'), '');
    assert.equal(await dialog.getByText('Your saved household ZIP code is 00000.', { exact: true }).getAttribute('lang'), '');
    await check('account-answer', dialog);
    if (process.env.PARENT_ASSISTANT_RECOVERY_ONLY === '1') {
      const close = dialog.getByRole('button', { name: t('Minimize chat') }); await close.focus();
      if (width <= 600) {
        const last = await dialog.locator('button,a[href],input,select,textarea,summary,[tabindex]').evaluateAll(elements => elements.filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length).at(-1)?.outerHTML);
        await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.outerHTML), last);
        await page.keyboard.press('Tab'); assert.equal(await close.evaluate(element => element === document.activeElement), true);
      }
      await dialog.getByRole('button', { name: t('Hide floating button') }).click();
      assert.equal(await page.locator('main').evaluate(element => element === document.activeElement), true);
      assert.equal(await page.getByRole('button', { name: t('Show CaseLink assistant') }).evaluate(element => getComputedStyle(element).position === 'fixed'), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('button', { name: t('Show CaseLink assistant') }).scrollIntoViewIfNeeded();
      const hiddenAxe = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      if (hiddenAxe.violations.length) { await writeFile(`${evidence}/${suffix}-hidden-axe.json`, JSON.stringify({ violations: hiddenAxe.violations, computed: await page.getByRole('button', { name: t('Show CaseLink assistant') }).evaluate(element => { const style = getComputedStyle(element); return {background:style.backgroundColor,color:style.color,opacity:style.opacity,rect:element.getBoundingClientRect().toJSON(), surface:style.getPropertyValue('--color-surface')}; }) }, null, 2)); await page.getByRole('button', { name: t('Show CaseLink assistant') }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/${suffix}-hidden-axe.png` }); }
      assert.deepEqual(hiddenAxe.violations.map(value => value.id), []);
      await page.screenshot({ path: `${evidence}/${suffix}-hidden-keyboard-return.png` });
      await page.getByRole('button', { name: t('Show CaseLink assistant') }).focus(); await page.keyboard.press('Enter');
      mode = 'cancel-error'; dialog = await open(`/support/${firstId}`); await dialog.getByRole('button', { name: t('Cancel question') }).click(); await dialog.getByRole('alert').waitFor(); await check('cancel-error', dialog);
      const prior = cancels.at(-1); mode = 'queued'; await dialog.getByRole('button', { name: t('Cancel question') }).click(); await dialog.getByText(t('You cancelled this question. Your support request is unchanged.'), { exact: true }).waitFor(); assert.deepEqual(cancels.at(-1), prior); await check('cancelled-question', dialog);
      mode = 'unknown-save'; dialog = await open(); await dialog.getByRole('textbox').fill('Retry this exact synthetic question'); await dialog.getByRole('button', { name: t('Send'), exact: true }).click(); await dialog.getByRole('button', { name: t('Retry the same question'), exact: true }).waitFor(); await check('unknown-save', dialog);
      await context.close(); continue;
    }
    if (process.env.PARENT_ASSISTANT_QUICK === '1') { await context.close(); continue; }
    if (locale === 'es') { await dialog.getByText(t('Original English source text'), { exact: true }).click(); await check('original-source', dialog); }
    else await check('original-source', dialog);
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('button', { name: t('Ask CaseLink for assistance') }).evaluate(element => document.activeElement === element), true);
    dialog = await open(`/support/${firstId}`); await dialog.getByRole('textbox').waitFor(); await check('request-answer', dialog);
    for (const state of ['queued', 'running', 'offline', 'failed', 'history']) { mode = state; dialog = await open(`/support/${firstId}`); await dialog.getByRole('textbox').waitFor(); if (state === 'queued' || state === 'offline') await dialog.getByRole('button', { name: t('Cancel question') }).waitFor(); await check(state, dialog); }
    mode = 'answered'; status = 'paused'; dialog = await open(`/support/${firstId}`); await dialog.getByRole('textbox').waitFor(); assert.equal(await dialog.locator(`a[href*="#step-"]`).count(), 0); await check('paused-answer', dialog); status = 'active';
    mode = 'denied'; dialog = await open(`/support/${firstId}`); await dialog.getByRole('link', { name: t('Sign in to continue') }).waitFor(); assert.equal(await dialog.getByRole('button', { name: t('Send'), exact: true }).isDisabled(), true); await check('access-recovery', dialog);
    for (const state of ['list-loading', 'list-error', 'no-requests']) { mode = state; dialog = await open('/account', null); await dialog.getByText(t(state === 'list-loading' ? 'Loading your saved requests…' : state === 'no-requests' ? 'A little help getting started' : 'We couldn’t finish this step'), { exact: true }).waitFor(); await check(state, dialog); releaseRead?.(); releaseRead = undefined; }
    for (const state of ['request-loading', 'conversation-loading']) { mode = state; dialog = await open(); await dialog.getByText(t(state === 'request-loading' ? 'Loading this request…' : 'Loading your conversation…'), { exact: true }).waitFor(); await check(state, dialog); releaseRead?.(); releaseRead = undefined; }
    mode = 'empty'; dialog = await open(); const input = dialog.getByRole('textbox', { name: t('Your question about this request') }); await input.waitFor(); await input.fill('123-45-6789'); await dialog.getByRole('button', { name: t('Send'), exact: true }).click(); await dialog.getByRole('alert').waitFor(); assert.equal(posts.length, 0); await check('private-input-blocked', dialog);
    await input.fill('A synthetic question to keep'); await page.keyboard.press('Escape'); await page.getByRole('button', { name: t('Ask CaseLink for assistance') }).click(); assert.equal(await input.inputValue(), 'A synthetic question to keep'); await check('minimized-return', dialog);
    await dialog.getByRole('button', { name: t('Hide floating button') }).click(); assert.equal(await page.getByRole('button', { name: t('Ask CaseLink for assistance') }).count(), 0); await page.screenshot({ path: `${evidence}/${suffix}-button-hidden.png` }); await page.getByRole('button', { name: t('Show CaseLink assistant') }).click(); assert.equal(await input.inputValue(), 'A synthetic question to keep'); await check('hidden-button-return', dialog);
    await dialog.getByLabel(t('Which request can we help with?')).selectOption(secondId); await dialog.getByRole('textbox').waitFor(); assert.equal(await dialog.getByRole('textbox').inputValue(), ''); await check('switched-request', dialog);
    mode = 'pending-save'; dialog = await open(); await dialog.getByRole('textbox').fill('What is next for this synthetic request?'); await dialog.getByRole('button', { name: t('Send'), exact: true }).click(); await dialog.getByRole('button', { name: t('Sending…'), exact: true }).waitFor(); await check('saving-question', dialog); releasePost(); releasePost = undefined; await dialog.getByText(t('Your question is saved. Its answer will appear here.'), { exact: true }).waitFor(); await check('question-saved', dialog);
    mode = 'unknown-save'; dialog = await open(); await dialog.getByRole('textbox').fill('Retry this exact synthetic question'); await dialog.getByRole('button', { name: t('Send'), exact: true }).click(); await dialog.getByRole('button', { name: t('Retry the same question'), exact: true }).waitFor(); await check('unknown-save', dialog); const prior = posts.at(-1); mode = 'saved'; await dialog.getByRole('button', { name: t('Retry the same question'), exact: true }).click(); await dialog.getByText(t('Your question is saved. Its answer will appear here.'), { exact: true }).waitFor(); assert.deepEqual(posts.at(-1), prior); await check('same-question-retry', dialog);
    mode = 'cancelling'; dialog = await open(`/support/${firstId}`); await dialog.getByRole('button', { name: t('Cancel question') }).click(); await dialog.getByRole('button', { name: t('Stopping answer…') }).waitFor(); await check('cancelling-question', dialog); releasePost(); releasePost = undefined; assert.deepEqual(cancels.at(-1), { messageId: message().id });
    await context.close();
  }
  assert.deepEqual(unexpectedAuth, []); assert.ok(authCalls.some(call => call.path === '/rest/v1/rpc/parent_ensure_account'));
} finally { await browser.close(); await new Promise(resolve => auth.close(resolve)); }
await writeFile(`${evidence}/${process.env.PARENT_ASSISTANT_RECOVERY_ONLY === '1' ? 'recovery-results' : 'results'}.json`, JSON.stringify({ boundary: 'Actual secret-free production UI; strict synthetic localhost SSR Auth and intercepted synthetic parent API only. No native Auth/database, real account, model, provider, processing activation or outcome evidence.', authCalls, results }, null, 2));
console.log(`Assistant: ${results.length} EN/ES, viewport, source, recovery and exact-retry checks passed.`);
