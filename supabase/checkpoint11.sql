-- Apply after checkpoint1.sql.
begin;
create table if not exists public.checkpoint11_runs (
 id uuid primary key default gen_random_uuid(), team_id uuid not null unique references public.teams(id),
 phase text not null default 'story' check(phase in ('story','search','success','finished')),
 choice text, created_at timestamptz not null default now()
);
create table if not exists public.checkpoint11_photos (
 run_id uuid not null references public.checkpoint11_runs(id), photo integer not null check(photo between 1 and 6),
 assigned_to uuid references public.players(id), found boolean not null default false,
 primary key(run_id,photo)
);
alter table public.checkpoint11_runs enable row level security;
alter table public.checkpoint11_photos enable row level security;
revoke all on public.checkpoint11_runs,public.checkpoint11_photos from public,anon,authenticated;
grant select,insert,update,delete on public.checkpoint11_runs,public.checkpoint11_photos to service_role;

create or replace function public.checkpoint11_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 t public.teams%rowtype; r public.checkpoint11_runs%rowtype; p public.team_game_progress%rowtype;
 r1 public.checkpoint_runs%rowtype; v_checkpoint integer; v_photo integer; v_count integer;
 v_member record; v_found boolean; v_assigned uuid; v_now timestamptz:=clock_timestamp(); v_next integer;
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players players on players.id=m.player_id where players.id=p_player and players.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先與隊員選出隊長。','code','TEAM_NOT_READY'); end if;
 insert into public.game_presence(player_id,team_id,seen_at) values(p_player,t.id,v_now) on conflict(player_id) do update set seen_at=excluded.seen_at where public.game_presence.seen_at<v_now-interval '8 seconds';
 perform 1 from public.teams where id=t.id for update;
 select * into p from public.team_game_progress where team_id=t.id;
 select * into r1 from public.checkpoint_runs where team_id=t.id;
 select * into r from public.checkpoint11_runs where team_id=t.id for update;
 if p_action='enter' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長開啟地點。','code','LEADER_REQUIRED'); end if;
  if p_payload ? 'code_hash' then
   select checkpoint_id into v_checkpoint from public.checkpoint_codes where activity_id=p_activity and code_hash=p_payload->>'code_hash';
   if v_checkpoint is distinct from 11 or (p_payload ? 'checkpoint' and (p_payload->>'checkpoint')::integer<>11) then return jsonb_build_object('error','地點代碼不正確。','code','CODE_INVALID'); end if;
  elsif r.id is null then return jsonb_build_object('error','請掃描地點 11 的 QR Code，或輸入現場代碼。','code','CODE_REQUIRED'); end if;
  if r1.phase is distinct from 'finished' or not (r1.passed or p.completed_checkpoints ? '8') then return jsonb_build_object('error','地點 11 尚未開放；分流隊伍須先完成地點 8。','code','CHECKPOINT_LOCKED'); end if;
  if r.id is null then
   select count(*) into v_count from public.team_members gp where gp.team_id=t.id;
   if v_count>6 then return jsonb_build_object('error','此關目前最多六位參與者。','code','TOO_MANY_PLAYERS'); end if;
   insert into public.checkpoint11_runs(team_id) values(t.id) returning * into r;
   insert into public.checkpoint11_photos(run_id,photo) select r.id,generate_series(1,6);
   v_photo:=0;
   for v_member in select gp.player_id from public.team_members gp where gp.team_id=t.id order by gp.player_id loop
    v_photo:=v_photo+1;
    if v_photo>6 then return jsonb_build_object('error','此關目前最多六位參與者。','code','TOO_MANY_PLAYERS'); end if;
    update public.checkpoint11_photos set assigned_to=v_member.player_id where run_id=r.id and photo=v_photo;
   end loop;
  end if;
 elsif p_action not in ('get','choose','find','finish') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION');
 end if;
 if r.id is null then return jsonb_build_object('run',null,'progress',to_jsonb(p)-'team_id','server_time',v_now); end if;
 if p_action in ('choose','find','finish') and p_payload->>'run_id' is distinct from r.id::text then return jsonb_build_object('error','任務已更新，請重新載入。','code','STALE_RUN'); end if;
 if p_action='choose' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長選擇。','code','LEADER_REQUIRED'); end if;
  if coalesce(p_payload->>'choice','') not in ('question','promise') then return jsonb_build_object('error','選項不正確。','code','INVALID_CHOICE'); end if;
  if r.choice is not null and r.choice<>p_payload->>'choice' then return jsonb_build_object('error','隊長已選擇。','code','CHOICE_FIXED'); end if;
  if r.phase='story' then update public.checkpoint11_runs set choice=p_payload->>'choice',phase='search' where id=r.id returning * into r; end if;
 elsif p_action='find' then
  if r.phase not in ('search','success','finished') then return jsonb_build_object('error','還不能開始尋找。','code','NOT_STARTED'); end if;
  v_photo:=(p_payload->>'photo')::integer;
  select cp.found,cp.assigned_to into v_found,v_assigned from public.checkpoint11_photos cp where cp.run_id=r.id and cp.photo=v_photo;
  if not found or v_assigned is distinct from p_player then return jsonb_build_object('error','這張照片不是分配給你的。','code','NOT_ASSIGNED'); end if;
  if not v_found then
   if not (case v_photo
    when 1 then (p_payload->>'x')::numeric between 0.68 and 0.78 and (p_payload->>'y')::numeric between 0.35 and 0.59
    when 2 then (p_payload->>'x')::numeric between 0.46 and 0.54 and (p_payload->>'y')::numeric between 0.73 and 0.89
    when 3 then (p_payload->>'x')::numeric between 0.77 and 0.94 and (p_payload->>'y')::numeric between 0.10 and 0.42
    when 4 then (p_payload->>'x')::numeric between 0.42 and 0.60 and (p_payload->>'y')::numeric between 0.09 and 0.23
    when 5 then (p_payload->>'x')::numeric between 0.83 and 0.92 and (p_payload->>'y')::numeric between 0.68 and 0.85
    when 6 then (p_payload->>'x')::numeric between 0.02 and 0.23 and (p_payload->>'y')::numeric between 0.79 and 0.94 end) then return jsonb_build_object('error','再仔細找找，奶蛙還藏在照片裡。','code','MISS'); end if;
   if r.phase<>'search' then return jsonb_build_object('error','搜尋已結束。','code','SEARCH_ENDED'); end if;
   update public.checkpoint11_photos set found=true where run_id=r.id and photo=v_photo;
   select photo into v_next from public.checkpoint11_photos where run_id=r.id and assigned_to is null order by photo limit 1;
   if v_next is not null then update public.checkpoint11_photos set assigned_to=p_player where run_id=r.id and photo=v_next; end if;
  end if;
  select count(*) into v_count from public.checkpoint11_photos cp where cp.run_id=r.id and cp.found;
  if v_count=6 and r.phase='search' then update public.checkpoint11_runs set phase='success' where id=r.id returning * into r; end if;
 elsif p_action='finish' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長完成劇情。','code','LEADER_REQUIRED'); end if;
  if r.phase not in ('success','finished') then return jsonb_build_object('error','還沒找到全部奶蛙。','code','NOT_FINISHED'); end if;
  update public.checkpoint11_runs set phase='finished' where id=r.id returning * into r;
  update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? '11' then completed_checkpoints else completed_checkpoints || '["11"]'::jsonb end where team_id=t.id returning * into p;
 end if;
 select count(*) into v_count from public.checkpoint11_photos cp where cp.run_id=r.id and cp.found;
 select cp.photo into v_photo from public.checkpoint11_photos cp where cp.run_id=r.id and cp.assigned_to=p_player and not cp.found order by cp.photo limit 1;
 return jsonb_build_object('server_time',v_now,'progress',to_jsonb(p)-'team_id','run',jsonb_build_object('id',r.id,'checkpoint',11,'phase',r.phase,'choice',r.choice,'found_count',v_count,'my_photo',v_photo,'participant',exists(select 1 from public.checkpoint11_photos where run_id=r.id and assigned_to=p_player),'total',6));
end;
$$;
revoke all on function public.checkpoint11_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint11_action(text,uuid,text,jsonb) to service_role;
commit;
