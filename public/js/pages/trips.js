import { html, badge, emptyState, registerAction, registerForm, openModal, closeModal, toast, showFormError } from '../lib/ui.js';
import { fieldGrid, readForm, showErrors } from '../lib/forms.js';
import { validateFields } from '../lib/validate.js';
import { friendlyError } from '../lib/errors.js';
import { state } from '../lib/state.js';
import { can } from '../lib/permissions.js';
import { STATUSES, LABELS, TONES } from '../lib/lifecycle.js';
import { STATES, CORRIDORS } from '../lib/nigeria.js';
import { formatMoney, formatDate } from '../lib/format.js';

let statusFilter = 'all';

// Customers / vehicles / drivers for dropdowns and for naming rows. Office roles only for customers (RLS).
export async function loadLookups() {
    const co = state.company.id;
    const q = (t, cols) => state.db.from(t).select(cols).eq('company_id', co).is('deleted_at', null).order('created_at', { ascending: false }).limit(1000);
    const [c, v, d] = await Promise.all([
        can.seeOffice(state.role) ? q('customers', 'id,name') : { data: [] },
        q('vehicles', 'id,plate_number,ownership,owner_name,status,vehicle_type,default_commission_pct'),
        can.seeOffice(state.role) ? q('drivers', 'id,full_name,status') : { data: [] }
    ]);
    return { customers: c.data || [], vehicles: v.data || [], drivers: d.data || [] };
}
const byId = (arr) => new Map(arr.map((x) => [x.id, x]));

// Keep a trip's current vehicle/driver selectable even if archived/inactive, so editing never silently un-assigns them.
function withCurrent(options, currentId) {
    if (currentId && !options.some(([id]) => id === currentId)) return [...options, [currentId, '(inactive / archived)']];
    return options;
}

export function tripFields(lk, trip) {
    return [
        { name: 'customer_id', label: 'Customer', type: 'lookup', required: true, options: lk.customers.map((c) => [c.id, c.name]), full: true },
        { name: 'origin_state', label: 'Origin state', type: 'select', required: true, options: STATES },
        { name: 'origin_address', label: 'Pickup address / depot', type: 'text', max: 300 },
        { name: 'destination_state', label: 'Destination state', type: 'select', required: true, options: STATES },
        { name: 'destination_address', label: 'Delivery address', type: 'text', max: 300 },
        { name: 'cargo_description', label: 'Cargo', type: 'text', max: 300, full: true },
        { name: 'cargo_weight_tonnes', label: 'Weight (tonnes)', type: 'number', min: 0, max: 500 },
        { name: 'pickup_date', label: 'Pickup date', type: 'date' },
        { name: 'expected_delivery_date', label: 'Expected delivery', type: 'date' },
        { name: 'vehicle_id', label: 'Vehicle', type: 'lookup', options: withCurrent(lk.vehicles.filter((v) => v.status === 'active').map((v) => [v.id, `${v.plate_number}${v.ownership === 'attached' ? ' (attached)' : ''}`]), trip && trip.vehicle_id), blank: '— assign later —' },
        { name: 'driver_id', label: 'Driver', type: 'lookup', options: withCurrent(lk.drivers.filter((d) => d.status === 'active').map((d) => [d.id, d.full_name]), trip && trip.driver_id), blank: '— assign later —' },
        { name: 'consignee_name', label: 'Consignee (receiver)', type: 'text', max: 200 },
        { name: 'consignee_phone', label: 'Consignee phone', type: 'tel' },
        { name: 'currency', label: 'Currency', type: 'select', required: true, options: [['NGN', '₦ Naira'], ['USD', '$ US Dollar']], default: 'NGN' },
        { name: 'freight_amount', label: 'Freight amount', type: 'money', required: true },
        { name: 'advance_paid', label: 'Advance received', type: 'money' },
        { name: 'broker_name', label: 'Broker / attached owner', type: 'text', max: 120, help: 'Only if a broker or attached-vehicle owner takes a cut.' },
        { name: 'broker_commission_amount', label: 'Commission payable', type: 'money' },
        { name: 'notes', label: 'Notes', type: 'textarea', full: true }
    ];
}
export const tripRules = [
    (d) => (d.advance_paid > d.freight_amount ? { field: 'advance_paid', message: 'Advance cannot exceed the freight amount' } : null),
    (d) => (d.broker_commission_amount > d.freight_amount ? { field: 'broker_commission_amount', message: 'Commission cannot exceed the freight amount' } : null),
    (d) => (d.pickup_date && d.expected_delivery_date && d.expected_delivery_date < d.pickup_date ? { field: 'expected_delivery_date', message: 'Delivery cannot be before pickup' } : null)
];

export function tripFormHtml(lk, trip) {
    return html`<form data-form="trip" data-id="${trip ? trip.id : ''}" novalidate>
        ${trip ? '' : html`<label class="field full"><span class="lbl">Quick route</span>
            <select data-change="trip:corridor" aria-label="Quick route"><option value="">— choose a common corridor —</option>
            ${CORRIDORS.map((c, i) => html`<option value="${i}">${c.label}</option>`)}</select></label>`}
        ${fieldGrid(tripFields(lk, trip), trip || { currency: 'NGN' })}
        <p class="alert alert-error" data-form-error hidden></p>
        <div class="form-actions"><button type="button" class="btn" data-action="modal-close">Cancel</button><button type="submit" class="btn btn-primary">${trip ? 'Save changes' : 'Create booking'}</button></div>
    </form>`;
}

export async function openTripForm(trip) {
    const lk = await loadLookups();
    if (!trip && lk.customers.length === 0) {
        return openModal('Add a customer first', html`<p>Every booking needs a customer. <a href="#/customers">Add one now</a>.</p>`);
    }
    openModal(trip ? `Edit ${trip.booking_no}` : 'New booking', tripFormHtml(lk, trip));
}

export async function render() {
    const [{ data: trips, error }, lk] = await Promise.all([
        state.db.from('trips').select('id,booking_no,waybill_no,status,origin_state,destination_state,freight_amount,currency,pickup_date,customer_id,vehicle_id,driver_id,created_at')
            .eq('company_id', state.company.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
        loadLookups()
    ]);
    if (error) return html`<div class="alert alert-error">Could not load trips: ${error.message}</div>`;
    const cust = byId(lk.customers), veh = byId(lk.vehicles), drv = byId(lk.drivers);
    const shown = (trips || []).filter((t) => statusFilter === 'all' || t.status === statusFilter);
    const write = can.tripWrite(state.role);
    const counts = {};
    (trips || []).forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });

    return html`
        <div class="page-head">
            <div><h1>${can.seeOffice(state.role) ? 'Trips' : 'My trips'}</h1><p class="muted">Bookings, waybills and trip status.</p></div>
            ${write ? html`<button class="btn btn-primary" data-action="trips:new">+ New booking</button>` : ''}
        </div>
        <div class="chips" role="tablist" aria-label="Filter by status">
            ${['all', ...STATUSES].map((s) => html`<button class="chip ${statusFilter === s ? 'active' : ''}" data-action="trips:filter" data-status="${s}">${s === 'all' ? 'All' : LABELS[s]}${s === 'all' ? html` <span>${(trips || []).length}</span>` : counts[s] ? html` <span>${counts[s]}</span>` : ''}</button>`)}
        </div>
        ${(trips || []).length === 0
            ? emptyState('No trips yet', write ? 'Create your first booking to generate a waybill.' : 'Trips assigned to you will appear here.', write ? html`<button class="btn btn-primary" data-action="trips:new">New booking</button>` : '')
            : html`
            <input class="search" type="search" placeholder="Search booking no., waybill, customer, plate…" data-filter="tbl-trips" aria-label="Search trips">
            <div class="table-wrap"><table id="tbl-trips">
                <thead><tr><th>Booking</th><th>Customer</th><th>Route</th><th>Vehicle / driver</th><th class="num">Freight</th><th>Status</th></tr></thead>
                <tbody>${shown.map((t) => {
                    const c = cust.get(t.customer_id), v = veh.get(t.vehicle_id), d = drv.get(t.driver_id);
                    const search = [t.booking_no, t.waybill_no, c && c.name, v && v.plate_number, d && d.full_name, t.origin_state, t.destination_state].filter(Boolean).join(' ').toLowerCase();
                    return html`<tr data-search="${search}">
                        <td><a href="#/trips/${t.id}"><strong>${t.booking_no}</strong></a><br><small class="muted">${t.waybill_no} · ${formatDate(t.pickup_date)}</small></td>
                        <td>${c ? c.name : '—'}</td>
                        <td>${t.origin_state} → ${t.destination_state}</td>
                        <td>${v ? v.plate_number : html`<span class="muted">Unassigned</span>`}<br><small class="muted">${d ? d.full_name : ''}</small></td>
                        <td class="num">${formatMoney(t.freight_amount, t.currency)}</td>
                        <td>${badge(TONES[t.status], LABELS[t.status])}</td></tr>`;
                })}</tbody>
            </table></div>`}`;
}

// ---------- actions ----------
registerAction('trips:new', () => openTripForm(null));
registerAction('trips:filter', (el) => { statusFilter = el.dataset.status; state.rerender(); });
registerAction('trip:corridor', (el) => {          // registered via data-change
    const c = CORRIDORS[Number(el.value)];
    const form = el.closest('form');
    if (!c || !form) return;
    form.elements.origin_state.value = c.from;
    form.elements.destination_state.value = c.to;
    if (c.fromAddr && !form.elements.origin_address.value) form.elements.origin_address.value = c.fromAddr;
});

registerForm('trip', async (form) => {
    const lk = await loadLookups();
    const id = form.dataset.id || null;
    const v = validateFields(tripFields(lk), readForm(form), tripRules);
    if (!v.ok) return showErrors(form, v.errors);
    showErrors(form, {});
    if (id) {
        const { error } = await state.db.from('trips').update(v.data).eq('id', id);
        if (error) return showFormError(form, friendlyError(error));
        closeModal(); toast('Trip updated'); state.rerender();
    } else {
        const { data, error } = await state.db.from('trips').insert({ ...v.data, company_id: state.company.id }).select('id,booking_no,waybill_no').single();
        if (error) return showFormError(form, friendlyError(error));
        closeModal(); toast(`Booked ${data.booking_no} · waybill ${data.waybill_no}`);
        state.navigate(`/trips/${data.id}`);
    }
});
