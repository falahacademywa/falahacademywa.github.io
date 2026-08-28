-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 7: Guardians registry
-- Both parents are school records on every student, independent of
-- whether they ever activate a portal account. Run in dev AND prod.
-- ================================================================

create table if not exists public.guardians (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students on delete cascade,
  name text not null,
  relationship text not null default 'parent',   -- 'father' | 'mother' | 'guardian'
  phone text,
  email text,                                     -- if it matches a login, the UI shows account status
  sort int not null default 1,
  created_at timestamptz not null default now()
);

alter table public.guardians enable row level security;

drop policy if exists guard_select on public.guardians;
create policy guard_select on public.guardians for select
  using (public.is_admin() or public.is_my_child(student_id));

drop policy if exists guard_admin on public.guardians;
create policy guard_admin on public.guardians for all
  using (public.is_admin()) with check (public.is_admin());
