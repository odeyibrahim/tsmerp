import { html, badge, registerAction, registerForm, openModal, closeModal, toast, showFormError, confirmModal } from '../lib/ui.js';
import { fieldGrid, readForm, showErrors } from '../lib/forms.js';
import { validateFields } from '../lib/validate.js';
import { friendlyError } from '../lib/errors.js';
import { state } from '../lib/state.js';
import { can, ROLES, ROLE_LABELS } from '../lib/permissions.js';

let members = [];

export async function render() {
    if (!can.manageTeam(state.role)) return html`<div class="alert alert-error">Only owners and admins can manage the team.</div>`;
    const { data: ms, error } = await state.db.from('company_members').select('id,user_id,role,is_active,created_at').eq('company_id', state.company.id).order('created_at');
    if (error) return html`<div class="alert alert-error">${error.message}</div>`;
    const ids = (ms || []).map((m) => m.user_id);
    const { data: ps } = ids.length ? await state.db.from('profiles').select('id,full_name,email').in('id', ids) : { data: [] };
    const prof = new Map((ps || []).map((p) => [p.id, p]));
    members = (ms || []).map((m) => ({ ...m, profile: prof.get(m.user_id) || {} }));
    const isOwner = state.role === 'owner';

    return html`
        <div class="page-head"><div><h1>Team</h1><p class="muted">Invite staff and drivers. Each person signs in with their own login.</p></div>
            <button class="btn btn-primary" data-action="team:invite">+ Invite someone</button></div>
        <div class="table-wrap"><table><thead><tr><th>Person</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
        ${members.map((m) => {
            const locked = m.role === 'owner' && !isOwner;
            const me = m.user_id === state.user.id;
            return html`<tr><td><strong>${m.profile.full_name || m.profile.email || 'Invited user'}</strong>${me ? ' (you)' : ''}<br><small class="muted">${m.profile.email || ''}</small></td>
            <td><select data-change="team:role" data-id="${m.id}" ${locked || me ? 'disabled' : ''} aria-label="Role">
                ${ROLES.filter((r) => r !== 'owner' || isOwner).map((r) => html`<option value="${r}" ${r === m.role ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`)}</select></td>
            <td>${m.is_active ? badge('green', 'Active') : badge('gray', 'Deactivated')}</td>
            <td class="row-actions">${locked || me ? '' : html`<button class="btn btn-sm btn-ghost" data-action="team:toggle" data-id="${m.id}">${m.is_active ? 'Deactivate' : 'Reactivate'}</button>`}</td></tr>`;
        })}</tbody></table></div>`;
}

async function inviteForm() {
    const { data: drivers } = await state.db.from('drivers').select('id,full_name,user_id').eq('company_id', state.company.id).is('deleted_at', null);
    const free = (drivers || []).filter((d) => !d.user_id).map((d) => [d.id, d.full_name]);
    const fields = [
        { name: 'email', label: 'Email', type: 'email', required: true, full: true },
        { name: 'full_name', label: 'Full name', type: 'text', max: 120 },
        { name: 'role', label: 'Role', type: 'select', required: true, options: ROLES.filter((r) => r !== 'owner').map((r) => [r, ROLE_LABELS[r]]), default: 'dispatcher' },
        { name: 'driver_id', label: 'Link to driver profile', type: 'lookup', options: free, blank: '— not a driver —', help: 'For the Driver role: which driver record is this login?' }
    ];
    return { fields, node: html`<form data-form="invite" novalidate>${fieldGrid(fields, {})}
        <p class="alert alert-error" data-form-error hidden></p>
        <div class="form-actions"><button type="button" class="btn" data-action="modal-close">Cancel</button><button type="submit" class="btn btn-primary">Send invite</button></div></form>` };
}

registerAction('team:invite', async () => { const f = await inviteForm(); openModal('Invite someone', f.node); });
registerForm('invite', async (form) => {
    const f = await inviteForm();
    const v = validateFields(f.fields, readForm(form), [(d) => (d.role === 'driver' && !d.driver_id ? { field: 'driver_id', message: 'Choose the driver record for this login' } : null)]);
    if (!v.ok) return showErrors(form, v.errors);
    const session = await state.db.auth.getSession();
    let res;
    try {
        res = await fetch('/.netlify/functions/invite-member', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ company_id: state.company.id, ...v.data })
        });
    } catch { return showFormError(form, 'Network error. Please try again.'); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return showFormError(form, out.error || 'Could not send the invite.');
    closeModal(); toast(out.message || 'Invite sent'); state.rerender();
});
registerAction('team:role', async (el) => {
    const { error } = await state.db.from('company_members').update({ role: el.value }).eq('id', el.dataset.id);
    if (error) toast(friendlyError(error), 'error'); else toast('Role updated');
    state.rerender();
});
registerAction('team:toggle', async (el) => {
    const m = members.find((x) => x.id === el.dataset.id);
    if (!m) return;
    if (m.is_active && !(await confirmModal({ title: 'Deactivate this person?', message: 'They will lose access immediately. Their history is kept.', confirmLabel: 'Deactivate', danger: true }))) return;
    const { error } = await state.db.from('company_members').update({ is_active: !m.is_active }).eq('id', m.id);
    if (error) toast(friendlyError(error), 'error'); else toast('Updated');
    state.rerender();
});
