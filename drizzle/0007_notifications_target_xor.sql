do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'notifications_target_chk'
  ) then
    alter table public.notifications
      drop constraint notifications_target_chk;
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
      check ((user_id is not null) <> (role is not null)) not valid;
    alter table public.notifications
      validate constraint notifications_target_chk;
  end if;
end $$;
