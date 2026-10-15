-- ============================================================
-- TMS — MIGRATION 001: multi-tenancy, roles, audit, numbering
-- Run in Supabase SQL Editor (or `supabase db push`) BEFORE 002.
--
-- Security model (same philosophy as V. Gallery):
--   * The browser holds only the PUBLIC anon key + a user JWT.
--   * Row Level Security is the real boundary. Every tenant table
--     carries company_id and is only reachable through is_member() /
--     has_role() checks.
--   * Column-level GRANTs close the gaps RLS can't: clients can never
--     write company_id on update, plan/trial columns, document numbers
--     or trip status directly.
--   * Anything that must be atomic or privileged is a SECURITY DEFINER
--     function (create_company, next_number, advance_trip_status ...).
-- ============================================================

-- ---------- enums ----------
create type member_role as enum ('owner', 'admin', 'ops_manager', 'accountant', 'dispatcher', 'driver');
create type plan_tier as enum ('starter', 'growth', 'pro', 'unlimited', 'enterprise');

-- ---------- profiles (1:1 with auth.users) ----------
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text,
    full_name text,
    phone text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ---------- companies (the tenant) ----------
create table public.companies (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(trim(name)) between 2 and 120),
    phone text,
    email text,
    address text,
    state text,
    rc_number text,                       -- CAC registration
    tin text,                             -- tax identification number
    plan plan_tier not null default 'starter',
    subscription_status text not null default 'trialing'
        check (subscription_status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
    trial_ends_at timestamptz not null default (now() + interval '7 days'),
    -- NULL = unlimited. Enforced in Phase 6 (plan limits); columns exist so billing can be added without a migration.
    max_bookings_per_month int,
    max_vehicles int,
    max_users int,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
);

-- ---------- membership ----------
create table public.company_members (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role member_role not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (company_id, user_id)
);
create index idx_company_members_user on public.company_members(user_id) where is_active;

-- ---------- gapless per-company document counters ----------
create table public.company_counters (
    company_id uuid not null references public.companies(id) on delete cascade,
    key text not null,                    -- e.g. 'waybill:2026'
    last_value int not null default 0,
    primary key (company_id, key)
);

-- ---------- audit log (append-only) ----------
create table public.audit_log (
    id bigint generated always as identity primary key,
    company_id uuid,
    table_name text not null,
    record_id uuid,
    action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
    old_data jsonb,
    new_data jsonb,
    actor uuid,
    at timestamptz not null default now()
);
create index idx_audit_company_time on public.audit_log(company_id, at desc);
create index idx_audit_record on public.audit_log(table_name, record_id);

-- ============================================================
-- HELPER FUNCTIONS
-- SECURITY DEFINER so policies on company_members can call them
-- without recursing into their own RLS.
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;

create or replace function public.is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from company_members m
        where m.company_id = p_company and m.user_id = auth.uid() and m.is_active
    );
$$;

create or replace function public.has_role(p_company uuid, p_roles member_role[])
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from company_members m
        where m.company_id = p_company and m.user_id = auth.uid() and m.is_active and m.role = any(p_roles)
    );
$$;

create or replace function public.my_role(p_company uuid)
returns member_role language sql stable security definer set search_path = public as $$
    select m.role from company_members m
    where m.company_id = p_company and m.user_id = auth.uid() and m.is_active
    limit 1;
$$;

create or replace function public.shares_company_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from company_members a
        join company_members b on b.company_id = a.company_id
        where a.user_id = auth.uid() and a.is_active and b.user_id = p_user
    );
$$;

-- ---------- new auth user -> profile ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (id, email, full_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
    on conflict (id) do nothing;
    return new;
end $$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Backfill for any users that existed before this migration.
insert into public.profiles (id, email, full_name)
select id, email, coalesce(raw_user_meta_data->>'full_name', '') from auth.users
on conflict (id) do nothing;

-- ---------- gapless numbering (per company, per year) ----------
-- Called only from trigger functions. The ON CONFLICT upsert takes a row lock,
-- so concurrent inserts for one company serialise and numbers never repeat.
-- If the surrounding insert rolls back, the counter rolls back with it (no gaps).
create or replace function public.next_number(p_company uuid, p_kind text, p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare
    v_year int := extract(year from (now() at time zone 'Africa/Lagos'))::int;
    v_key text := p_kind || ':' || v_year;
    v_n int;
begin
    insert into company_counters (company_id, key, last_value)
    values (p_company, v_key, 1)
    on conflict (company_id, key) do update set last_value = company_counters.last_value + 1
    returning last_value into v_n;
    return p_prefix || '-' || v_year || '-' || lpad(v_n::text, 5, '0');
end $$;

-- ---------- create a company + make the caller its owner ----------
create or replace function public.create_company(
    p_name text, p_phone text default null, p_state text default null, p_address text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
    v_company uuid;
begin
    if v_uid is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;
    if length(trim(coalesce(p_name, ''))) < 2 then
        raise exception 'Company name is required' using errcode = '22023';
    end if;
    -- Abuse guard: one person shouldn't spin up unlimited free trials.
    if (select count(*) from companies where created_by = v_uid) >= 3 then
        raise exception 'Company limit reached for this account' using errcode = '54000';
    end if;

    insert into companies (name, phone, state, address, created_by)
    values (trim(p_name), p_phone, p_state, p_address, v_uid)
    returning id into v_company;

    insert into company_members (company_id, user_id, role) values (v_company, v_uid, 'owner');
    return v_company;
end $$;

-- A company must always keep at least one active owner.
create or replace function public.protect_last_owner()
returns trigger language plpgsql as $$
begin
    if old.role = 'owner' and old.is_active
       and (tg_op = 'DELETE' or new.role <> 'owner' or not new.is_active) then
        if not exists (
            select 1 from company_members m
            where m.company_id = old.company_id and m.role = 'owner' and m.is_active and m.id <> old.id
        ) then
            raise exception 'A company must keep at least one active owner' using errcode = '23514';
        end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end $$;

-- ---------- generic audit trigger ----------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
    v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
    v_row jsonb := coalesce(v_new, v_old);
begin
    -- Ignore no-op updates that only touched updated_at.
    if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
        return null;
    end if;
    insert into audit_log (company_id, table_name, record_id, action, old_data, new_data, actor)
    values (
        case when tg_table_name = 'companies' then (v_row->>'id')::uuid else (v_row->>'company_id')::uuid end,
        tg_table_name, (v_row->>'id')::uuid, tg_op, v_old, v_new, auth.uid()
    );
    return null;
end $$;

-- ---------- triggers ----------
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_companies_updated before update on public.companies for each row execute function public.set_updated_at();
create trigger trg_members_updated before update on public.company_members for each row execute function public.set_updated_at();
create trigger trg_members_protect_owner before update or delete on public.company_members for each row execute function public.protect_last_owner();
create trigger trg_companies_audit after insert or update or delete on public.companies for each row execute function public.audit_row();
create trigger trg_members_audit after insert or update or delete on public.company_members for each row execute function public.audit_row();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_counters enable row level security;   -- no policies = default-deny
alter table public.audit_log enable row level security;

create policy profiles_select on public.profiles for select to authenticated
    using (id = auth.uid() or shares_company_with(id));
create policy profiles_update on public.profiles for update to authenticated
    using (id = auth.uid()) with check (id = auth.uid());

create policy companies_select on public.companies for select to authenticated
    using (is_member(id));
create policy companies_update on public.companies for update to authenticated
    using (has_role(id, array['owner', 'admin']::member_role[]))
    with check (has_role(id, array['owner', 'admin']::member_role[]));

create policy members_select on public.company_members for select to authenticated
    using (is_member(company_id));
-- Owners/admins manage the team; only an owner may touch an owner row or grant the owner role.
create policy members_update on public.company_members for update to authenticated
    using (
        has_role(company_id, array['owner', 'admin']::member_role[])
        and (role <> 'owner' or has_role(company_id, array['owner']::member_role[]))
    )
    with check (
        has_role(company_id, array['owner', 'admin']::member_role[])
        and (role <> 'owner' or has_role(company_id, array['owner']::member_role[]))
    );

create policy audit_select on public.audit_log for select to authenticated
    using (company_id is not null and has_role(company_id, array['owner', 'admin', 'accountant']::member_role[]));

-- ============================================================
-- PRIVILEGES — default-deny, then grant exactly what the app needs.
-- (Supabase grants broad table privileges by default; revoke them first.)
-- ============================================================
revoke all on public.profiles, public.companies, public.company_members, public.company_counters, public.audit_log from anon, authenticated;

grant select on public.profiles, public.companies, public.company_members, public.audit_log to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant update (name, phone, email, address, state, rc_number, tin) on public.companies to authenticated;
grant update (role, is_active) on public.company_members to authenticated;
-- No INSERT/DELETE for clients on any of these: companies via create_company(), members via the
-- invite-member Netlify Function (service role), counters/audit only via definer functions.

revoke execute on function public.next_number(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.create_company(text, text, text, text) from public, anon;
grant execute on function public.create_company(text, text, text, text) to authenticated;

select '✅ Migration 001 complete — tenancy, roles, audit log and numbering are set up.' as status;
