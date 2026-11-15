-- Apply after all checkpoint SQL files. Each call uses one DB transaction, no background job.
begin;
create table if not exists public.story_ballots(
 id uuid primary key default gen_random_uuid(),team_id uuid not null references public.teams(id),run_id uuid not null,checkpoint integer not null,slot text not null,round integer not null,
 action text not null,options jsonb not null,electors uuid[] not null,captain uuid not null,deadline timestamptz,captain_choice text,result text,outcome jsonb,
 phase text not null default 'waiting' check(phase in('waiting','open','settled')),unique(team_id,run_id,slot,round));
alter table public.story_ballots add column if not exists settled_at timestamptz;
create table if not exists public.story_votes(ballot_id uuid not null references public.story_ballots(id),player_id uuid not null references public.players(id),choice text not null,primary key(ballot_id,player_id));
alter table public.story_ballots enable row level security;alter table public.story_votes enable row level security;
revoke all on public.story_ballots,public.story_votes from public,anon,authenticated;
grant select,insert,update on public.story_ballots,public.story_votes to service_role;
create or replace function public.story_core_action(p_activity text,p_player uuid,p_checkpoint integer,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 case p_checkpoint
 when 1 then return public.checkpoint1_action(p_activity,p_player,p_action,p_payload);
 when 2 then return public.checkpoint2_action(p_activity,p_player,p_action,p_payload);
 when 3 then return public.checkpoint3_action(p_activity,p_player,p_action,p_payload);
 when 4 then return public.checkpoint4_action(p_activity,p_player,p_action,p_payload);
 when 5 then return public.checkpoint5_action(p_activity,p_player,p_action,p_payload);
 when 7 then return public.checkpoint7_action(p_activity,p_player,p_action,p_payload);
 when 9 then return public.checkpoint9_action(p_activity,p_player,p_action,p_payload);
 when 10 then return public.checkpoint10_action(p_activity,p_player,p_action,p_payload);
 when 11 then return public.checkpoint11_action(p_activity,p_player,p_action,p_payload);
 when 12 then return public.checkpoint12_action(p_activity,p_player,p_action,p_payload);
 when 13 then return public.checkpoint13_action(p_activity,p_player,p_action,p_payload);
 else return jsonb_build_object('error','此地點不支援選項投票。','code','INVALID_CHECKPOINT');end case;
end;$$;
create or replace function public.story_vote_result(p_activity text,p_player uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare team uuid;b public.story_ballots%rowtype;
begin
 if p_data ? 'error' or p_data->'run'->>'id' is null then return p_data;end if;
 select m.team_id into team from public.team_members m join public.players p on p.id=m.player_id where p.id=p_player and p.activity_id=p_activity;
 select * into b from public.story_ballots where team_id=team and run_id=(p_data->'run'->>'id')::uuid and phase='settled' and not(checkpoint=10 and slot='reflection') order by settled_at desc nulls last,case when slot in('ending','reflection') then 2 else 1 end desc,round desc limit 1;
 if b.id is null then return p_data;end if;
 return p_data||jsonb_build_object('run',(p_data->'run')||jsonb_build_object('choice_result',jsonb_build_object('id',b.id,'slot',b.slot,'choice',b.result,'my_choice',(select choice from public.story_votes where ballot_id=b.id and player_id=p_player))));
end;$$;
revoke all on function public.story_vote_result(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.story_vote_result(text,uuid,jsonb) to service_role;
create or replace function public.story_game_action(p_activity text,p_player uuid,p_checkpoint integer,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;b public.story_ballots%rowtype;data jsonb;r jsonb;v_slot text;v_action text;v_options jsonb;v_round integer:=1;vote_action boolean;v_choice text;v_winner text;v_outcome jsonb;v_counts integer;v_ties integer;v_time timestamptz;
begin
 if p_action='enter' then
  data:=public.story_core_action(p_activity,p_player,p_checkpoint,p_action,p_payload);
  if data ? 'error' then return public.story_vote_result(p_activity,p_player,data);end if;
  return public.story_game_action(p_activity,p_player,p_checkpoint,'get','{}');
 end if;
 if p_checkpoint=10 and p_action='reflect' then return public.story_core_action(p_activity,p_player,p_checkpoint,p_action,p_payload);end if;
 vote_action:=p_action in('choose','reflect') or (p_checkpoint=10 and p_action='guess');
 if not vote_action and p_action<>'get' then return public.story_core_action(p_activity,p_player,p_checkpoint,p_action,p_payload);end if;
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY');end if;
 perform 1 from public.teams where id=t.id for update;
 data:=public.story_core_action(p_activity,p_player,p_checkpoint,'get','{}');r:=data->'run';
 if data ? 'error' then return public.story_vote_result(p_activity,p_player,data);end if;
 if r is null or r='null'::jsonb then
  if vote_action then return jsonb_build_object('error','請先開啟目前任務。','code','STALE_RUN');else return public.story_vote_result(p_activity,p_player,data);end if;
 end if;
 if vote_action and p_payload->>'run_id' is distinct from r->>'id' then return jsonb_build_object('error','任務已更新，請重新載入。','code','STALE_RUN');end if;
 -- Identify the actual scene; never trust an option list or captain ID supplied by the client.
 if p_checkpoint=10 and r->>'phase'='guess' then v_slot:='guess';v_action:='guess';v_options:='["nailong","pikachu","duck","egg"]';

 elsif p_checkpoint=5 and r->>'phase'='success' and (r->>'ending_choice') is null then v_slot:='ending';v_action:='choose';v_options:='["history","continue"]';
 elsif r->>'phase'='story' then
  v_slot:='intro';v_action:='choose';
  case p_checkpoint when 1 then v_options:='["genius","hint"]';when 2 then v_options:='["ask","ready"]';when 3 then v_options:='["egg","care"]';when 11 then v_options:='["question","promise"]';when 5,7,9,12,13 then v_options:='["help","tease"]';else v_slot:=null;end case;
 end if;
 if v_slot is null then
  if vote_action then
   -- Successful duplicate deliveries cannot create a second ballot or repeat a game effect.
   select * into b from public.story_ballots where team_id=t.id and run_id=(r->>'id')::uuid and action=p_action and phase='settled' order by round desc limit 1;
   if b.id is null then return jsonb_build_object('error','目前沒有待選擇的對話。','code','INVALID_PHASE');end if;
  end if;
  return public.story_vote_result(p_activity,p_player,data);
 end if;
 select * into b from public.story_ballots where team_id=t.id and run_id=(r->>'id')::uuid and slot=v_slot order by round desc limit 1;
 if b.id is not null and b.phase='settled' then v_round:=b.round+1;b:=null;elsif b.id is not null then v_round:=b.round;end if;
 v_time:=clock_timestamp();
 -- A late vote settles an expired ballot before it can affect the result.
 if vote_action then
  if p_action<>v_action or not (v_options ? coalesce(p_payload->>'choice','')) then return jsonb_build_object('error','請選擇有效選項。','code','INVALID_CHOICE');end if;
  if coalesce((p_payload->>'vote_round')::integer,1)<>v_round then return jsonb_build_object('error','選擇已結算，請重新讀取對話。','code','STALE_VOTE');end if;
  if b.id is null then
   insert into public.story_ballots(team_id,run_id,checkpoint,slot,round,action,options,electors,captain)
   values(t.id,(r->>'id')::uuid,p_checkpoint,v_slot,v_round,v_action,v_options,array(select player_id from public.team_members where team_id=t.id),(t.state->>'leader_id')::uuid) returning * into b;
  end if;
  if not (p_player=any(b.electors)) then return jsonb_build_object('error','你不在本次選擇的參與名單中。','code','NOT_ELECTOR');end if;
  if b.deadline is null or v_time<b.deadline then
   select choice into v_choice from public.story_votes where ballot_id=b.id and player_id=p_player;
   if v_choice is not null and v_choice<>p_payload->>'choice' then return jsonb_build_object('error','已收到你的選擇，請等待結果。','code','VOTE_FIXED');end if;
   insert into public.story_votes(ballot_id,player_id,choice) values(b.id,p_player,p_payload->>'choice') on conflict do nothing;
   if p_player=b.captain and b.deadline is null then update public.story_ballots set deadline=v_time+interval '10 seconds',captain_choice=p_payload->>'choice',phase='open' where id=b.id returning * into b;end if;
  end if;
 end if;
 if b.id is not null and b.phase='open' then
  select count(*) into v_counts from public.story_votes where ballot_id=b.id;
  if clock_timestamp()>=b.deadline or v_counts=cardinality(b.electors) then
   select choice into v_winner from public.story_votes where ballot_id=b.id group by choice order by count(*) desc,(choice=b.captain_choice) desc,choice asc limit 1;
   select count(*) into v_ties from (select count(*) n from public.story_votes where ballot_id=b.id group by choice) counts where n=(select max(n) from (select count(*) n from public.story_votes where ballot_id=b.id group by choice) all_counts);
   if v_ties>1 then v_winner:=b.captain_choice;end if;
   v_outcome:=public.story_core_action(p_activity,b.captain,p_checkpoint,b.action,jsonb_build_object('run_id',b.run_id,'choice',v_winner));
   if v_outcome ? 'error' then return v_outcome;end if;
   update public.story_ballots set phase='settled',settled_at=clock_timestamp(),result=v_winner,outcome=jsonb_build_object('wrong',coalesce((v_outcome->>'wrong')::boolean,false)) where id=b.id returning * into b;
   data:=public.story_core_action(p_activity,p_player,p_checkpoint,'get','{}');
   if coalesce((v_outcome->>'wrong')::boolean,false) then return public.story_vote_result(p_activity,p_player,data||jsonb_build_object('wrong',true,'run',(data->'run')||jsonb_build_object('vote_round',v_round+1,'vote_feedback','還差一點，再看看剪影，猜猜本龍是誰！')));end if;
   return public.story_vote_result(p_activity,p_player,data);
  end if;
 end if;
 return public.story_vote_result(p_activity,p_player,data||jsonb_build_object('run',r||jsonb_build_object('vote_round',v_round,'vote_slot',v_slot,'ballot',case when b.id is null then null else jsonb_build_object('id',b.id,'phase',b.phase,'deadline',b.deadline,'my_choice',(select choice from public.story_votes where ballot_id=b.id and player_id=p_player)) end)));
end;$$;
revoke all on function public.story_core_action(text,uuid,integer,text,jsonb),public.story_game_action(text,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.story_core_action(text,uuid,integer,text,jsonb),public.story_game_action(text,uuid,integer,text,jsonb) to service_role;
commit;
