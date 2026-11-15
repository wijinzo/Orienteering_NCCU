import {CREDITS_MUSIC,CREDITS_SIGNATURE,CREDITS_EPILOGUE,CREDITS_SOURCES,advanceCredits} from './credits-data.js';
import {storyNode as node,storyButton as button} from './story-ui.js';

function referenceGroups(){
 const groups=node('div',undefined,'credits-references');
 for(const group of CREDITS_SOURCES){const section=node('section');section.append(node('h2',group.title));const list=node('ul');for(const link of group.links){const item=node('li'),anchor=node('a',link.label);anchor.href=link.url;anchor.target='_blank';anchor.rel='noopener noreferrer';item.append(anchor);if(link.note)item.append(node('small',link.note));list.append(item);}section.append(list);groups.append(section);}return groups;
}
export function mountCredits(container,{home,replay,audio}){
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let disposed=false,frame=0,last=0,position=0,automatic=!reduced,finished=false;
 const root=node('section',undefined,'credits-root'),viewport=node('div',undefined,'credits-viewport'),reel=node('div',undefined,'credits-reel'),status=node('p','','credits-status'),controls=node('div',undefined,'credits-controls');
 root.setAttribute('aria-label','冒險謝幕');viewport.tabIndex=0;viewport.setAttribute('aria-label','謝幕文字與參考資料，可暫停後自行滑動');status.setAttribute('role','status');
 const opening=node('div',undefined,'credits-opening');opening.append(node('p','記憶之境','credits-kicker'),node('h1','留在記憶裡'));reel.append(opening);
 for(const text of CREDITS_EPILOGUE)reel.append(node('p',text,'credits-paragraph'));
 reel.append(node('p',CREDITS_SIGNATURE,'credits-signature'),referenceGroups(),node('p','故事還在校園裡，等你慢慢發現。','credits-last-line'));viewport.append(reel);
 const pause=button(automatic?'暫停謝幕':'繼續謝幕',()=>{automatic=!automatic;position=viewport.scrollTop;last=0;update();});pause.className='sighting-secondary';
 const skip=button('略過謝幕，查看資料',()=>finish());skip.className='sighting-secondary';controls.append(pause,skip);
 const music=node('section',undefined,'credits-music'),musicStatus=node('p','','credits-music-status');musicStatus.setAttribute('role','status');let musicState={phase:'idle',muted:false};
 const musicButton=button('靜音',()=>{if(['idle','blocked','error'].includes(musicState.phase))audio.play();else audio.toggleMute();});musicButton.className='sighting-secondary';
 const unsubscribe=audio.subscribe(state=>{musicState=state;const retry=['idle','blocked','error'].includes(state.phase);musicButton.textContent=retry?'點一下播放音樂':state.muted?'開啟聲音':'靜音';musicButton.setAttribute('aria-pressed',String(state.muted));musicStatus.textContent=state.phase==='blocked'?'手機暫時阻擋播放，點一下就能繼續。':state.phase==='error'?'音樂載入失敗，請點一下重試。':state.phase==='loading'?'正在載入背景音樂…':'';});
 const external=node('a','背景音樂網址');external.href=CREDITS_MUSIC;external.target='_blank';external.rel='noopener noreferrer';external.className='credits-music-link';
 const musicActions=node('div',undefined,'credits-music-actions');musicActions.append(musicButton,external);music.append(musicActions,musicStatus);
 root.append(viewport,status,controls,music);container.append(root);container.classList.add('is-credits');
 function update(){pause.textContent=automatic?'暫停謝幕':'繼續謝幕';pause.setAttribute('aria-pressed',String(!automatic));status.textContent=automatic?'謝幕進行中 · 可隨時暫停':'已暫停 · 可以自行滑動閱讀';}
 function hold(){if(!finished&&automatic){automatic=false;last=0;update();}}
 function finish(){
  if(disposed||finished)return;finished=true;automatic=false;viewport.classList.add('credits-static');root.dataset.finished='true';reel.classList.add('credits-reel-static');viewport.scrollTop=0;status.textContent='謝謝你參與這段冒險。參考連結會留在這裡。';controls.replaceChildren();
  const again=button('重看謝幕',()=>{finished=false;automatic=!reduced;root.dataset.finished='false';viewport.classList.remove('credits-static');reel.classList.remove('credits-reel-static');viewport.scrollTop=0;position=0;last=0;controls.replaceChildren(pause,skip);update();});again.className='sighting-secondary';
  const homeButton=button('回到首頁',home);homeButton.className='sighting-primary';const postButton=button('再看一次貼文',replay);postButton.className='sighting-secondary';controls.append(homeButton,again,postButton);skip.hidden=false;
 }
 const visibility=()=>{last=0;};document.addEventListener('visibilitychange',visibility);
 viewport.addEventListener('pointerdown',hold);viewport.addEventListener('wheel',hold,{passive:true});viewport.addEventListener('focusin',hold);viewport.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key))hold();});
 function tick(time){
  if(disposed||!root.isConnected)return;
  if(!document.hidden&&automatic&&!finished){const maximum=Math.max(0,viewport.scrollHeight-viewport.clientHeight);if(maximum>0){position=advanceCredits(position,last?time-last:0,maximum);viewport.scrollTop=position;if(position>=maximum-1)finish();}}
  last=time;frame=requestAnimationFrame(tick);
 }
 update();if(reduced)finish();frame=requestAnimationFrame(tick);
 return {dispose(){disposed=true;unsubscribe();cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visibility);root.remove();container.classList.remove('is-credits');}};
}
