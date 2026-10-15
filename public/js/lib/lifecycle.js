// Mirrors trip_transition_allowed() in supabase/migrations/002_fleet_haulage.sql.
// The database is the authority; this only decides which buttons to show.
export const STATUSES = ['booked', 'loaded', 'in_transit', 'delivered', 'pod_received', 'invoiced', 'paid', 'cancelled'];
export const LABELS = {
    booked: 'Booked', loaded: 'Loaded', in_transit: 'In transit', delivered: 'Delivered',
    pod_received: 'POD received', invoiced: 'Invoiced', paid: 'Paid', cancelled: 'Cancelled'
};
export const TONES = {
    booked: 'gray', loaded: 'blue', in_transit: 'amber', delivered: 'teal',
    pod_received: 'green', invoiced: 'violet', paid: 'green', cancelled: 'red'
};
const ORDER = ['booked', 'loaded', 'in_transit', 'delivered', 'pod_received', 'invoiced', 'paid'];
const rank = (s) => ORDER.indexOf(s);

export function transitionAllowed(from, to) {
    if (from === to) return false;
    if (to === 'cancelled') return ['booked', 'loaded', 'in_transit', 'delivered', 'pod_received'].includes(from);
    if (from === 'cancelled') return to === 'booked';
    const f = rank(from), t = rank(to);
    if (f < 0 || t < 0) return false;
    if (t === f + 1) return true;
    if (t === f - 1) return ['loaded', 'in_transit', 'delivered', 'pod_received'].includes(from);
    return false;
}
// Phase 1 UI moves trips up to POD received; invoiced/paid belong to the billing module (Phase 2).
export function nextStatus(s) {
    const i = rank(s);
    return i >= 0 && i < rank('pod_received') ? ORDER[i + 1] : null;
}
export function prevStatus(s) {
    return ['loaded', 'in_transit', 'delivered', 'pod_received'].includes(s) ? ORDER[rank(s) - 1] : null;
}
export const canCancel = (s) => transitionAllowed(s, 'cancelled');
export const canReopen = (s) => s === 'cancelled';
