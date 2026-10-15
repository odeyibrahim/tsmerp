// Tiny UI toolkit: safe templating, V. Gallery-style data-action delegation (no inline handlers, so the
// strict CSP can stay free of 'unsafe-inline' scripts), modal, toast. Safe to import in Node (tests):
// nothing here touches the DOM until a function is called.
import { escapeHtml, trapFocus } from './utils.js';

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s == null ? '' : String(s));

function esc(v) {
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(esc).join('');
    if (v === null || v === undefined || v === false) return '';
    return escapeHtml(v);
}
// html`<td>${userValue}</td>` — every interpolation is escaped unless it is itself html`` / raw().
export function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += esc(vals[i]) + strings[i + 1];
    return new Raw(out);
}

export const badge = (tone, text) => html`<span class="badge badge-${tone}">${text}</span>`;
export const emptyState = (title, hint, action) => html`<div class="empty"><h3>${title}</h3><p>${hint}</p>${action || ''}</div>`;

// ---------- action registry + delegation ----------
const actions = new Map();
export const registerAction = (name, fn) => actions.set(name, fn);
export const registerForm = (name, fn) => actions.set('form:' + name, fn);

export function installDelegation(doc = document) {
    doc.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const fn = actions.get(el.dataset.action);
        if (fn) { if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault(); fn(el, e); }
    });
    doc.addEventListener('change', (e) => {
        const el = e.target.closest('[data-change]');
        if (el) { const fn = actions.get(el.dataset.change); if (fn) fn(el, e); }
    });
    doc.addEventListener('input', (e) => {
        const el = e.target.closest('[data-filter]');
        if (!el) return;
        const q = el.value.trim().toLowerCase();
        doc.querySelectorAll(`#${CSS.escape(el.dataset.filter)} [data-search]`).forEach((row) => {
            row.hidden = q !== '' && !row.dataset.search.includes(q);
        });
    });
    doc.addEventListener('submit', async (e) => {
        const form = e.target.closest('form[data-form]');
        if (!form) return;
        e.preventDefault();
        const fn = actions.get('form:' + form.dataset.form);
        if (!fn) return;
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        try { await fn(form, e); }
        catch (err) { console.error(err); showFormError(form, 'Something went wrong. Please try again.'); }
        finally { if (btn) btn.disabled = false; }
    });
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

// ---------- modal / toast ----------
let releaseFocus = null;
export function openModal(title, body) {
    const root = document.getElementById('modal-root');
    root.innerHTML = String(html`
        <div class="modal-backdrop" data-action="modal-backdrop">
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
                <header><h2 id="modal-title">${title}</h2><button type="button" class="icon-btn" data-action="modal-close" aria-label="Close">×</button></header>
                <div class="modal-body">${body}</div>
            </div>
        </div>`);
    releaseFocus = trapFocus(root.querySelector('.modal'));
}
export function closeModal() {
    const root = typeof document !== 'undefined' && document.getElementById('modal-root');
    if (!root || !root.firstChild) return;
    root.innerHTML = '';
    if (releaseFocus) { releaseFocus(); releaseFocus = null; }
}
registerAction('modal-close', () => closeModal());
registerAction('modal-backdrop', (el, e) => { if (e.target === el) closeModal(); });

export function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
        openModal(title, html`<p>${message}</p>
            <div class="form-actions">
                <button type="button" class="btn" data-action="confirm-no">Cancel</button>
                <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm-yes">${confirmLabel}</button>
            </div>`);
        const done = (v) => { actions.delete('confirm-yes'); actions.delete('confirm-no'); closeModal(); resolve(v); };
        registerAction('confirm-yes', () => done(true));
        registerAction('confirm-no', () => done(false));
    });
}

let toastTimer;
export function toast(message, tone = 'ok') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = `toast show toast-${tone}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

export function showFormError(form, message) {
    const el = form.querySelector('[data-form-error]');
    if (el) { el.textContent = message; el.hidden = !message; }
}
