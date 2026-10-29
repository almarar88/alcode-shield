-- Alcode Shield: multi-tenant schema. Every row belongs to an owner (auth.users.id).
-- Clients never hold keys; the Edge Function forwards the user's JWT for reads and uses
-- the service role only for privileged writes after checking the caller.
create table if not exists shield_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null, name text, role text not null default 'member' check (role in ('owner','admin','member')),
  plan text not null default 'private', active boolean not null default true,
  identity jsonb not null default '{}'::jsonb,   -- own handles/phone for privacy checks
  prefs jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table if not exists shield_sites (
  id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade,
  domain text not null, base_path text not null default '/', label text,
  verify_token text not null default encode(gen_random_bytes(12),'hex'),
  verified boolean not null default false, verify_method text, verified_at timestamptz,
  schedule text not null default 'off' check (schedule in ('off','weekly','monthly')),
  last_score int, last_grade text, last_scan_at timestamptz,
  created_at timestamptz not null default now(), unique(owner, domain, base_path));
create table if not exists shield_scans (
  id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade,
  site_id uuid not null references shield_sites(id) on delete cascade,
  status text not null default 'running', score int, grade text,
  categories jsonb, findings jsonb, meta jsonb, ai jsonb,
  started_at timestamptz not null default now(), finished_at timestamptz);
create index if not exists shield_scans_site on shield_scans(site_id, started_at desc);
create table if not exists shield_ip_checks (
  id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade,
  kind text not null, input jsonb, result jsonb, ai jsonb, created_at timestamptz not null default now());
create table if not exists shield_audit (
  id bigserial primary key, owner uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now(), action text not null, detail jsonb);
create index if not exists shield_audit_owner on shield_audit(owner, id desc);

create or replace function public.shield_active() returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists(select 1 from shield_profiles where user_id = auth.uid() and active) $$;
revoke execute on function public.shield_active() from anon, public;
grant execute on function public.shield_active() to authenticated;

do $$ declare t text; begin
  foreach t in array array['shield_profiles','shield_sites','shield_scans','shield_ip_checks','shield_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists p_own on public.%I', t);
  end loop; end $$;
create policy p_own on shield_profiles for select to authenticated using (user_id = auth.uid() and active);
create policy p_own on shield_sites for select to authenticated using (owner = auth.uid() and shield_active());
create policy p_own on shield_scans for select to authenticated using (owner = auth.uid() and shield_active());
create policy p_own on shield_ip_checks for select to authenticated using (owner = auth.uid() and shield_active());
create policy p_own on shield_audit for select to authenticated using (owner = auth.uid() and shield_active());
-- writes happen only through the Edge Function (service role) after it authenticates the caller.

-- Owner profile + pre-verified sites are seeded privately (not in this public repo).
