// Serves public/ with the production CSP header AND a mock Supabase (Auth + PostgREST + a few RPCs) on the same origin.
// This is a test double for browser-level verification only — RLS is verified separately in SQL.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transitionAllowed } from '../../public/js/lib/lifecycle.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
const CSP = /Content-Security-Policy = "([^"]+)"/.exec(toml)[1];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

export function startServer(port = 0) {
    const db = { users: [], profiles: [], companies: [], company_members: [], customers: [], vehicles: [], drivers: [], trips: [], trip_status_history: [] };
    const counters = {};
    const sessions = new Map();
    const now = () => new Date().toISOString();
    const send = (res, status, body, extra = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...extra }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const userFrom = (req) => { const t = (req.headers.authorization || '').replace('Bearer ', ''); return sessions.get(t) || null; };
    const mkSession = (u) => { const at = 'at_' + randomUUID(); sessions.set(at, u); return { access_token: at, refresh_token: 'rt_' + u.id, expires_in: 3600, token_type: 'bearer', user: { id: u.id, email: u.email } }; };

    function applyFilters(rows, params) {
        for (const [k, v] of params) {
            if (['select', 'order', 'limit'].includes(k)) continue;
            const m = /^(eq|neq|is|in|gte|lte|gt|lt)\.(.*)$/.exec(v); if (!m) continue;
            const [, op, val] = m;
            rows = rows.filter((r) => {
                const x = r[k];
                if (op === 'eq') return String(x) === val;
                if (op === 'neq') return String(x) !== val;
                if (op === 'is') return val === 'null' ? x == null : String(x) === val;
                if (op === 'in') return val.slice(1, -1).split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(x));
                if (op === 'gte') return x >= val; if (op === 'lte') return x <= val; if (op === 'gt') return x > val; if (op === 'lt') return x < val;
                return true;
            });
        }
        const ord = params.find(([k]) => k === 'order');
        if (ord) { const [c, d] = ord[1].split('.'); rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (d === 'desc' ? -1 : 1)); }
        const lim = params.find(([k]) => k === 'limit'); if (lim) rows = rows.slice(0, Number(lim[1]));
        return rows;
    }
    const defaults = {
        vehicles: () => ({ status: 'active', ownership: 'own', vehicle_type: 'truck', deleted_at: null }),
        drivers: () => ({ status: 'active', deleted_at: null, user_id: null }),
        customers: () => ({ customer_type: 'business', credit_terms_days: 0, deleted_at: null }),
        trips: () => ({ status: 'booked', deleted_at: null, advance_paid: 0, broker_commission_amount: 0, currency: 'NGN' })
    };

    function rpc(fn, args, user) {
        if (fn === 'create_company') {
            if (!args.p_name || args.p_name.trim().length < 2) return [400, { code: '22023', message: 'Company name is required' }];
            const c = { id: randomUUID(), name: args.p_name.trim(), phone: args.p_phone, state: args.p_state, address: args.p_address, plan: 'starter', subscription_status: 'trialing', trial_ends_at: new Date(Date.now() + 7 * 864e5).toISOString(), deleted_at: null, created_at: now() };
            db.companies.push(c); db.company_members.push({ id: randomUUID(), company_id: c.id, user_id: user.id, role: 'owner', is_active: true, created_at: now() });
            return [200, c.id];
        }
        if (fn === 'advance_trip_status') {
            const t = db.trips.find((x) => x.id === args.p_trip_id); if (!t) return [404, { code: 'P0002', message: 'Trip not found' }];
            if (['invoiced', 'paid'].includes(args.p_to)) return [400, { code: '22023', message: 'Invoiced and Paid are set by the billing module' }];
            if (!transitionAllowed(t.status, args.p_to)) return [400, { code: '23514', message: `Invalid trip status change: ${t.status} -> ${args.p_to}` }];
            db.trip_status_history.push({ id: db.trip_status_history.length + 1, company_id: t.company_id, trip_id: t.id, from_status: t.status, to_status: args.p_to, note: args.p_note, changed_by: user.id, changed_at: now() });
            t.status = args.p_to; return [200, t];
        }
        return [404, { code: '42883', message: `unknown rpc ${fn}` }];
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://x');
        let raw = ''; for await (const ch of req) raw += ch;
        const body = raw ? JSON.parse(raw) : undefined;

        if (url.pathname.startsWith('/auth/v1/')) {
            const p = url.pathname.slice(9);
            if (p === 'signup') {
                if (db.users.find((u) => u.email === body.email)) return send(res, 422, { msg: 'User already registered' });
                const u = { id: randomUUID(), email: body.email, password: body.password };
                db.users.push(u); db.profiles.push({ id: u.id, email: u.email, full_name: body.data?.full_name || '' });
                return send(res, 200, mkSession(u));
            }
            if (p === 'token') {
                if (url.searchParams.get('grant_type') === 'password') {
                    const u = db.users.find((x) => x.email === body.email && x.password === body.password);
                    return u ? send(res, 200, mkSession(u)) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
                }
                const u = db.users.find((x) => 'rt_' + x.id === body.refresh_token);
                return u ? send(res, 200, mkSession(u)) : send(res, 400, { error_description: 'bad refresh' });
            }
            if (p === 'user') return userFrom(req) ? send(res, 200, userFrom(req)) : send(res, 401, { msg: 'no' });
            if (p === 'logout') return send(res, 204);
        }
        if (url.pathname.startsWith('/rest/v1/')) {
            const user = userFrom(req);
            if (!user) return send(res, 401, { message: 'JWT required', code: 'PGRST301' });
            const name = url.pathname.slice(9);
            if (name.startsWith('rpc/')) { const [s, b] = rpc(name.slice(4), body || {}, user); return send(res, s, b); }
            const table = db[name]; if (!table) return send(res, 404, { message: 'no table', code: '42P01' });
            const prefer = req.headers.prefer || '';
            const params = [...url.searchParams.entries()];
            if (req.method === 'GET' || req.method === 'HEAD') {
                const rows = applyFilters(table, params);
                const hdr = { 'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` };
                if (req.method === 'HEAD') return send(res, 200, undefined, hdr);
                if ((req.headers.accept || '').includes('vnd.pgrst.object')) return rows[0] ? send(res, 200, rows[0], hdr) : send(res, 406, { code: 'PGRST116', message: 'no rows' });
                return send(res, 200, rows, hdr);
            }
            if (req.method === 'POST') {
                const items = (Array.isArray(body) ? body : [body]).map((r) => {
                    const row = { id: randomUUID(), created_at: now(), ...(defaults[name] ? defaults[name]() : {}), ...r };
                    if (name === 'vehicles') {
                        row.plate_number = row.plate_number.trim().toUpperCase();
                        if (db.vehicles.some((v) => v.company_id === row.company_id && v.plate_number === row.plate_number && !v.deleted_at)) throw Object.assign(new Error('dup'), { pg: '23505' });
                    }
                    if (name === 'trips') {
                        const k = (counters[row.company_id] = (counters[row.company_id] || 0) + 1);
                        row.booking_no = `BK-2026-${String(k).padStart(5, '0')}`; row.waybill_no = `WB-2026-${String(k).padStart(5, '0')}`;
                        db.trip_status_history.push({ id: db.trip_status_history.length + 1, company_id: row.company_id, trip_id: row.id, from_status: null, to_status: 'booked', changed_by: user.id, changed_at: now() });
                    }
                    return row;
                });
                table.push(...items);
                return prefer.includes('return=representation') ? ((req.headers.accept || '').includes('vnd.pgrst.object') ? send(res, 201, items[0]) : send(res, 201, items)) : send(res, 201);
            }
            if (req.method === 'PATCH') {
                const rows = applyFilters(table, params); rows.forEach((r) => Object.assign(r, body));
                return prefer.includes('return=representation') ? send(res, 200, rows) : send(res, 204);
            }
        }
        if (url.pathname === '/js/config.js') {
            res.writeHead(200, { 'Content-Type': 'text/javascript', 'Content-Security-Policy': CSP });
            return res.end(`export default ${JSON.stringify({ supabaseUrl: 'http://' + req.headers.host, anonKey: 'ANON', siteUrl: 'http://' + req.headers.host })};`);
        }
        // static
        let p = url.pathname === '/' ? '/index.html' : url.pathname;
        let f = join(ROOT, 'public', p);
        if (!existsSync(f) && existsSync(f + '.html')) f += '.html';
        if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Content-Security-Policy': CSP });
        res.end(readFileSync(f));
    });
    // wrap handler errors (e.g. unique violation) into PostgREST-style responses
    const orig = server.listeners('request')[0]; server.removeAllListeners('request');
    server.on('request', (req, res) => orig(req, res).catch((e) => { if (e.pg) send(res, 409, { code: e.pg, message: 'duplicate key value violates unique constraint' }); else { console.error(e); send(res, 500, { message: String(e) }); } }));
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, db, port: server.address().port })));
}
