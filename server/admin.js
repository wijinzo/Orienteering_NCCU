import express from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {SignJWT,jwtVerify} from 'jose';
import {matchesInvite} from './auth.js';
import {InputError} from './validation.js';

export function createAdminRouter(config,repository){
 const router=express.Router(),issuer='orienteering-nccu-admin',audience=config.activityId+':admin';
 const key=createHash('sha256').update(config.tokenSecret+'\0admin\0'+(config.adminPassword??'')).digest();
 const enabled=typeof config.adminPassword==='string'&&config.adminPassword.length>=16;
 let failures=0,blockedUntil=0;
 router.use((req,res,next)=>{if(!enabled)return res.status(503).json({error:'管理後台尚未啟用，請設定至少 16 字元的 ADMIN_PASSWORD。',code:'ADMIN_DISABLED'});next();});
 router.post('/login',async(req,res)=>{
  if(Date.now()<blockedUntil){res.set('Retry-After',String(Math.ceil((blockedUntil-Date.now())/1000)));return res.status(429).json({error:'嘗試次數過多，請稍後再試。',code:'ADMIN_RATE_LIMIT'});}
  if(typeof req.body?.password!=='string'||req.body.password.length>200||!matchesInvite(req.body.password,config.adminPassword)){
   failures++;if(failures>=5){blockedUntil=Date.now()+15*60*1000;failures=0;}
   return res.status(401).json({error:'管理密碼不正確。',code:'ADMIN_AUTH_INVALID'});
  }
  failures=0;
  const session=randomUUID();const token=await new SignJWT({role:'admin',activity_id:config.activityId}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setSubject('organizer').setJti(session).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('1h').sign(key);
  res.json({token,expires_in:3600,activity_id:config.activityId});
 });
 router.use(async(req,res,next)=>{
  try{const match=/^Bearer ([^\s]+)$/.exec(req.get('Authorization')??'');if(!match)throw Error();
   const {payload}=await jwtVerify(match[1],key,{issuer,audience,algorithms:['HS256'],requiredClaims:['exp','iat','jti','sub']});
   if(payload.role!=='admin'||payload.activity_id!==config.activityId||payload.sub!=='organizer'||typeof payload.jti!=='string')throw Error();
   req.adminActor='管理者·'+payload.jti.slice(0,8);
  }catch{return res.status(401).json({error:'管理登入已失效，請重新登入。',code:'ADMIN_AUTH_INVALID'});}next();
 });
 const offset=value=>{if(value===undefined)return 0;if(typeof value!=='string'||!/^\d{1,6}$/.test(value)||Number(value)>100000)throw new InputError('分頁格式錯誤。');return Number(value);};
 router.get('/overview',async(req,res)=>res.json(await repository.adminOverview(offset(req.query.solo_offset))));
 router.get('/logs',async(req,res)=>res.json(await repository.adminLogs(offset(req.query.offset))));
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 router.post('/action',async(req,res)=>{
  const body=req.body;
  if(!body||!['leader','reset','pass','remove'].includes(body.action)||!uuid.test(body.team_id??'')||!uuid.test(body.request_id??'')||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>200)throw new InputError('請選擇隊伍並填寫操作原因（最多 200 字）。');
  const payload={reason:body.reason.trim()};
  if(body.action==='leader'){
   if(!uuid.test(body.leader_id??'')||(body.expected_leader!==null&&!uuid.test(body.expected_leader??'')))throw new InputError('請重新載入隊長與隊員名單。');
   Object.assign(payload,{leader_id:body.leader_id,expected_leader:body.expected_leader});
  }else if(body.action==='remove'){
   if(!uuid.test(body.player_id??'')||typeof body.confirm!=='string'||!/^\d{2}-\d{3,}$/.test(body.confirm))throw new InputError('請選擇隊員並輸入其玩家編號。');
   Object.assign(payload,{player_id:body.player_id,confirm:body.confirm});
  }else if(body.action==='pass'){
   if(!Number.isInteger(body.checkpoint)||body.checkpoint<1||body.checkpoint>13||!uuid.test(body.run_id??'')||typeof body.confirm!=='string'||!/^\d{2}$/.test(body.confirm))throw new InputError('請重新確認目前地點與兩位數組號。');
   Object.assign(payload,{checkpoint:body.checkpoint,run_id:body.run_id,confirm:body.confirm});
  }else{if(typeof body.confirm!=='string'||!/^\d{2}$/.test(body.confirm))throw new InputError('請輸入兩位數組號確認重設。');payload.confirm=body.confirm;}
  const result=await repository.adminAction(req.adminActor,body.request_id,body.action,body.team_id,payload);
  res.status(result.error?409:200).json(result);
 });
 router.use((req,res)=>res.status(404).json({error:'找不到此管理操作。',code:'NOT_FOUND'}));
 return router;
}
