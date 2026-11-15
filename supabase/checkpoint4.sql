begin;
create table if not exists public.checkpoint4_runs(id uuid primary key default gen_random_uuid(),team_id uuid not null unique references public.teams(id),phase text not null default 'loading',starts_at timestamptz,deadline timestamptz,passed boolean,reason text);
alter table public.checkpoint4_runs alter column phase set default 'loading',alter column starts_at drop not null,alter column deadline drop not null;
alter table public.checkpoint4_runs enable row level security;
revoke all on public.checkpoint4_runs from public,anon,authenticated;
grant select,insert,update,delete on public.checkpoint4_runs to service_role;
create or replace function public.checkpoint4_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;r public.checkpoint4_runs%rowtype;p public.team_game_progress%rowtype;cp integer;v_now timestamptz;normalized text;
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY');end if;
 perform 1 from public.teams where id=t.id for update;
 v_now:=clock_timestamp();
 insert into public.team_game_progress(team_id) values(t.id) on conflict do nothing;
 select * into p from public.team_game_progress where team_id=t.id;
 select * into r from public.checkpoint4_runs where team_id=t.id for update;
 if p_action='enter' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長開啟地點。','code','LEADER_REQUIRED');end if;
  if p_payload ? 'code_hash' then
   select checkpoint_id into cp from public.checkpoint_codes where activity_id=p_activity and code_hash=p_payload->>'code_hash';
   if cp is distinct from 4 or (p_payload ? 'checkpoint' and (p_payload->>'checkpoint')::integer<>4) then return jsonb_build_object('error','地點代碼不正確。','code','CODE_INVALID');end if;
  elsif r.id is null then return jsonb_build_object('error','請掃描地點 4 的 QR Code，或輸入現場代碼。','code','CODE_REQUIRED');end if;
  if r.id is null then insert into public.checkpoint4_runs(team_id) values(t.id) returning * into r;end if;
 elsif p_action not in ('get','ready','answer','finish') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION');end if;
 if r.id is null then return jsonb_build_object('run',null,'progress',to_jsonb(p)-'team_id','server_time',v_now);end if;
 if p_action not in ('get','enter') then
  if p_payload->>'run_id' is distinct from r.id::text then return jsonb_build_object('error','任務已更新。','code','STALE_RUN');end if;
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長操作。','code','LEADER_REQUIRED');end if;
 end if;
 if r.phase='running' and v_now>=r.deadline+interval '5 seconds' then update public.checkpoint4_runs set phase='settled',passed=false,reason='timeout' where id=r.id returning * into r;end if;
 if p_action='ready' and r.phase='loading' then update public.checkpoint4_runs set phase='running',starts_at=v_now+interval '10 seconds',deadline=v_now+interval '190 seconds' where id=r.id returning * into r;end if;
 if p_action='answer' and r.phase='loading' then return jsonb_build_object('error','請等待倒數開始。','code','NOT_STARTED');end if;
 if p_action='answer' and r.phase='running' then
  if v_now<r.starts_at then return jsonb_build_object('error','請等待倒數結束。','code','NOT_STARTED');end if;
  normalized:=regexp_replace(coalesce(p_payload->>'answer',''),'[[:space:][:punct:]，。！？、；：「」『』（）【】《》…—·]+','','g');
  if normalized='' then return jsonb_build_object('error','請輸入石碑文字。','code','INVALID_ANSWER');end if;
  update public.checkpoint4_runs set phase='settled',passed=normalized='不畏浮雲遮望眼自緣身在最高層',reason='answered' where id=r.id returning * into r;
 elsif p_action='finish' then
  if r.phase not in ('settled','finished') then return jsonb_build_object('error','尚未結算。','code','NOT_FINISHED');end if;
  update public.checkpoint4_runs set phase='finished' where id=r.id returning * into r;
 end if;
 if r.phase in ('settled','finished') then
  update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? '4' then completed_checkpoints else completed_checkpoints || '["4"]'::jsonb end,choices=choices||jsonb_build_object('branch_4_detour',not r.passed) where team_id=t.id returning * into p;
 end if;
 return jsonb_build_object('server_time',v_now,'progress',to_jsonb(p)-'team_id','run',jsonb_build_object('id',r.id,'checkpoint',4,'phase',r.phase,'starts_at',r.starts_at,'deadline',r.deadline,'passed',r.passed,'reason',r.reason,'next_id',case when r.passed then 12 else 6 end,'question','這樣吧，志希樓旁有顆小石頭，上面寫著什麼？限時3分鐘','instructions','請輸入石頭上的完整文字，共 14 個字，不含標點符號。'));
end; $$;
revoke all on function public.checkpoint4_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint4_action(text,uuid,text,jsonb) to service_role;
commit;
