-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 51 (President 2026-11-26): Donors
--
-- Admin → Donors: a donor list with a profile per donor (name, e-mail, phone, address, city,
-- company, designation) and their gifts: amount, pledged or donated, one-time or monthly, and
-- the method (cash, Zelle, employee matching, Fidelity, other).
--
-- PRIVATE TO FULL ADMINS. The President asked that nobody else sees it, so:
--   * row security allows full admins only (is_admin()); there are no staff policies, so a staff
--     login can never read a row, whatever permissions it is given;
--   * the portal never offers "donors" on the Staff & Permissions screen;
--   * no audit trigger: the generic audit log feeds the Activity Log report, which staff can be
--     granted, and would show donor names there. created_at / updated_at are kept on the rows.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

create table if not exists public.donors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (btrim(name) <> ''),
  email        text,
  phone        text,
  address      text,
  city         text,
  company      text,
  designation  text,
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);

create table if not exists public.donations (
  id            uuid primary key default gen_random_uuid(),
  donor_id      uuid not null references public.donors (id) on delete cascade,
  amount        numeric(12, 2) not null check (amount >= 0),
  status        text not null default 'pledged' check (status in ('pledged', 'donated')),
  frequency     text not null default 'one_time' check (frequency in ('one_time', 'monthly')),
  method        text not null default 'zelle' check (method in ('cash', 'zelle', 'employee_matching', 'fidelity', 'other')),
  method_other  text,                 -- what "other" was (check, bank transfer, ...)
  pledged_on    date,
  donated_on    date,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists donations_donor on public.donations (donor_id);

-- updated_at (helper from phase 22)
create or replace function public.trg_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists donors_touch on public.donors;
create trigger donors_touch before update on public.donors
  for each row execute function public.trg_touch_updated_at();
drop trigger if exists donations_touch on public.donations;
create trigger donations_touch before update on public.donations
  for each row execute function public.trg_touch_updated_at();

-- full admins only
alter table public.donors enable row level security;
alter table public.donations enable row level security;
drop policy if exists donors_admin on public.donors;
create policy donors_admin on public.donors for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists donations_admin on public.donations;
create policy donations_admin on public.donations for all
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.donors, public.donations from anon;
grant select, insert, update, delete on public.donors, public.donations to authenticated;
