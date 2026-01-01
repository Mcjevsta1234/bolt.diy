-- Feature flags table
-- Stores global, user-scoped, and workspace-scoped flags.
create table if not exists feature_flags (
  key text primary key,
  enabled boolean not null default false,
  scope_type text not null default 'global' check (scope_type in ('global', 'user', 'workspace')),
  scope_id uuid,
  updated_at timestamptz not null default now()
);

-- Index to efficiently resolve flags by scope
create index if not exists feature_flags_scope_idx
  on feature_flags (scope_type, scope_id);