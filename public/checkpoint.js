import {checkpointFromLocation,checkpointUrl,homeUrl,APP_BASE_PATH} from './routing.js';
import {isSoloTeam} from './play-mode.js';
import {mountPhotoRecovery,updateRecoveryClocks,pinballWaitText} from './team-recovery.js';
import {STORY_INTRO,STORY_END,storyReply,PINBALL_REPLIES} from './story-data.js';
import {createResumeSync} from './resume-sync.js';
import {beginNetworkWait,showResumeError,clearResumeError} from './network-wait.js';
import {renderStoryVote,updateVoteCountdown,hasPendingChoiceResult} from './story-vote.js';
import {mountPhotoPreview} from './photo-preview.js';
import {mountDetourCall} from './detour-call.js';
import {showFarewellPost} from './sightings.js';
import { checkpointFromQr, checkpointFromCode, remainingSeconds } from './checkpoint-utils.js';
import { storyNode as node, storyButton as button, storyNext as next, renderStoryScene } from './story-ui.js';
import { mountPinball } from './pinball.js';
import { mountTimeline } from './timeline.js';
import { FINALE_PAGES, REFLECTIONS, paginateText } from './finale-data.js';
const $ = id => document.getElementById(id);
let resumeSync=null,mutationEpoch=0,mutationController=null;
let recoveryRefreshKey='';
let pendingAction=null,detourView=null,detourId=null,ballotRefreshId=null;
let api, player, team, state=null, timer=null, ticker=null, alive=0, requestId=0, inFlight=false, visible=false, dismissed=null, viewKey='', cursor=0, draft='', stream=null, scanTimer=null, cameraEpoch=0, clockAnchor=0, performanceAnchor=0, acknowledged=null, retryAction=null;
const staleAction=()=>Object.assign(new Error('已切換到隊伍的新地點。'),{code:'STALE_ACTION'});
const externalId=()=>checkpointFromLocation()?.toString();
const run=()=>state?.run;
const isLeader=()=>team?.leader_id===player?.id;
const sessionKey=suffix=>`memory:checkpoint:${player?.id}:${run()?.id}:${suffix}`;
function read(suffix,fallback=''){try{return localStorage.getItem(sessionKey(suffix))??fallback;}catch{return fallback;}}
function write(suffix,value){try{localStorage.setItem(sessionKey(suffix),String(value));}catch{}}
function setStatus(text,error=false){$('game-status').textContent=text;$('game-status').dataset.error=error;$('game-retry').hidden=!error;$('game-use-code').hidden=!error;}
function showOverlay(){const opened=visible;visible=true;$('checkpoint-overlay').hidden=false;document.querySelector('.app-shell').inert=true;document.body.classList.add('checkpoint-open');if(!opened){$('checkpoint-overlay').tabIndex=-1;$('checkpoint-overlay').focus({preventScroll:true});}}
function disposeDetour(){document.getElementById('story-vote-panel')?.remove();document.getElementById('story-choice-result')?.remove();document.getElementById('story-vote-notice')?.remove();detourView?.dispose();detourView=null;detourId=null;}
function hideOverlay(){disposeDetour();document.getElementById('story-vote-panel')?.remove();visible=false;$('checkpoint-overlay').hidden=true;document.querySelector('.app-shell').inert=false;document.body.classList.remove('checkpoint-open');viewKey='';}
function closeOverlay(){dismissed=run()?.id;stopCamera();hideOverlay();render();$('mission-action')?.focus();}
function closeTerminal(){const current=run();closeOverlay();if(current?.phase==='finished'&&[11,13,9,12,7].includes(current.checkpoint))window.dispatchEvent(new CustomEvent('memory-terminal',{detail:{checkpoint:current.checkpoint,runId:current.id}}));}

function scene(text,actions=[]){renderStoryScene($("game-body"),{text,actions});}
function now(){return clockAnchor ? clockAnchor+(performance.now()-performanceAnchor) : Date.now();}
function apply(result,requestStarted){
 if(!player)return;
 if(result.server_time){clockAnchor=Date.parse(result.server_time)+Math.min(2000,Math.max(0,performance.now()-requestStarted))/2;performanceAnchor=performance.now();}
 const previous=state,old=run()?.id;const changed=!!old&&old!==result.run?.id;
 let forceOpen=false;
 if(result.activation){const key='memory:active-task:'+player.id;let seen;try{seen=localStorage.getItem(key);localStorage.setItem(key,result.activation.id);}catch{}forceOpen=changed||seen!==result.activation.id;}
 if(changed){++requestId;disposeDetour();stopCamera();if(inFlight){mutationEpoch++;inFlight=false;pendingAction=null;mutationController?.abort();mutationController=null;queueMicrotask(()=>resumeSync?.kick());}}
 state=result;
 const ballotOpens=run()?.ballot?.phase==='open'&&(previous?.run?.ballot?.id!==run().ballot.id||previous?.run?.ballot?.phase!=='open');
 if(ballotOpens){window.dispatchEvent(new Event('team-choice-opened'));dismissed=null;write('dismissed',false);}
 if(forceOpen){window.dispatchEvent(new Event('team-checkpoint-activated'));dismissed=null;write('dismissed',false);history.replaceState({},'',checkpointUrl(run().checkpoint));}
 if(JSON.stringify(previous?.progress)!==JSON.stringify(result.progress))window.dispatchEvent(new CustomEvent('checkpoint-progress',{detail:result.progress}));
 if(old!==run()?.id||previous?.run?.phase!==run()?.phase)window.dispatchEvent(new CustomEvent('checkpoint-state',{detail:result.run}));
 if(old!==run()?.id){viewKey='';acknowledged=null;cursor=Number(read('cursor','0'));draft=read('draft');dismissed=read('dismissed')==='true'?run()?.id:null;}
 $('resume-checkpoint').hidden=!run();
 if(run()&&(forceOpen||ballotOpens||run().phase!=='finished'||run().checkpoint===10&&!run().my_read)&&dismissed!==run().id)showOverlay();
 render();
 if(!inFlight && run()?.participant && !run().ready && run().question && acknowledged!==run().id&&!hasPendingChoiceResult(run())){
  acknowledged=run().id;
  const expected=alive;
  transact('ready',{run_id:run().id},'正在準備題目…').catch(()=>{if(expected===alive)acknowledged=null;});
 }
}
async function transact(action,body,label){
 if(inFlight)return;
 const expected=alive,started=performance.now(),mutation=++mutationEpoch;mutationController=new AbortController();++requestId;inFlight=true;pendingAction=action;setStatus(label);retryAction=()=>transact(action,body,label);
 if(action==='letter'){viewKey='';render();}
 document.querySelectorAll('#game-body button,#game-body input').forEach(el=>el.disabled=true);
 try{body=action==='choose'||action==='guess'&&run()?.checkpoint===10?{...body,vote_round:run()?.vote_round??1}:body;const payload=action!=='enter'&&[2,3,4,5,6,7,8,9,10,11,12,13].includes(run()?.checkpoint)?{...body,checkpoint:run().checkpoint}:body;const result=await api(`/api/game/${action}`,{method:'POST',body:payload,waitLabel:label,signal:mutationController.signal,timeoutMs:['ask','letter'].includes(action)?35000:15000});if(expected!==alive||mutation!==mutationEpoch)throw staleAction();if(result.wrong){if(result.run){viewKey='';apply(result,started);}setStatus(run()?.checkpoint===10?'還差一點，再看看剪影，猜猜本龍是誰！':run()?.checkpoint===7?'順序還不太對！看看事件之間的關係，哪些應該先發生，哪些又是在那之後？':run()?.checkpoint===12?'嗯……好像還不太對。沒關係，我們再換個方向想想。':run()?.checkpoint===9?'蛤？真的假的？你是不是隨便猜的！再給你一次機會，認真觀察一下啦！':run()?.checkpoint===13?'嗯……你確定嗎？這張照片很久以前拍的，再仔細看看吧！':'嗯……不是這棟。把目前得到的線索放在一起想想，別光靠熟悉的名字亂猜！');retryAction=null;return result;}if(action==='note'&&result.run?.checkpoint===10&&result.run.my_note!==null){write('note-stage','saved');write('note-receipt',0);write('note-error','');write('note-draft',result.run.my_note);}if(action==='letter'&&result.run?.my_letter){write('note-stage','letter');write('letter-page',0);}viewKey='';apply(result,started);if(['complete','finish','read','note','answer'].includes(action))window.dispatchEvent(new Event('achievement-check'));setStatus('');retryAction=null;return result;}
 catch(error){if(expected!==alive||mutation!==mutationEpoch)throw staleAction();setStatus(error.message,error.code!=='MISS');if(action==='letter')$('game-use-code').hidden=true;if(error.code==='MISS')retryAction=null;if(['TIME_EXPIRED','STALE_VOTE'].includes(error.code))retryAction=refresh;throw error;}
 finally{if(expected===alive&&mutation===mutationEpoch){mutationController=null;inFlight=false;pendingAction=null;resumeSync?.kick();if(run()?.vote_slot||run()?.ballot){clearTimeout(timer);timer=setTimeout(poll,1000);}viewKey='';if(visible&&action!=='enter')render();if(action==='enter'&&run()?.question&&!run().ready)queueMicrotask(()=>refresh());}}
}
async function refresh(force=false,{foreground=false}={}){
 if(!player||!team||team.phase!=='elected'||document.hidden)return false;
 if(inFlight&&foreground)return false;
 if(resumeSync?.active()&&!foreground&&!inFlight)return false;

 const expected=alive,request=++requestId,started=performance.now();
 try{const active=run()?.checkpoint??Number(externalId());const result=await api(`/api/game?checkpoint=${active||0}&follow=1`,{wait:!state,waitLabel:'正在找回隊伍進度…'});if(expected!==alive||request!==requestId)return false;if(inFlight&&run()?.id===result.run?.id)return false;apply(result,started);if(!retryAction)setStatus('');return true;}
 catch(error){if(expected!==alive)return false;if(foreground)throw error;if(visible){setStatus(error.message,true);retryAction=()=>refresh(true);}}
}
function interval(){if(run()?.vote_slot||run()?.ballot)return 1000;const phase=run()?.phase;return 2000;}
async function poll(){const expected=alive;await refresh();if(expected===alive&&player)timer=setTimeout(poll,interval());}
function countdown(){
 const r=run();if(!r)return;updateVoteCountdown(r.ballot,now());
 updateRecoveryClocks($('game-body'),r,now());
 const recoveryDeadline=r.checkpoint===3&&r.phase==='play'?r.skip_at:r.checkpoint===11&&r.phase==='search'&&!r.recovery?.available?r.recovery?.available_at:null;
 const recoveryKey=r.id+':'+recoveryDeadline;
 if(visible&&!document.hidden&&!inFlight&&recoveryDeadline&&now()>=Date.parse(recoveryDeadline)&&recoveryRefreshKey!==recoveryKey){recoveryRefreshKey=recoveryKey;refresh(true).catch(()=>{});}
 if(visible&&!document.hidden&&!inFlight&&r.ballot?.phase==='open'&&now()>=Date.parse(r.ballot.deadline)&&ballotRefreshId!==r.ballot.id){ballotRefreshId=r.ballot.id;refresh(true);}
 if(introUnread(r))return;
 const clock=$('quiz-clock');if(clock&&r.deadline){const seconds=remainingSeconds(r.deadline,now());clock.textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;clock.dataset.urgent=seconds<=10;}
 const phase=r.phase==='running'?(now()<Date.parse(r.starts_at)?'countdown':now()<Date.parse(r.deadline)?'quiz':'settling'):r.phase;
 if(visible&&phase!==$('game-body').dataset.phase&&!inFlight){viewKey='';render();}
 const lead=$('start-countdown');if(lead&&r.starts_at){const value=String(remainingSeconds(r.starts_at,now()));if(lead.textContent!==value){lead.textContent=value;if(r.checkpoint===4&&!matchMedia('(prefers-reduced-motion: reduce)').matches){lead.getAnimations().forEach(animation=>animation.cancel());lead.animate([{transform:'scale(1.65)',opacity:.3},{transform:'scale(1)',opacity:1,offset:.35},{transform:'scale(.68)',opacity:.15}],{duration:950,easing:'ease-out'});}}}
}
function introUnread(r){return [1,2,3,5,7,9,11,12,13].includes(r?.checkpoint)&&r.choice&&r.phase!=='story'&&r.phase!=='finished'&&read('intro-options-seen','0')!=='1';}
function render(){
 renderContent();
 const controls=$('game-body').querySelector('.story-controls'),atOptions=controls?.querySelectorAll('button:not(.story-next)').length>1;
 if(atOptions&&visible){
  if(introUnread(run())){controls.replaceChildren(next(()=>{write('intro-options-seen','1');viewKey='';render();}));}
  else if(run()?.phase==='story')write('intro-options-seen','1');
 }
 renderStoryVote({run:run(),visible:visible&&$('scanner-view').hidden,inFlight,leader:isLeader(),solo:isSoloTeam(team),serverNow:now(),submit:(action,choice)=>transact(action,{run_id:run().id,choice},isSoloTeam(team)?'正在確認你的選擇…':'正在確認大家的選擇…').catch(()=>{})});
}
function renderContent(){
 if(!visible||!$('scanner-view').hidden )return;
 const source=run(),r=introUnread(source)?{...source,phase:'story'}:source;if(!r){$('game-body').replaceChildren(node('p','正在確認地點…','loading-copy'));return;}
 const phase=r.phase==='running'?(now()<Date.parse(r.starts_at)?'countdown':now()<Date.parse(r.deadline)?'quiz':'settling'):r.phase;
 const answering=phase==='quiz'&&!r.submitted&&r.participant;
 const key=[r.id,phase,cursor,r.choice,answering?'':r.ready_count,answering?'':r.submitted_count,r.submitted,r.my_photo,r.found_count,r.messages?.length,r.guesses?.length,r.ending_choice,r.reflection,r.my_read,r.note_saved_at,r.letter_saved_at,r.done,r.skipped,r.participant,isLeader(),r.checkpoint===11?JSON.stringify(r.recovery):''].join(':');
 $('checkpoint-overlay').dataset.checkpoint=String(r.checkpoint);
 if([6,8].includes(r.checkpoint)){renderDetour(r);return;}
 if(detourView){detourView.dispose();detourView=null;detourId=null;viewKey='';}
 if(r.checkpoint===3){render3(r,key);return;}
 if(r.checkpoint===4){render4(r,key,phase);return;}
 if(r.checkpoint===5){render5(r,key);return;}
 if(r.checkpoint===7){render7(r,key);return;}
 if(r.checkpoint===10){render10(r,key);return;}
 if(r.checkpoint===12){render12(r,key);return;}
 if(r.checkpoint===9){render9(r,key);return;}
 if(r.checkpoint===11){render11(r,key);return;}
 if(r.checkpoint===2){render2(r,key);return;}
 if(r.checkpoint===13){render13(r,key);return;}
 $('game-path').replaceChildren(node('span','地點'),node('span','1','checkpoint-number'));
 if(r.phase==='finished')$('game-path').append(node('span','→','checkpoint-arrow'),node('span',String(r.next_id),'checkpoint-number'));
 if(key===viewKey){countdownClockOnly();return;}viewKey=key;
 const body=$('game-body');body.classList.remove('find-body','chat-body','is-quiz','puzzle-body');body.dataset.phase=phase;body.replaceChildren();
 if(phase==='story'){
  if(cursor===0)scene(STORY_INTRO[1][0],[next(()=>{cursor=1;write('cursor',1);render();})]);
  else{
   const options=[button('政大小天才就是我們！',()=>choose('genius')),button('如果答不出來，你會提示嗎？',()=>choose('hint'))];

   scene('你們準備怎麼挑戰？',options);
   body.append(node('p',isLeader()?'選擇後決定全隊作答時間，每人各答一題。':'等待隊長選擇；你會拿到自己的題目。','stage-note'));
  }
 }else if(phase==='loading'||phase==='countdown'){
  scene(storyReply(1,r.choice));
  const label=node('div',undefined,'start-message');label.append(node('strong','開始作答'));
  if(phase==='countdown')label.append(node('span',String(remainingSeconds(r.starts_at,now())),'start-number'));
  else label.append(node('p',`題目已準備 ${r.ready_count}／${r.total} 人，不扣作答時間。`),node('p',r.waiting_names?.length?`等待：${r.waiting_names.slice(0,2).join('、')}${r.waiting_names.length>2?`，另 ${r.waiting_names.length-2} 人`:''}`:'正在確認隊員已準備好…'));
  label.querySelector('.start-number')?.setAttribute('id','start-countdown');body.append(label);
 }else if(phase==='quiz'&&!r.submitted&&r.participant){
  body.classList.add('is-quiz');const header=node('div',undefined,'quiz-heading');const clock=node('strong','','quiz-clock');clock.id='quiz-clock';header.append(node('span','你的題目 · 每人提交一次'),clock);body.append(header);
  body.append(node('h1',r.question.prompt,'quiz-prompt'));
  const form=node('form',undefined,'quiz-form');form.id='quiz-form';const field=node('fieldset');field.append(node('legend','選擇答案'));
  for(const [letter,text] of Object.entries(r.question.options)){const label=node('label',undefined,'quiz-option'),input=node('input');input.type='radio';input.name='quiz-answer';input.value=letter;input.required=true;input.checked=draft===letter;input.onchange=()=>{draft=letter;write('draft',letter);};label.append(input,node('span',letter,'option-letter'),node('span',text));field.append(label);}
  const submit=node('button','確認提交','primary-button');submit.type='submit';form.append(field,submit);form.onsubmit=event=>{event.preventDefault();if(now()>=Date.parse(r.deadline)){render();return;}if(draft)transact('answer',{run_id:r.id,answer:draft},'答案送出中…').catch(()=>{});};body.append(form,node('p','送出後不能修改；全隊結算前不公布對錯。','stage-note'));countdownClockOnly();
 }else if(phase==='quiz'||phase==='settling'){
  body.classList.remove('is-quiz');const text=!r.participant?'你不在本輪作答名單中，等待隊員完成挑戰。':r.submitted?'答案已提交，等隊友一起完成！':'時間到，正在整理結果…';
  scene(text);body.append(node('p',`已提交 ${r.submitted_count}／${r.total} 人`,'stage-note'));if(phase==='settling')body.append(node('p','保留傳輸緩衝，請稍候。','stage-note'));
 }else if(phase==='settled'||phase==='finished'){
  body.classList.remove('is-quiz');const result=r.result;
  const pages=[`全隊 ${result.total} 人，${result.wrong_count} 人答錯或未提交。`,...(r.participant?[`你的答案：${result.my_answer??'未提交'}。正確答案：${result.correct_answer}。`,...splitText(result.explanation)]:[]),...(result.passed?['不是，沒人跟我說走在政大真的會遇到政大小天才','接下來去四維堂門口吧！那裡還有需要你們幫忙的事。']:['你們超過兩個人答錯！！你一點都不懂我們政大😭😭😭','快去校碑，那裡有某人留給你們的訊息'])];
  if(result.submitted===0)pages.splice(pages.length-2,1,'時間到，大家都沒有提交答案，這次挑戰失敗了。');
  let page=Number(read('result-page','0'));page=Math.min(page,pages.length-1);
  const controls=page<pages.length-1?[next(()=>{write('result-page',page+1);viewKey='';render();})]:[next(()=>{if(phase==='finished'){closeOverlay();return;}transact('finish',{run_id:r.id},'正在更新隊伍進度…').then(()=>closeOverlay()).catch(()=>{});})];
  if(page===pages.length-1)controls[0].setAttribute('aria-label',phase==='finished'?'返回首頁':isLeader()?'完成劇情，返回首頁':'等待隊長完成劇情');
  if(page===pages.length-1&&phase!=='finished'&&!isLeader())controls[0].disabled=true;
  scene(pages[page],controls);
  if(page===pages.length-1&&phase!=='finished'&&!isLeader())body.append(node('p','等待隊長完成劇情，即可更新隊伍路線。','stage-note'));
 }
 if(inFlight)document.querySelectorAll('#game-body button,#game-body input').forEach(el=>el.disabled=true);
}
function splitText(text){const parts=String(text??'').match(/[^。！？]+[。！？]?/g)??[];const pages=[];for(const part of parts){if(pages.length&&pages.at(-1).length+part.length<=64)pages[pages.length-1]+=part;else pages.push(part);}return pages.flatMap(page=>page.length>80?[page.slice(0,64),page.slice(64)]:[page]);}
function countdownClockOnly(){const clock=$('quiz-clock');if(clock&&run()?.deadline){const seconds=remainingSeconds(run().deadline,now());clock.textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;clock.dataset.urgent=seconds<=10;}}
function choose(choice){transact('choose',{run_id:run().id,choice},'正在確認挑戰時間…').catch(()=>{});}
async function enter(id,code=null){
 if(inFlight)return;disposeDetour();stopCamera();showOverlay();$('game-body').replaceChildren(node('p','正在確認地點…','loading-copy'));setStatus('正在確認地點…');
 try{const result=await transact('enter',{...(id?{checkpoint:id}:{}),...(code?{code}:{})},'正在確認地點…');if(result?.run){history.replaceState({},'',checkpointUrl(result.run.checkpoint));dismissed=null;write('dismissed',false);viewKey='';render();}}
 catch(error){if(error.code==='STALE_ACTION')return;closeOverlay();setStatus('');window.dispatchEvent(new Event('open-scan-tab'));$('checkpoint-code-details').open=true;$('checkpoint-code-error').textContent=error.message||'無法開啟地點，請確認代碼後再試一次。';$('checkpoint-code-error').hidden=false;$('checkpoint-code').focus();}
}
function stopCamera(){cameraEpoch++;clearTimeout(scanTimer);stream?.getTracks().forEach(track=>track.stop());stream=null;const video=$('scanner-video');if(video){video.pause();video.srcObject=null;}$('scanner-view').hidden=true;}
async function startCamera(){
 if(!player||team?.phase!=='elected')return;
 disposeDetour();
 if(!isLeader()){showOverlay();$('game-body').replaceChildren(node('p','請由隊長掃碼開啟地點。','loading-copy'));setStatus('隊長開啟後，你的手機會收到任務。');return;}
 stopCamera();showOverlay();$('game-path').textContent='掃描地點';$('game-body').replaceChildren();$('scanner-view').hidden=false;setStatus('正在啟動相機…');const epoch=cameraEpoch;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('此瀏覽器無法啟動相機。請使用 HTTPS 網址與支援相機的瀏覽器，或用手機相機掃碼。');
  const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
  if(epoch!==cameraEpoch||document.hidden){media.getTracks().forEach(track=>track.stop());return;}
  stream=media;const video=$('scanner-video');video.srcObject=stream;await video.play();setStatus('將地點 QR Code 對準框內。');
  if(!window.jsQR)throw new Error('掃碼程式尚未載入，請重試。');
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
  const scan=()=>{if(epoch!==cameraEpoch||!stream||document.hidden)return;
   if(video.readyState>=2){const width=Math.min(640,video.videoWidth),height=Math.round(width*video.videoHeight/video.videoWidth);canvas.width=width;canvas.height=height;context.drawImage(video,0,0,width,height);const pixels=context.getImageData(0,0,width,height);const code=window.jsQR(pixels.data,width,height,{inversionAttempts:'dontInvert'});if(code){const invitation=checkpointFromQr(code.data,location.origin,APP_BASE_PATH);if(invitation&&!inFlight){enter(invitation.checkpoint,invitation.code);return;}if(!invitation)setStatus('這不是本活動的地點 QR Code，請掃描現場標示。');}}
   scanTimer=setTimeout(scan,180);
  };scan();
 }catch(error){stopCamera();$('game-body').replaceChildren(node('p','相機尚未開啟','loading-copy'));const message=error.name==='NotAllowedError'?'相機權限未開啟。請允許此網站使用相機後重試，也可用手機相機掃碼。':error.name==='NotFoundError'?'找不到可使用的相機，請改用手機。':error.message;setStatus(message,true);retryAction=startCamera;}
}
export function startCheckpoint(client,currentPlayer){
 stopCheckpoint();api=client;player=currentPlayer;state=null;team=null;acknowledged=null;dismissed=null;
 resumeSync=createResumeSync({read:()=>refresh(true,{foreground:true}),ready:()=>!!player&&team?.phase==='elected'&&!document.hidden,busy:()=>inFlight,waiting:()=>{const body=$('game-body'),previous=body.inert;body.inert=true;const finish=beginNetworkWait('正在接回隊伍進度…',{blocking:true});return()=>{body.inert=previous;finish();};},failed:error=>showResumeError(error,()=>resumeSync?.request())});
 ticker=setInterval(countdown,250);
}
export function stopCheckpoint(){mutationEpoch++;mutationController?.abort();mutationController=null;clearResumeError();resumeSync?.dispose();resumeSync=null;alive++;clearTimeout(timer);clearInterval(ticker);stopCamera();hideOverlay();player=null;team=null;state=null;inFlight=false;retryAction=null;clockAnchor=0;}
export function protectExternalScan(){
 const id=externalId();$('scan-identity-view').hidden=!id;
 if(id){$('login-view').hidden=true;$('scan-identity-message').textContent=`你正在開啟地點 ${id}，但此瀏覽器找不到原本的登入身分。請回到原本登入的瀏覽器掃碼，避免重複加入。`;}
 return !!id;
}
window.addEventListener('team-state',event=>{
 if(!player)return;const first=team?.phase!=='elected';team=event.detail;
 if(team?.phase==='elected'&&first){clearTimeout(timer);poll();const id=externalId();if(id){if(isLeader())enter(Number(id),new URLSearchParams(location.search).get('code'));else refresh(true);}}
});
window.addEventListener('journey-stopped',()=>stopCheckpoint());
window.addEventListener('journey-tab',event=>{
 if(event.detail!=='scan')stopCamera();
});

document.addEventListener('visibilitychange',()=>{if(document.hidden){++requestId;resumeSync?.pause();stopCamera();}else resumeSync?.request();});
window.addEventListener('online',()=>resumeSync?.request());
window.addEventListener('choice-result-confirmed',()=>{viewKey='';render();refresh(true);document.querySelector('#game-body button:not(:disabled)')?.focus({preventScroll:true});});
window.addEventListener('pageshow',event=>{if(event.persisted)resumeSync?.request();});
window.addEventListener('pagehide',()=>stopCamera());
window.addEventListener('popstate',()=>{if(player&&externalId())enter(Number(externalId()),new URLSearchParams(location.search).get('code'));else closeOverlay();});
window.addEventListener('resume-checkpoint',()=>{if(run()){dismissed=null;write('dismissed',false);showOverlay();render();refresh(true);}});
window.addEventListener('open-checkpoint',async event=>{
 if(!player||inFlight)return;const candidates=event.detail;disposeDetour();stopCamera();showOverlay();$('game-body').replaceChildren(node('p','正在確認支線進度…','loading-copy'));setStatus('正在確認支線進度…');
 const expected=alive,request=++requestId,started=performance.now();
 try{let result;for(const id of candidates){result=await api(`/api/game?checkpoint=${id}`,{wait:true,waitLabel:'正在確認支線進度…'});if(expected!==alive||request!==requestId)return;if(result.run)break;}if(result?.run){history.pushState({},'',checkpointUrl(result.run.checkpoint));dismissed=null;apply(result,started);render();setStatus('');}else{setStatus('');closeOverlay();window.dispatchEvent(new Event('open-scan-tab'));$('checkpoint-code-details').open=true;$('checkpoint-code').focus();}}
 catch(error){if(expected===alive){setStatus(error.message,true);retryAction=()=>window.dispatchEvent(new CustomEvent('open-checkpoint',{detail:candidates}));}}
});
$('game-close').onclick=()=>{write('dismissed',true);closeOverlay();};
$('game-retry').onclick=()=>{if(!inFlight)Promise.resolve(retryAction?.()).catch(()=>{});};
$('open-scanner').onclick=startCamera;
$('checkpoint-code-form').onsubmit=event=>{
 event.preventDefault();const code=checkpointFromCode($('checkpoint-code').value);
 $('checkpoint-code-error').hidden=!!code;
 if(!code){$('checkpoint-code-error').textContent='請輸入現場標示的 8 碼地點代碼。';return;}
 enter(null,code);
};
$('game-use-code').onclick=()=>{closeOverlay();window.dispatchEvent(new CustomEvent('open-code-entry'));$('checkpoint-code-details').open=true;$('checkpoint-code').focus();};
$('resume-checkpoint').onclick=()=>{dismissed=null;write('dismissed',false);showOverlay();render();refresh(true);};
$('scan-return-home').onclick=()=>{history.replaceState({},'',homeUrl());$('scan-identity-view').hidden=true;location.reload();};
$('checkpoint-overlay').addEventListener('keydown',event=>{if(event.key==='Escape'){closeOverlay();return;}if(event.key!=='Tab')return;const controls=[...$('checkpoint-overlay').querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(el=>el.getClientRects().length);if(!controls.length)return;const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
function renderDetour(r){
 const path=$('game-path');path.replaceChildren(node('span','地點'),node('span',r.checkpoint===8?'1':'4','checkpoint-number'),node('span','→','checkpoint-arrow'),node('span',String(r.checkpoint),'checkpoint-number'));
 if(r.phase==='finished')path.append(node('span','→','checkpoint-arrow'),node('span',String(r.next_id),'checkpoint-number'));
 const body=$('game-body');body.className='game-body';body.dataset.phase=r.phase;body.removeAttribute('aria-busy');
 if(detourView&&detourId===r.id&&body.contains(detourView.root)){detourView.update(r,isLeader());return;}
 detourView?.dispose();detourId=r.id;
 const prefix=`memory:checkpoint:${player.id}:${r.id}:`;
 const callRead=(key,fallback='')=>{try{return localStorage.getItem(prefix+key)??fallback;}catch{return fallback;}},callWrite=(key,value)=>{try{localStorage.setItem(prefix+key,String(value));}catch{}};
 detourView=mountDetourCall(body,{run:r,leader:isLeader(),read:callRead,write:callWrite,finish:()=>transact('finish',{run_id:r.id},'正在保存地點完成狀態…'),leave:()=>{write('dismissed',true);closeOverlay();window.dispatchEvent(new Event('sighting-home'));}});
}
function leaveFinale(){closeOverlay();showFarewellPost();}
function render10(r,key){
 $('game-path').replaceChildren(node('span','最後一站'),node('span','10','checkpoint-number'));
 if(r.my_read)$('game-path').append(node('span','✓','checkpoint-complete'));
 if(key===viewKey)return;viewKey=key;const body=$('game-body');body.className='game-body';body.dataset.phase=r.phase;body.dataset.finaleKind='';body.removeAttribute('aria-busy');body.replaceChildren();
 const say=(text,actions=[],speaker='奶龍')=>renderStoryScene(body,{text,actions,character:speaker});
 if(r.phase==='guess'){
  body.classList.add('finale-silhouette');const options=[['nailong','奶龍'],['pikachu','皮卡丘'],['duck','黃色小鴨'],['egg','一顆忘記孵化的蛋']].map(([choice,label])=>button(label,()=>transact('guess',{run_id:r.id,choice},'正在揭曉身分…').catch(()=>{})));say('噓——先別急著認本龍！看這個圓圓的影子，你們覺得是誰？',options,'神祕的身影');body.querySelector('.story-actor img').alt='等待揭曉的黃色角色剪影';
 }else if(!r.my_read||read('finale-replay','0')==='1'){
  const page=Math.min(Number(read('finale-page','0')),FINALE_PAGES.length);
  if(page<FINALE_PAGES.length){const current=FINALE_PAGES[page];body.dataset.finaleKind=current.kind??'';
   if(['photo','history'].includes(current.kind)){body.classList.add('finale-reading');const photo=node('img');photo.src='/assets/memories/photo.jpg';photo.alt='玩家拼回的中山館照片';photo.className='finale-photo';body.append(photo);}
   say(current.text,[next(()=>{write('finale-page',page+1);viewKey='';render();})],current.speaker);
   body.append(node('p',`${page+1}／${FINALE_PAGES.length}`,'stage-note'));
  }else if(!r.reflection){const options=Object.entries(REFLECTIONS).map(([choice,item])=>button(item.label,()=>transact('reflect',{run_id:r.id,choice},'正在聽奶龍回應…').catch(()=>{})));say('走到這裡，你有沒有什麼想說的？',options);body.append(node('p','這段感想由你自己選，奶龍會單獨回應你。','stage-note'));}
  else say(REFLECTIONS[r.reflection]?.reply??'謝謝你們一起找回這段記憶。',[next(()=>transact('read',{run_id:r.id},'正在記錄結局完成…').then(result=>{if(result){write('finale-replay','0');viewKey='';render();}}).catch(()=>{}))]);
 }else{
  const stage=read('note-stage','edit');
  if(inFlight&&pendingAction==='letter'){
   body.classList.add('finale-writing');body.setAttribute('aria-busy','true');say('嗯……本龍有認真讀喔！等本龍把想對你說的話，慢慢寫進信裡。');body.append(node('p','奶龍正在寫一封只給你的回信…','finale-writing-status'));
  }else if(stage==='saved'){
   say('收到了！本龍有把你的回憶收好喔。等一下，本龍也想寫幾句話給你……');
   body.append(button(r.my_letter?'打開奶龍的回信':'請奶龍寫一封回信',()=>{if(r.my_letter){write('note-stage','letter');write('letter-page',0);viewKey='';render();}else transact('letter',{run_id:r.id},'奶龍正在讀你的回憶、寫一封只給你的信…').catch(()=>{});},true),node('p','回信由 AI 根據你的留言生成，只有自己能查看。領取時會將這則留言傳送給 OpenAI。','stage-note'),button('先收好回憶，和奶龍道別',()=>leaveFinale()),button('修改我的留言',()=>{write('note-stage','edit');viewKey='';render();}));
  }else if(stage==='letter'&&r.my_letter){
   const pages=paginateText(r.my_letter,65),page=Math.min(Number(read('letter-page','0')),pages.length-1);
   body.classList.add('finale-letter');body.append(node('h1','奶龍留給你的一封信','find-heading'),node('p',player.name??player.player_code,'stage-note'));
   say(pages[page],[next(()=>{if(page<pages.length-1){write('letter-page',page+1);viewKey='';render();}else leaveFinale();})]);
   body.append(node('p',`AI 角色回信 · ${page+1}／${pages.length} · 已私人保存`,'stage-note'),button('保存文字紀念卡',()=>{
    const card=['記憶之境｜奶龍的私人回信',player.name??player.player_code,'',r.my_note,'','—— 奶龍的回信 ——',r.my_letter,'',new Date(r.letter_saved_at).toLocaleDateString('zh-TW'),'AI 角色回信'].join('\n');const url=URL.createObjectURL(new Blob([card],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='記憶之境-奶龍回信.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }),button('回到我的回憶',()=>{write('note-stage','edit');viewKey='';render();}));
  }else if(stage==='skip'){
   say('沒關係，有些回憶先放在心裡也很好。謝謝你們幫本龍找回這些記憶，我們下次見！',[next(()=>leaveFinale())]);body.append(button('我想留下回憶',()=>{write('note-stage','edit');viewKey='';render();}));
  }else{
   body.classList.add('finale-note');body.append(node('h1','留下一段政大回憶','find-heading'),node('p','在這裡留下你在政大的一段回憶，奶龍會在記憶之境保護好你的記憶的！','finale-invitation'),node('p','遊戲已完成。留言可跳過，每人一則，只有自己能查看或修改。','stage-note'));
   const form=node('form',undefined,'chat-form'),label=node('label','寫下一段你想留下的政大回憶。'),input=node('textarea');input.id='finale-note';label.htmlFor=input.id;input.rows=4;input.maxLength=600;input.value=read('note-draft',r.my_note??'');
   const count=node('span','','stage-note'),submit=button(r.my_note?'更新回憶':'儲存回憶',null,true);submit.type='submit';const update=()=>{const length=[...input.value.trim()].length;count.textContent=`${length}／300 字`;submit.disabled=inFlight||length===0||length>300;};input.oninput=()=>{write('note-draft',input.value);update();};update();
   const error=node('p',read('note-error'), 'error-message');error.setAttribute('role','alert');
   form.append(label,input,count,submit,error);form.onsubmit=e=>{e.preventDefault();write('note-error','');transact('note',{run_id:r.id,text:input.value},'正在把回憶收進記憶之境…').then(result=>{if(result){write('note-draft',result.run.my_note??input.value);write('note-stage','saved');write('note-receipt',0);viewKey='';render();}}).catch(error=>{if(error.code==='STALE_ACTION')return;write('note-error','等等，這段回憶還沒順利收進記憶之境。先別急著離開，確認送出成功再走喔！');viewKey='';render();});};
   const skip=button(r.my_note?'保留已儲存的回憶，離開':'跳過留言',()=>{write('note-stage','skip');viewKey='';render();});body.append(form,skip,button('重看結局故事',()=>{write('finale-replay','1');write('finale-page',0);viewKey='';render();}));if(r.my_note){body.append(node('p','目前已有一則儲存成功的回憶；修改後可為新版留言重新領取回信。','stage-note'),button(r.my_letter?'重看奶龍的回信':'領取奶龍的回信',()=>{write('note-stage',r.my_letter?'letter':'saved');write('letter-page',0);viewKey='';render();}));}
  }
 }
 if(inFlight)body.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
}
function render7(r,key){
 const path=$('game-path');path.replaceChildren(node('span','地點'),node('span','5','checkpoint-number'),node('span','→','checkpoint-arrow'),node('span','7','checkpoint-number'));if(r.phase==='finished')path.append(node('span','✓','checkpoint-complete'));
 if(key===viewKey)return;viewKey=key;const body=$('game-body');body.className='game-body';body.dataset.phase=r.phase;body.replaceChildren();
 if(r.phase==='story'){
  if(cursor===0)scene(STORY_INTRO[7][0],[next(()=>{cursor=1;write('cursor',1);viewKey='';render();})]);
  else{const options=[button('別慌，我們先找最早的，其他張你抱好！',()=>transact('choose',{run_id:r.id,choice:'help'},'正在找回時間線…').catch(()=>{})),button('這些事件全混在一起了，先找最近的吧？',()=>transact('choose',{run_id:r.id,choice:'tease'},'正在找回時間線…').catch(()=>{}))];scene('這六段記憶，應該怎麼排列呢？',options);}
 }else if(r.phase==='answer'){
  if(read('timeline-reply','0')!=='1'){scene(storyReply(7,r.choice),[next(()=>{write('timeline-reply','1');viewKey='';render();})]);return;}
  if(isLeader()){
   body.classList.add('timeline-body');body.append(node('h1','找回事件的先後順序','find-heading'),node('p','奶龍已固定一張事件，幫牠由早到晚排好剩下的五張；放對位置會顯示年份。','timeline-instructions'));
   mountTimeline(body,{anchorId:r.anchor_id??(r.choice==='help'?1:4),load:()=>{try{return JSON.parse(read('timeline-order','null'));}catch{return null;}},save:order=>write('timeline-order',JSON.stringify(order)),submit:async order=>{const result=await transact('answer',{run_id:r.id,order},'正在確認時間線…');if(!result||result.wrong)throw new Error('排序尚未正確');}});
  }else{scene('一起想想事件的先後順序，請協助隊長排列時間線。');body.append(node('p','隊長排好後，全隊會收到結果。','stage-note'));}
 }else if(r.phase==='success'){
  const control=next(()=>transact('finish',{run_id:r.id},'正在保存找回的記憶…').catch(()=>{}));if(!isLeader())control.disabled=true;scene('太好了，雖然只是暫時停止，但至少為我們爭取了一些時間，幹得好！',[control]);
 }else if(r.phase==='finished'){
  const count=[11,13,9,12,7].filter(id=>state?.progress?.completed_checkpoints?.includes(String(id))).length;
  scene('這段記憶找回來了，收下照片與文字碎片吧！',[next(()=>closeTerminal())]);body.append(node('p',`已找回 ${count}／5 個記憶碎片`,'stage-note'));
 }
 if(inFlight)body.querySelectorAll('button,input').forEach(el=>el.disabled=true);
}
function render5(r,key){
 const path=$('game-path');path.replaceChildren(node('span','地點'),node('span','5','checkpoint-number'));if(r.phase==='finished')path.append(node('span','→','checkpoint-arrow'),node('span','7','checkpoint-number'));
 if(key===viewKey)return;viewKey=key;const body=$('game-body');body.className='game-body';body.dataset.phase=r.phase;body.replaceChildren();
 const intro=STORY_INTRO[5];
 if(r.phase==='story'){
  if(cursor<intro.length)scene(intro[cursor],[next(()=>{cursor++;write('cursor',cursor);viewKey='';render();})]);
  else{const options=[button('猜密碼也能認識校史？',()=>transact('choose',{run_id:r.id,choice:'help'},'正在準備密碼…').catch(()=>{})),button('你是不是又想考倒我們？',()=>transact('choose',{run_id:r.id,choice:'tease'},'正在準備密碼…').catch(()=>{}))];scene('準備好一起找出這組數字了嗎？',options);}
 }else if(r.phase==='answer'){
  if(read('code-reply','0')!=='1'){scene(storyReply(5,r.choice),[next(()=>{write('code-reply','1');viewKey='';render();})]);return;}
  body.classList.add('cipher-body');body.append(node('h1','找出四位數密碼','find-heading'),node('p','數字可以重複。數字和位置都對是 A；數字對但位置不同是 B。猜中 4A0B 就能解開。','cipher-instructions'));
  const guesses=r.guesses??[],last=guesses.at(-1),record=node('div',undefined,'code-history');record.setAttribute('aria-label','全隊猜測紀錄');record.setAttribute('role','log');
  if(!last)record.append(node('p','還沒有猜測紀錄，和夥伴一起想想看。','stage-note'));
  guesses.forEach((g,i)=>{const row=node('div',undefined,'code-history-row');row.append(node('span',String(i+1)),node('strong',g.guess),node('span',`${g.a}A${g.b}B`));record.append(row);});body.append(record);
  if(last)body.append(node('p','還沒猜中！先看清楚這次的 A、B 結果，再想想哪些數字和位置要調整。','stage-note'));
  if(isLeader()){const form=node('form',undefined,'chat-form'),label=node('label','四位數密碼'),input=node('input');input.id='code-guess';label.htmlFor=input.id;input.type='text';input.inputMode='numeric';input.pattern='[0-9]{4}';input.minLength=4;input.maxLength=4;input.required=true;input.autocomplete='off';input.value=read('code-draft');input.oninput=()=>write('code-draft',input.value);const submit=button('確認猜測',null,true);submit.type='submit';form.append(label,input,submit);form.onsubmit=e=>{e.preventDefault();const request_id=crypto.randomUUID();transact('answer',{run_id:r.id,answer:input.value,request_id},'正在比對密碼…').then(result=>{if(result){write('code-draft','');const field=body.querySelector('#code-guess');if(field)field.value='';}}).catch(()=>{});};body.append(form);}else body.append(node('p','和隊友一起推理，由隊長送出猜測。','stage-note'));
  requestAnimationFrame(()=>{if(record.isConnected)record.scrollTop=record.scrollHeight;});
 }else if(r.phase==='success'){
  const page=Number(read('code-success','0'));
  if(page<2){scene(STORY_END[5][page],[next(()=>{write('code-success',page+1);viewKey='';render();})]);}
  else if(!r.ending_choice){const options=[button('1998 年，究竟發生了什麼？',()=>transact('choose',{run_id:r.id,choice:'history'},'正在聽奶龍回應…').catch(()=>{})),button('先記下來，我們繼續找碎片。',()=>transact('choose',{run_id:r.id,choice:'continue'},'正在聽奶龍回應…').catch(()=>{}))];scene('你們想起了什麼嗎？',options);}
  else if(page===2){scene(r.ending_choice==='history'?'1998……這個年份好熟悉，可是本龍現在還想不起完整的事情。先把其他碎片找回來吧。':'嗯，先記好這組數字。也許等記憶恢復，就知道它為什麼留在這裡了。',[next(()=>{write('code-success',3);viewKey='';render();})]);}
  else{const control=next(()=>transact('finish',{run_id:r.id},'正在開放下一個地點…').then(()=>closeOverlay()).catch(()=>{}));if(!isLeader())control.disabled=true;scene('下一站去傳院吧！',[control]);}
 }else if(r.phase==='finished')scene('下一站去傳院吧！',[next(()=>closeOverlay())]);
 if(inFlight)body.querySelectorAll('button,input').forEach(el=>el.disabled=true);
}
function render12(r,key){
 const path=$('game-path');path.replaceChildren(node('span','地點'),node('span','4','checkpoint-number'));
 if(state?.progress?.choices?.branch_4_detour)path.append(node('span','→','checkpoint-arrow'),node('span','6','checkpoint-number'));
 path.append(node('span','→','checkpoint-arrow'),node('span','12','checkpoint-number'));if(r.phase==='finished')path.append(node('span','✓','checkpoint-complete'));
 if(key===viewKey)return;viewKey=key;const body=$('game-body');body.className='game-body';body.dataset.phase=r.phase;body.replaceChildren();
 const intro=STORY_INTRO[12];
 if(r.phase==='story'){
  if(cursor<intro.length)scene(intro[cursor],[next(()=>{cursor++;write('cursor',cursor);viewKey='';render();})]);
  else{const options=[button('你還記得什麼線索嗎？',()=>transact('choose',{run_id:r.id,choice:'tease'},'正在展開訊息…').catch(()=>{})),button('拿來吧，我們一起看看。',()=>transact('choose',{run_id:r.id,choice:'help'},'正在展開訊息…').catch(()=>{}))];scene('有你們幫忙，也許就能把它讀出來！',options);}
 }else if(r.phase==='answer'){
  if(read('cipher-reply','0')!=='1'){scene(storyReply(12,r.choice),[next(()=>{write('cipher-reply','1');viewKey='';render();})]);return;}
  body.classList.add('cipher-body');body.append(node('h1','幫奶龍讀出訊息','find-heading'),node('p','這些字母似乎都被往後挪了相同的格數，超過 Z 就從 A 接著數。試著解開這段訊息，找出英文單字。','cipher-instructions'),node('div','EODCH','cipher-code'));
  const hint=node('p','這個單字的第一個字母是 B。','cipher-hint');hint.hidden=read('cipher-hint','0')!=='1';const hintButton=button('需要一點提示',()=>{write('cipher-hint','1');hint.hidden=false;hintButton.hidden=true;});hintButton.hidden=!hint.hidden;body.append(hintButton,hint);
  if(isLeader()){const form=node('form',undefined,'chat-form'),label=node('label','解開後的英文單字'),input=node('input');input.id='cipher-answer';label.htmlFor=input.id;input.type='text';input.maxLength=30;input.required=true;input.pattern='[A-Za-z ]+';input.autocomplete='off';input.autocapitalize='none';input.spellcheck=false;input.value=read('cipher-draft');input.oninput=()=>write('cipher-draft',input.value);const submit=button('告訴奶龍',null,true);submit.type='submit';form.append(label,input,submit);form.onsubmit=e=>{e.preventDefault();transact('answer',{run_id:r.id,answer:input.value},'正在確認訊息…').catch(()=>{});};body.append(form);}else body.append(node('p','和隊友一起想想，再由隊長輸入答案。','stage-note'));
 }else if(r.phase==='success'){
  const pages=STORY_END[12];const page=Math.min(Number(read('cipher-success','0')),pages.length-1),last=page===pages.length-1;const control=next(()=>{if(!last){write('cipher-success',page+1);viewKey='';render();}else transact('finish',{run_id:r.id},'正在保存找回的記憶…').catch(()=>{});});if(last&&!isLeader())control.disabled=true;scene(pages[page],[control]);
 }else if(r.phase==='finished'){
  const count=[11,13,9,12,7].filter(id=>state?.progress?.completed_checkpoints?.includes(String(id))).length;
  scene('這段記憶找回來了，收下照片與文字碎片吧！',[next(()=>closeTerminal())]);body.append(node('p',`已找回 ${count}／5 個記憶碎片`,'stage-note'));
 }
 if(inFlight)body.querySelectorAll('button,input').forEach(el=>el.disabled=true);
}
function render4(r,key,phase){
 const path=$('game-path');path.replaceChildren(node('span','地點'),node('span','4','checkpoint-number'));
 if(['settled','finished'].includes(r.phase))path.append(node('span','→','checkpoint-arrow'),node('span',String(r.next_id),'checkpoint-number'));
 if(key===viewKey){countdownClockOnly();return;}viewKey=key;const body=$('game-body');body.className='game-body';body.dataset.phase=phase;body.replaceChildren();
 if(phase==='countdown'||phase==='loading'){
  const title=node('h1',r.question,'quiz-prompt'),number=node('strong',r.starts_at?String(remainingSeconds(r.starts_at,now())):'10','stone-countdown-number');number.id='start-countdown';body.append(title,node('p',r.instructions,'stage-note'),number,node('p',phase==='loading'?'正在準備倒數…':'準備作答！倒數結束後開始 3 分鐘計時。','stage-note'));
  if(phase==='loading'&&isLeader())requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!visible||inFlight||run()?.id!==r.id||run()?.phase!=='loading'||acknowledged===r.id)return;acknowledged=r.id;transact('ready',{run_id:r.id},'正在啟動準備倒數…').catch(()=>{});}));
  if(phase==='countdown'&&!matchMedia('(prefers-reduced-motion: reduce)').matches)number.animate([{transform:'scale(1.65)',opacity:.3},{transform:'scale(1)',opacity:1}],{duration:500,easing:'ease-out'});
 }else if(phase==='quiz'){
  body.classList.add('is-quiz');const head=node('div',undefined,'quiz-heading'),clock=node('strong','','quiz-clock');clock.id='quiz-clock';head.append(node('span','限時石碑挑戰'),clock);body.append(head,node('h1',r.question,'quiz-prompt'),node('p',r.instructions,'stage-note'));
  if(isLeader()){
   const form=node('form',undefined,'chat-form'),label=node('label','石碑上的完整文字'),input=node('textarea');input.id='stone-answer';label.htmlFor=input.id;input.maxLength=100;input.rows=3;input.required=true;input.value=read('stone-draft');input.oninput=()=>write('stone-draft',input.value);const submit=button('確認提交',null,true);submit.type='submit';form.append(label,input,submit);form.onsubmit=e=>{e.preventDefault();if(now()>=Date.parse(r.deadline)){viewKey='';render();return;}transact('answer',{run_id:r.id,answer:input.value},'正在提交石碑文字…').catch(()=>{});};body.append(form,node('p','只有一次作答機會；答錯會前往另一個地點。','stage-note'));
  }else body.append(node('p','請一起觀察石碑，由隊長輸入答案。','stage-note'));
  countdownClockOnly();
 }else if(phase==='settling'){
  scene('時間到，正在確認提交結果…');body.append(node('p','保留 5 秒傳輸緩衝，請稍候。','stage-note'));
 }else if(r.phase==='settled'||r.phase==='finished'){
  const pages=r.passed?['看來你們有點東西，這是關於記憶碎片位置的線索，能不能找到就憑你們的本事了','下一站，教育學院！看看你們能不能把接下來的線索解開。']:[...(r.reason==='timeout'?['時間到，這次沒有完成作答。']:[]),'就這樣也想找記憶碎片？快去綜院，那裡有某人留下的訊息'];const page=Math.min(Number(read('stone-result-page','0')),pages.length-1),last=page===pages.length-1;const control=next(()=>{if(!last){write('stone-result-page',page+1);viewKey='';render();}else if(r.phase==='finished')closeOverlay();else transact('finish',{run_id:r.id},'正在保存隊伍路線…').then(()=>closeOverlay()).catch(()=>{});});if(last&&!isLeader()&&r.phase!=='finished')control.disabled=true;scene(pages[page],[control]);
 }
 if(inFlight)body.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
}
function render9(r,key){
 $('game-path').replaceChildren(node('span','地點'),node('span','3','checkpoint-number'),node('span','→','checkpoint-arrow'),node('span','9','checkpoint-number'));
 if(r.phase==='finished')$('game-path').append(node('span','✓','checkpoint-complete'));
 if(key===viewKey)return;viewKey=key;const body=$('game-body');body.className='game-body';body.dataset.phase=r.phase;body.replaceChildren();
 const intro=STORY_INTRO[9];
 if(r.phase==='story'){
  if(cursor<intro.length)scene(intro[cursor],[next(()=>{cursor++;write('cursor',cursor);viewKey='';render();})]);
  else{const options=[button('連樓層都忘了？你還好嗎？',()=>transact('choose',{run_id:r.id,choice:'tease'},'正在開啟作答…').catch(()=>{})),button('交給我們，現場確認最準！',()=>transact('choose',{run_id:r.id,choice:'help'},'正在開啟作答…').catch(()=>{}))];scene('你們願意幫我確認嗎？',options);}
 }else if(r.phase==='answer'){
  if(read('floor-reply','0')!=='1'){scene(storyReply(9,r.choice),[next(()=>{write('floor-reply','1');viewKey='';render();})]);return;}
  scene('政大法學院總共有幾層樓？');
  if(isLeader()){const form=node('form',undefined,'chat-form'),label=node('label','樓層數'),input=node('input');input.id='floor-answer';label.htmlFor=input.id;input.type='text';input.inputMode='numeric';input.pattern='[0-9]{1,2}';input.maxLength=2;input.required=true;input.value=read('floor-draft');input.oninput=()=>write('floor-draft',input.value);const submit=button('確認答案',null,true);submit.type='submit';form.append(label,input,submit);form.onsubmit=e=>{e.preventDefault();transact('answer',{run_id:r.id,answer:input.value},'正在確認樓層…').catch(()=>{});};body.append(form);}else body.append(node('p','等待隊長輸入觀察到的樓層數。','stage-note'));
 }else if(r.phase==='success'||r.phase==='finished'){
  const pages=STORY_END[9];const page=Math.min(Number(read('success-page','0')),pages.length-1),last=page===pages.length-1;const control=next(()=>{if(!last){write('success-page',page+1);viewKey='';render();}else if(r.phase==='finished')closeTerminal();else transact('finish',{run_id:r.id},'正在保存支線三的記憶…').then(()=>closeTerminal()).catch(()=>{});});if(last&&!isLeader()&&r.phase!=='finished')control.disabled=true;scene(pages[page],[control]);
 }
}
function render3(r,key){
 $('game-path').replaceChildren(node('span','地點'),node('span','3','checkpoint-number'));
 if(r.phase==='finished')$('game-path').append(node('span','→','checkpoint-arrow'),node('span','9','checkpoint-number'));
 const waiting=$('pinball-wait');if(waiting)waiting.textContent=`全隊完成 ${r.completed_count}／${r.total} 人`;
 updateRecoveryClocks($('game-body'),r,now());
 if(key===viewKey)return;viewKey=key;const body=$('game-body');body.className='game-body';body.dataset.phase=r.phase;body.replaceChildren();
 const pages=STORY_INTRO[3];
 const say=(who,text,actions=[])=>renderStoryScene(body,{character:who,text,actions,image:who==='奶蛋'?'/assets/characters/naiegg.png':who==='奶蛙們'?'/assets/characters/naifrog.png':'/assets/characters/nailong.png'});
 if(r.phase==='story'){
  const page=Math.min(cursor,pages.length);if(page<pages.length){say(...pages[page],[next(()=>{cursor++;write('cursor',cursor);viewKey='';render();})]);}
  else{const options=[button('真的要把奶蛋彈出去嗎？',()=>transact('choose',{run_id:r.id,choice:'egg'},'正在開始挑戰…').catch(()=>{})),button('奶蛋，你還好嗎？',()=>transact('choose',{run_id:r.id,choice:'care'},'正在開始挑戰…').catch(()=>{}))];say('奶龍','準備好一起清出道路了嗎？',options);}
 }else if(r.phase==='play'){
  if(!r.participant||r.done){scene(r.done?'你已清完奶蛙，等待隊友完成！':'本輪挑戰已開始，請協助隊友完成。');const note=node('p',`全隊完成 ${r.completed_count}／${r.total} 人`,'stage-note');note.id='pinball-wait';const clock=node('p',pinballWaitText(r,now()),'stage-note');clock.dataset.pinballWait='true';body.append(note,clock);return;}
  if(read('pinball-reply','0')!=='1'){const lines=PINBALL_REPLIES[r.choice==='egg'?'egg':'care'];const page=Math.min(Number(read('pinball-reply-page','0')),lines.length-1);say(...lines[page],[next(()=>{if(page===lines.length-1)write('pinball-reply','1');else write('pinball-reply-page',page+1);viewKey='';render();})]);return;}
  body.classList.add('pinball-body');mountPinball(body,{choice:r.choice,load:()=>{try{return JSON.parse(read('pinball-state','null'));}catch{return null;}},save:value=>write('pinball-state',JSON.stringify(value)),complete:async({shots})=>{const result=await transact('complete',{run_id:r.id,shots},'正在記錄你的完成狀態…');if(!result)throw new Error('尚未送出');}});
  const clock=node('p',pinballWaitText(r,now()),'stage-note');clock.dataset.pinballWait='true';body.append(clock);
 }else if(r.phase==='success'||r.phase==='finished'){
  const lines=STORY_END[3];const page=Math.min(Number(read('success-page','0')),lines.length-1),last=page===lines.length-1;const control=next(()=>{if(!last){write('success-page',page+1);viewKey='';render();}else if(r.phase==='finished')closeOverlay();else transact('finish',{run_id:r.id},'正在更新隊伍進度…').then(()=>closeOverlay()).catch(()=>{});});if(last&&r.phase!=='finished'&&!isLeader())control.disabled=true;say(...lines[page],[control]);if(r.skipped_count)body.append(node('p',pinballWaitText(r,now()),'notice'));
 }
}
function render13(r,key){
 const path=$('game-path');path.replaceChildren(node('span','地點'),node('span','2','checkpoint-number'),node('span','→','checkpoint-arrow'),node('span','13','checkpoint-number'));
 if(key===viewKey)return;viewKey=key;const body=$('game-body');body.classList.remove('find-body','chat-body','is-quiz','puzzle-body');body.dataset.phase=r.phase;body.replaceChildren();
 const intro=STORY_INTRO[13];
 if(r.phase==='story'){
  const page=Math.min(cursor,intro.length);
  if(page<intro.length)scene(intro[page],[next(()=>{cursor=page+1;write('cursor',cursor);viewKey='';render();})]);
  else{const choices=[button('放心，我們幫你拼回來。',()=>transact('choose',{run_id:r.id,choice:'help'},'準備拼圖中…').catch(()=>{})),button('你真的連自己找到的照片都忘了？',()=>transact('choose',{run_id:r.id,choice:'tease'},'準備拼圖中…').catch(()=>{}))];scene('你們願意幫我嗎？',choices);}
 }else if(r.phase==='puzzle'){
  if(read('puzzle-reply','0')!=='1'){scene(storyReply(13,r.choice),[next(()=>{write('puzzle-reply','1');viewKey='';render();})]);return;}
  if(r.choice==='help'&&read('puzzle-preview-done','0')!=='1'){
   body.classList.add('puzzle-body');body.append(node('h1','奶龍想起原本的照片了！','find-heading'));
   mountPhotoPreview(body,{src:'/assets/checkpoint13/old_photo.jpg',seconds:r.preview_seconds??3,read,write,complete:()=>{viewKey='';render();}});return;
  }
  body.classList.add('puzzle-body');body.append(node('h1','拼回老照片','find-heading'),node('p',isLeader()?'拖曳照片到另一塊上交換位置，拼成完整照片。':'等待隊長拼圖，一起幫忙找出照片的線索。','find-instruction'));
  if(isLeader()){
   let pieces;try{pieces=JSON.parse(read('pieces','null'));}catch{}if(!Array.isArray(pieces)||pieces.length!==9||new Set(pieces).size!==9||pieces.some(n=>!Number.isInteger(n)||n<0||n>8)){pieces=[4,1,7,3,8,0,6,2,5];write('pieces',JSON.stringify(pieces));}
   const grid=node('div',undefined,'puzzle-grid');
   const swap=(from,to)=>{
    if(inFlight||from===to)return;
    [pieces[from],pieces[to]]=[pieces[to],pieces[from]];write('pieces',JSON.stringify(pieces));
    if(pieces.every((n,i)=>n===i))transact('puzzle',{run_id:r.id},'正在記錄拼圖…').catch(()=>{});
    else{viewKey='';render();}
   };
   pieces.forEach((piece,index)=>{
    const tile=button('',null);tile.className='puzzle-tile';tile.dataset.slot=String(index);tile.style.backgroundPosition=`${(piece%3)*50}% ${Math.floor(piece/3)*50}%`;tile.setAttribute('aria-label',`第 ${index+1} 格，照片碎片 ${piece+1}；可拖曳，或按 Alt 加方向鍵交換`);
    let drag=null,target=null;
    const clear=()=>{target?.classList.remove('drop-target');target=null;tile.classList.remove('dragging');tile.style.transform='';drag=null;};
    tile.onpointerdown=e=>{if(inFlight||!e.isPrimary||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};tile.setPointerCapture(e.pointerId);tile.classList.add('dragging');};
    tile.onpointermove=e=>{
     if(!drag||drag.id!==e.pointerId)return;
     tile.style.transform=`translate(${e.clientX-drag.x}px,${e.clientY-drag.y}px)`;
     target?.classList.remove('drop-target');const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('.puzzle-tile');target=hit&&hit!==tile&&grid.contains(hit)?hit:null;target?.classList.add('drop-target');
    };
    tile.onpointerup=e=>{
     if(!drag||drag.id!==e.pointerId)return;
     const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('.puzzle-tile');const destination=hit&&grid.contains(hit)?Number(hit.dataset.slot):index;
     clear();if(tile.hasPointerCapture(e.pointerId))tile.releasePointerCapture(e.pointerId);swap(index,destination);
    };
    tile.onpointercancel=clear;tile.onlostpointercapture=clear;
    tile.onkeydown=e=>{if(!e.altKey)return;const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-3,ArrowDown:3}[e.key];if(offset===undefined)return;e.preventDefault();const destination=index+offset;if(destination<0||destination>8||Math.abs(offset)===1&&Math.floor(destination/3)!==Math.floor(index/3))return;swap(index,destination);grid.isConnected&&grid.children[destination]?.focus();};
    grid.append(tile);
   });body.append(grid);
   if(pieces.every((n,i)=>n===i))body.append(button('確認完成拼圖',()=>transact('puzzle',{run_id:r.id},'正在記錄拼圖…').catch(()=>{}),true));
  }
 }else if(r.phase==='guess'){
  body.classList.add('puzzle-body');body.append(node('h1','照片裡是哪棟建築？','find-heading'));const photo=node('img');photo.src='/assets/checkpoint13/old_photo.jpg';photo.className='puzzle-photo';photo.alt='拼好的政大老照片';body.append(photo);
  if(isLeader()){const form=node('form',undefined,'chat-form'),input=node('input');input.placeholder='輸入建築名稱';input.maxLength=100;input.required=true;const submit=button('確認答案',null,true);submit.type='submit';form.append(input,submit);form.onsubmit=e=>{e.preventDefault();transact('guess',{run_id:r.id,guess:input.value.trim()},'正在確認答案…').catch(()=>{});};body.append(form);}else body.append(node('p','等待隊長輸入答案。','stage-note'));
 }else if(r.phase==='success'||r.phase==='finished'){
  const pages=STORY_END[13];let page=Math.min(Number(read('success-page','0')),pages.length-1);const last=page===pages.length-1;const control=next(()=>{if(!last){write('success-page',page+1);viewKey='';render();}else if(r.phase==='finished')closeTerminal();else transact('finish',{run_id:r.id},'正在保存記憶碎片…').then(()=>closeTerminal()).catch(()=>{});});if(last&&r.phase!=='finished'&&!isLeader())control.disabled=true;scene(pages[page],[control]);if(last&&!isLeader()&&r.phase!=='finished')body.append(node('p','等待隊長完成劇情。','stage-note'));
 }
 if(inFlight)body.querySelectorAll('button,input').forEach(el=>el.disabled=true);
}
function render11(r,key){
 const path=$('game-path');path.replaceChildren(node('span','地點'),node('span','1','checkpoint-number'));
 if(state?.progress?.choices?.branch_1_detour)path.append(node('span','→','checkpoint-arrow'),node('span','8','checkpoint-number'));
 path.append(node('span','→','checkpoint-arrow'),node('span','11','checkpoint-number'));
 if(key===viewKey)return;viewKey=key;const body=$('game-body');body.classList.remove('find-body','chat-body','is-quiz','puzzle-body');body.dataset.phase=r.phase;body.replaceChildren();
 const intro=STORY_INTRO[11];
 if(r.phase==='story'){
  const page=Math.min(cursor,intro.length);
  if(page<intro.length)scene(intro[page],[next(()=>{cursor=page+1;write('cursor',cursor);viewKey='';render();})]);
  else{const buttons=[button('你怎麼連自己的守護力量都弄丟了？',()=>transact('choose',{run_id:r.id,choice:'question'},'正在開始搜尋…').catch(()=>{})),button('六隻奶蛙，交給我們！',()=>transact('choose',{run_id:r.id,choice:'promise'},'正在開始搜尋…').catch(()=>{}))];scene('準備好一起找奶蛙了嗎？',buttons);}
 }else if(r.phase==='search'){
  const chosenReply=storyReply(11,r.choice);
  if(read('reply','0')!=='1'){scene(chosenReply,[next(()=>{write('reply','1');viewKey='';render();})]);return;}
  body.classList.add('find-body');body.append(node('h1',`已找到 ${r.found_count}／6 隻奶蛙`,'find-heading'));
  if(r.my_photo){
   body.append(node('p','點選照片中藏著的奶蛙。','find-instruction'));
   const image=node('img');image.src=`/assets/checkpoint11/${r.my_photo}.jpg`;image.alt=`分配給你的照片 ${r.my_photo}，請點選奶蛙所在位置`;image.className='find-photo';image.tabIndex=0;
   image.onclick=event=>{if(inFlight)return;const bounds=image.getBoundingClientRect();const x=(event.clientX-bounds.left)/bounds.width,y=(event.clientY-bounds.top)/bounds.height;transact('find',{run_id:r.id,photo:r.my_photo,x,y},'正在記錄找到的奶蛙…').catch(()=>{});};
   body.append(image,node('p','找到後會自動分配下一張尚未分配的照片。','stage-note'));
  }else scene(r.participant?'你分到的照片都找完了，等隊友一起完成！':'這輪已開始，請一起觀看隊伍進度。');
  mountPhotoRecovery(body,{run:r,team,player,leader:isLeader(),busy:inFlight,now:now(),submit:(action,payload)=>transact(action,{run_id:r.id,...payload},'正在確認照片接手安排…').catch(()=>{})});
 }else if(r.phase==='success'||r.phase==='finished'){
  const pages=STORY_END[11];
  const rawPage=Number(read('success-page','0'));
  if(r.phase==='finished'&&rawPage>=pages.length){scene('找到了！這一片記憶碎片也找回來了！',[next(()=>closeTerminal())]);return;}
  let page=Math.min(rawPage,pages.length-1);
  const control=page<pages.length-1?next(()=>{write('success-page',page+1);viewKey='';render();}):next(()=>{if(r.phase==='finished'){write('success-page',pages.length);viewKey='';render();return;}transact('finish',{run_id:r.id},'正在保存記憶碎片…').then(()=>{write('success-page',pages.length);viewKey='';render();}).catch(()=>{});});
  if(page===pages.length-1&&r.phase!=='finished'&&!isLeader())control.disabled=true;
  control.setAttribute('aria-label',page<pages.length-1?'繼續對話':r.phase==='finished'?'返回首頁':isLeader()?'完成劇情並找回碎片':'等待隊長完成劇情');
  scene(pages[page],[control]);if(page===pages.length-1&&r.phase!=='finished'&&!isLeader())body.append(node('p','等待隊長完成劇情。','stage-note'));
 }
 if(inFlight)body.querySelectorAll('button,input').forEach(el=>el.disabled=true);
}


function render2(r,key){
 const path=$('game-path');path.replaceChildren(node('span','地點'),node('span','2','checkpoint-number'));
 if(r.phase==='finished')path.append(node('span','→','checkpoint-arrow'),node('span','13','checkpoint-number'));
 if(key===viewKey)return;viewKey=key;const body=$('game-body');body.classList.remove('find-body','chat-body','is-quiz','puzzle-body');body.dataset.phase=r.phase;body.replaceChildren();
 const senior=(text,actions=[],speaker='奶蛙學長',reveal=true)=>{renderStoryScene(body,{text,actions,character:speaker,image:'/assets/characters/senior.png'});if(!reveal)body.querySelector('.story-actor img').hidden=true;};
 const intro=STORY_INTRO[2];
 if(r.phase==='story'){
  const page=Math.min(cursor,intro.length);
  if(page<intro.length){const [who,text,reveal]=intro[page];senior(text,[next(()=>{cursor=page+1;write('cursor',cursor);viewKey='';render();})],who,reveal);}
  else{const options=[button('你就不能直接告訴我們嗎?',()=>transact('choose',{run_id:r.id,choice:'ask'},'正在開始挑戰…').catch(()=>{})),button('好吧，讓我們看看題目！',()=>transact('choose',{run_id:r.id,choice:'ready'},'正在開始挑戰…').catch(()=>{}))];senior('你們想怎麼回答？',options);}
 }else if(r.phase==='chat'){
  if(read('reply','0')!=='1'){senior(storyReply(2,r.choice),[next(()=>{write('reply','1');viewKey='';render();})]);return;}
  body.classList.add('chat-body');body.append(node('h1','問奶蛙學長','chat-heading'),node('p','每個人各自提問；任何隊員猜對都能讓全隊通過。','stage-note'));
  const messages=r.messages??[],index=Math.max(0,Math.min(Number(read('history-index',String(messages.length-1))),messages.length-1)),last=messages[index],panel=node('div',undefined,'chat-panel');
  const replies={yes:'是，呱！',no:'不是，呱！',unknown:'這個本蛙無法判定，換個問題吧。',invalid:'請用是非問題來問我，呱！'};
  const hints=['','最近好吵，學生都跑光了','好像只剩一間教室有學生了','聽說以前行政大樓想設置在那裏','位於政大校門東側，面對商學院後方，鄰接學思樓'];
  if(last){panel.append(node('p',`你：${last.question}`,'chat-question'),node('p',`奶蛙學長：${replies[last.answer]??'請再試一次。'}`,'chat-answer'));if(last.hint)panel.append(node('p',`提示：${hints[last.hint]}`,'chat-hint'));if(messages.length>1){const nav=node('div',undefined,'history-actions');const previous=button('上一題',()=>{write('history-index',index-1);viewKey='';render();});const following=button('下一題',()=>{write('history-index',index+1);viewKey='';render();});previous.disabled=index===0;following.disabled=index===messages.length-1;nav.append(previous,node('span',`${index+1}／${messages.length}`),following);panel.append(nav);}}
  else panel.append(node('p','問我一個可以用「是」或「不是」回答的問題吧！','chat-answer'));
  body.append(panel);const form=node('form',undefined,'chat-form');const input=node('input');input.name='question';input.maxLength=100;input.required=true;input.placeholder='輸入是非問題或建築名稱';input.autocomplete='off';input.value=read('question-draft');input.oninput=()=>write('question-draft',input.value);
  const buttons=node('div',undefined,'chat-actions');const ask=node('button','送出問題','primary-button');ask.type='submit';const guess=button('猜這棟',()=>{const value=input.value.trim();if(!value)return;transact('guess',{run_id:r.id,guess:value},'正在確認答案…').then(result=>{if(result&&!result.wrong){write('question-draft','');}}).catch(()=>{});});buttons.append(ask,guess);form.append(input,buttons);
  form.onsubmit=event=>{event.preventDefault();const question=input.value.trim();if(!question)return;const request_id=crypto.randomUUID();transact('ask',{run_id:r.id,question,request_id},'奶蛙學長思考中…').then(result=>{if(result){write('question-draft','');if(result.run?.messages?.length)write('history-index',result.run.messages.length-1);const field=body.querySelector('input[name=question]');if(field)field.value='';viewKey='';render();}}).catch(()=>{});};body.append(form,node('p','你的問答只顯示在自己的手機上。','stage-note'));
 }else if(r.phase==='success'||r.phase==='finished'){
  const pages=STORY_END[2];
  const page=Math.min(Number(read('success-page','0')),pages.length-1),last=page===pages.length-1;
  const control=last?next(()=>{if(r.phase==='finished'){closeOverlay();return;}transact('finish',{run_id:r.id},'正在更新隊伍進度…').then(()=>closeOverlay()).catch(()=>{});}):next(()=>{write('success-page',page+1);viewKey='';render();});
  if(last&&r.phase!=='finished'&&!isLeader())control.disabled=true;
  senior(pages[page],[control],page===3?'玩家':'奶蛙學長');if(last&&r.phase!=='finished'&&!isLeader())body.append(node('p','等待隊長完成劇情。','stage-note'));
 }
 if(inFlight)body.querySelectorAll('button,input').forEach(el=>el.disabled=true);
}

window.addEventListener('memory-home-return',()=>{if(visible)closeOverlay();history.replaceState({},'',homeUrl());});
