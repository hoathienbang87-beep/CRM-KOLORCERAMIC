-- Add two new channel-detail values to CRM settings.
-- Safe to run more than once. It only appends missing values to settings.data.channels.

insert into public.settings (id, data, raw_data, updated_at)
values (
  'crm',
  jsonb_build_object('channels', '["Khách hàng từ PCI","Khách hàng từ VMARK"]'::jsonb),
  jsonb_build_object('channels', '["Khách hàng từ PCI","Khách hàng từ VMARK"]'::jsonb),
  now()
)
on conflict (id) do nothing;

with current_settings as (
  select
    id,
    coalesce(data->'channels', '[]'::jsonb) as channels
  from public.settings
  where id = 'crm'
),
merged as (
  select
    id,
    (
      select jsonb_agg(value order by sort_order)
      from (
        select value, ordinality::int as sort_order
        from jsonb_array_elements_text(channels) with ordinality
        union all
        select 'Khách hàng từ PCI', 10001
        where not exists (
          select 1 from jsonb_array_elements_text(channels) existing(value)
          where lower(existing.value) = lower('Khách hàng từ PCI')
        )
        union all
        select 'Khách hàng từ VMARK', 10002
        where not exists (
          select 1 from jsonb_array_elements_text(channels) existing(value)
          where lower(existing.value) = lower('Khách hàng từ VMARK')
        )
      ) values_to_keep
    ) as channels
  from current_settings
)
update public.settings s
set
  data = jsonb_set(coalesce(s.data, '{}'::jsonb), '{channels}', merged.channels, true),
  raw_data = jsonb_set(coalesce(s.raw_data, '{}'::jsonb), '{channels}', merged.channels, true),
  updated_at = now()
from merged
where s.id = merged.id;
