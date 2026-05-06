update storage.buckets
set public = false
where id = 'evidence';

drop policy if exists evidence_public_read on storage.objects;
drop policy if exists evidence_anon_insert on storage.objects;

