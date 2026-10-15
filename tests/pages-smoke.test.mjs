import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb, ids } from './helpers/fakedb.mjs';
import { state } from '../public/js/lib/state.js';

const CO = ids(1);
const XSS = '<img src=x onerror=alert(1)>';
const tables = () => ({
    customers: [{ id: ids(10), company_id: CO, name: `Acme ${XSS}`, customer_type: 'business', phone: '+2348031110001', contact_person: 'Ada', state: 'Lagos', credit_terms_days: 14, deleted_at: null, created_at: '2026-10-01' }],
    vehicles: [
        { id: ids(20), company_id: CO, plate_number: 'LSR-412AA', vehicle_type: 'truck', make: 'Mack', model: 'CH613', year: 2016, tonnage: 30, ownership: 'own', status: 'active', deleted_at: null, created_at: '2026-10-01' },
        { id: ids(21), company_id: CO, plate_number: 'EPE-336GH', vehicle_type: 'tanker', ownership: 'attached', owner_name: 'Alhaji Bello', status: 'active', deleted_at: null, created_at: '2026-10-02' }
    ],
    drivers: [{ id: ids(30), company_id: CO, full_name: 'Musa Ibrahim', phone: '+2348021230001', licence_number: 'LAG-1', licence_expiry: '2020-01-01', status: 'active', deleted_at: null, created_at: '2026-10-01' }],
    trips: [{
        id: ids(40), company_id: CO, booking_no: 'BK-2026-00001', waybill_no: 'WB-2026-00001', status: 'delivered', customer_id: ids(10), vehicle_id: ids(20), driver_id: ids(30),
        origin_state: 'Lagos', destination_state: 'Oyo', cargo_description: 'Bagged cement', cargo_weight_tonnes: 28, freight_amount: 420000, advance_paid: 150000, currency: 'NGN',
        broker_name: null, broker_commission_amount: 0, pickup_date: '2026-10-10', created_at: '2026-10-10T08:00:00Z', deleted_at: null, notes: null
    }],
    trip_status_history: [
        { id: 1, trip_id: ids(40), to_status: 'booked', from_status: null, changed_at: '2026-10-10T08:00:00Z', changed_by: ids(90), note: null },
        { id: 2, trip_id: ids(40), to_status: 'loaded', from_status: 'booked', changed_at: '2026-10-11T08:00:00Z', changed_by: ids(90), note: `Sealed ${XSS}` }
    ],
    profiles: [{ id: ids(90), full_name: 'Tola Dispatcher', email: 't@x.ng' }],
    company_members: [{ id: ids(95), company_id: CO, user_id: ids(90), role: 'owner', is_active: true, created_at: '2026-10-01' }]
});
function as(role, extra = {}) {
    state.db = fakeDb(tables(), extra.rpcs);
    state.user = { id: ids(90), email: 't@x.ng' };
    state.role = role;
    state.company = { id: CO, name: 'Alpha Haulage', state: 'Lagos', phone: '+2348031110000', plan: 'starter', subscription_status: 'trialing', trial_ends_at: new Date(Date.now() + 5 * 864e5).toISOString() };
}
const page = async (mod, params = {}) => String(await mod.render(params));

test('dashboard shows counts, checklist and trial banner', async () => {
    as('owner');
    const out = await page(await import('../public/js/pages/dashboard.js'));
    assert.match(out, /Alpha Haulage/);
    assert.match(out, /Free trial/);
    assert.match(out, /Licences expiring/);
    assert.match(out, /Musa Ibrahim/);          // expired licence listed
    assert.match(out, /BK-2026-00001/);
});
test('dashboard offers demo data only for an empty company', async () => {
    as('owner');
    state.db = fakeDb({ trips: [], vehicles: [], drivers: [], customers: [] });
    assert.match(await page(await import('../public/js/pages/dashboard.js')), /Load Nigerian demo data/);
    as('owner');
    assert.doesNotMatch(await page(await import('../public/js/pages/dashboard.js')), /Load Nigerian demo data/);
});
test('trips list renders rows and escapes hostile customer names', async () => {
    as('dispatcher');
    const out = await page(await import('../public/js/pages/trips.js'));
    assert.match(out, /BK-2026-00001/);
    assert.match(out, /₦420,000\.00/);
    assert.ok(!out.includes('<img src=x'), 'raw markup leaked');
    assert.match(out, /Acme &lt;img src=x/);
    assert.match(out, /New booking/);
});
test('accountant can read trips but not create them', async () => {
    as('accountant');
    assert.doesNotMatch(await page(await import('../public/js/pages/trips.js')), /\+ New booking/);
});
test('trip detail: dispatcher gets lifecycle actions; history notes are escaped', async () => {
    as('dispatcher');
    const out = await page(await import('../public/js/pages/trip.js'), { id: ids(40) });
    assert.match(out, /Mark as POD received/);
    assert.match(out, /Step back to In transit/);
    assert.match(out, /Cancel trip/);
    assert.match(out, /Balance due/);
    assert.match(out, /₦270,000\.00/);
    assert.match(out, /Tola Dispatcher/);
    assert.ok(!out.includes('<img src=x'));
});
test('trip detail: a driver sees no money, no POD button, no revert/cancel', async () => {
    as('driver');
    const out = await page(await import('../public/js/pages/trip.js'), { id: ids(40) });
    assert.doesNotMatch(out, /Balance due/);
    assert.doesNotMatch(out, /Mark as POD received/);
    assert.doesNotMatch(out, /Cancel trip/);
    assert.doesNotMatch(out, /Step back/);
});
test('trip detail: missing trip is a friendly error', async () => {
    as('owner');
    assert.match(await page(await import('../public/js/pages/trip.js'), { id: ids(99) }), /Trip not found/);
});
test('waybill: shows number + signature blocks, freight hidden by default, driver cannot reveal it', async () => {
    as('owner');
    const out = await page(await import('../public/js/pages/waybill.js'), { id: ids(40) });
    assert.match(out, /WB-2026-00001/);
    assert.match(out, /Driver's signature/);
    assert.match(out, /class="wb-freight" hidden/);
    assert.match(out, /Show freight on waybill/);
    as('driver');
    assert.doesNotMatch(await page(await import('../public/js/pages/waybill.js'), { id: ids(40) }), /Show freight on waybill/);
});
test('vehicles page marks attached vehicles; write buttons follow role', async () => {
    as('ops_manager');
    const v = (await import('../public/js/pages/vehicles.js')).default;
    let out = String(await v.render());
    assert.match(out, /Attached/);
    assert.match(out, /Alhaji Bello/);
    assert.match(out, /Add vehicle/);
    as('dispatcher');
    out = String(await v.render());
    assert.doesNotMatch(out, /Add vehicle/);
    assert.doesNotMatch(out, /data-action="vehicles:edit"/);
});
test('drivers page flags an expired licence', async () => {
    as('owner');
    const out = String(await (await import('../public/js/pages/drivers.js')).default.render());
    assert.match(out, /Expired/);
    assert.match(out, /\+234 802 123 0001/);
});
test('customers page escapes names', async () => {
    as('owner');
    const out = String(await (await import('../public/js/pages/customers.js')).default.render());
    assert.ok(!out.includes('<img src=x'));
});
test('team page is owner/admin only and shows members', async () => {
    as('dispatcher');
    assert.match(await page(await import('../public/js/pages/team.js')), /Only owners and admins/);
    as('owner');
    const out = await page(await import('../public/js/pages/team.js'));
    assert.match(out, /Tola Dispatcher/);
    assert.match(out, /\(you\)/);
});
test('settings page renders company form', async () => {
    as('owner');
    const out = await page(await import('../public/js/pages/settings.js'));
    assert.match(out, /Alpha Haulage/);
    assert.match(out, /RC number/);
});
test('trip booking form: corridors, all fields, and current assignment preserved', async () => {
    as('owner');
    const { tripFormHtml, loadLookups } = await import('../public/js/pages/trips.js');
    const lk = await loadLookups();
    const out = String(tripFormHtml(lk, null));
    for (const name of ['customer_id', 'origin_state', 'destination_state', 'freight_amount', 'advance_paid', 'vehicle_id', 'driver_id', 'broker_commission_amount']) assert.match(out, new RegExp(`name="${name}"`));
    assert.match(out, /Lagos → Abuja/);
    const inactive = { ...tables().trips[0], vehicle_id: ids(77) };
    assert.match(String(tripFormHtml(lk, inactive)), /inactive \/ archived/);
});

test('required selects start on a placeholder so a choice must be deliberate', async () => {
    as('owner');
    const { tripFormHtml, loadLookups } = await import('../public/js/pages/trips.js');
    const out = String(tripFormHtml(await loadLookups(), null));
    const cust = /<select id="f_customer_id"[^>]*>([\s\S]*?)<\/select>/.exec(out)[1];
    assert.match(cust, /<option value="">Choose…<\/option>/);
    assert.doesNotMatch(cust, /selected/);
    const currency = /<select id="f_currency"[^>]*>([\s\S]*?)<\/select>/.exec(out)[1];
    assert.doesNotMatch(currency, /Choose…/);          // has a default, so no placeholder
});
