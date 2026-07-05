/*
# QueueFlow — Allow claiming unowned clinics

## Overview
The `auth_update_clinics` policy from the previous migration used
`USING (auth.uid() = owner_id)`. This blocks the "Claim this clinic" flow
because for an ownerless clinic `owner_id IS NULL`, and
`auth.uid() = NULL` evaluates to NULL (not true), so the UPDATE is rejected
before the WITH CHECK ever runs. The dashboard's claim button is therefore
non-functional.

## Change
Rewrite ONLY the `auth_update_clinics` policy to:
- `USING (auth.uid() = owner_id OR owner_id IS NULL)` — an authenticated
  user may update a clinic they own, OR an unowned clinic (to claim it).
- `WITH CHECK (auth.uid() = owner_id)` — after the update, the user MUST be
  the owner. This prevents:
  - Claiming a clinic and assigning it to a different user.
  - Reassigning your own clinic to someone else (the new owner_id would
    differ from auth.uid() and fail the check).
  - Releasing ownership (setting owner_id back to NULL fails the check).

All other policies are unchanged.

## Security
- An authenticated user still cannot touch a clinic owned by a different user
  (USING requires owner_id = auth.uid() OR owner_id IS NULL).
- The WITH CHECK guarantees post-update ownership, so claims can only set
  owner_id to the claiming user.
*/

drop policy if exists "auth_update_clinics" on clinics;
create policy "auth_update_clinics" on clinics for update
  to authenticated
  using (auth.uid() = owner_id OR owner_id IS NULL)
  with check (auth.uid() = owner_id);
