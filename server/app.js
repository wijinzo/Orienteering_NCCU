import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, matchesInvite } from './auth.js';
import { createLetterWriter } from './finale-letter-ai.js';
import { randomUUID, createHash } from 'node:crypto';
import { InputError, parseRegistration, parseProgress } from './validation.js';
import { StorageError } from './repository.js';
import { createClassifier, AiError, isCorrectGuess } from './checkpoint2-ai.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

export function createApp({ config, repository, classifier = createClassifier({apiKey:config.openaiApiKey,model:config.openaiModel}), letterWriter = createLetterWriter({apiKey:config.openaiApiKey,model:config.openaiModel}) }) {
  const app = express();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const auth = createAuth(config);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(self), microphone=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  const frontendOrigins=new Set(config.frontendOrigins??[]);
  app.use('/api',(req,res,next)=>{
    const origin=req.get('Origin'),allowed=frontendOrigins.has(origin);
    if(allowed){res.vary('Origin');res.set({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'});}
    if(req.method==='OPTIONS')return allowed?res.sendStatus(204):res.status(403).json({error:'此網站來源未獲允許。',code:'ORIGIN_DENIED'});
    next();
  });
  app.use('/api', express.json({ limit: '32kb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.post('/api/auth/login', async (req, res) => {
    const input = parseRegistration(req.body);
    if (!matchesInvite(input.inviteCode, config.inviteCode)) return res.status(401).json({ error: '活動邀請碼不正確，請確認後重試。', code: 'INVITE_INVALID' });
    const result = await repository.register(input.teamNumber, createHash('sha256').update(input.deviceKey).digest('hex'));
    if (result.error) return res.status(409).json(result);
    const { player, progress, team } = result;
    const token = await auth.issue(player);
    res.json({ token, expires_in: config.ttlDays * 86400, player, progress, team });
  });

  app.use('/api', async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') ?? '');
    let playerId;
    try {
      if (!match) throw new Error('Missing token');
      playerId = await auth.verify(match[1]);
    } catch {
      return res.status(401).json({ error: '登入已失效，請重新登入。', code: 'AUTH_INVALID' });
    }
    // Keep database outages separate from invalid credentials.
    const player = await repository.getPlayer(playerId);
    if (!player) return res.status(401).json({ error: '找不到玩家，請重新登入。', code: 'AUTH_INVALID' });
    req.player = player;
    next();
  });
  app.get('/api/me', (req, res) => res.json({ player: req.player }));
  app.get('/api/achievements',async(req,res)=>{const result=await repository.achievements(req.player.id);res.status(result.error?409:200).json(result);});
  app.get('/api/support', (req,res)=>res.json({account:config.supportIgAccount||null,text:config.supportContactText||'請用 IG 搜尋此帳號，私訊聯絡我'}));
  app.get('/api/story-records',async(req,res)=>{const result=await repository.storyArchive(req.player.id);res.status(result.error?409:200).json(result);});
  app.get('/api/prologue',async(req,res)=>{const result=await repository.prologueAction(req.player.id,'get');res.status(result.error?409:200).json(result);});
  app.post('/api/prologue/:action',async(req,res)=>{
    if(!['choose','finish'].includes(req.params.action))return res.status(404).json({error:'找不到此操作。'});
    const body=req.body;
    if(!body||!uuid.test(body.run_id??''))throw new InputError('開場資料格式錯誤。');
    if(req.params.action==='choose'&&(!['help','depart'].includes(body.slot)||!['yes','guardian','reward','ready','where','first'].includes(body.choice)))throw new InputError('請選擇有效選項。');
    const result=await repository.prologueAction(req.player.id,req.params.action,{run_id:body.run_id,slot:body.slot,choice:body.choice});res.status(result.error?409:200).json(result);
  });
  app.get('/api/memories',async(req,res)=>{const result=await repository.memoryAction(req.player.id,'get');return res.status(result.error?409:200).json(result);});
  app.post('/api/memories/complete',async(req,res)=>{const result=await repository.memoryAction(req.player.id,'complete');return res.status(result.error?409:200).json(result);});
  app.get('/api/calls',async(req,res)=>{const result=await repository.detourAction(req.player.id,'history');return res.status(result.error?409:200).json(result);});
  app.get('/api/game', async (req, res) => {
    if(req.query.follow==='1'&&repository.followGame){const cp=Number(req.query.checkpoint??0);if(!Number.isInteger(cp)||cp<0||cp>13)throw new InputError('地點格式錯誤。');const result=await repository.followGame(req.player.id,cp);return res.status(result.error?409:200).json(result);}
    if(repository.detourAction){
      if(['6','8'].includes(req.query.checkpoint)){const result=await repository.detourAction(req.player.id,'get',{checkpoint:Number(req.query.checkpoint)});return res.status(result.error?409:200).json(result);}
      if(!req.query.checkpoint||req.query.calls==='1'){const result=await repository.detourAction(req.player.id,'get');if(result.run)return res.json(result);}
    }
    if(req.query.checkpoint==='10'&&repository.game10Action){const result=await repository.game10Action(req.player.id,'get');return res.status(result.error?409:200).json(result);}
    if(!req.query.checkpoint&&repository.game10Action){const result=await repository.game10Action(req.player.id,'get');if(result.run)return res.json(result);}
    if (req.query.checkpoint === '7' && repository.game7Action) {const result=await repository.game7Action(req.player.id,'get');return res.status(result.error?409:200).json(result);}
    if (req.query.checkpoint === '5' && repository.game5Action) {const result=await repository.game5Action(req.player.id,'get');return res.status(result.error?409:200).json(result);}
    if (!req.query.checkpoint && repository.game5Action) {const result=await repository.game5Action(req.player.id,'get');if(result.run&&result.run.phase!=='finished')return res.json(result);}
    if (req.query.checkpoint === '12' && repository.game12Action) {const result=await repository.game12Action(req.player.id,'get');return res.status(result.error?409:200).json(result);}
    if (req.query.checkpoint === '4' && repository.game4Action) {const result=await repository.game4Action(req.player.id,'get');return res.status(result.error?409:200).json(result);}
    if (!req.query.checkpoint && repository.game4Action) {const result=await repository.game4Action(req.player.id,'get');if(result.run&&result.run.phase!=='finished')return res.json(result);}
    if (req.query.checkpoint === '9' && repository.game9Action) {const result=await repository.game9Action(req.player.id,'get');return res.status(result.error?409:200).json(result);}
    if (req.query.checkpoint === '3' && repository.game3Action) { const result=await repository.game3Action(req.player.id,'get');return res.status(result.error?409:200).json(result); }
    if (!req.query.checkpoint && repository.game3Action) { const result=await repository.game3Action(req.player.id,'get');if(result.run&&result.run.phase!=='finished')return res.json(result); }
    if (req.query.checkpoint === '13' && repository.game13Action) { const result = await repository.game13Action(req.player.id,'get'); return res.status(result.error?409:200).json(result); }
    if (req.query.checkpoint === '2' && repository.game2Action) { const result = await repository.game2Action(req.player.id,'get'); return res.status(result.error?409:200).json(result); }
    if (req.query.checkpoint === '11' && repository.game11Action) { const result = await repository.game11Action(req.player.id,'get'); return res.status(result.error?409:200).json(result); }
    const result = await repository.gameAction(req.player.id, 'get');
    if (req.query.checkpoint === '1') return res.status(result.error?409:200).json(result);
    if (!result.error && repository.game11Action) {
      const eleven = await repository.game11Action(req.player.id, 'get');
      if (eleven.run && eleven.run.phase !== 'finished') return res.json(eleven);
      if (repository.game2Action) { const two=await repository.game2Action(req.player.id,'get');if(two.run && two.run.phase !== 'finished')return res.json(two); }
      if (eleven.run) return res.json(eleven);
    }
    res.status(result.error ? 409 : 200).json(result);
  });
  app.post('/api/game/:action', async (req, res) => {
    const action = req.params.action, body = req.body;
    if (!['enter', 'ready', 'choose', 'answer', 'finish', 'find', 'ask', 'guess', 'puzzle', 'complete', 'reflect', 'read', 'note', 'letter'].includes(action)) return res.status(404).json({ error: '找不到此操作。' });
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('操作資料格式錯誤。');
    if (action === 'enter') {
      if ('checkpoint' in body && (!Number.isInteger(body.checkpoint) || body.checkpoint<1 || body.checkpoint>13)) throw new InputError('地點格式錯誤。');
      const payload = { ...('checkpoint' in body ? { checkpoint: body.checkpoint } : {}) };
      if ('code' in body) {
        const code = typeof body.code === 'string' ? body.code.replace(/[\s-]/g, '').toUpperCase() : '';
        if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new InputError('請輸入現場標示的 8 碼地點代碼。');
        payload.code_hash = createHash('sha256').update(code).digest('hex');
      }
      const resolved = payload.code_hash && repository.resolveCode ? await repository.resolveCode(payload.code_hash) : payload.checkpoint;
      if (payload.checkpoint && resolved && payload.checkpoint !== resolved) return res.status(409).json({error:'地點代碼與 QR Code 不相符。',code:'CODE_INVALID'});
      if([6,8].includes(resolved)&&repository.detourAction){const result=await repository.detourAction(req.player.id,action,{...payload,checkpoint:resolved});return res.status(result.error?409:200).json(result);}
      if(resolved===10&&repository.game10Action){const result=await repository.game10Action(req.player.id,action,payload);return res.status(result.error?409:200).json(result);}
      if(resolved===5&&repository.game5Action){const result=await repository.game5Action(req.player.id,action,payload);return res.status(result.error?409:200).json(result);}
      if(resolved===7&&repository.game7Action){const result=await repository.game7Action(req.player.id,action,payload);return res.status(result.error?409:200).json(result);}
      if(resolved===12&&repository.game12Action){const result=await repository.game12Action(req.player.id,action,payload);return res.status(result.error?409:200).json(result);}
      if(resolved===4&&repository.game4Action){const result=await repository.game4Action(req.player.id,action,payload);return res.status(result.error?409:200).json(result);}
      if (resolved === 3 && repository.game3Action) {const result=await repository.game3Action(req.player.id,action,payload);return res.status(result.error?409:200).json(result);}
      if (resolved === 9 && repository.game9Action) {const result=await repository.game9Action(req.player.id,action,payload);return res.status(result.error?409:200).json(result);}
      if (resolved === 2 && repository.game2Action) { const result=await repository.game2Action(req.player.id,action,payload);return res.status(result.error?409:200).json(result); }
      if (resolved === 13 && repository.game13Action) { const result=await repository.game13Action(req.player.id,action,payload);return res.status(result.error?409:200).json(result); }
      let result = payload.checkpoint === 11 && !payload.code_hash && repository.game11Action
        ? await repository.game11Action(req.player.id, action, payload)
        : await repository.gameAction(req.player.id, action, payload);
      if (result.code === 'NOT_IMPLEMENTED' && result.error?.includes('11') && repository.game11Action) result = await repository.game11Action(req.player.id, action, payload);
      return res.status(result.error ? 409 : 200).json(result);
    }
    if (action !== 'enter' && !uuid.test(body.run_id ?? '')) throw new InputError('請重新讀取目前任務。');
    if(body.vote_round!==undefined&&(!Number.isInteger(body.vote_round)||body.vote_round<1||body.vote_round>2147483647))throw new InputError('請重新讀取目前的選擇。');
    if([6,8].includes(body.checkpoint)&&repository.detourAction&&action==='finish'){const result=await repository.detourAction(req.player.id,action,body);return res.status(result.error?409:200).json(result);}
    if(body.checkpoint===10&&repository.game10Action&&action==='letter'){
      const lease=randomUUID();
      const claim=await repository.game10Action(req.player.id,'letter_claim',{run_id:body.run_id,lease});
      if(claim.error)return res.status(409).json(claim);
      if(!claim.letter_claimed)return res.json(claim);
      let reply;
      try{reply=await letterWriter(claim.note);}catch(error){
        await repository.game10Action(req.player.id,'letter_release',{run_id:body.run_id,lease}).catch(()=>{});throw error;
      }
      const result=await repository.game10Action(req.player.id,'letter_save',{run_id:body.run_id,lease,text:reply});
      return res.status(result.error?409:200).json(result);
    }
    if(body.checkpoint===10&&repository.game10Action&&['guess','reflect','read','note'].includes(action)){
      if(action==='note'&&(typeof body.text!=='string'||!body.text.trim()||[...body.text.trim()].length>300))throw new InputError('請輸入 1～300 字的回憶。');
      const result=await repository.game10Action(req.player.id,action,action==='note'?{...body,text:body.text.trim()}:body);return res.status(result.error?409:200).json(result);
    }
    if(body.checkpoint===7&&repository.game7Action&&['choose','answer','finish'].includes(action)){
      if(action==='answer'&&(!Array.isArray(body.order)||body.order.length!==6||new Set(body.order).size!==6||body.order.some(id=>!Number.isInteger(id)||id<1||id>6)))throw new InputError('請排列完整的六張事件卡。');
      const result=await repository.game7Action(req.player.id,action,body);return res.status(result.error?409:200).json(result);
    }
    if(body.checkpoint===5&&repository.game5Action&&['choose','answer','finish'].includes(action)){
      if(action==='answer'&&(typeof body.answer!=='string'||!/^[0-9]{4}$/.test(body.answer)||!uuid.test(body.request_id??'')))throw new InputError('請輸入四位數密碼。');
      const result=await repository.game5Action(req.player.id,action,body);return res.status(result.error?409:200).json(result);
    }
    if(body.checkpoint===12&&repository.game12Action&&['choose','answer','finish'].includes(action)){
      if(action==='answer'&&(typeof body.answer!=='string'||body.answer.length>100||!/^[A-Za-z]{1,30}$/.test(body.answer.trim())))throw new InputError('請輸入英文單字。');
      const result=await repository.game12Action(req.player.id,action,body);return res.status(result.error?409:200).json(result);
    }
    if(body.checkpoint===4&&repository.game4Action&&['ready','answer','finish'].includes(action)){
      if(action==='answer'&&(typeof body.answer!=='string'||!body.answer.trim()||body.answer.length>100))throw new InputError('請輸入 1～100 字的石碑文字。');
      const result=await repository.game4Action(req.player.id,action,body);return res.status(result.error?409:200).json(result);
    }
    if (body.checkpoint === 9 && repository.game9Action && ['choose','answer','finish'].includes(action)) {
      if(action==='answer'&&(typeof body.answer!=='string'||!/^[0-9]{1,2}$/.test(body.answer)))throw new InputError('請只輸入數字樓層。');
      const result=await repository.game9Action(req.player.id,action,body);return res.status(result.error?409:200).json(result);
    }
    if (body.checkpoint === 3 && repository.game3Action && ['choose','complete','finish'].includes(action)) {if(action==='complete'&&body.shots!==undefined&&(!Number.isInteger(body.shots)||body.shots<1||body.shots>100000))throw new InputError('彈射次數格式錯誤。');const result=await repository.game3Action(req.player.id,action,body);return res.status(result.error?409:200).json(result);}
    if (body.checkpoint === 13 && repository.game13Action && ['choose','puzzle','guess','finish'].includes(action)) {
      if (action === 'guess' && (typeof body.guess !== 'string' || body.guess.length > 100)) throw new InputError('請輸入建築名稱。');
      const result=await repository.game13Action(req.player.id,action,body); return res.status(result.error?409:200).json(result);
    }
    if (body.checkpoint === 2 && ['choose','ask','guess','finish'].includes(action)) {
      if (action === 'choose' && !['ask','ready'].includes(body.choice)) throw new InputError('請選擇有效選項。');
      if (action === 'guess') {
        if (typeof body.guess !== 'string' || body.guess.length>100) throw new InputError('請輸入建築名稱。');
        if (!isCorrectGuess(body.guess)) return res.json({wrong:true});
        const result=await repository.game2Action(req.player.id,'guess',{run_id:body.run_id});return res.status(result.error?409:200).json(result);
      }
      if (action === 'ask') {
        if(typeof body.question!=='string'||!body.question.trim()||body.question.length>300||!uuid.test(body.request_id??''))throw new InputError('請輸入 1～300 字的問題。');
        if(isCorrectGuess(body.question)) {const result=await repository.game2Action(req.player.id,'guess',{run_id:body.run_id});return res.status(result.error?409:200).json(result);}
        const payload={run_id:body.run_id,request_id:body.request_id,question:body.question.trim()};
        const reserved=await repository.game2Action(req.player.id,'reserve',payload);
        if(reserved.error)return res.status(409).json(reserved);
        if(reserved.duplicate)return res.json(await repository.game2Action(req.player.id,'get'));
        try {const history=reserved.run?.messages?.map(({question,answer,hint})=>({question,answer,hint}))??[];const answer=await classifier(payload.question,history);const result=await repository.game2Action(req.player.id,'complete',{...payload,...answer});return res.status(result.error?409:200).json(result);}
        catch(error){await repository.game2Action(req.player.id,'fail',payload);if(error instanceof AiError)return res.status(503).json({error:error.message,code:'AI_UNAVAILABLE'});throw error;}
      }
      const result=await repository.game2Action(req.player.id,action,body);return res.status(result.error?409:200).json(result);
    }
    if (body.checkpoint === 11 && ['choose', 'find', 'finish'].includes(action)) {
      if (action === 'choose' && !['question','promise'].includes(body.choice)) throw new InputError('請選擇有效選項。');
      if (action === 'find' && (!Number.isInteger(body.photo) || body.photo<1 || body.photo>6 || !Number.isFinite(body.x) || !Number.isFinite(body.y) || body.x<0 || body.x>1 || body.y<0 || body.y>1)) throw new InputError('點擊位置不正確。');
      const result = await repository.game11Action(req.player.id, action, body);
      return res.status(result.error ? 409 : 200).json(result);
    }
    if (action === 'find') throw new InputError('地點不正確。');
    if (action === 'choose' && !['genius', 'hint'].includes(body.choice)) throw new InputError('請選擇有效的劇情選項。');
    if (action === 'answer' && !['A', 'B', 'C', 'D'].includes(body.answer)) throw new InputError('請選擇一個答案。');
    const result = await repository.gameAction(req.player.id, action, body);
    res.status(result.error ? 409 : 200).json(result);
  });
  app.get('/api/team', async (req, res) => res.json(await repository.teamAction(req.player.id, 'get')));
  app.post('/api/team/leave',async(req,res)=>{
    if(req.body?.confirm!==true||Object.keys(req.body).some(key=>key!=='confirm'))throw new InputError('請先確認要離開目前隊伍。');
    const result=await repository.leaveTeam(req.player.id);
    res.status(result.error?409:200).json(result);
  });
  app.post('/api/team/:action', async (req, res) => {
    if (!['name', 'ready', 'vote'].includes(req.params.action)) return res.status(404).json({ error: '找不到此操作。' });
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('請提供正確資料。');
    if (req.params.action === 'name') {
      if (typeof body.name !== 'string' || !body.name.trim() || [...body.name.trim()].length > 20 || /[\u0000-\u001f\u007f]/.test(body.name)) throw new InputError('請輸入 1～20 字的冒險者名字。');
      body.name = body.name.trim();
    }
    if (req.params.action === 'ready' && typeof body.ready !== 'boolean') throw new InputError('請確認準備狀態。');
    if (req.params.action === 'vote' && (!Number.isInteger(body.round) || typeof body.candidate !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.candidate))) throw new InputError('請選擇本輪候選人。');
    const result = await repository.teamAction(req.player.id, req.params.action, body);
    res.status(result.error ? 409 : 200).json(result);
  });
  app.get('/api/progress', async (req, res) => res.json({ progress: await repository.getProgress(req.player.id) }));
  app.put('/api/progress', async (req, res) => {
    const progress = parseProgress(req.body);
    if (progress.completed_checkpoints.some(id => ['1', '2', '3', '4', '5', '7', '8', '9', '10', '11', '12', '13'].includes(id)) || 'branch_4_detour' in progress.choices || 'branch_1_detour' in progress.choices) throw new InputError('正式關卡進度由後端判定，不能手動修改。');
    res.json({ progress: await repository.saveProgress(req.player.id, progress) });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: '找不到此 API。', code: 'NOT_FOUND' }));
  app.get('/vendor/jsqr.js', (req, res) => res.sendFile(fileURLToPath(new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url))));
  app.use(express.static(publicDir, { dotfiles: 'deny', etag: true }));
  // Both native camera links and the in-app scanner use this same authenticated app.
  app.get('/checkpoint/:checkpointId', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.use((req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

  app.use((error, req, res, next) => {
    if (error instanceof InputError) return res.status(400).json({ error: error.message, code: 'INPUT_INVALID' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '傳送的資料過大。', code: 'BODY_TOO_LARGE' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 格式錯誤。', code: 'INPUT_INVALID' });
    if (error instanceof AiError) return res.status(503).json({error:error.message,code:'AI_UNAVAILABLE'});
    if (error instanceof StorageError) return res.status(503).json({ error: error.message, code: 'STORAGE_UNAVAILABLE' });
    // Never log request bodies, database credentials or bearer tokens.
    console.error('Request failed:', error.name);
    res.status(500).json({ error: '系統暫時無法處理，請稍後重試。', code: 'INTERNAL_ERROR' });
  });
  return app;
}
