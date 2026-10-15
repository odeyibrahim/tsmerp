-- ============================================================
-- TMS — MIGRATION 002: customers, drivers, vehicles, trips
-- Run AFTER 001.
--
-- Design notes
--  * vehicle_type already includes 'bus' and vehicles carry seat_capacity,
--    so the passenger-travel vertical can be added later without reshaping
--    the fleet. Nothing passenger-specific is built here.
--  * Vehicles are 'own' or 'attached' (an owner-operator's truck working
--    under this company). Per-trip broker commission lives on the trip.
--  * Cross-tenant references are impossible: trips reference customers/
--    vehicles/drivers through COMPOSITE foreign keys (id, company_id).
--  * Soft deletes: deleted_at. RLS deliberately does NOT hide soft-deleted
--    rows (a policy that hides a row from SELECT breaks the UPDATE that
--    deletes it); the app filters deleted_at IS NULL.
--  * trips.status / booking_no / waybill_no are NOT writable by clients.
--    Status changes go through advance_trip_status(); numbers come from a
--    BEFORE INSERT trigger.
-- ============================================================

create type vehicle_type as enum ('truck', 'trailer', 'tanker', 'van', 'bus', 'motorcycle');
create type vehicle_ownership as enum ('own', 'attached');
create type vehicle_status as enum ('active', 'maintenance', 'inactive');
create type driver_status as enum ('active', 'suspended', 'inactive');
create type customer_type as enum ('business', 'individual', 'corporate');
create type trip_status as enum ('booked', 'loaded', 'in_transit', 'delivered', 'pod_received', 'invoiced', 'paid', 'cancelled');

-- ---------- customers ----------
create table public.customers (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    name text not null check (length(trim(name)) between 1 and 200),
    customer_type customer_type not null default 'business',
    contact_person text,
    phone text,
    email text,
    address text,
    state text,
    credit_terms_days int not null default 0 check (credit_terms_days between 0 and 365),
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (id, company_id)
);
create index idx_customers_company on public.customers(company_id) where deleted_at is null;

-- ---------- drivers ----------
create table public.drivers (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    full_name text not null check (length(trim(full_name)) between 1 and 200),
    phone text,
    licence_number text,
    licence_expiry date,
    address text,
    status driver_status not null default 'active',
    user_id uuid references auth.users(id) on delete set null,   -- linked login (driver PWA); set by the invite function only
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (id, company_id)
);
create index idx_drivers_company on public.drivers(company_id) where deleted_at is null;
create index idx_drivers_user on public.drivers(user_id) where user_id is not null;
create unique index uq_drivers_licence on public.drivers(company_id, upper(licence_number))
    where licence_number is not null and deleted_at is null;

-- ---------- vehicles ----------
create table public.vehicles (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    plate_number text not null check (length(trim(plate_number)) between 3 and 20),
    vehicle_type vehicle_type not null default 'truck',
    make text,
    model text,
    year int check (year between 1950 and 2100),
    tonnage numeric(8,2) check (tonnage >= 0),
    seat_capacity int check (seat_capacity >= 0),         -- buses (passenger vertical, later)
    chassis_number text,
    state_registered text,
    ownership vehicle_ownership not null default 'own',
    owner_name text,                                      -- attached vehicles: who owns the truck
    owner_phone text,
    default_commission_pct numeric(5,2) check (default_commission_pct between 0 and 100),
    status vehicle_status not null default 'active',
    odometer_km int check (odometer_km >= 0),
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (id, company_id),
    constraint attached_needs_owner check (ownership = 'own' or length(trim(coalesce(owner_name, ''))) > 0)
);
create index idx_vehicles_company on public.vehicles(company_id) where deleted_at is null;
create unique index uq_vehicles_plate on public.vehicles(company_id, plate_number) where deleted_at is null;

create or replace function public.vehicles_normalize()
returns trigger language plpgsql as $$
begin
    new.plate_number := upper(regexp_replace(trim(new.plate_number), '\s+', ' ', 'g'));
    new.updated_at := now();
    return new;
end $$;

-- ---------- trips ----------
create table public.trips (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    booking_no text not null,
    waybill_no text not null,
    status trip_status not null default 'booked',

    customer_id uuid,
    vehicle_id uuid,
    driver_id uuid,

    consignee_name text,
    consignee_phone text,
    origin_state text not null,
    origin_address text,
    destination_state text not null,
    destination_address text,
    cargo_description text,
    cargo_weight_tonnes numeric(10,2) check (cargo_weight_tonnes >= 0),
    pickup_date date,
    expected_delivery_date date,

    freight_amount numeric(14,2) not null default 0 check (freight_amount >= 0),
    advance_paid numeric(14,2) not null default 0 check (advance_paid >= 0),
    currency text not null default 'NGN' check (currency in ('NGN', 'USD')),
    broker_name text,
    broker_commission_amount numeric(14,2) not null default 0 check (broker_commission_amount >= 0),

    notes text,
    tracking_token text not null unique default replace(gen_random_uuid()::text, '-', ''),   -- customer tracking link (Phase 5)
    created_by uuid references auth.users(id) default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,

    unique (company_id, booking_no),
    unique (company_id, waybill_no),
    unique (id, company_id),
    constraint advance_not_above_freight check (advance_paid <= freight_amount),
    constraint commission_not_above_freight check (broker_commission_amount <= freight_amount),
    foreign key (customer_id, company_id) references public.customers(id, company_id),
    foreign key (vehicle_id, company_id) references public.vehicles(id, company_id),
    foreign key (driver_id, company_id) references public.drivers(id, company_id)
);
create index idx_trips_company_status on public.trips(company_id, status) where deleted_at is null;
create index idx_trips_company_created on public.trips(company_id, created_at desc);
create index idx_trips_driver on public.trips(company_id, driver_id);
create index idx_trips_vehicle on public.trips(company_id, vehicle_id);
create index idx_trips_customer on public.trips(company_id, customer_id);

create table public.trip_status_history (
    id bigint generated always as identity primary key,
    company_id uuid not null,
    trip_id uuid not null,
    from_status trip_status,
    to_status trip_status not null,
    note text,
    changed_by uuid,
    changed_at timestamptz not null default now(),
    foreign key (trip_id, company_id) references public.trips(id, company_id) on delete cascade
);
create index idx_trip_history_trip on public.trip_status_history(trip_id, changed_at);

-- ============================================================
-- LIFECYCLE
-- Booked → Loaded → In transit → Delivered → POD received → Invoiced → Paid
-- Cancel from any pre-invoice state; step back one stage before billing;
-- re-open a cancelled trip as Booked. (Mirrored in public/js/lib/lifecycle.js)
-- ============================================================
create or replace function public.trip_status_rank(s trip_status)
returns int language sql immutable as $$
    select case s
        when 'booked' then 1 when 'loaded' then 2 when 'in_transit' then 3 when 'delivered' then 4
        when 'pod_received' then 5 when 'invoiced' then 6 when 'paid' then 7
        else null end;
$$;

create or replace function public.trip_transition_allowed(f trip_status, t trip_status)
returns boolean language sql immutable as $$
    select case
        when f = t then false
        when t = 'cancelled' then f in ('booked', 'loaded', 'in_transit', 'delivered', 'pod_received')
        when f = 'cancelled' then t = 'booked'
        when trip_status_rank(t) = trip_status_rank(f) + 1 then true
        when trip_status_rank(t) = trip_status_rank(f) - 1 then f in ('loaded', 'in_transit', 'delivered', 'pod_received')
        else false
    end;
$$;

-- Numbering: runs as definer because next_number() is not executable by clients.
create or replace function public.trips_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if new.booking_no is null or new.booking_no = '' then new.booking_no := next_number(new.company_id, 'booking', 'BK'); end if;
    if new.waybill_no is null or new.waybill_no = '' then new.waybill_no := next_number(new.company_id, 'waybill', 'WB'); end if;
    return new;
end $$;
-- booking_no/waybill_no are NOT NULL, so the trigger must run before the constraint check;
-- give the columns a sentinel default so clients don't need to send them (they can't: no INSERT grant on them).
alter table public.trips alter column booking_no set default '';
alter table public.trips alter column waybill_no set default '';

create or replace function public.trips_before_update()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    if new.status is distinct from old.status then
        if not trip_transition_allowed(old.status, new.status) then
            raise exception 'Invalid trip status change: % -> %', old.status, new.status using errcode = '23514';
        end if;
    elsif old.status in ('invoiced', 'paid', 'cancelled') and (
        new.freight_amount <> old.freight_amount or new.advance_paid <> old.advance_paid
        or new.broker_commission_amount <> old.broker_commission_amount
        or new.customer_id is distinct from old.customer_id
    ) then
        raise exception 'Financial details are locked once a trip is %', old.status using errcode = '23514';
    end if;
    return new;
end $$;

create or replace function public.trips_log_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        insert into trip_status_history (company_id, trip_id, from_status, to_status, changed_by)
        values (new.company_id, new.id, null, new.status, auth.uid());
    elsif new.status is distinct from old.status then
        insert into trip_status_history (company_id, trip_id, from_status, to_status, note, changed_by)
        values (new.company_id, new.id, old.status, new.status, nullif(current_setting('app.status_note', true), ''), auth.uid());
    end if;
    return null;
end $$;

-- Driver id of the logged-in user within a company (for driver-only visibility).
create or replace function public.my_driver_id(p_company uuid)
returns uuid language sql stable security definer set search_path = public as $$
    select d.id from drivers d
    where d.company_id = p_company and d.user_id = auth.uid() and d.deleted_at is null
    limit 1;
$$;

-- ---------- triggers ----------
create trigger trg_customers_updated before update on public.customers for each row execute function public.set_updated_at();
create trigger trg_drivers_updated before update on public.drivers for each row execute function public.set_updated_at();
create trigger trg_vehicles_normalize before insert or update on public.vehicles for each row execute function public.vehicles_normalize();
create trigger trg_trips_before_insert before insert on public.trips for each row execute function public.trips_before_insert();
create trigger trg_trips_before_update before update on public.trips for each row execute function public.trips_before_update();
create trigger trg_trips_log_status after insert or update on public.trips for each row execute function public.trips_log_status();

create trigger trg_customers_audit after insert or update or delete on public.customers for each row execute function public.audit_row();
create trigger trg_drivers_audit after insert or update or delete on public.drivers for each row execute function public.audit_row();
create trigger trg_vehicles_audit after insert or update or delete on public.vehicles for each row execute function public.audit_row();
create trigger trg_trips_audit after insert or update or delete on public.trips for each row execute function public.audit_row();

-- ============================================================
-- advance_trip_status — the ONLY way a client changes trip status.
-- Dispatch roles may move any trip; a driver may only push THEIR OWN
-- trip forward (booked→loaded→in_transit→delivered). Invoiced/Paid are
-- reserved for the billing module (Phase 2).
-- ============================================================
create or replace function public.advance_trip_status(p_trip_id uuid, p_to trip_status, p_note text default null)
returns public.trips language plpgsql security definer set search_path = public as $$
declare
    v_trip trips;
    v_row trips;
    v_role member_role;
begin
    if auth.uid() is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    select * into v_trip from trips where id = p_trip_id for update;
    if not found then
        raise exception 'Trip not found' using errcode = 'P0002';
    end if;

    v_role := my_role(v_trip.company_id);
    if v_role is null then
        raise exception 'Trip not found' using errcode = 'P0002';   -- don't reveal other tenants' trips
    end if;

    if p_to in ('invoiced', 'paid') then
        raise exception 'Invoiced and Paid are set by the billing module' using errcode = '22023';
    end if;

    if v_role = 'driver' then
        if v_trip.driver_id is null or v_trip.driver_id is distinct from my_driver_id(v_trip.company_id) then
            raise exception 'This trip is not assigned to you' using errcode = '42501';
        end if;
        if not (
            (v_trip.status = 'booked' and p_to = 'loaded')
            or (v_trip.status = 'loaded' and p_to = 'in_transit')
            or (v_trip.status = 'in_transit' and p_to = 'delivered')
        ) then
            raise exception 'Drivers can only move their trip forward' using errcode = '42501';
        end if;
    elsif v_role not in ('owner', 'admin', 'ops_manager', 'dispatcher') then
        raise exception 'You do not have permission to change trip status' using errcode = '42501';
    end if;

    perform set_config('app.status_note', coalesce(p_note, ''), true);
    update trips set status = p_to where id = p_trip_id returning * into v_row;
    perform set_config('app.status_note', '', true);
    return v_row;
end $$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.customers enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_status_history enable row level security;

-- customers: office roles only (a driver has no business reading the customer book)
create policy customers_select on public.customers for select to authenticated
    using (has_role(company_id, array['owner', 'admin', 'ops_manager', 'accountant', 'dispatcher']::member_role[]));
create policy customers_insert on public.customers for insert to authenticated
    with check (has_role(company_id, array['owner', 'admin', 'ops_manager', 'accountant', 'dispatcher']::member_role[]));
create policy customers_update on public.customers for update to authenticated
    using (has_role(company_id, array['owner', 'admin', 'ops_manager', 'accountant', 'dispatcher']::member_role[]))
    with check (has_role(company_id, array['owner', 'admin', 'ops_manager', 'accountant', 'dispatcher']::member_role[]));

-- drivers: office roles see all; a driver sees only their own row
create policy drivers_select on public.drivers for select to authenticated
    using (
        has_role(company_id, array['owner', 'admin', 'ops_manager', 'accountant', 'dispatcher']::member_role[])
        or user_id = auth.uid()
    );
create policy drivers_insert on public.drivers for insert to authenticated
    with check (has_role(company_id, array['owner', 'admin', 'ops_manager']::member_role[]));
create policy drivers_update on public.drivers for update to authenticated
    using (has_role(company_id, array['owner', 'admin', 'ops_manager']::member_role[]))
    with check (has_role(company_id, array['owner', 'admin', 'ops_manager']::member_role[]));

-- vehicles: any member may look; fleet roles write
create policy vehicles_select on public.vehicles for select to authenticated
    using (is_member(company_id));
create policy vehicles_insert on public.vehicles for insert to authenticated
    with check (has_role(company_id, array['owner', 'admin', 'ops_manager']::member_role[]));
create policy vehicles_update on public.vehicles for update to authenticated
    using (has_role(company_id, array['owner', 'admin', 'ops_manager']::member_role[]))
    with check (has_role(company_id, array['owner', 'admin', 'ops_manager']::member_role[]));

-- trips: office roles see all; a driver sees only trips assigned to them
create policy trips_select on public.trips for select to authenticated
    using (
        has_role(company_id, array['owner', 'admin', 'ops_manager', 'accountant', 'dispatcher']::member_role[])
        or (driver_id is not null and driver_id = my_driver_id(company_id))
    );
create policy trips_insert on public.trips for insert to authenticated
    with check (has_role(company_id, array['owner', 'admin', 'ops_manager', 'dispatcher']::member_role[]));
create policy trips_update on public.trips for update to authenticated
    using (has_role(company_id, array['owner', 'admin', 'ops_manager', 'dispatcher']::member_role[]))
    with check (has_role(company_id, array['owner', 'admin', 'ops_manager', 'dispatcher']::member_role[]));

-- history is visible exactly when its trip is (the subquery is itself filtered by trips RLS)
create policy trip_history_select on public.trip_status_history for select to authenticated
    using (exists (select 1 from public.trips t where t.id = trip_status_history.trip_id));

-- ============================================================
-- PRIVILEGES (column-level — see header notes in 001)
-- ============================================================
revoke all on public.customers, public.drivers, public.vehicles, public.trips, public.trip_status_history from anon, authenticated;
grant select on public.customers, public.drivers, public.vehicles, public.trips, public.trip_status_history to authenticated;

grant insert (company_id, name, customer_type, contact_person, phone, email, address, state, credit_terms_days, notes)
    on public.customers to authenticated;
grant update (name, customer_type, contact_person, phone, email, address, state, credit_terms_days, notes, deleted_at)
    on public.customers to authenticated;

grant insert (company_id, full_name, phone, licence_number, licence_expiry, address, status, notes)
    on public.drivers to authenticated;
grant update (full_name, phone, licence_number, licence_expiry, address, status, notes, deleted_at)
    on public.drivers to authenticated;

grant insert (company_id, plate_number, vehicle_type, make, model, year, tonnage, seat_capacity, chassis_number, state_registered,
              ownership, owner_name, owner_phone, default_commission_pct, status, odometer_km, notes)
    on public.vehicles to authenticated;
grant update (plate_number, vehicle_type, make, model, year, tonnage, seat_capacity, chassis_number, state_registered,
              ownership, owner_name, owner_phone, default_commission_pct, status, odometer_km, notes, deleted_at)
    on public.vehicles to authenticated;

grant insert (company_id, customer_id, vehicle_id, driver_id, consignee_name, consignee_phone,
              origin_state, origin_address, destination_state, destination_address, cargo_description, cargo_weight_tonnes,
              pickup_date, expected_delivery_date, freight_amount, advance_paid, currency, broker_name, broker_commission_amount, notes)
    on public.trips to authenticated;
grant update (customer_id, vehicle_id, driver_id, consignee_name, consignee_phone,
              origin_state, origin_address, destination_state, destination_address, cargo_description, cargo_weight_tonnes,
              pickup_date, expected_delivery_date, freight_amount, advance_paid, currency, broker_name, broker_commission_amount, notes, deleted_at)
    on public.trips to authenticated;

revoke execute on function public.advance_trip_status(uuid, trip_status, text) from public, anon;
grant execute on function public.advance_trip_status(uuid, trip_status, text) to authenticated;

-- ============================================================
-- DEMO DATA — callable by an owner/admin on an EMPTY company.
-- (Avoids seeding auth.users in SQL; run from the dashboard button.)
-- ============================================================
create or replace function public.seed_demo_data(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    r record;
    tmp uuid;
    c uuid[] := '{}'; v uuid[] := '{}'; d uuid[] := '{}';
begin
    if auth.uid() is null or not has_role(p_company, array['owner', 'admin']::member_role[]) then
        raise exception 'Only an owner or admin can load demo data' using errcode = '42501';
    end if;
    if exists (select 1 from trips where company_id = p_company)
       or exists (select 1 from vehicles where company_id = p_company and deleted_at is null) then
        raise exception 'Demo data can only be loaded into an empty company' using errcode = '22023';
    end if;

    for r in select * from jsonb_to_recordset('[
        {"name":"Adebayo & Sons Distribution","type":"business","contact":"Mr Adebayo","phone":"+2348031110001","state":"Lagos","terms":14},
        {"name":"Kano Grains Ltd","type":"business","contact":"Alhaji Sani","phone":"+2348051110002","state":"Kano","terms":30},
        {"name":"Eze Building Materials","type":"business","contact":"Mrs Eze","phone":"+2348071110003","state":"Anambra","terms":7},
        {"name":"Apapa Freight Services","type":"corporate","contact":"Operations desk","phone":"+2348091110004","state":"Lagos","terms":30}
    ]'::jsonb) as x(name text, type customer_type, contact text, phone text, state text, terms int) loop
        insert into customers (company_id, name, customer_type, contact_person, phone, state, credit_terms_days)
        values (p_company, r.name, r.type, r.contact, r.phone, r.state, r.terms) returning id into tmp;
        c := array_append(c, tmp);
    end loop;

    for r in select * from jsonb_to_recordset('[
        {"plate":"LSR-412AA","type":"truck","make":"Mack","model":"CH613","year":2016,"tonnage":30,"own":"own","owner":null,"state":"Lagos"},
        {"plate":"KTU-905BD","type":"trailer","make":"DAF","model":"XF105","year":2018,"tonnage":40,"own":"own","owner":null,"state":"Lagos"},
        {"plate":"ABJ-118KM","type":"truck","make":"Iveco","model":"Eurocargo","year":2014,"tonnage":15,"own":"own","owner":null,"state":"FCT (Abuja)"},
        {"plate":"EPE-336GH","type":"tanker","make":"Man","model":"TGA","year":2012,"tonnage":33,"own":"attached","owner":"Alhaji Bello","state":"Kano"},
        {"plate":"BDG-770RT","type":"van","make":"Toyota","model":"Hiace","year":2020,"tonnage":1.5,"own":"own","owner":null,"state":"Lagos"}
    ]'::jsonb) as x(plate text, type vehicle_type, make text, model text, year int, tonnage numeric, own vehicle_ownership, owner text, state text) loop
        insert into vehicles (company_id, plate_number, vehicle_type, make, model, year, tonnage, ownership, owner_name, default_commission_pct, state_registered)
        values (p_company, r.plate, r.type, r.make, r.model, r.year, r.tonnage, r.own, r.owner, case when r.own = 'attached' then 10 else null end, r.state)
        returning id into tmp;
        v := array_append(v, tmp);
    end loop;

    for r in select * from jsonb_to_recordset('[
        {"name":"Musa Ibrahim","phone":"+2348021230001","lic":"LAG-A12345","days":400},
        {"name":"Chinedu Okafor","phone":"+2348021230002","lic":"LAG-B23456","days":20},
        {"name":"Tunde Adeyemi","phone":"+2348021230003","lic":"OYO-C34567","days":200},
        {"name":"Emeka Nwosu","phone":"+2348021230004","lic":"ANA-D45678","days":600}
    ]'::jsonb) as x(name text, phone text, lic text, days int) loop
        insert into drivers (company_id, full_name, phone, licence_number, licence_expiry)
        values (p_company, r.name, r.phone, r.lic, current_date + r.days) returning id into tmp;
        d := array_append(d, tmp);
    end loop;

    for r in select * from jsonb_to_recordset('[
        {"ci":1,"vi":1,"di":1,"os":"Lagos","ds":"Oyo","cargo":"Bagged cement","t":28,"f":420000,"a":150000,"st":"paid","ago":21},
        {"ci":2,"vi":2,"di":2,"os":"Kano","ds":"Lagos","cargo":"Sorghum (50kg bags)","t":38,"f":950000,"a":300000,"st":"pod_received","ago":9},
        {"ci":3,"vi":3,"di":3,"os":"Lagos","ds":"Anambra","cargo":"Roofing sheets","t":14,"f":610000,"a":200000,"st":"in_transit","ago":3},
        {"ci":4,"vi":4,"di":4,"os":"Lagos","ds":"Kano","cargo":"Containerised goods","t":32,"f":1250000,"a":400000,"st":"loaded","ago":1,"broker":"Alhaji Bello","comm":125000},
        {"ci":1,"vi":5,"di":1,"os":"Lagos","ds":"Ogun","cargo":"Beverage crates","t":1.4,"f":85000,"a":0,"st":"booked","ago":0}
    ]'::jsonb) as x(ci int, vi int, di int, os text, ds text, cargo text, t numeric, f numeric, a numeric, st trip_status, ago int, broker text, comm numeric) loop
        insert into trips (company_id, customer_id, vehicle_id, driver_id, origin_state, destination_state, cargo_description,
                           cargo_weight_tonnes, freight_amount, advance_paid, status, pickup_date, expected_delivery_date,
                           broker_name, broker_commission_amount)
        values (p_company, c[r.ci], v[r.vi], d[r.di], r.os, r.ds, r.cargo, r.t, r.f, r.a, r.st,
                current_date - r.ago, current_date - r.ago + 3, r.broker, coalesce(r.comm, 0));
    end loop;

    return jsonb_build_object('customers', cardinality(c), 'vehicles', cardinality(v), 'drivers', cardinality(d), 'trips', 5);
end $$;

revoke execute on function public.seed_demo_data(uuid) from public, anon;
grant execute on function public.seed_demo_data(uuid) to authenticated;

select '✅ Migration 002 complete — customers, drivers, vehicles, trips and the status lifecycle are set up.' as status;
