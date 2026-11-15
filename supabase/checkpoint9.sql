begin;
create table if not exists public.checkpoint9_runs (id uuid primary key default gen_random_uuid(), team_id uuid not null unique references public.teams(id), phase text not null default 'story', choice text);
alter table public.checkpoint9_runs enable row level security;
revoke all on public.checkpoint9_runs from public, anon, authenticated;
grant select,insert,update,delete on public.checkpoint9_runs to service_role;
create or replace function public.checkpoint9_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype; r public.checkpoint9_runs%rowtype; p public.team_game_progress%rowtype; cp integer; v_now timestamptz:=clock_timestamp();
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY'); end if;
 perform 1 from public.teams where id=t.id for update;
 insert into public.team_game_progress(team_id) values(t.id) on conflict do nothing;
 select * into p from public.team_game_progress where team_id=t.id;
 select * into r from public.checkpoint9_runs where team_id=t.id for update;
 if p_action='enter' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長開啟地點。','code','LEADER_REQUIRED'); end if;
  if not (p.completed_checkpoints ? '3') then return jsonb_build_object('error','請先完成地點 3。','code','CHECKPOINT_LOCKED'); end if;
  if p_payload ? 'code_hash' then
   select checkpoint_id into cp from public.checkpoint_codes where activity_id=p_activity and code_hash=p_payload->>'code_hash';
   if cp is distinct from 9 or (p_payload ? 'checkpoint' and (p_payload->>'checkpoint')::integer<>9) then return jsonb_build_object('error','地點代碼不正確。','code','CODE_INVALID'); end if;
  elsif r.id is null then return jsonb_build_object('error','請掃描地點 9 的 QR Code，或輸入現場代碼。','code','CODE_REQUIRED'); end if;
  if r.id is null then insert into public.checkpoint9_runs(team_id) values(t.id) returning * into r; end if;
 elsif p_action not in ('get','choose','answer','finish') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION'); end if;
 if r.id is null then return jsonb_build_object('run',null,'progress',to_jsonb(p)-'team_id','server_time',v_now); end if;
 if p_action not in ('get','enter') then
  if p_payload->>'run_id' is distinct from r.id::text then return jsonb_build_object('error','任務已更新，請重新載入。','code','STALE_RUN'); end if;
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長操作。','code','LEADER_REQUIRED'); end if;
 end if;
 if p_action='choose' and r.phase='story' then
  if coalesce(p_payload->>'choice','') not in ('help','tease') then return jsonb_build_object('error','請選擇有效選項。','code','INVALID_CHOICE'); end if;
  update public.checkpoint9_runs set choice=p_payload->>'choice',phase='answer' where id=r.id returning * into r;
 elsif p_action='answer' and r.phase='answer' then
  if coalesce(p_payload->>'answer','') !~ '^[0-9]{1,2}$' then return jsonb_build_object('error','請只輸入數字樓層。','code','INVALID_ANSWER'); end if;
  if p_payload->>'answer'<>'8' then return jsonb_build_object('wrong',true); end if;
  update public.checkpoint9_runs set phase='success' where id=r.id returning * into r;
 elsif p_action='finish' and r.phase in ('success','finished') then
  update public.checkpoint9_runs set phase='finished' where id=r.id returning * into r;
  update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? '9' then completed_checkpoints else completed_checkpoints || '["9"]'::jsonb end where team_id=t.id returning * into p;
 elsif p_action not in ('get','enter') then return jsonb_build_object('error','目前無法進行此操作，請重新載入。','code','INVALID_PHASE'); end if;
 return jsonb_build_object('server_time',v_now,'progress',to_jsonb(p)-'team_id','run',jsonb_build_object('id',r.id,'checkpoint',9,'phase',r.phase,'choice',r.choice));
end; $$;
revoke all on function public.checkpoint9_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint9_action(text,uuid,text,jsonb) to service_role;
commit;
