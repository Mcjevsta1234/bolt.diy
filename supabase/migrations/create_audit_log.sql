-- Audit log table
-- Records administrative actions for compliance and debugging.
create table if not exists audit_log (
  id bigserial primary key,
  actor_user_id uuid not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_actor_idx
  on audit_log (actor_user_id);

create index if not exists audit_log_created_at_idx
  on audit_log (created_at desc);