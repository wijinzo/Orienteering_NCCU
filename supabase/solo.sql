-- Apply after achievements.sql. Existing team and player records are preserved.
begin;
create or replace function public.register_solo_player(p_activity text,p_device_hash text,p_name text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_player uuid;v_team public.teams%rowtype;v_code text;result jsonb;v_members jsonb;
begin
 if coalesce(p_device_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(char_length(trim(p_name)),0) not between 1 and 20 then
  return jsonb_build_object('error','請輸入冒險者名字並使用可保存身分的瀏覽器。');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_activity || ':' || p_device_hash,0));
 select player_id into v_player from public.player_devices where activity_id=p_activity and device_hash=p_device_hash;
 if v_player is null then
  v_code:='S-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,18));
  result:=public.login_player(p_activity,v_code);v_player:=(result->'player'->>'id')::uuid;
  insert into public.player_devices values(p_activity,p_device_hash,v_player);
  v_members:=jsonb_build_array(jsonb_build_object('id',v_player,'code',v_code,'name',trim(p_name),'ready',true));
  insert into public.teams(activity_id,code,state) values(p_activity,v_code,jsonb_build_object(
   'mode','solo','phase','elected','round',0,'members',v_members,'leader_id',v_player,
   'electors','[]'::jsonb,'candidates','[]'::jsonb,'votes','{}'::jsonb)) returning * into v_team;
  insert into public.team_members(player_id,team_id) values(v_player,v_team.id);
 else
  perform 1 from public.players where id=v_player and activity_id=p_activity for update;
  select t.* into v_team from public.teams t join public.team_members m on m.team_id=t.id
  where m.player_id=v_player and t.activity_id=p_activity for update of t;
  if not found or v_team.state->>'mode' is distinct from 'solo' then
   return jsonb_build_object('error','個人身分不符，請重新登入。');
  end if;
  select jsonb_agg(value||jsonb_build_object('name',trim(p_name))) into v_members from jsonb_array_elements(v_team.state->'members');
  update public.teams set state=jsonb_set(state,'{members}',v_members) where id=v_team.id;
  select jsonb_build_object('player',to_jsonb(p),'progress',to_jsonb(g)-'player_id') into result
  from public.players p join public.player_progress g on g.player_id=p.id where p.id=v_player;
 end if;
 return result||public.team_action(p_activity,v_player,'get');
end;$$;
revoke all on function public.register_solo_player(text,text,text) from public,anon,authenticated;
grant execute on function public.register_solo_player(text,text,text) to service_role;

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
commit;
