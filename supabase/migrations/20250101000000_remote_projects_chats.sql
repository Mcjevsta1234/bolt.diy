-- Remote projects & chats persistence schema for SaaS v1
-- This migration defines:
--   - projects
--   - project_versions
--   - chats
--   - chat_messages
--   - Row Level Security (RLS) policies
--   - Storage object policies for the `project-snapshots` bucket
--
-- Notes:
-- - These tables live in the `public` schema.
-- - RLS assumes Supabase Auth is enabled and `auth.users` exists.
-- - Storage bucket creation itself should be done via the Supabase dashboard
--   or the Storage API (e.g. supabase-js). This migration only configures
--   policies on `storage.objects` for the `project-snapshots` bucket.

-- Projects table -------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_projects_owner_id
  on public.projects (owner_id);

create index if not exists idx_projects_created_at
  on public.projects (created_at);

-- Project versions (snapshots) ----------------------------------------------

create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_num integer not null,
  storage_path text not null,
  checksum text,
  created_at timestamptz not null default now(),
  unique (project_id, version_num)
);

create index if not exists idx_project_versions_project_id
  on public.project_versions (project_id);

-- Chats ----------------------------------------------------------------------

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chats_owner_id
  on public.chats (owner_id);

create index if not exists idx_chats_project_id
  on public.chats (project_id);

-- Chat messages -------------------------------------------------------------

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_chat_id_created_at
  on public.chat_messages (chat_id, created_at);

-- Row Level Security --------------------------------------------------------

alter table public.projects enable row level security;
alter table public.project_versions enable row level security;
alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;

-- Project RLS: users manage their own projects

create policy if not exists "Users manage own projects"
on public.projects
for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- Project_versions RLS: users manage versions of their own projects

create policy if not exists "Users manage own project versions"
on public.project_versions
for all
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.owner_id = auth.uid()
  )
);

-- Chats RLS: users manage their own chats

create policy if not exists "Users manage own chats"
on public.chats
for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- Chat_messages RLS: users manage messages in their chats

create policy if not exists "Users manage messages in own chats"
on public.chat_messages
for all
using (
  exists (
    select 1
    from public.chats c
    where c.id = chat_id
      and c.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.chats c
    where c.id = chat_id
      and c.owner_id = auth.uid()
  )
);

-- Optional: service_role bypass for admin / backend operations --------------

create policy if not exists "Service role full access - projects"
on public.projects
for all
using (auth.role() = 'service_role' or auth.uid() = owner_id)
with check (auth.role() = 'service_role' or auth.uid() = owner_id);

create policy if not exists "Service role full access - project_versions"
on public.project_versions
for all
using (
  auth.role() = 'service_role'
  or exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.owner_id = auth.uid()
  )
)
with check (
  auth.role() = 'service_role'
  or exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.owner_id = auth.uid()
  )
);

create policy if not exists "Service role full access - chats"
on public.chats
for all
using (auth.role() = 'service_role' or auth.uid() = owner_id)
with check (auth.role() = 'service_role' or auth.uid() = owner_id);

create policy if not exists "Service role full access - chat_messages"
on public.chat_messages
for all
using (
  auth.role() = 'service_role'
  or exists (
    select 1
    from public.chats c
    where c.id = chat_id
      and c.owner_id = auth.uid()
  )
)
with check (
  auth.role() = 'service_role'
  or exists (
    select 1
    from public.chats c
    where c.id = chat_id
      and c.owner_id = auth.uid()
  )
);

-- Storage policies for project snapshots ------------------------------------
-- Bucket name: `project-snapshots`
-- Object key convention: `${auth.uid()}/${projectId}/${versionId}.zip`

alter table storage.objects enable row level security;

create policy if not exists "Users manage own project snapshots"
on storage.objects
for all
using (
  bucket_id = 'project-snapshots'
  and (
    auth.role() = 'service_role'
    or split_part(name, '/', 1) = auth.uid()::text
  )
)
with check (
  bucket_id = 'project-snapshots'
  and (
    auth.role() = 'service_role'
    or split_part(name, '/', 1) = auth.uid()::text
  )
);