-- Apply schema.sql and teams.sql first. No manually entered player IDs.
begin;
create table if not exists public.team_player_counters (
 activity_id text not null, team_number integer not null check(team_number between 1 and 10),
 last_number integer not null default 0, primary key(activity_id,team_number)
);
create table if not exists public.player_devices (
 activity_id text not null, device_hash text not null check(device_hash ~ '^[a-f0-9]{64}$'),
 player_id uuid not null references public.players(id), primary key(activity_id,device_hash)
);
alter table public.team_player_counters enable row level security;
alter table public.player_devices enable row level security;
revoke all on public.team_player_counters,public.player_devices from public,anon,authenticated;
grant select,insert,update,delete on public.team_player_counters,public.player_devices to service_role;
create or replace function public.register_team_player(p_activity text,p_team_number integer,p_device_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_player_id uuid; number integer; result jsonb; team_result jsonb; code text; existing_code text;
begin
 if p_team_number is null or p_team_number not between 1 and 10 or coalesce(p_device_hash,'') !~ '^[a-f0-9]{64}$' then
  return jsonb_build_object('error','請選擇第 1～10 組。');
 end if;
 -- Serialize retries from one browser before allocating a number.
 perform pg_advisory_xact_lock(hashtextextended(p_activity || ':' || p_device_hash,0));
 select d.player_id into v_player_id from public.player_devices d where d.activity_id=p_activity and d.device_hash=p_device_hash;
 code:=lpad(p_team_number::text,2,'0');
 if v_player_id is not null then
  select t.code into existing_code from public.team_members m join public.teams t on t.id=m.team_id where m.player_id=v_player_id;
  if existing_code is distinct from code then return jsonb_build_object('error','此裝置已加入第 ' || existing_code || ' 組，請回到原隊伍繼續。'); end if;
  select jsonb_build_object('player',to_jsonb(p),'progress',to_jsonb(g)-'player_id') into result from public.players p join public.player_progress g on g.player_id=p.id where p.id=v_player_id;
 else
  insert into public.team_player_counters(activity_id,team_number) values(p_activity,p_team_number) on conflict do nothing;
  -- The counter row stays locked until player and team membership both exist.
  loop
   update public.team_player_counters set last_number=last_number+1 where activity_id=p_activity and team_number=p_team_number returning last_number into number;
   exit when not exists(select 1 from public.players where activity_id=p_activity and player_code=code || '-' || lpad(number::text,greatest(3,length(number::text)),'0'));
  end loop;
  result:=public.login_player(p_activity,code || '-' || lpad(number::text,greatest(3,length(number::text)),'0'));
  v_player_id:=(result->'player'->>'id')::uuid;
  insert into public.player_devices values(p_activity,p_device_hash,v_player_id);
  team_result:=public.team_action(p_activity,v_player_id,'join',jsonb_build_object('code',code));
  if team_result ? 'error' then raise exception 'Unable to join selected team'; end if;
 end if;
 team_result:=public.team_action(p_activity,v_player_id,'get');
 return result || team_result;
end;
$$;
revoke all on function public.register_team_player(text,integer,text) from public,anon,authenticated;
grant execute on function public.register_team_player(text,integer,text) to service_role;
commit;
