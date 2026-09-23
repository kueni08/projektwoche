create table if not exists public.project_planning (
  id integer primary key check (id = 1),
  revision bigint not null default 0,
  payload jsonb not null
);

create table if not exists public.project_login_attempts (
  id text primary key,
  attempts integer not null,
  expires bigint not null
);

alter table public.project_planning enable row level security;
alter table public.project_login_attempts enable row level security;
revoke all on public.project_planning, public.project_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.project_planning, public.project_login_attempts to service_role;

create or replace function public.project_planning_init(p_payload jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into public.project_planning(id, revision, payload)
  values (1, 0, p_payload) on conflict (id) do nothing;
$$;

create or replace function public.project_planning_cas(p_expected bigint, p_payload jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.project_planning
  set payload = p_payload, revision = revision + 1
  where id = 1 and revision = p_expected;
  return found;
end;
$$;

create or replace function public.project_bad_login(p_id text, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.project_login_attempts where expires < p_now;
  insert into public.project_login_attempts(id, attempts, expires)
  values (p_id, 1, p_now + 900000)
  on conflict (id) do update
  set attempts = case when public.project_login_attempts.expires < p_now
                      then 1 else public.project_login_attempts.attempts + 1 end,
      expires = p_now + 900000;
end;
$$;

revoke execute on function public.project_planning_init(jsonb), public.project_planning_cas(bigint,jsonb), public.project_bad_login(text,bigint) from public, anon, authenticated;
grant execute on function public.project_planning_init(jsonb), public.project_planning_cas(bigint,jsonb), public.project_bad_login(text,bigint) to service_role;
