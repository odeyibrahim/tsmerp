import { html, badge } from '../lib/ui.js';
import { entityPage } from '../lib/entity.js';
import { STATES } from '../lib/nigeria.js';
import { formatNumber } from '../lib/format.js';
import { can } from '../lib/permissions.js';

const TYPES = [['truck', 'Truck'], ['trailer', 'Trailer'], ['tanker', 'Tanker'], ['van', 'Van'], ['bus', 'Bus'], ['motorcycle', 'Motorcycle']];
const fields = () => [
    { name: 'plate_number', label: 'Plate number', type: 'text', required: true, max: 20, placeholder: 'LSR-412AA' },
    { name: 'vehicle_type', label: 'Type', type: 'select', required: true, options: TYPES, default: 'truck' },
    { name: 'make', label: 'Make', type: 'text', max: 60 },
    { name: 'model', label: 'Model', type: 'text', max: 60 },
    { name: 'year', label: 'Year', type: 'number', integer: true, min: 1950, max: new Date().getFullYear() + 1 },
    { name: 'tonnage', label: 'Capacity (tonnes)', type: 'number', min: 0, max: 500 },
    { name: 'seat_capacity', label: 'Seats (buses)', type: 'number', integer: true, min: 0, max: 100 },
    { name: 'state_registered', label: 'State registered', type: 'select', options: STATES },
    { name: 'chassis_number', label: 'Chassis number', type: 'text', max: 40 },
    { name: 'odometer_km', label: 'Odometer (km)', type: 'number', integer: true, min: 0, max: 5000000 },
    { name: 'ownership', label: 'Ownership', type: 'select', required: true, options: [['own', 'Own fleet'], ['attached', 'Attached (owner-operator)']], default: 'own', help: 'Attached = a truck owned by someone else that works under your company.' },
    { name: 'owner_name', label: 'Owner name (attached)', type: 'text', max: 120 },
    { name: 'owner_phone', label: 'Owner phone (attached)', type: 'tel' },
    { name: 'default_commission_pct', label: 'Default commission %', type: 'number', min: 0, max: 100, help: 'Your cut on trips carried by an attached vehicle.' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: [['active', 'Active'], ['maintenance', 'In maintenance'], ['inactive', 'Inactive']], default: 'active' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true }
];

export default entityPage({
    key: 'vehicles', table: 'vehicles', singular: 'vehicle', plural: 'Vehicles',
    subtitle: 'Your own trucks and attached owner-operator vehicles.',
    emptyHint: 'Add the trucks you dispatch so you can assign them to trips.',
    canWrite: can.fleetWrite,
    fields,
    rules: [(d) => (d.ownership === 'attached' && !d.owner_name ? { field: 'owner_name', message: 'Owner name is required for attached vehicles' } : null)],
    nameOf: (r) => r.plate_number,
    searchOf: (r) => [r.plate_number, r.make, r.model, r.owner_name, r.vehicle_type, r.state_registered].filter(Boolean).join(' '),
    columns: [
        { label: 'Plate', cell: (r) => html`<strong>${r.plate_number}</strong>` },
        { label: 'Vehicle', cell: (r) => [r.make, r.model, r.year].filter(Boolean).join(' ') || '—' },
        { label: 'Type', cell: (r) => r.vehicle_type },
        { label: 'Capacity', cell: (r) => (r.tonnage != null ? `${formatNumber(r.tonnage, 1)} t` : '—') },
        { label: 'Ownership', cell: (r) => (r.ownership === 'attached' ? html`${badge('violet', 'Attached')} <small class="muted">${r.owner_name}</small>` : badge('gray', 'Own')) },
        { label: 'Status', cell: (r) => badge(r.status === 'active' ? 'green' : r.status === 'maintenance' ? 'amber' : 'gray', r.status) }
    ]
});
