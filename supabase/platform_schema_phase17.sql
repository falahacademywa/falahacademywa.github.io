-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 17: photo / video / media consent per student
-- The signed "Photo, Video & Media Consent Form" (admission packet) only lived as
-- a PDF, so nobody posting a class photo could see that a family had opted out.
-- One row per student mirrors the form's five permissions and the name
-- preference; Admin → Student Profile shows a badge ("No public photos") and an
-- editable Media Consent panel. Parents can read their own child's row.
-- (President's request 2026-09-27, TODO #71.) Run in dev AND prod. Re-runnable.
-- ================================================================

create table if not exists public.media_consent (
  student_id      uuid primary key references public.students on delete cascade,
  -- the five boxes on the form; null = not answered
  internal_use    boolean,   -- classroom displays, student records, internal newsletters
  parent_comms    boolean,   -- class WhatsApp groups / Family Portal class updates
  website_print   boolean,   -- falahacademywa.org, brochures, flyers, banners
  social_media    boolean,   -- Facebook / Instagram / YouTube
  external_media  boolean,   -- press, partner organisations, third-party sites
  name_preference text check (name_preference in ('none', 'first_name', 'full_name')),
  signed_by       text,      -- parent/guardian who signed the form
  signed_date     date,
  notes           text,
  updated_by      uuid references public.profiles,
  updated_at      timestamptz not null default now()
);

alter table public.media_consent enable row level security;

drop policy if exists mc_select on public.media_consent;
create policy mc_select on public.media_consent for select
  using (public.is_admin() or public.is_my_child(student_id));
drop policy if exists mc_admin on public.media_consent;
create policy mc_admin on public.media_consent for all
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.media_consent to authenticated;

-- keep updated_at / updated_by honest without trusting the client
create or replace function public.media_consent_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;
drop trigger if exists media_consent_touch on public.media_consent;
create trigger media_consent_touch before insert or update on public.media_consent
  for each row execute function public.media_consent_touch();
