-- Apply after schema.sql. Team changes and election settlement are atomic.
begin;
create table if not exists public.teams (
 id uuid primary key default gen_random_uuid(), activity_id text not null,
 code text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
 state jsonb not null default '{"phase":"lobby","round":0,"members":[],"electors":[],"candidates":[],"votes":{},"leader_id":null}',
 unique(activity_id, code)
);
create table if not exists public.team_members (
 player_id uuid primary key references public.players(id),
 team_id uuid not null references public.teams(id)
);
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
revoke all on public.teams, public.team_members from public, anon, authenticated;
grant select, insert, update, delete on public.teams, public.team_members to service_role;

create or replace function public.team_action(p_activity text, p_player uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 t public.teams%rowtype; s jsonb; m jsonb; members jsonb; winners jsonb;
 team_id uuid; player_code text; candidate text; winner_count integer; highest integer;
begin
 -- Serialize same-player joins; row lock below serializes all changes in one team.
 select p.player_code into player_code from public.players p where p.id=p_player and p.activity_id=p_activity for update;
 if not found then return jsonb_build_object('error','找不到玩家。'); end if;
 select tm.team_id into team_id from public.team_members tm where tm.player_id=p_player;
 if p_action='join' then
   if team_id is not null then return jsonb_build_object('error','你已加入隊伍，請重新整理。'); end if;
   if coalesce(p_payload->>'code','') !~ '^[A-Z0-9_-]{1,20}$' then return jsonb_build_object('error','隊伍代碼格式錯誤。'); end if;
   insert into public.teams(activity_id,code) values(p_activity,p_payload->>'code') on conflict do nothing;
   select * into t from public.teams where activity_id=p_activity and code=p_payload->>'code' for update;
   team_id:=t.id; s:=t.state;
   insert into public.team_members values(p_player,team_id);
   if s->>'phase'='lobby' then
     select coalesce(jsonb_agg(value || '{"ready":false}'), '[]') into members from jsonb_array_elements(s->'members');
     s:=jsonb_set(s,'{members}',members);
   end if;
   s:=jsonb_set(s,'{members}',(s->'members') || jsonb_build_array(jsonb_build_object('id',p_player,'code',player_code,'ready',false)));
 elsif team_id is null then
   return jsonb_build_object('team',null);
 else
   select * into t from public.teams where id=team_id and activity_id=p_activity for update;
   s:=t.state;
 end if;

 if p_action='name' then
   if s->>'phase'<>'lobby' then return jsonb_build_object('error','投票開始後不能修改名字。'); end if;
   if coalesce(length(trim(p_payload->>'name')),0) not between 1 and 20 then return jsonb_build_object('error','請輸入 1～20 字的冒險者名字。'); end if;
   select jsonb_agg(case when value->>'id'=p_player::text then value || jsonb_build_object('name',trim(p_payload->>'name'),'ready',false) else value end) into members from jsonb_array_elements(s->'members');
   s:=jsonb_set(s,'{members}',members);
 elsif p_action='ready' then
   if s->>'phase'<>'lobby' then return jsonb_build_object('error','投票已開始，請更新隊伍狀態。'); end if;
   if jsonb_typeof(p_payload->'ready') is distinct from 'boolean' then return jsonb_build_object('error','準備狀態格式錯誤。'); end if;
   if p_payload->>'ready'='true' and not exists(select 1 from jsonb_array_elements(s->'members') where value->>'id'=p_player::text and length(trim(value->>'name')) between 1 and 20) then return jsonb_build_object('error','請先儲存冒險者名字，再準備出發。'); end if;
   select jsonb_agg(case when value->>'id'=p_player::text then jsonb_set(value,'{ready}',p_payload->'ready') else value end) into members from jsonb_array_elements(s->'members');
   s:=jsonb_set(s,'{members}',members);
   if not exists(select 1 from jsonb_array_elements(members) where value->>'ready'<>'true') then
     select jsonb_agg(value->'id') into m from jsonb_array_elements(members);
     s:=s || jsonb_build_object('phase','voting','round',1,'electors',m,'candidates',m,'votes','{}'::jsonb);
   end if;
 elsif p_action='vote' then
   candidate:=p_payload->>'candidate';
   if s->>'phase'<>'voting' or (p_payload->>'round')::integer<>(s->>'round')::integer then return jsonb_build_object('error','本輪投票已更新，請重新選擇。'); end if;
   if not (s->'electors' ? p_player::text) or not (s->'candidates' ? candidate) then return jsonb_build_object('error','不在本輪投票名單內。'); end if;
   if s->'votes' ? p_player::text then return jsonb_build_object('error','本輪已投票，不能重複送出。'); end if;
   s:=jsonb_set(s,array['votes',p_player::text],to_jsonb(candidate));
   if (select count(*) from jsonb_each(s->'votes'))=jsonb_array_length(s->'electors') then
     select max(n) into highest from (select count(*) n from jsonb_each_text(s->'votes') group by value) counts;
     select jsonb_agg(to_jsonb(v)) into winners from (select value v from jsonb_each_text(s->'votes') group by value having count(*)=highest) counts;
     winner_count:=jsonb_array_length(winners);
     if winner_count=1 then s:=s || jsonb_build_object('phase','elected','leader_id',winners->>0);
     else s:=s || jsonb_build_object('round',(s->>'round')::integer+1,'candidates',winners,'votes','{}'::jsonb); end if;
   end if;
 elsif p_action not in ('get','join') then return jsonb_build_object('error','不支援此操作。');
 end if;
 update public.teams set state=s where id=team_id;
 -- Never send the ballot map to clients. Only participation and own selection are visible.
 return jsonb_build_object('team',(s-'votes') || jsonb_build_object('id',team_id,'code',t.code,
   'voted_count',(select count(*) from jsonb_each(s->'votes')),
   'voted_ids',(select coalesce(jsonb_agg(key),'[]') from jsonb_each(s->'votes')),
   'my_vote',s->'votes'->p_player::text));
end;
$$;
revoke all on function public.team_action(text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.team_action(text,uuid,text,jsonb) to service_role;
commit;
