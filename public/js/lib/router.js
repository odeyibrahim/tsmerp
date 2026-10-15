// Hash router: "#/trips/abc/waybill" -> { route, params }. Pure, so it is unit-tested.
export function matchRoute(routes, path) {
    const clean = (path || '/').replace(/^#/, '').split('?')[0].replace(/\/+$/, '') || '/';
    for (const r of routes) {
        const m = r.pattern.exec(clean);
        if (m) return { route: r, params: Object.fromEntries((r.params || []).map((k, i) => [k, m[i + 1]])) };
    }
    return null;
}
