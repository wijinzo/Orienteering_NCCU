import {SIGHTING_PHOTOS} from './post-card.js';

let activeCard=null;
export function closeMemoryCard(){activeCard?.();}

export function chooseCardPhoto(read,write,version){
 const key='card-photo:'+version,stored=read(key,'');
 if(/^[0-2]$/.test(stored))return Number(stored);
 const index=Math.floor(Math.random()*SIGHTING_PHOTOS.length);write(key,index);return index;
}

function loadPhoto(src){
 return new Promise((resolve,reject)=>{
  const image=new Image(),timer=setTimeout(()=>fail(),15000);
  const fail=()=>{clearTimeout(timer);image.onload=null;image.onerror=null;reject(new Error('照片還沒載入成功，請再試一次。'));};
  image.onload=()=>{clearTimeout(timer);image.onload=null;image.onerror=null;resolve(image);};image.onerror=fail;image.src=src;
 });
}

export function wrapCardText(ctx,text,width){
 const lines=[];
 for(const paragraph of String(text??'').replace(/\r\n?/g,'\n').split('\n')){
  let line='';
  const chars=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}).segment(paragraph)].map(part=>part.segment):Array.from(paragraph);
  for(const char of chars){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line=char;}else line+=char;}
  lines.push(line);
 }
 return lines;
}

export async function buildMemoryCard({photoIndex,name,note,letter,savedAt}){
 const photo=await loadPhoto(SIGHTING_PHOTOS[photoIndex]??SIGHTING_PHOTOS[0]);
 await document.fonts.ready;
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 const width=1200,margin=84,inner=width-margin*2,font='"Microsoft JhengHei","PingFang TC",sans-serif';
 ctx.font=`34px ${font}`;const noteLines=wrapCardText(ctx,note,inner-88),letterLines=wrapCardText(ctx,letter,inner-88);
 ctx.font=`30px ${font}`;const nameLines=wrapCardText(ctx,name,inner);
 const photoHeight=Math.min(980,Math.round(inner*photo.naturalHeight/photo.naturalWidth));
 const photoTop=204+nameLines.length*48,noteTop=photoTop+photoHeight+54,noteHeight=100+noteLines.length*56;
 const letterTop=noteTop+noteHeight+32,letterHeight=108+letterLines.length*60;
 canvas.width=width;canvas.height=letterTop+letterHeight+174;
 ctx.fillStyle='#fffaf1';ctx.fillRect(0,0,width,canvas.height);
 ctx.strokeStyle='#d8c5a7';ctx.lineWidth=2;ctx.strokeRect(32,32,width-64,canvas.height-64);
 ctx.textBaseline='top';ctx.fillStyle='#8b683d';ctx.font=`26px ${font}`;ctx.fillText('記憶之境 · 政大校園探索',margin,72);
 ctx.fillStyle='#354b61';ctx.font=`bold 52px ${font}`;ctx.fillText('奶龍留給你的一封信',margin,126);
 ctx.font=`30px ${font}`;nameLines.forEach((line,i)=>ctx.fillText(line,margin,204+i*48));
 ctx.fillStyle='#e8e3d9';ctx.fillRect(margin,photoTop,inner,photoHeight);
 // Fit the entire original photo, preserving the character and campus scene.
 const scale=Math.min(inner/photo.naturalWidth,photoHeight/photo.naturalHeight),pw=photo.naturalWidth*scale,ph=photo.naturalHeight*scale;
 ctx.drawImage(photo,margin+(inner-pw)/2,photoTop+(photoHeight-ph)/2,pw,ph);
 const section=(top,height,title,lines,lineHeight)=>{
  ctx.fillStyle='#f3eadb';ctx.beginPath();ctx.roundRect(margin,top,inner,height,20);ctx.fill();
  ctx.fillStyle='#8b683d';ctx.font=`bold 26px ${font}`;ctx.fillText(title,margin+44,top+28);
  ctx.fillStyle='#354b61';ctx.font=`34px ${font}`;lines.forEach((line,i)=>ctx.fillText(line,margin+44,top+78+i*lineHeight));
 };
 section(noteTop,noteHeight,'你留下的回憶',noteLines,56);section(letterTop,letterHeight,'奶龍的私人回信',letterLines,60);
 const date=new Date(savedAt);ctx.fillStyle='#5c6c7d';ctx.font=`24px ${font}`;
 if(Number.isFinite(date.getTime()))ctx.fillText(date.toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'}),margin,canvas.height-126);
 ctx.textAlign='right';ctx.fillText('AI 角色回信 · 把回憶，一片片收好。',width-margin,canvas.height-84);
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('圖片製作失敗，請再試一次。')),'image/png'));
}

export function showMemoryCard(blob,{name='冒險者'}={}){
 closeMemoryCard();const previous=document.activeElement,url=URL.createObjectURL(blob),dialog=document.createElement('dialog');dialog.className='memory-card-preview';dialog.setAttribute('aria-label','奶龍回信紀念卡');
 const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.textContent='你的回信紀念卡';close.textContent='關閉';close.type='button';header.append(title,close);
 const hint=document.createElement('p');hint.textContent='手機可長按圖片儲存，也可以下載 PNG 圖片。';
 const image=document.createElement('img');image.src=url;image.alt=`${name}的紀念卡，包含校園照片、完整留言及奶龍回信`;
 const download=document.createElement('a');download.href=url;download.download='記憶之境-奶龍回信.png';download.textContent='下載紀念卡圖片';download.className='primary-button';
 let closed=false;const cleanup=()=>{if(closed)return;closed=true;dialog.close();dialog.remove();URL.revokeObjectURL(url);if(activeCard===cleanup)activeCard=null;if(previous?.isConnected&&!previous.closest('[hidden],[inert]'))previous.focus({preventScroll:true});};
 close.onclick=cleanup;dialog.addEventListener('cancel',event=>{event.preventDefault();cleanup();});dialog.append(header,hint,image,download);document.body.append(dialog);activeCard=cleanup;dialog.showModal();close.focus();
}

window.addEventListener('team-checkpoint-activated',closeMemoryCard);
window.addEventListener('team-choice-opened',closeMemoryCard);
