import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixtures from '../../src/lib/parent/test-fixtures.ts';
const { fixtureIntake, fixtureMandate, fixtureRequest } = fixtures;

// Render the real secret-free Next UI. Every Auth/application response and file below is a labeled synthetic fixture.
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3301';
const target = new URL(origin), evidence = 'tmp/parent-verification/documents-locale/browser';
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password,
  'Document display verification is loopback and synthetic only.');
const copy = {
  en: { heading: 'Bills & documents', add: 'Add a document or take a photo', choose: 'Choose a bill or notice', camera: 'Take a photo', upload: 'Upload privately',
    pending: 'Uploading securely…', remove: 'Delete', privacy: 'Read document privacy details.', manual: /You can enter information yourself instead/,
    empty: 'No documents added. Optional uploads do not hold up your request.', expiry: 'Raw file expires', date: 'Nov 17, 2026', status: 'uploaded',
    raw: 'Original file removed; validated facts remain', notice: /Its initial expiry is seven days after upload/,
    saved: 'Document saved privately. Its processing status will appear here.', deleted: /Information already delivered to a program may not be recallable/,
    unsafe: /Use a plain JPEG, PNG or unencrypted PDF with up to five pages, or enter information manually/ },
  es: { heading: 'Facturas y documentos', add: 'Añadir un documento o tomar una foto', choose: 'Elegir una factura o un aviso', camera: 'Tomar una foto', upload: 'Cargar de forma privada',
    pending: 'Cargando de forma segura…', remove: 'Eliminar', privacy: 'Leer los detalles de privacidad de los documentos.', manual: /Puede introducir la información manualmente/,
    empty: 'No se han añadido documentos. Las cargas opcionales no retrasan su solicitud de apoyo.', expiry: 'El archivo original vence el', date: '17 nov 2026', status: 'cargado',
    raw: 'Se eliminó el archivo original; los datos validados se conservan', notice: /Su plazo inicial de conservación es de siete días/,
    saved: 'El documento se guardó de forma privada. Su estado aparecerá aquí.', deleted: /no se pueda retirar la información ya entregada a un programa/,
    unsafe: /de hasta cinco páginas, o introduzca la información manualmente/ },
};
const unsafeMessage = "We couldn't read this file safely. Use a plain JPEG, PNG or unencrypted PDF with up to five pages, or enter information manually.";
const unknownMessage = 'Unrecognized recorded service issue';
const longFilename = 'Aviso_de_José_' + 'información-del-hogar-'.repeat(7) + '2026.pdf';
const requestId = 'd430cc02-d8d4-46cc-9900-5b397758fb16';
const recordedDocument = (id, filename, status) => ({ id, request_id: requestId, filename, media_type: 'application/pdf', size_bytes: 34,
  status, expires_at: '2026-11-18T02:30:00Z', created_at: '2026-11-11T02:30:00Z' });
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true }), results = [];
try {
  for (const locale of ['en', 'es']) for (const [width, largeText] of [[320, false], [390, false], [1280, false], [320, true]]) {
    const c = copy[locale], suffix = `${locale}-${width}${largeText ? '-large-text' : ''}`;
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    let documents = [], closed = false, uploadMode = 'pending', releaseUpload;
    const mutations = [], errors = [], blockedOrigins = [];
    const request = () => fixtureRequest({ id: requestId, status: closed ? 'closed' : 'active', closed_reason: closed ? 'completed' : null,
      intake: fixtureIntake({ needs: ['food_now'], utilityProviders: [], zip: '19104' }), documents,
      mandate: fixtureMandate({ mode: 'prepare_only', recipientIds: ['philly-food'], allowedActions: ['research', 'prepare'], allowedData: ['household', 'documents'], expiresAt: new Date(Date.now() + 86400000).toISOString() }) });
    const progress = { state: 'waiting', summary: 'Synthetic document display fixture; no service or program work is connected.', updatedAt: '2026-11-18T02:30:00Z', nextRunAt: null, canContinueAfterClosing: false };
    await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.origin === 'http://127.0.0.1:55321') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Synthetic Auth fixture; no service connected."}' });
      blockedOrigins.push(url.origin); return route.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/parent/**', async route => {
      const path = new URL(route.request().url()).pathname, method = route.request().method();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: JSON.stringify(body) });
      if (path === '/api/parent/account') return json({ account: { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.invalid', preferences: { language: 'en', contactPreference: 'in_app' } } });
      if (path === `/api/parent/requests/${requestId}/documents` && method === 'POST') {
        assert.ok(!closed, 'A closed request never submits a new file.');
        const bytes = route.request().postDataBuffer();
        assert.ok(bytes?.includes(Buffer.from('synthetic document bytes')), 'Only explicit synthetic file bytes may be uploaded to this fixture.');
        assert.match(route.request().headers()['content-type'], /^multipart\/form-data;/);
        assert.match(bytes.toString(), /name="consent"\r\n\r\n1\r\n/);
        mutations.push({ method, kind: 'synthetic-file', mode: uploadMode });
        if (uploadMode === 'unsafe') return json({ ok: false, error: unsafeMessage }, 400);
        if (uploadMode === 'unknown') return json({ ok: false, error: unknownMessage }, 503);
        await new Promise(resolve => { releaseUpload = resolve; });
        documents = [...documents, recordedDocument('44444444-4444-4444-8444-444444444444', 'Foto de José.png', 'processing')];
        const uploadedDocument = documents.at(-1);
        return json({ ok: true, receipt: { state: 'confirmed', document: { ...uploadedDocument,
          upload_key: route.request().headers()['idempotency-key'], upload_confirmed_at: new Date().toISOString(),
        } } }, 201);
      }
      if (path.startsWith(`/api/parent/requests/${requestId}/documents/`) && method === 'DELETE') {
        const id = path.split('/').at(-1); assert.ok(documents.some(document => document.id === id));
        mutations.push({ method, id }); documents = documents.filter(document => document.id !== id); return json({ ok: true });
      }
      if (path === `/api/parent/requests/${requestId}/documents` && new URL(route.request().url()).searchParams.has('uploadKey')) return json({ ok: false, error: 'This upload is unavailable.' }, 404);
      assert.equal(method, 'GET', 'Only explicit synthetic document writes are allowed by this browser fixture.');
      if (path === `/api/parent/requests/${requestId}/operations`) return json({ operations: [], historyLimited: false });
      if (path === `/api/parent/requests/${requestId}`) return json({ request: request(), progress });
      if (path === '/api/parent/requests') return json({ requests: [request()], progress: { [requestId]: progress } });
      if (path === '/api/parent/food-sites') return json({ sites: [], sourceUrl: 'https://www.phila.gov/food/', checkedAt: new Date().toISOString(), availability: 'city_listed_unconfirmed', moreSitesAvailable: false });
      return json({ capabilities: [] });
    });
    const section = page.locator('#application-documents section');
    async function openDocuments() {
      await page.goto(`${origin}/support/${requestId}`, { waitUntil: 'networkidle' });
      if (largeText) await page.addStyleTag({ content: 'html { font-size: 200%; }' });
      await page.getByText('Your documents', { exact: true }).click();
      await section.getByRole('heading', { name: c.heading, exact: true }).waitFor();
      assert.equal(await section.getAttribute('lang'), locale);
      await page.evaluate(() => { const note = document.createElement('aside'); note.lang = 'en'; note.textContent = 'Synthetic document rehearsal: no real account, file, upload, program or model is connected.'; document.body.prepend(note); });
    }
    async function check(name) {
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), [], `${name} accessibility`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} document overflow`);
      assert.ok(await section.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name} document-panel overflow`);
      const clipping = await section.locator('button,label,p,strong,summary').evaluateAll(elements => elements.filter(element => {
        if (!element.getBoundingClientRect().height) return false;
        const range = document.createRange(); range.selectNodeContents(element); const text = range.getBoundingClientRect(), box = element.getBoundingClientRect();
        return text.width > 0 && (text.left < box.left - 2 || text.right > box.right + 2);
      }).map(element => element.textContent));
      assert.deepEqual(clipping, [], `${name} clipped document labels`);
      const buttons = await section.locator('button').evaluateAll(elements => elements.filter(element => {
        const box = element.getBoundingClientRect(); return box.height > 0 && (box.height < 44 || box.width < 44);
      }).map(element => element.textContent));
      assert.deepEqual(buttons, [], `${name} readable document action targets`);
      const brokenWords = await section.locator('p,label span,button,summary').evaluateAll(elements => elements.flatMap(element => {
        if (!element.checkVisibility()) return [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), broken = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.parentElement.closest('strong')) continue; // A supplied filename may legitimately wrap anywhere.
          for (const word of node.textContent.matchAll(/\p{L}{4,}/gu)) {
            const range = document.createRange(); range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
            if (range.getClientRects().length > 1) broken.push(word[0]);
          }
        }
        return broken;
      }));
      if (brokenWords.length) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${evidence}/failure-${name}-${suffix}.png`, fullPage: true });
        const alert = section.getByRole('alert'), status = section.getByRole('status'), checkbox = section.getByRole('checkbox');
        if (await alert.isVisible()) await alert.scrollIntoViewIfNeeded();
        else if (await status.isVisible()) await status.scrollIntoViewIfNeeded();
        else if (await checkbox.isVisible()) await checkbox.locator('..').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${evidence}/failure-${name}-${suffix}-viewport.png` });
      }
      assert.deepEqual([...new Set(brokenWords)], [], `${name} ordinary words must remain readable without mid-word wrapping`);
      await page.evaluate(() => window.scrollTo(0, 0));
      const screenshot = `${evidence}/${name}-${suffix}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      let viewportScreenshot;
      if (['recorded', 'consent', 'unsafe-file'].includes(name)) {
        const focus = name === 'consent' ? section.getByText(c.notice) : name === 'unsafe-file' ? section.getByRole('alert') : section.getByRole('heading', { name: c.heading, exact: true });
        await focus.scrollIntoViewIfNeeded();
        viewportScreenshot = `${evidence}/${name}-${suffix}-viewport.png`;
        await page.screenshot({ path: viewportScreenshot });
      }
      const geometry = await section.evaluate(element => ({ paddingLeft: getComputedStyle(element).paddingLeft, contentWidth: element.clientWidth - parseFloat(getComputedStyle(element).paddingLeft) - parseFloat(getComputedStyle(element).paddingRight) }));
      results.push({ name, locale, width, largeText, screenshot, viewportScreenshot, geometry, axeViolations: 0 });
    }
    try {
      await openDocuments();
      await section.getByText(c.empty, { exact: true }).waitFor();
      await section.getByText(c.manual).waitFor();
      assert.equal(await section.locator('input[type=file]').count(), 0);
      await check('empty');
      documents = [recordedDocument('22222222-2222-4222-8222-222222222222', 'Aviso de José.pdf', 'uploaded'),
        recordedDocument('33333333-3333-4333-8333-333333333333', longFilename, 'validated'),
        recordedDocument('55555555-5555-4555-8555-555555555555', 'Factura original.pdf', 'raw_deleted')];
      await openDocuments();
      await section.getByText(longFilename, { exact: true }).waitFor();
      assert.equal(await section.getByText(c.status, { exact: true }).getAttribute('lang'), locale);
      assert.ok((await section.innerText()).includes(c.expiry + ' ' + c.date));
      await section.getByText(c.raw, { exact: true }).waitFor();
      await check('recorded');
      const summary = section.locator('summary');
      await summary.focus(); await page.keyboard.press('Enter');
      assert.equal(await section.locator('details').getAttribute('open'), '');
      await section.getByText(c.notice).waitFor();
      assert.equal(await section.locator('input[type=file]').count(), 0, 'Consent precedes either file or camera input.');
      assert.equal(await section.getByRole('link', { name: c.privacy, exact: true }).getAttribute('href'), '/support/privacy#documents');
      await page.keyboard.press('Tab');
      assert.equal(await section.getByRole('checkbox').evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab');
      assert.equal(await section.getByRole('link', { name: c.privacy, exact: true }).evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Tab');
      assert.equal(await section.getByLabel(c.choose, { exact: true }).evaluate(element => element === document.activeElement), true);
      assert.equal(await section.getByLabel(c.camera, { exact: true }).getAttribute('capture'), 'environment');
      await check('consent');
      const syntheticFile = { name: 'Foto de José.png', mimeType: 'image/png', buffer: Buffer.from('synthetic document bytes') };
      await section.getByLabel(c.camera, { exact: true }).setInputFiles(syntheticFile);
      await section.getByRole('checkbox').uncheck();
      assert.equal(await section.locator('input[type=file]').count(), 0);
      await section.getByRole('checkbox').check();
      assert.equal(await section.getByRole('button', { name: c.upload, exact: true }).isDisabled(), true, 'Withdrawing consent clears the chosen file.');
      await section.getByLabel(c.camera, { exact: true }).setInputFiles(syntheticFile);
      const posting = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/documents') && request.method() === 'POST');
      await section.getByRole('button', { name: c.upload, exact: true }).focus(); await page.keyboard.press('Enter'); await posting;
      await section.getByRole('button', { name: c.pending, exact: true }).waitFor();
      assert.equal(await section.getByRole('button', { name: c.pending, exact: true }).isDisabled(), true);
      await check('pending');
      assert.equal(typeof releaseUpload, 'function'); releaseUpload(); releaseUpload = undefined;
      await section.getByRole('status').filter({ hasText: c.saved }).waitFor();
      assert.equal(await section.locator('input[type=file]').count(), 0);
      await check('saved');
      await section.getByRole('checkbox').check();
      await section.getByLabel(c.choose, { exact: true }).setInputFiles({ ...syntheticFile, name: 'Aviso inseguro.pdf', mimeType: 'application/pdf' });
      uploadMode = 'unsafe'; await section.getByRole('button', { name: c.upload, exact: true }).click();
      await section.getByRole('alert').filter({ hasText: c.unsafe }).waitFor();
      assert.equal(await section.getByRole('alert').getAttribute('lang'), locale);
      await section.getByText('Aviso inseguro.pdf', { exact: true }).waitFor();
      await check('unsafe-file');
      uploadMode = 'unknown'; await section.getByRole('button', { name: c.upload, exact: true }).click();
      await section.getByRole('alert').filter({ hasText: unknownMessage }).waitFor();
      assert.equal(await section.getByRole('alert').getAttribute('lang'), 'en');
      await check('unknown-error');
      await section.getByRole('button', { name: `${c.remove} Aviso de José.pdf`, exact: true }).click();
      await section.getByRole('status').filter({ hasText: c.deleted }).waitFor();
      assert.equal(await section.getByRole('button', { name: `${c.remove} Aviso de José.pdf`, exact: true }).count(), 0);
      await check('deletion');
      closed = true; await openDocuments();
      assert.equal(await section.locator('details,input[type=file]').count(), 0);
      await section.getByRole('button', { name: `${c.remove} Factura original.pdf`, exact: true }).click();
      await section.getByRole('status').filter({ hasText: c.deleted }).waitFor();
      await check('closed-no-capture');
      assert.deepEqual(mutations.map(item => item.method), ['POST', 'POST', 'POST', 'DELETE', 'DELETE']);
      assert.deepEqual(errors, []); assert.deepEqual(blockedOrigins, [], 'No external network request is permitted.');
    } finally { releaseUpload?.(); await context.close(); }
  }
  await writeFile(`${evidence}/results.json`, JSON.stringify({ kind: 'Real Next production UI with synthetic Auth/HTTP/file fixtures only; no actual upload or integration claim', origin, checks: results }, null, 2) + '\n');
  console.log(JSON.stringify({ checks: results.length, axeViolations: 0, evidence }));
} finally { await browser.close(); }
