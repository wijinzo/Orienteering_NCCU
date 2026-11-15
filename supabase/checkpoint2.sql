begin;
create table if not exists public.checkpoint2_runs(id uuid primary key default gen_random_uuid(),team_id uuid not null unique references public.teams(id),phase text not null default 'story',choice text,solved_by uuid references public.players(id));
create table if not exists public.checkpoint2_players(run_id uuid not null references public.checkpoint2_runs(id),player_id uuid not null references public.players(id),answered integer not null default 0,hints jsonb not null default '[]',since_hint integer not null default 0,primary key(run_id,player_id));
create table if not exists public.checkpoint2_messages(run_id uuid not null references public.checkpoint2_runs(id),player_id uuid not null references public.players(id),request_id uuid not null,question text not null,status text not null default 'pending',answer text,hint integer,created_at timestamptz not null default now(),primary key(run_id,player_id,request_id));
alter table public.checkpoint2_runs enable row level security;alter table public.checkpoint2_players enable row level security;alter table public.checkpoint2_messages enable row level security;
revoke all on public.checkpoint2_runs,public.checkpoint2_players,public.checkpoint2_messages from public,anon,authenticated;
grant select,insert,update,delete on public.checkpoint2_runs,public.checkpoint2_players,public.checkpoint2_messages to service_role;
create or replace function public.checkpoint2_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;r public.checkpoint2_runs%rowtype;p public.team_game_progress%rowtype;me public.checkpoint2_players%rowtype;msg public.checkpoint2_messages%rowtype;cp integer;n integer;focus integer;newhint integer;v_now timestamptz:=clock_timestamp();v_count integer;
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY');end if;
 perform 1 from public.teams where id=t.id for update;
 insert into public.team_game_progress(team_id) values(t.id) on conflict do nothing;
 select * into p from public.team_game_progress where team_id=t.id;
 select * into r from public.checkpoint2_runs where team_id=t.id for update;
 if p_action='enter' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長開啟地點。','code','LEADER_REQUIRED');end if;
  if p_payload ? 'code_hash' then
   select checkpoint_id into cp from public.checkpoint_codes where activity_id=p_activity and code_hash=p_payload->>'code_hash';
   if cp is distinct from 2 or (p_payload ? 'checkpoint' and (p_payload->>'checkpoint')::integer<>2) then return jsonb_build_object('error','地點代碼不正確。','code','CODE_INVALID');end if;
  elsif r.id is null then return jsonb_build_object('error','請掃描地點 2 的 QR Code，或輸入現場代碼。','code','CODE_REQUIRED');end if;
  if r.id is null then insert into public.checkpoint2_runs(team_id) values(t.id) returning * into r;end if;
 elsif p_action not in ('get','choose','reserve','complete','fail','guess','finish') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION');end if;
 if r.id is null then return jsonb_build_object('run',null,'progress',to_jsonb(p)-'team_id','server_time',v_now);end if;
 insert into public.checkpoint2_players(run_id,player_id) values(r.id,p_player) on conflict do nothing;
 select * into me from public.checkpoint2_players where run_id=r.id and player_id=p_player for update;
 if p_action not in ('get','enter') and p_payload->>'run_id' is distinct from r.id::text then return jsonb_build_object('error','任務已更新，請重新載入。','code','STALE_RUN');end if;
 if p_action='choose' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長選擇。','code','LEADER_REQUIRED');end if;
  if coalesce(p_payload->>'choice','') not in ('ask','ready') then return jsonb_build_object('error','選項不正確。','code','INVALID_CHOICE');end if;
  if r.phase='story' then update public.checkpoint2_runs set choice=p_payload->>'choice',phase='chat' where id=r.id returning * into r;end if;
 elsif p_action='reserve' then
  if r.phase<>'chat' then return jsonb_build_object('error','目前無法提問。','code','NOT_ACTIVE');end if;
  update public.checkpoint2_messages set status='failed' where run_id=r.id and player_id=p_player and status='pending' and created_at<v_now-interval '60 seconds';
  if exists(select 1 from public.checkpoint2_messages where run_id=r.id and player_id=p_player and status='pending' and request_id<>(p_payload->>'request_id')::uuid) then return jsonb_build_object('error','上一個問題處理中。','code','PENDING');end if;
  select * into msg from public.checkpoint2_messages where run_id=r.id and player_id=p_player and request_id=(p_payload->>'request_id')::uuid;
  if found then
   if msg.question<>p_payload->>'question' then return jsonb_build_object('error','請使用新的提問。','code','REQUEST_CONFLICT');end if;
   if msg.status='done' then return jsonb_build_object('duplicate',true);end if;
   if msg.status='pending' then return jsonb_build_object('error','問題處理中，請稍候。','code','PENDING');end if;
   update public.checkpoint2_messages set status='pending',created_at=v_now where run_id=r.id and player_id=p_player and request_id=msg.request_id;
  else
   if exists(select 1 from public.checkpoint2_messages where run_id=r.id and player_id=p_player and status='pending') then return jsonb_build_object('error','上一個問題處理中。','code','PENDING');end if;
   insert into public.checkpoint2_messages(run_id,player_id,request_id,question) values(r.id,p_player,(p_payload->>'request_id')::uuid,p_payload->>'question');
  end if;
 elsif p_action='fail' then
  update public.checkpoint2_messages set status='failed' where run_id=r.id and player_id=p_player and request_id=(p_payload->>'request_id')::uuid and status='pending';
 elsif p_action='complete' then
  select * into msg from public.checkpoint2_messages where run_id=r.id and player_id=p_player and request_id=(p_payload->>'request_id')::uuid for update;
  if not found then return jsonb_build_object('error','找不到問題。','code','NOT_FOUND');end if;
  if msg.status='pending' and r.phase='chat' then
   if coalesce(p_payload->>'answer','') not in ('yes','no','unknown','invalid') then return jsonb_build_object('error','回覆格式錯誤。','code','INVALID_REPLY');end if;
   focus:=coalesce((p_payload->>'focus')::integer,0);newhint:=null;
   if p_payload->>'answer' in ('yes','no') then
    me.answered:=me.answered+1;me.since_hint:=me.since_hint+1;
    if focus between 1 and 4 and not (me.hints ? focus::text) then newhint:=focus;
    elsif me.since_hint >= (case when jsonb_array_length(me.hints)=0 then 5 else 3 end) then
     select candidate into newhint from generate_series(1,4) candidate where not (me.hints ? candidate::text) order by candidate limit 1;
    end if;
    if newhint is not null then me.hints:=me.hints || to_jsonb(newhint::text);me.since_hint:=0;end if;
    update public.checkpoint2_players set answered=me.answered,since_hint=me.since_hint,hints=me.hints where run_id=r.id and player_id=p_player;
   end if;
   update public.checkpoint2_messages set status='done',answer=p_payload->>'answer',hint=newhint where run_id=r.id and player_id=p_player and request_id=msg.request_id;
  end if;
 elsif p_action='guess' then
  if r.phase='chat' then update public.checkpoint2_runs set phase='success',solved_by=p_player where id=r.id returning * into r;end if;
 elsif p_action='finish' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長完成劇情。','code','LEADER_REQUIRED');end if;
  if r.phase not in ('success','finished') then return jsonb_build_object('error','尚未猜對。','code','NOT_FINISHED');end if;
  update public.checkpoint2_runs set phase='finished' where id=r.id returning * into r;
  update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? '2' then completed_checkpoints else completed_checkpoints || '["2"]'::jsonb end where team_id=t.id returning * into p;
 end if;
 return jsonb_build_object('server_time',v_now,'progress',to_jsonb(p)-'team_id','run',jsonb_build_object('id',r.id,'checkpoint',2,'phase',r.phase,'choice',r.choice,'answered',me.answered,'hints',me.hints,'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',q.request_id,'question',q.question,'answer',q.answer,'hint',q.hint) order by q.created_at),'[]') from public.checkpoint2_messages q where q.run_id=r.id and q.player_id=p_player and q.status='done')));
end;
$$;
revoke all on function public.checkpoint2_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint2_action(text,uuid,text,jsonb) to service_role;
commit;
-- Resolve codes only on the trusted server; never return code hashes to clients.
create or replace function public.resolve_checkpoint_code(p_activity text,p_hash text) returns integer language sql security invoker set search_path='' as $$ select checkpoint_id from public.checkpoint_codes where activity_id=p_activity and code_hash=p_hash $$;
revoke all on function public.resolve_checkpoint_code(text,text) from public,anon,authenticated;
grant execute on function public.resolve_checkpoint_code(text,text) to service_role;
