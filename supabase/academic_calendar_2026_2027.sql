-- ================================================================
-- FALAH ACADEMY — Academic Calendar 2026-2027 (from the website ics)
-- Run in falah-platform-prod (dev already has these). Re-runnable:
-- each insert is guarded by title + start_date.
-- ================================================================

with ev(title, event_type, start_date, end_date) as (
  values
  ('First Day of School',                          'academic', date '2026-08-26', null::date),
  ('Labor Day - No School',                        'holiday',  date '2026-09-07', null),
  ('Veterans Day - No School',                     'holiday',  date '2026-11-11', null),
  ('PTA Meeting',                                  'academic', date '2026-11-18', null),
  ('Thanksgiving Break - No School',               'holiday',  date '2026-11-26', date '2026-11-27'),
  ('Winter Break Begins - No School',              'holiday',  date '2026-12-24', null),
  ('School Resumes After Winter Break',            'academic', date '2027-01-04', null),
  ('MLK Day - No School',                          'holiday',  date '2027-01-18', null),
  ('Start of Ramadan (Subject to Moon Sighting)',  'event',    date '2027-02-07', null),
  ('Eid / Spring Break Begins',                    'holiday',  date '2027-03-01', null),
  ('Spring Break Ends - School Resumes',           'academic', date '2027-03-14', null),
  ('PTA Meeting',                                  'academic', date '2027-05-06', null),
  ('Eid al-Adha Break (Subject to Moon Sighting)', 'holiday',  date '2027-05-15', null),
  ('Eid al-Adha Break Ends - School Resumes',      'academic', date '2027-05-18', null),
  ('Memorial Day - No School',                     'holiday',  date '2027-05-31', null),
  ('Last Day of School',                           'academic', date '2027-06-24', null)
)
insert into public.calendar_events (title, event_type, start_date, end_date, location)
select ev.title, ev.event_type, ev.start_date, ev.end_date, 'Al Huda Islamic Center, Kent WA'
from ev
where not exists (
  select 1 from public.calendar_events c
  where c.title = ev.title and c.start_date = ev.start_date);

select 'calendar events' as entity, count(*) from public.calendar_events;
