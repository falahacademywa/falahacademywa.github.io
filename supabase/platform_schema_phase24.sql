-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 24: Qur'an and academic progress dated in Pacific time
-- UTC audit 2026-10-09, TODO #118: quran_progress.assessment_date and
-- academic_progress.assessment_date defaulted to current_date, which is the
-- UTC date in Supabase, so an entry made after ~5 PM Pacific was dated
-- tomorrow. Admin -> Academics now sends the local date itself; this makes
-- the column defaults Pacific too, for any other writer.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

alter table public.quran_progress
  alter column assessment_date set default (now() at time zone 'America/Los_Angeles')::date;

alter table public.academic_progress
  alter column assessment_date set default (now() at time zone 'America/Los_Angeles')::date;

-- Check: both should show the Pacific expression
select table_name, column_default
  from information_schema.columns
 where table_schema = 'public' and column_name = 'assessment_date'
   and table_name in ('quran_progress', 'academic_progress');
