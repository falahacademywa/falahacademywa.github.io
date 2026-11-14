-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 45: unit test pages on Red Comet photos (President 2026-11-12)
--   In the teacher app's Red Comet tab, each subject has "These photos include a unit test".
--   When it is ticked the teacher must give the unit test page number(s) (e.g. "48-51"),
--   stored here so the office knows exactly which pages are the test.
--   kind = 'test' (phase 44) stays the flag; test_pages is the new detail.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

alter table public.work_uploads add column if not exists test_pages text;

alter table public.work_uploads drop constraint if exists work_uploads_test_pages_check;
alter table public.work_uploads add constraint work_uploads_test_pages_check
  check (test_pages is null or (length(trim(test_pages)) between 1 and 40 and kind = 'test'));

-- check: should return test_pages | text
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'work_uploads' and column_name = 'test_pages';
