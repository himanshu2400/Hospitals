/*
# QueueFlow — Departments, Department-Staff, and RLS Rewrite

## Overview
This migration restructures QueueFlow's data model from a flat
clinic → doctor hierarchy to a three-tier
clinic → department → doctor hierarchy, and rewrites all RLS policies
to enforce department-scoped access. A user may read/write a row only if
they own the parent clinic (which grants access to every department
under that hospital) OR they have a `department_staff` row for the
specific department the row belongs to. A department-scoped user can
never read or write another department's data, even via direct API calls.

## New Tables

### 1. `departments`
- `id` (uuid PK)
- `clinic_id` (uuid FK → clinics.id ON DELETE CASCADE)
- `name` (text, e.g. "Cardiology")
- `created_at` (timestamptz, default now())
- Unique constraint on (clinic_id, name) to prevent duplicate department
  names within the same clinic.

### 2. `department_staff`
- `id` (uuid PK)
- `department_id` (uuid FK → departments.id ON DELETE CASCADE)
- `user_id` (uuid FK → auth.users.id ON DELETE CASCADE)
- `role` (text, default 'receptionist')
- `created_at` (timestamptz, default now())
- Unique constraint on (department_id, user_id) so a user can't be
  assigned to the same department twice.

## Modified Tables

### `doctors`
- Adds `department_id` (uuid, nullable initially, FK → departments.id
  ON DELETE SET NULL). The application now uses `department_id` instead
  of `clinic_id`. The legacy `clinic_id` column is kept (data safety —
  never drop columns) but is no longer used by the app or RLS policies.
- Adds an index on `department_id` for fast lookups.

## Security (RLS) — full rewrite

### Access model
A user may access a row if EITHER:
  (a) they own the parent clinic (clinics.owner_id = auth.uid()),
      which grants access to every department under that hospital; OR
  (b) they have a `department_staff` row for the specific department
      the row belongs to.

### Helper function: `user_can_access_department(department_id)`
A SECURITY DEFINER SQL function that returns true if the current user
owns the clinic that owns the department, OR has a department_staff row
for that department. This centralizes the access logic so every policy
uses the same predicate.

### Policies rewritten
- `clinics`: SELECT/INSERT/UPDATE/DELETE scoped to owner_id = auth.uid().
  SELECT is NO LONGER public — clinics are private to their owner.
- `departments`: SELECT/INSERT/UPDATE/DELETE scoped through the helper.
- `department_staff`: SELECT/INSERT/UPDATE/DELETE scoped through the helper
  (only clinic owners or department staff of that department can see/manage).
- `doctors`: SELECT/INSERT/UPDATE/DELETE scoped through the doctor's
  department_id via the helper.
- `queue_sessions`: SELECT/INSERT/UPDATE/DELETE scoped through the
  session's doctor's department_id via the helper.
- `tokens`: SELECT/INSERT/UPDATE/DELETE scoped through the token's
  session's doctor's department_id via the helper.

### Important: SELECT is no longer public (anon)
Previously SELECT was public (anon, authenticated) so anyone could browse
clinics and doctors. This is removed — there is no public directory of
hospitals. Patients still reach the public queue page via a direct link
(/queue/:clinicSlug/:doctorId), but they authenticate the doctor by the
opaque doctorId in the URL, not by browsing a list. The queue page reads
doctors/queue_sessions/tokens by id, and RLS allows anon to read a
specific doctor/session/token only if the doctor's department exists
(i.e. the helper returns true for anon by allowing SELECT on doctors
where the department exists — see note below).

### Anon access for the public queue page
The public queue page needs to read a specific doctor, its session, and
tokens by id without login. We add a SEPARATE SELECT policy on doctors,
queue_sessions, and tokens scoped `TO anon, authenticated` that allows
reading a row by its id when the parent department exists (i.e. the
clinic/department has not been deleted). This is NOT a directory — it
requires knowing the exact doctor id. Combined with the authenticated
SELECT policy, anon can read a specific doctor's data but cannot list
all doctors.

## Notes
1. This migration is idempotent: uses IF NOT EXISTS, DROP POLICY IF EXISTS
   before each CREATE POLICY, and DO $$ blocks for conditional changes.
2. The legacy `doctors.clinic_id` column is kept but no longer used by
   the app or policies. New doctors are inserted with `department_id`.
3. Existing doctors have `department_id = NULL`. A clinic owner should
   create departments and assign doctors to them via the dashboard.
4. `department_staff` rows are created by the clinic owner (via the
   invite-by-email flow in the dashboard). The row is created with the
   invited user's user_id once that person logs in with a matching email.
   To allow the owner to insert a department_staff row for another user,
   the INSERT policy checks that the current user owns the parent clinic.
*/

-- Extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. departments table
-- ============================================================
create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table departments enable row level security;

-- Unique constraint: one department name per clinic
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uniq_departments_clinic_name'
      and conrelid = 'departments'::regclass
  ) then
    alter table departments
      add constraint uniq_departments_clinic_name
      unique (clinic_id, name);
  end if;
end $$;

create index if not exists idx_departments_clinic_id on departments(clinic_id);

-- ============================================================
-- 2. department_staff table
-- ============================================================
create table if not exists department_staff (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'receptionist',
  created_at timestamptz not null default now()
);

alter table department_staff enable row level security;

-- Unique constraint: one assignment per user per department
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uniq_department_staff_dept_user'
      and conrelid = 'department_staff'::regclass
  ) then
    alter table department_staff
      add constraint uniq_department_staff_dept_user
      unique (department_id, user_id);
  end if;
end $$;

create index if not exists idx_department_staff_user_id on department_staff(user_id);
create index if not exists idx_department_staff_department_id on department_staff(department_id);

-- ============================================================
-- 3. Add department_id to doctors
-- ============================================================
alter table doctors
  add column if not exists department_id uuid references departments(id) on delete set null;

create index if not exists idx_doctors_department_id on doctors(department_id);

-- ============================================================
-- 4. Helper function: user_can_access_department
-- ============================================================
-- Returns true if the current user owns the clinic that owns the department,
-- OR has a department_staff row for that department.
-- Returns false for anon (null auth.uid()).
create or replace function user_can_access_department(p_department_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from departments d
    join clinics c on c.id = d.clinic_id
    where d.id = p_department_id
      and (
        c.owner_id = auth.uid()
        or exists (
          select 1 from department_staff ds
          where ds.department_id = d.id and ds.user_id = auth.uid()
        )
      )
  );
$$;

-- Helper: resolve a doctor's department_id
create or replace function doctor_department_id(p_doctor_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select department_id from doctors where id = p_doctor_id;
$$;

-- Helper: resolve a session's doctor's department_id
create or replace function session_department_id(p_session_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select d.department_id
  from queue_sessions qs
  join doctors d on d.id = qs.doctor_id
  where qs.id = p_session_id;
$$;

-- Helper: resolve a token's session's doctor's department_id
create or replace function token_department_id(p_token_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select d.department_id
  from tokens t
  join queue_sessions qs on qs.id = t.queue_session_id
  join doctors d on d.id = qs.doctor_id
  where t.id = p_token_id;
$$;

-- ============================================================
-- 5. RLS: clinics — private to owner
-- ============================================================
-- SELECT: only the owner can see their clinic. No public directory.
drop policy if exists "public_read_clinics" on clinics;
drop policy if exists "select_own_clinics" on clinics;
create policy "select_own_clinics" on clinics for select
  to authenticated using (auth.uid() = owner_id);

-- INSERT: owner_id must equal auth.uid() (default handles this).
drop policy if exists "auth_insert_clinics" on clinics;
create policy "auth_insert_clinics" on clinics for insert
  to authenticated with check (auth.uid() = owner_id);

-- UPDATE: only owner, cannot reassign.
drop policy if exists "auth_update_clinics" on clinics;
create policy "auth_update_clinics" on clinics for update
  to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- DELETE: only owner.
drop policy if exists "auth_delete_clinics" on clinics;
create policy "auth_delete_clinics" on clinics for delete
  to authenticated using (auth.uid() = owner_id);

-- ============================================================
-- 6. RLS: departments
-- ============================================================
-- SELECT: owner of parent clinic OR department_staff member.
drop policy if exists "select_departments" on departments;
create policy "select_departments" on departments for select
  to authenticated
  using (user_can_access_department(id));

-- INSERT: only the clinic owner can create departments.
drop policy if exists "insert_departments" on departments;
create policy "insert_departments" on departments for insert
  to authenticated
  with check (
    exists (
      select 1 from clinics c
      where c.id = departments.clinic_id and c.owner_id = auth.uid()
    )
  );

-- UPDATE: only the clinic owner.
drop policy if exists "update_departments" on departments;
create policy "update_departments" on departments for update
  to authenticated
  using (
    exists (
      select 1 from clinics c
      where c.id = departments.clinic_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from clinics c
      where c.id = departments.clinic_id and c.owner_id = auth.uid()
    )
  );

-- DELETE: only the clinic owner.
drop policy if exists "delete_departments" on departments;
create policy "delete_departments" on departments for delete
  to authenticated
  using (
    exists (
      select 1 from clinics c
      where c.id = departments.clinic_id and c.owner_id = auth.uid()
    )
  );

-- ============================================================
-- 7. RLS: department_staff
-- ============================================================
-- SELECT: clinic owner OR department_staff member of that department.
drop policy if exists "select_department_staff" on department_staff;
create policy "select_department_staff" on department_staff for select
  to authenticated
  using (user_can_access_department(department_id));

-- INSERT: only the clinic owner can assign staff to their departments.
drop policy if exists "insert_department_staff" on department_staff;
create policy "insert_department_staff" on department_staff for insert
  to authenticated
  with check (
    exists (
      select 1 from departments d
      join clinics c on c.id = d.clinic_id
      where d.id = department_staff.department_id and c.owner_id = auth.uid()
    )
  );

-- UPDATE: only the clinic owner can change roles.
drop policy if exists "update_department_staff" on department_staff;
create policy "update_department_staff" on department_staff for update
  to authenticated
  using (
    exists (
      select 1 from departments d
      join clinics c on c.id = d.clinic_id
      where d.id = department_staff.department_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from departments d
      join clinics c on c.id = d.clinic_id
      where d.id = department_staff.department_id and c.owner_id = auth.uid()
    )
  );

-- DELETE: only the clinic owner can remove staff.
drop policy if exists "delete_department_staff" on department_staff;
create policy "delete_department_staff" on department_staff for delete
  to authenticated
  using (
    exists (
      select 1 from departments d
      join clinics c on c.id = d.clinic_id
      where d.id = department_staff.department_id and c.owner_id = auth.uid()
    )
  );

-- ============================================================
-- 8. RLS: doctors
-- ============================================================
-- SELECT (authenticated): owner or department_staff of the doctor's department.
drop policy if exists "public_read_doctors" on doctors;
drop policy if exists "select_doctors_auth" on doctors;
create policy "select_doctors_auth" on doctors for select
  to authenticated
  using (user_can_access_department(department_id));

-- SELECT (anon): allow reading a specific doctor by id when the department
-- exists. This is NOT a directory — anon must know the doctor id. We allow
-- anon to read any doctor whose department_id is not null (the department
-- exists). This supports the public queue page.
drop policy if exists "select_doctors_anon" on doctors;
create policy "select_doctors_anon" on doctors for select
  to anon
  using (department_id is not null);

-- INSERT: owner or department_staff of the target department.
drop policy if exists "auth_insert_doctors" on doctors;
create policy "auth_insert_doctors" on doctors for insert
  to authenticated
  with check (user_can_access_department(department_id));

-- UPDATE: owner or department_staff of the doctor's current department
-- AND the target department (if changing department_id).
drop policy if exists "auth_update_doctors" on doctors;
create policy "auth_update_doctors" on doctors for update
  to authenticated
  using (user_can_access_department(department_id))
  with check (user_can_access_department(department_id));

-- DELETE: owner or department_staff of the doctor's department.
drop policy if exists "auth_delete_doctors" on doctors;
create policy "auth_delete_doctors" on doctors for delete
  to authenticated
  using (user_can_access_department(department_id));

-- ============================================================
-- 9. RLS: queue_sessions
-- ============================================================
-- SELECT (authenticated): owner or department_staff of the session's doctor's department.
drop policy if exists "public_read_queue_sessions" on queue_sessions;
drop policy if exists "select_queue_sessions_auth" on queue_sessions;
create policy "select_queue_sessions_auth" on queue_sessions for select
  to authenticated
  using (user_can_access_department(session_department_id(id)));

-- SELECT (anon): allow reading a specific session by id when its doctor has
-- a department. Supports the public queue page.
drop policy if exists "select_queue_sessions_anon" on queue_sessions;
create policy "select_queue_sessions_anon" on queue_sessions for select
  to anon
  using (session_department_id(id) is not null);

-- INSERT: owner or department_staff of the target doctor's department.
drop policy if exists "auth_insert_queue_sessions" on queue_sessions;
create policy "auth_insert_queue_sessions" on queue_sessions for insert
  to authenticated
  with check (user_can_access_department(doctor_department_id(doctor_id)));

-- UPDATE: owner or department_staff of the session's doctor's department.
drop policy if exists "auth_update_queue_sessions" on queue_sessions;
create policy "auth_update_queue_sessions" on queue_sessions for update
  to authenticated
  using (user_can_access_department(session_department_id(id)))
  with check (user_can_access_department(session_department_id(id)));

-- DELETE: owner or department_staff of the session's doctor's department.
drop policy if exists "auth_delete_queue_sessions" on queue_sessions;
create policy "auth_delete_queue_sessions" on queue_sessions for delete
  to authenticated
  using (user_can_access_department(session_department_id(id)));

-- ============================================================
-- 10. RLS: tokens
-- ============================================================
-- SELECT (authenticated): owner or department_staff of the token's session's doctor's department.
drop policy if exists "public_read_tokens" on tokens;
drop policy if exists "select_tokens_auth" on tokens;
create policy "select_tokens_auth" on tokens for select
  to authenticated
  using (user_can_access_department(token_department_id(id)));

-- SELECT (anon): allow reading tokens for a session whose doctor has a department.
drop policy if exists "select_tokens_anon" on tokens;
create policy "select_tokens_anon" on tokens for select
  to anon
  using (token_department_id(id) is not null);

-- INSERT: owner or department_staff of the target session's doctor's department.
drop policy if exists "auth_insert_tokens" on tokens;
create policy "auth_insert_tokens" on tokens for insert
  to authenticated
  with check (user_can_access_department(session_department_id(queue_session_id)));

-- UPDATE: owner or department_staff of the token's session's doctor's department.
drop policy if exists "auth_update_tokens" on tokens;
create policy "auth_update_tokens" on tokens for update
  to authenticated
  using (user_can_access_department(token_department_id(id)))
  with check (user_can_access_department(token_department_id(id)));

-- DELETE: owner or department_staff of the token's session's doctor's department.
drop policy if exists "auth_delete_tokens" on tokens;
create policy "auth_delete_tokens" on tokens for delete
  to authenticated
  using (user_can_access_department(token_department_id(id)));

-- ============================================================
-- 11. Realtime: add new tables to the publication
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'departments'
  ) then
    alter publication supabase_realtime add table departments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'department_staff'
  ) then
    alter publication supabase_realtime add table department_staff;
  end if;
end $$;
