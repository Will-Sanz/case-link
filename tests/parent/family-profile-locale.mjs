import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Actual Next screens; intercepted synthetic Auth/profile responses do not establish native storage or live processing.
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3305', target = new URL(origin);
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password);
const evidence = 'tmp/parent-verification/family-profile-locale/browser', results = [];
await mkdir(evidence, { recursive: true });
const owner = '11111111-1111-4111-8111-111111111111', person = '22222222-2222-4222-8222-222222222222', previous = '33333333-3333-4333-8333-333333333333';
const text = {
  en: { title: 'Your family information', name: 'Your first name', consent: /I have permission to provide these family details/, save: 'Save and finish later', pending: 'Saving family information…', retry: 'Retry the same family save', add: 'Add a person living with you', member: 'Member 1 first name', income: 'Your income source inventory', addIncome: 'Add your income source', home: 'Home address (optional)', mailing: 'Mailing address (optional)', homeStreet: 'Home address street address', saved: 'Your family information is saved. You can finish it later or continue to support.', conflict: 'Load latest family information', remove: 'Remove saved family information', confirmRemoval: 'Confirm removal of saved family information', removed: 'Your saved family information was removed. Existing support requests keep their own recorded history.', reaffirm: 'Confirm your first name is still current' },
  es: { title: 'Su información familiar', name: 'Su nombre', consent: /Tengo permiso para proporcionar estos datos familiares/, save: 'Guardar y terminar después', pending: 'Guardando información familiar…', retry: 'Reintentar el mismo guardado familiar', add: 'Agregar a una persona que vive con usted', member: 'Nombre del integrante 1', income: 'Su inventario de ingresos', addIncome: 'Agregar fuente de ingresos · Usted', home: 'Domicilio (opcional)', mailing: 'Dirección postal (opcional)', homeStreet: 'Domicilio: Calle y número', saved: 'Su información familiar está guardada. Puede completarla después o continuar para obtener apoyo.', conflict: 'Cargar la información familiar más reciente', remove: 'Eliminar la información familiar guardada', confirmRemoval: 'Confirmar la eliminación de la información familiar guardada', removed: 'Su información familiar guardada se eliminó. Las solicitudes de apoyo existentes conservan su propio historial registrado.', reaffirm: 'Confirme que este dato sigue vigente: Su nombre' },
};
const leaves = (value, prefix = '') => Array.isArray(value) ? value.length ? Object.assign({}, ...value.map(item => leaves(item, `${prefix}.${item.id}`))) : { [prefix]: [] }
  : value && typeof value === 'object' ? Object.assign({}, ...Object.entries(value).filter(([key]) => key !== 'id').map(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key))) : { [prefix]: value };
const browser = await chromium.launch({ headless: true });
try {
  for (const locale of ['en', 'es']) for (const [width, largeText] of [[320, false], [390, false], [1280, false], [320, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: locale === 'es' ? 'es-US' : 'en-US' }), page = await context.newPage(), c = text[locale], suffix = `${locale}-${width}${largeText ? '-large-text' : ''}`;
    let mode, profile, release; const mutations = [], errors = [];
    await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/parent/**', async route => {
      const path = new URL(route.request().url()).pathname, method = route.request().method();
      const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: JSON.stringify(data) });
      if (path !== '/api/parent/family-profile') return json({ capabilities: [] });
      if (method === 'GET') return json({ ok: true, ...profile });
      const raw = route.request().postData(), body = JSON.parse(raw), key = route.request().headers()['idempotency-key'];
      mutations.push({ method, raw, key }); assert.equal(body.expectedOwnerId, owner); assert.equal(body.expectedRevision, profile.revision);
      if (mode === 'pending') await new Promise(resolve => { release = resolve; });
      if (mode === 'unknown') return json({ ok: false, error: 'We couldn’t confirm that change. Check the saved information and retry the same change.' }, 503);
      if (mode === 'conflict') return json({ ok: false, error: 'Your saved family information changed. Your unsaved draft is still here. Load the latest information before replacing it.' }, 409);
      const revision = profile.revision + 1;
      if (method === 'POST') {
        assert.equal(body.consentAccepted, true); assert.equal(body.subjectAuthorityDeclared, true); assert.equal(body.noticeVersion, 'family-profile-2026-11-17.v1');
        const confirmedAt = new Date().toISOString(), expiresAt = new Date(Date.parse(confirmedAt) + 45 * 86400000).toISOString();
        profile = { ...profile, revision, lastMutationKey: key, profile: { revision, details: body.details, provenance: Object.fromEntries(Object.keys(leaves(body.details)).map(path => [path, { confirmedAt, expiresAt }])), idempotencyKey: key } };
      } else { assert.equal(method, 'DELETE'); assert.deepEqual(body, { expectedOwnerId: owner, expectedRevision: profile.revision }); profile = { ...profile, revision, lastMutationKey: key, profile: null }; }
      return json({ ok: true, revision }, method === 'POST' ? 201 : 200);
    });
    const main = page.locator('#main-content');
    async function open(state) {
      mode = state; mutations.length = 0;
      const confirmedAt = new Date(Date.now() - 86400000).toISOString(), expiresAt = new Date(Date.parse(confirmedAt) + 45 * 86400000).toISOString();
      const details = { primaryPerson: { id: person, firstName: 'Morgan', lastName: 'Example' }, contact: { phone: '215-555-0101' } };
      profile = { ownerId: owner, revision: state === 'blank' ? 0 : 1, collection: { collectionEnabled: state !== 'closed', noticeVersion: 'family-profile-2026-11-17.v1', expiresAt: new Date(Date.now() + 3600000).toISOString(), retentionDays: 45 }, profile: state === 'blank' ? null : { revision: 1, details, provenance: Object.fromEntries(Object.keys(leaves(details)).map(path => [path, { confirmedAt, expiresAt }])), idempotencyKey: previous }, lastMutationKey: state === 'blank' ? null : previous };
      if (state === 'expired') profile.profile.provenance['primaryPerson.firstName'].expiresAt = new Date(Date.now() + 10000).toISOString();
      await page.goto(`${origin}/family-profile?next=%2Fget-support%3Fneed%3Dfood_now`, { waitUntil: 'networkidle' });
      if (largeText) await page.addStyleTag({ content: 'html{font-size:200%}' });
      try { await main.getByLabel(c.name, { exact: true }).waitFor(); }
      catch (error) {
        await page.screenshot({ path: `${evidence}/${suffix}-${state}-open-failure.png` });
        await writeFile(`${evidence}/${suffix}-${state}-open-failure.json`, JSON.stringify({ state, errors, visible: (await main.textContent())?.slice(0, 2000), dates: profile.profile?.provenance }, null, 2));
        throw error;
      }
      await page.waitForFunction(title => document.title.includes(title), c.title);
      assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex.*nofollow/);
    }
    async function check(state) {
      await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(item => ({ id: item.id, target: item.nodes.map(node => node.target) })), [], `${suffix}/${state} accessibility`);
      const problems = await page.locator('#main-content :is(h1,h2,h3,p,label,legend,summary,button,a),footer :is(p,a)').evaluateAll(elements => elements.flatMap(element => {
        if (!element.checkVisibility()) return [];
        const box = element.getBoundingClientRect(), css = getComputedStyle(element);
        if (box.width <= 1 && box.height <= 1 && (css.clip !== 'auto' || css.clipPath !== 'none')) return [];
        const range = document.createRange(); range.selectNodeContents(element); const text = range.getBoundingClientRect();
        const issues = text.width > 0 && (text.left < box.left - 2 || text.right > box.right + 2 || box.left < -1 || box.right > innerWidth + 1) ? ['clipping'] : [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const word of node.textContent.matchAll(/\p{L}{4,}/gu)) {
          const r = document.createRange(); r.setStart(node, word.index); r.setEnd(node, word.index + word[0].length); if (r.getClientRects().length > 1) issues.push(word[0]);
        }
        return issues.length ? [{ element: element.textContent, issues }] : [];
      }));
      if (problems.length) {
        await writeFile(`${evidence}/${suffix}-${state}-failure.json`, JSON.stringify(problems, null, 2));
        await main.getByText(problems[0].element, { exact: true }).last().scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${evidence}/${suffix}-${state}-failure-closeup.png` });
      }
      await page.screenshot({ path: `${evidence}/${suffix}-${state}.png` });
      assert.deepEqual(problems, [], `${suffix}/${state} readable text`); assert.deepEqual(errors, []);
      if (['unknown', 'conflict', 'retried', 'removed'].includes(state)) {
        const result = ['unknown', 'conflict'].includes(state) ? main.getByRole('alert').locator('..') : main.getByText(state === 'removed' ? c.removed : c.saved, { exact: true });
        assert.equal(await result.evaluate(element => document.activeElement === element), true, `${suffix}/${state} result focus`);
        const bounds = await result.boundingBox();
        if (!bounds || bounds.y >= 900 || bounds.y + bounds.height <= 0) await writeFile(`${evidence}/${suffix}-${state}-result-bounds.json`, JSON.stringify(bounds, null, 2));
        assert.ok(bounds && bounds.y < 900 && bounds.y + bounds.height > 0, `${suffix}/${state} result visible`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, 'Profile content remains out of browser storage.');
      results.push({ locale, width, largeText, state, axeViolations: 0, clipping: false });
    }
    await open('blank'); await check('blank');
    await main.getByRole('button', { name: c.add, exact: true }).click();
    assert.equal(await main.getByLabel(c.member, { exact: true }).evaluate(element => document.activeElement === element), true, 'New member receives keyboard focus.');
    await main.getByLabel(c.member, { exact: true }).fill('Casey');
    await main.getByText(locale === 'es' ? 'Fuentes de ingresos (opcionales) · Usted' : 'Your income sources (optional)', { exact: true }).click();
    await main.getByLabel(c.income, { exact: true }).selectOption('sources'); await main.getByLabel(c.addIncome, { exact: true }).selectOption('employment');
    await main.getByText(c.home, { exact: true }).click(); await main.getByText(c.mailing, { exact: true }).click();
    await main.getByLabel(c.homeStreet, { exact: true }).fill('100 Fictional Street'); await check('expanded');
    await open('saved'); assert.equal(await main.getByLabel(c.name, { exact: true }).inputValue(), 'Morgan'); await check('saved');
    await open('pending'); await main.getByRole('checkbox', { name: c.consent }).check(); await main.getByRole('button', { name: c.save, exact: true }).click();
    await main.getByRole('button', { name: c.pending, exact: true }).waitFor(); await check('pending'); release(); await main.getByText(c.saved, { exact: true }).waitFor();
    await open('unknown'); await main.getByLabel(c.name, { exact: true }).fill('Changed'); await main.getByRole('checkbox', { name: c.consent }).check(); await main.getByRole('button', { name: c.save, exact: true }).click();
    await main.getByRole('button', { name: c.retry, exact: true }).waitFor(); await check('unknown'); const first = { ...mutations[0] }; mode = 'saved';
    await main.getByRole('button', { name: c.retry, exact: true }).click(); await main.getByText(c.saved, { exact: true }).waitFor(); assert.deepEqual(mutations[1], first, 'Unknown save retries exact body/key.'); await check('retried');
    await open('conflict'); await main.getByLabel(c.name, { exact: true }).fill('Changed'); await main.getByRole('checkbox', { name: c.consent }).check(); await main.getByRole('button', { name: c.save, exact: true }).click();
    await main.getByRole('button', { name: c.conflict, exact: true }).waitFor(); assert.equal(await main.getByLabel(c.name, { exact: true }).inputValue(), 'Changed'); await check('conflict');
    await open('closed'); assert.equal(await main.getByLabel(c.name, { exact: true }).isDisabled(), true); await check('closed');
    await page.clock.install(); await open('expired'); await page.clock.fastForward(11000); await main.getByRole('checkbox', { name: c.reaffirm, exact: true }).waitFor(); await check('expired');
    await open('remove'); await main.getByText(c.remove, { exact: true }).click(); await main.getByRole('button', { name: c.confirmRemoval, exact: true }).click(); await main.getByText(c.removed, { exact: true }).waitFor(); await check('removed');
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/results.json`, JSON.stringify({ boundary: 'Actual Next; synthetic Auth/profile HTTP; no native, provider, family or live claim.', results }, null, 2));
console.log(`Family information: ${results.length} language, viewport, consent, recovery and removal states passed.`);
