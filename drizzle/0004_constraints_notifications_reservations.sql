create unique index if not exists notifications_tenant_event_key_uq
  on notifications (tenant_id, event_key);

create unique index if not exists reservations_tenant_unit_checkin_uq
  on reservations (tenant_id, unit_id, check_in_at);

