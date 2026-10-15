import { normalizePhone } from './nigeria.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A field definition is the single source of truth for BOTH the rendered input and its validation:
// { name, label, type: text|textarea|tel|email|number|money|date|select|lookup, required, max, min, step,
//   integer, options: [[value,label]|string], default, help, placeholder }
export function validateFields(fields, input, rules = []) {
    const data = {};
    const errors = {};
    for (const f of fields) {
        const raw = input[f.name];
        const v = typeof raw === 'string' ? raw.trim() : raw;
        const empty = v === undefined || v === null || v === '';
        if (empty) {
            if (f.required) errors[f.name] = `${f.label} is required`;
            data[f.name] = f.default !== undefined ? f.default : (f.type === 'money' ? 0 : null);
            continue;
        }
        switch (f.type) {
            case 'tel': {
                const p = normalizePhone(v);
                if (!p) errors[f.name] = 'Enter a valid phone number, e.g. 0803 123 4567';
                else data[f.name] = p;
                break;
            }
            case 'email':
                if (!EMAIL.test(v)) errors[f.name] = 'Enter a valid email address';
                else data[f.name] = v.toLowerCase();
                break;
            case 'number':
            case 'money': {
                const n = Number(String(v).replace(/,/g, ''));
                const min = f.min !== undefined ? f.min : (f.type === 'money' ? 0 : -Infinity);
                const max = f.max !== undefined ? f.max : (f.type === 'money' ? 1e12 : Infinity);
                if (!Number.isFinite(n)) errors[f.name] = 'Enter a number';
                else if (f.integer && !Number.isInteger(n)) errors[f.name] = 'Enter a whole number';
                else if (n < min) errors[f.name] = `Must be at least ${min}`;
                else if (n > max) errors[f.name] = `Must be at most ${max}`;
                else data[f.name] = f.type === 'money' ? Math.round(n * 100) / 100 : n;
                break;
            }
            case 'date':
                if (!DATE.test(v) || Number.isNaN(new Date(v + 'T00:00:00Z').getTime())) errors[f.name] = 'Enter a valid date';
                else data[f.name] = v;
                break;
            case 'select': {
                const allowed = (f.options || []).map((o) => (Array.isArray(o) ? o[0] : o));
                if (!allowed.includes(v)) errors[f.name] = `Choose a valid ${f.label.toLowerCase()}`;
                else data[f.name] = v;
                break;
            }
            case 'lookup':
                if (!UUID.test(v)) errors[f.name] = `Choose a valid ${f.label.toLowerCase()}`;
                else data[f.name] = v;
                break;
            default: {
                const max = f.max || (f.type === 'textarea' ? 1000 : 200);
                if (v.length > max) errors[f.name] = `${f.label} is too long (max ${max})`;
                else data[f.name] = v;
            }
        }
    }
    for (const rule of rules) {
        const issue = rule(data);
        if (issue && !errors[issue.field]) errors[issue.field] = issue.message;
    }
    return Object.keys(errors).length ? { ok: false, errors, data } : { ok: true, data, errors: {} };
}
