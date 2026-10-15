import { html } from './ui.js';

// Renders one input from the same field definition validate.js uses to check it.
export function field(f, value) {
    const v = value === undefined || value === null ? (f.default !== undefined ? f.default : '') : value;
    const id = 'f_' + f.name;
    let control;
    const common = { id, name: f.name };
    switch (f.type) {
        case 'textarea':
            control = html`<textarea id="${common.id}" name="${common.name}" rows="${f.rows || 3}" maxlength="${f.max || 1000}">${v}</textarea>`;
            break;
        case 'select':
        case 'lookup': {
            const opts = (f.options || []).map((o) => (Array.isArray(o) ? o : [o, o]));
            control = html`<select id="${id}" name="${f.name}">
                ${f.required && String(v) !== '' ? '' : html`<option value="">${f.required ? 'Choose…' : (f.blank || '— none —')}</option>`}
                ${opts.map(([val, label]) => html`<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${label}</option>`)}
            </select>`;
            break;
        }
        case 'number':
        case 'money':
            control = html`<input id="${id}" name="${f.name}" type="number" inputmode="decimal" step="${f.step || (f.type === 'money' ? '0.01' : f.integer ? '1' : 'any')}" ${f.min !== undefined ? html`min="${f.min}"` : ''} ${f.max !== undefined ? html`max="${f.max}"` : ''} value="${v}" placeholder="${f.placeholder || ''}">`;
            break;
        case 'date':
            control = html`<input id="${id}" name="${f.name}" type="date" value="${v}">`;
            break;
        case 'tel':
            control = html`<input id="${id}" name="${f.name}" type="tel" inputmode="tel" autocomplete="off" value="${v}" placeholder="${f.placeholder || '0803 123 4567'}">`;
            break;
        case 'email':
            control = html`<input id="${id}" name="${f.name}" type="email" autocomplete="off" value="${v}" placeholder="${f.placeholder || ''}">`;
            break;
        default:
            control = html`<input id="${id}" name="${f.name}" type="text" maxlength="${f.max || 200}" value="${v}" placeholder="${f.placeholder || ''}">`;
    }
    return html`<label class="field ${f.full ? 'full' : ''}" for="${id}">
        <span class="lbl">${f.label}${f.required ? ' *' : ''}</span>${control}
        ${f.help ? html`<small class="help">${f.help}</small>` : ''}
        <small class="err" data-err="${f.name}" role="alert"></small>
    </label>`;
}
export const fieldGrid = (fields, values = {}) => html`<div class="grid-form">${fields.map((f) => field(f, values[f.name]))}</div>`;

export function readForm(form) {
    return Object.fromEntries(new FormData(form).entries());
}
export function showErrors(form, errors) {
    form.querySelectorAll('[data-err]').forEach((el) => { el.textContent = errors[el.dataset.err] || ''; });
    const first = Object.keys(errors)[0];
    const input = first && form.querySelector(`[name="${first}"]`);
    if (input) input.focus();
}
