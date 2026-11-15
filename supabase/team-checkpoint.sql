-- Apply after story-votes.sql and detours.sql.
begin;
create table if not exists public.team_current_checkpoint(team_id uuid primary key references public.teams(id),activation_id uuid not null default gen_random_uuid(),checkpoint integer not null check(checkpoint between 1 and 13),run_id uuid not null,updated_at timestamptz not null default clock_timestamp());
alter table public.team_current_checkpoint enable row level security;
revoke all on public.team_current_checkpoint from public,anon,authenticated;
grant select,insert,update on public.team_current_checkpoint to service_role;
create or replace function public.team_game_action(p_activity text,p_player uuid,p_checkpoint integer,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;active public.team_current_checkpoint%rowtype;data jsonb;cp integer:=p_checkpoint;
begin
 if p_action<>'enter' and not(p_action='get' and p_payload->>'follow'='true') then
  if cp in(6,8) then return public.detour_action(p_activity,p_player,p_action,p_payload);end if;
  return public.story_game_action(p_activity,p_player,cp,p_action,p_payload);
 end if;
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY');end if;
 perform 1 from public.teams where id=t.id for update;
 select * into active from public.team_current_checkpoint where team_id=t.id;
 if p_action='get' and p_payload->>'follow'='true' then
  if active.run_id is not null and (t.state->>'leader_id'<>p_player::text or cp is null or cp=0) then cp:=active.checkpoint;end if;
  if cp is null or cp=0 then cp:=1;end if;
 end if;
 if cp in(6,8) then data:=public.detour_action(p_activity,p_player,p_action,p_payload||jsonb_build_object('checkpoint',cp));else data:=public.story_game_action(p_activity,p_player,cp,p_action,p_payload);end if;
 if data ? 'error' then return data;end if;
 if p_action='enter' and data->'run'->>'id' is not null then
  insert into public.team_current_checkpoint(team_id,checkpoint,run_id) values(t.id,cp,(data->'run'->>'id')::uuid)
  on conflict(team_id) do update set checkpoint=excluded.checkpoint,run_id=excluded.run_id,activation_id=gen_random_uuid(),updated_at=clock_timestamp()
  where public.team_current_checkpoint.run_id is distinct from excluded.run_id;
  select * into active from public.team_current_checkpoint where team_id=t.id;
 end if;
 if active.run_id::text=data->'run'->>'id' then
  return data||jsonb_build_object('activation',jsonb_build_object('id',active.activation_id,'checkpoint',active.checkpoint,'run_id',active.run_id));
 end if;
 return data;
end;$$;
revoke all on function public.team_game_action(text,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.team_game_action(text,uuid,integer,text,jsonb) to service_role;
commit;
