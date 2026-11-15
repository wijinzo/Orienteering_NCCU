import {playFullscreenStack,openPhotoLightbox} from './sighting-photos.js';
// Fictional in-game posts, reconstructed from the user's Threads layout reference.
export const SIGHTING_PHOTOS=[
 '/assets/sightings/水彩山城陽光下的黃色小角色.png',
 '/assets/sightings/ChatGPT 圖像 2026年11月14日 下午05_31_51.png',
 '/assets/sightings/ChatGPT 圖像 2026年11月14日 下午05_31_43.png'
];
const icons={heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',reply:'M21 11.5a8.5 8.5 0 1 0-4.1 7.3L22 21l-1.5-5.1a8.5 8.5 0 0 0 .5-4.4Z',repost:'M4 8h14l-4-4M20 16H6l4 4M18 8v5M6 16v-5',share:'M3 4h18l-7 17-3-10-8-7Zm8 7L21 4'};
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const text=(tag,value,cls)=>{const e=el(tag,value,cls);e.dataset.postText='';return e;};
export function createPost({ending=false,compact=false,author,caption}={}){
 const post=el('article',undefined,`sighting-post${compact?' sighting-reply':''}`);
 const avatar=el('div',undefined,'sighting-avatar');avatar.dataset.postAvatar='';
 if(ending){const image=el('img');image.src='/assets/characters/nailong.png';image.alt='奶龍頭像';avatar.append(image);}else avatar.append(text('span',compact?'同':'政','sighting-avatar-letter'));
 const line=el('span',undefined,'sighting-connector');line.setAttribute('aria-hidden','true');
 const main=el('div',undefined,'sighting-post-main'),header=el('header',undefined,'sighting-post-header');
 header.append(text('strong',author??(ending?'奶龍':'指南山下的路人'),'sighting-author'),text('span',ending?'剛剛':'6m','sighting-time'),text('span','•••','sighting-more'));
 main.append(header,text('p',caption??(ending?'今天的記憶，本龍收好了。\n下次在校園遇見，記得跟本龍打個招呼！':'剛剛在政大看到一隻黃黃的，還不只一個地方。\n有人知道牠在忙什麼嗎？'),'sighting-caption'));
 if(!compact)main.append(createPhotoStack({fullscreen:!ending}));
 const actions=el('div',undefined,'sighting-icons');actions.setAttribute('aria-hidden','true');
 for(const d of Object.values(icons)){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);actions.append(svg);}
 main.append(actions);if(!compact)main.append(text('p',ending?'這段故事，被你們記住了':'校園裡還有其他目擊情報','sighting-reactions'));post.append(avatar,line,main);return post;
}
function createPhotoStack({fullscreen=false}={}){
 const media=el('div',undefined,'sighting-media'),stack=el('button',undefined,'sighting-photo-stack'),status=el('p','正在載入目擊照片…','sighting-image-status'),retry=el('button','重新載入照片','sighting-image-retry');
 stack.type='button';stack.disabled=true;stack.setAttribute('aria-label','三張奶龍校園目擊照片，點擊放大查看');status.setAttribute('role','status');retry.type='button';retry.hidden=true;
 const labels=['奶龍探頭趴在校園欄杆上','奶龍躲在樓梯旁的牆後','奶龍站在樹蔭入口旁'];
 let loaded=0,started=false,failed=new Set();
 const replay=()=>{for(const animation of stack.getAnimations({subtree:true}))animation.cancel();stack.classList.remove('is-stacking');void stack.offsetWidth;stack.classList.add('is-stacking');};
 SIGHTING_PHOTOS.forEach((src,i)=>{
  const card=el('span',undefined,'sighting-photo-card'),image=el('img');image.alt=labels[i];image.draggable=false;card.append(image);stack.append(card);
  image.onload=()=>{failed.delete(image);loaded=[...stack.querySelectorAll('img')].filter(img=>img.complete&&img.naturalWidth).length;if(loaded===SIGHTING_PHOTOS.length&&!started){started=true;status.hidden=true;retry.hidden=true;stack.disabled=false;if(fullscreen)playFullscreenStack(stack);else replay();}};
  image.onerror=()=>{failed.add(image);status.hidden=false;status.textContent='照片還沒載入成功，請重試。';retry.hidden=false;};image.src=src;
 });
 stack.onclick=()=>openPhotoLightbox(stack);retry.onclick=()=>{retry.hidden=true;status.textContent='正在重新載入…';for(const image of failed)image.src=image.src.split('?')[0]+'?retry='+Date.now();};
 media.append(stack,status,retry);return media;
}
async function ready(image){if(image.complete)return;await new Promise(resolve=>{const timer=setTimeout(resolve,10000);image.addEventListener('load',()=>{clearTimeout(timer);resolve();},{once:true});image.addEventListener('error',()=>{clearTimeout(timer);resolve();},{once:true});});}
// Small deterministic snapshot of our own post component; no DOM capture dependency.
export async function snapshotPost(post){
 await Promise.all([...post.querySelectorAll('img')].map(ready));for(const animation of post.querySelector('.sighting-photo-stack')?.getAnimations({subtree:true})??[])animation.finish();const bounds=post.getBoundingClientRect();const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(bounds.width));canvas.height=Math.max(1,Math.ceil(bounds.height));const ctx=canvas.getContext('2d');ctx.fillStyle='#111111';ctx.fillRect(0,0,canvas.width,canvas.height);
 const rect=e=>{const r=e.getBoundingClientRect();return{x:r.left-bounds.left,y:r.top-bounds.top,w:r.width,h:r.height};};
 const avatar=post.querySelector('[data-post-avatar]');if(avatar){const r=rect(avatar);ctx.fillStyle='#eee7da';ctx.beginPath();ctx.arc(r.x+r.w/2,r.y+r.h/2,r.w/2,0,Math.PI*2);ctx.fill();}
 const line=post.querySelector('.sighting-connector');if(line){const r=rect(line);ctx.fillStyle='#34383a';ctx.fillRect(r.x,r.y,r.w,r.h);}
 for(const image of post.querySelectorAll('img')){if(!image.naturalWidth||image.closest('.sighting-photo-card'))continue;const r=rect(image);ctx.save();ctx.beginPath();ctx.roundRect(r.x,r.y,r.w,r.h,image.closest('.sighting-avatar')?r.w/2:10);ctx.clip();ctx.drawImage(image,r.x,r.y,r.w,r.h);ctx.restore();}
 // Draw each independent photo with its actual final transform, matching the DOM stack.
 const stack=post.querySelector('.sighting-photo-stack');if(stack){const r=rect(stack);for(const card of stack.children){const image=card.querySelector('img');if(!image?.naturalWidth)continue;const style=getComputedStyle(card),matrix=new DOMMatrix(style.transform),w=card.offsetWidth,h=card.offsetHeight;ctx.save();ctx.translate(r.x+card.offsetLeft,r.y+card.offsetTop);ctx.transform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f);ctx.fillStyle='#f5f0e7';ctx.shadowColor='#0008';ctx.shadowBlur=12;ctx.shadowOffsetY=5;ctx.fillRect(0,0,w,h);ctx.shadowColor='transparent';ctx.drawImage(image,4,4,w-8,h-8);ctx.restore();}}
 for(const item of post.querySelectorAll('[data-post-text]')){const r=rect(item),style=getComputedStyle(item),size=parseFloat(style.fontSize),lineHeight=parseFloat(style.lineHeight)||size*1.5;ctx.font=`${style.fontWeight} ${size}px ${style.fontFamily}`;ctx.fillStyle=style.color;ctx.textBaseline='top';let y=r.y;
  for(const paragraph of item.textContent.split('\n')){let value='';for(const c of paragraph){if(ctx.measureText(value+c).width>r.w&&value){ctx.fillText(value,r.x,y);y+=lineHeight;value='';}value+=c;}if(y<r.y+r.h+1)ctx.fillText(value,r.x,y);y+=lineHeight;}
 }
 for(const svg of post.querySelectorAll('svg')){const r=rect(svg);ctx.save();ctx.translate(r.x,r.y);ctx.scale(r.w/24,r.h/24);ctx.strokeStyle='#ededed';ctx.lineWidth=1.8;ctx.lineCap='round';ctx.lineJoin='round';for(const path of svg.querySelectorAll('path'))ctx.stroke(new Path2D(path.getAttribute('d')));ctx.restore();}
 return canvas;
}
