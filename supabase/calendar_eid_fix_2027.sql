-- ================================================================
-- FALAH ACADEMY — Eid resume dates 2027 (TODO #55)
-- The published 2026-27 calendar PDF (authoritative) has school resuming
-- Mon 2027-03-15 after Eid/Spring Break and Wed 2027-05-19 after Eid al-Adha.
-- The portal rows (and the website .ics) ended each break one day early.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

update public.calendar_events
set end_date = date '2027-03-14'
where title = 'Eid / Spring Break - No School' and start_date = date '2027-03-01';

update public.calendar_events
set start_date = date '2027-03-15'
where title = 'Spring Break Ends - School Resumes' and start_date = date '2027-03-14';

update public.calendar_events
set end_date = date '2027-05-18'
where title = 'Eid al-Adha Break (Subject to Moon Sighting)' and start_date = date '2027-05-15';

update public.calendar_events
set start_date = date '2027-05-19'
where title = 'Eid al-Adha Break Ends - School Resumes' and start_date = date '2027-05-18';

select title, start_date, end_date from public.calendar_events
where start_date between date '2027-03-01' and date '2027-05-31' order by start_date;
