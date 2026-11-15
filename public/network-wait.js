const requests=new Map();let panel=null,notice=null,timer=null,sequence=0;
function remove(){clearTimeout(timer);timer=null;panel?.remove();panel=null;}
export function createWaitFrog(){
 const picture=document.createElement('picture'),still=document.createElement('source'),frog=document.createElement('img');still.media='(prefers-reduced-motion: reduce)';still.srcset='/assets/characters/naifrog.png';frog.src='/assets/checkpoint3/frog.gif';frog.alt='';frog.width=64;frog.height=64;frog.onerror=()=>{frog.hidden=true;};picture.append(still,frog);return picture;
}
export function clearResumeError(){notice?.remove();notice=null;}
function card(){
 const outer=document.createElement('div');outer.className='network-wait';outer.setAttribute('role','status');outer.setAttribute('aria-live','polite');
 const body=document.createElement('div');body.className='network-wait-card';
 const picture=createWaitFrog();
 const copy=document.createElement('p');copy.className='network-wait-copy';body.append(picture,copy);outer.append(body);return outer;
}
function paint(){
 if(!requests.size){remove();return;}
 if(!panel){panel=card();document.body.append(panel);}
 const values=[...requests.values()],blocking=values.some(v=>v.blocking);panel.classList.toggle('network-wait-blocking',blocking);panel.hidden=document.hidden;
 panel.querySelector('.network-wait-copy').textContent=values.at(-1).label;
}
export function beginNetworkWait(label='奶蛙正在幫你傳遞訊息…',{blocking=false}={}){
 if(typeof document==='undefined')return ()=>{};
 clearResumeError();const id=++sequence;requests.set(id,{label,blocking});
 if(panel)paint();else if(!timer)timer=setTimeout(()=>{timer=null;paint();},180);
 let done=false;return ()=>{if(done)return;done=true;requests.delete(id);if(!requests.size)remove();else if(panel)paint();};
}
export function showResumeError(error,retry){
 if(typeof document==='undefined')return;
 clearResumeError();notice=card();notice.classList.add('network-wait-blocking');notice.setAttribute('role','alertdialog');notice.setAttribute('aria-label','重新連線');notice.tabIndex=-1;
 notice.querySelector('img').src='/assets/characters/naifrog.png';
 notice.querySelector('.network-wait-copy').textContent=error.code==='AUTH_INVALID'?'登入已過期，請重新登入接續旅程。':'還沒接回隊伍進度，請確認網路後再試一次。';
 const again=document.createElement('button');again.type='button';again.textContent=error.code==='AUTH_INVALID'?'重新登入':'重新連線';again.onclick=()=>{clearResumeError();if(error.code==='AUTH_INVALID')location.reload();else retry();};
 const later=document.createElement('button');later.type='button';later.textContent='稍後再試';later.onclick=clearResumeError;
 notice.querySelector('.network-wait-card').append(again,later);notice.onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();(document.activeElement===again?later:again).focus();}};document.body.append(notice);again.focus({preventScroll:true});
}
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(panel)panel.hidden=document.hidden;if(notice)notice.hidden=document.hidden;});
