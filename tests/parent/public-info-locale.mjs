import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Actual built pages; every API response below is synthetic. No account or external program is contacted.
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3308', target = new URL(origin);
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password);
const evidence = 'tmp/parent-verification/public-info-locale/browser', results = [];
await mkdir(evidence, { recursive: true });
const copy = {
  en: { help: 'Help, without another hurdle.', privacy: 'Your information. Your control.', terms: 'Clear expectations for support.', zip: 'Philadelphia ZIP code', search: 'Find food locations', loading: 'Checking the City’s food listings', hours: 'Listed hours & service details', error: 'We couldn’t finish this step', retry: 'Try again', empty: /Nearby help may still be available/, privacyLink: 'Read the privacy notice', helpLink: 'Help' },
  es: { help: 'Ayuda sin más obstáculos.', privacy: 'Su información. Su control.', terms: 'Expectativas claras para recibir apoyo.', zip: 'Código postal de Filadelfia', search: 'Buscar lugares con alimentos', loading: 'Consultando la lista municipal de alimentos', hours: 'Horarios y detalles publicados', error: 'No pudimos completar este paso', retry: 'Intentarlo de nuevo', empty: /Puede haber ayuda en lugares cercanos/, privacyLink: 'Lea el aviso de privacidad', helpLink: 'Ayuda' },
};
const titles = {
  en: { help: 'Help & direct support', privacy: 'Privacy & data policy', terms: 'Terms of service' },
  es: { help: 'Ayuda y apoyo directo', privacy: 'Privacidad y política de datos', terms: 'Términos del servicio' },
};
const site = { id: 1, name: 'Synthetic source location', address: '100 Example Street', zip: '19104', category: 'Senior Meal Site', hours: [{ day: 'mon', windows: ['09:00–11:00'], notes: 'Check before travel' }], serviceAreaNotes: 'Check with the site.' };
const browser = await chromium.launch({ headless: true });
try {
  for (const locale of ['es', 'en']) for (const [width, largeText] of [[320, true], [320, false], [390, false], [1280, false]]) {
    const c = copy[locale], suffix = `${locale}-${width}${largeText ? '-full200' : ''}`;
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage(), errors = [], requests = [], blocked = [];
    let mode = 'list', release;
    await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin) return route.continue(); blocked.push(url.origin); return route.abort(); });
    await page.route('**/api/parent/**', async route => {
      const url = new URL(route.request().url()); requests.push({ path: url.pathname, method: route.request().method() });
      assert.equal(route.request().method(), 'GET', 'Public page checks never mutate account or request data.');
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
      if (url.pathname !== '/api/parent/food-sites') return json({ ok: false, error: 'Synthetic public page: no account.' }, 401);
      assert.equal(url.searchParams.get('zip'), '19104');
      if (mode === 'loading') await new Promise(resolve => { release = resolve; });
      if (mode === 'error') return json({ ok: false, error: "The City's food directory is unavailable right now. Use the official food and meal finder or try again." }, 503);
      return json({ ok: true, sites: mode === 'empty' ? [] : [site], sourceUrl: 'https://www.phila.gov/food/', checkedAt: '2026-11-18T14:00:00Z', availability: 'city_listed_unconfirmed', moreSitesAvailable: false });
    });
    page.on('pageerror', error => errors.push(error.message));
    const main = page.locator('#main-content'), listings = main.locator('section[aria-labelledby="food-sites-title"]');
    async function enlarge() {
      if (largeText) { await page.addStyleTag({ content: 'html{font-size:200%}' }); await main.evaluate(el => { el.parentElement.style.fontSize = '32px'; }); }
      assert.equal(await main.evaluate(el => getComputedStyle(el).fontSize), largeText ? '32px' : '16px');
    }
    async function open(name) {
      await page.goto(`${origin}/support/${name}`, { waitUntil: 'networkidle' }); await main.getByRole('heading', { name: c[name], exact: true }).waitFor(); await enlarge();
      await page.getByRole('button', { name: locale === 'es' ? 'Pedir ayuda a CaseLink' : 'Ask CaseLink for assistance', exact: true }).click();
      await page.getByRole('button', { name: locale === 'es' ? 'Ocultar el botón flotante' : 'Hide floating button', exact: true }).click();
      assert.equal(await main.evaluate(el => document.activeElement === el), true);
    }
    async function check(state) {
      await page.waitForFunction(expected => document.title === expected, titles[locale][new URL(page.url()).pathname.split('/').at(-1)] + ' | CaseLink');
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const issues = await main.evaluate(root => {
        const problems = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node; node = walker.nextNode();) {
          const element = node.parentElement;
          if (!element?.checkVisibility() || element.closest('select,textarea,a[href^="mailto:"]')) continue;
          const box = element.getBoundingClientRect(), css = getComputedStyle(element);
          if (box.width <= 1 && box.height <= 1 && (css.clip !== 'auto' || css.clipPath !== 'none')) continue;
          for (const word of node.textContent.matchAll(/\p{L}{4,}/gu)) {
            const range = document.createRange(); range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
            const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
            if (new Set(rects.map(rect => Math.round(rect.top))).size > 1 || rects.some(rect => rect.left < -1 || rect.right > innerWidth + 1)) {
              if (!problems.length) element.dataset.infoFracture = 'true';
              problems.push({ word: word[0], text: element.textContent, width: element.getBoundingClientRect().width });
            }
          }
        }
        return problems;
      });
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const violations = axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }));
      if (issues.length || violations.length) { await writeFile(`${evidence}/${suffix}-${state}-failure.json`, JSON.stringify({ issues, violations }, null, 2)); if (issues.length) await main.locator('[data-info-fracture]').first().scrollIntoViewIfNeeded(); }
      await page.screenshot({ path: `${evidence}/${suffix}-${state}-viewport.png` });
      if (['privacy', 'terms', 'help-initial'].includes(state)) await page.screenshot({ path: `${evidence}/${suffix}-${state}.png`, fullPage: true });
      assert.deepEqual(issues, [], `${suffix}/${state} ordinary words must remain whole and within the viewport`);
      assert.deepEqual(violations, [], `${suffix}/${state} accessibility`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      assert.equal(await main.locator(':scope > [lang]').first().getAttribute('lang'), locale);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      results.push({ locale, width, largeText, state, mainFont: largeText ? 32 : 16, axeViolations: 0, wordFractures: 0 });
    }
    async function keyboardFollow(link, pathname) {
      assert.equal(await link.getAttribute('href'), pathname);
      await link.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert.equal(await link.evaluate(el => document.activeElement === el), true);
      const visible = await link.evaluate(el => { const box = el.getBoundingClientRect(), css = getComputedStyle(el); return box.top >= 0 && box.bottom <= innerHeight && css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0; });
      assert.equal(visible, true, 'Keyboard focus scrolls the destination link into view with its outline.');
      await page.keyboard.press('Enter'); await page.waitForURL(origin + pathname); await page.waitForLoadState('networkidle'); await enlarge();
    }
    await open('privacy');
    for (const id of ['data-policy', 'family-profile', 'snap-application', 'documents']) assert.equal(await main.locator('#' + id).count(), 1);
    assert.equal(await main.getByRole('link', { name: 'willsanz23@gmail.com' }).getAttribute('href'), 'mailto:willsanz23@gmail.com');
    assert.equal(await main.locator('a[href="https://developers.openai.com/api/docs/guides/your-data"]').getAttribute('rel'), 'noreferrer');
    await check('privacy');
    await open('terms'); await check('terms');
    await keyboardFollow(main.getByRole('link', { name: c.helpLink, exact: true }), '/support/help');
    await main.getByRole('heading', { name: c.help, exact: true }).waitFor();
    await check('help-initial');
    await listings.getByLabel(c.zip).fill('19000'); await listings.getByRole('button', { name: c.search }).click();
    assert.equal(await listings.getByLabel(c.zip).getAttribute('aria-invalid'), 'true');
    assert.equal(requests.filter(request => request.path.endsWith('/food-sites')).length, 0); await check('help-invalid');
    await listings.getByLabel(c.zip).fill('19104'); mode = 'loading'; await listings.getByRole('button', { name: c.search }).click();
    await listings.getByRole('status', { name: c.loading }).waitFor(); await check('help-loading'); mode = 'list'; release();
    await listings.getByRole('heading', { name: site.name }).waitFor(); await listings.getByText(c.hours, { exact: true }).click();
    assert.equal(await listings.getByRole('heading', { name: site.name }).getAttribute('lang'), '');
    assert.equal(await listings.getByText(site.serviceAreaNotes, { exact: true }).getAttribute('lang'), '');
    await check('help-list');
    for (const state of ['empty', 'error']) {
      mode = state; await open('help'); await listings.getByLabel(c.zip).fill('19104'); await listings.getByRole('button', { name: c.search }).click();
      await listings.getByText(state === 'empty' ? c.empty : c.error, { exact: state === 'error' }).waitFor(); await check('help-' + state);
    }
    mode = 'list'; await listings.getByRole('button', { name: c.retry }).click(); await listings.getByRole('heading', { name: site.name }).waitFor(); await check('help-retried');
    for (const value of [locale === 'es' ? 'en' : 'es', locale]) {
      await page.getByLabel(/Screen language|Idioma de pantalla/).selectOption(value);
      await main.getByRole('heading', { name: copy[value].help, exact: true }).waitFor(); await page.waitForLoadState('networkidle'); await enlarge();
      await page.waitForFunction(expected => document.title === expected, titles[value].help + ' | CaseLink');
      assert.equal(await listings.getByLabel(copy[value].zip).inputValue(), '19104');
      assert.equal(await listings.getByRole('heading', { name: site.name }).getAttribute('lang'), '');
    }
    await check('help-return-use');
    assert.equal(await main.getByRole('link', { name: locale === 'es' ? 'restablezca su contraseña actual' : 'reset your existing password' }).getAttribute('href'), `/forgot-password?ui=${locale}`);
    await keyboardFollow(main.getByRole('link', { name: c.privacyLink, exact: true }), '/support/privacy');
    await main.getByRole('heading', { name: c.privacy, exact: true }).waitFor();
    assert.ok(requests.every(request => request.method === 'GET'));
    await context.close(); console.log(`${suffix}: 10 complete-page and embedded-tool states passed.`);
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/results.json`, JSON.stringify({ boundary: 'Actual built public pages; synthetic directory/API responses; no native Auth, provider, legal-comprehension or real-family claim.', results }, null, 2));
console.log(`Fixed information pages: ${results.length} checks passed.`);
