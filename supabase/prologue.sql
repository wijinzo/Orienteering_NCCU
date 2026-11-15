-- Apply after story-votes.sql and team-checkpoint.sql. Opening choices use the same ballot tables.
begin;
create table if not exists public.prologue_runs(
 id uuid primary key default gen_random_uuid(),team_id uuid unique not null references public.teams(id),
 choices jsonb not null default '{}',finished_at timestamptz);
alter table public.prologue_runs enable row level security;
revoke all on public.prologue_runs from public,anon,authenticated;
grant select,insert,update on public.prologue_runs to service_role;
create or replace function public.prologue_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;r public.prologue_runs%rowtype;b public.story_ballots%rowtype;
 v_slot text;opts jsonb;winner text;n integer;v_now timestamptz;
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players p on p.id=m.player_id where p.id=p_player and p.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY');end if;
 perform 1 from public.teams where id=t.id for update;
 insert into public.prologue_runs(team_id,finished_at) values(t.id,case when exists(select 1 from public.team_current_checkpoint where team_id=t.id) then clock_timestamp() end) on conflict do nothing;
 select * into r from public.prologue_runs where team_id=t.id;
 if p_action not in('get','choose','finish') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION');end if;
 if p_action<>'get' and p_payload->>'run_id' is distinct from r.id::text then return jsonb_build_object('error','開場已更新，請重新載入。','code','STALE_RUN');end if;
 v_slot:=case when not(r.choices ? 'help') then 'help' when not(r.choices ? 'depart') then 'depart' end;
 opts:=case when v_slot='help' then '["yes","guardian","reward"]'::jsonb else '["ready","where","first"]'::jsonb end;
 if v_slot is not null and r.finished_at is null then
  select * into b from public.story_ballots where team_id=t.id and run_id=r.id and slot=v_slot;
  v_now:=clock_timestamp();
  if p_action='choose' then
   if p_payload->>'slot' is distinct from v_slot then return jsonb_build_object('error','選項已結算，請讀取共同選擇。','code','STALE_VOTE');end if;
   if not(opts ? coalesce(p_payload->>'choice','')) then return jsonb_build_object('error','請選擇有效選項。','code','INVALID_CHOICE');end if;
   if b.id is null then
    insert into public.story_ballots(team_id,run_id,checkpoint,slot,round,action,options,electors,captain)
    values(t.id,r.id,0,v_slot,1,'choose',opts,array(select player_id from public.team_members where team_id=t.id),(t.state->>'leader_id')::uuid) returning * into b;
   end if;
   if not(p_player=any(b.electors)) then return jsonb_build_object('error','你不在本次投票名單中。','code','NOT_ELECTOR');end if;
   if b.deadline is null or v_now<b.deadline then
    if exists(select 1 from public.story_votes where ballot_id=b.id and player_id=p_player and choice<>p_payload->>'choice') then return jsonb_build_object('error','已收到你的選擇，請等待結果。','code','VOTE_FIXED');end if;
    insert into public.story_votes values(b.id,p_player,p_payload->>'choice') on conflict do nothing;
    if p_player::text=t.state->>'leader_id' and b.deadline is null then update public.story_ballots set phase='open',deadline=v_now+interval '10 seconds',captain_choice=p_payload->>'choice' where id=b.id returning * into b;end if;
   end if;
  end if;
  if b.phase='open' then
   select count(*) into n from public.story_votes where ballot_id=b.id;
   if clock_timestamp()>=b.deadline or n=cardinality(b.electors) then
    select choice into winner from public.story_votes where ballot_id=b.id group by choice order by count(*) desc,(choice=b.captain_choice) desc,choice limit 1;
    if (select count(*) from (select count(*) n from public.story_votes where ballot_id=b.id group by choice) c where c.n=(select max(x.n) from (select count(*) n from public.story_votes where ballot_id=b.id group by choice) x))>1 then winner:=b.captain_choice;end if;
    update public.story_ballots set result=winner,phase='settled',settled_at=clock_timestamp() where id=b.id;
    update public.prologue_runs set choices=choices||jsonb_build_object(v_slot,winner) where id=r.id returning * into r;
    b:=null;
   end if;
  end if;
 elsif p_action='choose' and p_payload->>'choice' is distinct from r.choices->>(p_payload->>'slot') then
  return jsonb_build_object('error','選項已結算，請讀取共同選擇。','code','STALE_VOTE');
 end if;
 if p_action='finish' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長完成開場。','code','LEADER_REQUIRED');end if;
  if not(r.choices ?& array['help','depart']) then return jsonb_build_object('error','請先完成開場選擇。','code','INVALID_PHASE');end if;
  update public.prologue_runs set finished_at=coalesce(finished_at,clock_timestamp()) where id=r.id returning * into r;
 end if;
 return jsonb_build_object('server_time',clock_timestamp(),'run',jsonb_build_object('id',r.id,'checkpoint',0,'choices',r.choices,'finished',r.finished_at is not null,
 'ballot',case when b.id is null then null else jsonb_build_object('id',b.id,'slot',b.slot,'phase',b.phase,'deadline',b.deadline,'my_choice',(select choice from public.story_votes where ballot_id=b.id and player_id=p_player)) end));
end;$$;
revoke all on function public.prologue_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.prologue_action(text,uuid,text,jsonb) to service_role;
commit;
