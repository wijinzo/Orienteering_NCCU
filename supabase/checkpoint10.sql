begin;
create table if not exists public.checkpoint10_runs(id uuid primary key default gen_random_uuid(),team_id uuid not null unique references public.teams(id),phase text not null default 'guess',reflection text);
create table if not exists public.checkpoint10_readers(run_id uuid references public.checkpoint10_runs(id),player_id uuid references public.players(id),read_at timestamptz not null default clock_timestamp(),primary key(run_id,player_id));
create table if not exists public.checkpoint10_notes(run_id uuid references public.checkpoint10_runs(id),player_id uuid references public.players(id),body text not null check(char_length(body) between 1 and 300),updated_at timestamptz not null default clock_timestamp(),primary key(run_id,player_id));
create table if not exists public.checkpoint10_reflections(run_id uuid not null references public.checkpoint10_runs(id),player_id uuid not null references public.players(id),choice text not null check(choice in('campus','remember','mine')),primary key(run_id,player_id));
alter table public.checkpoint10_reflections enable row level security;
revoke all on public.checkpoint10_reflections from public,anon,authenticated;
grant select,insert on public.checkpoint10_reflections to service_role;
alter table public.checkpoint10_notes add column if not exists ai_reply text;
alter table public.checkpoint10_notes add column if not exists ai_reply_at timestamptz;
alter table public.checkpoint10_notes add column if not exists letter_lease uuid;
alter table public.checkpoint10_notes add column if not exists letter_until timestamptz;
alter table public.checkpoint10_runs enable row level security;
alter table public.checkpoint10_readers enable row level security;
alter table public.checkpoint10_notes enable row level security;
revoke all on public.checkpoint10_runs,public.checkpoint10_readers,public.checkpoint10_notes from public,anon,authenticated;
grant select,insert,update on public.checkpoint10_runs,public.checkpoint10_readers,public.checkpoint10_notes to service_role;
create or replace function public.checkpoint10_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.teams%rowtype;r public.checkpoint10_runs%rowtype;p public.team_game_progress%rowtype;cp integer;n integer;note public.checkpoint10_notes%rowtype;seen boolean;v_body text;v_reflection text;
begin
 select teams.* into t from public.teams teams join public.team_members m on m.team_id=teams.id join public.players pl on pl.id=m.player_id where pl.id=p_player and pl.activity_id=p_activity;
 if not found or t.state->>'phase'<>'elected' then return jsonb_build_object('error','請先選出隊長。','code','TEAM_NOT_READY');end if;
 perform 1 from public.teams where id=t.id for update;
 select * into p from public.team_game_progress where team_id=t.id;
 select * into r from public.checkpoint10_runs where team_id=t.id for update;
 if p_action='enter' then
  if t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長開啟最後一站。','code','LEADER_REQUIRED');end if;
  select count(distinct value) into n from jsonb_array_elements_text(coalesce(p.completed_checkpoints,'[]'::jsonb)) where value in ('11','13','9','12','7');
  if n<>5 or not exists(select 1 from public.memory_reconstruction where team_id=t.id and completed_at is not null) then return jsonb_build_object('error','還沒準備好啦！先找齊記憶碎片，拼好照片，再來找本龍！','code','MEMORIES_REQUIRED');end if;
  if p_payload ? 'code_hash' then
   select checkpoint_id into cp from public.checkpoint_codes where activity_id=p_activity and code_hash=p_payload->>'code_hash';
   if cp is distinct from 10 or (p_payload ? 'checkpoint' and (p_payload->>'checkpoint')::integer<>10) then return jsonb_build_object('error','地點代碼不正確。','code','CODE_INVALID');end if;
  elsif r.id is null then return jsonb_build_object('error','請掃描地點 10 的 QR Code，或輸入現場代碼。','code','CODE_REQUIRED');end if;
  if r.id is null then insert into public.checkpoint10_runs(team_id) values(t.id) returning * into r;end if;
 elsif p_action not in ('get','guess','reflect','read','note','letter_claim','letter_save','letter_release') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION');end if;
 if r.id is null then return jsonb_build_object('run',null,'progress',to_jsonb(p)-'team_id','server_time',clock_timestamp());end if;
 if p_action not in ('get','enter') and p_payload->>'run_id' is distinct from r.id::text then return jsonb_build_object('error','任務已更新。','code','STALE_RUN');end if;
 seen:=exists(select 1 from public.checkpoint10_readers where run_id=r.id and player_id=p_player);
 select choice into v_reflection from public.checkpoint10_reflections where run_id=r.id and player_id=p_player;
 if p_action='guess' and t.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長選擇。','code','LEADER_REQUIRED');end if;
 select * into note from public.checkpoint10_notes where run_id=r.id and player_id=p_player;
 if p_action in ('letter_claim','letter_save','letter_release') then
  if not seen or note.body is null then return jsonb_build_object('error','請先儲存自己的回憶。','code','NOTE_REQUIRED');end if;
  if p_action='letter_claim' and note.ai_reply is null then
   if note.letter_until>clock_timestamp() then return jsonb_build_object('error','奶龍正在寫回信，請稍後再讀取。','code','LETTER_BUSY');end if;
   update public.checkpoint10_notes set letter_lease=(p_payload->>'lease')::uuid,letter_until=clock_timestamp()+interval '40 seconds' where run_id=r.id and player_id=p_player;
   return jsonb_build_object('letter_claimed',true,'note',note.body);
  elsif p_action='letter_save' then
   if note.letter_lease::text is distinct from p_payload->>'lease' or note.letter_until<clock_timestamp() then return jsonb_build_object('error','回憶已更新，請為最新的回憶重新領取回信。','code','LETTER_STALE');end if;
   if char_length(coalesce(p_payload->>'text','')) not between 1 and 300 then return jsonb_build_object('error','回信格式不正確。','code','INVALID_LETTER');end if;
   update public.checkpoint10_notes set ai_reply=p_payload->>'text',ai_reply_at=clock_timestamp(),letter_lease=null,letter_until=null where run_id=r.id and player_id=p_player;
  elsif p_action='letter_release' and note.letter_lease::text=p_payload->>'lease' then
   update public.checkpoint10_notes set letter_lease=null,letter_until=null where run_id=r.id and player_id=p_player;
  end if;
 end if;
 if p_action='guess' then
  if coalesce(p_payload->>'choice','') not in ('nailong','pikachu','duck','egg') then return jsonb_build_object('error','請選擇有效選項。','code','INVALID_CHOICE');end if;
  if r.phase='guess' then
   if p_payload->>'choice'<>'nailong' then return jsonb_build_object('wrong',true);end if;
   update public.checkpoint10_runs set phase='story' where id=r.id returning * into r;
  end if;
 elsif p_action='reflect' then
  if r.phase='guess' then return jsonb_build_object('error','請先揭曉奶龍。','code','INVALID_PHASE');end if;
  if coalesce(p_payload->>'choice','') not in ('campus','remember','mine') then return jsonb_build_object('error','請選擇有效回應。','code','INVALID_CHOICE');end if;
  insert into public.checkpoint10_reflections(run_id,player_id,choice) values(r.id,p_player,p_payload->>'choice') on conflict do nothing;
  select choice into v_reflection from public.checkpoint10_reflections where run_id=r.id and player_id=p_player;
 elsif p_action='read' then
  if r.phase='guess' or v_reflection is null then return jsonb_build_object('error','請先看完結局與感想回應。','code','NOT_FINISHED');end if;
  insert into public.checkpoint10_readers(run_id,player_id) values(r.id,p_player) on conflict do nothing;seen:=true;
  if t.state->>'leader_id'=p_player::text then
   update public.checkpoint10_runs set phase='finished' where id=r.id returning * into r;
   update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? '10' then completed_checkpoints else completed_checkpoints||'["10"]'::jsonb end where team_id=t.id returning * into p;
  end if;
 elsif p_action='note' then
  if not seen then return jsonb_build_object('error','請先看完結局。','code','NOT_FINISHED');end if;
  v_body:=btrim(coalesce(p_payload->>'text',''));
  if char_length(v_body) not between 1 and 300 then return jsonb_build_object('error','請輸入 1～300 字的回憶。','code','INVALID_NOTE');end if;
  insert into public.checkpoint10_notes(run_id,player_id,body) values(r.id,p_player,v_body) on conflict(run_id,player_id) do update set body=excluded.body,updated_at=clock_timestamp(),ai_reply=null,ai_reply_at=null,letter_lease=null,letter_until=null where public.checkpoint10_notes.body is distinct from excluded.body;
 end if;
 select * into note from public.checkpoint10_notes where run_id=r.id and player_id=p_player;
 return jsonb_build_object('server_time',clock_timestamp(),'progress',to_jsonb(p)-'team_id','run',jsonb_build_object('id',r.id,'checkpoint',10,'phase',r.phase,'reflection',v_reflection,'my_read',seen,'my_note',note.body,'note_saved_at',note.updated_at,'my_letter',note.ai_reply,'letter_saved_at',note.ai_reply_at));
end; $$;
revoke all on function public.checkpoint10_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint10_action(text,uuid,text,jsonb) to service_role;
commit;
