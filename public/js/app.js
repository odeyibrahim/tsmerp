import { createClient } from './lib/sb.js';
import { state, BRAND } from './lib/state.js';
import { html, installDelegation, registerAction, registerForm, toast, showFormError } from './lib/ui.js';
import { fieldGrid, readForm, showErrors } from './lib/forms.js';
import { validateFields } from './lib/validate.js';
import { friendlyError } from './lib/errors.js';
import { matchRoute } from './lib/router.js';
import { can, ROLE_LABELS } from './lib/permissions.js';
import { companyFields } from './pages/settings.js';
import * as dashboard from './pages/dashboard.js';
import * as trips from './pages/trips.js';
import * as trip from './pages/trip.js';
import * as waybill from './pages/waybill.js';
import * as team from './pages/team.js';
import * as settings from './pages/settings.js';
import vehicles from './pages/vehicles.js';
import drivers from './pages/drivers.js';
import customers from './pages/customers.js';

const ID = '([0-9a-f-]{36})';
const routes = [
    { pattern: /^\/$/, render: dashboard.render, nav: 'dashboard', title: 'Dashboard' },
    { pattern: /^\/trips$/, render: trips.render, nav: 'trips', title: 'Trips' },
    { pattern: new RegExp(`^/trips/${ID}$`), params: ['id'], render: trip.render, nav: 'trips', title: 'Trip' },
    { pattern: new RegExp(`^/trips/${ID}/waybill$`), params: ['id'], render: waybill.render, nav: 'trips', title: 'Waybill' },
    { pattern: /^\/vehicles$/, render: vehicles.render, nav: 'vehicles', title: 'Vehicles' },
    { pattern: /^\/drivers$/, render: drivers.render, nav: 'drivers', title: 'Drivers' },
    { pattern: /^\/customers$/, render: customers.render, nav: 'customers', title: 'Customers' },
    { pattern: /^\/team$/, render: team.render, nav: 'team', title: 'Team' },
    { pattern: /^\/settings$/, render: settings.render, nav: 'settings', title: 'Settings' }
];
const NAV = [
    ['dashboard', 'Dashboard', '/', () => true],
    ['trips', 'Trips', '/trips', () => true],
    ['vehicles', 'Vehicles', '/vehicles', () => true],
    ['drivers', 'Drivers', '/drivers', can.seeOffice],
    ['customers', 'Customers', '/customers', can.seeOffice],
    ['team', 'Team', '/team', can.manageTeam],
    ['settings', 'Settings', '/settings', can.seeOffice]
];
const $ = (id) => document.getElementById(id);
const view = () => $('view');

function showSetup() {
    $('boot').innerHTML = `<div class="card narrow"><h1>Setup needed</h1><p>This deployment has no Supabase configuration. Set <code>VITE_SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in Netlify, then redeploy. See the README.</p></div>`;
}

async function loadMemberships() {
    const { data: ms, error } = await state.db.from('company_members').select('company_id,role').eq('user_id', state.user.id).eq('is_active', true);
    if (error) throw new Error(error.message);
    const ids = (ms || []).map((m) => m.company_id);
    if (!ids.length) { state.companies = []; return; }
    const { data: cos } = await state.db.from('companies').select('*').in('id', ids).is('deleted_at', null);
    state.companies = (cos || []).map((c) => ({ company: c, role: ms.find((m) => m.company_id === c.id).role }));
}
function setActive(id) {
    const pick = state.companies.find((c) => c.company.id === id) || state.companies[0];
    state.company = pick.company; state.role = pick.role;
    localStorage.setItem('tms.company', pick.company.id);
}

function renderChrome() {
    $('nav').innerHTML = String(html`${NAV.filter((n) => n[3](state.role)).map((n) => html`<a href="#${n[2]}" data-nav="${n[0]}" data-action="shell:nav">${n[1]}</a>`)}`);
    $('company-switch').innerHTML = String(state.companies.length > 1
        ? html`<select data-change="shell:company" aria-label="Switch company">${state.companies.map((c) => html`<option value="${c.company.id}" ${c.company.id === state.company.id ? 'selected' : ''}>${c.company.name}</option>`)}</select>`
        : html`<strong>${state.company.name}</strong>`);
    $('user-menu').innerHTML = String(html`<span class="muted">${state.user.email} · ${ROLE_LABELS[state.role]}</span> <button class="btn btn-sm" data-action="shell:signout">Sign out</button>`);
}

async function route() {
    if (!state.company) return;
    const hash = location.hash || '#/';
    let m = matchRoute(routes, hash);
    if (m && state.role === 'driver' && !['trips'].includes(m.route.nav)) { location.hash = '#/trips'; return; }
    if (!m) m = { route: { render: () => html`<div class="empty"><h3>Page not found</h3><p><a href="#/">Back to dashboard</a></p></div>`, nav: '', title: 'Not found' }, params: {} };
    document.body.classList.remove('menu-open');
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === m.route.nav));
    document.title = `${m.route.title} · ${BRAND}`;
    try {
        view().innerHTML = String(await m.route.render(m.params));
    } catch (e) {
        console.error(e);
        view().innerHTML = String(html`<div class="alert alert-error">Something went wrong loading this page. <button class="btn btn-sm" data-action="shell:reload">Retry</button></div>`);
    }
    view().focus({ preventScroll: true });
}
state.rerender = () => route();

function showOnboarding() {
    $('shell').hidden = true; $('boot').hidden = false;
    $('boot').innerHTML = String(html`<div class="card narrow"><h1>Welcome to ${BRAND}</h1>
        <p>Create your company to start your 7-day free trial — no card needed.</p>
        <form data-form="onboard" novalidate>${fieldGrid(companyFields().filter((f) => ['name', 'phone', 'state', 'address'].includes(f.name)), {})}
        <p class="alert alert-error" data-form-error hidden></p>
        <div class="form-actions"><button type="button" class="btn" data-action="shell:signout">Sign out</button><button type="submit" class="btn btn-primary">Create company</button></div></form></div>`);
}
registerForm('onboard', async (form) => {
    const fields = companyFields().filter((f) => ['name', 'phone', 'state', 'address'].includes(f.name));
    const v = validateFields(fields, readForm(form));
    if (!v.ok) return showErrors(form, v.errors);
    const { error } = await state.db.rpc('create_company', { p_name: v.data.name, p_phone: v.data.phone, p_state: v.data.state, p_address: v.data.address });
    if (error) return showFormError(form, friendlyError(error));
    await loadMemberships();
    start();
});

function start() {
    if (!state.companies.length) return showOnboarding();
    setActive(localStorage.getItem('tms.company'));
    $('boot').hidden = true; $('boot').innerHTML = ''; $('shell').hidden = false;   // drop the onboarding form so ids/selectors stay unique
    renderChrome();
    route();
}

registerAction('shell:signout', async () => { await state.db.auth.signOut(); location.replace('/login.html'); });
registerAction('shell:reload', () => route());
registerAction('shell:menu', () => document.body.classList.toggle('menu-open'));
registerAction('shell:nav', () => document.body.classList.remove('menu-open'));
registerAction('shell:company', (el) => { setActive(el.value); renderChrome(); location.hash = '#/'; route(); });

async function boot() {
    installDelegation();
    let cfg = null;
    try { cfg = (await import('./config.js')).default; } catch { /* not generated */ }
    if (!cfg || !cfg.supabaseUrl || !cfg.anonKey) return showSetup();
    state.db = createClient({ url: cfg.supabaseUrl, anonKey: cfg.anonKey, storage: localStorage });
    state.db.auth.onChange((s) => { if (!s) location.replace('/login.html'); });
    const session = await state.db.auth.getSession();
    if (!session) return location.replace('/login.html');
    state.user = session.user;
    try { await loadMemberships(); } catch (e) { $('boot').textContent = 'Could not load your account. Check your connection and refresh.'; return; }
    window.addEventListener('hashchange', route);
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
    start();
}
if (typeof document !== 'undefined') boot();
