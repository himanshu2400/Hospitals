/*
# QueueFlow — Add patient age and queue session ended_at

## Overview
Two schema additions:
1. `tokens.age` — patient age (integer, nullable). Used to disambiguate
   patients with identical names. Required by the "Add patient" form on
   the department console.
2. `queue_sessions.ended_at` — timestamp marking when a queue was
   closed for the day. Set when staff click "Close queue for today".
   The session `status` is also set to 'closed' at the same time.

## Changes

### `tokens`
- New column `age integer` (nullable). Existing rows get NULL — that's
  fine, age is only required for new check-ins via the staff form.

### `queue_sessions`
- New column `ended_at timestamptz` (nullable). NULL while the queue
  is active/waiting; set to `now()` when the queue is closed.

## Security
No policy changes — the new columns are covered by existing RLS
policies (the ownership/department-staff chain is unchanged).

## Notes
1. Idempotent: uses `ADD COLUMN IF NOT EXISTS`.
2. The `status` check constraint already includes 'closed', so no
   constraint changes are needed.
3. The public queue page reads `status` and `ended_at` to show
   "Queue closed for today" when appropriate.
*/

alter table tokens
  add column if not exists age integer;

alter table queue_sessions
  add column if not exists ended_at timestamptz;
