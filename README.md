# NaijaHaul TMS — Phase 1

Multi-tenant transport & fleet management for Nigerian haulage companies, fleet owners and brokers.
**Vanilla HTML/JS + Supabase + Netlify + GitHub** — the same stack and security patterns as V. Gallery, no framework and no build step.
"NaijaHaul" is a working name: change `BRAND` in `public/js/lib/state.js` and the `<title>`/manifest.

## What Phase 1 delivers

| Area | Status |
|---|---|
| Auth: email + password, Google, invite, password reset | ✅ (Google needs enabling in Supabase, see below) |
| Multi-tenancy: companies, members, 6 roles, last-owner protection | ✅ enforced by RLS |
| Fleet: vehicles (**own** and **attached** owner-operators, incl. bus type), drivers, licence expiry | ✅ |
| Customers | ✅ |
| Bookings → trip lifecycle (Booked → Loaded → In transit → Delivered → POD received) + cancel/re-open, history, notes | ✅ |
| Auto-numbered booking & waybill numbers (gapless, per company per year) | ✅ |
| Printable / save-as-PDF waybill (freight hidden unless toggled) | ✅ |
| Broker / attached-owner commission recorded per trip | ✅ |
| Driver login: sees only their own trips, can only push them forward | ✅ |
| Team invites (service-role Netlify Function), roles, deactivate | ✅ |
| Audit log (append-only) on companies, members, customers, drivers, vehicles, trips | ✅ |
| Demo data loader (Nigerian names, plates, routes) | ✅ |
| Installable PWA shell (manifest + service worker) | ✅ (offline *queueing* is Phase 5) |

**Not in Phase 1** (by design — see roadmap): trip costing/P&L, invoicing/VAT/WHT, payments, fuel, maintenance,
documents + reminders, GPS, WhatsApp/AI features, Paystack billing & plan limits, LGA lookup, marketing site beyond a one-page landing,
and the passenger-travel vertical. The schema already carries `vehicle_type = 'bus'` and `seat_capacity` so travel can be added without reshaping the fleet.

## How V. Gallery's patterns are reused

| V. Gallery | Here |
|---|---|
| Atomic Postgres functions (`create_pending_order`, `mark_order_paid`) | `create_company`, `advance_trip_status`, gapless `next_number`; Phase 2 invoice/payment RPCs follow the same idempotent pattern |
| RLS as the boundary, service-role key only in Netlify Functions | Same; the browser only ever has the **anon** key |
| Strict CSP, no inline handlers, `data-action` delegation | Same, and tightened: **no** inline `style` either (`style-src 'self'`) |
| `Utils.escapeHtml` on every untrusted value | Same function, plus an auto-escaping `html` template tag so escaping is the default |
| `sw.js` + `manifest.json` (never caches `/.netlify/` or API calls) | Adapted |
| Brute-force lockout, bcrypt admin | Replaced by Supabase Auth (per-user logins are required for multi-tenancy); its built-in rate limits apply |
| `paystack-webhook.js`, `flutterwave-webhook.js`, `initialize-payment.js`, `verify-payment.js`, `email.js` | **Not copied yet** — they are for Phases 2 and 6 (invoice payment links, subscriptions). They will be reused with the same verify-then-idempotent-RPC flow rather than shipped as dead code now |

Deliberate deviation: the browser uses a ~200-line fetch client (`public/js/lib/sb.js`) instead of loading supabase-js from a CDN.
It keeps the CSP clean (no third-party script host), is a few KB, and is unit-tested. Tokens are stored in `localStorage`
(drivers on phones must stay signed in across tab closes; V. Gallery's admin used `sessionStorage`); the strict CSP is what mitigates XSS token theft.

## Setup

1. **Supabase** → new project → SQL Editor → run, in order:
   `supabase/migrations/001_core_tenancy.sql`, then `002_fleet_haulage.sql`.
2. **Auth settings** (Supabase → Authentication):
   - URL Configuration: *Site URL* = your Netlify URL; add `https://YOUR-SITE/login.html` to *Redirect URLs* (and the same for any custom domain / deploy-preview pattern).
   - Providers → Google: enable with your OAuth client (optional).
   - Email: keep confirmations on in production. Supabase's built-in mailer is heavily rate-limited — configure custom SMTP (e.g. Resend) before real launch.
3. **Netlify** → import the GitHub repo (reads `netlify.toml`). Environment variables:

   | Variable | Where it goes |
   |---|---|
   | `VITE_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL` | written into `public/js/config.js` at build (public by design) |
   | `SUPABASE_SERVICE_ROLE_KEY` | **server only** — used by `netlify/functions/invite-member.js` |

   Set `SITE_URL` to the exact public URL. Deploy.
4. Open the site → **Create an account** → create your company → **Load Nigerian demo data** on the dashboard (owner/admin, empty company only).
5. Branches: `main` = production, `develop` = staging (use a separate Supabase project and scope the env vars per deploy context). PRs get Netlify deploy previews; GitHub Actions run the tests.

Local: `npm test` (unit + smoke tests), `node tests/e2e/run.mjs` (real-browser test, needs Playwright), `npx netlify-cli dev` (needs a `.env` from `.env.example`).

## Security model (summary)

- Every tenant table has `company_id`; RLS keys off `company_members` via `is_member()` / `has_role()`.
- **Column-level grants**: clients cannot write `company_id` on update, plan/trial columns, `booking_no`/`waybill_no`, or `trips.status`.
- Trip status changes only through `advance_trip_status()`; the DB trigger enforces the lifecycle matrix (mirrored in `public/js/lib/lifecycle.js`). `Invoiced`/`Paid` are reserved for the Phase 2 billing RPCs.
- Cross-tenant references (e.g. another company's vehicle on your trip) are impossible: composite foreign keys `(id, company_id)`.
- Financial fields lock once a trip is invoiced/paid/cancelled.
- Soft deletes via `deleted_at`. RLS intentionally does not hide soft-deleted rows (hiding them breaks the very UPDATE that deletes them); every query filters `deleted_at is null`.
- Invites run server-side with the service role, and **re-check** that the caller is an active owner/admin of that company, can never overwrite an owner, and cannot link a driver login across companies.

## Verification status — read this

| Check | Result |
|---|---|
| `npm test`: 59 unit/smoke tests (client library, validation, lifecycle, formatting, every page rendered against a fake DB, XSS escaping, role-dependent UI, invite authorization, CSP/secret hygiene, service-worker precache completeness, "every table has RLS + revoked default grants") | ✅ pass |
| Real Chromium E2E, 22 checks, production CSP header, mock Supabase backend (signup → onboarding → vehicles/drivers/customers → booking → lifecycle → waybill + print CSS → persistence → sign-out → mobile menu) | ✅ pass, no JS errors or CSP violations |
| **SQL migrations & `supabase/tests/rls_isolation.sql` against a real Postgres** | ⚠️ **NOT run.** No Postgres was available while building. The SQL was reviewed by hand and passes structural checks only. Run the migrations, then `rls_isolation.sql` (it rolls back and prints `ALL RLS / PRIVILEGE TESTS PASSED`) on a **staging** Supabase project before trusting it. If an assertion fails, fix the migration, not the test. |
| Netlify deploy, Google OAuth, email delivery | ⚠️ not exercised (need your accounts) |
| `package-lock.json` | ⚠️ not generated (no registry access here). Run `npm install` once and commit it; CI uses `npm ci` when it exists |

The mock backend in `tests/e2e/` verifies the **browser code**; it does not replicate RLS. RLS is verified only by the SQL test.

## Assumptions (change freely)

- Roles: owner, admin, ops_manager, accountant, dispatcher, driver. "Customer" is a tracking link (Phase 5), not a login.
- Trials start on the `starter` plan; per-plan limits and ₦ pricing are Phase 6 (nullable columns already exist).
- Trip numbers: `BK-YYYY-00001` / `WB-YYYY-00001`, per company, year in Africa/Lagos time.
- At most 3 companies per account (abuse guard in `create_company`).
- Lists load the latest 300–500 rows; server-side search/pagination arrives with Phase 4 reports.

## Roadmap

2. Trip costs (fuel, allowances, tolls, checkpoint, repairs) + live trip P&L; invoicing (single/bundled), 7.5% VAT, WHT, payments, ageing, Paystack/Flutterwave payment links (reusing V. Gallery's webhook + `mark_order_paid`-style idempotent RPC)
3. Fuel (km/l, anomaly flags), maintenance reminders, tyres, documents with Storage + pg_cron reminders, driver payroll
4. Dashboards & reports
5. GPS (Traccar/webhook → Realtime), WhatsApp/Termii, offline queue, AI inbox/import/assistant
6. Paystack subscriptions, plan-limit enforcement, NDPA export/delete, hardening

Passenger-travel vertical (routes, schedules, seat maps, tickets) is a separate phase on top of this fleet/customer/finance base.
