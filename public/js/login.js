import { createClient } from './lib/sb.js';
import { installDelegation, registerAction, registerForm } from './lib/ui.js';
import { readForm } from './lib/forms.js';

const $ = (s) => document.querySelector(s);
let db;

function mode(name) {
    document.querySelectorAll('[data-mode]').forEach((s) => { s.hidden = s.dataset.mode !== name; });
    message('');
}
function message(text, tone = 'error') {
    const el = $('#msg');
    el.textContent = text; el.hidden = !text;
    el.className = `alert alert-${tone}`;
}
const goApp = () => location.replace('/app.html');
const back = () => `${location.origin}/login.html`;

registerAction('auth:mode', (el) => mode(el.dataset.to));
registerAction('auth:google', () => { location.href = db.auth.googleUrl(back()); });

registerForm('signin', async (form) => {
    const { email, password } = readForm(form);
    if (!email || !password) return message('Enter your email and password.');
    const { error } = await db.auth.signIn({ email: email.trim(), password });
    if (error) return message(error.message);
    goApp();
});
registerForm('signup', async (form) => {
    const { full_name, email, password } = readForm(form);
    if (!full_name || !email) return message('Enter your name and email.');
    if (!password || password.length < 8) return message('Password must be at least 8 characters.');
    const { data, error } = await db.auth.signUp({ email: email.trim(), password, fullName: full_name.trim(), redirectTo: back() });
    if (error) return message(error.message);
    if (data.needsConfirmation) { mode('signin'); return message('Check your email to confirm your account, then sign in.', 'info'); }
    goApp();
});
registerForm('forgot', async (form) => {
    const { email } = readForm(form);
    if (!email) return message('Enter your email.');
    await db.auth.resetPassword(email.trim(), back());
    message('If that email has an account, a reset link is on its way.', 'info');   // same answer either way: no account enumeration
});
registerForm('setpw', async (form) => {
    const { password } = readForm(form);
    if (!password || password.length < 8) return message('Password must be at least 8 characters.');
    const { error } = await db.auth.updatePassword(password);
    if (error) return message(error.message);
    goApp();
});

(async function boot() {
    installDelegation();
    let cfg = null;
    try { cfg = (await import('./config.js')).default; } catch { /* not generated */ }
    if (!cfg || !cfg.supabaseUrl || !cfg.anonKey) return message('This deployment is not configured yet (missing Supabase settings).');
    db = createClient({ url: cfg.supabaseUrl, anonKey: cfg.anonKey, storage: localStorage });

    if (/access_token=|error=/.test(location.hash)) {
        const r = await db.auth.consumeRedirect(location.hash);
        history.replaceState(null, '', location.pathname);
        if (r.error) return message(r.error.message);
        if (r.type === 'invite' || r.type === 'recovery') return mode('setpw');
        return goApp();
    }
    if (await db.auth.getSession()) goApp();
})();
