import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUSES, transitionAllowed, nextStatus, prevStatus, canCancel } from '../public/js/lib/lifecycle.js';
import { validateFields } from '../public/js/lib/validate.js';

test('forward moves one step at a time', () => {
    assert.ok(transitionAllowed('booked', 'loaded'));
    assert.ok(transitionAllowed('delivered', 'pod_received'));
    assert.ok(transitionAllowed('pod_received', 'invoiced'));
    assert.ok(!transitionAllowed('booked', 'in_transit'));
    assert.ok(!transitionAllowed('booked', 'paid'));
});
test('reverts allowed only before billing', () => {
    assert.ok(transitionAllowed('loaded', 'booked'));
    assert.ok(transitionAllowed('pod_received', 'delivered'));
    assert.ok(!transitionAllowed('invoiced', 'pod_received'));
    assert.ok(!transitionAllowed('paid', 'invoiced'));
    assert.ok(!transitionAllowed('booked', 'booked'));
});
test('cancel / reopen rules', () => {
    for (const s of ['booked', 'loaded', 'in_transit', 'delivered', 'pod_received']) assert.ok(canCancel(s), s);
    for (const s of ['invoiced', 'paid', 'cancelled']) assert.ok(!canCancel(s), s);
    assert.ok(transitionAllowed('cancelled', 'booked'));
    assert.ok(!transitionAllowed('cancelled', 'delivered'));
});
test('UI helpers stop at POD received (billing owns the rest)', () => {
    assert.equal(nextStatus('booked'), 'loaded');
    assert.equal(nextStatus('delivered'), 'pod_received');
    assert.equal(nextStatus('pod_received'), null);
    assert.equal(nextStatus('cancelled'), null);
    assert.equal(prevStatus('booked'), null);
    assert.equal(prevStatus('pod_received'), 'delivered');
    assert.equal(prevStatus('invoiced'), null);
});
test('every status pair is decided without throwing', () => {
    for (const a of STATUSES) for (const b of STATUSES) assert.equal(typeof transitionAllowed(a, b), 'boolean');
});

const F = [
    { name: 'name', label: 'Name', type: 'text', required: true, max: 10 },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'amount', label: 'Amount', type: 'money' },
    { name: 'year', label: 'Year', type: 'number', integer: true, min: 1980, max: 2030 },
    { name: 'when', label: 'Date', type: 'date' },
    { name: 'kind', label: 'Kind', type: 'select', options: [['a', 'A'], 'b'] },
    { name: 'cust', label: 'Customer', type: 'lookup' }
];
test('valid input is normalised', () => {
    const r = validateFields(F, { name: ' Musa ', phone: '08031234567', email: 'A@B.COM', amount: '1,500.456', year: '2019', when: '2026-10-14', kind: 'b', cust: '123e4567-e89b-12d3-a456-426614174000' });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(r.data, { name: 'Musa', phone: '+2348031234567', email: 'a@b.com', amount: 1500.46, year: 2019, when: '2026-10-14', kind: 'b', cust: '123e4567-e89b-12d3-a456-426614174000' });
});
test('empty optionals become null (money -> 0) so edits can clear fields', () => {
    const r = validateFields(F, { name: 'X' });
    assert.ok(r.ok);
    assert.equal(r.data.phone, null);
    assert.equal(r.data.amount, 0);
});
test('errors are reported per field', () => {
    const r = validateFields(F, { name: '', phone: '123', email: 'nope', amount: '-5', year: '1.5', when: '2026-13-45', kind: 'zzz', cust: 'x' });
    assert.ok(!r.ok);
    for (const k of ['name', 'phone', 'email', 'amount', 'year', 'when', 'kind', 'cust']) assert.ok(r.errors[k], k);
    assert.equal(validateFields(F, { name: 'x'.repeat(11) }).errors.name, 'Name is too long (max 10)');
});
test('cross-field rules run on cleaned data', () => {
    const rule = (d) => (d.amount > 100 ? { field: 'amount', message: 'too big' } : null);
    assert.equal(validateFields(F, { name: 'x', amount: '200' }, [rule]).errors.amount, 'too big');
});
