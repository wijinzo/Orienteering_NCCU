-- Apply after prologue.sql. Read only: replay never calls a game action.
begin;
create or replace function public.story_archive(p_activity text,p_player uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare team uuid;done jsonb;items jsonb:='[]';cp integer;r jsonb;table_name text;
begin
 select m.team_id into team from public.team_members m join public.players p on p.id=m.player_id where p.id=p_player and p.activity_id=p_activity;
 if team is null then return jsonb_build_object('error','請先加入隊伍。','code','TEAM_NOT_READY');end if;
 select completed_checkpoints into done from public.team_game_progress where team_id=team;
 select jsonb_build_object('id',id,'choices',choices,'finished',finished_at is not null) into r from public.prologue_runs where team_id=team and finished_at is not null;
 if r is not null then items:=items||jsonb_build_array(jsonb_build_object('checkpoint',0,'run',r));end if;
 foreach cp in array array[1,2,3,4,5,6,7,8,9,10,11,12,13] loop
  if coalesce(done,'[]'::jsonb) ? cp::text then
   table_name:=case when cp=1 then 'checkpoint_runs' when cp in(6,8) then 'detour_runs' else 'checkpoint'||cp||'_runs' end;
   if cp in(6,8) then select to_jsonb(d) into r from public.detour_runs d where d.team_id=team and checkpoint=cp;
   else execute format('select to_jsonb(r) from public.%I r where team_id=$1',table_name) into r using team;end if;
   -- Whitelist story fields; never expose participant answers, private notes, or other players' reflections.
   if r is not null then
    r:=jsonb_build_object('id',r->'id','choice',r->'choice','ending_choice',r->'ending_choice','passed',r->'passed','phase',r->'phase');
    if cp=10 then r:=r||jsonb_build_object('reflection',(select choice from public.checkpoint10_reflections where run_id=(r->>'id')::uuid and player_id=p_player));end if;
    items:=items||jsonb_build_array(jsonb_build_object('checkpoint',cp,'run',r));
   end if;
  end if;
 end loop;
 return jsonb_build_object('records',items);
end;$$;
revoke all on function public.story_archive(text,uuid) from public,anon,authenticated;
grant execute on function public.story_archive(text,uuid) to service_role;
commit;
