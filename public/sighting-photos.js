const openLayers=new Set();
const node=(tag,cls)=>{const e=document.createElement(tag);e.className=cls;return e;};
const button=(label,handler)=>{const e=node('button','sighting-photo-control');e.type='button';e.textContent=label;e.onclick=handler;return e;};
function layerFor(stack,cls,label){
 const layer=node('section',cls),host=stack.closest('.sighting-viewer')??document.body,sheet=host.querySelector('.sighting-sheet'),wasInert=sheet?.inert;
 layer.setAttribute('role','dialog');layer.setAttribute('aria-modal','true');layer.setAttribute('aria-label',label);
 if(sheet)sheet.inert=true;host.append(layer);
 let closed=false;
 const close=()=>{if(closed)return;closed=true;observer.disconnect();layer.dispatchEvent(new Event('photo-layer-close'));layer.remove();if(sheet)sheet.inert=wasInert;openLayers.delete(close);if(stack.isConnected)stack.focus({preventScroll:true});};
 const observer=new MutationObserver(()=>{if(!layer.isConnected)close();});observer.observe(document.body,{childList:true,subtree:true});openLayers.add(close);
 layer.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Tab'){const controls=[...layer.querySelectorAll('button:not(:disabled)')];if(controls.length){event.preventDefault();const index=controls.indexOf(document.activeElement);controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length].focus();}}});
 return {layer,close};
}
export function closePhotoLayers(){for(const close of [...openLayers])close();}

export async function playFullscreenStack(stack){
 stack.classList.add('is-settled');
 if(!stack.isConnected||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const {layer,close:remove}=layerFor(stack,'sighting-photo-intro','校園目擊照片'),animations=[];
 const previousVisibility=stack.style.visibility;stack.style.visibility='hidden';
 let ended=false;
 const finish=()=>{if(ended)return;ended=true;for(const animation of animations)animation.cancel();window.removeEventListener('resize',finish);stack.style.visibility=previousVisibility;remove();};
 layer.addEventListener('photo-layer-close',finish,{once:true});
 const skip=button('略過動畫',finish);skip.classList.add('sighting-photo-skip');layer.append(skip);skip.focus({preventScroll:true});
 layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();finish();}});
 const cards=[...stack.children],ghosts=cards.map(card=>{
  const ghost=node('div','sighting-fullscreen-card'),image=card.querySelector('img').cloneNode();ghost.append(image);layer.insertBefore(ghost,skip);return ghost;
 });
 // Each independent image starts at viewport size, regardless of the post's media box.
 const arrivals=ghosts.map((ghost,i)=>{
  const animation=ghost.animate([
   {opacity:0,transform:`translate(${i%2?105:-105}vw,${i===2?35:-12}vh) rotate(${i%2?9:-9}deg) scale(1.08)`},
   {opacity:1,transform:`translate(0,0) rotate(${[-2,2,-1][i]}deg) scale(1)`}
  ],{duration:650,delay:i*1050,easing:'cubic-bezier(.2,.7,.2,1)',fill:'both'});animations.push(animation);return animation.finished;
 });
 window.addEventListener('resize',finish,{once:true});
 try{
  await Promise.all(arrivals);if(ended||!layer.isConnected)return;
  const pause=layer.animate([{opacity:1},{opacity:1}],{duration:500});animations.push(pause);await pause.finished;if(ended||!stack.isConnected)return;
  const base=stack.getBoundingClientRect();
  const shrinking=ghosts.map((ghost,i)=>{
   const card=cards[i],matrix=new DOMMatrix(getComputedStyle(card).transform),x=base.left+card.offsetLeft+matrix.e,y=base.top+card.offsetTop+matrix.f;
   // Layout dimensions morph once for three cards; image pixels keep object-fit cropping.
   const animation=ghost.animate([
    {left:'-4vw',top:'-4vh',width:'108vw',height:'108vh',transform:`rotate(${[-2,2,-1][i]}deg)`},
    {left:`${x}px`,top:`${y}px`,width:`${card.offsetWidth}px`,height:`${card.offsetHeight}px`,transform:`rotate(${Math.atan2(matrix.b,matrix.a)*180/Math.PI}deg)`}
   ],{duration:850,easing:'cubic-bezier(.65,0,.25,1)',fill:'forwards'});animations.push(animation);return animation.finished;
  });
  const fade=layer.animate([{backgroundColor:'#111111'},{backgroundColor:'#11111100'}],{duration:850,fill:'forwards'});animations.push(fade);
  skip.hidden=true;await Promise.all(shrinking);
 }catch{/* Closing, skipping or switching tasks cancels the local animation. */}
 finally{finish();}
}

export function openPhotoLightbox(stack,index=2){
 const images=[...stack.querySelectorAll('img')];if(!images.length)return;
 const {layer,close}=layerFor(stack,'sighting-photo-lightbox','放大查看目擊照片');
 const image=node('img','sighting-lightbox-image'),caption=node('p','sighting-lightbox-caption'),count=node('span','sighting-lightbox-count'),header=node('header','sighting-lightbox-header'),footer=node('footer','sighting-lightbox-footer');
 const show=next=>{index=(next+images.length)%images.length;image.src=images[index].src;image.alt=images[index].alt;caption.textContent=image.alt;count.textContent=`${index+1}／${images.length}`;};
 const dismiss=button('關閉照片',close),prev=button('上一張',()=>show(index-1)),next=button('下一張',()=>show(index+1));header.append(dismiss,count);footer.append(prev,next);layer.append(header,image,caption,footer);
 layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}else if(event.key==='ArrowLeft'){event.preventDefault();show(index-1);}else if(event.key==='ArrowRight'){event.preventDefault();show(index+1);}});
 let start=null;image.onpointerdown=e=>{start={x:e.clientX,y:e.clientY};};image.onpointerup=e=>{if(start&&Math.abs(e.clientX-start.x)>50&&Math.abs(e.clientY-start.y)<80)show(index+(e.clientX<start.x?1:-1));start=null;};image.onpointercancel=()=>{start=null;};
 show(index);dismiss.focus({preventScroll:true});
}
