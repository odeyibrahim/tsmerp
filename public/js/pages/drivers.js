import { html, badge } from '../lib/ui.js';
import { entityPage } from '../lib/entity.js';
import { formatDate, daysUntil } from '../lib/format.js';
import { formatPhone } from '../lib/nigeria.js';
import { can } from '../lib/permissions.js';

const fields = () => [
    { name: 'full_name', label: 'Full name', type: 'text', required: true, max: 120 },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'licence_number', label: 'Licence number', type: 'text', max: 40 },
    { name: 'licence_expiry', label: 'Licence expiry', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: [['active', 'Active'], ['suspended', 'Suspended'], ['inactive', 'Inactive']], default: 'active' },
    { name: 'address', label: 'Address', type: 'text', max: 300, full: true },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true }
];
function expiry(r) {
    if (!r.licence_expiry) return '—';
    const d = daysUntil(r.licence_expiry);
    const tone = d < 0 ? 'red' : d <= 30 ? 'amber' : 'green';
    return html`${formatDate(r.licence_expiry)} ${badge(tone, d < 0 ? 'Expired' : d <= 30 ? `${d}d left` : 'Valid')}`;
}

export default entityPage({
    key: 'drivers', table: 'drivers', singular: 'driver', plural: 'Drivers',
    subtitle: 'Driver profiles and licence expiry. Salary and advances arrive in Phase 3.',
    emptyHint: 'Add your drivers so you can assign them to trips.',
    canWrite: can.fleetWrite,
    fields,
    nameOf: (r) => r.full_name,
    searchOf: (r) => [r.full_name, r.phone, r.licence_number].filter(Boolean).join(' '),
    columns: [
        { label: 'Name', cell: (r) => html`<strong>${r.full_name}</strong>` },
        { label: 'Phone', cell: (r) => formatPhone(r.phone) },
        { label: 'Licence', cell: (r) => r.licence_number || '—' },
        { label: 'Expiry', cell: expiry },
        { label: 'Status', cell: (r) => badge(r.status === 'active' ? 'green' : r.status === 'suspended' ? 'red' : 'gray', r.status) }
    ]
});
