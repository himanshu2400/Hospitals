/*
# QueueFlow — Hospital Queue Management Schema

## Overview
Creates the full schema for QueueFlow, a real-time hospital queue management app.
Patients view a public queue page per clinic+doctor and see the currently-served token
plus an estimated wait time. Staff log in to advance the queue. Clinic admins configure
branding (name, logo, primary color) that applies across public and staff pages.

## Tables
1. `clinics` — top-level clinic entity with branding fields.
   - `id` (uuid PK)
   - `slug` (text, unique) — used in public URL `/queue/:slug/:doctorId`
   - `name` (text)
   - `logo_url` (text, nullable)
   - `primary_color` (text, default '#0ea5e9')
   - `created_at` (timestamptz)
2. `doctors` — doctors belonging to a clinic.
   - `id` (uuid PK)
   - `clinic_id` (uuid FK → clinics.id ON DELETE CASCADE)
   - `name` (text)
   - `specialty` (text)
   - `created_at` (timestamptz)
3. `queue_sessions` — a day's queue for a doctor.
   - `id` (uuid PK)
   - `doctor_id` (uuid FK → doctors.id ON DELETE CASCADE)
   - `session_date` (date) — the calendar day
   - `current_token` (int, default 0) — the token number currently being served
   - `status` (text: 'waiting' | 'active' | 'closed', default 'waiting')
   - `created_at` (timestamptz)
   - Unique constraint on (doctor_id, session_date) so one session per doctor per day.
4. `tokens` — individual patient tokens in a session.
   - `id` (uuid PK)
   - `queue_session_id` (uuid FK → queue_sessions.id ON DELETE CASCADE)
   - `patient_name` (text)
   - `token_number` (int)
   - `status` (text: 'waiting' | 'in_consult' | 'completed' | 'skipped', default 'waiting')
   - `checked_in_at` (timestamptz, default now())
   - `consult_started_at` (timestamptz, nullable)
   - `consult_ended_at` (timestamptz, nullable)

## Security (RLS)
- All tables: SELECT is public (TO anon, authenticated) so anyone can read without login.
- INSERT / UPDATE / DELETE: only TO authenticated (staff accounts).
- No user_id ownership scoping is used because clinic staff share access to clinic data;
  any authenticated staff account can manage rows. This matches the requirement that
  "only authenticated staff accounts can create or edit rows."

## Realtime
- `queue_sessions` and `tokens` are added to the realtime publication so the public queue
  page and staff dashboard receive live updates without manual refresh.

## Notes
1. The app uses Supabase Auth (email/password) for staff accounts only. Patients never
   log in — they read via the anon key.
2. `current_token` on queue_sessions is the source of truth for "now serving" and is
   advanced by the staff dashboard's "Call next patient" action.
3. Average consultation duration is computed from the last 5 completed tokens for a
   doctor (consult_ended_at - consult_started_at), in minutes.
*/

-- Extensions
create extension if not exists "pgcrypto";

-- Clinics
create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  logo_url text,
  primary_color text not null default '#0ea5e9',
  created_at timestamptz not null default now()
);
alter table clinics enable row level security;

drop policy if exists "public_read_clinics" on clinics;
create policy "public_read_clinics" on clinics for select
  to anon, authenticated using (true);

drop policy if exists "auth_insert_clinics" on clinics;
create policy "auth_insert_clinics" on clinics for insert
  to authenticated with check (true);

drop policy if exists "auth_update_clinics" on clinics;
create policy "auth_update_clinics" on clinics for update
  to authenticated using (true) with check (true);

drop policy if exists "auth_delete_clinics" on clinics;
create policy "auth_delete_clinics" on clinics for delete
  to authenticated using (true);

-- Doctors
create table if not exists doctors (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  specialty text not null,
  created_at timestamptz not null default now()
);
alter table doctors enable row level security;

drop policy if exists "public_read_doctors" on doctors;
create policy "public_read_doctors" on doctors for select
  to anon, authenticated using (true);

drop policy if exists "auth_insert_doctors" on doctors;
create policy "auth_insert_doctors" on doctors for insert
  to authenticated with check (true);

drop policy if exists "auth_update_doctors" on doctors;
create policy "auth_update_doctors" on doctors for update
  to authenticated using (true) with check (true);

drop policy if exists "auth_delete_doctors" on doctors;
create policy "auth_delete_doctors" on doctors for delete
  to authenticated using (true);

-- Queue sessions
create table if not exists queue_sessions (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references doctors(id) on delete cascade,
  session_date date not null default current_date,
  current_token int not null default 0,
  status text not null default 'waiting' check (status in ('waiting','active','closed')),
  created_at timestamptz not null default now(),
  unique (doctor_id, session_date)
);
alter table queue_sessions enable row level security;

drop policy if exists "public_read_queue_sessions" on queue_sessions;
create policy "public_read_queue_sessions" on queue_sessions for select
  to anon, authenticated using (true);

drop policy if exists "auth_insert_queue_sessions" on queue_sessions;
create policy "auth_insert_queue_sessions" on queue_sessions for insert
  to authenticated with check (true);

drop policy if exists "auth_update_queue_sessions" on queue_sessions;
create policy "auth_update_queue_sessions" on queue_sessions for update
  to authenticated using (true) with check (true);

drop policy if exists "auth_delete_queue_sessions" on queue_sessions;
create policy "auth_delete_queue_sessions" on queue_sessions for delete
  to authenticated using (true);

-- Tokens
create table if not exists tokens (
  id uuid primary key default gen_random_uuid(),
  queue_session_id uuid not null references queue_sessions(id) on delete cascade,
  patient_name text not null,
  token_number int not null,
  status text not null default 'waiting' check (status in ('waiting','in_consult','completed','skipped')),
  checked_in_at timestamptz not null default now(),
  consult_started_at timestamptz,
  consult_ended_at timestamptz
);
alter table tokens enable row level security;

drop policy if exists "public_read_tokens" on tokens;
create policy "public_read_tokens" on tokens for select
  to anon, authenticated using (true);

drop policy if exists "auth_insert_tokens" on tokens;
create policy "auth_insert_tokens" on tokens for insert
  to authenticated with check (true);

drop policy if exists "auth_update_tokens" on tokens;
create policy "auth_update_tokens" on tokens for update
  to authenticated using (true) with check (true);

drop policy if exists "auth_delete_tokens" on tokens;
create policy "auth_delete_tokens" on tokens for delete
  to authenticated using (true);

-- Indexes for common queries
create index if not exists idx_doctors_clinic_id on doctors(clinic_id);
create index if not exists idx_queue_sessions_doctor_id on queue_sessions(doctor_id);
create index if not exists idx_queue_sessions_doctor_date on queue_sessions(doctor_id, session_date);
create index if not exists idx_tokens_session_id on tokens(queue_session_id);
create index if not exists idx_tokens_status on tokens(status);

-- Realtime publication: add tables so the frontend can subscribe to changes.
-- Using a DO block to be idempotent (add table only if not already in publication).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'queue_sessions'
  ) then
    alter publication supabase_realtime add table queue_sessions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'tokens'
  ) then
    alter publication supabase_realtime add table tokens;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'clinics'
  ) then
    alter publication supabase_realtime add table clinics;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'doctors'
  ) then
    alter publication supabase_realtime add table doctors;
  end if;
end $$;
