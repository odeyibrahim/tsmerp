// Browser-level verification: real Chromium, real app code, production CSP, mock Supabase backend.
// Run:  node tests/e2e/run.mjs        (needs Playwright + a Chromium; not part of `npm test`)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { startServer } from './mock-server.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright');

const { server, db, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();

const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);

try {
    // --- sign up -> onboarding -> dashboard ---
    await page.goto(base + '/login.html');
    await page.click('text=Create an account');
    await page.fill('[data-mode="signup"] [name=full_name]', 'Tola Adeyemi');
    await page.fill('[data-mode="signup"] [name=email]', 'tola@alpha.ng');
    await page.fill('[data-mode="signup"] [name=password]', 'supersecret1');
    await page.click('[data-mode="signup"] button[type=submit]');
    await page.waitForURL('**/app.html');
    await page.waitForSelector('text=Welcome to NaijaHaul');
    ok('signup → onboarding screen');

    await page.click('form[data-form=onboard] button[type=submit]');
    await page.waitForSelector('[data-err="name"]:not(:empty)');
    ok('onboarding validates required company name');

    await page.fill('form[data-form=onboard] [name=name]', 'Alpha Haulage Ltd');
    await page.fill('form[data-form=onboard] [name=phone]', '08031234567');
    await page.selectOption('form[data-form=onboard] [name=state]', 'Lagos');
    await page.click('form[data-form=onboard] button[type=submit]');
    await page.waitForSelector('#shell:not([hidden])');
    await page.waitForSelector('h1:has-text("Alpha Haulage Ltd")');
    assert.equal(db.companies[0].phone, '+2348031234567');
    ok('company created via RPC (phone normalised to +234), dashboard + trial banner shown');
    await page.waitForSelector('.alert-info:has-text("Free trial")');

    // --- vehicles ---
    await page.click('#nav >> text=Vehicles');
    await page.click('text=Add your first vehicle');
    await page.fill('form[data-form=vehicles] [name=plate_number]', 'lsr-412aa');
    ok('vehicle form opens in a modal under CSP');
    await page.selectOption('[name=ownership]', 'attached');
    await page.click('form[data-form=vehicles] button[type=submit]');
    await page.waitForSelector('[data-err="owner_name"]:not(:empty)');
    ok('attached vehicle requires an owner name (client rule)');
    await page.fill('[name=owner_name]', 'Alhaji Bello');
    await page.fill('[name=default_commission_pct]', '10');
    await page.click('form[data-form=vehicles] button[type=submit]');
    await page.waitForSelector('td:has-text("LSR-412AA")');
    await page.waitForSelector('.badge:has-text("Attached")');
    ok('attached vehicle saved and listed (plate upper-cased)');

    await page.click('text=+ Add vehicle');
    await page.fill('form[data-form=vehicles] [name=plate_number]', 'LSR-412AA');
    await page.click('form[data-form=vehicles] button[type=submit]');
    await page.waitForSelector('.modal [data-form-error]:not([hidden])');
    assert.match(await page.textContent('.modal [data-form-error]'), /already exists/);
    await page.click('.modal [data-action=modal-close] >> nth=0');
    ok('duplicate plate → friendly error, modal stays usable');

    // --- driver + customer ---
    await page.click('#nav >> text=Drivers');
    await page.click('text=Add your first driver');
    await page.fill('[name=full_name]', 'Musa Ibrahim');
    await page.fill('[name=phone]', '0802 123 0001');
    await page.fill('[name=licence_expiry]', '2030-01-01');
    await page.click('form[data-form=drivers] button[type=submit]');
    await page.waitForSelector('td:has-text("+234 802 123 0001")');
    ok('driver saved, phone formatted');

    await page.click('#nav >> text=Customers');
    await page.click('text=Add your first customer');
    await page.fill('[name=name]', 'Adebayo & Sons <b>Ltd</b>');
    await page.click('form[data-form=customers] button[type=submit]');
    await page.waitForSelector('td strong');
    assert.equal(await page.locator('td strong b').count(), 0, 'HTML in a name must not render as markup');
    ok('customer saved; markup in the name is escaped, not rendered');

    // --- trips: booking -> lifecycle ---
    await page.click('#nav >> text=Trips');
    await page.click('text=New booking >> nth=-1');
    await page.selectOption('[data-change="trip:corridor"]', { label: 'Lagos → Abuja' });
    assert.equal(await page.inputValue('[name=origin_state]'), 'Lagos');
    assert.equal(await page.inputValue('[name=destination_state]'), 'FCT (Abuja)');
    ok('corridor quick-pick fills origin and destination');
    await page.selectOption('[name=customer_id]', { index: 1 });
    await page.selectOption('[name=vehicle_id]', { index: 1 });
    await page.selectOption('[name=driver_id]', { index: 1 });
    await page.fill('[name=cargo_description]', 'Bagged cement');
    await page.fill('[name=freight_amount]', '100000');
    await page.fill('[name=advance_paid]', '150000');
    await page.click('form[data-form=trip] button[type=submit]');
    await page.waitForSelector('[data-err="advance_paid"]:not(:empty)');
    ok('advance above freight is rejected');
    await page.fill('[name=advance_paid]', '20000');
    await page.click('form[data-form=trip] button[type=submit]');
    await page.waitForSelector('h1:has-text("BK-2026-00001")');
    await page.waitForSelector('text=₦80,000.00');
    ok('booking created → trip page with auto-number and balance due ₦80,000.00');

    await page.click('button:has-text("Mark as Loaded")');
    await page.fill('.modal textarea[name=note]', 'Loaded at Apapa, seal 123');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.badge:has-text("Loaded")');
    await page.waitForSelector('.timeline :text("Loaded at Apapa, seal 123")');
    ok('status advanced via RPC; note appears in history');

    await page.click('button:has-text("Cancel trip")');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.badge:has-text("Cancelled")');
    await page.click('button:has-text("Re-open as Booked")');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.badge:has-text("Booked")');
    ok('cancel and re-open work');

    // --- waybill ---
    await page.click('a:has-text("Waybill")');
    await page.waitForSelector('#waybill-sheet');
    assert.match(await page.textContent('#waybill-sheet'), /WB-2026-00001/);
    assert.equal(await page.locator('.wb-freight').first().isHidden(), true);
    await page.check('[data-change="waybill:toggle-freight"]');
    assert.equal(await page.locator('.wb-freight').first().isVisible(), true);
    ok('waybill renders with number; freight hidden until toggled');
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.sidebar').isVisible(), false);
    assert.equal(await page.locator('#waybill-sheet').isVisible(), true);
    await page.emulateMedia({ media: 'screen' });
    ok('print stylesheet hides app chrome, keeps the waybill');

    // --- settings, team, persistence, sign out ---
    await page.click('#nav >> text=Team');
    await page.waitForSelector('td:has-text("Tola Adeyemi")');
    ok('team page lists the owner');

    await page.reload();
    await page.waitForSelector('#shell:not([hidden])');
    ok('session persists across reload (refresh-token storage)');

    await page.click('text=Sign out');
    await page.waitForURL('**/login.html');
    await page.goto(base + '/app.html');
    await page.waitForURL('**/login.html');
    ok('sign out ends the session; app redirects to login');

    // --- bad login ---
    await page.fill('[data-mode="signin"] [name=email]', 'tola@alpha.ng');
    await page.fill('[data-mode="signin"] [name=password]', 'wrong');
    await page.click('[data-mode="signin"] button[type=submit]');
    await page.waitForSelector('#msg:not([hidden])');
    assert.match(await page.textContent('#msg'), /Invalid login credentials/);
    ok('wrong password shows a clear error');

    // --- mobile layout ---
    await page.setViewportSize({ width: 380, height: 740 });
    await page.fill('[data-mode="signin"] [name=password]', 'supersecret1');
    await page.click('[data-mode="signin"] button[type=submit]');
    await page.waitForSelector('#shell:not([hidden])');
    assert.equal(await page.locator('.menu-btn').isVisible(), true);
    await page.click('.menu-btn');
    await page.waitForSelector('body.menu-open');
    ok('mobile: hamburger menu opens the sidebar');

    // CSP / console cleanliness across the whole run
    // The 409 (duplicate plate) and 400 (wrong password) are responses this script provoked on purpose; Chromium
    // logs every non-2xx fetch. Anything else — JS errors, and above all CSP violations — is a failure.
    const unexpected = problems.filter((m) => !/Failed to load resource: the server responded with a status of (409|400)/.test(m));
    assert.deepEqual(unexpected, [], 'unexpected console/CSP errors:\n' + unexpected.join('\n'));
    assert.ok(!problems.some((m) => /Content Security Policy/i.test(m)), 'CSP violation');
    ok('no JS errors or CSP violations across the entire session (only the 2 deliberately provoked 4xx responses)');
    console.log(`\nE2E PASSED (${step} checks)`);
} catch (e) {
    console.error('\nE2E FAILED at step', step + 1, '\n', e.message);
    if (problems.length) console.error('Browser problems:\n' + problems.join('\n'));
    await page.screenshot({ path: '/tmp/e2e-fail.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
} finally {
    await browser.close(); server.close();
}
