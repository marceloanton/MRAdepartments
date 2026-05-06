create extension if not exists btree_gist;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_check_window'
  ) then
    alter table public.reservations
      add constraint reservations_check_window
      check (check_in_at > check_out_at) not valid;
    alter table public.reservations
      validate constraint reservations_check_window;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_no_overlap_per_unit'
  ) then
    alter table public.reservations
      add constraint reservations_no_overlap_per_unit
      exclude using gist (
        tenant_id with =,
        unit_id with =,
        tstzrange(check_out_at, check_in_at, '[)') with &&
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notifications_channel_chk'
  ) then
    alter table public.notifications
      add constraint notifications_channel_chk
      check (channel in ('in_app', 'email')) not valid;
    alter table public.notifications
      validate constraint notifications_channel_chk;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notifications_target_chk'
  ) then
    alter table public.notifications
      add constraint notifications_target_chk
      check (user_id is not null or role is not null) not valid;
    alter table public.notifications
      validate constraint notifications_target_chk;
  end if;
end $$;

create index if not exists notifications_pending_idx
  on public.notifications (status, created_at)
  where status = 'pending';

create index if not exists notifications_unread_role_idx
  on public.notifications (tenant_id, role, created_at)
  where read = false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'evidence_kind_chk'
  ) then
    alter table public.evidence
      add constraint evidence_kind_chk
      check (kind in ('photo', 'external_link')) not valid;
    alter table public.evidence
      validate constraint evidence_kind_chk;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'evidence_photo_url_chk'
  ) then
    alter table public.evidence
      add constraint evidence_photo_url_chk
      check (
        kind <> 'photo'
        or (
          url <> ''
          and url not like 'http%'
          and url not like 'data:%'
        )
      ) not valid;
    alter table public.evidence
      validate constraint evidence_photo_url_chk;
  end if;
end $$;
