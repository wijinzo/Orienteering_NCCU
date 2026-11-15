-- Incremental migration: apply after the existing game/prologue SQL. Defining the reset helper does not clear data.
begin;
alter table public.checkpoint3_players add column if not exists shots integer check(shots between 1 and 100000);
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
  if p_payload ? 'shots' and (jsonb_typeof(p_payload->'shots')<>'number' or (p_payload->>'shots') !~ '^[0-9]{1,6}$' or (p_payload->>'shots')::integer not between 1 and 100000) then return jsonb_build_object('error','彈射次數格式錯誤。','code','INVALID_SHOTS');end if;
  update public.checkpoint3_players set done=true,shots=(p_payload->>'shots')::integer where run_id=r.id and player_id=p_player and not done;
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

create table if not exists public.team_achievement_times(
 team_id uuid primary key references public.teams(id),started_at timestamptz,finished_at timestamptz);
create table if not exists public.activity_first_finish(
 activity_id text primary key,team_id uuid not null references public.teams(id),finished_at timestamptz not null);
alter table public.team_achievement_times enable row level security;
alter table public.activity_first_finish enable row level security;
revoke all on public.team_achievement_times,public.activity_first_finish from public,anon,authenticated;
grant select,insert,update,delete on public.team_achievement_times,public.activity_first_finish to service_role;

create or replace function public.track_achievement_start() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.finished_at is not null and new.choices ?& array['help','depart'] then
  insert into public.team_achievement_times(team_id,started_at) values(new.team_id,new.finished_at)
  on conflict(team_id) do update set started_at=coalesce(public.team_achievement_times.started_at,excluded.started_at);
 end if;return new;
end;$$;
create or replace function public.track_achievement_finish() returns trigger language plpgsql security invoker set search_path='' as $$
declare v_time timestamptz;v_activity text;
begin
 if new.completed_checkpoints ? '10' then
  if tg_op='UPDATE' then if old.completed_checkpoints ? '10' then return new;end if;end if;
  v_time:=clock_timestamp();select activity_id into v_activity from public.teams where id=new.team_id;
  insert into public.team_achievement_times(team_id,finished_at) values(new.team_id,v_time)
  on conflict(team_id) do update set finished_at=coalesce(public.team_achievement_times.finished_at,excluded.finished_at);
  -- One unique activity row: simultaneous completions cannot award two winning teams.
  if not exists(select 1 from public.teams where id=new.team_id and state->>'mode'='solo') then
   insert into public.activity_first_finish values(v_activity,new.team_id,v_time) on conflict(activity_id) do nothing;
  end if;
 end if;return new;
end;$$;
create or replace function public.track_achievement_checkpoint_start() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.team_achievement_times(team_id,started_at) values(new.team_id,clock_timestamp())
 on conflict(team_id) do update set started_at=coalesce(public.team_achievement_times.started_at,excluded.started_at);
 return new;
end;$$;
drop trigger if exists achievement_start on public.prologue_runs;
create trigger achievement_start after insert or update of finished_at on public.prologue_runs for each row execute function public.track_achievement_start();
drop trigger if exists achievement_finish on public.team_game_progress;
create trigger achievement_finish after insert or update of completed_checkpoints on public.team_game_progress for each row execute function public.track_achievement_finish();
drop trigger if exists achievement_checkpoint_start on public.team_current_checkpoint;
create trigger achievement_checkpoint_start after insert on public.team_current_checkpoint for each row execute function public.track_achievement_checkpoint_start();
revoke all on function public.track_achievement_start(),public.track_achievement_finish() from public,anon,authenticated;
grant execute on function public.track_achievement_start(),public.track_achievement_finish() to service_role;
revoke all on function public.track_achievement_checkpoint_start() from public,anon,authenticated;
grant execute on function public.track_achievement_checkpoint_start() to service_role;

-- Existing timestamps can be recovered; do not invent start/shot counts for older runs.
insert into public.team_achievement_times(team_id,started_at)
select team_id,finished_at from public.prologue_runs where finished_at is not null and choices ?& array['help','depart']
on conflict(team_id) do update set started_at=coalesce(public.team_achievement_times.started_at,excluded.started_at);
insert into public.team_achievement_times(team_id,finished_at)
select t.id,min(r.read_at) from public.teams t join public.team_game_progress p on p.team_id=t.id and p.completed_checkpoints ? '10'
join public.checkpoint10_runs g on g.team_id=t.id join public.checkpoint10_readers r on r.run_id=g.id and r.player_id::text=t.state->>'leader_id'
group by t.id on conflict(team_id) do update set finished_at=coalesce(public.team_achievement_times.finished_at,excluded.finished_at);
insert into public.activity_first_finish(activity_id,team_id,finished_at)
select distinct on(t.activity_id) t.activity_id,a.team_id,a.finished_at from public.team_achievement_times a join public.teams t on t.id=a.team_id
where a.finished_at is not null and coalesce(t.state->>'mode','team')<>'solo' order by t.activity_id,a.finished_at,a.team_id on conflict(activity_id) do nothing;

create or replace function public.get_achievements(p_activity text,p_player uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;times public.team_achievement_times%rowtype;winner public.activity_first_finish%rowtype;
 done jsonb;n integer;guesses integer;solved boolean;personal_note boolean;shot_count integer;pinball_done boolean;game_started boolean;
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players p on p.id=m.player_id where p.id=p_player and p.activity_id=p_activity;
 if not found then return jsonb_build_object('error','請先加入隊伍。','code','TEAM_NOT_READY');end if;
 select completed_checkpoints into done from public.team_game_progress where team_id=t.id;
 select * into times from public.team_achievement_times where team_id=t.id;
 select * into winner from public.activity_first_finish where activity_id=p_activity;
 select count(*) into n from generate_series(1,13) id where coalesce(done,'[]'::jsonb) ? id::text;
 select count(*),coalesce(bool_or(g.a=4),false) into guesses,solved from public.checkpoint5_guesses g join public.checkpoint5_runs r on r.id=g.run_id where r.team_id=t.id;
 select exists(select 1 from public.checkpoint10_notes note join public.checkpoint10_readers reader on reader.run_id=note.run_id and reader.player_id=note.player_id join public.checkpoint10_runs r on r.id=note.run_id where r.team_id=t.id and note.player_id=p_player) into personal_note;
 select p.shots,p.done into shot_count,pinball_done from public.checkpoint3_players p join public.checkpoint3_runs r on r.id=p.run_id where r.team_id=t.id and p.player_id=p_player;
 select exists(select 1 from public.checkpoint3_runs where team_id=t.id) into game_started;
 return jsonb_build_object('server_time',clock_timestamp(),'mode',coalesce(t.state->>'mode','team'),'timing',jsonb_build_object('started_at',times.started_at,'finished_at',times.finished_at),
 'achievements',jsonb_build_array(
  jsonb_build_object('code','first_finish','scope','team','unlocked',coalesce(winner.team_id=t.id,false),'status',case when t.state->>'mode'='solo' then 'not_applicable' when winner.team_id=t.id then 'unlocked' when winner.team_id is not null then 'missed' else 'pending' end),
  jsonb_build_object('code','all_locations','scope','team','unlocked',n=13,'progress',n,'target',13),
  jsonb_build_object('code','cipher_master','scope','team','unlocked',solved and guesses between 1 and 5,'progress',guesses,'target',5,'status',case when guesses>5 then 'missed' else 'pending' end),
  jsonb_build_object('code','memory_collector','scope','personal','unlocked',personal_note),
  jsonb_build_object('code','pinball_star','scope','personal','unlocked',coalesce(pinball_done and shot_count between 1 and 3,false),'shots',shot_count,'status',case when pinball_done and shot_count is null then 'unknown' when shot_count>3 then 'missed' when game_started then 'pending' else 'locked' end)
 ));
end;$$;
revoke all on function public.get_achievements(text,uuid) from public,anon,authenticated;
grant execute on function public.get_achievements(text,uuid) to service_role;

create or replace function public.reset_game_data(p_activity text,p_confirm text,p_team_number integer default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ids uuid[];v_players uuid[];entry text[];table_name text;expected text;
begin
 if p_team_number is not null and p_team_number not between 1 and 10 then raise exception '組別必須是 1～10 或 NULL（全場）。';end if;
 expected:='RESET '||p_activity||' '||coalesce(p_team_number::text,'ALL');
 if p_confirm is distinct from expected then raise exception '重置確認文字不符；未變更任何資料。';end if;
 perform pg_advisory_xact_lock(hashtextextended('reset:'||p_activity,0));
 perform 1 from public.teams where activity_id=p_activity and (p_team_number is null or code=lpad(p_team_number::text,2,'0')) order by id for update;
 select array_agg(id) into ids from public.teams where activity_id=p_activity and (p_team_number is null or code=lpad(p_team_number::text,2,'0'));
 if ids is null then return jsonb_build_object('reset_teams',0,'reset_players',0);end if;
 select array_agg(player_id) into v_players from public.team_members where team_id=any(ids);
 delete from public.activity_first_finish where team_id=any(ids);
 delete from public.story_votes where ballot_id in(select id from public.story_ballots where team_id=any(ids));
 delete from public.story_ballots where team_id=any(ids);
 delete from public.team_current_checkpoint where team_id=any(ids);
 foreach entry slice 1 in array array[
  ['checkpoint_answers','checkpoint_runs'],['checkpoint11_photos','checkpoint11_runs'],
  ['checkpoint2_messages','checkpoint2_runs'],['checkpoint2_players','checkpoint2_runs'],
  ['checkpoint3_players','checkpoint3_runs'],['checkpoint5_guesses','checkpoint5_runs'],
  ['checkpoint10_notes','checkpoint10_runs'],['checkpoint10_reflections','checkpoint10_runs'],['checkpoint10_readers','checkpoint10_runs']
 ] loop
  execute format('delete from public.%I where run_id in(select id from public.%I where team_id=any($1))',entry[1],entry[2]) using ids;
 end loop;
 foreach table_name in array array['checkpoint_runs','checkpoint11_runs','checkpoint2_runs','checkpoint13_runs','checkpoint3_runs','checkpoint9_runs','checkpoint4_runs','checkpoint12_runs','checkpoint5_runs','checkpoint7_runs','checkpoint10_runs','detour_runs','prologue_runs','team_game_progress','memory_reconstruction','team_achievement_times','game_presence'] loop
  execute format('delete from public.%I where team_id=any($1)',table_name) using ids;
 end loop;
 delete from public.player_devices where player_id=any(v_players);
 delete from public.player_progress where player_id=any(v_players);
 delete from public.team_members where team_id=any(ids);
 delete from public.players where id=any(v_players);
 delete from public.teams where id=any(ids);
 delete from public.team_player_counters where activity_id=p_activity and (p_team_number is null or team_number=p_team_number);
 -- If only one team was reset, preserve the first eligible finisher among remaining teams.
 insert into public.activity_first_finish(activity_id,team_id,finished_at)
 select t.activity_id,a.team_id,a.finished_at from public.team_achievement_times a join public.teams t on t.id=a.team_id
 where t.activity_id=p_activity and a.finished_at is not null and coalesce(t.state->>'mode','team')<>'solo' order by a.finished_at,a.team_id limit 1 on conflict(activity_id) do nothing;
 return jsonb_build_object('reset_teams',cardinality(ids),'reset_players',coalesce(cardinality(v_players),0));
end;$$;
revoke all on function public.reset_game_data(text,text,integer) from public,anon,authenticated,service_role;
-- Only the database owner (SQL Editor), not the game server/API roles, can reset data.

commit;
