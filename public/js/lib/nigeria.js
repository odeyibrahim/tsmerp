export const STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT (Abuja)','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];

// Quick-fill routes for the booking form. Addresses are optional hints, always editable.
export const CORRIDORS = [
    { label: 'Lagos → Ibadan', from: 'Lagos', to: 'Oyo' },
    { label: 'Lagos → Abuja', from: 'Lagos', to: 'FCT (Abuja)' },
    { label: 'Lagos → Kano', from: 'Lagos', to: 'Kano' },
    { label: 'Lagos → Onitsha', from: 'Lagos', to: 'Anambra' },
    { label: 'Lagos → Port Harcourt', from: 'Lagos', to: 'Rivers' },
    { label: 'Apapa Port → Ogun (inland)', from: 'Lagos', to: 'Ogun', fromAddr: 'Apapa Port, Lagos' },
    { label: 'Tin Can Port → Ibadan', from: 'Lagos', to: 'Oyo', fromAddr: 'Tin Can Island Port, Lagos' },
    { label: 'Port Harcourt → Abuja', from: 'Rivers', to: 'FCT (Abuja)' },
    { label: 'Abuja → Kano', from: 'FCT (Abuja)', to: 'Kano' }
];

// Returns "+234XXXXXXXXXX" for Nigerian numbers, E.164 for other international numbers, or null.
export function normalizePhone(input) {
    if (input === null || input === undefined) return null;
    const s = String(input).trim().replace(/[\s\-().]/g, '');
    if (/^\+234\d{10}$/.test(s)) return s;
    if (/^234\d{10}$/.test(s)) return '+' + s;
    if (/^0\d{10}$/.test(s)) return '+234' + s.slice(1);
    if (/^\+(?!234)\d{8,15}$/.test(s)) return s;
    return null;
}
export function formatPhone(p) {
    if (!p) return '—';
    const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(p);
    return m ? `+234 ${m[1]} ${m[2]} ${m[3]}` : p;
}
