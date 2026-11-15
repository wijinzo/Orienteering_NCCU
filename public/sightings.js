import {closePhotoLayers} from './sighting-photos.js';
import {createPost,SIGHTING_PHOTOS,snapshotPost} from './post-card.js';
import {windDissolve} from './wind-particles.js';
import {mountCredits} from './credits.js';
import {createCreditsAudio} from './credits-audio.js';
let player=null,viewer=null,wind=null,credits=null,outroAudio=null,previousFocus=null,epoch=0;
const key=part=>`memory:sightings:${player?.id}:${part}`;
const seen=part=>{try{return localStorage.getItem(key(part))==='true';}catch{return false;}};
const remember=part=>{try{localStorage.setItem(key(part),'true');}catch{}};
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function close(){credits?.dispose();credits=null;outroAudio?.dispose();outroAudio=null;closePhotoLayers();wind?.cancel();wind=null;viewer?.remove();viewer=null;document.body.classList.remove('sighting-open');if(!document.body.classList.contains('checkpoint-open')&&!document.body.classList.contains('memory-open'))document.querySelector('.app-shell').inert=false;if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
function finishIntro(){remember('intro');close();window.dispatchEvent(new Event('sighting-intro-complete'));}
function shell(title,{keepAudio=false}={}){
 if(!viewer)previousFocus=document.activeElement;credits?.dispose();credits=null;if(!keepAudio){outroAudio?.dispose();outroAudio=null;}closePhotoLayers();wind?.cancel();wind=null;viewer?.remove();viewer=node('section',undefined,'sighting-viewer');viewer.setAttribute('role','dialog');viewer.setAttribute('aria-modal','true');viewer.setAttribute('aria-label',title);viewer.tabIndex=-1;
 const content=node('div',undefined,'sighting-sheet'),header=node('header',undefined,'sighting-header'),back=node('button','收起','sighting-close');back.type='button';back.onclick=()=>{if(title==='奶龍目擊情報')finishIntro();else close();};header.append(node('span','@','sighting-brand'),node('h1',title),back);content.append(header);viewer.append(content);document.body.append(viewer);document.body.classList.add('sighting-open');document.querySelector('.app-shell').inert=true;viewer.focus({preventScroll:true});
 viewer.onkeydown=e=>{if(e.key==='Escape'){if(title==='奶龍目擊情報')finishIntro();else close();return;}if(e.key!=='Tab')return;const controls=[...viewer.querySelectorAll('button:not(:disabled),a[href],iframe,[tabindex="0"]')].filter(e=>e.getClientRects().length);const first=controls[0],last=controls.at(-1);if(!first){e.preventDefault();return;}if(e.shiftKey&&(document.activeElement===first||document.activeElement===viewer)){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===viewer)){e.preventDefault();first.focus();}};
 return content;
}
function preload(){for(const src of SIGHTING_PHOTOS){const image=new Image();image.src=src;}}
export function showSightingIntro(){
 if(!player)return;const body=shell('奶龍目擊情報');body.append(node('p','記憶之境 · 校園動態','sighting-eyebrow'),createPost());
 const replies=node('div',undefined,'sighting-replies');replies.append(createPost({compact:true,author:'校園散步中',caption:'我也看到了！牠是不是在找什麼東西？'}),createPost({compact:true,author:'另一位路過的人',caption:'先別滑走，照片裡真的有東西。'}));body.append(replies);
 const proceed=node('button','去看看牠在找什麼 →','sighting-primary');proceed.type='button';proceed.onclick=finishIntro;body.append(proceed);
}
function finalMessage(){
 const body=shell('留在記憶裡 · 謝幕',{keepAudio:true});credits=mountCredits(body,{audio:outroAudio,home:()=>{remember('outro');close();window.dispatchEvent(new Event('sighting-home'));},replay:()=>showFarewellPost({force:true})});
}
export function showCreditsReplay(){if(!player)return;close();outroAudio=createCreditsAudio();outroAudio.play();finalMessage();}
export function showFarewellPost({force=false}={}){
 if(!player||!force&&seen('outro'))return;
 const body=shell('奶龍的最後一則貼文'),stage=node('div',undefined,'sighting-wind-stage'),post=createPost({ending:true});stage.append(post);body.append(node('p','記憶之境 · 奶龍的新貼文','sighting-eyebrow'),stage);
 const farewell=node('button','下次見，奶龍','sighting-primary');farewell.type='button';const skip=node('button','略過動畫','sighting-secondary');skip.type='button';skip.hidden=true;
 farewell.onclick=()=>{outroAudio=createCreditsAudio();outroAudio.play();farewell.disabled=true;farewell.textContent='讓風把這一刻輕輕帶走…';skip.hidden=false;const active=viewer,version=epoch;wind=windDissolve(post,()=>snapshotPost(post));wind.finished.then(done=>{if(done&&version===epoch&&viewer===active)finalMessage();});};
 skip.onclick=()=>{wind?.cancel();finalMessage();};body.append(farewell,skip);
}
export function startSightings(currentPlayer){stopSightings();player=currentPlayer;preload();let access=document.getElementById('sighting-access');if(!access){access=node('button','奶龍目擊情報','sighting-access');access.type='button';access.onclick=showSightingIntro;document.querySelector('#explore-panel .explore-heading')?.after(access);}}
export function stopSightings(){epoch++;close();player=null;}
window.addEventListener('team-state',event=>{if(player&&event.detail?.phase==='elected'&&!seen('intro')&&!/^\/checkpoint\//.test(location.pathname)&&!viewer)showSightingIntro();});

window.addEventListener('team-checkpoint-activated',()=>close());

window.addEventListener('team-choice-opened',()=>close());
