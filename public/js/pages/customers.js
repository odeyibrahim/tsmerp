import { html, badge } from '../lib/ui.js';
import { entityPage } from '../lib/entity.js';
import { STATES, formatPhone } from '../lib/nigeria.js';
import { can } from '../lib/permissions.js';

const fields = () => [
    { name: 'name', label: 'Customer name', type: 'text', required: true, max: 200, full: true },
    { name: 'customer_type', label: 'Type', type: 'select', required: true, options: [['business', 'Business'], ['corporate', 'Corporate'], ['individual', 'Individual']], default: 'business' },
    { name: 'contact_person', label: 'Contact person', type: 'text', max: 120 },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'state', label: 'State', type: 'select', options: STATES },
    { name: 'credit_terms_days', label: 'Credit terms (days)', type: 'number', integer: true, min: 0, max: 365, default: 0, help: '0 = pay on delivery.' },
    { name: 'address', label: 'Address', type: 'text', max: 300, full: true },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true }
];

export default entityPage({
    key: 'customers', table: 'customers', singular: 'customer', plural: 'Customers',
    subtitle: 'Shippers you haul for. Statements and ledgers arrive with invoicing (Phase 2).',
    emptyHint: 'Add a customer before booking your first trip.',
    canWrite: can.customerWrite,
    fields,
    nameOf: (r) => r.name,
    searchOf: (r) => [r.name, r.contact_person, r.phone, r.email, r.state].filter(Boolean).join(' '),
    columns: [
        { label: 'Customer', cell: (r) => html`<strong>${r.name}</strong>` },
        { label: 'Type', cell: (r) => badge('gray', r.customer_type) },
        { label: 'Contact', cell: (r) => html`${r.contact_person || '—'}<br><small class="muted">${formatPhone(r.phone)}</small>` },
        { label: 'State', cell: (r) => r.state || '—' },
        { label: 'Credit', cell: (r) => (r.credit_terms_days ? `${r.credit_terms_days} days` : 'On delivery') }
    ]
});
