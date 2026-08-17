-- ============================================================
-- Watchega — Supabase schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

-- Required for gen_random_uuid()
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. profiles — mirrors auth.users, tracks role (owner / member)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user is created
-- (covers both self-signup and admin.inviteUserByEmail)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2. competitions
-- ------------------------------------------------------------
create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  url text,
  registration_opens date,
  deadline date,
  status text not null default 'Student working on it'
    check (status in (
      'Student working on it',
      'Mentor working on it',
      'Submission Ready by Student',
      'Submitted'
    )),
  last_status_update date not null default current_date,
  result text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Auto-stamp last_status_update whenever status actually changes
create or replace function public.touch_status_date()
returns trigger as $$
begin
  if new.status is distinct from old.status then
    new.last_status_update := current_date;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_status_change on public.competitions;
create trigger on_status_change
  before update on public.competitions
  for each row execute function public.touch_status_date();

-- ------------------------------------------------------------
-- 3. documents — metadata for files in Supabase Storage
-- ------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. Row Level Security
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.competitions enable row level security;
alter table public.documents enable row level security;

-- profiles: any signed-in user can see who else has access
create policy "profiles are readable by signed-in users"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- competitions: everyone signed in can view
create policy "competitions readable by signed-in users"
  on public.competitions for select
  using (auth.role() = 'authenticated');

-- competitions: only owner can create / edit / delete
create policy "owner can insert competitions"
  on public.competitions for insert
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );

create policy "owner can update competitions"
  on public.competitions for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );

create policy "owner can delete competitions"
  on public.competitions for delete
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );

-- documents: any signed-in user can view / upload / delete
-- (this matches "this one user should be able to download, upload and delete documents")
create policy "documents readable by signed-in users"
  on public.documents for select
  using (auth.role() = 'authenticated');

create policy "signed-in users can add documents"
  on public.documents for insert
  with check (auth.role() = 'authenticated');

create policy "signed-in users can delete documents"
  on public.documents for delete
  using (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 5. Storage bucket for the actual files
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "signed-in users can read documents bucket"
  on storage.objects for select
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

create policy "signed-in users can upload to documents bucket"
  on storage.objects for insert
  with check (bucket_id = 'documents' and auth.role() = 'authenticated');

create policy "signed-in users can delete from documents bucket"
  on storage.objects for delete
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

-- ============================================================
-- After running this file, see SETUP.md step "Make yourself owner"
-- — you must manually promote your own account to role='owner'.
-- This script cannot do that for you (no owner exists yet).
-- ============================================================
