// Core of invite-member, separated from the Netlify handler so it can be unit-tested with a fake client.
// Runs with the SERVICE ROLE key, which bypasses RLS — so every authorization decision is made here, explicitly.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const INVITE_ROLES = ['admin', 'ops_manager', 'accountant', 'dispatcher', 'driver'];

const fail = (status, error) => ({ status, body: { error } });

export async function inviteMember({ admin, token, body, siteUrl }) {
    if (!token) return fail(401, 'Sign in required');
    const { data: auth, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !auth || !auth.user) return fail(401, 'Invalid or expired session');
    const caller = auth.user;

    const email = String((body && body.email) || '').trim().toLowerCase();
    const { company_id: companyId, role, driver_id: driverId } = body || {};
    const fullName = String((body && body.full_name) || '').trim().slice(0, 120);
    if (!EMAIL.test(email)) return fail(400, 'Enter a valid email address');
    if (!UUID.test(String(companyId || ''))) return fail(400, 'Missing company');
    if (!INVITE_ROLES.includes(role)) return fail(400, 'Invalid role');
    if (driverId && !UUID.test(String(driverId))) return fail(400, 'Invalid driver');

    // Authorization: the caller must be an active owner/admin of THIS company (never trust the client's claim).
    const { data: mine } = await admin.from('company_members').select('role').eq('company_id', companyId).eq('user_id', caller.id).eq('is_active', true).maybeSingle();
    if (!mine || !['owner', 'admin'].includes(mine.role)) return fail(403, 'Only owners and admins can invite people');

    let driver = null;
    if (role === 'driver') {
        if (!driverId) return fail(400, 'Choose the driver record for this login');
        const { data } = await admin.from('drivers').select('id,user_id').eq('id', driverId).eq('company_id', companyId).is('deleted_at', null).maybeSingle();
        if (!data) return fail(400, 'Driver not found in your company');
        if (data.user_id) return fail(409, 'That driver already has a login');
        driver = data;
    }

    let userId; let message;
    const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
    if (existing) {
        userId = existing.id;
        message = 'This person already has an account — they have been added to your company and can sign in.';
    } else {
        const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName },
            redirectTo: `${String(siteUrl || '').replace(/\/+$/, '')}/login.html`
        });
        if (invErr || !invited || !invited.user) return fail(502, (invErr && invErr.message) || 'Could not send the invite email');
        userId = invited.user.id;
        message = `Invite sent to ${email}.`;
    }

    // Never let an invite overwrite (e.g. demote) an existing membership of an owner.
    const { data: already } = await admin.from('company_members').select('role,is_active').eq('company_id', companyId).eq('user_id', userId).maybeSingle();
    if (already && already.role === 'owner') return fail(409, 'That person is already an owner of this company');

    const { error: memErr } = await admin.from('company_members').upsert({ company_id: companyId, user_id: userId, role, is_active: true }, { onConflict: 'company_id,user_id' });
    if (memErr) return fail(500, 'Could not add the member');

    if (driver) {
        const { error: dErr } = await admin.from('drivers').update({ user_id: userId }).eq('id', driver.id);
        if (dErr) return fail(500, 'Member added, but linking the driver record failed');
    }
    return { status: 200, body: { ok: true, message } };
}
