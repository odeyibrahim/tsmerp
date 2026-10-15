// Generic list + create/edit/archive page for simple company-scoped tables (vehicles, drivers, customers).
// Field definitions drive both rendering and validation; RLS decides who may actually write.
import { html, raw, registerAction, registerForm, openModal, closeModal, confirmModal, toast, emptyState, showFormError } from './ui.js';
import { fieldGrid, readForm, showErrors } from './forms.js';
import { validateFields } from './validate.js';
import { friendlyError } from './errors.js';
import { state } from './state.js';

export function entityPage(cfg) {
    let rows = [];
    const k = cfg.key;

    async function render() {
        const { data, error } = await state.db.from(cfg.table).select('*')
            .eq('company_id', state.company.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(500);
        if (error) return html`<div class="alert alert-error">Could not load ${cfg.plural}: ${error.message}</div>`;
        rows = data || [];
        const write = cfg.canWrite(state.role);
        return html`
            <div class="page-head">
                <div><h1>${cfg.plural}</h1><p class="muted">${cfg.subtitle || ''}</p></div>
                ${write ? html`<button class="btn btn-primary" data-action="${k}:new">+ Add ${cfg.singular}</button>` : ''}
            </div>
            ${rows.length === 0
                ? emptyState(`No ${cfg.plural.toLowerCase()} yet`, cfg.emptyHint || '', write ? html`<button class="btn btn-primary" data-action="${k}:new">Add your first ${cfg.singular}</button>` : '')
                : html`
                <input class="search" type="search" placeholder="Search ${cfg.plural.toLowerCase()}…" data-filter="tbl-${k}" aria-label="Search ${cfg.plural}">
                <div class="table-wrap"><table id="tbl-${k}">
                    <thead><tr>${cfg.columns.map((c) => html`<th>${c.label}</th>`)}${write ? html`<th></th>` : ''}</tr></thead>
                    <tbody>${rows.map((r) => html`<tr data-search="${cfg.searchOf(r).toLowerCase()}">
                        ${cfg.columns.map((c) => html`<td>${c.cell(r)}</td>`)}
                        ${write ? html`<td class="row-actions">
                            <button class="btn btn-sm" data-action="${k}:edit" data-id="${r.id}">Edit</button>
                            <button class="btn btn-sm btn-ghost" data-action="${k}:archive" data-id="${r.id}">Archive</button></td>` : ''}
                    </tr>`)}</tbody>
                </table></div>`}`;
    }

    function formHtml(row) {
        return html`<form data-form="${k}" data-id="${row ? row.id : ''}" novalidate>
            ${fieldGrid(cfg.fields(), row || {})}
            <p class="alert alert-error" data-form-error hidden></p>
            <div class="form-actions"><button type="button" class="btn" data-action="modal-close">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>
        </form>`;
    }

    registerAction(`${k}:new`, () => openModal(`Add ${cfg.singular}`, formHtml(null)));
    registerAction(`${k}:edit`, (el) => {
        const row = rows.find((r) => r.id === el.dataset.id);
        if (row) openModal(`Edit ${cfg.singular}`, formHtml(row));
    });
    registerAction(`${k}:archive`, async (el) => {
        const row = rows.find((r) => r.id === el.dataset.id);
        if (!row) return;
        const ok = await confirmModal({ title: `Archive ${cfg.singular}?`, message: `"${cfg.nameOf(row)}" will be hidden from lists. Existing trips and history are kept.`, confirmLabel: 'Archive', danger: true });
        if (!ok) return;
        const { error } = await state.db.from(cfg.table).update({ deleted_at: new Date().toISOString() }).eq('id', row.id);
        if (error) return toast(friendlyError(error), 'error');
        toast(`${cfg.singular} archived`);
        state.rerender();
    });
    registerForm(k, async (form) => {
        const id = form.dataset.id || null;
        const v = validateFields(cfg.fields(), readForm(form), cfg.rules || []);
        if (!v.ok) return showErrors(form, v.errors);
        showErrors(form, {});
        const q = id
            ? state.db.from(cfg.table).update(v.data).eq('id', id)                       // company_id is never writable on update
            : state.db.from(cfg.table).insert({ ...v.data, company_id: state.company.id });
        const { error } = await q;
        if (error) return showFormError(form, friendlyError(error));
        closeModal();
        toast(`${cfg.singular} saved`);
        state.rerender();
    });

    return { render };
}
