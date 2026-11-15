import {MEMORY_PARTS,collectedParts} from './memory-data.js';
import {mountPicturePuzzle} from './picture-puzzle.js';
let api,player,data=null,dialog=null,poll=null,generation=0,fusionStarted=0,lastDialogFocus=null,dialogKind='',photoPromise=null;
const logo='/assets/characters/National_Chengchi_University_logo.svg.webp';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const key=suffix=>`memory:collection:${player?.id}:${data?.team_id}:${suffix}`;
const read=suffix=>{try{return localStorage.getItem(key(suffix));}catch{return null;}};
const write=(suffix,value)=>{try{localStorage.setItem(key(suffix),value);}catch{}};
const notify=()=>window.dispatchEvent(new CustomEvent('memory-state',{detail:{...data,revealed:!!read('revealed')}}));
const leader=()=>data?.leader_id===player?.id;
function photo(){if(!photoPromise)photoPromise=new Promise((resolve,reject)=>{const image=new Image();const timeout=setTimeout(()=>{photoPromise=null;reject(new Error('照片載入逾時，請重新載入。'));},15000);image.onload=()=>{clearTimeout(timeout);resolve();};image.onerror=()=>{clearTimeout(timeout);photoPromise=null;reject(new Error('照片還沒載入成功，請重試。'));};image.src='/assets/memories/photo.jpg';});return photoPromise;}
const action=(text,handler)=>{const b=el('button',text,'primary-button');b.type='button';b.onclick=handler;return b;};
function closeDialog(){dialog?.remove();dialog=null;dialogKind='';document.body.classList.remove('memory-open');const shell=document.querySelector('.app-shell');if(shell&&!document.body.classList.contains('checkpoint-open'))shell.inert=false;lastDialogFocus?.isConnected&&lastDialogFocus.focus({preventScroll:true});}
function panel(title,kind){
 if(!dialog)lastDialogFocus=document.activeElement;
 dialog?.remove();dialog=el('section',undefined,'memory-dialog');dialogKind=kind;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',title);dialog.tabIndex=-1;
 const content=el('div',undefined,'memory-dialog-content'),header=el('header',undefined,'memory-dialog-header'),close=el('button','收起','text-button');close.type='button';close.onclick=closeDialog;header.append(el('h1',title),close);content.append(header);dialog.append(content);document.body.append(dialog);document.body.classList.add('memory-open');document.querySelector('.app-shell').inert=true;dialog.focus({preventScroll:true});
 dialog.onkeydown=e=>{if(e.key==='Escape'){closeDialog();return;}if(e.key!=='Tab')return;const list=[...dialog.querySelectorAll('button:not(:disabled),input')].filter(e=>e.getClientRects().length);const first=list[0],last=list.at(-1);if(!first){e.preventDefault();return;}if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog)){e.preventDefault();first.focus();}};
 return content;
}
function fragment(part){const card=el('div',undefined,'memory-fragment');const crop=el('div',undefined,'memory-fragment-photo');crop.style.backgroundPosition=`${(part.branch-1)*25}% 0`;crop.setAttribute('role','img');crop.setAttribute('aria-label',`支線 ${part.branch} 找回的照片碎片`);card.append(crop,el('strong',part.word,'memory-word'));return card;}
async function refresh(wait=false){
 if(!player)return null;const epoch=generation;const result=await api('/api/memories',{wait,waitLabel:'正在整理你的記憶碎片…'});if(epoch!==generation)return data;
 if(data&&(result.count<data.count||data.completed_at&&!result.completed_at||data.completed_checkpoints.some(id=>!result.completed_checkpoints.includes(id))))return data;
 const previous=data;data=result;
 if(data.completed_at&&!read('fusion-seen'))fusionStarted=fusionStarted||performance.now();
 notify();if(previous&&!previous.completed_at&&data.completed_at)goHome();return data;
}
function goHome(){closeDialog();window.dispatchEvent(new Event('memory-home-return'));notify();requestAnimationFrame(()=>document.querySelector('.memory-emblem')?.focus({preventScroll:true}));}
function loadError(error,retry){const body=panel('記憶線索','error');body.append(el('p',error.message||'暫時無法載入記憶線索。','memory-help'),action('重新載入',retry));}
function showReward(checkpoint,runId){
 const part=MEMORY_PARTS.find(p=>p.checkpoint===checkpoint);if(!part||data?.completed_at||!data?.completed_checkpoints.includes(String(checkpoint))||read(`seen:${runId}`))return false;
 write(`seen:${runId}`,'true');
 const body=panel('找回一片記憶','reward');body.append(el('p',`記憶 ${part.branch} 的照片與文字碎片找回來了！`,'memory-help'),fragment(part),el('p',`已收集 ${data.count}／5 片`,'memory-help'),action(data.count===5?'整理全部線索':'收下碎片，繼續探索',()=>{write(`seen:${runId}`,'true');if(data.count===5&&!data.completed_at)showClues();else closeDialog();}));
 return true;
}
function showCollection(){
 if(!data)return;const body=panel('收集到的記憶','collection'),grid=el('div',undefined,'memory-fragment-grid');
 [2,4,0,3,1].forEach(index=>{const part=MEMORY_PARTS[index];if(data.completed_checkpoints.includes(String(part.checkpoint)))grid.append(fragment(part));else{const missing=el('div',`記憶 ${part.branch}\n尚未找回`,'memory-missing');grid.append(missing);}});
 body.append(el('p',`已收集 ${data.count}／5 片照片與文字碎片。`,'memory-help'),grid);
 if(data.count===5)body.append(action(data.completed_at?'回首頁查看校徽':'整理線索，拼回照片',()=>data.completed_at?goHome():showClues()));else body.append(el('p','完成其他支線，找回剩下的照片與文字。','memory-help'));
}
function showClues(){
 const body=panel('這是哪棟建築的故事？','clues'),words=el('div',undefined,'memory-words');MEMORY_PARTS.forEach(p=>words.append(el('span',p.word)));
 body.append(words,el('p','歷史、研究、政大、火、1998……這些線索放在一起，讓你想到了什麼？','memory-help'),el('p','和夥伴猜猜這是哪棟建築的故事，也可以搜尋看看，這些線索可能指向什麼事件。再把照片拼完整，找回它原本的模樣。','memory-help'),action('開始拼圖',showPuzzle));
}
function showPuzzle(){
 const body=panel('拼回最後的照片','puzzle');
 if(!leader()){body.append(el('p','和隊友一起搜尋線索，等待隊長把照片拼完整。','memory-help'),action('回看文字線索',showClues));return;}
 const hint=el('div',undefined,'memory-words');MEMORY_PARTS.forEach(p=>hint.append(el('span',p.word)));body.append(hint);
 mountPicturePuzzle(body,{load:()=>{try{return JSON.parse(read('puzzle-order'));}catch{return null;}},save:order=>write('puzzle-order',JSON.stringify(order)),complete:async()=>{const epoch=generation;const result=await api('/api/memories/complete',{method:'POST',body:{}});if(epoch!==generation)return;data=result;fusionStarted=performance.now();goHome();}});
}
export function createMemoryCenter(){
 if(!data?.completed_at){const center=el('span','✿','flower-center');center.setAttribute('aria-hidden','true');return center;}
 const center=el('button',undefined,'flower-center memory-emblem');center.type='button';
 center.dataset.revealed=String(!!read('revealed'));
 if(read('revealed')){center.textContent='10';center.setAttribute('aria-label','查看最終地點 10');}
 else{const image=el('img');image.src=logo;image.alt='政大校徽';image.onerror=()=>{image.hidden=true;center.prepend(el('span','✿','memory-logo-fallback'));};center.append(image);center.setAttribute('aria-label','記憶融合完成，點擊揭曉最後一站');const hint=el('span','點擊揭曉','memory-emblem-hint');center.append(hint);
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!read('fusion-seen')&&!reduce){const elapsed=Math.max(0,performance.now()-fusionStarted);if(elapsed<2200){center.classList.add('memory-fusing');center.style.setProperty('--fusion-delay',`${-elapsed}ms`);MEMORY_PARTS.forEach((p,index)=>{const spark=el('span',p.word,'memory-spark');spark.style.setProperty('--spark-angle',`${index*72-90}deg`);center.append(spark);});const epoch=generation;setTimeout(()=>{if(epoch===generation){write('fusion-seen','true');center.classList.remove('memory-fusing');center.querySelectorAll('.memory-spark').forEach(e=>e.remove());}},2200-elapsed);}else write('fusion-seen','true');}else if(reduce)write('fusion-seen','true');
 }
 center.onclick=()=>{write('revealed','true');write('fusion-seen','true');notify();window.dispatchEvent(new Event('memory-final-select'));};return center;
}
export function startMemories(client,currentPlayer){stopMemories();api=client;player=currentPlayer;photo().catch(()=>{});poll=setInterval(()=>{if(player&&data?.count===5&&!data.completed_at&&!document.hidden)refresh().catch(()=>{});},6000);}
export function stopMemories(){generation++;clearInterval(poll);closeDialog();player=null;data=null;fusionStarted=0;}
window.addEventListener('team-state',event=>{if(player&&event.detail?.phase==='elected'&&!data)refresh().catch(()=>{});});
window.addEventListener('checkpoint-progress',event=>{if(!player)return;const current=collectedParts(event.detail?.completed_checkpoints).length;if(!data||current!==data.count)refresh().catch(()=>{});else{data={...data,completed_checkpoints:event.detail.completed_checkpoints};notify();}});
window.addEventListener('memory-terminal',event=>{
 if(!player)return;const epoch=generation,{checkpoint,runId}=event.detail;if(read(`seen:${runId}`))return;
 const body=panel('找回一片記憶','loading'),opened=dialog;body.append(el('p','正在收集照片與文字碎片…','memory-help'));
 Promise.all([refresh(true),photo()]).then(()=>{if(epoch===generation&&dialog===opened){if(data?.completed_at)closeDialog();else if(!showReward(checkpoint,runId))closeDialog();}}).catch(error=>{if(epoch===generation&&dialog===opened)loadError(error,()=>window.dispatchEvent(new CustomEvent('memory-terminal',{detail:{checkpoint,runId}})));});
});
window.addEventListener('open-memories',()=>{
 if(!player)return;const epoch=generation,body=panel('記憶線索','loading'),opened=dialog;body.append(el('p','正在整理找回的記憶…','memory-help'));
 Promise.all([refresh(),photo()]).then(()=>{if(epoch===generation&&dialog===opened)showCollection();}).catch(error=>{if(epoch===generation&&dialog===opened)loadError(error,()=>window.dispatchEvent(new Event('open-memories')));});
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&player&&data?.count===5&&!data.completed_at)refresh().catch(()=>{});});

window.addEventListener('team-checkpoint-activated',()=>closeDialog());

window.addEventListener('team-choice-opened',()=>closeDialog());
