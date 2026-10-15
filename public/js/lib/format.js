const TZ = 'Africa/Lagos';
const ngn = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function toNumber(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
}
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function formatMoney(amount, currency = 'NGN') {
    return (currency === 'USD' ? usd : ngn).format(toNumber(amount));
}
export function formatNumber(n, digits = 0) {
    return new Intl.NumberFormat('en-NG', { maximumFractionDigits: digits }).format(toNumber(n));
}

function parseDate(v) {
    if (!v) return null;
    const dateOnly = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const d = dateOnly ? new Date(v + 'T00:00:00Z') : new Date(v);
    return Number.isNaN(d.getTime()) ? null : { d, dateOnly };
}
export function formatDate(v) {
    const p = parseDate(v);
    if (!p) return '—';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: p.dateOnly ? 'UTC' : TZ }).format(p.d);
}
export function formatDateTime(v) {
    const p = parseDate(v);
    if (!p) return '—';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(p.d);
}
// Days from today (Lagos) until a yyyy-mm-dd date; negative = already past.
export function daysUntil(dateStr, nowMs = Date.now()) {
    const p = parseDate(dateStr);
    if (!p) return null;
    const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(nowMs)) + 'T00:00:00Z');
    return Math.round((p.d - today) / 86400000);
}
