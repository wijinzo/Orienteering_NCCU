begin;
create table if not exists public.memory_reconstruction(team_id uuid primary key references public.teams(id),completed_at timestamptz);
alter table public.memory_reconstruction enable row level security;
revoke all on public.memory_reconstruction from public,anon,authenticated;
grant select,insert,update on public.memory_reconstruction to service_role;
create or replace function public.memory_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;p public.team_game_progress%rowtype;done_at timestamptz;n integer;
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY');end if;
 perform 1 from public.teams where id=t.id for update;
 select * into p from public.team_game_progress where team_id=t.id;
 select count(distinct v.value) into n from jsonb_array_elements_text(coalesce(p.completed_checkpoints,'[]'::jsonb)) v where v.value in ('11','13','9','12','7');
 if p_action='complete' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長拼回照片。','code','LEADER_REQUIRED');end if;
  if n<>5 then return jsonb_build_object('error','還有記憶碎片尚未找回。','code','FRAGMENTS_REQUIRED');end if;
  insert into public.memory_reconstruction(team_id,completed_at) values(t.id,clock_timestamp()) on conflict(team_id) do update set completed_at=coalesce(public.memory_reconstruction.completed_at,excluded.completed_at);
 elsif p_action<>'get' then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION');end if;
 select completed_at into done_at from public.memory_reconstruction where team_id=t.id;
 return jsonb_build_object('team_id',t.id,'leader_id',t.state->>'leader_id','completed_checkpoints',coalesce(p.completed_checkpoints,'[]'::jsonb),'count',n,'completed_at',done_at);
end; $$;
revoke all on function public.memory_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.memory_action(text,uuid,text,jsonb) to service_role;
commit;
