export class StorageError extends Error {}

export function createRepository(config, request = fetch) {
  const headers = { apikey: config.supabaseKey, 'Content-Type': 'application/json' };
  // New secret keys belong in apikey only. Legacy service_role JWTs also use Authorization.
  if (!config.supabaseKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${config.supabaseKey}`;

  async function call(path, options = {}) {
    try {
      const response = await request(`${config.supabaseUrl}/rest/v1/${path}`, {
        ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new StorageError('資料庫暫時無法使用。');
      return await response.json();
    } catch {
      throw new StorageError('資料庫暫時無法使用，請稍後重試。');
    }
  }

  const playerFields = 'id,player_code,created_at,last_login_at';
  const progressFields = 'current_checkpoint,completed_checkpoints,choices,updated_at';
  const query = (table, parameters) => `${table}?${new URLSearchParams(parameters)}`;

  return {
    async adminOverview(offset=0){return call('rpc/admin_overview',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_offset:offset})});},
    async adminLogs(offset=0){return call('rpc/admin_logs',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_offset:offset})});},
    async adminAction(actor,request,action,team,payload){return call('rpc/admin_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_actor:actor,p_request:request,p_action:action,p_team:team,p_payload:payload})});},
    async registerSolo(deviceHash,name){return call('rpc/register_solo_player',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_device_hash:deviceHash,p_name:name})});},
    async leaveTeam(playerId){return call('rpc/leave_team',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId})});},
    async achievements(playerId){return call('rpc/get_achievements',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId})});},
    async prologueAction(playerId,action,payload={}) { return call('rpc/prologue_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_action:action,p_payload:payload})}); },
    async storyArchive(playerId) { return call('rpc/story_archive',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId})}); },
    async followGame(playerId,checkpoint=0){return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:checkpoint,p_action:'get',p_payload:{follow:true}})});},
    async detourAction(playerId, action, payload = {}) { if(action==='enter')return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:payload.checkpoint,p_action:action,p_payload:payload})});return call('rpc/detour_action', {method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_action:action,p_payload:payload})}); },
    async game10Action(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:10,p_action:action,p_payload:payload})}); },
    async memoryAction(playerId, action, payload = {}) { return call('rpc/memory_action', { method: 'POST', body: JSON.stringify({ p_activity: config.activityId, p_player: playerId, p_action: action, p_payload: payload }) }); },
    async game7Action(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:7,p_action:action,p_payload:payload})}); },
    async game5Action(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:5,p_action:action,p_payload:payload})}); },
    async game12Action(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:12,p_action:action,p_payload:payload})}); },
    async game4Action(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:4,p_action:action,p_payload:payload})}); },
    async game9Action(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:9,p_action:action,p_payload:payload})}); },
    async game3Action(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:3,p_action:action,p_payload:payload})}); },
    async game13Action(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:13,p_action:action,p_payload:payload})}); },
    async game2Action(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:2,p_action:action,p_payload:payload})}); },
    async resolveCode(hash) { return call('rpc/resolve_checkpoint_code', { method: 'POST', body: JSON.stringify({ p_activity: config.activityId, p_hash: hash }) }); },
    async game11Action(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:11,p_action:action,p_payload:payload})}); },
    async gameAction(playerId,action,payload={}) { return call('rpc/team_game_action',{method:'POST',body:JSON.stringify({p_activity:config.activityId,p_player:playerId,p_checkpoint:1,p_action:action,p_payload:payload})}); },
    async register(teamNumber, deviceHash) {
      return call('rpc/register_team_player', { method: 'POST', body: JSON.stringify({ p_activity: config.activityId, p_team_number: teamNumber, p_device_hash: deviceHash }) });
    },
    async teamAction(playerId, action, payload = {}) {
      return call('rpc/team_action', { method: 'POST', body: JSON.stringify({ p_activity: config.activityId, p_player: playerId, p_action: action, p_payload: payload }) });
    },
    async login(playerCode) {
      const result = await call('rpc/login_player', {
        method: 'POST', body: JSON.stringify({ p_activity_id: config.activityId, p_player_code: playerCode }),
      });
      return result;
    },
    async getPlayer(playerId) {
      const rows = await call(query('players', { id: `eq.${playerId}`, activity_id: `eq.${config.activityId}`, select: playerFields+',team_members!inner(team_id)' }));
      if(!rows[0])return null;const {team_members,...player}=rows[0];return player;
    },
    async getProgress(playerId) {
      const rows = await call(query('player_progress', { player_id: `eq.${playerId}`, select: progressFields }));
      if (!rows[0]) throw new StorageError('找不到進度資料，請重新登入。');
      return rows[0];
    },
    async saveProgress(playerId, progress) {
      const rows = await call(query('player_progress', { player_id: `eq.${playerId}`, select: progressFields }), {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(progress),
      });
      if (!rows[0]) throw new StorageError('找不到進度資料，請重新登入。');
      return rows[0];
    },
  };
}
