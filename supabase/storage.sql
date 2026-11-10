-- Photo storage (Supabase Storage). Anyone can view a photo by its link; admins and approved
-- contributors can upload; only admins can change or delete. File names are random, so photos of scheduled rounds can't be guessed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Policies from before the rename to CampusSpot.
drop policy if exists "polyspot: admins upload photos" on storage.objects;
drop policy if exists "polyspot: admins see photo list" on storage.objects;
drop policy if exists "polyspot: admins change photos" on storage.objects;
drop policy if exists "polyspot: admins delete photos" on storage.objects;
drop policy if exists "campusspot: admins upload photos" on storage.objects;
create policy "campusspot: admins upload photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.can_upload());

drop policy if exists "campusspot: admins see photo list" on storage.objects;
create policy "campusspot: admins see photo list" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.can_upload());

drop policy if exists "campusspot: admins change photos" on storage.objects;
create policy "campusspot: admins change photos" on storage.objects
  for update to authenticated using (bucket_id = 'photos' and public.is_admin());

drop policy if exists "campusspot: admins delete photos" on storage.objects;
create policy "campusspot: admins delete photos" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and public.is_admin());
