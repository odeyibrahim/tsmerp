import { createClient } from '@supabase/supabase-js';
import { inviteMember } from './_lib/invite.js';

// POST /.netlify/functions/invite-member   Authorization: Bearer <user JWT>
// body: { company_id, email, role, full_name?, driver_id? }
export const handler = async (event) => {
    const headers = { 'Content-Type': 'application/json' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.error('invite-member: Supabase env vars missing');
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server is not configured' }) };
    }

    let body;
    try { body = event.body ? JSON.parse(event.body) : {}; }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) }; }

    const header = event.headers.authorization || event.headers.Authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    try {
        const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const out = await inviteMember({ admin, token, body, siteUrl: process.env.SITE_URL || process.env.URL || '' });
        return { statusCode: out.status, headers, body: JSON.stringify(out.body) };
    } catch (e) {
        console.error('invite-member error:', e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Invite failed' }) };
    }
};
