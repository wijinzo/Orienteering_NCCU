-- Apply after registration.sql. Does not remove any existing data when installed.
begin;
create or replace function public.leave_team(p_activity text,p_player uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_hash text; v_team public.teams%rowtype; v_members jsonb; v_ids jsonb; v_state jsonb;
begin
 -- Match registration's lock order: device, player, then team.
 select device_hash into v_hash from public.player_devices where activity_id=p_activity and player_id=p_player;
 if v_hash is not null then perform pg_advisory_xact_lock(hashtextextended(p_activity || ':' || v_hash,0)); end if;
 perform 1 from public.players where id=p_player and activity_id=p_activity for update;
 if not found then return jsonb_build_object('left',true); end if;
 select t.* into v_team from public.teams t join public.team_members m on m.team_id=t.id
 where m.player_id=p_player and t.activity_id=p_activity for update of t;
 if not found then return jsonb_build_object('error','找不到目前隊伍，請重新登入。','code','TEAM_NOT_FOUND'); end if;
 if v_team.state->>'phase' not in ('lobby','voting') then
  return jsonb_build_object('error','隊長已選出，為避免影響關卡，請聯絡活動人員協助更換組別。','code','TEAM_LOCKED');
 end if;
 select coalesce(jsonb_agg(value || jsonb_build_object('ready',false)),'[]'::jsonb) into v_members
 from jsonb_array_elements(v_team.state->'members') where value->>'id'<>p_player::text;
 v_state:=v_team.state || jsonb_build_object('members',v_members,'votes','{}'::jsonb,'leader_id',null);
 if v_team.state->>'phase'='voting' and jsonb_array_length(v_members)>0 then
  select jsonb_agg(value->'id') into v_ids from jsonb_array_elements(v_members);
  -- All remaining members vote again; reject any requests from the previous round.
  v_state:=v_state || jsonb_build_object('round',(v_team.state->>'round')::integer+1,'electors',v_ids,'candidates',v_ids);
 else
  v_state:=v_state || jsonb_build_object('phase','lobby','round',0,'electors','[]'::jsonb,'candidates','[]'::jsonb);
 end if;
 update public.teams set state=v_state where id=v_team.id;
 delete from public.player_devices where activity_id=p_activity and player_id=p_player;
 delete from public.team_members where player_id=p_player;
 -- No game participation exists before the captain is elected. FK restrictions
 -- additionally prevent deleting a player referenced by any game data.
 delete from public.players where activity_id=p_activity and id=p_player;
 -- The progress row cascades; the team counter intentionally never reuses IDs.
 return jsonb_build_object('left',true);
end;
$$;
revoke all on function public.leave_team(text,uuid) from public,anon,authenticated;
grant execute on function public.leave_team(text,uuid) to service_role;
commit;
