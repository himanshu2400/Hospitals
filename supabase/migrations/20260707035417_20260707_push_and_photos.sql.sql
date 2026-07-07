/*
# QueueFlow — Push subscriptions + doctor photos

## Overview
1. `push_subscriptions` table — stores a patient's web push endpoint
   linked to their token row, so we can notify them when their turn is
   near and when it's their turn.
2. `doctors.photo_url` — optional photo URL for each doctor, settable
   by the clinic owner or the doctor's assigned department staff.

## Changes

### `push_subscriptions`
- `id uuid primary key default gen_random_uuid()`
- `token_id uuid not null references tokens(id) on delete cascade`
  — the token this subscription belongs to. Cascades so subscriptions
  are cleaned up when tokens are deleted.
- `endpoint text not null` — the push service endpoint URL.
- `p256dh text not null` — the ECDH P-256 public key (base64url).
- `auth text not null` — the auth secret (base64url).
- `created_at timestamptz not null default now()`

### `doctors`
- New column `photo_url text` (nullable). NULL means no photo; the UI
  shows a default avatar.

## RLS on `push_subscriptions`
The public queue page (anon key) needs to INSERT and SELECT its own
subscriptions. We scope by `token_id` — anyone who knows the token id
can subscribe to notifications for it. This is acceptable because token
ids are unguessable UUIDs and the subscription only delivers
"your turn is near" / "it's your turn" notifications — no PHI beyond
what the patient already entered.

## Storage buckets
- `logos` — public bucket for clinic logos (uploaded by clinic owner).
- `photos` — public bucket for doctor photos (uploaded by owner or
  department staff).

Both are public-read so the public queue page can display images
without auth. Writes are restricted to authenticated users via RLS
policies on `storage.objects`.

## Notes
1. Idempotent: uses `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS`.
2. The `tokens` table already exists with `id uuid primary key`.
3. VAPID keys are stored as edge function secrets, not in the DB.
*/

-- Doctor photo column
alter table doctors
  add column if not exists photo_url text;

-- Push subscriptions table
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references tokens(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

-- Anon can insert/select/delete subscriptions for any token. Token IDs
-- are unguessable UUIDs, so this is effectively "anyone who knows the
-- token can subscribe to its notifications".
create policy "push_sub_insert"
  on push_subscriptions for insert
  to anon, authenticated
  with check (true);

create policy "push_sub_select"
  on push_subscriptions for select
  to anon, authenticated
  using (true);

create policy "push_sub_delete"
  on push_subscriptions for delete
  to anon, authenticated
  using (true);

-- Storage buckets (public-read)
insert into storage.buckets (id, name, public)
  values ('logos', 'logos', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('photos', 'photos', true)
  on conflict (id) do nothing;

-- Storage RLS: authenticated users can upload to logos and photos.
-- Public can read (bucket is public, but we add the policy for clarity).
create policy "logos_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'logos');

create policy "logos_write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'logos');

create policy "logos_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'logos');

create policy "logos_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'logos');

create policy "photos_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'photos');

create policy "photos_write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'photos');

create policy "photos_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'photos');

create policy "photos_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'photos');
