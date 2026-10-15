// Minimal Supabase client (GoTrue Auth + PostgREST) on plain fetch — no dependencies, no build step,
// a few KB instead of the ~100KB supabase-js bundle (matters on Nigerian mobile networks), and
// nothing for the strict CSP to allow beyond connect-src. Mirrors supabase-js's { data, error } shape.
// Security note: this only ever holds the PUBLIC anon key. Row Level Security is the real boundary.

const SESSION_KEY = 'tms.session';
const REFRESH_MARGIN_S = 60;

function memoryStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const enc = encodeURIComponent;
const quoteIn = (v) => (/[,()"]/.test(String(v)) ? `"${String(v).replace(/"/g, '\\"')}"` : String(v));

export function createClient({ url, anonKey, storage, fetch: fetchImpl, now = Date.now }) {
    const base = String(url || '').replace(/\/+$/, '');
    const store = storage || memoryStorage();
    const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    const listeners = new Set();
    let session = null;
    let refreshing = null;

    try { session = JSON.parse(store.getItem(SESSION_KEY) || 'null'); } catch { session = null; }

    function setSession(s) {
        session = s;
        try { s ? store.setItem(SESSION_KEY, JSON.stringify(s)) : store.removeItem(SESSION_KEY); } catch { /* storage full/blocked */ }
        listeners.forEach((cb) => cb(s));
    }
    function toSession(p) {
        if (!p || !p.access_token) return null;
        return {
            access_token: p.access_token,
            refresh_token: p.refresh_token,
            expires_at: p.expires_at || Math.floor(now() / 1000) + (p.expires_in || 3600),
            user: p.user || (session && session.user) || null
        };
    }

    async function http(path, { method = 'GET', headers = {}, body, token } = {}) {
        let res;
        try {
            res = await doFetch(base + path, {
                method,
                headers: { apikey: anonKey, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || anonKey), ...headers },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        } catch (e) {
            return { status: 0, data: null, headers: null, error: { message: 'Network error. Check your connection and try again.', code: 'NETWORK' } };
        }
        const text = method === 'HEAD' ? '' : await res.text();
        let data = null;
        if (text) { try { data = JSON.parse(text); } catch { data = text; } }
        if (!res.ok) {
            const d = data && typeof data === 'object' ? data : {};
            return {
                status: res.status, data: null, headers: res.headers,
                error: { message: d.message || d.msg || d.error_description || d.error || `Request failed (${res.status})`, code: d.code || d.error_code || String(res.status), details: d.details || null, hint: d.hint || null, status: res.status }
            };
        }
        return { status: res.status, data, headers: res.headers, error: null };
    }

    async function refresh() {
        if (!session || !session.refresh_token) return null;
        if (!refreshing) {
            refreshing = (async () => {
                const r = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
                const next = r.error ? null : toSession(r.data);
                if (!next && r.status !== 0) setSession(null); // refresh token rejected -> signed out (keep session on plain network failure)
                else if (next) setSession(next);
                return next;
            })().finally(() => { refreshing = null; });
        }
        return refreshing;
    }
    async function accessToken() {
        if (!session) return null;
        if (session.expires_at - now() / 1000 < REFRESH_MARGIN_S) {
            const s = await refresh();
            return s ? s.access_token : (session ? session.access_token : null);
        }
        return session.access_token;
    }
    async function authed(path, opts = {}) {
        let r = await http(path, { ...opts, token: await accessToken() });
        if (r.status === 401 && session) {
            const s = await refresh();
            if (s) r = await http(path, { ...opts, token: s.access_token });
        }
        return r;
    }

    class Query {
        constructor(table) {
            this.table = table; this.method = 'GET'; this.params = []; this.prefer = new Set();
            this.body = undefined; this._single = false; this._maybe = false; this._head = false;
        }
        select(cols = '*', opts = {}) {
            this.params.push(['select', cols]);
            if (this.method !== 'GET') this.prefer.add('return=representation');
            if (opts.count) this.prefer.add('count=exact');
            if (opts.head) this._head = true;
            return this;
        }
        insert(rows) { this.method = 'POST'; this.body = rows; this.prefer.add('return=minimal'); return this; }
        update(values) { this.method = 'PATCH'; this.body = values; this.prefer.add('return=minimal'); return this; }
        delete() { this.method = 'DELETE'; this.prefer.add('return=minimal'); return this; }
        _f(col, op, val) { this.params.push([col, `${op}.${val}`]); return this; }
        eq(c, v) { return this._f(c, 'eq', v); }
        neq(c, v) { return this._f(c, 'neq', v); }
        gt(c, v) { return this._f(c, 'gt', v); }
        gte(c, v) { return this._f(c, 'gte', v); }
        lt(c, v) { return this._f(c, 'lt', v); }
        lte(c, v) { return this._f(c, 'lte', v); }
        ilike(c, v) { return this._f(c, 'ilike', v); }
        is(c, v) { return this._f(c, 'is', v === null ? 'null' : v); }
        in(c, vals) { return this._f(c, 'in', `(${vals.map(quoteIn).join(',')})`); }
        or(expr) { this.params.push(['or', `(${expr})`]); return this; }
        order(col, { ascending = true } = {}) { this.params.push(['order', `${col}.${ascending ? 'asc' : 'desc'}`]); return this; }
        limit(n) { this.params.push(['limit', String(n)]); return this; }
        single() { this._single = true; return this; }
        maybeSingle() { this._maybe = true; return this; }
        then(resolve, reject) { return this.exec().then(resolve, reject); }

        async exec() {
            if (this.method !== 'GET' && this.prefer.has('return=representation')) this.prefer.delete('return=minimal');
            const qs = this.params.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
            const headers = {};
            if (this.prefer.size) headers.Prefer = [...this.prefer].join(',');
            if (this._single) headers.Accept = 'application/vnd.pgrst.object+json';
            const r = await authed(`/rest/v1/${this.table}${qs ? '?' + qs : ''}`, { method: this._head ? 'HEAD' : this.method, headers, body: this.body });
            if (r.error) return { data: null, error: r.error, count: null, status: r.status };
            let count = null;
            const cr = r.headers && r.headers.get && r.headers.get('content-range');
            if (cr && /\/(\d+)$/.test(cr)) count = Number(/\/(\d+)$/.exec(cr)[1]);
            let data = r.data;
            if (this._maybe) data = Array.isArray(data) ? (data[0] ?? null) : data;
            return { data, error: null, count, status: r.status };
        }
    }

    const auth = {
        getSession: async () => (session ? { ...session, access_token: (await accessToken()) || session.access_token } : null),
        currentSession: () => session,
        onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
        async signUp({ email, password, fullName, redirectTo }) {
            const r = await http('/auth/v1/signup' + (redirectTo ? `?redirect_to=${enc(redirectTo)}` : ''), { method: 'POST', body: { email, password, data: { full_name: fullName || '' } } });
            if (r.error) return { data: null, error: r.error };
            const s = toSession(r.data);
            if (s) { s.user = s.user || r.data.user; setSession(s); }
            return { data: { session: s, needsConfirmation: !s }, error: null };
        },
        async signIn({ email, password }) {
            const r = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
            if (r.error) return { data: null, error: r.error };
            const s = toSession(r.data);
            setSession(s);
            return { data: { session: s }, error: null };
        },
        googleUrl(redirectTo) { return `${base}/auth/v1/authorize?provider=google&redirect_to=${enc(redirectTo)}`; },
        async resetPassword(email, redirectTo) {
            const r = await http('/auth/v1/recover' + (redirectTo ? `?redirect_to=${enc(redirectTo)}` : ''), { method: 'POST', body: { email } });
            return { error: r.error };
        },
        async updatePassword(password) {
            const r = await authed('/auth/v1/user', { method: 'PUT', body: { password } });
            return { error: r.error };
        },
        async signOut() {
            if (session) await http('/auth/v1/logout', { method: 'POST', token: session.access_token });
            setSession(null);
        },
        // Call once on page load: picks up the #access_token=... fragment from email-confirmation,
        // invite, recovery and Google OAuth redirects.
        async consumeRedirect(hash) {
            const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
            if (p.get('error_description') || p.get('error')) return { error: { message: (p.get('error_description') || p.get('error')).replace(/\+/g, ' ') }, type: null };
            if (!p.get('access_token')) return { session: null, type: null };
            const tok = p.get('access_token');
            const u = await http('/auth/v1/user', { token: tok });
            if (u.error) return { error: u.error, type: null };
            const s = toSession({ access_token: tok, refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in')) || 3600, user: u.data });
            setSession(s);
            return { session: s, type: p.get('type') || 'login' };
        }
    };

    return {
        auth,
        from: (table) => new Query(table),
        async rpc(fn, args = {}) {
            const r = await authed(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
            return r.error ? { data: null, error: r.error } : { data: r.data, error: null };
        }
    };
}
