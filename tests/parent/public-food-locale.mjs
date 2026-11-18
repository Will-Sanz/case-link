import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Actual Next screens with a synthetic public-directory boundary; no provider, Auth or outcome claim.
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3305', target = new URL(origin);
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password);
const evidence = 'tmp/parent-verification/public-food-locale/browser', results = [];
await mkdir(evidence, { recursive: true });
const copy = {
  en: { title: "Let's find food support that works for your family.", zip: 'Philadelphia ZIP code', search: 'Find food locations', loading: 'Checking the City’s food listings', hours: 'Listed hours & service details', expand: 'See 1 more city-listed locations', fewer: 'Show fewer locations', alternatives: 'More food options and a no-paperwork fridge', options: 'See my options', result: 'Your proposed next steps', direct: 'Open the City’s full food finder', error: 'We couldn’t finish this step', retry: 'Try again', empty: /Nearby help may still be available/, listed: /This is a directory check, not confirmation from a location/, unknown: /Your benefit history is still unknown/ },
  es: { title: 'Busquemos apoyo alimentario para su familia.', zip: 'Código postal de Filadelfia', search: 'Buscar lugares con alimentos', loading: 'Consultando la lista municipal de alimentos', hours: 'Horarios y detalles publicados', expand: 'Ver más lugares de la lista municipal (1)', fewer: 'Mostrar menos lugares', alternatives: 'Más opciones de alimentos y una nevera sin papeleo', options: 'Ver mis opciones', result: 'Sus próximos pasos propuestos', direct: 'Abrir el buscador de alimentos de la Ciudad', error: 'No pudimos completar este paso', retry: 'Intentarlo de nuevo', empty: /Puede haber ayuda en lugares cercanos/, listed: /Es una consulta del directorio, no una confirmación del lugar/ },
};
const sites = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, name: `Synthetic source location ${i + 1}`, address: '100 Example Street', zip: '19104', category: 'Senior Meal Site', phoneNumber: '215-555-0123', website: 'https://example.test/', hours: [{ day: 'mon', windows: ['09:00–11:00'], notes: 'Call before traveling' }], serviceAreaNotes: 'Confirm eligibility with the location.' }));
const browser = await chromium.launch({ headless: true });
try {
  for (const locale of ['en', 'es']) for (const [width, largeText] of [[320, false], [390, false], [1280, false], [320, true]]) {
    const c = copy[locale], suffix = `${locale}-${width}${largeText ? '-large-text' : ''}`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: locale === 'es' ? 'es-US' : 'en-US' }), page = await context.newPage(), errors = [], requests = [];
    let mode = 'list', release;
    await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/parent/**', async route => {
      const url = new URL(route.request().url()); requests.push({ path: url.pathname, query: url.search, method: route.request().method() });
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
      if (url.pathname !== '/api/parent/food-sites') return json({ ok: false, error: 'Sign in.' }, 401);
      assert.equal(route.request().method(), 'GET'); assert.equal(url.searchParams.get('zip'), '19104');
      if (mode === 'loading') await new Promise(resolve => { release = resolve; });
      if (mode === 'error') return json({ ok: false, error: "The City's food directory is unavailable right now. Use the official food and meal finder or try again." }, 503);
      return json({ ok: true, sites: mode === 'empty' ? [] : sites, sourceUrl: 'https://www.phila.gov/food/', checkedAt: '2026-11-18T14:00:00Z', availability: 'city_listed_unconfirmed', moreSitesAvailable: true });
    });
    const main = page.locator('#main-content'), listings = main.locator('section[aria-labelledby="food-sites-title"]');
    await page.goto(`${origin}/get-support?need=food`, { waitUntil: 'networkidle' });
    await main.getByRole('heading', { name: c.title, exact: true }).waitFor();
    if (largeText) { await page.addStyleTag({ content: 'html{font-size:200%}' }); await main.evaluate(el => { el.parentElement.style.fontSize = '32px'; }); assert.equal(await main.evaluate(el => getComputedStyle(el).fontSize), '32px'); }
    async function check(state, scope = main) {
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const issues = await scope.locator('h1,h2,h3,p,label,legend,summary,button,a,dt,dd').evaluateAll(elements => elements.flatMap(el => {
        if (!el.checkVisibility()) return [];
        const b = el.getBoundingClientRect(), css = getComputedStyle(el);
        if (b.width <= 1 && b.height <= 1 && (css.clip !== 'auto' || css.clipPath !== 'none')) return [];
        const r = document.createRange(); r.selectNodeContents(el); const text = r.getBoundingClientRect();
        const problems = text.width && (text.left < b.left - 2 || text.right > b.right + 2 || b.left < -1 || b.right > innerWidth + 1) ? ['clipping'] : [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) for (const word of n.textContent.matchAll(/\p{L}{4,}/gu)) {
          const range = document.createRange(); range.setStart(n, word.index); range.setEnd(n, word.index + word[0].length); if (range.getClientRects().length > 1) problems.push(word[0]);
        }
        return problems.length ? [{ text: el.textContent, problems }] : [];
      }));
      const violations = axe.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }));
      if (issues.length || violations.length) { await writeFile(`${evidence}/${suffix}-${state}-failure.json`, JSON.stringify({ issues, violations }, null, 2)); const target = issues[0] && main.getByText(issues[0].text, { exact: true }).last(); if (target && await target.count()) await target.scrollIntoViewIfNeeded(); }
      await page.screenshot({ path: `${evidence}/${suffix}-${state}.png` });
      assert.deepEqual(violations, [], `${suffix}/${state} accessibility`); assert.deepEqual(issues, [], `${suffix}/${state} readable text`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      results.push({ locale, width, largeText, state });
    }
    await check('guide');
    await page.locator('#food-guide-enough').selectOption('no'); await page.locator('#food-guide-history').selectOption('applied'); await main.getByRole('button', { name: c.options, exact: true }).click();
    await main.getByRole('heading', { name: c.result }).waitFor(); await page.waitForFunction(() => document.activeElement?.id === 'food-guide-results'); await check('guide-results');
    await listings.getByLabel(c.zip).fill('19000'); await listings.getByRole('button', { name: c.search }).click();
    assert.equal(await listings.getByLabel(c.zip).getAttribute('aria-invalid'), 'true'); assert.equal(await listings.getByLabel(c.zip).getAttribute('aria-describedby'), await listings.getByRole('alert').getAttribute('id')); assert.equal(requests.filter(x => x.path.endsWith('/food-sites')).length, 0); await check('invalid');
    await listings.getByLabel(c.zip).fill('19104'); mode = 'loading'; await listings.getByRole('button', { name: c.search }).click(); await listings.getByRole('status', { name: c.loading }).waitFor(); await check('loading'); mode = 'list'; release();
    await listings.getByRole('heading', { name: 'Synthetic source location 1' }).waitFor(); await listings.getByText(c.listed).waitFor(); await check('list');
    await listings.getByText(c.hours, { exact: true }).first().click(); await listings.getByRole('button', { name: c.expand, exact: true }).click();
    assert.equal(await listings.getByRole('heading', { name: 'Synthetic source location 4' }).getAttribute('lang'), ''); assert.equal(await listings.getByText('Confirm eligibility with the location.', { exact: true }).first().getAttribute('lang'), ''); await check('expanded');
    await listings.getByRole('button', { name: c.fewer }).click(); await listings.getByText(c.alternatives, { exact: true }).click(); await check('alternatives');
    assert.equal(await listings.getByRole('link', { name: c.direct, exact: true }).getAttribute('href'), 'https://www.phila.gov/food/');
    // Re-open the screen to keep the synthetic contract exact to19104.
    async function reopen(state) { mode = state; await page.reload({ waitUntil: 'networkidle' }); if (largeText) { await page.addStyleTag({ content: 'html{font-size:200%}' }); await main.evaluate(el => { el.parentElement.style.fontSize = '32px'; }); } await listings.getByLabel(c.zip).fill('19104'); await listings.getByRole('button', { name: c.search }).click(); }
    await reopen('empty'); await listings.getByText(c.empty).waitFor(); await check('empty');
    await reopen('error'); await listings.getByText(c.error, { exact: true }).waitFor(); await listings.getByText(locale === 'es' ? /El directorio de alimentos de la Ciudad no está disponible/ : /The City's food directory is unavailable/).waitFor(); await check('error'); mode = 'list'; await listings.getByRole('button', { name: c.retry }).click(); await listings.getByRole('heading', { name: 'Synthetic source location 1' }).waitFor(); await check('retried');
    assert.ok(requests.every(x => x.method === 'GET'), 'No account, request, provider or storage mutation.');
    await page.goto(`${origin}/support/help`, { waitUntil: 'networkidle' });
    if (largeText) { await page.addStyleTag({ content: 'html{font-size:200%}' }); await main.evaluate(el => { el.parentElement.style.fontSize = '32px'; }); }
    assert.equal(await listings.getAttribute('lang'), locale);
    await listings.getByLabel(c.zip).fill('19104'); mode = 'error'; await listings.getByRole('button', { name: c.search }).click(); await listings.getByText(c.error, { exact: true }).waitFor(); await listings.scrollIntoViewIfNeeded(); await check('help-error', listings);
    mode = 'list'; await listings.getByRole('button', { name: c.retry }).click(); await listings.getByRole('heading', { name: 'Synthetic source location 1' }).waitFor(); await listings.getByText(c.hours, { exact: true }).first().click(); await listings.getByText(c.hours, { exact: true }).first().scrollIntoViewIfNeeded(); await check('help-hours', listings);
    await context.close();
    console.log(`${suffix}: 12 public food states passed.`);
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/results.json`, JSON.stringify({ boundary: 'Actual Next; synthetic public-directory HTTP; no native/provider/family/live claim.', results }, null, 2));
console.log(`Public food: ${results.length} language, viewport, 200% text, guide, source and recovery states passed.`);
