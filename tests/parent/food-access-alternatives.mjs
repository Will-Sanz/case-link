import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixtures from '../../src/lib/parent/test-fixtures.ts';
import food from '../../src/lib/parent/food-access.ts';
import directory from '../../src/lib/parent/food-access-alternatives.ts';
const { fixtureIntake, fixtureMandate, fixtureRequest } = fixtures;
const { bindFoodAccessReport, buildFoodAccessPlanBody, SHARE_FOOD_ACCESS_PROGRAM } = food;
const { buildFoodAccessAlternatives } = directory;

// Real built Next UI; all Auth/API data below are synthetic. No worker, native DB or provider evidence.
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3309', target = new URL(origin);
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password);
const evidence = 'tmp/parent-verification/food-access-alternatives/browser', results = [];
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const locale of ['en', 'es']) for (const [width, largeText] of [[320, false], [390, false], [1280, false], [320, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    const at = new Date().toISOString(), id = 'd430cc02-d8d4-46cc-9900-5b397758fb16', errors = [], writes = [], finderReads = [];
    const initial = fixtureRequest({ version: 2, created_at: at, updated_at: at, intake_confirmed_at: { zip: at },
      intake: fixtureIntake({ needs: ['food_now'], zip: '19129', utilityProviders: [] }), mandate: fixtureMandate({ mode: 'prepare_only',
        recipientIds: [SHARE_FOOD_ACCESS_PROGRAM], allowedActions: ['research', 'prepare'], allowedData: ['household'], expiresAt: new Date(Date.now() + 86400000).toISOString() }) });
    const body = buildFoodAccessPlanBody({ requestId: id, requestVersion: 2, generatedAt: at, sourceReviewCurrent: true }),
      plan = { ...body, planHash: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
    const negative = bindFoodAccessReport(plan, { expectedVersion: 2, siteId: plan.site.id, planHash: plan.planHash,
      reportKey: '33333333-3333-4333-8333-333333333333', result: 'need_another_way' }, { eventId: '44444444-4444-4444-8444-444444444444', reportedAt: at });
    const sites = [148, 149, 150].map(number => ({ id: number, name: `Original City listing ${number}: María y niña`, address: `${number} Original City address`, zip: '19129', category: 'Food Site',
      phoneNumber: '+1 (215) 555-0101', website: 'https://example.invalid/source-food', hours: [{ day: 'mon', windows: ['9am–2pm'], notes: 'Original City restriction; stock unknown.' }], serviceAreaNotes: 'Original City service area; no delivery confirmed.' }));
    let mode, saved, observation;
    const request = () => ({ ...initial, status: mode === 'closed' ? 'closed' : 'active', version: mode === 'closed' ? 3 : 2, closed_reason: mode === 'closed' ? 'completed' : null,
      plan: { version: 1, generatedAt: at, model: null, summary: 'Synthetic directory display only.', routes: [{ need: 'food_now', programId: SHARE_FOOD_ACCESS_PROGRAM,
        title: plan.site.name, summary: 'Synthetic directory display only.', state: saved.outcome, nextActor: 'caselink', steps: [], limitation: null,
        officialUrl: plan.source.operatorUrl, sourceUrl: plan.source.operatorUrl, foodAccess: plan, foodAccessReport: saved, foodAccessAlternatives: observation }] } });
    await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/parent/**', async route => {
      const path = new URL(route.request().url()).pathname, method = route.request().method();
      const json = value => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: JSON.stringify(value) });
      if (path === `/api/parent/requests/${id}/outcome` && method === 'POST') {
        const { action, ...input } = route.request().postDataJSON(); assert.equal(action, 'food_visit'); assert.equal(input.result, 'received_enough_food'); writes.push(input);
        saved = bindFoodAccessReport(plan, input, { eventId: '55555555-5555-4555-8555-555555555555', reportedAt: new Date(Date.parse(at) + 1000).toISOString() }); mode = 'positive';
        return json({ ok: true, report: saved });
      }
      assert.equal(method, 'GET', 'Only the explicit factual correction may write in this fixture.');
      if (path === '/api/parent/account') return json({ account: { id: initial.household_id, email: 'synthetic@example.invalid', preferences: { language: locale, contactPreference: 'in_app' } } });
      if (path === `/api/parent/requests/${id}`) return json({ request: request() });
      if (path.endsWith('/operations')) return json({ operations: [], historyLimited: false });
      if (path === '/api/parent/requests') return json({ requests: [request()] });
      if (path === '/api/parent/food-sites') { finderReads.push(path); return json({ sites: [], sourceUrl: 'https://www.phila.gov/food/', checkedAt: at, availability: 'city_listed_unconfirmed', moreSitesAvailable: false }); }
      return json({ capabilities: [] });
    });
    const panel = page.locator('#application-programs > section').first(), heading = locale === 'es' ? 'Otros lugares consultados para esta solicitud' : 'Other City listings checked for this request';
    const select = locale === 'es' ? '¿Esta opción de alimentos le sirvió?' : 'Did this food option work for you?';
    async function open(state) {
      mode = state; saved = state === 'positive' ? { ...negative, outcome: 'support_received', result: 'received_enough_food' } : negative;
      observation = state === 'pending' ? undefined : buildFoodAccessAlternatives({ request: initial, report: negative, zip: '19129', now: new Date(at),
        result: state === 'unavailable' ? null : { sites: state === 'empty' ? [] : sites, sourceUrl: 'https://www.phila.gov/food/', checkedAt: at, availability: 'city_listed_unconfirmed', moreSitesAvailable: state === 'listed' } });
      await page.goto(`${origin}/support/${id}`, { waitUntil: 'networkidle' });
      if (largeText) await page.addStyleTag({ content: 'html { font-size:200%; } [class*="shell"] { font-size:32px; }' });
      await page.getByText('Program progress', { exact: true }).first().click(); await panel.waitFor();
    }
    async function check(state) {
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(value => ({ id: value.id, targets: value.nodes.map(node => node.target) })), [], `${locale}/${width}/${state} axe`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Document fits viewport');
      const bounds = await panel.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, overflowing: [...element.querySelectorAll('*')].filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 1).map(node => ({ tag: node.tagName, classes: node.className, text: node.textContent, client: node.clientWidth, scroll: node.scrollWidth })) }));
      if (bounds.scroll > bounds.width + 1) {
        const prefix = `${evidence}/${locale}-${width}${largeText ? '-large-text' : ''}-${state}-overflow`;
        await writeFile(`${prefix}.json`, JSON.stringify(bounds, null, 2)); await panel.screenshot({ path: `${prefix}.png` });
      }
      assert.ok(bounds.scroll <= bounds.width + 1, `${locale}/${width}/${largeText}/${state} Food panel fits`);
      const clipping = await panel.locator('p,h2,h3,a,summary,label,button').evaluateAll(elements => elements.flatMap(element => {
        const box = element.getBoundingClientRect(); if (!box.height) return [];
        const range = document.createRange(); range.selectNodeContents(element); const text = range.getBoundingClientRect();
        return text.width && (text.left < box.left - 2 || text.right > box.right + 2) ? [element.textContent] : [];
      }));
      assert.deepEqual(clipping, [], `${locale}/${width}/${state} readable text and controls`); assert.deepEqual(errors, []);
      const fractured = await panel.locator('p,h2,h3,a,summary,label,button').evaluateAll(elements => elements.flatMap(element => {
        if (!element.getBoundingClientRect().height) return [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), result = [];
        for (let node; (node = walker.nextNode());) for (const match of node.textContent.matchAll(/\p{L}{4,}/gu)) {
          const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
          if (range.getClientRects().length > 1) result.push(match[0]);
        }
        return result;
      }));
      assert.deepEqual(fractured, [], `${locale}/${width}/${state} ordinary words remain readable`);
      if (['listed', 'unavailable', 'closed'].includes(state)) {
        const prefix = `${evidence}/${locale}-${width}${largeText ? '-large-text' : ''}-${state}`;
        await page.screenshot({ path: `${prefix}-full.png`, fullPage: true });
        const section = panel.getByRole('heading', { name: heading, exact: true });
        if (await section.count()) await section.scrollIntoViewIfNeeded(); else await panel.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${prefix}-viewport.png` });
      }
      results.push({ locale, width, largeText, state, axeViolations: 0, clipping: false });
    }
    for (const state of ['listed', 'empty', 'unavailable', 'pending', 'positive', 'closed']) {
      const reads = finderReads.length; await open(state);
      if (['positive', 'closed'].includes(state)) assert.equal(await panel.getByRole('heading', { name: heading, exact: true }).count(), 0);
      else { await panel.getByRole('heading', { name: heading, exact: true }).waitFor(); assert.equal(finderReads.length, reads, 'The family view does not perform the saved directory check.'); }
      if (state === 'listed') {
        await panel.getByRole('heading', { name: sites[0].name, exact: true }).waitFor();
        const summary = panel.locator('details summary').first(); await summary.focus(); await page.keyboard.press('Space');
        assert.equal(await summary.evaluate(element => element.parentElement.open), true, 'Keyboard opens source hours');
        await panel.getByText('9am–2pm', { exact: false }).first().waitFor();
        assert.equal(await panel.getByRole('link', { name: locale === 'es' ? 'Sitio web del lugar' : 'Location website' }).first().getAttribute('href'), sites[0].website);
        if (largeText) {
          const hours = panel.locator('details').first();
          await hours.scrollIntoViewIfNeeded();
          assert.ok(await hours.evaluate(element => Math.abs(element.querySelector('dd').getBoundingClientRect().width - element.querySelector('dl').getBoundingClientRect().width) <= 1), 'Mobile hours use the available text width');
          await page.screenshot({ path: `${evidence}/${locale}-320-large-text-hours-viewport.png` });
        }
      }
      await check(state); assert.equal(writes.length, 0, 'Viewing saved checks never writes.');
    }
    await open('listed'); await panel.getByLabel(select).selectOption('received_enough_food');
    await panel.getByRole('button', { name: locale === 'es' ? 'Guardar lo ocurrido' : 'Save food report', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: locale === 'es' ? 'Se guardó su informe' : 'Your food report is saved' }).waitFor();
    assert.equal(await panel.getByRole('heading', { name: heading, exact: true }).count(), 0); await check('corrected-positive');
    await page.reload({ waitUntil: 'networkidle' });
    if (largeText) await page.addStyleTag({ content: 'html { font-size:200%; } [class*="shell"] { font-size:32px; }' });
    await page.getByText('Program progress', { exact: true }).first().click(); await panel.waitFor();
    assert.equal(await panel.getByRole('heading', { name: heading, exact: true }).count(), 0); assert.equal(writes.length, 1); await check('positive-reentry');
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/results.json`, JSON.stringify({ boundary: 'Synthetic intercepted Auth/API; real built UI only. No native DB, model or provider evidence.', results }, null, 2));
console.log(`Saved food directory: ${results.length} language, width, keyboard, correction and re-entry checks passed.`);
