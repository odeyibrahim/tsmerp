-- ============================================================
-- RLS / privilege isolation test.  Run AFTER migrations 001 + 002,
-- in the Supabase SQL Editor (or `psql`). It creates throwaway users
-- and data inside ONE transaction and ROLLS BACK at the end, so it
-- leaves nothing behind. Any failed expectation raises an exception.
--
-- It impersonates users the same way PostgREST does: set the JWT claim
-- GUCs, then `set local role authenticated` so RLS + column privileges apply.
-- ============================================================
begin;

create function pg_temp.become(p_uid uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
    uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid(); uC uuid := gen_random_uuid(); uD uuid := gen_random_uuid();
    cA uuid; cB uuid; cA2 uuid;
    vA uuid; vB uuid; dA uuid; custA uuid;
    t1 uuid; t2 uuid; t3 uuid;
    n int; code text; ok boolean; wb text; bk text; st trip_status;
begin
    -- ---------- fixtures (as the table owner) ----------
    insert into auth.users (id, email) values
        (uA, 'a-' || uA || '@test.local'), (uB, 'b-' || uB || '@test.local'),
        (uC, 'c-' || uC || '@test.local'), (uD, 'd-' || uD || '@test.local');
    assert (select count(*) from profiles where id in (uA, uB, uC, uD)) = 4, 'handle_new_user should create profiles';

    -- ---------- onboarding: each owner creates their own tenant ----------
    perform pg_temp.become(uA); set local role authenticated;
    cA := create_company('Alpha Haulage', '+2348031110000', 'Lagos');
    reset role;
    perform pg_temp.become(uB); set local role authenticated;
    cB := create_company('Beta Logistics', null, 'Kano');
    reset role;

    -- ---------- tenant A builds data ----------
    perform pg_temp.become(uA); set local role authenticated;
    insert into vehicles (company_id, plate_number, vehicle_type, ownership) values (cA, ' lsr 412aa ', 'truck', 'own') returning id into vA;
    assert (select plate_number from vehicles where id = vA) = 'LSR 412AA', 'plate should be normalised';
    insert into drivers (company_id, full_name, phone) values (cA, 'Musa Ibrahim', '+2348020000001') returning id into dA;
    insert into customers (company_id, name) values (cA, 'Adebayo & Sons') returning id into custA;
    reset role;

    perform pg_temp.become(uB); set local role authenticated;
    insert into vehicles (company_id, plate_number) values (cB, 'KAN-001AA') returning id into vB;
    reset role;

    -- ---------- 1. isolation: B cannot see A's rows ----------
    perform pg_temp.become(uB); set local role authenticated;
    assert (select count(*) from companies) = 1, 'B must see only its own company';
    assert (select count(*) from vehicles where company_id = cA) = 0, 'B must not see A vehicles';
    assert (select count(*) from drivers where company_id = cA) = 0, 'B must not see A drivers';
    assert (select count(*) from customers where company_id = cA) = 0, 'B must not see A customers';
    assert (select count(*) from company_members where company_id = cA) = 0, 'B must not see A members';
    assert (select count(*) from audit_log where company_id = cA) = 0, 'B must not see A audit log';

    -- 2. B cannot write into A
    ok := false;
    begin insert into vehicles (company_id, plate_number) values (cA, 'EVIL-001'); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'B inserting into A must hit RLS (got ' || coalesce(code, 'success') || ')';

    update vehicles set make = 'hacked' where id = vA;
    get diagnostics n = row_count;
    assert n = 0, 'B updating A vehicle must affect 0 rows';
    reset role;

    -- ---------- 3. cross-tenant references blocked by composite FKs ----------
    perform pg_temp.become(uA); set local role authenticated;
    ok := false;
    begin
        insert into trips (company_id, vehicle_id, origin_state, destination_state) values (cA, vB, 'Lagos', 'Oyo'); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '23503', 'A referencing B vehicle must fail FK (got ' || coalesce(code, 'success') || ')';

    -- ---------- 4. numbering + defaults + history ----------
    insert into trips (company_id, customer_id, vehicle_id, driver_id, origin_state, destination_state, freight_amount, advance_paid)
    values (cA, custA, vA, dA, 'Lagos', 'Oyo', 400000, 100000) returning id, booking_no, waybill_no into t1, bk, wb;
    assert bk like 'BK-%-00001' and wb like 'WB-%-00001', 'first numbers should be 00001 (got ' || bk || ' / ' || wb || ')';
    insert into trips (company_id, origin_state, destination_state) values (cA, 'Lagos', 'Kano') returning id, waybill_no into t2, wb;
    assert wb like 'WB-%-00002', 'second waybill should be 00002';
    assert (select status from trips where id = t1) = 'booked', 'new trips start booked';
    assert (select count(*) from trip_status_history where trip_id = t1) = 1, 'initial history row';

    -- 5. clients cannot set protected columns
    ok := false;
    begin update trips set status = 'delivered' where id = t1; ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'direct status update must be denied (got ' || coalesce(code, 'success') || ')';
    ok := false;
    begin update trips set booking_no = 'BK-HACK' where id = t1; ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'booking_no update must be denied';
    ok := false;
    begin insert into trips (company_id, origin_state, destination_state, status) values (cA, 'Lagos', 'Oyo', 'paid'); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'inserting a status must be denied';
    ok := false;
    begin update companies set plan = 'unlimited' where id = cA; ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'plan column must not be client-writable';
    ok := false;
    begin update vehicles set company_id = cB where id = vA; ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'company_id must not be updatable';

    -- ---------- 6. lifecycle through advance_trip_status ----------
    perform advance_trip_status(t1, 'loaded', 'loaded at depot');
    assert (select note from trip_status_history where trip_id = t1 and to_status = 'loaded') = 'loaded at depot', 'note recorded';
    ok := false;
    begin perform advance_trip_status(t1, 'delivered'); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '23514', 'skipping a stage must fail (got ' || coalesce(code, 'success') || ')';
    ok := false;
    begin perform advance_trip_status(t1, 'invoiced'); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '22023', 'invoiced is reserved for billing';
    perform advance_trip_status(t1, 'booked');                 -- step back
    perform advance_trip_status(t2, 'cancelled', 'customer withdrew');
    assert (select status from trips where id = t2) = 'cancelled', 'cancel works';
    perform advance_trip_status(t2, 'booked');                 -- reopen
    reset role;

    -- B cannot drive A's trip through the RPC
    perform pg_temp.become(uB); set local role authenticated;
    ok := false;
    begin perform advance_trip_status(t1, 'loaded'); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = 'P0002', 'B advancing A trip must look like not-found (got ' || coalesce(code, 'success') || ')';
    reset role;

    -- ---------- 7. role boundaries inside tenant A ----------
    insert into company_members (company_id, user_id, role) values (cA, uC, 'driver'), (cA, uD, 'dispatcher');
    update drivers set user_id = uC where id = dA;

    -- dispatcher: may create trips, may NOT create vehicles
    perform pg_temp.become(uD); set local role authenticated;
    insert into trips (company_id, origin_state, destination_state) values (cA, 'Lagos', 'Ogun') returning id into t3;
    ok := false;
    begin insert into vehicles (company_id, plate_number) values (cA, 'DSP-001AA'); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'dispatcher must not create vehicles';
    reset role;

    -- driver: sees only own assigned trips, no customers, can push own trip forward only
    perform pg_temp.become(uC); set local role authenticated;
    assert (select count(*) from trips) = 1, 'driver sees only the trip assigned to them (t1)';
    assert (select count(*) from customers) = 0, 'driver must not read customers';
    assert (select count(*) from trip_status_history) >= 1, 'driver sees history of own trip';
    perform advance_trip_status(t1, 'loaded');
    ok := false;
    begin perform advance_trip_status(t1, 'booked'); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'driver must not move a trip backwards';
    ok := false;
    begin perform advance_trip_status(t3, 'loaded'); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'driver must not touch an unassigned trip';
    ok := false;
    begin insert into trips (company_id, origin_state, destination_state) values (cA, 'Lagos', 'Oyo'); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'driver must not create trips';
    reset role;

    -- ---------- 8. last-owner protection + owner-row guard ----------
    perform pg_temp.become(uA); set local role authenticated;
    ok := false;
    begin update company_members set role = 'admin' where company_id = cA and user_id = uA; ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '23514', 'sole owner must not be demoted (got ' || coalesce(code, 'success') || ')';
    reset role;

    -- ---------- 9. soft delete, financial lock ----------
    perform pg_temp.become(uA); set local role authenticated;
    update vehicles set deleted_at = now() where id = vA;
    get diagnostics n = row_count;
    assert n = 1, 'soft delete via update works';
    reset role;
    -- Simulate what the Phase 2 billing module will do (as table owner): walk t1 through the legal stages.
    update trips set status = 'in_transit' where id = t1;
    update trips set status = 'delivered' where id = t1;
    update trips set status = 'pod_received' where id = t1;
    update trips set status = 'invoiced' where id = t1;
    perform pg_temp.become(uA); set local role authenticated;
    ok := false;
    begin update trips set freight_amount = 1 where id = t1; ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '23514', 'invoiced trips are financially locked';
    reset role;

    -- ---------- 10. audit + demo seeding ----------
    perform pg_temp.become(uA); set local role authenticated;
    assert (select count(*) from audit_log where company_id = cA) > 5, 'audit log should record activity';
    ok := false;
    begin delete from audit_log; ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'audit log must be immutable for clients';

    ok := false;
    begin perform seed_demo_data(cA); ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '22023', 'demo data refuses a non-empty company';
    cA2 := create_company('Alpha Second Co');
    assert (seed_demo_data(cA2)->>'trips')::int = 5, 'demo data seeds 5 trips';
    assert (select count(*) from trips where company_id = cA2) = 5, 'seeded trips visible';
    reset role;

    -- ---------- 11. anon sees nothing ----------
    set local role anon;
    ok := false;
    begin perform count(*) from trips; ok := true;
    exception when others then code := sqlstate; end;
    assert not ok and code = '42501', 'anon must have no access to trips';
    reset role;

    raise notice '✅ ALL RLS / PRIVILEGE TESTS PASSED';
end $$;

rollback;
