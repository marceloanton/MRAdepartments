DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'offline_op_status'
  ) THEN
    CREATE TYPE public.offline_op_status AS ENUM ('applied', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.offline_ops_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  op_id text NOT NULL,
  op_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.offline_op_status NOT NULL,
  error text,
  applied_at timestamptz,
  actor_user_id uuid NOT NULL REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS offline_ops_log_tenant_op_id_uq
  ON public.offline_ops_log (tenant_id, op_id);

CREATE INDEX IF NOT EXISTS offline_ops_log_tenant_status_idx
  ON public.offline_ops_log (tenant_id, status, created_at);
