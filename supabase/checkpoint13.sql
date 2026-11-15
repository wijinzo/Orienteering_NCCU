begin;
create table if not exists public.checkpoint13_runs (id uuid primary key default gen_random_uuid(), team_id uuid not null unique references public.teams(id), phase text not null default 'story', choice text);
alter table public.checkpoint13_runs enable row level security;
revoke all on public.checkpoint13_runs from public, anon, authenticated;
grant select,insert,update,delete on public.checkpoint13_runs to service_role;
create or replace function public.checkpoint13_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype; r public.checkpoint13_runs%rowtype; p public.team_game_progress%rowtype; cp integer; v_now timestamptz:=clock_timestamp();
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY'); end if;
 perform 1 from public.teams where id=t.id for update;
 insert into public.team_game_progress(team_id) values(t.id) on conflict do nothing;
 select * into p from public.team_game_progress where team_id=t.id;
 select * into r from public.checkpoint13_runs where team_id=t.id for update;
 if p_action='enter' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長開啟地點。','code','LEADER_REQUIRED'); end if;
  if not (p.completed_checkpoints ? '2') then return jsonb_build_object('error','請先完成地點 2。','code','CHECKPOINT_LOCKED'); end if;
  if p_payload ? 'code_hash' then
   select checkpoint_id into cp from public.checkpoint_codes where activity_id=p_activity and code_hash=p_payload->>'code_hash';
   if cp is distinct from 13 or (p_payload ? 'checkpoint' and (p_payload->>'checkpoint')::integer<>13) then return jsonb_build_object('error','地點代碼不正確。','code','CODE_INVALID'); end if;
  elsif r.id is null then return jsonb_build_object('error','請掃描地點 13 的 QR Code，或輸入現場代碼。','code','CODE_REQUIRED'); end if;
  if r.id is null then insert into public.checkpoint13_runs(team_id) values(t.id) returning * into r; end if;
 elsif p_action not in ('get','choose','puzzle','guess','finish') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION'); end if;
 if r.id is null then return jsonb_build_object('run',null,'progress',to_jsonb(p)-'team_id','server_time',v_now); end if;
 if p_action not in ('get','enter') then
  if p_payload->>'run_id' is distinct from r.id::text then return jsonb_build_object('error','任務已更新，請重新載入。','code','STALE_RUN'); end if;
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長操作。','code','LEADER_REQUIRED'); end if;
 end if;
 if p_action='choose' and r.phase='story' then
  if coalesce(p_payload->>'choice','') not in ('help','tease') then return jsonb_build_object('error','請選擇有效選項。','code','INVALID_CHOICE'); end if;
  update public.checkpoint13_runs set choice=p_payload->>'choice',phase='puzzle' where id=r.id returning * into r;
 elsif p_action='puzzle' and r.phase='puzzle' then
  update public.checkpoint13_runs set phase='guess' where id=r.id returning * into r;
 elsif p_action='guess' and r.phase='guess' then
  if trim(coalesce(p_payload->>'guess',''))<>'果夫樓' then return jsonb_build_object('wrong',true); end if;
  update public.checkpoint13_runs set phase='success' where id=r.id returning * into r;
 elsif p_action='finish' and r.phase in ('success','finished') then
  update public.checkpoint13_runs set phase='finished' where id=r.id returning * into r;
  update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? '13' then completed_checkpoints else completed_checkpoints || '["13"]'::jsonb end where team_id=t.id returning * into p;
 elsif p_action not in ('get','enter') then return jsonb_build_object('error','目前無法進行此操作，請重新載入。','code','INVALID_PHASE'); end if;
 return jsonb_build_object('server_time',v_now,'progress',to_jsonb(p)-'team_id','run',jsonb_build_object('id',r.id,'checkpoint',13,'phase',r.phase,'choice',r.choice,'preview_seconds',case when r.choice='help' then 3 else 0 end));
end; $$;
revoke all on function public.checkpoint13_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint13_action(text,uuid,text,jsonb) to service_role;
commit;
