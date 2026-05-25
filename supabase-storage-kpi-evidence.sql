insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kpi-evidence',
  'kpi-evidence',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kpi_evidence_authenticated_insert" on storage.objects;
create policy "kpi_evidence_authenticated_insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'kpi-evidence');

drop policy if exists "kpi_evidence_authenticated_select" on storage.objects;
create policy "kpi_evidence_authenticated_select"
on storage.objects
for select
to authenticated
using (bucket_id = 'kpi-evidence');
