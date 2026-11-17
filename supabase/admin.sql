-- Apply after solo.sql and team-recovery.sql. Installing this migration does not reset data.
begin;
create table if not exists public.admin_audit_log(
 id uuid primary key default gen_random_uuid(),activity_id text not null,request_id uuid not null,
 actor text not null,action text not null check(action in('leader','reset','pass','remove')),team_id uuid not null,team_code text not null,
 request_payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(activity_id,request_id)
);
alter table public.admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check check(action in('leader','reset','pass','remove'));
create index if not exists admin_audit_activity_time on public.admin_audit_log(activity_id,created_at desc,id);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public,anon,authenticated,service_role;
grant select on public.admin_audit_log to service_role;

create or replace function public.admin_team_snapshot(p_activity text,p_team uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;a public.team_current_checkpoint%rowtype;v_table text;v_phase text;v_wait uuid[]:='{}';members jsonb;ballot jsonb;v_ballot public.story_ballots%rowtype;v_reason text;
begin
 select * into t from public.teams where id=p_team and activity_id=p_activity;
 if not found then return null;end if;
 select * into a from public.team_current_checkpoint where team_id=t.id;
 v_table:=case a.checkpoint when 1 then 'checkpoint_runs' when 2 then 'checkpoint2_runs' when 3 then 'checkpoint3_runs' when 4 then 'checkpoint4_runs' when 5 then 'checkpoint5_runs' when 6 then 'detour_runs' when 7 then 'checkpoint7_runs' when 8 then 'detour_runs' when 9 then 'checkpoint9_runs' when 10 then 'checkpoint10_runs' when 11 then 'checkpoint11_runs' when 12 then 'checkpoint12_runs' when 13 then 'checkpoint13_runs' end;
 if v_table is not null then execute format('select phase from public.%I where id=$1',v_table) into v_phase using a.run_id;end if;
 if t.state->>'phase'='lobby' then
  select array_agg((value->>'id')::uuid) into v_wait from jsonb_array_elements(t.state->'members') where value->>'ready'<>'true';v_reason:='尚未準備出發';
 elsif t.state->>'phase'='voting' then
  select array_agg(value::uuid) into v_wait from jsonb_array_elements_text(t.state->'electors') where not(t.state->'votes' ? value);v_reason:='尚未投隊長票';
 elsif a.checkpoint=1 and v_phase in('loading','running') then
  select array_agg(player_id) into v_wait from public.checkpoint_answers where run_id=a.run_id and (case when v_phase='loading' then not ready else answer is null end);
  v_reason:=case when v_phase='loading' then '題目尚未準備好' else '尚未提交答案' end;
 elsif a.checkpoint=3 and v_phase='play' then
  select array_agg(player_id) into v_wait from public.checkpoint3_players where run_id=a.run_id and not done and not skipped;
  v_reason:='彈珠尚未完成';
 elsif a.checkpoint=11 and v_phase='search' then
  select array_agg(distinct cp.assigned_to) into v_wait from public.checkpoint11_photos cp where cp.run_id=a.run_id and not cp.found and cp.assigned_to is not null;
  v_reason:='照片尚未找到';
 end if;
 select * into v_ballot from public.story_ballots b where b.team_id=t.id and b.phase in('waiting','open') order by b.deadline desc nulls last,b.id limit 1;
 if found then
  ballot:=jsonb_build_object('phase',v_ballot.phase,'deadline',v_ballot.deadline,'submitted',(select count(*) from public.story_votes where ballot_id=v_ballot.id),'total',cardinality(v_ballot.electors));
  if coalesce(cardinality(v_wait),0)=0 then
   select array_agg(e.id) into v_wait from unnest(v_ballot.electors) e(id) where not exists(select 1 from public.story_votes where ballot_id=v_ballot.id and player_id=e.id);v_reason:='尚未選擇對話';
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'code',p.player_code,'name',m.value->>'name','ready',m.value->'ready','last_seen_at',gp.seen_at,'last_login_at',p.last_login_at,'waiting',p.id=any(coalesce(v_wait,'{}'::uuid[])),'waiting_reason',v_reason) order by p.player_code),'[]') into members
 from jsonb_array_elements(t.state->'members') m(value) join public.players p on p.id::text=m.value->>'id'
 left join public.game_presence gp on gp.player_id=p.id where p.activity_id=p_activity;
 return jsonb_build_object('id',t.id,'code',t.code,'mode',coalesce(t.state->>'mode','team'),'phase',t.state->>'phase','leader_id',t.state->>'leader_id','members',members,
 'captain_vote',jsonb_build_object('submitted',(select count(*) from jsonb_each(t.state->'votes')),'total',jsonb_array_length(t.state->'electors')),
 'current_checkpoint',a.checkpoint,'current_run_id',a.run_id,'game_phase',v_phase,'ballot',ballot,
 'completed_checkpoints',coalesce((select completed_checkpoints from public.team_game_progress where team_id=t.id),'[]'),
 'started_at',(select started_at from public.team_achievement_times where team_id=t.id),'finished_at',(select finished_at from public.team_achievement_times where team_id=t.id));
end;$$;

create or replace function public.admin_overview(p_activity text,p_offset integer default 0) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare formal jsonb:='[]';solo jsonb:='[]';n integer;t record;snapshot jsonb;
begin
 if p_offset is null or p_offset<0 or p_offset>100000 then return jsonb_build_object('error','分頁格式錯誤。');end if;
 for n in 1..10 loop
  select id into t from public.teams where activity_id=p_activity and code=lpad(n::text,2,'0');
  snapshot:=public.admin_team_snapshot(p_activity,t.id);
  formal:=formal||jsonb_build_array(coalesce(snapshot,jsonb_build_object('id',null,'code',lpad(n::text,2,'0'),'mode','team','phase','empty','members','[]'::jsonb,'completed_checkpoints','[]'::jsonb)));
 end loop;
 for t in select id from public.teams where activity_id=p_activity and state->>'mode'='solo' order by id limit 50 offset p_offset loop
  solo:=solo||jsonb_build_array(public.admin_team_snapshot(p_activity,t.id));
 end loop;
 return jsonb_build_object('activity_id',p_activity,'server_time',clock_timestamp(),'teams',formal,'solo',solo,'solo_offset',p_offset,'solo_total',(select count(*) from public.teams where activity_id=p_activity and state->>'mode'='solo'));
end;$$;

create or replace function public.admin_logs(p_activity text,p_offset integer default 0) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if p_offset is null or p_offset<0 or p_offset>100000 then return jsonb_build_object('error','分頁格式錯誤。');end if;
 return jsonb_build_object('logs',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') from
  (select id,actor,action,team_code,request_payload->>'reason' as reason,result,created_at from public.admin_audit_log where activity_id=p_activity order by created_at desc,id limit 50 offset p_offset)x),
  'total',(select count(*) from public.admin_audit_log where activity_id=p_activity),'offset',p_offset,'server_time',clock_timestamp());
end;$$;

-- Owner wrapper only: no public or service-role entry point for bypassing a game.
create or replace function public.admin_pass_current(p_team uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.team_current_checkpoint%rowtype;v_table text;v_phase text;v_count integer;v_time timestamptz:=clock_timestamp();
begin
 select * into a from public.team_current_checkpoint where team_id=p_team;
 if a.run_id is null or a.run_id::text is distinct from p_payload->>'run_id' or a.checkpoint::text is distinct from p_payload->>'checkpoint' then
  return jsonb_build_object('error','目前地點已變更，請重新開啟隊伍確認。','code','ADMIN_STALE');end if;
 v_table:=case a.checkpoint when 1 then 'checkpoint_runs' when 6 then 'detour_runs' when 8 then 'detour_runs' else 'checkpoint'||a.checkpoint||'_runs' end;
 execute format('select phase from public.%I where id=$1 and team_id=$2 for update',v_table) into v_phase using a.run_id,p_team;
 if v_phase is null or v_phase='finished' then return jsonb_build_object('error','此關已結束或不存在，未變更資料。','code','ALREADY_FINISHED');end if;
 -- Cancel unfinished votes before marking a run finished, so a later read cannot settle them.
 delete from public.story_votes where ballot_id in(select id from public.story_ballots where team_id=p_team and run_id=a.run_id and phase<>'settled');
 delete from public.story_ballots where team_id=p_team and run_id=a.run_id and phase<>'settled';
 if a.checkpoint=1 then
  update public.checkpoint_runs set phase='finished',passed=true where id=a.run_id;
 elsif a.checkpoint=4 then
  update public.checkpoint4_runs set phase='finished',passed=true,reason='admin' where id=a.run_id;
 elsif a.checkpoint in(6,8) then
  update public.detour_runs set phase='finished',finished_at=coalesce(finished_at,v_time) where id=a.run_id;
 else
  execute format('update public.%I set phase=''finished'' where id=$1',v_table) using a.run_id;
 end if;
 -- Preserve real scores; unfinished participants receive no fabricated success/achievement.
 if a.checkpoint=3 then update public.checkpoint3_players set skipped=true where run_id=a.run_id and not done;end if;
 if a.checkpoint=11 then update public.checkpoint11_handoffs set status='cancelled' where run_id=a.run_id and status='pending';end if;
 insert into public.team_game_progress(team_id) values(p_team) on conflict do nothing;
 update public.team_game_progress set
  completed_checkpoints=case when completed_checkpoints ? a.checkpoint::text then completed_checkpoints else completed_checkpoints||jsonb_build_array(a.checkpoint::text) end,
  choices=choices||case when a.checkpoint=1 then '{"branch_1_detour":false}'::jsonb when a.checkpoint=4 then '{"branch_4_detour":false}'::jsonb else '{}'::jsonb end||
   jsonb_build_object('admin_passes',coalesce(choices->'admin_passes','{}'::jsonb)||jsonb_build_object(a.run_id::text,jsonb_build_object('checkpoint',a.checkpoint,'at',v_time)))
 where team_id=p_team;
 return jsonb_build_object('ok',true,'checkpoint',a.checkpoint,'run_id',a.run_id,'previous_phase',v_phase,'passed_at',v_time);
end;$$;
revoke all on function public.admin_pass_current(uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.admin_remove_member(p_team uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;target uuid;person public.players%rowtype;members jsonb;ids jsonb;r public.checkpoint3_runs%rowtype;v_photo record;recipient uuid;freed integer:=0;
begin
 select * into t from public.teams where id=p_team;
 if coalesce(p_payload->>'player_id','') !~ '^[0-9a-fA-F-]{36}$' then return jsonb_build_object('error','請重新選擇隊員。','code','INVALID_MEMBER');end if;
 target:=(p_payload->>'player_id')::uuid;
 select p.* into person from public.players p join public.team_members m on m.player_id=p.id where m.team_id=t.id and p.id=target;
 if not found then return jsonb_build_object('error','隊員已離隊，請重新載入。','code','ADMIN_STALE');end if;
 if p_payload->>'confirm' is distinct from person.player_code then return jsonb_build_object('error','玩家編號確認不正確。','code','REMOVE_CONFIRM_INVALID');end if;
 if t.state->>'leader_id'=target::text then return jsonb_build_object('error','請先更換隊長，再移除此人。','code','LEADER_REMOVE_BLOCKED');end if;
 if (select count(*) from public.team_members where team_id=t.id)<=1 then return jsonb_build_object('error','不能移除最後一名隊員；需要清空請使用重設隊伍。','code','LAST_MEMBER');end if;
 select coalesce(jsonb_agg(value),'[]') into members from jsonb_array_elements(t.state->'members') where value->>'id'<>target::text;
 select coalesce(jsonb_agg(value->'id'),'[]') into ids from jsonb_array_elements(members);
 update public.teams set state=state||jsonb_build_object('members',members)||case when state->>'phase'='voting' then jsonb_build_object('electors',ids,'candidates',ids,'votes','{}'::jsonb,'round',(state->>'round')::integer+1) else '{}'::jsonb end where id=t.id;
 -- Retain the player and submitted game records, but revoke access and free the device.
 delete from public.player_devices where player_id=target and activity_id=t.activity_id;
 delete from public.team_members where player_id=target;
 delete from public.game_presence where player_id=target;
 update public.story_ballots set electors=array_remove(electors,target) where team_id=t.id and phase<>'settled';
 delete from public.story_votes where player_id=target and ballot_id in(select id from public.story_ballots where team_id=t.id and phase<>'settled');
 delete from public.checkpoint_answers where player_id=target and answer is null and run_id in(select id from public.checkpoint_runs where team_id=t.id and phase in('story','loading','running'));
 delete from public.checkpoint3_players where player_id=target and not done and run_id in(select id from public.checkpoint3_runs where team_id=t.id and phase<>'finished');
 update public.checkpoint3_runs c set phase='success' where c.team_id=t.id and c.phase='play' and not exists(select 1 from public.checkpoint3_players gp where gp.run_id=c.id and not gp.done and not gp.skipped);
 update public.checkpoint11_handoffs set status='cancelled' where status='pending' and (from_player=target or to_player=target) and run_id in(select id from public.checkpoint11_runs where team_id=t.id);
 update public.checkpoint11_photos cp set assigned_to=null where cp.assigned_to=target and not cp.found and cp.run_id in(select id from public.checkpoint11_runs where team_id=t.id and phase in('story','search'));
 get diagnostics freed=row_count;
 -- Give available photos to free remaining players immediately; surplus stays in the normal queue.
 for v_photo in select cp.run_id,cp.photo from public.checkpoint11_photos cp join public.checkpoint11_runs cr on cr.id=cp.run_id where cr.team_id=t.id and cr.phase in('story','search') and cp.assigned_to is null and not cp.found order by cp.photo loop
  select m.player_id into recipient from public.team_members m where m.team_id=t.id and not exists(select 1 from public.checkpoint11_photos cp where cp.run_id=v_photo.run_id and cp.assigned_to=m.player_id and not cp.found) order by m.player_id limit 1;
  if recipient is not null then update public.checkpoint11_photos set assigned_to=recipient where run_id=v_photo.run_id and checkpoint11_photos.photo=v_photo.photo;end if;
 end loop;
 return jsonb_build_object('ok',true,'team_code',t.code,'player_id',target,'player_code',person.player_code,'player_name',(select value->>'name' from jsonb_array_elements(t.state->'members') where value->>'id'=target::text),'released_photos',freed);
end;$$;
revoke all on function public.admin_remove_member(uuid,jsonb) from public,anon,authenticated,service_role;

-- Only this narrow wrapper runs with owner privileges. The owner-only reset helper
-- remains inaccessible to the server role; confirmation and audit share one transaction.
create or replace function public.admin_game_action(p_activity text,p_actor text,p_request uuid,p_action text,p_team uuid,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.teams%rowtype;entry public.admin_audit_log%rowtype;result jsonb;old_leader text;target uuid;cancelled integer;v_hash text;
begin
 if p_activity is null or p_request is null or p_actor is null or length(p_actor) not between 1 and 100 or p_action is null or p_action not in('leader','reset','pass','remove') or coalesce(length(trim(p_payload->>'reason')),0) not between 1 and 200 then return jsonb_build_object('error','管理操作資料不完整。','code','ADMIN_INPUT_INVALID');end if;
 perform pg_advisory_xact_lock(hashtextextended('admin:'||p_activity,0));
 select * into entry from public.admin_audit_log where activity_id=p_activity and request_id=p_request;
 if found then
  if entry.action<>p_action or entry.team_id<>p_team or entry.request_payload<>p_payload then return jsonb_build_object('error','操作識別碼已使用，請重新載入。','code','REQUEST_CONFLICT');end if;
  return entry.result||jsonb_build_object('duplicate',true);
 end if;
 -- Match registration's device-before-team lock order.
 if p_action='remove' and coalesce(p_payload->>'player_id','') ~ '^[0-9a-fA-F-]{36}$' then
  select device_hash into v_hash from public.player_devices where activity_id=p_activity and player_id=(p_payload->>'player_id')::uuid;
  if v_hash is not null then perform pg_advisory_xact_lock(hashtextextended(p_activity||':'||v_hash,0));end if;
 end if;
 select * into t from public.teams where id=p_team and activity_id=p_activity for update;
 if not found then return jsonb_build_object('error','隊伍已變更或不存在，請重新載入。','code','TEAM_NOT_FOUND');end if;
 if t.state->>'mode'='solo' or t.code !~ '^(0[1-9]|10)$' then return jsonb_build_object('error','第一版僅管理正式 1～10 組，個人模式僅供查看。','code','SOLO_READ_ONLY');end if;
 if p_action='leader' then
  old_leader:=t.state->>'leader_id';
  if p_payload->>'expected_leader' is distinct from old_leader then return jsonb_build_object('error','隊長已變更，請重新確認名單。','code','ADMIN_STALE');end if;
  if coalesce(p_payload->>'leader_id','') !~ '^[0-9a-fA-F-]{36}$' then return jsonb_build_object('error','請選擇新隊長。');end if;
  target:=(p_payload->>'leader_id')::uuid;
  if not exists(select 1 from public.team_members where team_id=t.id and player_id=target) or not exists(select 1 from jsonb_array_elements(t.state->'members') where value->>'id'=target::text and length(trim(value->>'name'))>0) then return jsonb_build_object('error','請選擇此組已填名字的隊員。','code','INVALID_LEADER');end if;
  if target::text=old_leader then return jsonb_build_object('error','此人已是隊長。','code','ALREADY_LEADER');end if;
  select count(*) into cancelled from public.story_ballots where team_id=t.id and phase<>'settled';
  delete from public.story_votes where ballot_id in(select id from public.story_ballots where team_id=t.id and phase<>'settled');
  delete from public.story_ballots where team_id=t.id and phase<>'settled';
  update public.teams set state=state||jsonb_build_object('phase','elected','leader_id',target,'round',coalesce((state->>'round')::integer,0)+1,'votes','{}'::jsonb,'electors','[]'::jsonb,'candidates','[]'::jsonb) where id=t.id;
  result:=jsonb_build_object('ok',true,'team_code',t.code,'old_leader',old_leader,'leader_id',target,'restarted_ballots',cancelled,
   'old_leader_name',(select coalesce(value->>'name',value->>'code') from jsonb_array_elements(t.state->'members') where value->>'id'=old_leader),
   'leader_name',(select coalesce(value->>'name',value->>'code') from jsonb_array_elements(t.state->'members') where value->>'id'=target::text));
 elsif p_action='remove' then
  result:=public.admin_remove_member(t.id,p_payload);
  if result ? 'error' then return result;end if;
 elsif p_action='pass' then
  if p_payload->>'confirm' is distinct from t.code then return jsonb_build_object('error','組號確認不正確，未變更資料。','code','PASS_CONFIRM_INVALID');end if;
  if t.state->>'phase'<>'elected' then return jsonb_build_object('error','隊伍尚未開始探索。','code','TEAM_NOT_READY');end if;
  result:=public.admin_pass_current(t.id,p_payload);
  if result ? 'error' then return result;end if;
  result:=result||jsonb_build_object('team_code',t.code);
 else
  if p_payload->>'confirm' is distinct from t.code then return jsonb_build_object('error','請輸入正確的兩位數組號，未變更任何資料。','code','RESET_CONFIRM_INVALID');end if;
  result:=public.reset_game_data(p_activity,'RESET '||p_activity||' '||(t.code::integer)::text,t.code::integer)||jsonb_build_object('ok',true,'team_code',t.code);
 end if;
 insert into public.admin_audit_log(activity_id,request_id,actor,action,team_id,team_code,request_payload,result) values(p_activity,p_request,p_actor,p_action,t.id,t.code,p_payload,result);
 return result;
end;$$;
revoke all on function public.admin_team_snapshot(text,uuid),public.admin_overview(text,integer),public.admin_logs(text,integer),public.admin_game_action(text,text,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_team_snapshot(text,uuid),public.admin_overview(text,integer),public.admin_logs(text,integer),public.admin_game_action(text,text,uuid,text,uuid,jsonb) to service_role;
commit;
