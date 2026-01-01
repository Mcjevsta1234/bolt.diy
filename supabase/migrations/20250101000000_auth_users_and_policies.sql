-- Application users table and RLS policies for Bolt SaaS auth
-- This table mirrors Supabase auth.users (id/email) and adds role/disabled flags.

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role text not null default 'member' check (role in ('admin', 'member')),
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.users is 'Bolt SaaS application users (role & disabled flags).';
comment on column public.users.role is 'Application role: admin or member.';
comment on column public.users.disabled is 'If true, account is disabled and must not access data.';

-- Enable row level security to scope access by auth.uid()
alter table public.users enable row level security;
alter table public.users force row level security;

-- Authenticated users can see their own row (when not disabled).
-- Admins can see every row (including disabled accounts).
create policy users_select_own_or_admin
on public.users
for select
using (
  (
    id = auth.uid()
    and not disabled
  )
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
      and not u.disabled
  )
);

-- Authenticated users can insert their own row as a non-admin.
create policy users_insert_self
on public.users
for insert
with check (
  id = auth.uid()
  and role = 'member'
);

-- Non-disabled users can update their own non-privileged fields (e.g., email).
create policy users_update_self_email
on public.users
for update
using (
  id = auth.uid()
  and not disabled
)
with check (
  id = auth.uid()
  and role = 'member'
);

-- Admins can update any user (e.g., to disable accounts or change roles).
create policy users_admin_update
on public.users
for update
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
      and not u.disabled
  )
);

-- Admins may delete users if desired.
create policy users_admin_delete
on public.users
for delete
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
      and not u.disabled
  )
);

-- Automatically seed public.users when a new Supabase auth user is created.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();