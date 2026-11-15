-- Apply after schema.sql, teams.sql and registration.sql. All gameplay writes use this RPC.
begin;
create table if not exists public.checkpoint_codes (
 activity_id text not null, checkpoint_id integer not null check(checkpoint_id between 1 and 13), code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
 primary key(activity_id,checkpoint_id), unique(activity_id,code_hash)
);
alter table public.checkpoint_codes enable row level security;
revoke all on public.checkpoint_codes from public,anon,authenticated;
grant select,insert,update,delete on public.checkpoint_codes to service_role;
create table if not exists public.game_presence (
 player_id uuid primary key references public.players(id), team_id uuid not null references public.teams(id), seen_at timestamptz not null default now()
);
create table if not exists public.team_game_progress (
 team_id uuid primary key references public.teams(id), completed_checkpoints jsonb not null default '[]', choices jsonb not null default '{}'
);
create table if not exists public.checkpoint1_questions (
 id integer primary key, prompt text not null, options jsonb not null, answer text not null check(answer in ('A','B','C','D')), explanation text not null
);
insert into public.checkpoint1_questions values
(1,'國立政治大學的前身可追溯至1927年在南京創立的哪一個機構？','{"A":"國立中央大學","B":"中央黨務學校","C":"國立北平大學","D":"國立革命大學"}','B','政大的前身為 1927 年創立於南京的中央黨務學校，1954 年在臺灣木柵復校。'),
(2,'政大哪一座代表性建築，以「禮、義、廉、恥」命名，並曾作為校慶與大型集會的重要場所？','{"A":"四維堂","B":"達賢圖書館","C":"志希樓","D":"井塘樓"}','A','四維堂於 1959 年啟用，名稱取自禮、義、廉、恥四維，承載許多校園集會與活動的記憶。'),
(3,'由政大學生社團主辦、被視為臺灣大專院校孕育華語流行音樂創作者重要搖籃的知名音樂賽事是？','{"A":"政大雄鷹盃","B":"傳播影展","C":"四維講堂","D":"政大金旋獎"}','D','金旋獎由政大學生籌辦，提供校園音樂人展現作品的舞臺；張雨生、陳綺貞、蘇打綠等音樂人都曾參賽。'),
(4,'位於政大後山（指南山）的知名景點「指南宮」，在政大學生與民間流傳著什麼樣著名的都市傳說？','{"A":"半夜在廟前會看見白馬出沒","B":"情侶一起去參拜容易分手","C":"考試前去摸神像會被當掉","D":"跨過指南溪水就會歐趴"}','B','相傳主神呂洞賓因追求仙女不成而醋意大發，情侶一同前往容易遭致分手，但近年來廟方也積極推廣破除此迷信。'),
(5,'下列哪一個趣味形容，最符合政大所在地的氣候特徵？','{"A":"全年無風、悶熱無比的「烤爐大學」","B":"冬天常降下瑞雪的「雪中政大」","C":"經常多雨潮濕的「濕大」","D":"夏天常遭沙塵暴侵襲的「黃沙政大」"}','C','政大校方的環境管理資料指出，校園位於潮濕多雨區域。出門前留意天氣、攜帶雨具，是實用的校園生活準備。')
on conflict(id) do update set prompt=excluded.prompt,options=excluded.options,answer=excluded.answer,explanation=excluded.explanation;
create table if not exists public.checkpoint_runs (
 id uuid primary key default gen_random_uuid(), team_id uuid not null unique references public.teams(id),
 phase text not null default 'story', choice text, duration_seconds integer, starts_at timestamptz, deadline timestamptz, accept_until timestamptz,
 wrong_count integer, passed boolean, created_at timestamptz not null default now()
);
create table if not exists public.checkpoint_answers (
 run_id uuid not null references public.checkpoint_runs(id), player_id uuid not null references public.players(id), question_id integer not null references public.checkpoint1_questions(id),
 ready boolean not null default false, answer text check(answer in ('A','B','C','D')), submitted_at timestamptz,
 primary key(run_id,player_id)
);
alter table public.game_presence enable row level security;
alter table public.team_game_progress enable row level security;
alter table public.checkpoint1_questions enable row level security;
alter table public.checkpoint_runs enable row level security;
alter table public.checkpoint_answers enable row level security;
revoke all on public.game_presence,public.team_game_progress,public.checkpoint1_questions,public.checkpoint_runs,public.checkpoint_answers from public,anon,authenticated;
grant select,insert,update,delete on public.game_presence,public.team_game_progress,public.checkpoint1_questions,public.checkpoint_runs,public.checkpoint_answers to service_role;

create or replace function public.checkpoint1_action(p_activity text,p_player uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_team public.teams%rowtype; r public.checkpoint_runs%rowtype; a public.checkpoint_answers%rowtype;
 v_progress public.team_game_progress%rowtype; v_now timestamptz:=clock_timestamp(); v_member record;
 v_questions integer[]; v_index integer:=0; v_total integer; v_submitted integer; v_ready integer; v_wrong integer; v_question jsonb; v_result jsonb; v_next integer; v_checkpoint integer;
begin
 select t.* into v_team from public.teams t join public.team_members m on m.team_id=t.id join public.players p on p.id=m.player_id where p.id=p_player and p.activity_id=p_activity;
 if not found or v_team.state->>'phase'<>'elected' then return jsonb_build_object('error','請先與隊員選出隊長。','code','TEAM_NOT_READY'); end if;
 insert into public.game_presence(player_id,team_id,seen_at) values(p_player,v_team.id,v_now)
 on conflict(player_id) do update set seen_at=excluded.seen_at where public.game_presence.seen_at < v_now-interval '8 seconds';
 -- Serialize scans, start, answers and settlement in this team, across every tab/device.
 perform 1 from public.teams where id=v_team.id for update;
 insert into public.team_game_progress(team_id) values(v_team.id) on conflict do nothing;
 select * into v_progress from public.team_game_progress where team_id=v_team.id;
 select * into r from public.checkpoint_runs where team_id=v_team.id for update;
 if p_action='enter' then
  if v_team.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請由隊長掃碼開啟地點。','code','LEADER_REQUIRED'); end if;
  if p_payload ? 'code_hash' then
   select checkpoint_id into v_checkpoint from public.checkpoint_codes where activity_id=p_activity and code_hash=p_payload->>'code_hash';
   if v_checkpoint is null or (p_payload ? 'checkpoint' and v_checkpoint<>(p_payload->>'checkpoint')::integer) then return jsonb_build_object('error','地點代碼不正確，請確認現場標示後重試。','code','CODE_INVALID'); end if;
  elsif r.id is not null and (p_payload->>'checkpoint')::integer=1 then v_checkpoint:=1;
  else return jsonb_build_object('error','請掃描現場 QR Code，或輸入現場的地點代碼。','code','CODE_REQUIRED'); end if;
  if v_checkpoint<>1 then
   if r.phase='finished' and v_checkpoint=11 and (r.passed or v_progress.completed_checkpoints ? '8') then return jsonb_build_object('error','地點 11 已開放，關卡內容仍在準備中。','code','NOT_IMPLEMENTED');
   else return jsonb_build_object('error','此地點尚未開放，請先完成目前地點。','code','CHECKPOINT_LOCKED'); end if;
  end if;
  if r.id is null then
   insert into public.checkpoint_runs(team_id) values(v_team.id) returning * into r;
   select array_agg(id order by random()) into v_questions from public.checkpoint1_questions;
   for v_member in select m.player_id from public.team_members m where m.team_id=v_team.id order by random() loop
    insert into public.checkpoint_answers(run_id,player_id,question_id) values(r.id,v_member.player_id,v_questions[(v_index%5)+1]);
    v_index:=v_index+1;
   end loop;
  end if;
 elsif p_action not in ('get','ready','choose','answer','finish') then return jsonb_build_object('error','不支援此操作。','code','INVALID_ACTION');
 end if;
 if r.id is null then return jsonb_build_object('run',null,'progress',to_jsonb(v_progress)-'team_id','server_time',v_now); end if;
 if p_action in ('ready','choose','answer','finish') and (p_payload->>'run_id' is distinct from r.id::text) then return jsonb_build_object('error','任務已更新，請重新載入。','code','STALE_RUN'); end if;
 select * into a from public.checkpoint_answers where run_id=r.id and player_id=p_player;
 if p_action='ready' then
  if a.player_id is null then return jsonb_build_object('error','你不在本輪名單中，請觀看隊伍進度。','code','NOT_PARTICIPANT'); end if;
  update public.checkpoint_answers set ready=true where run_id=r.id and player_id=p_player;
 elsif p_action='choose' then
  if v_team.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長選擇。','code','LEADER_REQUIRED'); end if;
  if coalesce(p_payload->>'choice','') not in ('genius','hint') then return jsonb_build_object('error','請選擇有效選項。','code','INVALID_CHOICE'); end if;
  if r.choice is not null and r.choice<>p_payload->>'choice' then return jsonb_build_object('error','已選定挑戰時間，不能更改。','code','CHOICE_FIXED'); end if;
  if r.choice is null then
   update public.checkpoint_runs set choice=p_payload->>'choice',duration_seconds=case when p_payload->>'choice'='hint' then 120 else 60 end,phase='loading' where id=r.id returning * into r;
  end if;
 end if;
 select count(*),count(*) filter(where ready),count(*) filter(where answer is not null) into v_total,v_ready,v_submitted from public.checkpoint_answers where run_id=r.id;
 if r.phase='loading' and v_ready=v_total then
  update public.checkpoint_runs set phase='running', starts_at=v_now+interval '5 seconds',deadline=v_now+interval '5 seconds'+make_interval(secs=>r.duration_seconds),accept_until=v_now+interval '10 seconds'+make_interval(secs=>r.duration_seconds) where id=r.id returning * into r;
 end if;
 if p_action='answer' then
  if a.player_id is null then return jsonb_build_object('error','你不在本輪作答名單中。','code','NOT_PARTICIPANT'); end if;
  if coalesce(p_payload->>'answer','') not in ('A','B','C','D') then return jsonb_build_object('error','請選擇 A～D 的答案。','code','INVALID_ANSWER'); end if;
  if a.answer is not null then
   if a.answer<>p_payload->>'answer' then return jsonb_build_object('error','答案已提交，不能更改。','code','ALREADY_SUBMITTED'); end if;
  elsif r.phase<>'running' or v_now<r.starts_at then return jsonb_build_object('error','尚未開始作答。','code','NOT_STARTED');
  elsif v_now>r.accept_until then return jsonb_build_object('error','作答時間已結束，請讀取結果。','code','TIME_EXPIRED');
  else
   update public.checkpoint_answers set answer=p_payload->>'answer',submitted_at=v_now where run_id=r.id and player_id=p_player;
   v_submitted:=v_submitted+1;
  end if;
 end if;
 if r.phase='running' and (v_submitted=v_total or v_now>=r.accept_until) then
  select count(*) filter(where ca.answer is distinct from q.answer) into v_wrong from public.checkpoint_answers ca join public.checkpoint1_questions q on q.id=ca.question_id where ca.run_id=r.id;
  update public.checkpoint_runs set phase='settled',wrong_count=v_wrong,passed=(v_submitted>0 and v_wrong<=2) where id=r.id returning * into r;
 end if;
 if p_action='finish' then
  if v_team.state->>'leader_id'<>p_player::text then return jsonb_build_object('error','請等待隊長看完結果劇情。','code','LEADER_REQUIRED'); end if;
  if r.phase not in ('settled','finished') then return jsonb_build_object('error','測驗尚未結算。','code','NOT_SETTLED'); end if;
  update public.checkpoint_runs set phase='finished' where id=r.id returning * into r;
  update public.team_game_progress set completed_checkpoints=case when completed_checkpoints ? '1' then completed_checkpoints else completed_checkpoints || '["1"]'::jsonb end, choices=choices || jsonb_build_object('branch_1_detour',not r.passed) where team_id=v_team.id returning * into v_progress;
 end if;
 select * into a from public.checkpoint_answers where run_id=r.id and player_id=p_player;
 select jsonb_build_object('id',q.id,'prompt',q.prompt,'options',q.options) into v_question from public.checkpoint1_questions q where q.id=a.question_id;
 if r.phase in ('settled','finished') then
  select jsonb_build_object('passed',r.passed,'wrong_count',r.wrong_count,'total',v_total,'submitted',v_submitted,
   'my_answer',a.answer,'correct_answer',q.answer,'explanation',q.explanation,'correct',a.answer=q.answer) into v_result from public.checkpoint1_questions q where q.id=a.question_id;
  if v_result is null then v_result:=jsonb_build_object('passed',r.passed,'wrong_count',r.wrong_count,'total',v_total,'submitted',v_submitted); end if;
 end if;
 if r.phase='finished' then v_next:=case when r.passed or v_progress.completed_checkpoints ? '8' then 11 else 8 end; end if;
 return jsonb_build_object('server_time',v_now,'progress',to_jsonb(v_progress)-'team_id','run',jsonb_build_object(
  'id',r.id,'checkpoint',1,'phase',r.phase,'choice',r.choice,'duration_seconds',r.duration_seconds,'starts_at',r.starts_at,'deadline',r.deadline,'accept_until',r.accept_until,
  'participant',a.player_id is not null,'ready',coalesce(a.ready,false),'submitted',a.answer is not null,'my_answer',a.answer,'question',v_question,
  'total',v_total,'ready_count',v_ready,'submitted_count',v_submitted,'waiting_names',(select coalesce(jsonb_agg(coalesce(m.value->>'name',m.value->>'code')),'[]') from public.checkpoint_answers ca join lateral jsonb_array_elements(v_team.state->'members') m(value) on m.value->>'id'=ca.player_id::text where ca.run_id=r.id and not ca.ready),
  'result',v_result,'next_id',v_next));
end;
$$;
revoke all on function public.checkpoint1_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint1_action(text,uuid,text,jsonb) to service_role;
commit;
