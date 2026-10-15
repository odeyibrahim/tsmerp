import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../public/js/lib/sb.js';

function mockFetch(handler) {
    const calls = [];
    const f = async (url, init) => {
        const u = new URL(url);
        const call = { url, path: u.pathname, query: u.search, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
        calls.push(call);
        const r = handler(call, calls.length) || {};
        const status = r.status || 200;
        const hdrs = new Map(Object.entries(r.headers || {}));
        return { ok: status >= 200 && status < 300, status, headers: { get: (k) => hdrs.get(k.toLowerCase()) ?? null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
    };
    return { f, calls };
}
const mk = (handler, extra = {}) => {
    const m = mockFetch(handler);
    return { ...m, sb: createClient({ url: 'https://x.supabase.co/', anonKey: 'ANON', fetch: m.f, ...extra }) };
};
const sess = (over = {}) => ({ access_token: 'AT', refresh_token: 'RT', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1' }, ...over });
const store = (s) => { const m = new Map(s ? [['tms.session', JSON.stringify(s)]] : []); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };

test('select builds an encoded query with apikey + user bearer', async () => {
    const { sb, calls } = mk(() => ({ body: [{ id: 1 }] }), { storage: store(sess()) });
    const { data, error } = await sb.from('trips').select('id,status').eq('company_id', 'c1').is('deleted_at', null).in('status', ['booked', 'a,b']).order('created_at', { ascending: false }).limit(5);
    assert.equal(error, null);
    assert.deepEqual(data, [{ id: 1 }]);
    const c = calls[0];
    assert.equal(c.path, '/rest/v1/trips');
    const q = new URLSearchParams(c.query);
    assert.equal(q.get('select'), 'id,status');
    assert.equal(q.get('company_id'), 'eq.c1');
    assert.equal(q.get('deleted_at'), 'is.null');
    assert.equal(q.get('status'), 'in.(booked,"a,b")');
    assert.equal(q.get('order'), 'created_at.desc');
    assert.equal(c.headers.apikey, 'ANON');
    assert.equal(c.headers.Authorization, 'Bearer AT');
});
test('anonymous requests fall back to the anon key', async () => {
    const { sb, calls } = mk(() => ({ body: [] }));
    await sb.from('x').select();
    assert.equal(calls[0].headers.Authorization, 'Bearer ANON');
});
test('insert returns the row only when select() is chained', async () => {
    const { sb, calls } = mk(() => ({ status: 201, body: [{ id: 'n' }] }), { storage: store(sess()) });
    await sb.from('t').insert({ a: 1 });
    assert.equal(calls[0].headers.Prefer, 'return=minimal');
    const r = await sb.from('t').insert({ a: 1 }).select().single();
    assert.equal(calls[1].headers.Prefer, 'return=representation');
    assert.equal(calls[1].headers.Accept, 'application/vnd.pgrst.object+json');
    assert.equal(calls[1].method, 'POST');
    assert.deepEqual(calls[1].body, { a: 1 });
    assert.ok(r.data);
});
test('update/patch + maybeSingle + count/head', async () => {
    const { sb, calls } = mk((c) => (c.method === 'HEAD' ? { headers: { 'content-range': '*/42' } } : { body: [{ id: 1 }, { id: 2 }] }), { storage: store(sess()) });
    await sb.from('t').update({ a: null }).eq('id', 'z');
    assert.equal(calls[0].method, 'PATCH');
    assert.deepEqual(calls[0].body, { a: null });
    const m = await sb.from('t').select('*').maybeSingle();
    assert.deepEqual(m.data, { id: 1 });
    const cnt = await sb.from('t').select('id', { count: 'exact', head: true });
    assert.equal(cnt.count, 42);
    assert.equal(calls[2].method, 'HEAD');
    assert.equal(calls[2].headers.Prefer, 'count=exact');
});
test('PostgREST errors are surfaced as { error }', async () => {
    const { sb } = mk(() => ({ status: 409, body: { code: '23505', message: 'duplicate key', details: 'd' } }), { storage: store(sess()) });
    const r = await sb.from('t').insert({ a: 1 });
    assert.equal(r.data, null);
    assert.equal(r.error.code, '23505');
});
test('network failure becomes a friendly error, not a throw', async () => {
    const sb = createClient({ url: 'https://x.co', anonKey: 'A', fetch: async () => { throw new Error('boom'); } });
    const r = await sb.from('t').select();
    assert.equal(r.error.code, 'NETWORK');
});
test('rpc posts args and returns scalar json', async () => {
    const { sb, calls } = mk(() => ({ body: 'company-uuid' }), { storage: store(sess()) });
    const r = await sb.rpc('create_company', { p_name: 'Acme' });
    assert.equal(calls[0].path, '/rest/v1/rpc/create_company');
    assert.deepEqual(calls[0].body, { p_name: 'Acme' });
    assert.equal(r.data, 'company-uuid');
});
test('expiring token is refreshed before the request, once, and persisted', async () => {
    const st = store(sess({ expires_at: Math.floor(Date.now() / 1000) + 10 }));
    const { sb, calls } = mk((c) => (c.path === '/auth/v1/token' ? { body: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, user: { id: 'u1' } } } : { body: [] }), { storage: st });
    await Promise.all([sb.from('a').select(), sb.from('b').select()]);
    assert.equal(calls.filter((c) => c.path === '/auth/v1/token').length, 1);
    assert.ok(calls.filter((c) => c.path.startsWith('/rest')).every((c) => c.headers.Authorization === 'Bearer AT2'));
    assert.equal(JSON.parse(st.m.get('tms.session')).refresh_token, 'RT2');
});
test('a 401 triggers one refresh + retry', async () => {
    let n = 0;
    const { sb, calls } = mk((c) => {
        if (c.path === '/auth/v1/token') return { body: { access_token: 'NEW', refresh_token: 'R', expires_in: 3600 } };
        return ++n === 1 ? { status: 401, body: { message: 'JWT expired' } } : { body: [{ ok: 1 }] };
    }, { storage: store(sess()) });
    const r = await sb.from('t').select();
    assert.deepEqual(r.data, [{ ok: 1 }]);
    assert.equal(calls.at(-1).headers.Authorization, 'Bearer NEW');
});
test('rejected refresh token signs the user out', async () => {
    const st = store(sess({ expires_at: 1 }));
    const { sb } = mk((c) => (c.path === '/auth/v1/token' ? { status: 400, body: { error_description: 'bad' } } : { body: [] }), { storage: st });
    await sb.from('t').select();
    assert.equal(st.getItem('tms.session'), null);
});
test('signIn stores the session; signOut clears it', async () => {
    const st = store();
    const { sb, calls } = mk((c) => (c.path === '/auth/v1/token' ? { body: { access_token: 'A', refresh_token: 'R', expires_in: 3600, user: { id: 'u' } } } : {}), { storage: st });
    const r = await sb.auth.signIn({ email: 'a@b.com', password: 'pw' });
    assert.equal(r.data.session.user.id, 'u');
    assert.deepEqual(calls[0].body, { email: 'a@b.com', password: 'pw' });
    assert.ok(st.getItem('tms.session'));
    await sb.auth.signOut();
    assert.equal(st.getItem('tms.session'), null);
});
test('bad password returns a readable error', async () => {
    const { sb } = mk(() => ({ status: 400, body: { error_description: 'Invalid login credentials' } }));
    const r = await sb.auth.signIn({ email: 'a@b.com', password: 'x' });
    assert.equal(r.error.message, 'Invalid login credentials');
});
test('signUp: confirmation-required vs auto-confirmed', async () => {
    let a = mk(() => ({ body: { id: 'u', email: 'a@b.com' } })).sb;
    assert.equal((await a.auth.signUp({ email: 'a@b.com', password: 'longenough', fullName: 'A' })).data.needsConfirmation, true);
    let b = mk(() => ({ body: { access_token: 'A', refresh_token: 'R', expires_in: 3600, user: { id: 'u' } } })).sb;
    assert.equal((await b.auth.signUp({ email: 'a@b.com', password: 'longenough' })).data.needsConfirmation, false);
});
test('consumeRedirect parses invite/recovery/oauth fragments', async () => {
    const { sb } = mk((c) => (c.path === '/auth/v1/user' ? { body: { id: 'u9', email: 'i@b.com' } } : {}), { storage: store() });
    const r = await sb.auth.consumeRedirect('#access_token=TOK&refresh_token=RR&expires_in=3600&type=invite');
    assert.equal(r.type, 'invite');
    assert.equal(r.session.user.id, 'u9');
    const e = await sb.auth.consumeRedirect('#error=access_denied&error_description=Link+expired');
    assert.equal(e.error.message, 'Link expired');
    assert.deepEqual(await sb.auth.consumeRedirect(''), { session: null, type: null });
});
