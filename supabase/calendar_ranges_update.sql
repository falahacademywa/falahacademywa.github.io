-- ================================================================
-- FALAH ACADEMY — make multi-day breaks true date ranges
-- (start through the day BEFORE school resumes). Run in prod
-- (and dev if you want parity). Re-runnable.
-- ================================================================

update public.calendar_events
set title = 'Winter Break - No School', end_date = date '2027-01-03'
where title in ('Winter Break Begins - No School', 'Winter Break - No School')
  and start_date = date '2026-12-24';

update public.calendar_events
set title = 'Eid / Spring Break - No School', end_date = date '2027-03-13'
where title in ('Eid / Spring Break Begins', 'Eid / Spring Break - No School')
  and start_date = date '2027-03-01';

update public.calendar_events
set end_date = date '2027-05-17'
where title = 'Eid al-Adha Break (Subject to Moon Sighting)'
  and start_date = date '2027-05-15';

select title, start_date, end_date from public.calendar_events
where end_date is not null order by start_date;
