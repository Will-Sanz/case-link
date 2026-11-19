import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import descriptionCopy from '../../src/lib/parent/food-description-copy.ts';
import assessmentCopy from '../../src/lib/parent/food-assessment-copy.ts';
import assessment from '../../src/lib/parent/food-assessment.ts';
import programs from '../../src/lib/parent/programs.ts';
import localeCopy from '../../src/lib/parent/locale.ts';
const { foodDescriptionCopy } = descriptionCopy, { foodAssessmentCopy } = assessmentCopy;
const { foodAssessmentInputSchema, assessFoodSupport } = assessment, { getProgramsForNeeds } = programs;
const { parentText } = localeCopy;
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3307', target = new URL(origin);
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password,
  'Description verification is loopback and synthetic only.');
const evidence = 'tmp/parent-verification/food-description/browser'; await mkdir(evidence, { recursive: true });
const owner = '11111111-1111-4111-8111-111111111111', draftId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333', zipSource = '44444444-4444-4444-8444-444444444444';
const browser = await chromium.launch({ headless: true }), checks = [], routingOnly = process.argv.includes('--routing-large-only');
try {
  for (const width of routingOnly ? [320] : [320, 390, 1280]) for (const locale of ['en', 'es']) for (const mode of !routingOnly && width === 390 ? ['new', 'snap-existing', 'food-existing'] : ['new']) {
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
    const page = await context.newPage(), c = foodDescriptionCopy[locale], q = foodAssessmentCopy[locale];
    const errors = [], outside = [], queues = [], resolves = [], starts = [], preflights = [];
    let enabled = false, signedIn = false, draft = null, queueUnknown = true, resolveUnknown = true;
    const now = Date.now(), createdAt = new Date(now).toISOString(), contentExpiresAt = new Date(now + 86400000).toISOString(), metadataExpiresAt = new Date(now + 172800000).toISOString();
    let result = { state: 'needs_clarification', proposedAnswers: { foodForTwoDays: 'no', benefitHistory: 'not_sure', existingIssue: null }, needIds: ['food_now'],
      questionIds: ['benefitHistory'], existingRequests: [], excludedNeedIds: [], outOfScope: null, executionGranted: false, conflicts: [] };
    if (mode !== 'new') {
      enabled = signedIn = true;
      draft = { id: draftId, revision: 1, state: 'result', noticeVersion: 'food-description-2026-11-18.v1', consentedAt: createdAt, createdAt, contentExpiresAt, metadataExpiresAt,
        input: { description: 'Food and grocery support.', screenLocale: locale }, projection: null, selection: null, queueKey: null, sameChargedContext: true, usage: [] };
      result = { ...result, state: 'proposal', questionIds: [], proposedAnswers: { foodForTwoDays: 'no', benefitHistory: mode === 'snap-existing' ? 'applied' : 'never', existingIssue: null },
        needIds: [mode === 'snap-existing' ? 'food_now' : 'snap_new'], existingRequests: [{ requestId: '55555555-5555-4555-8555-555555555555', needIds: [mode === 'snap-existing' ? 'snap_pending' : 'food_now'] }] };
    }
    const archive = () => ({ ownerId: owner, available: enabled, drafts: draft ? [draft] : [] });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.origin === 'http://127.0.0.1:55321') return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      outside.push(url.origin); return route.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/parent/**', async route => {
      const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
      const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store', ...headers }, body: JSON.stringify(body) });
      if (path.endsWith('/food-description/availability')) return json({ available: enabled });
      if (path.endsWith('/food-description')) {
        if (!signedIn) return json({ ok: false, error: 'Synthetic sign-in required.' }, 401);
        if (method === 'GET' && url.searchParams.has('draft')) return enabled ? json({ result }) : json({ ok: false, code: 'unavailable' }, 403);
        if (method === 'GET') return json(url.searchParams.has('download') ? { foodDescriptions: archive() } : { archive: archive() }, 200,
          url.searchParams.has('download') ? { 'Content-Disposition': 'attachment; filename="synthetic-food-description.json"' } : {});
        const body = route.request().postDataJSON(); assert.equal(body.expectedOwnerId, owner);
        if (body.action === 'create') {
          assert.equal(draft, null); assert.equal(body.noticeVersion, 'food-description-2026-11-18.v1'); assert.equal(body.consentAccepted, true); assert.equal(body.input, undefined);
          draft = { id: draftId, revision: 0, state: 'empty', noticeVersion: body.noticeVersion, consentedAt: createdAt, createdAt, contentExpiresAt, metadataExpiresAt,
            input: null, projection: null, selection: null, queueKey: null, sameChargedContext: false, usage: [] };
          return json({ draftId, revision: 0 });
        }
        assert.ok(draft && body.draftId === draftId);
        if (body.action === 'queue') {
          queues.push(route.request().postData()); assert.equal(body.input.screenLocale, locale); assert.equal(body.expectedRevision, 0);
          if (queueUnknown) { queueUnknown = false; return route.abort(); }
          assert.equal(queues[0], queues[1]); draft = { ...draft, revision: 1, state: 'queued', input: body.input, queueKey: body.idempotencyKey };
          return json({ draftId, revision: 1 });
        }
        if (body.action === 'resolve') {
          resolves.push(route.request().postData()); assert.equal(body.expectedRevision, resolves.length > 2 ? 2 : 1); assert.deepEqual(body.changedQuestionIds, resolves.length > 2 ? [] : ['benefitHistory']);
          assert.deepEqual(body.answers, { foodForTwoDays: 'no', benefitHistory: 'applied', existingIssue: null });
          draft = { ...draft, revision: 2 }; result = { ...result, state: 'proposal', proposedAnswers: body.answers, needIds: ['food_now', 'snap_pending'], questionIds: [] };
          if (resolveUnknown) { resolveUnknown = false; return route.abort(); }
          assert.equal(resolves[0], resolves[1]); return json({ draftId, revision: 2 });
        }
        if (body.action === 'cancel') { draft = { ...draft, state: 'cancelled', input: null, projection: null, selection: null }; return json({ cancelled: true }); }
        throw new Error('Unexpected synthetic description mutation.');
      }
      if (path.endsWith('/account')) return signedIn ? json({ account: { id: owner, email: 'synthetic@example.invalid', preferences: { language: 'en', contactPreference: 'in_app' } } }) : json({ error: 'Synthetic sign-in required.' }, 401);
      if (path.endsWith('/authorization-window')) return json({ authorization: { issuedAt: createdAt, expiresAt: contentExpiresAt, snapApplication: { collectionEnabled: false, noticeVersion: null } } });
      if (path.endsWith('/food-assessment')) {
        const input = foodAssessmentInputSchema.parse(route.request().postDataJSON()); preflights.push(input); assert.deepEqual(input.descriptionSource, { draftId, revision: draft.revision });
        return json({ ownerId: owner, candidates: assessFoodSupport(input.answers).filter(path => input.needs.includes(path.need)).map(path => ({ ...path,
          programs: getProgramsForNeeds([path.need]).map(program => ({ programId: program.id, actions: [] })) })) });
      }
      if (path.endsWith('/intake-defaults')) return json({ ownerId: owner, zip: { value: '19129', sourceRequestId: zipSource, sourceVersion: 1, confirmedAt: new Date(now - 86400000).toISOString(), expiresAt: new Date(now + 44 * 86400000).toISOString() } });
      if (path.endsWith('/requests') && method === 'POST') {
        starts.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
        if (starts.length === 1) return route.abort(); assert.deepEqual(starts[0], starts[1]); return json({ request: { id: requestId } });
      }
      if (path.endsWith('/food-sites')) return json({ sites: [], sourceUrl: 'https://www.phila.gov/food/', checkedAt: createdAt, availability: 'city_listed_unconfirmed', moreSitesAvailable: false });
      assert.equal(method, 'GET', 'This fixture permits only its explicit bounded mutations.'); return json({ capabilities: [] });
    });
    async function check(name, large = width === 320 && ['consent-before-text', 'owned-empty-draft', 'ready-food-optional-question', 'change-understood-answers', 'vetted-options', 'start-unknown'].includes(name)) {
      if (routingOnly && name !== 'current-routing-choice') return;
      await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.waitForFunction(title => document.title.includes(title), parentText(locale, 'Get support'));
      await page.evaluate(() => { if (!document.querySelector('[data-synthetic-description]')) { const note = document.createElement('aside'); note.dataset.syntheticDescription = 'true'; note.lang = 'en'; note.textContent = 'Synthetic interface proof only: no real account, model, provider or food outcome.'; document.body.prepend(note); } });
      const style = large ? await page.addStyleTag({ content: 'html { font-size: 200%; }' }) : null;
      const previousShellFont = await page.locator('#main-content').evaluate(element => element.parentElement.style.fontSize);
      if (large) {
        await page.locator('#main-content').evaluate(element => { element.parentElement.style.fontSize = '32px'; });
        assert.equal(await page.locator('#main-content').evaluate(element => getComputedStyle(element).fontSize), '32px');
      }
      const axe = await new AxeBuilder({ page }).analyze(); assert.deepEqual(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), [], name);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' overflow');
      const fractures = await page.locator('[aria-labelledby="food-description-title"] :is(h1,h2,h3,p,button,a,label,summary)').evaluateAll(nodes => nodes.flatMap(element => {
        if (!element.getClientRects().length) return [];
        const faults = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode;
          if (!text.parentElement?.getClientRects().length) continue;
          for (const word of text.textContent.matchAll(/\p{L}{4,}/gu)) {
            const range = document.createRange(); range.setStart(text, word.index); range.setEnd(text, word.index + word[0].length);
            if (range.getClientRects().length > 1) faults.push(word[0]);
          }
        }
        if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) faults.push('clipped-control');
        return faults;
      }));
      const skip = page.locator('a[href="#main-content"]');
      if (!await skip.evaluate(element => element.matches(':focus'))) {
        const bounds = await skip.boundingBox();
        assert.ok(bounds && bounds.y + bounds.height <= 1, 'The unfocused skip link stays outside the viewport.');
      }
      if (large) await page.screenshot({ path: `${evidence}/${mode}-${name}-${locale}-${width}-large-viewport.png` });
      await page.screenshot({ path: `${evidence}/${mode}-${name}-${locale}-${width}${large ? '-large' : ''}.png`, fullPage: true });
      assert.deepEqual(fractures, [], name + ' keeps complete control words and labels readable');
      checks.push({ mode, name, locale, width, large, axeViolations: 0 });
      if (style) {
        await style.evaluate(node => node.remove());
        await page.locator('#main-content').evaluate((element, previous) => { element.parentElement.style.fontSize = previous; }, previousShellFont);
      }
    }
    async function changeLocale(value) {
      const refresh = page.waitForResponse(response => response.request().headers().rsc === '1' && new URL(response.url()).pathname === '/get-support');
      await page.getByLabel(/Screen language|Idioma de pantalla/).selectOption(value); await refresh; await page.waitForLoadState('networkidle');
    }
    if (mode !== 'new') {
      await page.goto(origin + '/get-support'); await page.getByText(c.history, { exact: true }).click(); await page.getByRole('button', { name: new RegExp(c.resume) }).click();
      const need = result.needIds[0];
      await page.getByRole('button', { name: q.titles[need], exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: q.both, exact: true }).count(), 0);
      assert.equal(await page.getByRole('link', { name: c.viewExisting, exact: true }).getAttribute('href'), '/support/55555555-5555-4555-8555-555555555555');
      await check('existing-covered-and-uncovered');
      await page.getByRole('button', { name: q.titles[need], exact: true }).click(); await page.locator('#support-zip').waitFor();
      const screenLocale = await page.locator('#support-zip').evaluate(node => node.closest('[lang]')?.getAttribute('lang')); assert.equal(screenLocale, locale);
      const intakeText = text => parentText(screenLocale, text); await page.getByLabel(intakeText('Household ZIP code'), { exact: true }).waitFor();
      // Private SNAP/profile collection is closed in this fixture, so no permitted private ZIP projection is supplied.
      if (need === 'snap_new') await page.getByLabel(intakeText('Household ZIP code'), { exact: true }).fill('19129');
      else await page.waitForFunction(() => document.querySelector('#support-zip')?.value === '19129');
      await page.getByLabel(intakeText('I’m 18 or older and requesting support for my household or as an authorized caregiver.'), { exact: true }).check(); await page.getByRole('button', { name: intakeText('Continue'), exact: true }).click();
      await page.getByRole('checkbox', { name: new RegExp(`^${intakeText('I authorize')}(?:\\s|$)`) }).waitFor(); assert.deepEqual(preflights.at(-1).needs, [need]);
      await check('only-uncovered-scope-before-mandate'); assert.equal(starts.length, 0); assert.equal(queues.length, 0); assert.equal(resolves.length, 0);
      assert.deepEqual(errors, []); assert.deepEqual(outside, []); await context.close(); continue;
    }
    await page.goto(origin + '/get-support'); await page.getByLabel(q.enough, { exact: true }).waitFor();
    assert.equal(await page.locator('#food-description-text').count(), 0); assert.equal(queues.length, 0); await check('closed-manual');
    enabled = true; await page.reload(); await page.getByRole('button', { name: c.signIn, exact: true }).click();
    await page.getByRole('button', { name: c.manual, exact: true }).waitFor(); assert.equal(queues.length, 0); await check('optional-auth-exit');
    await page.getByRole('button', { name: c.manual, exact: true }).click(); await page.getByLabel(q.enough, { exact: true }).waitFor();
    signedIn = true; await page.reload(); await page.getByRole('button', { name: c.create, exact: true }).click();
    assert.equal(await page.locator('#food-description-text').count(), 0); assert.ok(await page.getByRole('button', { name: c.create, exact: true }).isDisabled()); await page.getByText(c.notice, { exact: true }).click(); await check('consent-before-text');
    await page.getByRole('checkbox', { name: c.consent, exact: true }).focus(); await page.keyboard.press('Space');
    await page.getByRole('button', { name: c.create, exact: true }).click(); const editor = page.getByLabel(c.label, { exact: true }); await editor.waitFor();
    assert.equal(draft.id, draftId); assert.equal(await editor.evaluate(node => document.activeElement === node), true); await check('owned-empty-draft');
    await editor.fill('My password is private'); await page.getByRole('button', { name: c.send, exact: true }).click(); await page.getByRole('alert').filter({ hasText: c.invalid }).waitFor(); assert.equal(queues.length, 0);
    await editor.fill('Today we have no food. I need help paying for groceries.'); await page.getByRole('button', { name: c.send, exact: true }).click(); await page.getByRole('button', { name: c.retry, exact: true }).waitFor(); await check('queue-unknown');
    const other = locale === 'en' ? 'es' : 'en'; await changeLocale(other); await page.getByRole('button', { name: foodDescriptionCopy[other].retry, exact: true }).click();
    await page.getByText(foodDescriptionCopy[other].waiting, { exact: true }).waitFor(); assert.equal(queues.length, 2); await changeLocale(locale); await check('saved-waiting');
    draft = { ...draft, state: 'result', selection: { needIds: ['food_now'], selections: [], assertions: [], exclusions: [], questionIds: ['benefitHistory'], outOfScope: null } };
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); const history = page.getByLabel(q.history, { exact: true }); await history.waitFor();
    assert.equal(await page.getByLabel(q.enough, { exact: true }).count(), 0); await page.waitForFunction(() => document.activeElement?.id === 'food-guide-results'); await check('ready-food-optional-question');
    await history.selectOption('applied');
    if (routingOnly) { await page.locator('[aria-labelledby="food-description-title"] p').filter({hasText:q.applied}).waitFor(); await check('current-routing-choice',true); assert.equal(resolves.length,0); await context.close(); continue; }
    await page.getByRole('button', { name: c.resolve, exact: true }).click(); await page.getByRole('button', { name: c.resolveRetry, exact: true }).waitFor(); await check('clarification-unknown');
    await page.getByRole('button', { name: c.resolveRetry, exact: true }).click(); await page.getByRole('button', { name: q.both, exact: true }).waitFor(); assert.equal(resolves.length, 2); await check('vetted-options', width === 320);
    await page.getByRole('button', { name: c.changeAnswers, exact: true }).click(); await page.getByLabel(q.enough, { exact: true }).waitFor(); await check('change-understood-answers');
    await page.getByRole('button', { name: c.resolve, exact: true }).click(); await page.getByRole('button', { name: q.both, exact: true }).waitFor(); assert.equal(resolves.length, 3);
    await page.getByRole('button', { name: q.both, exact: true }).click(); await page.locator('#support-zip').waitFor();
    const screenLocale = await page.locator('#support-zip').evaluate(node => node.closest('[lang]')?.getAttribute('lang')); assert.equal(screenLocale, locale);
    const intakeText = text => parentText(screenLocale, text); await page.getByLabel(intakeText('Household ZIP code'), { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('#support-zip')?.value === '19129'); assert.equal(await page.getByLabel(intakeText('Household ZIP code'), { exact: true }).inputValue(), '19129'); assert.equal(await page.getByLabel(intakeText('Preferred service language')).inputValue(), 'en');
    await page.getByLabel(intakeText('I’m 18 or older and requesting support for my household or as an authorized caregiver.'), { exact: true }).check(); await page.getByRole('button', { name: intakeText('Continue'), exact: true }).click(); await page.getByRole('checkbox', { name: new RegExp(`^${intakeText('I authorize')}(?:\\s|$)`) }).check(); await check('named-mandate');
    await page.getByRole('button', { name: intakeText('Start getting support'), exact: true }).click(); await page.getByText(intakeText('The save result has not been confirmed. Retry the same request before changing answers or starting another request.')).waitFor(); await check('start-unknown', width === 320);
    const before = preflights.length; await page.getByRole('button', { name: intakeText('Start getting support'), exact: true }).click(); await page.waitForURL(origin + '/support/' + requestId);
    assert.equal(preflights.length, before); assert.deepEqual(starts[0], starts[1]); const packet = JSON.parse(starts[0].body);
    assert.deepEqual(packet.descriptionSource, { draftId, revision: 2 }); assert.deepEqual(packet.intake.needs, ['food_now', 'snap_pending']); assert.deepEqual(packet.reusedZip, { sourceRequestId: zipSource, sourceVersion: 1 });
    assert.ok(!starts[0].body.includes('Today we have no food')); assert.equal(queues.length, 2); assert.deepEqual(outside, []); assert.deepEqual(errors, []);
    enabled = false; await page.goto(origin + '/get-support'); await page.getByText(c.history, { exact: true }).click(); await page.getByRole('button', { name: new RegExp(c.resume) }).click();
    await page.getByRole('alert').filter({ hasText: c.changed }).waitFor(); assert.equal(await page.getByRole('button', { name: q.both, exact: true }).count(), 0); await check('closed-purpose-rights');
    const downloading = page.waitForEvent('download'); await page.getByRole('link', { name: c.download, exact: true }).click(); const download = await downloading;
    const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString()); assert.equal(exported.foodDescriptions.ownerId, owner); assert.equal(exported.foodDescriptions.drafts[0].id, draftId);
    await page.getByRole('button', { name: c.cancel, exact: true }).click(); await page.getByText(c.cancelled, { exact: true }).waitFor();
    assert.equal(draft.input, null); assert.equal(draft.selection, null); assert.equal(await page.locator('#food-description-text').count(), 0); await check('cancelled-retained-metadata');

    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/checks.json`, JSON.stringify({ claim: 'Synthetic UI/API fixture proof only; SQL/API authority, native Auth/concurrency and model evaluation are separate.', checks }, null, 2));
console.log(JSON.stringify({ checks: checks.length, axeViolations: 0, evidence }));
