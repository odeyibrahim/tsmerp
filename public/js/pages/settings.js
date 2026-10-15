import { html, registerForm, toast, showFormError } from '../lib/ui.js';
import { fieldGrid, readForm, showErrors } from '../lib/forms.js';
import { validateFields } from '../lib/validate.js';
import { friendlyError } from '../lib/errors.js';
import { state } from '../lib/state.js';
import { can } from '../lib/permissions.js';
import { STATES } from '../lib/nigeria.js';

export const companyFields = () => [
    { name: 'name', label: 'Company name', type: 'text', required: true, max: 120, full: true },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'state', label: 'State', type: 'select', options: STATES },
    { name: 'rc_number', label: 'RC number (CAC)', type: 'text', max: 30 },
    { name: 'tin', label: 'Tax ID (TIN)', type: 'text', max: 30 },
    { name: 'address', label: 'Address', type: 'text', max: 300, full: true }
];

export async function render() {
    const edit = can.editCompany(state.role);
    return html`<div class="page-head"><div><h1>Company settings</h1><p class="muted">Appears on your waybills and, later, invoices.</p></div></div>
        <section class="card narrow"><form data-form="company" novalidate>
            ${fieldGrid(companyFields(), state.company)}
            <p class="alert alert-error" data-form-error hidden></p>
            ${edit ? html`<div class="form-actions"><button type="submit" class="btn btn-primary">Save</button></div>` : html`<p class="hint">Only owners and admins can edit these.</p>`}
        </form></section>
        <section class="card narrow"><h2>Plan</h2><p>${state.company.plan} · ${state.company.subscription_status}</p></section>`;
}
registerForm('company', async (form) => {
    if (!can.editCompany(state.role)) return showFormError(form, "You don't have permission to edit this.");
    const v = validateFields(companyFields(), readForm(form));
    if (!v.ok) return showErrors(form, v.errors);
    showErrors(form, {});
    const { data, error } = await state.db.from('companies').update(v.data).eq('id', state.company.id).select('*').single();
    if (error) return showFormError(form, friendlyError(error));
    Object.assign(state.company, data);
    toast('Settings saved');
    state.rerender();
});
