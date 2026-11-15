-- Apply after checkpoint1.sql and checkpoint4.sql. Both detours share this RPC.
begin;
create table if not exists public.detour_runs(id uuid primary key default gen_random_uuid(),team_id uuid not null references public.teams(id),checkpoint integer not null check(checkpoint in(6,8)),phase text not null default 'calling' check(phase in('calling','finished')),created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,unique(team_id,checkpoint));
alter table public.detour_runs enable row level security;
revoke all on public.detour_runs from public,anon,authenticated;
grant select,insert,update on public.detour_runs to service_role;
create or replace function public.detour_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;r public.detour_runs%rowtype;p public.team_game_progress%rowtype;cp integer;expected integer;
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY');end if;
 perform 1 from public.teams where id=t.id for update;
 select * into p from public.team_game_progress where team_id=t.id;
 if p_action='history' then
  -- Bonus playback is derived from branch completion, never inserted as a played detour.
  return jsonb_build_object('calls',coalesce((
   select jsonb_agg(jsonb_build_object('id',d.id,'checkpoint',v.checkpoint,'phase','finished','kind',case when d.id is null then 'bonus' else 'record' end) order by v.checkpoint desc)
   from (values(8,11),(6,12)) as v(checkpoint,terminal)
   left join public.detour_runs d on d.team_id=t.id and d.checkpoint=v.checkpoint and d.phase='finished'
   where d.id is not null or coalesce(p.completed_checkpoints,'[]'::jsonb) ? v.terminal::text
  ),'[]'::jsonb));
 end if;
 if p_action='enter' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長掃碼開啟來電。','code','LEADER_REQUIRED');end if;
  if p_payload ? 'code_hash' then
   select checkpoint_id into cp from public.checkpoint_codes where activity_id=p_activity and code_hash=p_payload->>'code_hash';
   if cp is null or cp not in(6,8) or (p_payload ? 'checkpoint' and (p_payload->>'checkpoint')::integer<>cp) then return jsonb_build_object('error','地點代碼不正確。','code','CODE_INVALID');end if;
  else cp:=(p_payload->>'checkpoint')::integer;
  end if;
  if cp is null or cp not in(6,8) then return jsonb_build_object('error','地點格式錯誤。','code','INPUT_INVALID');end if;
  if cp=8 then
   if not exists(select 1 from public.checkpoint_runs where team_id=t.id and phase='finished' and passed=false) then return jsonb_build_object('error','本隊尚未開放地點 8。','code','CHECKPOINT_LOCKED');end if;
  else
   if not exists(select 1 from public.checkpoint4_runs where team_id=t.id and phase='finished' and passed=false) then return jsonb_build_object('error','本隊尚未開放地點 6。','code','CHECKPOINT_LOCKED');end if;
  end if;
  select * into r from public.detour_runs where team_id=t.id and checkpoint=cp;
  if r.id is null then
   if not (p_payload ? 'code_hash') then return jsonb_build_object('error','請掃描現場 QR Code，或輸入地點代碼。','code','CODE_REQUIRED');end if;
   insert into public.detour_runs(team_id,checkpoint,phase) values(t.id,cp,case when p.completed_checkpoints ? cp::text then 'finished' else 'calling' end) returning * into r;
  end if;
 elsif p_action in('get','finish') then
  if p_payload ? 'run_id' then select * into r from public.detour_runs where team_id=t.id and id=(p_payload->>'run_id')::uuid;
  elsif p_payload ? 'checkpoint' then select * into r from public.detour_runs where team_id=t.id and checkpoint=(p_payload->>'checkpoint')::integer;
  else select * into r from public.detour_runs where team_id=t.id and phase='calling' order by created_at desc limit 1;
  end if;
  if p_action='finish' then
   if r.id is null or (p_payload ? 'checkpoint' and (p_payload->>'checkpoint')::integer<>r.checkpoint) then return jsonb_build_object('error','來電已更新，請重新載入。','code','STALE_RUN');end if;
   if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長看完對話。','code','LEADER_REQUIRED');end if;
   update public.detour_runs set phase='finished',finished_at=coalesce(finished_at,clock_timestamp()) where id=r.id returning * into r;
   update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? r.checkpoint::text then completed_checkpoints else completed_checkpoints||jsonb_build_array(r.checkpoint::text) end where team_id=t.id returning * into p;
  end if;
 else return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION');end if;
 return jsonb_build_object('server_time',clock_timestamp(),'progress',to_jsonb(p)-'team_id','run',case when r.id is null then null else jsonb_build_object('id',r.id,'checkpoint',r.checkpoint,'phase',r.phase,'next_id',case when r.checkpoint=8 then 11 else 12 end) end);
end;$$;
revoke all on function public.detour_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.detour_action(text,uuid,text,jsonb) to service_role;
commit;
