import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3300';
const target = new URL(origin), evidence = 'tmp/parent-verification/public-info-locale/browser';
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password, 'Public information verification is local and synthetic only.');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true }), results = [];
try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    const errors = [], blockedOrigins = [], writes = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.origin === 'http://127.0.0.1:55321') return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      blockedOrigins.push(url.origin); return route.abort();
    });
    await page.route('**/api/parent/**', async route => {
      if (route.request().method() !== 'GET') { writes.push(new URL(route.request().url()).pathname); return route.abort(); }
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Synthetic public page: no account connected.' }) });
    });
    page.on('pageerror', error => errors.push(error.message));
    async function settle(title) { await page.waitForFunction(value => document.title === value, title); await page.waitForLoadState('networkidle'); }
    async function language(locale, title) {
      const path = new URL(page.url()).pathname;
      const refreshed = page.waitForResponse(response => response.request().headers().rsc === '1' && new URL(response.url()).pathname === path);
      await page.getByLabel(/Screen language|Idioma de pantalla/).selectOption(locale);
      await refreshed; await settle(title);
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
    }
    async function check(name, title, locale) {
      await settle(title);
      await page.evaluate(() => { if (!document.querySelector('[data-synthetic-info]')) { const note = document.createElement('aside'); note.dataset.syntheticInfo = 'true'; note.lang = 'en'; note.textContent = 'Synthetic interface verification: no account, data processing or program action.'; document.body.prepend(note); } });
      const axe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(axe.violations, [], JSON.stringify(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' must fit the viewport');
      assert.equal(await page.locator('main > :is(article,div)[lang]').first().getAttribute('lang'), locale);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true });
      results.push({ name, width, locale, title, axeViolations: 0 });
    }
    await page.goto(origin + '/support/help');
    await page.getByRole('heading', { name: 'Help, without another hurdle.', exact: true }).waitFor();
    await page.getByLabel('Philadelphia ZIP code', { exact: true }).fill('19129');
    await check('help-en', 'Help & direct support | CaseLink', 'en');
    await language('es', 'Ayuda y apoyo directo | CaseLink');
    await page.getByRole('heading', { name: 'Ayuda sin más obstáculos.', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Philadelphia ZIP code', { exact: true }).inputValue(), '19129');
    assert.equal(await page.getByLabel('Philadelphia ZIP code', { exact: true }).evaluate(input => input.closest('[lang]')?.lang), 'en');
    assert.equal(await page.getByRole('link', { name: 'restablezca su contraseña actual' }).getAttribute('href'), '/forgot-password?ui=es');
    await check('help-es', 'Ayuda y apoyo directo | CaseLink', 'es');
    await page.getByRole('link', { name: 'Lea el aviso de privacidad', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(origin + '/support/privacy');
    await page.getByRole('heading', { name: 'Su información. Su control.', exact: true }).waitFor();
    assert.equal(await page.locator('article a[href="mailto:willsanz23@gmail.com"]').count(), 1);
    assert.equal(await page.locator('a[href="https://developers.openai.com/api/docs/guides/your-data"]').getAttribute('rel'), 'noreferrer');
    for (const id of ['data-policy', 'family-profile', 'snap-application', 'documents']) assert.equal(await page.locator('#' + id).count(), 1);
    await check('privacy-es', 'Privacidad y política de datos | CaseLink', 'es');
    if (width === 320) {
      const style = await page.addStyleTag({ content: 'html { font-size: 200%; }' });
      await check('privacy-es-large-text', 'Privacidad y política de datos | CaseLink', 'es');
      await style.evaluate(node => node.remove());
    }
    await page.goto(origin + '/support/terms');
    await page.getByRole('heading', { name: 'Expectativas claras para recibir apoyo.', exact: true }).waitFor();
    await check('terms-es', 'Términos del servicio | CaseLink', 'es');
    await language('en', 'Terms of service | CaseLink');
    await page.getByRole('heading', { name: 'Clear expectations for support.', exact: true }).waitFor();
    await check('terms-en', 'Terms of service | CaseLink', 'en');
    await page.goto(origin + '/support/privacy');
    await page.getByRole('heading', { name: 'Your information. Your control.', exact: true }).waitFor();
    await check('privacy-en', 'Privacy & data policy | CaseLink', 'en');
    if (width === 320) {
      const style = await page.addStyleTag({ content: 'html { font-size: 200%; }' });
      await check('privacy-en-large-text', 'Privacy & data policy | CaseLink', 'en');
      await style.evaluate(node => node.remove());
    }
    assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(blockedOrigins, []);
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/results.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ checks: results.length, localSynthetic: true, results }));
