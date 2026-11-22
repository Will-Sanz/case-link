import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import copyModule from '../../src/lib/parent/food-assessment-copy.ts';
import assessmentModule from '../../src/lib/parent/food-assessment.ts';
import programsModule from '../../src/lib/parent/programs.ts';
import localeModule from '../../src/lib/parent/locale.ts';
import descriptionModule from '../../src/lib/parent/food-description-copy.ts';
const { foodAssessmentCopy } = copyModule, { foodAssessmentInputSchema, assessFoodSupport } = assessmentModule;
const { getProgramsForNeeds, getProgram } = programsModule, { parentText } = localeModule, { foodDescriptionCopy } = descriptionModule;
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3310', target = new URL(origin);
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password, 'Synthetic loopback UI proof only.');
const evidence = 'tmp/parent-verification/food-routing-gaps/browser'; await mkdir(evidence, { recursive: true });
const owner = '11111111-1111-4111-8111-111111111111', draftId = '22222222-2222-4222-8222-222222222222';
const modes = [
  { id: 'denial', food: 'yes', benefit: 'denied', issue: null, need: 'snap_problem' },
  { id: 'snap-ready-food-unanswered', food: '', benefit: 'denied', issue: null, need: 'snap_problem' },
  { id: 'food-ready-benefit-unanswered', food: 'no', benefit: '', issue: null, need: 'food_now' },
  { id: 'food-ready-issue-unanswered', food: 'no', benefit: 'receiving', issue: '', need: 'food_now' },
  { id: 'wic-manual', fallback: 'wic' }, { id: 'outside-manual', fallback: 'outside_pa' },
];
const browser = await chromium.launch({ headless: true }), checks = [];
try {
  for (const mode of modes) for (const width of [320, 390, 1280]) for (const large of width === 320 ? [false, true] : [false]) for (const locale of ['en', 'es']) {
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    try {
      await context.addCookies([{ name: 'caselink-parent-ui-locale', value: locale, url: origin }]);
      const page = await context.newPage(); page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(30_000);
      const c = foodAssessmentCopy[locale], d = foodDescriptionCopy[locale];
      const errors = [], outside = [], selected = [], reads = [];
      const now = Date.now(), confirmedAt = new Date(now).toISOString(), expiresAt = new Date(now + 86400000).toISOString();
      const expected = mode.fallback ? null : { needs: [mode.need], answers: { foodForTwoDays: mode.food || 'not_sure', benefitHistory: mode.benefit || 'not_sure', existingIssue: mode.benefit === 'receiving' ? mode.issue || 'not_sure' : null } };
      const draft = { id: draftId, revision: 1, state: 'result', noticeVersion: 'food-description-2026-11-18.v1', consentedAt: confirmedAt, createdAt: confirmedAt, contentExpiresAt: expiresAt, metadataExpiresAt: new Date(now + 172800000).toISOString(), input: { description: mode.fallback === 'wic' ? (locale === 'en' ? 'I need WIC support.' : 'Necesito apoyo de WIC.') : (locale === 'en' ? 'I need food support outside Pennsylvania.' : 'Necesito ayuda alimentaria fuera de Pensilvania.'), screenLocale: locale }, projection: null, selection: null, queueKey: null, sameChargedContext: true, usage: [] };
      const result = { state: 'manual', proposedAnswers: { foodForTwoDays: 'not_sure', benefitHistory: 'not_sure', existingIssue: null }, needIds: [], questionIds: [], conflicts: [], existingRequests: [], excludedNeedIds: [], outOfScope: mode.fallback, executionGranted: false };
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        if (url.origin === 'http://127.0.0.1:55321') return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
        outside.push(url.origin); return route.abort();
      });
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/parent/**', route => {
        const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
        const json = body => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: JSON.stringify(body) });
        if (path.endsWith('/food-assessment')) {
          assert.equal(method, 'POST'); const value = foodAssessmentInputSchema.parse(route.request().postDataJSON()); selected.push(value); assert.deepEqual(value, expected);
          return json({ ownerId: owner, candidates: assessFoodSupport(value.answers).filter(path => value.needs.includes(path.need)).map(path => ({ ...path, programs: getProgramsForNeeds([path.need]).map(program => ({ programId: program.id, actions: [] })) })) });
        }
        assert.equal(method, 'GET', 'This interface fixture allows only the exact assessment preflight; no start, description write, provider or model mutation.');
        reads.push(path);
        if (path.endsWith('/food-description/availability')) return json({ available: Boolean(mode.fallback) });
        if (path.endsWith('/food-description')) return json(url.searchParams.has('draft') ? { result } : { archive: { ownerId: owner, available: Boolean(mode.fallback), drafts: mode.fallback ? [draft] : [] } });
        if (path.endsWith('/account')) return json({ account: { id: owner, email: 'synthetic@example.invalid', preferences: { language: locale, contactPreference: 'in_app' } } });
        if (path.endsWith('/authorization-window')) return json({ authorization: { issuedAt: confirmedAt, expiresAt, snapApplication: { collectionEnabled: false, noticeVersion: null } } });
        if (path.endsWith('/intake-defaults')) return json({ ownerId: owner, zip: null });
        if (path.endsWith('/food-sites')) return json({ sites: [], sourceUrl: 'https://www.phila.gov/food/', checkedAt: confirmedAt, availability: 'city_listed_unconfirmed', moreSitesAvailable: false });
        return json({ capabilities: [] });
      });
      async function check(name, selector) {
        await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.waitForFunction(title => document.title.includes(title), parentText(locale, 'Get support'));
        const axe = await new AxeBuilder({ page }).analyze(); assert.deepEqual(axe.violations.map(value => ({ id: value.id, targets: value.nodes.map(node => node.target) })), [], name);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${mode.id}/${name} document overflow`);
        const fractures = await page.locator(selector + ' :is(h1,h2,h3,p,button,a,label,summary)').evaluateAll(elements => elements.flatMap(element => {
          if (!element.getClientRects().length) return [];
          const faults = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            if (!walker.currentNode.parentElement?.getClientRects().length) continue;
            for (const word of walker.currentNode.textContent.matchAll(/\p{L}{4,}/gu)) {
              const range = document.createRange(); range.setStart(walker.currentNode, word.index); range.setEnd(walker.currentNode, word.index + word[0].length);
              if (range.getClientRects().length > 1) faults.push(word[0]);
            }
          }
          const style = getComputedStyle(element), clips = /hidden|clip/.test(style.overflowX + ' ' + style.overflowY);
          if ((element.matches('button,input,textarea') || clips) && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)) faults.push('clipped-control');
          return faults;
        }));
        assert.deepEqual(fractures, [], `${mode.id}/${name}/${locale}/${width}/${large} readable full words and controls`);
        const skip = page.locator('a[href="#main-content"]');
        if (!await skip.evaluate(element => element.matches(':focus'))) { const bounds = await skip.boundingBox(); assert.ok(bounds && bounds.y + bounds.height <= 1, 'Unfocused skip link stays offscreen.'); }
        assert.deepEqual(errors, []); assert.deepEqual(outside, []);
        const stem = `${evidence}/${mode.id}-${name}-${locale}-${width}${large ? '-large' : ''}`;
        await page.screenshot({ path: stem + '-viewport.png' }); await page.screenshot({ path: stem + '.png', fullPage: true });
        checks.push({ mode: mode.id, locale, width, large, state: name, axeViolations: 0, synthetic: true }); console.log('passed', mode.id, locale, width, large, name);
      }
      await page.goto(origin + '/get-support'); await page.waitForLoadState('networkidle');
      if (mode.fallback) await page.getByText(d.history, { exact: true }).waitFor(); else await page.getByRole("group", { name: c.enough, exact: true }).waitFor();
      await page.evaluate(() => { const note = document.createElement('aside'); note.lang = 'en'; note.textContent = 'Synthetic interface proof only: no real account, model, provider or support outcome.'; document.body.prepend(note); });
      if (large) {
        await page.addStyleTag({ content: 'html { font-size: 200%; }' });
        await page.locator('#main-content').evaluate(element => { element.parentElement.style.fontSize = '32px'; });
        assert.equal(await page.locator('#main-content').evaluate(element => getComputedStyle(element).fontSize), '32px');
      }
      if (mode.fallback) {
        const disclosure = page.getByText(d.history, { exact: true }); await disclosure.focus(); await disclosure.press('Enter');
        const resume = page.getByRole('button', { name: new RegExp(d.resume) }); await resume.focus(); await resume.press('Enter');
        const heading = page.getByRole('heading', { name: mode.fallback === 'wic' ? d.wicTitle : d.outsideTitle, exact: true }); await heading.waitFor();
        await page.waitForFunction(id => document.activeElement?.id === id, mode.fallback === 'wic' ? 'food-description-wic-title' : 'food-description-outside-title');
        assert.equal(await page.getByRole("group", { name: c.enough, exact: true }).count(), 0); assert.equal(await page.getByRole("group", { name: c.history, exact: true }).count(), 0);
        const region = page.getByRole('region', { name: mode.fallback === 'wic' ? d.wicTitle : d.outsideTitle });
        assert.deepEqual(await region.locator('a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), mode.fallback === 'wic' ? ['/get-support?need=wic_new', '/get-support?need=wic_continuing', getProgram('wic-pa').officialUrl] : ['https://www.feedingamerica.org/need-help-find-food']);
        await check('direct-options', '[aria-labelledby="food-description-title"]');
        await heading.press('Tab'); assert.equal(await region.locator('a').first().evaluate(node => node.matches(':focus')), true, 'Direct alternative is keyboard reachable.');
        assert.equal(selected.length, 0); assert.ok(reads.some(path => path.endsWith('/food-description'))); continue;
      }
      if (mode.food) await page.locator(`#food-guide-enough input[value="${mode.food}"]`).check();
      if (mode.benefit) await page.getByText(c.benefits, { exact: true }).click();
      if (mode.benefit === 'denied') {
        const history = page.locator('#food-guide-history input[value=denied]'); await history.focus();
        assert.equal(await history.evaluate(node => node.matches(':focus')), true);
        await history.check();
        assert.equal(await history.isChecked(), true);
      } else if (mode.benefit) await page.locator(`#food-guide-history input[value="${mode.benefit}"]`).check();
      if (mode.issue) await page.locator(`#food-guide-issue input[value="${mode.issue}"]`).check();
      if (mode.id !== 'denial') { assert.equal(await page.getByText(c.partial, { exact: true }).count(), 1); assert.equal(await page.getByRole('button', { name: c.submit, exact: true }).isEnabled(), true); }
      await page.getByRole('button', { name: c.submit, exact: true }).scrollIntoViewIfNeeded(); await check('choice', '[aria-labelledby="food-assessment-title"]');
      await page.getByRole('button', { name: c.submit, exact: true }).focus(); await page.getByRole('button', { name: c.submit, exact: true }).press('Enter');
      await page.getByRole('heading', { name: c.results, exact: true }).waitFor(); await page.waitForFunction(() => document.activeElement?.id === 'food-guide-results');
      if (mode.benefit === 'denied') assert.equal(await page.getByText(c.deniedReason, { exact: true }).count(), 1);
      for (const need of ['food_now', 'snap_new', 'snap_pending', 'snap_renewal', 'snap_problem']) assert.equal(await page.getByRole('button', { name: c.titles[need], exact: true }).count(), need === mode.need ? 1 : 0);
      assert.equal(await page.getByRole('button', { name: c.both, exact: true }).count(), 0); await check('ready-options', '[aria-labelledby="food-assessment-title"]');
      await page.getByRole('button', { name: c.change, exact: true }).click();
      assert.equal(await page.locator('#food-guide-enough input:checked').evaluateAll(options => options[0]?.value ?? ''), mode.food); assert.equal(await page.locator('#food-guide-history input:checked').evaluateAll(options => options[0]?.value ?? ''), mode.benefit);
      if (mode.benefit === 'receiving') assert.equal(await page.locator('#food-guide-issue input:checked').evaluateAll(options => options[0]?.value ?? ''), mode.issue);
      assert.equal(selected.length, 0, 'Editing/previewing never starts a preflight or request.');
      await page.getByRole('button', { name: c.submit, exact: true }).click(); await page.getByRole('button', { name: c.titles[mode.need], exact: true }).click();
      await page.locator('#support-zip').waitFor(); assert.equal(selected.length, 0, 'Choosing a route alone is not an account preflight.');
      await page.locator('#support-zip').fill('19104');
      const handoffLocale = await page.locator('#support-zip').evaluate(element => element.closest('[lang]')?.getAttribute('lang'));
      assert.equal(handoffLocale, locale, 'The selected screen language continues through this food handoff.');
      const st = text => parentText(handoffLocale, text);
      await page.getByLabel(st('I’m 18 or older and requesting support for my household or as an authorized caregiver.'), { exact: true }).check();
      if (mode.food !== 'no') await page.locator('#guided-food-timing').selectOption('soon');
      const received = page.waitForResponse(response => new URL(response.url()).pathname === '/api/parent/food-assessment');
      await page.getByRole('button', { name: st('Continue'), exact: true }).click(); await received;
      await page.getByLabel(new RegExp(st('I authorize'))).waitFor(); assert.equal(selected.length, 1); assert.deepEqual(selected[0], expected);
      if (width === 320) assert.deepEqual(await page.locator('#main-content [class*=snapIntake]').evaluate(root => ({ container: getComputedStyle(root).paddingLeft, surface: getComputedStyle(root.querySelector('section[class*=surface]')).paddingLeft, notice: getComputedStyle(root.querySelector('[class*=notice]')).flexDirection })), { container: '12px', surface: '12px', notice: 'column' }, 'Guided handoffs reuse the tested mobile reading width.');
      await check('permission-not-started', '#main-content');
    } catch (error) {
      const pages = context.pages(); if (pages[0]) { await pages[0].screenshot({ path: `${evidence}/failed-${mode.id}-${locale}-${width}${large ? '-large' : ''}-viewport.png` }).catch(() => {}); }
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/checks.json`, JSON.stringify({ claim: 'Compiled UI with explicit synthetic HTTP/Auth only; no request start, model, provider or native SQL outcome.', checks }, null, 2) + '\n');
console.log(`Food routing UI: ${checks.length} synthetic checks passed.`);
