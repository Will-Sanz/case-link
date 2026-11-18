import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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
        let signedIn = false, deny = true, recoveries = [];
        const errors = [], blockedOrigins = [];
        await context.route('**/*', async (route) => { const target = new URL(route.request().url()); if (target.origin === origin)
            return route.continue(); if (target.origin === authOrigin)
            return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic Auth fixture; no live service connected.' }) }); blockedOrigins.push(target.origin); return route.abort(); });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/parent/**', async (route) => {
            const path = new URL(route.request().url()).pathname;
            const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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
            await page.getByLabel(/Screen language|Idioma de pantalla/).selectOption(locale);
            await response;
            await page.waitForURL(url => url.searchParams.get('ui') === locale);
            await settle();
            assert.equal(await page.locator('html').getAttribute('lang'), locale);
        }
        async function check(name) { await settle(); const axe = await new AxeBuilder({ page }).analyze(); assert.deepEqual(axe.violations, [], JSON.stringify(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })))); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); const clipped = await page.locator('button').evaluateAll(buttons => buttons.filter(button => { if (!button.textContent.trim())
            return false; const range = document.createRange(); range.selectNodeContents(button); const text = range.getBoundingClientRect(), box = button.getBoundingClientRect(); return text.width > 0 && (text.left < box.left - 1 || text.right > box.right + 1); }).map(button => button.textContent)); assert.deepEqual(clipped, [], name + ' clipped button labels'); await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true }); results.push({ name, width, title: await page.title(), lang: await page.locator('html').getAttribute('lang'), axeViolations: 0 }); }
        await page.goto(origin + '/sign-in');
        await page.getByLabel('Your email address').waitFor();
        await check('sign-in-en');
        const response = page.waitForResponse(r => r.request().headers().rsc === '1' && new URL(r.url()).pathname === '/sign-in');
        await page.getByLabel('Screen language / Idioma de pantalla').selectOption('es');
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
        await page.getByLabel(/suficiente comida/).selectOption('no');
        await page.getByLabel(/ayuda para comprar/).selectOption('applied');
        await page.getByRole('button', { name: 'Ver mis opciones' }).click();
        await page.getByRole('button', { name: 'Consultar una solicitud pendiente' }).click();
        await page.getByLabel('Contraseña', { exact: true }).waitFor();
        await check('inline-sign-in-es');
        deny = false;
        await page.getByLabel('Su dirección de correo electrónico').fill('synthetic@example.invalid');
        await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
        await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
        await page.getByLabel('Household ZIP code').waitFor();
        assert.equal(await page.getByLabel('Household ZIP code').evaluate(input => input.closest('[lang]')?.lang), 'en');
        assert.equal(await page.getByLabel('Preferred service language').inputValue(), 'en');
        await page.getByLabel('Household ZIP code').fill('19129');
        await page.getByLabel('Idioma de pantalla / Screen language').selectOption('en');
        await page.waitForFunction(() => document.documentElement.lang === 'en');
        await settle();
        assert.equal(await page.getByLabel('Household ZIP code').inputValue(), '19129');
        assert.equal(await page.getByLabel('Preferred service language').inputValue(), 'en');
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
