/*
# QueueFlow — find_user_by_email RPC

## Overview
The hospital admin dashboard needs to invite a staff member to a department
by email. The client cannot query auth.users directly (it's an internal
table). This migration creates a SECURITY DEFINER SQL function that looks
up a user by email in auth.users and returns their id. Only authenticated
users can call it, and the function is read-only.

## Function
- `find_user_by_email(p_email text)` — returns a table with one column `id uuid`.
  Looks up auth.users by email (case-insensitive via lower()).
  Returns zero rows if no user matches.

## Security
- SECURITY DEFINER so it can read auth.users (the caller cannot).
- Grant EXECUTE to authenticated only.
- Read-only: SELECT, no writes.
*/

create or replace function find_user_by_email(p_email text)
returns table (id uuid)
language sql
security definer
set search_path = auth
as $$
  select id from auth.users where lower(email) = lower(p_email);
$$;

revoke all on function find_user_by_email(text) from public, anon;
grant execute on function find_user_by_email(text) to authenticated;
