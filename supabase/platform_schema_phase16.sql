-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 14: two more required document types
-- Both are collected at admission but were untracked in the portal
-- (President's request 2026-09-27). Seed data only; no schema change.
-- Run in dev AND prod. Re-runnable.
-- ================================================================
insert into public.document_types (name, sort) values
  ('Immunization Certificate (CIS)', 6),
  ('Choice Transfer Confirmation', 7)
on conflict (name) do nothing;
