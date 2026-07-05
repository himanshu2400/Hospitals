/*
# QueueFlow — Unique constraint on token numbers

## Overview
Adds a unique constraint on (queue_session_id, token_number) so that two
concurrent check-ins cannot produce the same token number. The frontend
retries with the next number if an insert fails on conflict.

## Change
- `UNIQUE (queue_session_id, token_number)` on the `tokens` table.
- Idempotent: uses `DO $$ ... IF NOT EXISTS ... END $$` to avoid errors
  if the constraint already exists.

## Security
No policy changes — the constraint is a data-integrity guard, not an
access control change.
*/

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uniq_tokens_session_token_number'
      and conrelid = 'tokens'::regclass
  ) then
    alter table tokens
      add constraint uniq_tokens_session_token_number
      unique (queue_session_id, token_number);
  end if;
end $$;
