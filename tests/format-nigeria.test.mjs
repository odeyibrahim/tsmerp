import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, formatDate, daysUntil, toNumber, round2 } from '../public/js/lib/format.js';
import { normalizePhone, formatPhone, STATES, CORRIDORS } from '../public/js/lib/nigeria.js';
import { escapeHtml } from '../public/js/lib/utils.js';

test('naira formatting has symbol and thousands separators', () => {
    assert.equal(formatMoney(1234567.5), '₦1,234,567.50');
    assert.equal(formatMoney('250000'), '₦250,000.00');
    assert.equal(formatMoney(null), '₦0.00');
    assert.equal(formatMoney(45, 'USD'), '$45.00');
});
test('toNumber / round2', () => {
    assert.equal(toNumber('1,200.5'), 1200.5);
    assert.equal(toNumber('abc'), 0);
    assert.equal(round2(0.1 + 0.2), 0.3);
});
test('date-only strings do not shift across timezones', () => {
    assert.equal(formatDate('2026-10-14'), '14 Oct 2026');
    assert.equal(formatDate(null), '—');
    assert.equal(formatDate('garbage'), '—');
});
test('daysUntil counts in Lagos time', () => {
    const now = Date.parse('2026-10-14T10:00:00Z');
    assert.equal(daysUntil('2026-10-14', now), 0);
    assert.equal(daysUntil('2026-10-21', now), 7);
    assert.equal(daysUntil('2026-10-13', now), -1);
});
test('phone normalisation', () => {
    assert.equal(normalizePhone('0803 123 4567'), '+2348031234567');
    assert.equal(normalizePhone('08031234567'), '+2348031234567');
    assert.equal(normalizePhone('2348031234567'), '+2348031234567');
    assert.equal(normalizePhone('+234 803-123-4567'), '+2348031234567');
    assert.equal(normalizePhone('+233241234567'), '+233241234567'); // Ghana passes through
    assert.equal(normalizePhone('0803123'), null);
    assert.equal(normalizePhone('hello'), null);
    assert.equal(normalizePhone(''), null);
    assert.equal(formatPhone('+2348031234567'), '+234 803 123 4567');
});
test('states and corridors are consistent', () => {
    assert.equal(STATES.length, 37); // 36 states + FCT
    for (const c of CORRIDORS) {
        assert.ok(STATES.includes(c.from), c.label);
        assert.ok(STATES.includes(c.to), c.label);
    }
});
test('escapeHtml neutralises markup and quotes', () => {
    assert.equal(escapeHtml('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;');
    assert.equal(escapeHtml(null), '');
});
