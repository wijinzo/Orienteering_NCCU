begin;
create table if not exists public.checkpoint5_runs (id uuid primary key default gen_random_uuid(), team_id uuid not null unique references public.teams(id), phase text not null default 'story', choice text);
create table if not exists public.checkpoint5_guesses(run_id uuid references public.checkpoint5_runs(id),request_id uuid,guess text not null,a integer not null,b integer not null,created_at timestamptz not null default clock_timestamp(),primary key(run_id,request_id));
alter table public.checkpoint5_guesses enable row level security;
revoke all on public.checkpoint5_guesses from public,anon,authenticated;
grant select,insert on public.checkpoint5_guesses to service_role;
alter table public.checkpoint5_runs add column if not exists ending_choice text;
alter table public.checkpoint5_runs enable row level security;
revoke all on public.checkpoint5_runs from public, anon, authenticated;
grant select,insert,update,delete on public.checkpoint5_runs to service_role;
create or replace function public.checkpoint5_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype; r public.checkpoint5_runs%rowtype; p public.team_game_progress%rowtype; cp integer; a integer; b integer; digit text; guess text; req uuid; i integer; v_now timestamptz:=clock_timestamp();
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY'); end if;
 perform 1 from public.teams where id=t.id for update;
 insert into public.team_game_progress(team_id) values(t.id) on conflict do nothing;
 select * into p from public.team_game_progress where team_id=t.id;
 select * into r from public.checkpoint5_runs where team_id=t.id for update;
 if p_action='enter' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長開啟地點。','code','LEADER_REQUIRED'); end if;
   if p_payload ? 'code_hash' then
   select checkpoint_id into cp from public.checkpoint_codes where activity_id=p_activity and code_hash=p_payload->>'code_hash';
   if cp is distinct from 5 or (p_payload ? 'checkpoint' and (p_payload->>'checkpoint')::integer<>5) then return jsonb_build_object('error','地點代碼不正確。','code','CODE_INVALID'); end if;
  elsif r.id is null then return jsonb_build_object('error','請掃描地點 5 的 QR Code，或輸入現場代碼。','code','CODE_REQUIRED'); end if;
  if r.id is null then insert into public.checkpoint5_runs(team_id) values(t.id) returning * into r; end if;
 elsif p_action not in ('get','choose','answer','finish') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION'); end if;
 if r.id is null then return jsonb_build_object('run',null,'progress',to_jsonb(p)-'team_id','server_time',v_now); end if;
 if p_action not in ('get','enter') then
  if p_payload->>'run_id' is distinct from r.id::text then return jsonb_build_object('error','任務已更新，請重新載入。','code','STALE_RUN'); end if;
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長操作。','code','LEADER_REQUIRED'); end if;
 end if;
 if p_action='choose' and r.phase='story' then
  if coalesce(p_payload->>'choice','') not in ('help','tease') then return jsonb_build_object('error','請選擇有效選項。','code','INVALID_CHOICE'); end if;
  update public.checkpoint5_runs set choice=p_payload->>'choice',phase='answer' where id=r.id returning * into r;
 elsif p_action='answer' and r.phase in ('answer','success') then
  guess:=p_payload->>'answer';req:=(p_payload->>'request_id')::uuid;
  if coalesce(guess,'') !~ '^[0-9]{4}$' or req is null then return jsonb_build_object('error','請輸入四位數密碼。','code','INVALID_ANSWER');end if;
  if not exists(select 1 from public.checkpoint5_guesses where run_id=r.id and request_id=req) and r.phase='answer' then
   a:=0;b:=0;
   for i in 1..4 loop if substr(guess,i,1)=substr('1998',i,1) then a:=a+1;end if;end loop;
   for i in 0..9 loop digit:=i::text;b:=b+least(length(guess)-length(replace(guess,digit,'')),length('1998')-length(replace('1998',digit,'')));end loop;
   b:=b-a;
   insert into public.checkpoint5_guesses(run_id,request_id,guess,a,b) values(r.id,req,guess,a,b);
   if a=4 then update public.checkpoint5_runs set phase='success' where id=r.id returning * into r;end if;
  end if;
 elsif p_action='choose' and r.phase='success' then
  if coalesce(p_payload->>'choice','') not in ('history','continue') then return jsonb_build_object('error','選項不正確。','code','INVALID_CHOICE');end if;
  if r.ending_choice is null then update public.checkpoint5_runs set ending_choice=p_payload->>'choice' where id=r.id returning * into r;end if;
 elsif p_action='finish' and r.phase in ('success','finished') then
  if r.ending_choice is null then return jsonb_build_object('error','請先選擇年份回應。','code','ENDING_REQUIRED');end if;
  update public.checkpoint5_runs set phase='finished' where id=r.id returning * into r;
  update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? '5' then completed_checkpoints else completed_checkpoints || '["5"]'::jsonb end where team_id=t.id returning * into p;
 elsif p_action not in ('get','enter') then return jsonb_build_object('error','目前無法進行此操作，請重新載入。','code','INVALID_PHASE'); end if;
 return jsonb_build_object('server_time',v_now,'progress',to_jsonb(p)-'team_id','run',jsonb_build_object('id',r.id,'checkpoint',5,'phase',r.phase,'choice',r.choice,'ending_choice',r.ending_choice,'guesses',(select coalesce(jsonb_agg(jsonb_build_object('request_id',g.request_id,'guess',g.guess,'a',g.a,'b',g.b) order by g.created_at,g.request_id),'[]'::jsonb) from public.checkpoint5_guesses g where g.run_id=r.id)));
end; $$;
revoke all on function public.checkpoint5_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint5_action(text,uuid,text,jsonb) to service_role;
commit;
