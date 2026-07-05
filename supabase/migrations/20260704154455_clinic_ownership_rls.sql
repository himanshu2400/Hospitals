/*
# QueueFlow — Clinic Ownership & RLS Hardening

## Overview
The original migration allowed ANY authenticated user to insert/update/delete rows
on clinics, doctors, queue_sessions, and tokens (policies used `WITH CHECK (true)`
and `USING (true)`). This migration introduces clinic ownership and rewrites every
write policy with a real ownership predicate so authenticated users can only
modify clinics they own (and the child rows belonging to those clinics).

## Changes

### 1. Add `owner_id` to `clinics`
- New column `owner_id uuid` referencing `auth.users(id) ON DELETE SET NULL`.
- Defaults to `auth.uid()` so a clinic created by an authenticated staff user is
  automatically owned by them without the client passing `owner_id`.
- Backfilled: existing demo clinics get `owner_id = NULL` (no owner). They remain
  readable by everyone (SELECT policy is unchanged) but cannot be modified until
  an admin claims them. This is intentional — we do not silently assign ownership
  of pre-existing rows to an arbitrary user.

### 2. Rewrite write policies on `clinics`
- INSERT: `WITH CHECK (auth.uid() = owner_id)` — only the owner can create a
  clinic row, and the row must belong to them.
- UPDATE: `USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id)` —
  only the owner can update their clinic, and cannot reassign it to another user.
- DELETE: `USING (auth.uid() = owner_id)` — only the owner can delete their clinic.
- SELECT: unchanged (public to anon, authenticated).

### 3. Rewrite write policies on `doctors`
- All write policies scope through the parent clinic's owner:
  `EXISTS (SELECT 1 FROM clinics c WHERE c.id = doctors.clinic_id AND c.owner_id = auth.uid())`.
- This means a staff user can only add/edit/remove doctors in clinics they own.

### 4. Rewrite write policies on `queue_sessions`
- All write policies scope through the doctor's clinic owner:
  `EXISTS (SELECT 1 FROM doctors d JOIN clinics c ON c.id = d.clinic_id
   WHERE d.id = queue_sessions.doctor_id AND c.owner_id = auth.uid())`.

### 5. Rewrite write policies on `tokens`
- All write policies scope through the session's doctor's clinic owner:
  `EXISTS (SELECT 1 FROM queue_sessions qs JOIN doctors d ON d.id = qs.doctor_id
   JOIN clinics c ON c.id = d.clinic_id
   WHERE qs.id = tokens.queue_session_id AND c.owner_id = auth.uid())`.

### 6. Index on `clinics.owner_id`
- Added to speed up ownership checks.

## Security
- SELECT remains public (anon + authenticated) on all tables — patients can read
  without logging in.
- All writes now require `auth.uid()` to match the owning clinic's `owner_id`,
  enforced through the ownership chain. No more `WITH CHECK (true)` shortcuts.
- `owner_id` defaults to `auth.uid()` so client inserts that omit `owner_id`
  still satisfy the INSERT `WITH CHECK`.

## Notes
1. This migration is idempotent: `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS`
   before each `CREATE POLICY`, and `CREATE INDEX IF NOT EXISTS`.
2. Existing demo clinics have `owner_id = NULL`. To manage them via the dashboard,
   a staff user must claim them by running:
   `update clinics set owner_id = auth.uid() where slug = 'city-health';`
   (the dashboard provides a "Claim this clinic" button for this).
3. The frontend filters clinics by `owner_id = auth.uid()` so users only see and
   manage their own clinics.
*/

-- 1. Add owner_id to clinics
alter table clinics
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

-- Backfill is intentionally NOT done — existing rows stay ownerless until claimed.

-- Default owner_id to the creating user. Note: we cannot use DEFAULT auth.uid()
-- directly in ALTER TABLE ADD COLUMN for existing rows (existing rows get NULL),
-- but for NEW inserts the default applies.
alter table clinics
  alter column owner_id set default auth.uid();

create index if not exists idx_clinics_owner_id on clinics(owner_id);

-- 2. Rewrite clinics write policies
drop policy if exists "auth_insert_clinics" on clinics;
create policy "auth_insert_clinics" on clinics for insert
  to authenticated with check (auth.uid() = owner_id);

drop policy if exists "auth_update_clinics" on clinics;
create policy "auth_update_clinics" on clinics for update
  to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "auth_delete_clinics" on clinics;
create policy "auth_delete_clinics" on clinics for delete
  to authenticated using (auth.uid() = owner_id);

-- 3. Rewrite doctors write policies
drop policy if exists "auth_insert_doctors" on doctors;
create policy "auth_insert_doctors" on doctors for insert
  to authenticated
  with check (
    exists (
      select 1 from clinics c
      where c.id = doctors.clinic_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists "auth_update_doctors" on doctors;
create policy "auth_update_doctors" on doctors for update
  to authenticated
  using (
    exists (
      select 1 from clinics c
      where c.id = doctors.clinic_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from clinics c
      where c.id = doctors.clinic_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists "auth_delete_doctors" on doctors;
create policy "auth_delete_doctors" on doctors for delete
  to authenticated
  using (
    exists (
      select 1 from clinics c
      where c.id = doctors.clinic_id and c.owner_id = auth.uid()
    )
  );

-- 4. Rewrite queue_sessions write policies
drop policy if exists "auth_insert_queue_sessions" on queue_sessions;
create policy "auth_insert_queue_sessions" on queue_sessions for insert
  to authenticated
  with check (
    exists (
      select 1 from doctors d
      join clinics c on c.id = d.clinic_id
      where d.id = queue_sessions.doctor_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists "auth_update_queue_sessions" on queue_sessions;
create policy "auth_update_queue_sessions" on queue_sessions for update
  to authenticated
  using (
    exists (
      select 1 from doctors d
      join clinics c on c.id = d.clinic_id
      where d.id = queue_sessions.doctor_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from doctors d
      join clinics c on c.id = d.clinic_id
      where d.id = queue_sessions.doctor_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists "auth_delete_queue_sessions" on queue_sessions;
create policy "auth_delete_queue_sessions" on queue_sessions for delete
  to authenticated
  using (
    exists (
      select 1 from doctors d
      join clinics c on c.id = d.clinic_id
      where d.id = queue_sessions.doctor_id and c.owner_id = auth.uid()
    )
  );

-- 5. Rewrite tokens write policies
drop policy if exists "auth_insert_tokens" on tokens;
create policy "auth_insert_tokens" on tokens for insert
  to authenticated
  with check (
    exists (
      select 1 from queue_sessions qs
      join doctors d on d.id = qs.doctor_id
      join clinics c on c.id = d.clinic_id
      where qs.id = tokens.queue_session_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists "auth_update_tokens" on tokens;
create policy "auth_update_tokens" on tokens for update
  to authenticated
  using (
    exists (
      select 1 from queue_sessions qs
      join doctors d on d.id = qs.doctor_id
      join clinics c on c.id = d.clinic_id
      where qs.id = tokens.queue_session_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from queue_sessions qs
      join doctors d on d.id = qs.doctor_id
      join clinics c on c.id = d.clinic_id
      where qs.id = tokens.queue_session_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists "auth_delete_tokens" on tokens;
create policy "auth_delete_tokens" on tokens for delete
  to authenticated
  using (
    exists (
      select 1 from queue_sessions qs
      join doctors d on d.id = qs.doctor_id
      join clinics c on c.id = d.clinic_id
      where qs.id = tokens.queue_session_id and c.owner_id = auth.uid()
    )
  );
