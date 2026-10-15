// Adapted from V. Gallery's utils.js (same escaping + focus-trap helpers), as an ES module.
// Escape ANY value that originates outside your own source: API data, URL params, storage, user input.
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
export const escapeAttr = escapeHtml;

export function trapFocus(container) {
    if (!container) return () => {};
    const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const previouslyFocused = document.activeElement;
    function onKey(e) {
        if (e.key !== 'Tab') return;
        const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    container.addEventListener('keydown', onKey);
    const first = container.querySelector(FOCUSABLE);
    if (first) first.focus();
    return () => {
        container.removeEventListener('keydown', onKey);
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    };
}
