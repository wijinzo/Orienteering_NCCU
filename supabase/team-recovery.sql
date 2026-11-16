-- Apply once after existing game SQL; safe to re-run. Preserves completed progress.
begin;
alter table public.checkpoint3_runs add column if not exists first_completed_at timestamptz;
alter table public.checkpoint3_players add column if not exists skipped boolean not null default false;
alter table public.checkpoint11_runs add column if not exists search_started_at timestamptz;
create table if not exists public.checkpoint11_handoffs(
 id uuid primary key default gen_random_uuid(),run_id uuid not null,photo integer not null,
 from_player uuid not null references public.players(id),to_player uuid not null references public.players(id),
 proposer uuid not null references public.players(id),confirmed_by uuid references public.players(id),
 status text not null default 'pending' check(status in('pending','approved','cancelled')),
 proposed_at timestamptz not null default clock_timestamp(),confirmed_at timestamptz,
 foreign key(run_id,photo) references public.checkpoint11_photos(run_id,photo) on delete cascade
);
create unique index if not exists checkpoint11_one_pending_handoff on public.checkpoint11_handoffs(run_id,photo) where status='pending';
alter table public.checkpoint11_handoffs enable row level security;
revoke all on public.checkpoint11_handoffs from public,anon,authenticated;
grant select,insert,update,delete on public.checkpoint11_handoffs to service_role;

-- Older active games receive a fresh grace period when this migration is installed.
update public.checkpoint3_runs r set first_completed_at=clock_timestamp() where r.phase='play' and r.first_completed_at is null and exists(select 1 from public.checkpoint3_players p where p.run_id=r.id and p.done);
update public.checkpoint11_runs set search_started_at=clock_timestamp() where phase='search' and search_started_at is null;
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
 -- The first successful submission starts a shared, immutable 90-second grace period.
 if r.phase='play' and r.first_completed_at is not null and clock_timestamp()>=r.first_completed_at+interval '90 seconds' then
  update public.checkpoint3_players set skipped=true where run_id=r.id and not done and not skipped;
  update public.checkpoint3_runs set phase='success' where id=r.id returning * into r;
 end if;
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
  if exists(select 1 from public.checkpoint3_players where run_id=r.id and player_id=p_player and skipped) then return jsonb_build_object('error','本輪等待時間已結束，你未提交的成績不計入，可稍後在通訊頁重玩。','code','PLAYER_SKIPPED');end if;
  if p_payload ? 'shots' and (jsonb_typeof(p_payload->'shots')<>'number' or (p_payload->>'shots') !~ '^[0-9]{1,6}$' or (p_payload->>'shots')::integer not between 1 and 100000) then return jsonb_build_object('error','彈射次數格式錯誤。','code','INVALID_SHOTS');end if;
  update public.checkpoint3_players set done=true,shots=(p_payload->>'shots')::integer where run_id=r.id and player_id=p_player and not done;
  update public.checkpoint3_runs set first_completed_at=coalesce(first_completed_at,clock_timestamp()) where id=r.id returning * into r;
  if r.phase='play' and not exists(select 1 from public.checkpoint3_players where run_id=r.id and not done) then update public.checkpoint3_runs set phase='success' where id=r.id returning * into r;end if;
 elsif p_action='finish' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長完成劇情。','code','LEADER_REQUIRED');end if;
  if r.phase not in ('success','finished') then return jsonb_build_object('error','請等待全員完成。','code','NOT_FINISHED');end if;
  update public.checkpoint3_runs set phase='finished' where id=r.id returning * into r;
  update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? '3' then completed_checkpoints else completed_checkpoints || '["3"]'::jsonb end where team_id=t.id returning * into p;
 end if;
 select count(*),count(*) filter(where done) into total,completed from public.checkpoint3_players where run_id=r.id;
 return jsonb_build_object('server_time',clock_timestamp(),'progress',to_jsonb(p)-'team_id','run',jsonb_build_object('id',r.id,'checkpoint',3,'phase',r.phase,'choice',r.choice,'effect',case when r.choice='egg' then 'angry_shot' when r.choice='care' then 'pressure' else null end,'total',total,'completed_count',completed,
 'first_completed_at',r.first_completed_at,'skip_at',r.first_completed_at+interval '90 seconds',
 'skipped_count',(select count(*) from public.checkpoint3_players where run_id=r.id and skipped),
 'skipped',coalesce((select skipped from public.checkpoint3_players where run_id=r.id and player_id=p_player),false),
 'participant',exists(select 1 from public.checkpoint3_players where run_id=r.id and player_id=p_player),'done',coalesce((select done from public.checkpoint3_players where run_id=r.id and player_id=p_player),false)));
end; $$;
create or replace function public.checkpoint11_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 t public.teams%rowtype; r public.checkpoint11_runs%rowtype; p public.team_game_progress%rowtype;
 r1 public.checkpoint_runs%rowtype; v_checkpoint integer; v_photo integer; v_count integer;
 v_member record; v_found boolean; v_assigned uuid; v_now timestamptz:=clock_timestamp(); v_next integer;
 h public.checkpoint11_handoffs%rowtype;v_target uuid;
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
 elsif p_action not in ('get','choose','find','finish','handoff_request','handoff_confirm','handoff_cancel') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION');
 end if;
 if r.id is null then return jsonb_build_object('run',null,'progress',to_jsonb(p)-'team_id','server_time',v_now); end if;
 if p_action not in ('get','enter') and p_payload->>'run_id' is distinct from r.id::text then return jsonb_build_object('error','任務已更新，請重新載入。','code','STALE_RUN'); end if;
 if p_action in ('handoff_request','handoff_confirm','handoff_cancel') then
  if r.phase<>'search' then return jsonb_build_object('error','目前不需要接手照片。','code','INVALID_PHASE');end if;
  if r.search_started_at is null or clock_timestamp()<r.search_started_at+interval '90 seconds' then return jsonb_build_object('error','搜尋開始滿 90 秒後才能接手照片。','code','RECOVERY_TOO_EARLY');end if;
  if p_action='handoff_request' then
   if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長提出接手申請。','code','LEADER_REQUIRED');end if;
   if coalesce(p_payload->>'photo','') !~ '^[1-6]$' or coalesce(p_payload->>'to_player','') !~ '^[0-9a-fA-F-]{36}$' then return jsonb_build_object('error','請選擇照片及接手隊員。','code','INVALID_HANDOFF');end if;
   v_photo:=(p_payload->>'photo')::integer;v_target:=(p_payload->>'to_player')::uuid;
   select * into h from public.checkpoint11_handoffs where run_id=r.id and photo=v_photo and status='pending';
   if found then
    if h.to_player<>v_target then return jsonb_build_object('error','此照片已有接手申請，請先取消。','code','HANDOFF_PENDING');end if;
   else
    select cp.assigned_to,cp.found into v_assigned,v_found from public.checkpoint11_photos cp where cp.run_id=r.id and cp.photo=v_photo;
    if not found or v_found or v_assigned is null or v_assigned=v_target then return jsonb_build_object('error','這張照片已完成或不需要轉交。','code','HANDOFF_STALE');end if;
    if not exists(select 1 from public.team_members where team_id=t.id and player_id=v_target) or exists(select 1 from public.checkpoint11_photos cp where cp.run_id=r.id and cp.assigned_to=v_target and not cp.found) then return jsonb_build_object('error','請選擇已完成手上照片的隊員接手。','code','RECIPIENT_BUSY');end if;
    insert into public.checkpoint11_handoffs(run_id,photo,from_player,to_player,proposer) values(r.id,v_photo,v_assigned,v_target,p_player);
   end if;
  else
   if coalesce(p_payload->>'handoff_id','') !~ '^[0-9a-fA-F-]{36}$' then return jsonb_build_object('error','請重新讀取接手申請。','code','INVALID_HANDOFF');end if;
   select * into h from public.checkpoint11_handoffs where id=(p_payload->>'handoff_id')::uuid and run_id=r.id;
   if not found then return jsonb_build_object('error','找不到這筆接手申請。','code','HANDOFF_NOT_FOUND');end if;
   if p_action='handoff_cancel' then
    if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長取消申請。','code','LEADER_REQUIRED');end if;
    update public.checkpoint11_handoffs set status='cancelled' where id=h.id and status='pending';
   else
    if (p_player=h.proposer or p_player::text=t.state->>'leader_id') and (select count(*) from public.team_members where team_id=t.id)>2 then return jsonb_build_object('error','需要另一名隊員確認，不能自行核准。','code','SECOND_CONFIRMATION_REQUIRED');end if;
    if h.status='cancelled' then return jsonb_build_object('error','這筆申請已取消。','code','HANDOFF_STALE');end if;
    if h.status='pending' then
     if not exists(select 1 from public.checkpoint11_photos cp where cp.run_id=r.id and cp.photo=h.photo and cp.assigned_to=h.from_player and not cp.found)
     or not exists(select 1 from public.team_members where team_id=t.id and player_id=h.to_player)
     or exists(select 1 from public.checkpoint11_photos cp where cp.run_id=r.id and cp.assigned_to=h.to_player and not cp.found) then
      update public.checkpoint11_handoffs set status='cancelled' where id=h.id;
      return jsonb_build_object('error','照片或接手隊員狀態已變更，請重新申請。','code','HANDOFF_STALE');
     end if;
     update public.checkpoint11_photos set assigned_to=h.to_player where run_id=r.id and photo=h.photo;
     update public.checkpoint11_handoffs set status='approved',confirmed_by=p_player,confirmed_at=clock_timestamp() where id=h.id;
    end if;
   end if;
  end if;
 end if;
 if p_action='choose' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長選擇。','code','LEADER_REQUIRED'); end if;
  if coalesce(p_payload->>'choice','') not in ('question','promise') then return jsonb_build_object('error','選項不正確。','code','INVALID_CHOICE'); end if;
  if r.choice is not null and r.choice<>p_payload->>'choice' then return jsonb_build_object('error','隊長已選擇。','code','CHOICE_FIXED'); end if;
  if r.phase='story' then update public.checkpoint11_runs set choice=p_payload->>'choice',phase='search',search_started_at=coalesce(search_started_at,clock_timestamp()) where id=r.id returning * into r; end if;
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
   update public.checkpoint11_handoffs set status='cancelled' where run_id=r.id and photo=v_photo and status='pending';
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
 return jsonb_build_object('server_time',v_now,'progress',to_jsonb(p)-'team_id','run',jsonb_build_object('id',r.id,'checkpoint',11,'phase',r.phase,'choice',r.choice,'found_count',v_count,'my_photo',v_photo,'participant',exists(select 1 from public.checkpoint11_photos where run_id=r.id and assigned_to=p_player),'total',6,
 'recovery',jsonb_build_object('available_at',r.search_started_at+interval '90 seconds','available',r.phase='search' and clock_timestamp()>=r.search_started_at+interval '90 seconds','self_confirm_allowed',(select count(*) from public.team_members where team_id=t.id)<=2,
 'photos',(select coalesce(jsonb_agg(jsonb_build_object('photo',cp.photo,'assigned_to',cp.assigned_to,'found',cp.found) order by cp.photo),'[]') from public.checkpoint11_photos cp where cp.run_id=r.id),
 'handoffs',(select coalesce(jsonb_agg(to_jsonb(x) order by x.proposed_at),'[]') from public.checkpoint11_handoffs x where x.run_id=r.id))));
end;
$$;
revoke all on function public.checkpoint3_action(text,uuid,text,jsonb),public.checkpoint11_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint3_action(text,uuid,text,jsonb),public.checkpoint11_action(text,uuid,text,jsonb) to service_role;
commit;
