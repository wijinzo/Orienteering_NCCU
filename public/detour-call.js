// Shared local-only playback/chat. Only the leader's final completion calls the server.
export const DETOUR_DIALOGUE={
 8:['嘻嘻，恭喜你來到校門口','請大笑一聲，往四維堂移動'],
 6:['科科，恭喜你來到社科院','請往教育學院移動']
};
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,handler,cls)=>{const b=node('button',text,cls);b.type='button';b.onclick=handler;return b;};
const portrait=cls=>{const frame=node('span',undefined,cls),image=node('img');image.src='/assets/characters/nailong.png';image.alt='奶龍頭像';frame.append(image);return frame;};
export function mountDetourCall(container,{run,leader,read,write,finish,leave,replay=false}){
 const root=node('section',undefined,'detour-root');container.replaceChildren(root);
 let state=run,isLeader=leader,disposed=false,audio=null,seconds=Number(read('call-seconds','0')),stage=read('call-stage','incoming'),count=Math.max(1,Math.min(2,Number(read('call-messages','1')))),finishButton=null,wait=null,playingLabel=null,resume=null,mute=null,lastSaved=0,playing=false;
 const stop=()=>{if(audio){if(Number.isFinite(audio.currentTime)){seconds=audio.currentTime;write('call-seconds',seconds);}audio.pause();audio.removeAttribute('src');audio.load();audio=null;}playing=false;};
 const updateControls=()=>{if(finishButton){finishButton.disabled=!isLeader&&state.phase!=='finished';finishButton.textContent=replay?'返回紀錄':state.phase==='finished'?'回到首頁':isLeader?'看完了，開放下一站':'等待隊長看完對話';}if(wait)wait.textContent=replay?'這是已完成的通話紀錄，不會改動隊伍進度。':state.phase==='finished'?`地點 ${state.checkpoint} 已完成，下一站 ${state.next_id}。`:'每人各自閱讀，由隊長看完後更新全隊進度。';};
 const showChat=()=>{stop();stage='chat';write('call-stage',stage);render();};
 async function play(){
  if(disposed||stage==='chat')return;
  stage='call';write('call-stage',stage);if(!audio)render();
  const current=audio;if(!current)return;if(current.error)current.load();
  playingLabel.textContent='正在載入通話音樂…';resume.hidden=true;
  try{await current.play();if(disposed||audio!==current)return;playing=true;playingLabel.textContent='通話中 · 聽不到聲音時，請提高手機媒體音量。';}
  catch{if(disposed||audio!==current)return;playing=false;playingLabel.textContent='音樂還沒播放成功，點一下重新播放；也可以掛斷後看訊息。';resume.hidden=false;}
 }
 function render(){
  if(disposed)return;
  root.replaceChildren();root.className='detour-root';finishButton=null;wait=null;
  if(stage==='chat'){
   container.dataset.callView='chat';root.classList.add('detour-chat');
   const head=node('header',undefined,'detour-chat-header'),avatar=portrait('detour-chat-avatar');head.append(avatar,node('h1','奶龍','detour-chat-name'));
   const log=node('div',undefined,'detour-message-list');log.setAttribute('role','log');log.setAttribute('aria-live','polite');log.append(node('p','通話已結束','detour-call-ended'));
   for(const text of DETOUR_DIALOGUE[state.checkpoint].slice(0,count))log.append(node('p',text,'detour-bubble'));
   root.append(head,log);
   if(count<2)root.append(button('繼續看訊息 ▾',()=>{count++;write('call-messages',count);render();},'primary-button'));
   else{wait=node('p','','stage-note');finishButton=button('',async()=>{if(state.phase==='finished'){leave();return;}if(!isLeader)return;finishButton.disabled=true;try{const result=await finish();if(result&&!disposed)leave();}catch{updateControls();}},'primary-button');root.append(wait,finishButton);updateControls();}
   root.append(button('重聽通話',()=>{seconds=0;write('call-seconds',0);stage='incoming';write('call-stage',stage);render();},'text-button'));
   return;
  }
  container.dataset.callView='phone';root.classList.add('detour-phone');root.dataset.callStage=stage;
  const art=node('img');art.className='detour-call-art';art.src='/assets/calls/call-screen-v1.png';art.alt='';art.setAttribute('aria-hidden','true');
  const info=node('div',undefined,'detour-call-info');info.append(node('h1','奶龍'),node('p',stage==='incoming'?'奶龍來電':'接續你的通話'));
  playingLabel=node('p',stage==='incoming'?'接聽前請開啟手機音量喔！音樂播完或掛斷後，會收到奶龍的訊息。':'點「繼續播放」接續音樂。','detour-play-status');playingLabel.setAttribute('role','status');
  const clock=node('p','','detour-call-clock');
  const hang=button(stage==='incoming'?'接聽':'掛斷',stage==='incoming'?play:showChat,'detour-phone-button '+(stage==='incoming'?'detour-answer':'detour-hang'));hang.setAttribute('aria-label',stage==='incoming'?'接聽奶龍來電':'掛斷並查看奶龍訊息');
  resume=button('繼續播放',play,'detour-resume');resume.hidden=stage==='incoming';
  mute=button('靜音',()=>{if(!audio)return;audio.muted=!audio.muted;mute.setAttribute('aria-pressed',String(audio.muted));mute.textContent=audio.muted?'開聲音':'靜音';playingLabel.textContent=audio.muted?'已靜音，點「開聲音」就能繼續聽。':'通話中 · 請確認手機媒體音量已開啟。';},'detour-mute');mute.hidden=stage==='incoming';mute.setAttribute('aria-pressed','false');
  const frame=node('div',undefined,'detour-phone-frame');frame.append(art,portrait('detour-phone-avatar'),info,playingLabel,clock,hang,resume,mute);root.append(frame);
  if(stage==='call'){
   audio=new Audio('/assets/calls/nailong-call.mp3?v=loudness-1');audio.preload='auto';const current=audio;
   current.onloadedmetadata=()=>{if(disposed||audio!==current)return;if(seconds>0&&seconds<current.duration)current.currentTime=seconds;else seconds=0;};
   current.onwaiting=()=>{if(!disposed&&audio===current)playingLabel.textContent='通話音樂緩衝中…';};
   current.onplaying=()=>{if(!disposed&&audio===current){playing=true;playingLabel.textContent='通話中';resume.hidden=true;}};
   current.ontimeupdate=()=>{if(disposed||audio!==current)return;seconds=current.currentTime;clock.textContent=`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;if(seconds-lastSaved>=3){lastSaved=seconds;write('call-seconds',seconds);}};
   current.onended=()=>{if(!disposed&&audio===current)showChat();};
   current.onerror=()=>{if(disposed||audio!==current)return;playingLabel.textContent='音樂載入失敗。可以重試，或掛斷查看訊息。';resume.hidden=false;};
  }
 }
 const pause=()=>{if(audio&&!audio.paused){audio.pause();playing=false;write('call-seconds',audio.currentTime);if(resume)resume.hidden=false;if(playingLabel)playingLabel.textContent='通話已暫停，點一下繼續播放。';}};
 const visibility=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pause);
 render();
 return {root,update(next,lead){state=next;isLeader=lead;updateControls();},dispose(){disposed=true;stop();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pause);delete container.dataset.callView;root.remove();}};
}
