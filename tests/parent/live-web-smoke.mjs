import assert from 'node:assert/strict';
import { chromium, devices } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const origin = process.argv[2] ?? 'https://www.thecaselink.com';
assert.ok(origin === 'https://www.thecaselink.com' || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
const browser = await chromium.launch();
try {
  for (const [device, options] of [
    ['desktop', { viewport: { width: 1440, height: 960 } }],
    ['phone', devices['iPhone 13']],
  ]) {
    const context = await browser.newContext({ ...options, locale: 'en-US', serviceWorkers: 'block' });
    const page = await context.newPage();
    const mutations = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (!['GET', 'HEAD'].includes(request.method())) {
        mutations.push(request.method());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.getByRole('link', { name: 'Find support for my family', exact: true }).getAttribute('href'), '/get-support');
    await page.goto(origin + '/get-support', { waitUntil: 'domcontentloaded' });
    const main = page.getByRole('main');
    await main.getByRole('group', { name: 'Do you need help today?', exact: true }).waitFor();
    await main.getByLabel('ZIP code', { exact: true }).waitFor();
    await main.getByRole('button', { name: 'Find support', exact: true }).waitFor();
    await page.waitForFunction(() => /Get support/i.test(document.title));
    const availability = await page.request.get(`${origin}/api/parent/food-description/availability`);
    assert.deepEqual(await availability.json(), { ok: true, available: false });
    assert.equal(await main.getByLabel('Tell us what you need (optional)').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Ask CaseLink for assistance' }).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(v => v.id), []);
    await page.goto(origin + '/support/help', { waitUntil: 'domcontentloaded' });
    await main.getByText('More food and WIC resources', { exact: true }).click();
    for (const href of [
      'https://www.phila.gov/food/',
      'https://www.sharefoodprogram.org/community-fridges/',
      'https://www.feedingamerica.org/need-help-find-food',
      'https://www.feedingamerica.org/need-help-find-food/wic',
      'https://www.pa.gov/services/health/request-a-pre-application-appointment-with-a-wic-specialist',
    ]) await main.locator(`a[href="${href}"]`).first().waitFor();
    await page.goto(origin + '/sign-in');
    await page.getByLabel('Your email address').waitFor();
    assert.deepEqual(mutations, []);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${device}: Get support, five official links, accessibility and sign-in entry passed.`);
  }
} finally {
  await browser.close();
}
