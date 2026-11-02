-- Phase 32 (2026-11-01, President): Red Comet photos carry one of the three Red Comet
-- courses the school offers: English, Maths, Science. "Red Comet" is not a subject.
--
-- The first teacher-app version (launched 2026-10-20) stored every workbook photo with
-- subject 'Red Comet'; the subject picker came on 2026-10-22, after that morning's
-- batch (86 photos in prod) had been sent. Those photos get their real subject from the
-- teacher's note, matched against the check-in pages the office filed that week.
-- Safe to re-run: it only touches rows still labelled 'Red Comet'.

update public.work_uploads set subject = case
    when note ilike 'math%' or note ilike '%word problem%'      then 'Maths'
    when note ilike 'english%' or note ilike '%kite%'           then 'English'
    when note ilike '%science%' or note ilike '%energy%'        then 'Science'
  end
 where subject = 'Red Comet'
   and (note ilike 'math%' or note ilike '%word problem%' or note ilike 'english%' or note ilike '%kite%'
        or note ilike '%science%' or note ilike '%energy%');

-- PROD: photos #35–#42 (one KG student, 2026-10-22) were sent without a note; the office
-- filed all eight as Maths for that week's check-in. In dev these ids are other rows, so
-- the date guard leaves them alone.
update public.work_uploads set subject = 'Maths'
 where subject = 'Red Comet' and note is null and id between 35 and 42 and taken_at = '2026-10-22';

-- anything still labelled 'Red Comet' has no known subject (none in prod after the two
-- updates above; dev test rows only): leave the subject empty ("No subject" on the page)
update public.work_uploads set subject = null where subject = 'Red Comet';

-- every row must now use one of the three courses (or no subject)
alter table public.work_uploads drop constraint if exists work_uploads_subject_check;
alter table public.work_uploads add constraint work_uploads_subject_check
  check (subject is null or subject in ('English', 'Maths', 'Science'));

-- check: subjects now in use
select subject, count(*) from public.work_uploads group by subject order by subject;
