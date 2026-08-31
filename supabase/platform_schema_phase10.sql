-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 10: family address + profile hardening
-- 1. profiles.address — the family's home address. Parents edit it
--    themselves (My Info); admins see it on the student profile and
--    Parents pages.
-- 2. SECURITY: the phase-4 profiles_self_update policy let a parent
--    update ANY column of their own row — including role. The trigger
--    below silently reverts privileged columns unless an admin is
--    making the change.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

alter table public.profiles add column if not exists address text;

create or replace function public.trg_protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.suspended := old.suspended;
    new.email := old.email;
  end if;
  return new;
end; $$;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns before update on public.profiles
  for each row execute function public.trg_protect_profile_columns();
