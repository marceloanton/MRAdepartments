create table if not exists public.operational_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  unit_id uuid not null references public.units(id),
  ticket_id uuid references public.tickets(id),
  actor_user_id uuid not null references public.app_users(id),
  checklist jsonb not null default '{}'::jsonb,
  evidence_required boolean not null default false,
  evidence_count integer not null default 0,
  notes text,
  closed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operational_closures_tenant_unit_idx
  on public.operational_closures (tenant_id, unit_id, closed_at);

create index if not exists operational_closures_actor_idx
  on public.operational_closures (tenant_id, actor_user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operational_closures_evidence_chk'
  ) then
    alter table public.operational_closures
      add constraint operational_closures_evidence_chk
      check (not evidence_required or evidence_count > 0) not valid;
    alter table public.operational_closures
      validate constraint operational_closures_evidence_chk;
  end if;
end $$;
