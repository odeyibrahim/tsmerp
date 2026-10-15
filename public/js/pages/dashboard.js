import { html, badge, registerAction, toast } from '../lib/ui.js';
import { state } from '../lib/state.js';
import { can } from '../lib/permissions.js';
import { LABELS, TONES } from '../lib/lifecycle.js';
import { formatMoney, formatDate, daysUntil } from '../lib/format.js';
import { friendlyError } from '../lib/errors.js';

const count = async (table, build) => {
    let q = state.db.from(table).select('id', { count: 'exact', head: true }).eq('company_id', state.company.id);
    q = build(q);
    const { count: n } = await q;
    return n || 0;
};

export async function render() {
    const office = can.seeOffice(state.role);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [active, awaitingPod, thisMonth, vehicles, drivers, customers, recent, lic] = await Promise.all([
        count('trips', (q) => q.is('deleted_at', null).in('status', ['loaded', 'in_transit'])),
        count('trips', (q) => q.is('deleted_at', null).eq('status', 'delivered')),
        count('trips', (q) => q.is('deleted_at', null).gte('created_at', monthStart.toISOString())),
        count('vehicles', (q) => q.is('deleted_at', null)),
        office ? count('drivers', (q) => q.is('deleted_at', null)) : 0,
        office ? count('customers', (q) => q.is('deleted_at', null)) : 0,
        state.db.from('trips').select('id,booking_no,status,origin_state,destination_state,freight_amount,currency,created_at')
            .eq('company_id', state.company.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(6),
        office ? state.db.from('drivers').select('id,full_name,licence_expiry').eq('company_id', state.company.id).is('deleted_at', null) : { data: [] }
    ]);
    const trips = (recent.data || []);
    const expiring = (lic.data || []).filter((d) => d.licence_expiry && daysUntil(d.licence_expiry) <= 30).sort((a, b) => a.licence_expiry.localeCompare(b.licence_expiry));
    const total = active + awaitingPod + thisMonth + vehicles + drivers + customers;
    const canSeed = ['owner', 'admin'].includes(state.role) && trips.length === 0 && vehicles === 0;
    const co = state.company;
    const trialDays = co.subscription_status === 'trialing' ? daysUntil(co.trial_ends_at.slice(0, 10)) : null;

    return html`
        <div class="page-head"><div><h1>${co.name}</h1><p class="muted">Today's overview</p></div></div>
        ${trialDays !== null ? html`<div class="alert alert-info">Free trial: ${trialDays > 0 ? `${trialDays} day${trialDays === 1 ? '' : 's'} left` : 'ends today'}. Subscription billing arrives in Phase 6.</div>` : ''}
        <div class="stats">
            <div class="stat"><strong>${active}</strong><span>On the road</span></div>
            <div class="stat"><strong>${awaitingPod}</strong><span>Awaiting POD</span></div>
            <div class="stat"><strong>${thisMonth}</strong><span>Bookings this month</span></div>
            <div class="stat"><strong>${vehicles}</strong><span>Vehicles</span></div>
        </div>
        ${office && (vehicles === 0 || drivers === 0 || customers === 0 || trips.length === 0) ? html`
        <section class="card"><h2>Get started</h2>
            <ol class="checklist">
                <li class="${vehicles ? 'done' : ''}"><a href="#/vehicles">Add a vehicle</a></li>
                <li class="${drivers ? 'done' : ''}"><a href="#/drivers">Add a driver</a></li>
                <li class="${customers ? 'done' : ''}"><a href="#/customers">Add a customer</a></li>
                <li class="${trips.length ? 'done' : ''}"><a href="#/trips">Create your first booking and print its waybill</a></li>
            </ol>
            ${canSeed && total === 0 ? html`<p>Just exploring? <button class="btn btn-sm" data-action="dash:demo">Load Nigerian demo data</button></p>` : ''}
        </section>` : ''}
        <div class="cols">
            <section class="card"><h2>Recent trips</h2>
                ${trips.length === 0 ? html`<p class="muted">No trips yet.</p>` : html`<ul class="list">${trips.map((t) => html`<li>
                    <a href="#/trips/${t.id}"><strong>${t.booking_no}</strong></a> ${t.origin_state} → ${t.destination_state}
                    <span class="right">${can.seeOffice(state.role) ? formatMoney(t.freight_amount, t.currency) : ''} ${badge(TONES[t.status], LABELS[t.status])}</span></li>`)}</ul>`}
            </section>
            ${office ? html`<section class="card"><h2>Licences expiring (30 days)</h2>
                ${expiring.length === 0 ? html`<p class="muted">Nothing expiring soon.</p>` : html`<ul class="list">${expiring.map((d) => {
                    const n = daysUntil(d.licence_expiry);
                    return html`<li>${d.full_name}<span class="right">${formatDate(d.licence_expiry)} ${badge(n < 0 ? 'red' : 'amber', n < 0 ? 'Expired' : `${n}d`)}</span></li>`;
                })}</ul>`}
                <p class="hint">Automatic 30/14/7/1-day email &amp; WhatsApp reminders arrive in Phase 3.</p></section>` : ''}
        </div>`;
}

registerAction('dash:demo', async (el) => {
    el.disabled = true;
    const { error } = await state.db.rpc('seed_demo_data', { p_company: state.company.id });
    if (error) { el.disabled = false; return toast(friendlyError(error), 'error'); }
    toast('Demo data loaded');
    state.rerender();
});
