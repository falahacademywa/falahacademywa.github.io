-- ================================================================
-- FALAH ACADEMY — one-day closure: Thursday 2026-10-29 (President, 2026-10-21).
-- Adds the day to the portal calendar (also added to academic_calendar_2026_2027.sql,
-- calendar.html and the .ics). Run in dev AND prod. Re-runnable.
-- ================================================================
insert into public.calendar_events (title, event_type, start_date, end_date, location)
select 'School Closed - No School', 'holiday', date '2026-10-29', null, 'Al Huda Islamic Center, Kent WA'
where not exists (select 1 from public.calendar_events
                  where title = 'School Closed - No School' and start_date = date '2026-10-29');

select title, event_type, start_date from public.calendar_events
 where start_date between date '2026-10-28' and date '2026-11-12' order by start_date;
