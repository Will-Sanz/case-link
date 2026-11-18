import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixtures from '../../src/lib/parent/test-fixtures.ts';
import food from '../../src/lib/parent/food-access.ts';
const { fixtureIntake, fixtureMandate, fixtureRequest } = fixtures;
const { buildFoodAccessPlanBody, bindFoodAccessReport, SHARE_FOOD_ACCESS_PROGRAM } = food;

// Only the real Next UI is exercised here; Auth, requests and reports are explicitly synthetic fixtures.
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3302';
const target = new URL(origin), evidence = 'tmp/parent-verification/food-access-locale/browser';
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password);
const copy = {
  en: { plan: 'Your food access plan', open: 'Your food need remains open', received: 'Your food report is recorded', question: 'Did this food option work for you?',
    save: 'Save food report', retry: 'Retry same report', saving: 'Saving report…', correct: 'Correct this food report',
    stock: /Stock is unknown and nothing is reserved/, unknown: /Retry the same report or refresh saved activity/, closed: /This request stays closed and no work has restarted/ },
  es: { plan: 'Su opción para obtener alimentos', open: 'Su necesidad de alimentos sigue abierta', received: 'Se registró su informe sobre alimentos', question: '¿Esta opción de alimentos le sirvió?',
    save: 'Guardar lo ocurrido', retry: 'Reintentar el mismo informe', saving: 'Guardando el informe…', correct: 'Corregir este informe sobre alimentos',
    stock: /No se sabe si hay alimentos y no hay nada reservado/, unknown: /Reintente el mismo informe o actualice la actividad guardada/, closed: /sigue cerrada y no se ha reiniciado ningún trabajo/ },
};
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true }), results = [];
try {
  for (const locale of ['en', 'es']) for (const [width, largeText] of [[320, false], [390, false], [1280, false], [320, true]]) {
    const c = copy[locale], suffix = `${locale}-${width}${largeText ? '-large-text' : ''}`;
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    const id = 'd430cc02-d8d4-46cc-9900-5b397758fb16', now = new Date().toISOString(), errors = [], attempts = [];
    const initial = fixtureRequest({ version: 2, intake: fixtureIntake({ needs: ['food_now'], zip: '19129', utilityProviders: [] }),
      mandate: fixtureMandate({ mode: 'prepare_only', recipientIds: [SHARE_FOOD_ACCESS_PROGRAM], allowedActions: ['research', 'prepare'], allowedData: ['household'], expiresAt: new Date(Date.now() + 86400000).toISOString() }) });
    const body = buildFoodAccessPlanBody({ requestId: id, requestVersion: 2, generatedAt: now, sourceReviewCurrent: true });
    const plan = { ...body, planHash: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
    let mode = 'prepared', saved = null, release;
    const request = () => ({ ...initial, status: mode === 'closed' ? 'closed' : mode === 'paused' ? 'paused' : 'active', version: mode === 'closed' ? 3 : 2,
      closed_reason: mode === 'closed' ? 'completed' : null, plan: { version: 1, generatedAt: now, model: null, summary: 'Synthetic food display rehearsal; no service is connected.',
        routes: [{ need: 'food_now', programId: SHARE_FOOD_ACCESS_PROGRAM, state: saved?.outcome === 'unresolved' ? 'unresolved' : 'prepared', nextActor: 'parent',
          title: plan.site.name, summary: 'Synthetic rehearsal only.', steps: [], limitation: null, officialUrl: plan.source.operatorUrl, sourceUrl: plan.source.operatorUrl,
          foodAccess: mode === 'invalid' ? { kind: 'invalid-synthetic-plan' } : plan, ...(saved && { foodAccessReport: saved }) }] } });
    await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/parent/**', async route => {
      const path = new URL(route.request().url()).pathname, method = route.request().method();
      const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: JSON.stringify(value) });
      if (path === `/api/parent/requests/${id}/outcome` && method === 'POST') {
        const { action, ...input } = route.request().postDataJSON(); assert.equal(action, 'food_visit'); attempts.push(route.request().postData());
        if (mode === 'unknown') return route.abort('connectionfailed');
        if (mode === 'saving') await new Promise(resolve => { release = resolve; });
        // A completed request's factual correction uses its current version without reopening the original plan.
        saved = { ...bindFoodAccessReport(plan, { ...input, expectedVersion: 2 }, { eventId: '22222222-2222-4222-8222-222222222222', reportedAt: now }), expectedVersion: input.expectedVersion };
        return json({ ok: true, report: saved });
      }
      assert.equal(method, 'GET', 'No other mutation or external provider is permitted in this display fixture.');
      if (path === '/api/parent/account') return json({ account: { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.invalid', preferences: { language: 'en', contactPreference: 'in_app' } } });
      if (path === `/api/parent/requests/${id}/operations`) return json({ operations: [], historyLimited: false });
      if (path === `/api/parent/requests/${id}`) return json({ request: request() });
      if (path === '/api/parent/requests') return json({ requests: [request()] });
      if (path === '/api/parent/food-sites') return json({ sites: [], sourceUrl: 'https://www.phila.gov/food/', checkedAt: now, availability: 'city_listed_unconfirmed', moreSitesAvailable: false });
      return json({ capabilities: [] });
    });
    const panel = page.locator('#application-programs > section').first();
    async function open(state) {
      mode = state; saved = state === 'closed' ? bindFoodAccessReport(plan, { expectedVersion: 2, siteId: plan.site.id, planHash: plan.planHash, reportKey: '33333333-3333-4333-8333-333333333333', result: 'received_enough_food' },
        { eventId: '22222222-2222-4222-8222-222222222222', reportedAt: now }) : null;
      await page.goto(`${origin}/support/${id}`, { waitUntil: 'networkidle' });
      if (largeText) await page.addStyleTag({ content: 'html { font-size: 200%; }' });
      const skip = page.locator('a[href="#main-content"]');
      assert.ok(await skip.evaluate(element => element.getBoundingClientRect().bottom <= 0), `${suffix} unfocused skip link stays offscreen at large text`);
      await page.keyboard.press('Tab'); assert.equal(await skip.evaluate(element => document.activeElement === element), true);
      assert.ok(await skip.evaluate(element => element.getBoundingClientRect().top >= 0), `${suffix} keyboard skip link is visible`);
      await page.keyboard.press('Tab');
      try { await page.getByText('Program progress', { exact: true }).first().click(); }
      catch (error) { await page.screenshot({ path: `${evidence}/${suffix}-fixture-error.png`, fullPage: true }); await writeFile(`${evidence}/${suffix}-fixture-error.txt`, `${errors.join('\n')}\n${await page.locator('body').innerText()}`); throw error; }
      await panel.waitFor(); assert.equal(await panel.getAttribute('lang'), locale);
    }
    async function check(state) {
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), [], `${suffix}/${state} accessibility`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${suffix}/${state} page overflow`);
      assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${suffix}/${state} panel overflow`);
      const viewportBounds = await panel.evaluate(element => {
        const rows = [];
        for (let node = element; node; node = node.parentElement) {
          const box = node.getBoundingClientRect(), css = getComputedStyle(node);
          rows.push({ tag: node.tagName, classes: node.className, left: box.left, right: box.right, width: box.width, padding: css.padding, overflow: css.overflow });
        }
        return { width: innerWidth, rows };
      });
      if (viewportBounds.rows[0].left < 0 || viewportBounds.rows[0].right > viewportBounds.width + 1) {
        await writeFile(`${evidence}/${suffix}-${state}-viewport-clipping.json`, JSON.stringify(viewportBounds, null, 2));
        assert.fail(`${suffix}/${state} panel extends outside viewport`);
      }
      const clipped = await panel.locator('p,h2,h3,a,label,button').evaluateAll(elements => elements.filter(element => {
        if (!element.getBoundingClientRect().height) return false;
        const range = document.createRange(); range.selectNodeContents(element);
        const text = range.getBoundingClientRect(), box = element.getBoundingClientRect();
        return text.width > 0 && (text.left < box.left - 2 || text.right > box.right + 2);
      }).map(element => ({ text: element.textContent, width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth })));
      if (clipped.length) await writeFile(`${evidence}/${suffix}-${state}-clipping.json`, JSON.stringify(clipped, null, 2));
      assert.deepEqual(clipped, [], `${suffix}/${state} text clipping`);
      assert.deepEqual(errors, [], `${suffix}/${state} browser errors`);
      if (['prepared', 'unknown', 'closed'].includes(state)) {
        await panel.screenshot({ path: `${evidence}/${suffix}-${state}.png` });
        const skip = page.locator('a[href="#main-content"]');
        assert.ok(await skip.evaluate(element => document.activeElement === element || element.getBoundingClientRect().bottom <= 0), `${suffix}/${state} unfocused skip link remains offscreen after inspection`);
        await panel.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY));
        await page.screenshot({ path: `${evidence}/${suffix}-${state}-viewport.png` });
      }
      results.push({ locale, width, largeText, state, axeViolations: 0, overflow: false });
    }
    await open('prepared'); await panel.getByText(c.stock).waitFor(); await check('prepared');
    assert.equal(attempts.length, 0, 'Viewing a food plan does not write a report.');
    await open('saving'); await panel.getByLabel(c.question).selectOption('no_food'); await panel.getByRole('button', { name: c.save, exact: true }).click();
    await panel.getByRole('button', { name: c.saving, exact: true }).waitFor(); await check('saving'); release();
    await panel.getByRole('heading', { name: c.open, exact: true }).waitFor(); await check('saved-unmet');
    await open('unknown'); await panel.getByLabel(c.question).selectOption('could_not_access'); await panel.getByRole('button', { name: c.save, exact: true }).click();
    await panel.getByText(c.unknown).waitFor(); await check('unknown'); mode = 'prepared';
    await panel.getByRole('button', { name: c.retry, exact: true }).click(); await panel.getByRole('heading', { name: c.open, exact: true }).waitFor();
    assert.equal(attempts.at(-1), attempts.at(-2), 'Lost acknowledgement retries use the same exact body and report key.'); await check('retried');
    await open('closed'); await panel.getByText(c.closed).waitFor(); await check('closed');
    await panel.getByRole('button', { name: c.correct, exact: true }).click(); await panel.getByLabel(c.question).selectOption('no_food');
    await panel.getByRole('button', { name: c.save, exact: true }).click(); await panel.getByRole('heading', { name: c.open, exact: true }).waitFor();
    await panel.getByText(c.closed).waitFor(); await check('closed-corrected');
    await open('paused'); assert.equal(await panel.getByRole('button', { name: c.save, exact: true }).isDisabled(), true); await check('paused');
    await open('invalid'); assert.equal(await panel.getByLabel(c.question).count(), 0); await check('invalid');
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/results.json`, JSON.stringify({ boundary: 'Synthetic intercepted Auth/API only; no native database, Storage, model or provider evidence.', results }, null, 2));
console.log(`Food access: ${results.length} language, viewport, report, retry and closed-request display states passed.`);
