begin;
create table if not exists public.checkpoint3_runs(id uuid primary key default gen_random_uuid(),team_id uuid not null unique references public.teams(id),phase text not null default 'story',choice text);
create table if not exists public.checkpoint3_players(run_id uuid references public.checkpoint3_runs(id),player_id uuid references public.players(id),done boolean not null default false,primary key(run_id,player_id));
alter table public.checkpoint3_runs enable row level security;
alter table public.checkpoint3_players enable row level security;
revoke all on public.checkpoint3_runs,public.checkpoint3_players from public,anon,authenticated;
grant select,insert,update,delete on public.checkpoint3_runs,public.checkpoint3_players to service_role;
create or replace function public.checkpoint3_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype; r public.checkpoint3_runs%rowtype; p public.team_game_progress%rowtype; cp integer; total integer; completed integer;
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY');end if;
 perform 1 from public.teams where id=t.id for update;
 insert into public.team_game_progress(team_id) values(t.id) on conflict do nothing;
 select * into p from public.team_game_progress where team_id=t.id;
 select * into r from public.checkpoint3_runs where team_id=t.id for update;
 if p_action='enter' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長開啟地點。','code','LEADER_REQUIRED');end if;
  if p_payload ? 'code_hash' then
   select checkpoint_id into cp from public.checkpoint_codes where activity_id=p_activity and code_hash=p_payload->>'code_hash';
   if cp is distinct from 3 or (p_payload ? 'checkpoint' and (p_payload->>'checkpoint')::integer<>3) then return jsonb_build_object('error','地點代碼不正確。','code','CODE_INVALID');end if;
  elsif r.id is null then return jsonb_build_object('error','請掃描地點 3 的 QR Code，或輸入現場代碼。','code','CODE_REQUIRED');end if;
  if r.id is null then insert into public.checkpoint3_runs(team_id) values(t.id) returning * into r;end if;
 elsif p_action not in ('get','choose','complete','finish') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION');end if;
 if r.id is null then return jsonb_build_object('run',null,'progress',to_jsonb(p)-'team_id','server_time',clock_timestamp());end if;
 if p_action not in ('get','enter') and p_payload->>'run_id' is distinct from r.id::text then return jsonb_build_object('error','任務已更新。','code','STALE_RUN');end if;
 if p_action='choose' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長選擇。','code','LEADER_REQUIRED');end if;
  if coalesce(p_payload->>'choice','') not in ('egg','care') then return jsonb_build_object('error','選項不正確。','code','INVALID_CHOICE');end if;
  if r.phase='story' then
   insert into public.checkpoint3_players(run_id,player_id) select r.id,player_id from public.team_members where team_id=t.id on conflict do nothing;
   update public.checkpoint3_runs set phase='play',choice=p_payload->>'choice' where id=r.id returning * into r;
  end if;
 elsif p_action='complete' then
  if r.phase not in ('play','success','finished') then return jsonb_build_object('error','挑戰尚未開始。','code','INVALID_PHASE');end if;
  if not exists(select 1 from public.checkpoint3_players where run_id=r.id and player_id=p_player) then return jsonb_build_object('error','你不在本輪名單中，請協助隊員完成。','code','NOT_PARTICIPANT');end if;
  update public.checkpoint3_players set done=true where run_id=r.id and player_id=p_player;
  if r.phase='play' and not exists(select 1 from public.checkpoint3_players where run_id=r.id and not done) then update public.checkpoint3_runs set phase='success' where id=r.id returning * into r;end if;
 elsif p_action='finish' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長完成劇情。','code','LEADER_REQUIRED');end if;
  if r.phase not in ('success','finished') then return jsonb_build_object('error','請等待全員完成。','code','NOT_FINISHED');end if;
  update public.checkpoint3_runs set phase='finished' where id=r.id returning * into r;
  update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? '3' then completed_checkpoints else completed_checkpoints || '["3"]'::jsonb end where team_id=t.id returning * into p;
 end if;
 select count(*),count(*) filter(where done) into total,completed from public.checkpoint3_players where run_id=r.id;
 return jsonb_build_object('server_time',clock_timestamp(),'progress',to_jsonb(p)-'team_id','run',jsonb_build_object('id',r.id,'checkpoint',3,'phase',r.phase,'choice',r.choice,'effect',case when r.choice='egg' then 'angry_shot' when r.choice='care' then 'pressure' else null end,'total',total,'completed_count',completed,'participant',exists(select 1 from public.checkpoint3_players where run_id=r.id and player_id=p_player),'done',coalesce((select done from public.checkpoint3_players where run_id=r.id and player_id=p_player),false)));
end; $$;
revoke all on function public.checkpoint3_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint3_action(text,uuid,text,jsonb) to service_role;
commit;
