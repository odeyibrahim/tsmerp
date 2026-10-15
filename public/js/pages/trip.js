import { html, badge, registerAction, registerForm, openModal, closeModal, toast, showFormError } from '../lib/ui.js';
import { readForm } from '../lib/forms.js';
import { friendlyError } from '../lib/errors.js';
import { state } from '../lib/state.js';
import { can } from '../lib/permissions.js';
import { LABELS, TONES, nextStatus, prevStatus, canCancel, canReopen } from '../lib/lifecycle.js';
import { formatMoney, formatDate, formatDateTime, toNumber, round2 } from '../lib/format.js';
import { formatPhone } from '../lib/nigeria.js';
import { openTripForm } from './trips.js';

let current = null;

const one = async (table, id, cols) => {
    if (!id) return null;
    const { data } = await state.db.from(table).select(cols).eq('id', id).maybeSingle();   // RLS may hide it (e.g. drivers can't read customers) -> null
    return data || null;
};

export async function loadTrip(id) {
    const { data: trip, error } = await state.db.from('trips').select('*').eq('id', id).maybeSingle();
    if (error || !trip) return { error: error ? error.message : 'Trip not found' };
    const [customer, vehicle, driver, hist] = await Promise.all([
        one('customers', trip.customer_id, 'id,name,phone,address'),
        one('vehicles', trip.vehicle_id, 'id,plate_number,vehicle_type,make,model,ownership,owner_name'),
        one('drivers', trip.driver_id, 'id,full_name,phone'),
        state.db.from('trip_status_history').select('*').eq('trip_id', id).order('changed_at', { ascending: true })
    ]);
    const history = hist.data || [];
    const ids = [...new Set(history.map((h) => h.changed_by).filter(Boolean))];
    const names = {};
    if (ids.length) {
        const { data: ps } = await state.db.from('profiles').select('id,full_name,email').in('id', ids);
        (ps || []).forEach((p) => { names[p.id] = p.full_name || p.email; });
    }
    return { trip, customer, vehicle, driver, history, names };
}

const row = (label, value) => html`<div class="kv"><dt>${label}</dt><dd>${value || '—'}</dd></div>`;

export async function render({ id }) {
    const d = await loadTrip(id);
    if (d.error) return html`<div class="alert alert-error">${d.error}</div><p><a href="#/trips">← Back to trips</a></p>`;
    current = d;
    const { trip: t, customer, vehicle, driver, history, names } = d;
    const isDriver = state.role === 'driver';
    const write = can.tripWrite(state.role);
    let next = nextStatus(t.status);
    if (isDriver && next === 'pod_received') next = null;           // drivers can't confirm POD
    const prev = write ? prevStatus(t.status) : null;
    const balance = round2(toNumber(t.freight_amount) - toNumber(t.advance_paid));
    const net = round2(toNumber(t.freight_amount) - toNumber(t.broker_commission_amount));

    return html`
        <p><a href="#/trips">← All trips</a></p>
        <div class="page-head">
            <div><h1>${t.booking_no} ${badge(TONES[t.status], LABELS[t.status])}</h1>
                <p class="muted">Waybill ${t.waybill_no} · ${t.origin_state} → ${t.destination_state}</p></div>
            <div class="head-actions">
                <a class="btn" href="#/trips/${t.id}/waybill">Waybill</a>
                ${write && !['invoiced', 'paid'].includes(t.status) ? html`<button class="btn" data-action="trip:edit">Edit</button>` : ''}
            </div>
        </div>

        ${(next || prev || (write && canCancel(t.status)) || (write && canReopen(t.status))) ? html`
        <div class="card action-bar">
            ${next ? html`<button class="btn btn-primary" data-action="trip:status" data-to="${next}">Mark as ${LABELS[next]}</button>` : ''}
            ${prev ? html`<button class="btn" data-action="trip:status" data-to="${prev}">Step back to ${LABELS[prev]}</button>` : ''}
            ${write && canCancel(t.status) ? html`<button class="btn btn-danger" data-action="trip:status" data-to="cancelled">Cancel trip</button>` : ''}
            ${write && canReopen(t.status) ? html`<button class="btn" data-action="trip:status" data-to="booked">Re-open as Booked</button>` : ''}
        </div>` : ''}
        ${t.status === 'pod_received' && write ? html`<p class="hint">Invoicing arrives in Phase 2 — this trip is ready to be billed.</p>` : ''}

        <div class="cols">
            <section class="card"><h2>Trip</h2><dl>
                ${row('Customer', customer && customer.name)}
                ${row('Cargo', t.cargo_description)}
                ${row('Weight', t.cargo_weight_tonnes != null ? `${t.cargo_weight_tonnes} t` : '')}
                ${row('Pickup', `${t.origin_state}${t.origin_address ? ' — ' + t.origin_address : ''}`)}
                ${row('Delivery', `${t.destination_state}${t.destination_address ? ' — ' + t.destination_address : ''}`)}
                ${row('Pickup date', formatDate(t.pickup_date))}
                ${row('Expected delivery', formatDate(t.expected_delivery_date))}
                ${row('Consignee', [t.consignee_name, t.consignee_phone && formatPhone(t.consignee_phone)].filter(Boolean).join(' · '))}
            </dl></section>
            <section class="card"><h2>Assignment</h2><dl>
                ${row('Vehicle', vehicle && html`${vehicle.plate_number} <small class="muted">${[vehicle.make, vehicle.model].filter(Boolean).join(' ')}</small> ${vehicle.ownership === 'attached' ? badge('violet', 'Attached') : ''}`)}
                ${row('Driver', driver && html`${driver.full_name} <small class="muted">${formatPhone(driver.phone)}</small>`)}
                ${t.broker_name ? row('Broker / owner', t.broker_name) : ''}
            </dl>
            ${isDriver ? '' : html`<h2 class="mt">Money</h2><dl>
                ${row('Freight', formatMoney(t.freight_amount, t.currency))}
                ${row('Advance received', formatMoney(t.advance_paid, t.currency))}
                ${row('Balance due', html`<strong>${formatMoney(balance, t.currency)}</strong>`)}
                ${toNumber(t.broker_commission_amount) > 0 ? row('Commission payable', formatMoney(t.broker_commission_amount, t.currency)) : ''}
                ${toNumber(t.broker_commission_amount) > 0 ? row('Net of commission', formatMoney(net, t.currency)) : ''}
            </dl><p class="hint">Fuel, allowances and other trip costs — with live profit/loss — arrive in Phase 2.</p>`}
            </section>
        </div>

        ${t.notes ? html`<section class="card"><h2>Notes</h2><p class="pre">${t.notes}</p></section>` : ''}

        <section class="card"><h2>History</h2>
            <ol class="timeline">${history.map((h) => html`<li>
                <strong>${LABELS[h.to_status]}</strong> <small class="muted">${formatDateTime(h.changed_at)}${h.changed_by && names[h.changed_by] ? ' · ' + names[h.changed_by] : ''}</small>
                ${h.note ? html`<div class="note">${h.note}</div>` : ''}</li>`)}</ol>
        </section>`;
}

registerAction('trip:edit', () => { if (current) openTripForm(current.trip); });
registerAction('trip:status', (el) => {
    if (!current) return;
    const to = el.dataset.to;
    const risky = to === 'cancelled';
    openModal(`${LABELS[to]}?`, html`<form data-form="trip-status" data-to="${to}" novalidate>
        <p>${current.trip.booking_no}: <strong>${LABELS[current.trip.status]}</strong> → <strong>${LABELS[to]}</strong></p>
        <label class="field full"><span class="lbl">Note (optional)</span><textarea name="note" rows="2" maxlength="300" placeholder="e.g. Loaded at Apapa depot, seal no. 12345"></textarea></label>
        <p class="alert alert-error" data-form-error hidden></p>
        <div class="form-actions"><button type="button" class="btn" data-action="modal-close">Cancel</button>
        <button type="submit" class="btn ${risky ? 'btn-danger' : 'btn-primary'}">Confirm</button></div></form>`);
});
registerForm('trip-status', async (form) => {
    const { note } = readForm(form);
    const { error } = await state.db.rpc('advance_trip_status', { p_trip_id: current.trip.id, p_to: form.dataset.to, p_note: (note || '').trim() || null });
    if (error) return showFormError(form, friendlyError(error));
    closeModal(); toast('Status updated'); state.rerender();
});
