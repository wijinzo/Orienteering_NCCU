import {createApi} from './progress.js';
import {createWaitFrog} from './network-wait.js';
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(cls)item.className=cls;return item;};
const button=(text,handler)=>{const item=node('button',text);item.type='button';item.onclick=handler;return item;};
const KEY='memory.admin.token';let token=null,data=null,logs=null,view='teams',soloOffset=0,logsOffset=0,generation=0,reading=false,mutating=false,timer,selected=null,retryJob=null;
try{token=sessionStorage.getItem(KEY);}catch{}
const api=createApi(()=>token,fetch,()=>()=>{});
const date=value=>value?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—';
const phase=value=>({empty:'尚未加入',lobby:'集合中',voting:'選隊長中',elected:'探索中',story:'劇情中',loading:'準備中',running:'作答中',play:'遊戲中',search:'找奶蛙',chat:'問答中',puzzle:'拼圖中',answer:'待作答',success:'已達成',settled:'結果已結算',finished:'關卡已結束'}[value]??value??'—');
function text(id,value){$(id).textContent=value??'';$(id).hidden=!value;}
function loginHeading(active){const next=node(active?'h1':'h2','活動管理','login-title');next.id='admin-login-title';$('admin-login-title').replaceWith(next);}
function wait(active,label='正在讀取隊伍…'){
 for(const id of ['admin-wait','detail-wait']){const show=active&&(id==='admin-wait'||mutating&&$('admin-detail').open);$(id).hidden=!show;$(id).replaceChildren();if(show)$(id).append(createWaitFrog(),node('p',label));}
 $('admin-refresh').disabled=active;
}
function logout(message=''){
 generation++;clearTimeout(timer);token=null;data=null;logs=null;selected=null;retryJob=null;reading=false;mutating=false;
 loginHeading(true);
 try{sessionStorage.removeItem(KEY);}catch{}if($('admin-detail').open)$('admin-detail').close();
 document.querySelectorAll('#admin-workspace button,#admin-logout').forEach(item=>item.disabled=false);
 for(const id of ['admin-team-list','admin-solo-list','admin-log-list','admin-recent','admin-waiting','detail-content'])$(id).replaceChildren();
 $('admin-login').hidden=false;$('admin-workspace').hidden=true;$('admin-logout').hidden=true;wait(false);text('admin-login-error',message);$('admin-password').value='';
}
function error(error,id='admin-error'){if(error.code==='ADMIN_AUTH_INVALID'){logout(error.message);return;}text(id,error.message||'操作失敗，請重新整理後再試。');}
function enter(){loginHeading(false);$('admin-login').hidden=true;$('admin-workspace').hidden=false;$('admin-logout').hidden=false;text('admin-login-error','');schedule(true);}
function switchView(next){view=next;for(const name of ['teams','solo','logs'])$('view-'+name).hidden=name!==view;document.querySelectorAll('[data-view]').forEach(item=>{if(item.dataset.view===view)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});$('admin-title').textContent={teams:'隊伍總覽',solo:'個人模式',logs:'操作紀錄'}[view];schedule(true);}
function schedule(immediate=false){clearTimeout(timer);if(!token||document.hidden)return;timer=setTimeout(async()=>{await load();schedule();},immediate?0:15000);}
async function load(){
 if(!token||reading||mutating||document.hidden)return;reading=true;const version=generation;wait(true);text('admin-error','');
 try{
  const jobs=await Promise.allSettled([api('/api/admin/overview?solo_offset='+soloOffset),api('/api/admin/logs?offset='+(view==='logs'?logsOffset:0))]);if(version!==generation)return;
  for(const job of jobs)if(job.status==='rejected'&&job.reason.code==='ADMIN_AUTH_INVALID'){error(job.reason);return;}
  if(jobs[0].status==='fulfilled'){data=jobs[0].value;renderOverview();}else error(jobs[0].reason);
  if(jobs[1].status==='fulfilled'){logs=jobs[1].value;renderLogs();}else error(jobs[1].reason);
 }finally{if(version===generation){reading=false;wait(false);}}
}
function teamRow(team){
 const row=node('article',undefined,'team-row'),solo=team.mode==='solo',leader=team.members.find(member=>member.id===team.leader_id);
 row.append(node('strong',solo?'個人':team.code,'team-code'));const info=node('div');info.append(node('strong',solo?(leader?.name||'冒險者'):(leader?.name?'隊長 '+leader.name:phase(team.phase))),node('small',`${team.members.length} 人 · ${phase(team.game_phase||team.phase)}`));row.append(info);
 const count=team.completed_checkpoints.length,progress=node('div',`${count}／13 地點`,'team-progress');progress.append(node('small',team.current_checkpoint?'目前地點 '+team.current_checkpoint:'尚未進入關卡'));
 const track=node('div',undefined,'progress-track'),fill=node('span');fill.style.width=(count/13*100)+'%';track.append(fill);progress.append(track);row.append(progress,button('查看',()=>openTeam(team)));return row;
}
function renderOverview(){
 $('admin-activity').textContent='活動 · '+data.activity_id;$('admin-updated').textContent='更新於 '+date(data.server_time)+' · 前景每 15 秒更新';
 const teams=data.teams,joined=teams.filter(team=>team.id),summary=$('admin-summary');summary.replaceChildren();
 for(const [label,value] of [['已加入隊伍',`${joined.length}／10`],['團體玩家',joined.reduce((sum,team)=>sum+team.members.length,0)+' 人'],['已通關隊伍',joined.filter(team=>team.completed_checkpoints.includes('10')).length+' 組']]){const item=node('div');item.append(node('span',label),node('strong',value));summary.append(item);}
 $('admin-team-list').replaceChildren(...teams.map(teamRow));
 const waiting=teams.filter(team=>team.members.some(member=>member.waiting)||team.phase==='voting'||team.ballot);
 $('admin-waiting').replaceChildren(...(waiting.length?waiting.map(team=>{const item=node('div',undefined,'rail-item'),names=team.members.filter(member=>member.waiting).map(member=>member.name||member.code);item.append(node('strong','第 '+Number(team.code)+' 組'),node('p',names.length?'等待：'+names.join('、'):team.phase==='voting'?'正在選隊長':'正在確認對話選擇'),button('查看隊伍',()=>openTeam(team)));return item;}):[node('p','目前沒有等待中的隊伍。','empty')]));
 $('admin-solo-list').replaceChildren(...(data.solo.length?data.solo.map(teamRow):[node('p','目前沒有個人模式玩家。','empty')]));
 $('solo-total').textContent=`共 ${data.solo_total} 人 · 本頁 ${data.solo.length} 人`;$('solo-prev').disabled=soloOffset===0;$('solo-next').disabled=soloOffset+data.solo.length>=data.solo_total;
}
function logRow(entry,compact=false){
 const row=node('article',undefined,'audit-row'),head=node('header');head.append(node('strong',`第 ${Number(entry.team_code)} 組 · ${entry.action==='leader'?'更換隊長':entry.action==='pass'?'手動通過地點 '+entry.result.checkpoint:entry.action==='remove'?'移除隊員':'重設隊伍'}`),node('time',date(entry.created_at)));row.append(head);
 if(!compact){row.append(node('p',entry.actor,'muted'),node('p','原因：'+entry.reason,'reason'));if(entry.action==='leader')row.append(node('p',`${entry.result.old_leader_name||'尚未選出'} → ${entry.result.leader_name}；重新開始 ${entry.result.restarted_ballots} 筆未結算投票。`,'muted'));else if(entry.action==='remove')row.append(node('p',`已移除 ${entry.result.player_name||entry.result.player_code}（${entry.result.player_code}），保留已提交成績，釋回 ${entry.result.released_photos} 張照片。`,'muted'));else if(entry.action==='pass')row.append(node('p',`地點 ${entry.result.checkpoint} · 原狀態：${phase(entry.result.previous_phase)}；已完成並開放後續進度。`,'muted'));else row.append(node('p',`已重設 ${entry.result.reset_players} 位玩家的身分與進度。`,'muted'));}
 return row;
}
function renderLogs(){
 $('admin-log-list').replaceChildren(...(logs.logs.length?logs.logs.map(entry=>logRow(entry)):[node('p','目前沒有管理操作。','empty')]));
 $('logs-total').textContent=`共 ${logs.total} 筆`;$('logs-prev').disabled=logsOffset===0;$('logs-next').disabled=logsOffset+logs.logs.length>=logs.total;
 if(logs.offset===0)$('admin-recent').replaceChildren(...(logs.logs.length?logs.logs.slice(0,3).map(entry=>logRow(entry,true)):[node('p','目前沒有管理操作。','empty')]));
}
function field(form,label,id,tag='input'){
 const caption=node('label',label),input=node(tag);caption.htmlFor=id;input.id=id;input.required=true;if(tag==='input'){input.type='text';input.maxLength=200;}form.append(caption,input);return input;
}
function openTeam(team){
 if(mutating)return;selected=team;retryJob=null;text('detail-error','');$('admin-retry').hidden=true;$('detail-title').textContent=team.mode==='solo'?'個人冒險':'第 '+Number(team.code)+' 組';
 const body=$('detail-content');body.replaceChildren(node('p',`${phase(team.game_phase||team.phase)} · 已完成 ${team.completed_checkpoints.length}／13 地點`,'meta'));
 if(!team.members.length){body.append(node('p','尚無隊員加入，沒有可執行的管理操作。','empty'));$('admin-detail').showModal();return;}
 body.append(node('h3','隊員名單','detail-list-head'));const list=node('ul');
 for(const member of team.members){const item=node('li'),identity=node('div'),status=node('div');identity.append(node('strong',(member.name||'尚未填名字')+(member.id===team.leader_id?' · '+(team.mode==='solo'?'冒險者':'隊長'):'')),node('small',member.code));status.append(node('small',member.last_seen_at?'最近活動 '+date(member.last_seen_at):'尚未進入關卡'));if(member.waiting)status.append(node('span',member.waiting_reason||'此關尚未提交／完成','waiting-note'));item.append(identity,status);list.append(item);}body.append(list);
 if(team.mode==='solo'){body.append(node('p','個人模式不涉及隊長交接，此處僅供查看。','muted'));$('admin-detail').showModal();return;}
 if(team.current_checkpoint&&team.current_run_id&&team.game_phase&&team.game_phase!=='finished'&&team.phase==='elected'){
  const rescue=node('details',undefined,'danger-zone');rescue.append(node('summary','救援：手動通過目前地點 '+team.current_checkpoint));
  const pass=node('form',undefined,'reset-form');pass.append(node('p',`第 ${Number(team.code)} 組 · 地點 ${team.current_checkpoint} · ${phase(team.game_phase)}。完成此地點並開放後續路線；不補發實際遊玩成績。${[1,4].includes(team.current_checkpoint)?'本關會走成功路線。':''}`));
  const confirmCode=field(pass,'輸入兩位數組號 '+team.code+' 確認','admin-pass-confirm');confirmCode.maxLength=2;confirmCode.pattern=team.code;confirmCode.autocomplete='off';
  const passReason=field(pass,'通過原因','admin-pass-reason');passReason.placeholder='例如：照片點擊異常，現場已確認完成';
  const passButton=node('button','手動通過地點 '+team.current_checkpoint);passButton.type='submit';pass.append(passButton);
  pass.onsubmit=event=>{event.preventDefault();if(confirm(`確認協助第 ${Number(team.code)} 組通過地點 ${team.current_checkpoint}？這會直接結束目前關卡並留下操作紀錄。`))send({action:'pass',team_id:team.id,checkpoint:team.current_checkpoint,run_id:team.current_run_id,confirm:confirmCode.value,reason:passReason.value.trim()});};rescue.append(pass);body.append(rescue);
 }
 const form=node('form',undefined,'leader-form');form.append(node('h3',team.leader_id?'更換隊長':'指定隊長'));
 const pick=field(form,'新隊長','admin-new-leader','select');const empty=node('option','請選擇隊員');empty.value='';pick.append(empty);
 for(const member of team.members.filter(member=>member.name&&member.id!==team.leader_id)){const option=node('option',member.name+' · '+member.code);option.value=member.id;pick.append(option);}
 const reason=field(form,'操作原因','admin-leader-reason');reason.placeholder='例如：原隊長手機沒電';form.append(node('p','保留關卡進度；未結算的對話投票會重新開始。角色會自動更新，也可到隊伍頁立即更新；未送出的輸入需新隊長重新填寫。','muted'));
 const submit=node('button','確認更換隊長','primary');submit.type='submit';submit.disabled=pick.options.length===1;form.append(submit);form.onsubmit=event=>{event.preventDefault();const name=pick.selectedOptions[0].textContent;if(confirm(`確定將第 ${Number(team.code)} 組隊長改為「${name}」？未結算的對話投票將重新開始。`))send({action:'leader',team_id:team.id,leader_id:pick.value,expected_leader:team.leader_id??null,reason:reason.value.trim()});};body.append(form);
 const removeZone=node('details',undefined,'danger-zone');removeZone.append(node('summary','移除隊員'));
 const removeForm=node('form',undefined,'reset-form'),removePick=field(removeForm,'選擇要移除的隊員','admin-remove-member','select');const placeholder=node('option','請選擇隊員');placeholder.value='';removePick.append(placeholder);
 for(const member of team.members.filter(member=>member.id!==team.leader_id)){const option=node('option',(member.name||'尚未填名字')+' · '+member.code);option.value=member.id;removePick.append(option);}
 removeForm.append(node('p','保留已提交成績，原登入將失效；未完成的照片釋回分配，彈珠與投票不再等待他。隊長須先更換才能移除，最後一名隊員不能移除。','muted'));
 const removeConfirm=field(removeForm,'輸入該隊員的完整玩家編號','admin-remove-confirm');removeConfirm.autocomplete='off';removeConfirm.placeholder='例如：07-003';
 const removeReason=field(removeForm,'移除原因','admin-remove-reason');const removeButton=node('button','確認移除隊員');removeButton.type='submit';removeButton.disabled=removePick.options.length===1||team.members.length<=1;removeForm.append(removeButton);
 removeForm.onsubmit=event=>{event.preventDefault();if(confirm(`確定將「${removePick.selectedOptions[0].textContent}」移出第 ${Number(team.code)} 組？原登入會失效，已提交的成績將保留。`))send({action:'remove',team_id:team.id,player_id:removePick.value,confirm:removeConfirm.value.trim(),reason:removeReason.value.trim()});};removeZone.append(removeForm);body.append(removeZone);
 const danger=node('details',undefined,'danger-zone');danger.append(node('summary','重設這一組的全部遊戲資料'));const reset=node('form',undefined,'reset-form');reset.append(node('p','這會清除本組玩家身分、進度、私人留言與回信，無法在後台復原；其他組不受影響。'));
 const confirmation=field(reset,`輸入兩位數組號 ${team.code} 確認`,'admin-reset-confirm');confirmation.maxLength=2;confirmation.pattern=team.code;confirmation.autocomplete='off';
 const resetReason=field(reset,'重設原因','admin-reset-reason');const resetSubmit=node('button','重設第 '+Number(team.code)+' 組');resetSubmit.type='submit';reset.append(resetSubmit);reset.onsubmit=event=>{event.preventDefault();if(confirm(`最後確認：清除第 ${Number(team.code)} 組的全部玩家資料與進度？`))send({action:'reset',team_id:team.id,confirm:confirmation.value,reason:resetReason.value.trim()});};danger.append(reset);body.append(danger);$('admin-detail').showModal();
}
async function send(body,retry=false){
 if(mutating)return;const signature=JSON.stringify(body);if(!retryJob||!retry&&retryJob.signature!==signature)retryJob={body:{...body,request_id:crypto.randomUUID()},signature};
 mutating=true;const version=++generation;reading=false;clearTimeout(timer);wait(true,'正在執行管理操作…');text('detail-error','');$('admin-retry').hidden=true;
 document.querySelectorAll('#admin-detail button,#admin-detail input,#admin-detail select,[data-view],#admin-logout').forEach(item=>item.disabled=true);
 try{
  const result=await api('/api/admin/action',{method:'POST',body:retryJob.body,timeoutMs:30000});if(version!==generation)return;
  const action=retryJob.body.action;retryJob=null;$('admin-detail').close();text('admin-message',action==='remove'?`已將 ${result.player_name||result.player_code} 移出第 ${Number(result.team_code)} 組；原登入已失效，已提交成績保留。`:action==='pass'?`已協助第 ${Number(result.team_code)} 組通過地點 ${result.checkpoint}。隊員會於更新進度後收到結果。`:action==='reset'?`已重設第 ${Number(result.team_code)} 組。玩家需要重新選組登入。`:`已更新第 ${Number(result.team_code)} 組隊長；進行中的遊戲進度保留。`);
 }catch(e){if(version!==generation)return;error(e,'detail-error');if(token&&retryJob){$('admin-retry').hidden=false;$('admin-retry').textContent='重試原操作';}}
 finally{if(version===generation){mutating=false;wait(false);document.querySelectorAll('#admin-detail button,#admin-detail input,#admin-detail select,[data-view],#admin-logout').forEach(item=>item.disabled=false);schedule(true);}}
}
$('admin-login-form').onsubmit=async event=>{
 event.preventDefault();const submit=$('admin-login-submit');submit.disabled=true;submit.textContent='登入中…';text('admin-login-error','');$('admin-login-wait').hidden=false;$('admin-login-wait').replaceChildren(createWaitFrog(),node('p','正在確認管理身分…'));
 try{const result=await api('/api/admin/login',{method:'POST',token:null,body:{password:$('admin-password').value}});token=result.token;try{sessionStorage.setItem(KEY,token);}catch{}$('admin-password').value='';generation++;enter();}
 catch(e){text('admin-login-error',e.message);}finally{submit.disabled=false;submit.textContent='登入管理後台';$('admin-login-wait').hidden=true;$('admin-login-wait').replaceChildren();}
};
$('admin-logout').onclick=()=>logout();$('admin-refresh').onclick=()=>schedule(true);$('detail-close').onclick=()=>{if(!mutating)$('admin-detail').close();};$('admin-detail').addEventListener('cancel',event=>{if(mutating)event.preventDefault();});
$('admin-retry').onclick=()=>{if(retryJob)send(retryJob.body,true);};document.querySelectorAll('[data-view]').forEach(item=>item.onclick=()=>{if(!mutating)switchView(item.dataset.view);});
for(const [id,delta,kind] of [['solo-prev',-50,'solo'],['solo-next',50,'solo'],['logs-prev',-50,'logs'],['logs-next',50,'logs']])$(id).onclick=()=>{if(kind==='solo')soloOffset=Math.max(0,soloOffset+delta);else logsOffset=Math.max(0,logsOffset+delta);schedule(true);};
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)schedule(true);});window.addEventListener('online',()=>schedule(true));
if(token)enter();
