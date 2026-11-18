import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assessment from '../../src/lib/parent/food-assessment.ts';
import programs from '../../src/lib/parent/programs.ts';
import profile from '../../src/lib/parent/family-profile.ts';
const { foodAssessmentInputSchema, assessFoodSupport } = assessment;
const { getProgramsForNeeds } = programs;
const { familyProfileLeaves } = profile;
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3298';
const target = new URL(origin), evidence = 'tmp/parent-verification/combined-food-snap/browser';
const recoveryOnly = process.argv.includes('--unknown-mobile-only');
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password, 'Combined food verification is local and synthetic only.');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true }), results = [];
const owner = '11111111-1111-4111-8111-111111111111', child = '22222222-2222-4222-8222-222222222222', requestId = '33333333-3333-4333-8333-333333333333';
try {
  for (const width of recoveryOnly ? [320] : [320, 390, 1280]) for (const locale of ['en', 'es']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    const errors = [], blockedOrigins = [], posts = [], assessments = [];
    let privateSnap = false, profileReads = 0;
    const now = Date.now(), expiresAt = new Date(now + 86400000).toISOString(), confirmedAt = new Date(now - 86400000).toISOString();
    const details = { primaryPerson: { id: owner, firstName: 'Saved', lastName: 'Parent', dateOfBirth: '1990-01-01' },
      members: [{ id: child, firstName: 'Saved', lastName: 'Child', dateOfBirth: '2023-01-01', relationship: 'Child' }],
      homeAddress: { street: '123 Synthetic Lane', city: 'Philadelphia', state: 'PA', zip: '19104', county: 'Philadelphia' },
      contact: { phone: '215-555-0101', email: 'synthetic@example.invalid' }, preferredLanguage: 'en' };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.origin === 'http://127.0.0.1:55321') return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      blockedOrigins.push(url.origin); return route.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/parent/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (path.endsWith('/account')) return json({ account: { id: owner, email: 'synthetic@example.invalid', preferences: { language: 'en', contactPreference: 'in_app' } } });
      if (path.endsWith('/authorization-window')) return json({ authorization: { issuedAt: new Date(now).toISOString(), expiresAt,
        snapApplication: { collectionEnabled: privateSnap, noticeVersion: privateSnap ? 'snap-application-details-2026-11-03.v1' : null } } });
      if (path.endsWith('/family-profile')) { profileReads++; return json({ ok: true, ownerId: owner, revision: 2, lastMutationKey: child,
        collection: { collectionEnabled: true, noticeVersion: 'family-profile-2026-11-17.v1', expiresAt, retentionDays: 45 },
        profile: { revision: 2, idempotencyKey: child, details, provenance: Object.fromEntries(Object.keys(familyProfileLeaves(details)).map(path => [path, { confirmedAt, expiresAt }])) } }); }
      if (path.endsWith('/food-assessment')) {
        const input = foodAssessmentInputSchema.parse(route.request().postDataJSON()); assessments.push(input);
        return json({ ownerId: owner, candidates: assessFoodSupport(input.answers).filter(path => input.needs.includes(path.need)).map(path => ({ ...path,
          programs: getProgramsForNeeds([path.need]).map(program => ({ programId: program.id, actions: [] })) })) });
      }
      if (path.endsWith('/requests') && route.request().method() === 'POST') {
        posts.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
        if (posts.length % 2 === 1) return route.abort();
        return json({ request: { id: requestId } });
      }
      if (path.endsWith('/food-sites')) return json({ sites: [], sourceUrl: 'https://www.phila.gov/food/', checkedAt: new Date(now).toISOString(), availability: 'city_listed_unconfirmed', moreSitesAvailable: false });
      if (path.endsWith('/intake-defaults')) return json({ zip: null });
      return json({ capabilities: [] });
    });
    async function check(name) {
      if (recoveryOnly && !name.startsWith('unknown-start-')) return;
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => { if (!document.querySelector('[data-synthetic-food]')) { const note = document.createElement('aside'); note.dataset.syntheticFood = 'true'; note.lang = 'en'; note.textContent = 'Synthetic rehearsal: no real account, application or food outcome.'; document.body.prepend(note); } });
      const axe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(axe.violations, [], JSON.stringify(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${evidence}/${name}-${locale}-${width}.png`, fullPage: true });
      results.push({ name, width, locale, axeViolations: 0 });
    }
    async function choose(history) {
      await page.goto(origin + '/get-support');
      const selector = page.getByLabel(/Screen language|Idioma de pantalla/);
      if (await selector.inputValue() !== locale) {
        const refreshed = page.waitForResponse(response => response.request().headers().rsc === '1' && new URL(response.url()).pathname === '/get-support');
        await selector.selectOption(locale); await refreshed; await page.waitForLoadState('networkidle');
      }
      await page.getByLabel(/enough food|suficiente comida/).selectOption('no');
      await page.getByLabel(/help paying|ayuda para comprar/).selectOption(history);
      await page.getByRole('button', { name: locale === 'en' ? 'See my options' : 'Ver mis opciones' }).click();
      await check('compatible-options-' + history);
      await page.getByRole('button', { name: locale === 'en' ? 'Continue with both options' : 'Continuar con ambas opciones' }).click();
      await page.getByLabel(history === 'never' ? 'Your first name' : 'Household ZIP code', { exact: true }).waitFor();
    }
    async function startUnknown(needs) {
      await page.getByLabel(/I’m 18 or older/).check();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('checkbox', { name: /I authorize/ }).check();
      await check('combined-permission-' + needs[1]);
      await page.getByRole('button', { name: 'Start getting support' }).click();
      await page.getByText(/save result has not been confirmed/).waitFor();
      const fractured = await page.getByRole('link', { name: 'Check My support for the saved request' }).evaluate(link => {
        const text = link.firstChild, words = [];
        for (const match of text.textContent.matchAll(/\S+/g)) {
          const range = document.createRange(); range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
          if (range.getClientRects().length > 1) words.push(match[0]);
        }
        return words;
      });
      assert.deepEqual(fractured, [], 'Unknown-start recovery must keep complete words readable.');
      assert.ok(await page.getByRole('button', { name: 'Back', exact: true }).isDisabled());
      const reads = assessments.length, familyReads = profileReads, first = posts.at(-1), packet = JSON.parse(first.body);
      assert.deepEqual(packet.intake.needs, needs);
      assert.deepEqual(packet.mandate.recipientIds, ['philly-food', 'share-community-fridge-19129', 'snap-pa', ...(needs[1] === 'snap_pending' ? ['uesf-benefits'] : [])]);
      assert.equal(packet.mandate.accepted, true); assert.equal(packet.mandate.mode, 'prepare_only');
      await check('unknown-start-' + needs[1]);
      assert.equal(profileReads, familyReads);
      await page.getByRole('button', { name: 'Start getting support' }).click();
      await page.waitForURL(origin + '/support/' + requestId);
      assert.deepEqual(posts.at(-1), first); assert.equal(assessments.length, reads);
      return packet;
    }
    await choose('applied'); await page.getByLabel('Household ZIP code').fill('19104');
    assert.equal(await page.getByLabel('Preferred service language').inputValue(), 'en');
    const pending = await startUnknown(['food_now', 'snap_pending']);
    assert.equal(pending.kind, undefined); assert.equal(profileReads, 0);
    privateSnap = true; await choose('never');
    await page.getByLabel('Your first name', { exact: true }).fill('Manual');
    const answer = (path, value) => page.locator(`[data-snap-path="${path}"]`).selectOption(value);
    await answer('interpreter', 'no');
    for (const [label, value] of [['Your sex, as requested on the form', 'female'], ['Are you a student?', 'no'], ['Are you applying for SNAP?', 'yes'], ['Are you a U.S. citizen?', 'yes'],
      ['Person 2 sex, as requested on the form', 'male'], ['Is person 2 a student?', 'no'], ['Is person 2 applying for SNAP?', 'no']]) await page.getByLabel(label, { exact: true }).selectOption(value);
    await answer('income.hasIncome', 'no');
    for (const path of ['screening.lowCashAndIncome', 'screening.migrantOrSeasonal', 'screening.belowShelterCosts', 'history.fleeingOrProbation.answer', 'history.welfareFraud.answer', 'history.otherStateDisqualification.answer']) await answer(path, 'no');
    await answer('expenseClaims.household', 'do_not_claim'); await answer('expenseClaims.medical', 'not_applicable');
    for (const name of [locale === 'en' ? 'Apply for SNAP' : 'Solicitar SNAP', locale === 'en' ? 'Continue with both options' : 'Continuar con ambas opciones']) {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name, exact: true }).click();
      assert.equal(await page.getByLabel('Your first name', { exact: true }).inputValue(), 'Manual');
      assert.equal(await page.locator('[data-snap-path="income.hasIncome"]').inputValue(), 'no');
    }
    assert.equal(profileReads, 1);
    const snap = await startUnknown(['food_now', 'snap_new']);
    assert.equal(snap.kind, 'snap_application'); assert.equal(snap.details.applicant.firstName, 'Manual');
    assert.ok(snap.familyProfileSource.fields.some(field => field.applicationPath === `household.${owner}.dateOfBirth`));
    assert.ok(!snap.familyProfileSource.fields.some(field => field.applicationPath === 'applicant.firstName'));
    assert.equal(posts.length, 4); assert.deepEqual(errors, []); assert.deepEqual(blockedOrigins, []);
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${evidence}/results.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ checks: results.length, localSynthetic: true, results }));
