import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Real Next screens with intercepted synthetic account/API data; no actual deletion, Auth or notification service.
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3305', url = new URL(origin);
assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && origin === url.origin && !url.username && !url.password);
const evidence = 'tmp/parent-verification/account-locale/browser';
const ownerId = '11111111-1111-4111-8111-111111111111';
const copy = {
  en: { title: 'Your account', updates: 'Support updates', start: 'Start', save: 'Save preferences', saving: 'Saving…', saved: 'Your preferences are saved for future requests and notifications.',
    summary: 'Delete my parent-support data & stop future work', token: 'Type DELETE to confirm', remove: 'Delete parent-support data & stop work', pending: 'Recording deletion…',
    recorded: 'Your deletion request is recorded', signOut: /couldn’t confirm sign-out/, failure: /Your signed-in account changed/, login: 'Sign in for deletion' },
  es: { title: 'Su cuenta', updates: 'Avisos sobre su apoyo', start: 'Inicio', save: 'Guardar preferencias', saving: 'Guardando…', saved: 'Sus preferencias se guardaron para futuras solicitudes de apoyo y avisos.',
    summary: 'Eliminar mis datos de apoyo familiar y detener el trabajo futuro', token: 'Escriba DELETE para confirmar', remove: 'Eliminar datos de apoyo familiar y detener el trabajo', pending: 'Registrando la eliminación…',
    recorded: 'Se registró su solicitud de eliminación', signOut: /no pudimos confirmar el cierre de sesión/, failure: /La cuenta con la sesión iniciada cambió/, login: 'Iniciar sesión para eliminar datos' },
};
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true }), results = [];
try {
  for (const locale of ['en', 'es']) for (const [width, largeText] of [[320, false], [390, false], [1280, false], [320, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage(), c = copy[locale], suffix = `${locale}-${width}${largeText ? '-large-text' : ''}`;
    let mode = 'initial', release;
    let preferences = { contactPreference: 'in_app', language: 'en', quietHoursStart: 21, quietHoursEnd: 8 };
    const mutations = [], errors = [];
    await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/parent/**', async route => {
      const path = new URL(route.request().url()).pathname, method = route.request().method();
      const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: JSON.stringify(data) });
      if (method === 'POST') {
        const body = route.request().postDataJSON(); mutations.push({ path, body });
        if (path === '/api/parent/auth') return mode === 'signout_failure' ? route.abort('connectionfailed') : json({ ok: true });
        assert.equal(path, '/api/parent/account');
        if (body.action === 'preferences') {
          assert.equal(body.preferences.language, 'en', 'Screen language never changes program contact language silently.'); preferences = body.preferences;
          if (mode === 'preference_pending') await new Promise(resolve => { release = resolve; });
          return mode === 'save_error' ? json({ ok: false, error: 'We couldn’t save your preferences. Please try again.' }, 503) : json({ ok: true });
        }
        assert.deepEqual(body, { action: 'delete', confirmation: 'DELETE', expectedOwnerId: ownerId });
        if (mode === 'delete_pending') await new Promise(resolve => { release = resolve; });
        return mode === 'delete_error' ? json({ ok: false, error: 'Your signed-in account changed. Reload before confirming deletion.' }, 409) : json({ ok: true });
      }
      assert.equal(method, 'GET');
      if (path === '/api/parent/account/deletion') return mode === 'metadata_error' ? json({ ok: false, error: 'Synthetic unrecognized account issue' }, 503) : mode === 'login' ? json({ ok: false, error: 'Sign in again.' }, 401)
        : json({ ok: true, ownerId, status: mode === 'already_deleted' ? 'deletion_requested' : mode === 'unknown' ? 'unknown' : 'active' });
      if (path === '/api/parent/account') return json({ account: { id: ownerId, email: `familia-${'ejemplo'.repeat(7)}@${'correo'.repeat(7)}.example.invalid`, preferences } });
      return json({ capabilities: [] });
    });
    const main = page.locator('#main-content');
    async function open(state, deletionOnly = false) {
      mode = state; preferences = { contactPreference: 'in_app', language: 'en', quietHoursStart: 21, quietHoursEnd: 8 };
      await page.goto(`${origin}/account${deletionOnly ? '?delete=1' : ''}`, { waitUntil: 'networkidle' });
      if (largeText) await page.addStyleTag({ content: 'html { font-size: 200%; }' });
      assert.match(await page.title(), new RegExp(c.title));
      const robots = await page.locator('meta[name="robots"]').getAttribute('content');
      assert.ok(robots?.includes('noindex') && robots.includes('nofollow'), 'Private account metadata keeps both indexing controls.');
      await main.getByRole('heading', { level: 1 }).waitFor();
    }
    async function check(state) {
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(expected => document.title.includes(expected), c.title);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), [], `${suffix}/${state} accessibility`);
      const clipping = await main.locator('h1,h2,p,label,legend,summary,button,a').evaluateAll(elements => elements.filter(element => {
        if (!element.getBoundingClientRect().height) return false;
        const text = document.createRange(); text.selectNodeContents(element); const bounds = text.getBoundingClientRect(), box = element.getBoundingClientRect();
        return bounds.width > 0 && (bounds.left < box.left - 2 || bounds.right > box.right + 2 || box.right > innerWidth + 1 || box.left < -1);
      }).map(element => element.textContent));
      if (clipping.length) { await page.screenshot({ path: `${evidence}/${suffix}-${state}-failure.png` }); await writeFile(`${evidence}/${suffix}-${state}-failure.json`, JSON.stringify(clipping, null, 2)); }
      assert.deepEqual(clipping, [], `${suffix}/${state} text or viewport clipping`); assert.deepEqual(errors, []);
      if (['save_error', 'delete_error', 'signout_failure'].includes(state)) {
        const alert = main.getByRole('alert');
        assert.equal(await alert.evaluate(element => document.activeElement === element), true, `${suffix}/${state} error receives focus`);
        const bounds = await alert.boundingBox(); assert.ok(bounds && bounds.y < 900 && bounds.y + bounds.height > 0, `${suffix}/${state} error is visible`);
      }
      const broken = await main.locator('p,label,legend,summary,button,a').evaluateAll(elements => elements.flatMap(element => {
        if (!element.checkVisibility() || element.textContent.includes('@')) return [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), words = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const word of node.textContent.matchAll(/\p{L}{4,}/gu)) {
          const range = document.createRange(); range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
          if (range.getClientRects().length > 1) words.push(word[0]);
        }
        return words;
      }));
      if (broken.length) { await page.screenshot({ path: `${evidence}/${suffix}-${state}-words-failure.png` }); await writeFile(`${evidence}/${suffix}-${state}-words-failure.json`, JSON.stringify(broken, null, 2)); }
      assert.deepEqual([...new Set(broken)], [], `${suffix}/${state} ordinary word readability`);
      if (['initial', 'delete_recorded', 'delete_error'].includes(state)) await page.screenshot({ path: `${evidence}/${suffix}-${state}.png` });
      results.push({ locale, width, largeText, state, axeViolations: 0, clipping: false });
    }
    async function remove() {
      await main.getByText(c.summary, { exact: true }).click();
      await main.getByLabel(c.token).fill('ELIMINAR'); assert.equal(await main.getByRole('button', { name: c.remove, exact: true }).isDisabled(), true);
      await main.getByLabel(c.token).fill('DELETE'); await main.getByRole('button', { name: c.remove, exact: true }).click();
    }
    await open('initial'); await main.getByLabel(c.updates).waitFor(); await check('initial'); assert.equal(mutations.length, 0);
    await main.getByLabel(c.updates).focus(); await page.keyboard.press('Tab');
    assert.equal(await main.getByLabel(locale === 'es' ? 'Idioma preferido para el servicio' : 'Preferred service language').evaluate(element => document.activeElement === element), true, 'Preferences remain reachable in normal keyboard order.');
    await open('preference_pending'); await main.getByRole('button', { name: c.save, exact: true }).focus(); await page.keyboard.press('Enter');
    await main.getByRole('button', { name: c.saving, exact: true }).waitFor(); await check('preference_pending'); release(); await main.getByText(c.saved).waitFor(); mode = 'initial';
    await main.getByLabel(c.start, { exact: true }).selectOption('20'); await main.getByRole('button', { name: c.save, exact: true }).click(); await main.getByText(c.saved).waitFor(); await check('saved');
    await open('save_error'); await main.getByRole('button', { name: c.save, exact: true }).click(); await main.getByRole('alert').waitFor(); await check('save_error');
    await open('delete_pending'); await remove(); await main.getByRole('button', { name: c.pending, exact: true }).waitFor(); await check('delete_pending'); release();
    await main.getByRole('heading', { name: c.recorded, exact: true }).waitFor(); await check('delete_recorded');
    await open('signout_failure'); await remove(); await main.getByRole('alert').filter({ hasText: c.signOut }).waitFor(); await check('signout_failure');
    await open('delete_error'); await remove(); await main.getByRole('alert').filter({ hasText: c.failure }).waitFor(); await check('delete_error');
    await open('login', true); assert.equal(await main.getByRole('link', { name: c.login, exact: true }).getAttribute('href'), '/sign-in?purpose=delete-parent-data'); await check('login');
    await open('already_deleted', true); await main.getByRole('heading', { name: c.recorded, exact: true }).waitFor(); await check('already_deleted');
    await open('unknown', true); await main.getByRole('alert').waitFor(); assert.equal(await main.getByLabel(c.token).count(), 0); await check('unknown');
    await open('metadata_error', true); const rawError = main.getByText('Synthetic unrecognized account issue', { exact: true });
    await rawError.waitFor(); assert.equal(await rawError.getAttribute('lang'), 'en'); assert.equal(await main.getByLabel(c.token).count(), 0); await check('metadata_error');
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/results.json`, JSON.stringify({ boundary: 'Intercepted synthetic account/Auth/API only; no native account, actual preference save or deletion evidence.', results }, null, 2));
console.log(`Account: ${results.length} language, viewport, preference and deletion states passed.`);
