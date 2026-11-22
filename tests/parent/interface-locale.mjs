import { chooseScreenLanguage } from "./screen-language.mjs";
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixtures from '../../src/lib/parent/test-fixtures.ts';
import localeCopy from '../../src/lib/parent/locale.ts';
const { parentText } = localeCopy;
const { fixtureIntake, fixtureMandate, fixtureRequest } = fixtures;
// Run against the secret-free local parent preview; this script supplies every application/Auth response.
const origin = process.env.PARENT_TEST_ORIGIN ?? 'http://127.0.0.1:3295', evidence = 'tmp/parent-verification/interface-locale/browser', authOrigin = 'http://127.0.0.1:55321';
const target = new URL(origin);
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin === origin && !target.username && !target.password, 'Interface verification is local and synthetic only.');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const width of [320, 390, 1280]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
        let signedIn = false, deny = true, recoveries = [], supportMode = 'saved', supportReads = 0;
        const supportRequest = fixtureRequest({ intake: fixtureIntake({ needs: ['food_now'] }),
            mandate: fixtureMandate({ mode: 'prepare_only', recipientIds: ['philly-food'], allowedActions: ['research','prepare'], allowedData: ['household'], expiresAt: new Date(Date.now() + 86400000).toISOString() }) });
        const progress = { state: 'waiting', summary: 'Waiting for the next recorded program update. Check the activity below for what was actually sent.',
            updatedAt: '2026-11-18T02:30:00Z', nextRunAt: '2026-11-18T02:35:00Z', canContinueAfterClosing: false };
        const errors = [], blockedOrigins = [];
        await context.route('**/*', async (route) => { const target = new URL(route.request().url()); if (target.origin === origin)
            return route.continue(); if (target.origin === authOrigin)
            return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic Auth fixture; no live service connected.' }) }); blockedOrigins.push(target.origin); return route.abort(); });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/parent/**', async (route) => {
            const path = new URL(route.request().url()).pathname;
            const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
            if (path === '/api/parent/requests' || path.startsWith('/api/parent/requests/')) {
                assert.equal(route.request().method(), 'GET', 'Language/progress rehearsal cannot start or alter work.');
                supportReads++;
                if (supportMode === 'signed-out') return json({ ok: false, error: 'Sign in again to continue. Your saved support is still here.' }, 401);
                if (path.endsWith('/operations')) return json({ operations: [], historyLimited: false });
                if (path === '/api/parent/requests') return json({ requests: supportMode === 'empty' ? [] : [supportRequest], progress: { [supportRequest.id]: progress } });
                return json({ request: supportRequest, progress });
            }
            if (path.endsWith('/account'))
                return signedIn ? json({ account: { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.invalid', preferences: { language: 'en', contactPreference: 'in_app' } } }) : json({ ok: false, error: 'Sign in again to continue. Your saved support is still here.' }, 401);
            if (path.endsWith('/auth')) {
                if (deny)
                    return json({ ok: false, error: 'Too many sign-in attempts. Wait a few minutes and try again.' }, 429);
                signedIn = true;
                return json({ ok: true });
            }
            if (path.endsWith('/food-sites'))
                return json({ sites: [], sourceUrl: 'https://www.phila.gov/food/', checkedAt: new Date().toISOString(), availability: 'city_listed_unconfirmed', moreSitesAvailable: false });
            if (path.endsWith('/authorization-window'))
                return json({ authorization: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), snapApplication: { collectionEnabled: false, noticeVersion: null } } });
            if (path.endsWith('/intake-defaults'))
                return json({ zip: null });
            return json({ capabilities: [] });
        });
        await page.route('http://127.0.0.1:55321/auth/v1/recover**', async (route) => { recoveries.push({ ...route.request().postDataJSON(), redirect_to: new URL(route.request().url()).searchParams.get('redirect_to') }); await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
        async function settle() { await page.waitForLoadState('networkidle'); await page.locator('body').waitFor(); }
        async function recoveryLocale(locale) {
            const path = new URL(page.url()).pathname;
            const response = page.waitForResponse(r => r.request().headers().rsc === '1' && new URL(r.url()).pathname === path && new URL(r.url()).searchParams.get('ui') === locale);
            await chooseScreenLanguage(page, locale);
            await response;
            await page.waitForURL(url => url.searchParams.get('ui') === locale);
            await settle();
            assert.equal(await page.locator('html').getAttribute('lang'), locale);
        }
        async function check(name) { await settle(); await page.evaluate(() => { if (!document.querySelector('[data-synthetic-locale]')) { const note = document.createElement('aside'); note.dataset.syntheticLocale = 'true'; note.lang = 'en'; note.textContent = 'Synthetic rehearsal: no real account, application or food outcome.'; document.body.prepend(note); } }); const axe = await new AxeBuilder({ page }).analyze(); assert.deepEqual(axe.violations, [], JSON.stringify(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })))); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); const clipped = await page.locator('button').evaluateAll(buttons => buttons.filter(button => { if (!button.textContent.trim())
            return false; const range = document.createRange(); range.selectNodeContents(button); const text = range.getBoundingClientRect(), box = button.getBoundingClientRect(); return text.width > 0 && (text.left < box.left - 1 || text.right > box.right + 1); }).map(button => button.textContent)); assert.deepEqual(clipped, [], name + ' clipped button labels'); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true }); results.push({ name, width, title: await page.title(), lang: await page.locator('html').getAttribute('lang'), axeViolations: 0 }); }
        await page.goto(origin + '/sign-in');
        await page.getByLabel('Your email address').waitFor();
        assert.equal(await page.locator('header').getByRole('combobox').count(), 0);
        await check('sign-in-en');
        const response = page.waitForResponse(r => r.request().headers().rsc === '1' && new URL(r.url()).pathname === '/sign-in');
        await chooseScreenLanguage(page, 'es');
        await response;
        await page.waitForFunction(() => document.title === 'Iniciar sesión | CaseLink');
        await check('sign-in-es');
        await page.getByLabel('Su dirección de correo electrónico').fill('synthetic@example.invalid');
        await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
        await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Demasiados intentos' }).waitFor();
        await check('sign-in-error-es');
        await page.goto(origin + '/get-support');
        await page.getByRole('heading', { name: 'Busquemos apoyo alimentario para su familia.' }).waitFor();
        await page.waitForFunction(() => document.title === 'Pedir apoyo | CaseLink');
        await check('food-guide-es');
        await page.getByRole('radio', { name: 'No', exact: true }).check();
        await page.getByText('Buscar ayuda para pagar los alimentos', { exact: true }).click();
        await page.locator('#food-guide-history input[value=applied]').check();
        await page.getByRole('button', { name: 'Ver mis opciones' }).click();
        await page.getByRole('button', { name: 'Consultar una solicitud pendiente' }).click();
        await page.getByLabel('Contraseña', { exact: true }).waitFor();
        await check('inline-sign-in-es');
        deny = false;
        await page.getByLabel('Su dirección de correo electrónico').fill('synthetic@example.invalid');
        await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
        await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
        await page.locator('#support-zip').waitFor();
        const handoffLocale = await page.locator('#support-zip').evaluate(input => input.closest('[lang]')?.getAttribute('lang')); assert.equal(handoffLocale, 'es');
        assert.equal(await page.getByLabel(parentText(handoffLocale, 'Preferred service language')).inputValue(), 'en');
        await page.getByLabel(parentText(handoffLocale, 'Household ZIP code')).fill('19129');
        await chooseScreenLanguage(page, 'en');
        await page.waitForFunction(() => document.documentElement.lang === 'en');
        await settle();
        assert.equal(await page.getByLabel('Household ZIP code').inputValue(), '19129');
        assert.equal(await page.getByLabel('Preferred service language').inputValue(), 'en');
        await chooseScreenLanguage(page, 'es');
        await page.waitForFunction(() => document.documentElement.lang === 'es');
        await page.goto(origin + '/my-support');
        await page.getByRole('heading', { name: 'Mi apoyo', exact: true }).waitFor();
        await page.getByText('En espera del próximo paso', { exact: true }).waitFor();
        await page.waitForFunction(() => document.title === 'Mi apoyo | CaseLink');
        assert.equal(await page.getByRole('link', { name: /Ver apoyo/ }).getAttribute('href'), `/support/${supportRequest.id}`);
        await check('my-support-es');
        const readsBefore = supportReads;
        await page.getByRole('button', { name: 'Actualizar el estado del apoyo' }).focus();
        const refreshed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/parent/requests');
        await page.keyboard.press('Space');
        await refreshed;
        assert.equal(supportReads, readsBefore + 1);
        await page.getByRole('link', { name: /Ver apoyo/ }).click();
        await page.getByText(parentText('es', 'Work status & updates'), { exact: true }).click();
        await page.getByRole('heading', { name: 'En espera del próximo paso', exact: true }).waitFor();
        const panel = page.getByRole('region', { name: 'En espera del próximo paso' });
        assert.equal(await panel.getAttribute('lang'), 'es');
        assert.match(await panel.locator('time').last().innerText(), /^17 nov 2026, 9:35 p\. ?m\.$/);
        assert.equal(await panel.locator('time').last().getAttribute('datetime'), progress.nextRunAt);
        assert.equal(await panel.getByText('Puede salir de esta página. El trabajo autorizado puede continuar.').count(), 0);
        await check('recorded-progress-es');
        await page.addStyleTag({ content: 'html { font-size: 200%; }' });
        assert.equal(await page.locator('header').getByText('CaseLink', { exact: true }).evaluate(wordmark => {
            const range = document.createRange(); range.selectNodeContents(wordmark); return range.getClientRects().length;
        }), 1, 'Large text must keep the brand name readable as one word.');
        assert.ok(await page.locator('[data-case-workspace] > div').first().evaluate(header => {
            const title = header.querySelector('h1'), badge = header.querySelector(':scope > span');
            const a = title.getBoundingClientRect(), b = badge.getBoundingClientRect();
            return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        }), 'The request heading and recorded progress must not overlap.');
        await panel.scrollIntoViewIfNeeded();
        const panelBox = await panel.boundingBox(), summaryBox = await panel.locator('p[lang]').first().boundingBox();
        assert.ok(summaryBox.width >= panelBox.width * 0.6, 'Large text needs a readable full-width progress summary.');
        assert.ok(await panel.getByRole('button', { name: 'Actualizar el progreso del apoyo' }).evaluate(button =>
            [...button.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).reduce((lines, node) => {
                const range = document.createRange(); range.selectNodeContents(node); return lines + range.getClientRects().length;
            }, 0)) <= 2, 'The translated refresh label must remain readable in at most two lines.');
        await panel.screenshot({ path: `${evidence}/recorded-progress-es-large-text-panel-${width}.png` });
        await check('recorded-progress-es-large-text');
        supportMode = 'empty';
        await page.goto(origin + '/my-support');
        await page.getByRole('heading', { name: 'Sus próximos pasos pueden empezar aquí' }).waitFor();
        await check('my-support-empty-es');
        supportMode = 'signed-out';
        await page.goto(origin + '/my-support');
        await page.getByRole('link', { name: 'Iniciar sesión para continuar' }).waitFor();
        assert.equal(await page.getByRole('link', { name: /Ver apoyo/ }).count(), 0);
        await check('my-support-signed-out-es');
        supportMode = 'saved';
        await page.goto(origin + '/forgot-password?ui=es');
        await page.getByRole('button', { name: 'Enviar enlace de restablecimiento' }).waitFor();
        await check('recovery-es');
        await page.getByLabel('Correo electrónico', { exact: true }).fill('synthetic@example.invalid');
        await recoveryLocale('en');
        await page.getByRole('heading', { name: 'Forgot password' }).waitFor();
        assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'synthetic@example.invalid');
        await page.getByText("Get a secure sign-in link if you can't access your password.").waitFor();
        await check('recovery-en');
        await recoveryLocale('es');
        await page.getByRole('heading', { name: 'Restablecer contraseña' }).waitFor();
        await page.getByLabel('Correo electrónico', { exact: true }).fill('synthetic@example.invalid');
        await page.getByRole('button', { name: 'Enviar enlace de restablecimiento' }).click();
        await page.getByRole('status').filter({ hasText: 'Si existe una cuenta' }).waitFor();
        assert.equal(recoveries.length, 1);
        const callback = new URL(recoveries[0].redirect_to);
        assert.equal(callback.pathname, '/auth/callback');
        assert.equal(callback.searchParams.get('ui'), 'es');
        assert.equal(callback.searchParams.get('next'), '/reset-password?mode=recovery&ui=es');
        await check('recovery-sent-es');
        await page.goto(origin + '/reset-password?mode=recovery&ui=es');
        await page.getByRole('alert').filter({ hasText: 'no es válido o ha vencido' }).waitFor();
        await check('recovery-invalid-es');
        const expires_at = Math.floor(Date.now() / 1000) + 3600;
        const session = { access_token: Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', exp: expires_at, iat: expires_at - 3600 })).toString('base64url') + '.c3ludGhldGlj', refresh_token: 'synthetic-refresh-token', expires_at, expires_in: 3600, token_type: 'bearer', user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: new Date().toISOString() } };
        await context.addCookies([{ name: 'sb-127-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), url: origin }]);
        await page.goto(origin + '/reset-password?mode=recovery&ui=es');
        await page.getByLabel('Contraseña nueva', { exact: true }).waitFor();
        await check('recovery-ready-es');
        await page.getByLabel('Contraseña nueva', { exact: true }).fill('Synthetic-test-password1!');
        await page.getByLabel('Confirmar contraseña nueva', { exact: true }).fill('Synthetic-test-password1!');
        await recoveryLocale('en');
        assert.equal(new URL(page.url()).searchParams.get('mode'), 'recovery');
        await page.getByRole('heading', { name: 'Reset password' }).waitFor();
        assert.equal(await page.getByLabel('New password', { exact: true }).inputValue(), 'Synthetic-test-password1!');
        assert.equal(await page.getByLabel('Confirm new password', { exact: true }).inputValue(), 'Synthetic-test-password1!');
        await check('recovery-ready-en');
        await recoveryLocale('es');
        await page.getByRole('heading', { name: 'Restablecer contraseña' }).waitFor();
        await page.goto(origin + '/auth/callback?ui=es&token_hash=synthetic-token&type=recovery');
        await page.getByRole('button', { name: 'Continuar para establecer la contraseña' }).waitFor();
        assert.equal(new URL(page.url()).search, '');
        await check('callback-confirm-es');
        assert.deepEqual(errors, []);
        assert.deepEqual(blockedOrigins, [], 'The rehearsal must not contact external services.');
        await context.close();
    }
    await writeFile(`${evidence}/results.json`, JSON.stringify({ kind: 'native Next browser with synthetic HTTP fixtures; no live Auth/provider/model', checks: results }, null, 2));
    console.log(JSON.stringify({ checks: results.length, axeViolations: 0, evidence }));
}
finally {
    await browser.close();
}
