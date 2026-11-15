-- Run once in the Supabase SQL Editor. Safe to re-run for this version.
begin;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  activity_id text not null check (length(activity_id) between 1 and 100),
  player_code text not null check (player_code ~ '^[A-Z0-9_-]{1,20}$'),
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  unique (activity_id, player_code)
);

create table if not exists public.player_progress (
  player_id uuid primary key references public.players(id) on delete cascade,
  current_checkpoint text default null,
  completed_checkpoints jsonb not null default '[]'::jsonb check (jsonb_typeof(completed_checkpoints) = 'array'),
  choices jsonb not null default '{}'::jsonb check (jsonb_typeof(choices) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.players enable row level security;
alter table public.player_progress enable row level security;
-- No client policies: player identity is verified exclusively by the backend.
revoke all on public.players, public.player_progress from public, anon, authenticated;
grant select, insert, update, delete on public.players, public.player_progress to service_role;

create or replace function public.touch_progress_timestamp()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function public.touch_progress_timestamp() from public, anon, authenticated;
drop trigger if exists progress_updated_at on public.player_progress;
create trigger progress_updated_at before update on public.player_progress
for each row execute function public.touch_progress_timestamp();

-- One RPC transaction: concurrent first logins cannot create duplicate players
-- or leave a player without an initial progress row.
create or replace function public.login_player(p_activity_id text, p_player_code text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_player public.players%rowtype;
  v_progress public.player_progress%rowtype;
begin
  insert into public.players (activity_id, player_code)
  values (p_activity_id, p_player_code)
  on conflict (activity_id, player_code)
  do update set last_login_at = clock_timestamp()
  returning * into v_player;

  insert into public.player_progress (player_id) values (v_player.id)
  on conflict (player_id) do nothing;
  select * into v_progress from public.player_progress where player_id = v_player.id;

  return jsonb_build_object(
    'player', jsonb_build_object('id', v_player.id, 'player_code', v_player.player_code,
      'created_at', v_player.created_at, 'last_login_at', v_player.last_login_at),
    'progress', to_jsonb(v_progress) - 'player_id'
  );
end;
$$;
revoke all on function public.login_player(text, text) from public, anon, authenticated;
grant execute on function public.login_player(text, text) to service_role;

commit;
