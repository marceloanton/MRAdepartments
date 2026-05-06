insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'evidence_public_read'
  ) then
    create policy evidence_public_read
      on storage.objects
      for select
      to public
      using (bucket_id = 'evidence');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'evidence_anon_insert'
  ) then
    create policy evidence_anon_insert
      on storage.objects
      for insert
      to anon, authenticated
      with check (bucket_id = 'evidence');
  end if;
end $$;
