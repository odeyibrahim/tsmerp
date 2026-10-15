import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { matchRoute } from '../public/js/lib/router.js';
import { inviteMember } from '../netlify/functions/_lib/invite.js';
import { html, raw } from '../public/js/lib/ui.js';

const ROOT = new URL('..', import.meta.url).pathname;

test('router matches params and ignores trailing slash / query', () => {
    const routes = [
        { pattern: /^\/$/, name: 'home' },
        { pattern: /^\/trips\/([0-9a-f-]{36})$/, params: ['id'], name: 'trip' },
        { pattern: /^\/trips\/([0-9a-f-]{36})\/waybill$/, params: ['id'], name: 'wb' }
    ];
    const id = '123e4567-e89b-12d3-a456-426614174000';
    assert.equal(matchRoute(routes, '#/').route.name, 'home');
    assert.equal(matchRoute(routes, `#/trips/${id}/`).params.id, id);
    assert.equal(matchRoute(routes, `#/trips/${id}/waybill?x=1`).route.name, 'wb');
    assert.equal(matchRoute(routes, '#/trips/not-a-uuid'), null);
});

test('html`` escapes by default; raw() and nested html pass through', () => {
    const evil = '<b onclick="x">&';
    assert.equal(String(html`<p>${evil}</p>`), '<p>&lt;b onclick=&quot;x&quot;&gt;&amp;</p>');
    assert.equal(String(html`<p>${html`<b>${evil}</b>`}</p>`), '<p><b>&lt;b onclick=&quot;x&quot;&gt;&amp;</b></p>');
    assert.equal(String(html`<i>${raw('<u>ok</u>')}</i>`), '<i><u>ok</u></i>');
    assert.equal(String(html`${[1, 'a<']}`), '1a&lt;');
    assert.equal(String(html`${null}${false}${undefined}`), '');
});

// ---------- invite-member authorization ----------
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fakeAdmin({ caller = { id: U(1) }, members = [], drivers = [], profiles = [], inviteResult } = {}) {
    const log = { upserts: [], driverUpdates: [], invites: [] };
    const tbl = { company_members: members, drivers, profiles };
    const q = (name) => {
        const f = []; let upsert, update;
        const api = {
            select() { return api; },
            eq(c, v) { f.push((r) => r[c] === v); return api; },
            is(c, v) { f.push((r) => (v === null ? r[c] == null : r[c] === v)); return api; },
            maybeSingle: async () => ({ data: tbl[name].find((r) => f.every((x) => x(r))) || null }),
            upsert: async (row) => { log.upserts.push(row); return { error: null }; },
            update(vals) { update = vals; return { eq: async (c, v) => { log.driverUpdates.push({ vals: update, [c]: v }); return { error: null }; } }; }
        };
        return api;
    };
    return {
        log,
        auth: {
            getUser: async (t) => (t === 'good' ? { data: { user: caller }, error: null } : { data: null, error: { message: 'bad' } }),
            admin: { inviteUserByEmail: async (email, opts) => { log.invites.push({ email, opts }); return inviteResult || { data: { user: { id: U(50) } }, error: null }; } }
        },
        from: q
    };
}
const C = U(100);
const body = (o = {}) => ({ company_id: C, email: 'New@Example.com', role: 'dispatcher', ...o });
const owner = [{ company_id: C, user_id: U(1), role: 'owner', is_active: true }];

test('invite: rejects missing/invalid token, bad input, wrong roles', async () => {
    assert.equal((await inviteMember({ admin: fakeAdmin(), token: '', body: body() })).status, 401);
    assert.equal((await inviteMember({ admin: fakeAdmin(), token: 'nope', body: body() })).status, 401);
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: owner }), token: 'good', body: body({ email: 'x' }) })).status, 400);
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: owner }), token: 'good', body: body({ role: 'owner' }) })).status, 400);
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: owner }), token: 'good', body: body({ company_id: 'x' }) })).status, 400);
});
test('invite: non-members and non-admins are refused (403), even with a valid JWT', async () => {
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: [] }), token: 'good', body: body() })).status, 403);
    const disp = [{ company_id: C, user_id: U(1), role: 'dispatcher', is_active: true }];
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: disp }), token: 'good', body: body() })).status, 403);
    const other = [{ company_id: U(999), user_id: U(1), role: 'owner', is_active: true }];   // owner of a DIFFERENT company
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: other }), token: 'good', body: body() })).status, 403);
    const inactive = [{ company_id: C, user_id: U(1), role: 'owner', is_active: false }];
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: inactive }), token: 'good', body: body() })).status, 403);
});
test('invite: new user gets an invite email and a membership', async () => {
    const admin = fakeAdmin({ members: owner });
    const r = await inviteMember({ admin, token: 'good', body: body(), siteUrl: 'https://app.example.ng/' });
    assert.equal(r.status, 200);
    assert.equal(admin.log.invites[0].email, 'new@example.com');
    assert.equal(admin.log.invites[0].opts.redirectTo, 'https://app.example.ng/login.html');
    assert.deepEqual(admin.log.upserts[0], { company_id: C, user_id: U(50), role: 'dispatcher', is_active: true });
});
test('invite: existing account is added without a new email', async () => {
    const admin = fakeAdmin({ members: owner, profiles: [{ id: U(60), email: 'new@example.com' }] });
    const r = await inviteMember({ admin, token: 'good', body: body(), siteUrl: 'https://x' });
    assert.equal(r.status, 200);
    assert.equal(admin.log.invites.length, 0);
    assert.equal(admin.log.upserts[0].user_id, U(60));
});
test('invite: can never overwrite an existing owner', async () => {
    const members = [...owner, { company_id: C, user_id: U(60), role: 'owner', is_active: true }];
    const admin = fakeAdmin({ members, profiles: [{ id: U(60), email: 'new@example.com' }] });
    assert.equal((await inviteMember({ admin, token: 'good', body: body(), siteUrl: 'https://x' })).status, 409);
    assert.equal(admin.log.upserts.length, 0);
});
test('invite: driver role requires an unlinked driver record from the same company', async () => {
    const d = U(70);
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: owner }), token: 'good', body: body({ role: 'driver' }) })).status, 400);
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: owner, drivers: [] }), token: 'good', body: body({ role: 'driver', driver_id: d }) })).status, 400);
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: owner, drivers: [{ id: d, company_id: U(999), user_id: null, deleted_at: null }] }), token: 'good', body: body({ role: 'driver', driver_id: d }) })).status, 400);
    assert.equal((await inviteMember({ admin: fakeAdmin({ members: owner, drivers: [{ id: d, company_id: C, user_id: U(5), deleted_at: null }] }), token: 'good', body: body({ role: 'driver', driver_id: d }) })).status, 409);
    const admin = fakeAdmin({ members: owner, drivers: [{ id: d, company_id: C, user_id: null, deleted_at: null }] });
    assert.equal((await inviteMember({ admin, token: 'good', body: body({ role: 'driver', driver_id: d }), siteUrl: 'https://x' })).status, 200);
    assert.deepEqual(admin.log.driverUpdates[0].vals, { user_id: U(50) });
});
test('invite: email-provider failure is surfaced, nothing is granted', async () => {
    const admin = fakeAdmin({ members: owner, inviteResult: { data: null, error: { message: 'rate limit' } } });
    const r = await inviteMember({ admin, token: 'good', body: body(), siteUrl: 'https://x' });
    assert.equal(r.status, 502);
    assert.equal(admin.log.upserts.length, 0);
});

// ---------- static / CSP / secrets checks ----------
function walk(dir, out = []) {
    for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
    return out;
}
test('CSP hygiene: no inline scripts, style attributes or inline event handlers in anything shipped', () => {
    const files = walk(join(ROOT, 'public')).filter((f) => /\.(html|js|css)$/.test(f));
    for (const f of files) {
        const s = readFileSync(f, 'utf8');
        const rel = f.replace(ROOT, '');
        if (f.endsWith('.html')) {
            assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(s), `inline <script> in ${rel}`);
            assert.ok(!/\sstyle\s*=/i.test(s), `style attribute in ${rel}`);
        }
        if (f.endsWith('.js')) {
            assert.ok(!/\sstyle\s*=\s*["'`]/.test(s), `style attribute in template in ${rel}`);
            assert.ok(!/\son(click|change|submit|input|load|error)\s*=/i.test(s), `inline handler in ${rel}`);
            assert.ok(!/\beval\(|new Function\(/.test(s), `eval in ${rel}`);
        }
    }
});
test('netlify CSP does not allow unsafe-inline or unsafe-eval', () => {
    const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
    const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)[1];
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /connect-src 'self' https:\/\/\*\.supabase\.co/);
});
test('no service-role key or secrets anywhere under public/', () => {
    for (const f of walk(join(ROOT, 'public')).filter((x) => /\.(html|js|json)$/.test(x))) {
        const s = readFileSync(f, 'utf8');
        assert.ok(!/SERVICE_ROLE|service_role|sk_live|sk_test/.test(s), `secret-looking string in ${f}`);
    }
});
test('every service-worker precache entry exists; manifest icons exist', () => {
    const sw = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');
    const block = /PRECACHE_URLS = \[([\s\S]*?)\];/.exec(sw)[1];
    const list = [...block.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);
    for (const p of list) {
        const file = p === '/' ? 'index.html' : p.slice(1);
        assert.ok(existsSync(join(ROOT, 'public', file)), `precache missing: ${p}`);
    }
    const man = JSON.parse(readFileSync(join(ROOT, 'public/manifest.json'), 'utf8'));
    for (const i of man.icons) assert.ok(existsSync(join(ROOT, 'public', i.src.slice(1))), i.src);
    // Every shipped JS module should be precached so the app shell works offline.
    const shipped = walk(join(ROOT, 'public/js')).map((f) => f.replace(join(ROOT, 'public'), '')).filter((p) => p !== '/js/config.js');
    for (const p of shipped) assert.ok(list.includes(p), `not precached: ${p}`);
});
test('migrations: every table that holds tenant data enables RLS and revokes anon/authenticated defaults', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/001_core_tenancy.sql'), 'utf8') + readFileSync(join(ROOT, 'supabase/migrations/002_fleet_haulage.sql'), 'utf8');
    const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    assert.ok(tables.length >= 10);
    for (const t of tables) {
        assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `RLS not enabled on ${t}`);
        assert.match(sql, new RegExp(`revoke all on [^;]*public\\.${t}\\b[^;]* from anon, authenticated`), `default grants not revoked on ${t}`);
    }
});
