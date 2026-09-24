-- supabase/migrations/0007_reader_state_reaction.sql
-- A reader's own like (1), dislike (-1) or nothing (0) on a post or tutorial
-- lesson. Spec: docs/superpowers/specs/2026-09-24-reader-reactions-design.md
-- The own-rows RLS policies from 0005 and the updated_at trigger from 0006
-- already cover the new column, so no policy changes. Additive with a default:
-- safe to apply before the client code that reads it ships.
alter table public.reader_state
  add column reaction smallint not null default 0
  check (reaction in (-1, 0, 1));
