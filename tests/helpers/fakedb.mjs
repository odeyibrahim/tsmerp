// In-memory stand-in for the sb.js client, good enough to render pages in Node.
export function fakeDb(tables, rpcs = {}) {
    class Q {
        constructor(name) { this.name = name; this.f = []; this.ord = null; this.lim = null; this.maybe = false; this.single_ = false; this.opts = {}; }
        select(_c, opts = {}) { this.opts = opts; return this; }
        eq(c, v) { this.f.push((r) => r[c] === v); return this; }
        neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
        is(c, v) { this.f.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
        in(c, vals) { this.f.push((r) => vals.includes(r[c])); return this; }
        gte(c, v) { this.f.push((r) => r[c] >= v); return this; }
        order(c, { ascending = true } = {}) { this.ord = [c, ascending]; return this; }
        limit(n) { this.lim = n; return this; }
        maybeSingle() { this.maybe = true; return this; }
        single() { this.single_ = true; return this; }
        then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
        run() {
            let rows = (tables[this.name] || []).filter((r) => this.f.every((fn) => fn(r)));
            if (this.ord) { const [c, asc] = this.ord; rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
            if (this.lim != null) rows = rows.slice(0, this.lim);
            if (this.opts.head) return { data: null, error: null, count: rows.length };
            if (this.maybe || this.single_) return { data: rows[0] || null, error: null, count: null };
            return { data: rows, error: null, count: rows.length };
        }
    }
    return { from: (n) => new Q(n), rpc: async (fn, args) => (rpcs[fn] ? rpcs[fn](args) : { data: null, error: null }), auth: { getSession: async () => ({ access_token: 't' }) } };
}
export const ids = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
