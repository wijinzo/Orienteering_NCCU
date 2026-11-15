import {teamDisplayName} from './play-mode.js';
import {openJourneyViewer,closeJourneyViewer} from './journey-viewer.js';
import {storyNode as node,storyButton as button,storyNext,renderStoryScene} from './story-ui.js';
import {replayScenes,STORY_TITLES} from './story-replay.js';
import {mountDetourCall} from './detour-call.js';
import {mountPinball} from './pinball.js';
import {showFarewellPost,showCreditsReplay} from './sightings.js';
let api,player,team,version=0,records=[],tabRequest=0;
const find=id=>records.find(item=>item.checkpoint===id);
function replay(record){
 if(!record)return;const viewer=openJourneyViewer({title:STORY_TITLES[record.checkpoint]+' · 回放'}),scenes=replayScenes(record);let cursor=0;
 const render=()=>{viewer.body.replaceChildren();const scene=scenes[cursor];if(!scene){viewer.close();return;}renderStoryScene(viewer.body,{...scene,actions:[storyNext(()=>{cursor++;render();})]});if(scene.hideActor)viewer.body.querySelector('.story-actor img').hidden=true;
  const controls=node('div',undefined,'viewer-actions'),previous=button('上一段',()=>{cursor--;render();}),restart=button('從頭回看',()=>{cursor=0;render();});previous.disabled=cursor===0;controls.append(previous,restart);viewer.body.append(controls);viewer.status.textContent=`劇情回放 ${cursor+1}／${scenes.length} · 不影響闖關進度`;
 };render();
}
function replayCall(call,chat=false){
 const viewer=openJourneyViewer({title:`${call.kind==='bonus'?'番外通話':'奶龍來電'} · 地點 ${call.checkpoint} · 重播`}),memory=new Map([['call-stage',chat?'chat':'incoming']]);
 const view=mountDetourCall(viewer.body,{run:{...call,phase:'finished',next_id:call.checkpoint===8?11:12},leader:false,read:(key,fallback='')=>memory.get(key)??fallback,write:(key,value)=>memory.set(key,String(value)),finish:async()=>{},leave:viewer.close,replay:true});viewer.onDispose(()=>view.dispose());
 viewer.status.textContent='來電回顧 · 各自觀看，不影響隊伍進度';
}
function practice(){
 if(!find(3))return;let state=null;const viewer=openJourneyViewer({title:'奶蛋彈珠'});viewer.body.classList.add('pinball-body');
 const mount=()=>{viewer.body.replaceChildren();state=null;mountPinball(viewer.body,{choice:'practice',load:()=>state,save:value=>{state=value;},complete:async()=>{viewer.status.textContent='奶蛙都清完了！想玩的話，再來一局吧。';}});viewer.status.textContent='彈珠重玩 · 不影響闖關進度';};
 mount();const controls=node('div',undefined,'viewer-actions');controls.append(button('重新開始',mount),button('結束遊戲',viewer.close));viewer.stage.insertBefore(controls,viewer.status);
}
function recordsList(){
 const list=document.getElementById('story-record-list');list.replaceChildren();if(!records.length)list.append(node('p','完成開場或地點後，劇情會收藏在這裡。','field-help'));
 for(const [title,ids] of [['開場',[0]],['記憶 I',[1,8,11]],['記憶 II',[2,13]],['記憶 III',[3,9]],['記憶 IV',[4,6,12]],['記憶 V',[5,7]],['結局',[10]]]){
  const items=ids.map(find).filter(Boolean);if(!items.length)continue;list.append(node('h3',title));
  for(const record of items){if([6,8].includes(record.checkpoint))list.append(button(STORY_TITLES[record.checkpoint],()=>replayCall({...record.run,checkpoint:record.checkpoint})));else list.append(button(STORY_TITLES[record.checkpoint],()=>replay(record)));}
  if(ids.includes(10)&&find(10))list.append(button('奶龍的最後一則貼文',()=>showFarewellPost({force:true})),button('重看謝幕與參考資料',showCreditsReplay));
 }
}
async function loadRecords(){
 const expected=version,request=++tabRequest,list=document.getElementById('story-record-list');list.replaceChildren(node('p','正在找回收藏的劇情…','field-help'));
 try{const result=await api('/api/story-records',{wait:true,waitLabel:'正在找回收藏的劇情…'});if(expected!==version||request!==tabRequest)return;records=result.records;recordsList();}
 catch(error){if(expected===version&&request===tabRequest)list.replaceChildren(node('p',error.message,'error-message'),button('重試',loadRecords));}
}
async function loadContacts(){
 const expected=version,request=++tabRequest,callList=document.getElementById('detour-call-history'),practiceButton=document.getElementById('practice-pinball'),support=document.getElementById('support-contact');
 callList.replaceChildren(node('p','正在找回來電紀錄…','field-help'));practiceButton.disabled=true;support.replaceChildren(node('p','正在讀取聯絡資訊…','field-help'));
 const results=await Promise.allSettled([api('/api/calls'),api('/api/story-records'),api('/api/support')]);if(expected!==version||request!==tabRequest)return;
 const [calls,archive,contact]=results;
 callList.replaceChildren();if(calls.status==='fulfilled'){const completed=calls.value.calls.filter(call=>call.phase==='finished');if(!completed.length)callList.append(node('p','完成來電地點會留下紀錄；支線一、四完成後，也可補看對應的番外通話。','field-help'));for(const call of completed){const bonus=call.kind==='bonus',row=node('div',undefined,'contact-call');row.append(node('p',`地點 ${call.checkpoint} · ${bonus?'番外通話':'來電紀錄'}`),button(bonus?'播放番外通話':'重聽通話',()=>replayCall(call)),button(bonus?'查看聊天室':'回看聊天室',()=>replayCall(call,true)));callList.append(row);}}
 else callList.append(node('p','來電紀錄暫時無法載入。','field-help'),button('重試',loadContacts));
 if(archive.status==='fulfilled')records=archive.value.records;practiceButton.disabled=archive.status!=='fulfilled'||!find(3);document.getElementById('practice-pinball-note').textContent=archive.status!=='fulfilled'?'暫時無法確認解鎖狀態，請重新載入。':find(3)?'各自重玩，不影響隊伍進度。':'完成地點 3 後，就能隨時回來重玩。';if(archive.status!=='fulfilled')document.getElementById('practice-pinball-note').append(button('重試',loadContacts));
 support.replaceChildren();if(contact.status==='fulfilled'){const {account,text}=contact.value;if(account){support.append(node('p',text),node('p',account,'contact-account'),button('複製 IG 帳號',()=>copy(account,support)),button('複製小組與玩家資訊',()=>copy(`遊玩：${teamDisplayName(team)}\n玩家：${team?.members?.find(m=>m.id===player.id)?.name||player.player_code}（${player.player_code}）`,support)));}else support.append(node('p','活動人員尚未設定 IG 聯絡帳號。','field-help'));}
 else support.append(node('p','聯絡資訊暫時無法載入。','field-help'),button('重試',loadContacts));
}
async function copy(text,container){let status=container.querySelector('.copy-status');if(!status){status=node('p','','copy-status');status.setAttribute('role','status');container.append(status);}try{await navigator.clipboard.writeText(text);status.textContent='已複製，可以貼到 IG 私訊。';}catch{status.textContent='無法自動複製，請長按選取上方資訊。';const field=node('textarea');field.readOnly=true;field.value=text;field.setAttribute('aria-label','可手動複製的資訊');status.append(field);field.select();}}
export function startJourneyLibrary(client,currentPlayer){stopJourneyLibrary();api=client;player=currentPlayer;}
export function stopJourneyLibrary(){version++;tabRequest++;closeJourneyViewer();player=null;team=null;records=[];}
window.addEventListener('team-state',event=>{if(player)team=event.detail;});
window.addEventListener('journey-tab',event=>{if(!player)return;if(event.detail==='records')loadRecords();if(event.detail==='contacts')loadContacts();});
window.addEventListener('journey-stopped',stopJourneyLibrary);
// The practice button is part of the static page, so its handler stays stable across logins.
document.getElementById('practice-pinball').onclick=practice;
