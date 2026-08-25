-- Ketchup Files: authorization policies for contributor uploads and admin publishing
-- Apply in Supabase SQL Editor after reviewing the admin email and bucket names.
-- Idempotent: safe to run more than once.

begin;

alter table public.photos enable row level security;

grant select, insert, update on table public.photos to authenticated;

drop policy if exists "kf_photos_read_own" on public.photos;
create policy "kf_photos_read_own"
on public.photos
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "kf_photos_insert_own" on public.photos;
create policy "kf_photos_insert_own"
on public.photos
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "kf_photos_update_own_pending" on public.photos;
create policy "kf_photos_update_own_pending"
on public.photos
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and status in ('pending', 'rejected')
)
with check (
  (select auth.uid()) = user_id
  and status in ('pending', 'rejected')
);

-- PostgreSQL RLS requires a SELECT policy as well as an UPDATE policy.
drop policy if exists "kf_admin_read_all_photos" on public.photos;
create policy "kf_admin_read_all_photos"
on public.photos
for select
to authenticated
using ((select auth.jwt() ->> 'email') = 'creators@ketchupfiles.com');

drop policy if exists "kf_admin_update_any_photo" on public.photos;
create policy "kf_admin_update_any_photo"
on public.photos
for update
to authenticated
using ((select auth.jwt() ->> 'email') = 'creators@ketchupfiles.com')
with check ((select auth.jwt() ->> 'email') = 'creators@ketchupfiles.com');

-- Storage uploads must stay inside the signed-in contributor's folder.
drop policy if exists "kf_uploads_own_folder_insert" on storage.objects;
create policy "kf_uploads_own_folder_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'Ketchup Files UPLOADS'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Required when replacing an existing object with upsert:true.
drop policy if exists "kf_uploads_owner_update" on storage.objects;
create policy "kf_uploads_owner_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'Ketchup Files UPLOADS'
  and owner_id = (select auth.uid())::text
)
with check (
  bucket_id = 'Ketchup Files UPLOADS'
  and owner_id = (select auth.uid())::text
);

drop policy if exists "kf_uploads_own_folder_delete" on storage.objects;
create policy "kf_uploads_own_folder_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'Ketchup Files UPLOADS'
  and owner_id = (select auth.uid())::text
);

drop policy if exists "kf_originals_own_folder_insert" on storage.objects;
create policy "kf_originals_own_folder_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'Ketchup Files ORIGINALS'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "kf_originals_owner_update" on storage.objects;
create policy "kf_originals_owner_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'Ketchup Files ORIGINALS'
  and owner_id = (select auth.uid())::text
)
with check (
  bucket_id = 'Ketchup Files ORIGINALS'
  and owner_id = (select auth.uid())::text
);

drop policy if exists "kf_originals_own_folder_delete" on storage.objects;
create policy "kf_originals_own_folder_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'Ketchup Files ORIGINALS'
  and owner_id = (select auth.uid())::text
);

commit;
