export const TIMELINE_CARDS=[
 {id:1,year:1927,text:'我記得那時候還叫做中央黨務學校。'},
 {id:2,year:1954,text:'被大家覺得去哪裡都好遠的政大，是在甚麼時候落址木柵的？'},
 {id:3,year:1977,text:'剛蓋好的中正圖書館，曾經是台灣規模最大的大學圖書館。'},
 {id:4,year:2015,text:'你知道現在達賢圖書館所在地是指南校區嗎？是什麼時候有的呢？'},
 {id:5,year:1988,text:'曾經政大裡還有一座思賢橋，當時校園裡可是有河的呢？不知道在哪一年消失了。'},
 {id:6,year:1980,text:'第一屆金旋獎是以校園民歌比賽舉行，是台灣校園音樂人的夢想搖籃。'}
];
export const TIMELINE_ORDER=[1,2,3,6,5,4];
export const validTimelineOrder=order=>Array.isArray(order)&&order.length===6&&new Set(order).size===6&&order.every(id=>Number.isInteger(id)&&id>=1&&id<=6);
export const timelineYears=order=>order.map((id,index)=>id===TIMELINE_ORDER[index]?TIMELINE_CARDS.find(c=>c.id===id)?.year:null);
export function anchorTimeline(order,anchorId){
 const next=validTimelineOrder(order)?[...order]:[4,1,5,2,6,3];
 if(anchorId===1||anchorId===4){next.splice(next.indexOf(anchorId),1);next.splice(anchorId===1?0:5,0,anchorId);}return next;
}
export function moveTimeline(order,from,to,anchorId){
 const slot=anchorId===1?0:anchorId===4?5:-1;
 if(from===slot||to===slot||from===to||from<0||to<0||from>=6||to>=6)return [...order];
 const next=[...order],item=next.splice(from,1)[0];next.splice(to,0,item);return next;
}
export function mountTimeline(container,{load,save,submit,anchorId}){
 let order=anchorTimeline(load(),anchorId);save(order);
 const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 const list=node('ol',undefined,'timeline-list'),live=node('p','','stage-note');live.setAttribute('role','status');
 const confirm=node('button','確認時間線','primary-button');confirm.type='button';
 const update=()=>{confirm.disabled=order.some((id,index)=>id!==TIMELINE_ORDER[index]);live.textContent=`已放對 ${timelineYears(order).filter(Boolean).length}／6 張事件卡`;};
 const move=(from,to)=>{if(from===to)return;order=moveTimeline(order,from,to,anchorId);save(order);paint();list.children[to]?.querySelector('button')?.focus({preventScroll:true});};
 const paint=()=>{
  list.replaceChildren();const years=timelineYears(order);
  order.forEach((id,index)=>{
   const data=TIMELINE_CARDS.find(c=>c.id===id),card=node('li',undefined,'timeline-card');card.dataset.slot=String(index);card.dataset.correct=String(!!years[index]);card.dataset.locked=String(id===anchorId);
   const handle=node('button','⠿','timeline-handle');handle.type='button';if(id===anchorId){handle.disabled=true;handle.textContent='✓';}handle.setAttribute('aria-label',id===anchorId?'奶龍已固定此事件，不可移動':`拖曳第 ${index+1} 張事件卡，或按方向鍵上下移動`);
   const text=node('span',data.text,'timeline-text'),year=node('span',years[index]?String(years[index]):'待找回','timeline-year');card.append(handle,text,year);
   let drag=null,target=null;
   const clear=()=>{target?.classList.remove('drag-over');target=null;drag=null;card.style.transform='';card.classList.remove('dragging');};
   handle.onpointerdown=e=>{if(id===anchorId||!e.isPrimary||e.button!==0||confirm.disabled&&confirm.dataset.sending==='true')return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};handle.setPointerCapture(e.pointerId);card.classList.add('dragging');};
   const hitAt=e=>{const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('.timeline-card');return hit&&list.contains(hit)&&hit!==card?hit:null;};
   handle.onpointermove=e=>{if(drag?.id!==e.pointerId)return;card.style.transform=`translate(${e.clientX-drag.x}px,${e.clientY-drag.y}px)`;target?.classList.remove('drag-over');target=hitAt(e);target?.classList.add('drag-over');const rect=list.getBoundingClientRect();if(e.clientY<rect.top+32)list.scrollTop-=12;else if(e.clientY>rect.bottom-32)list.scrollTop+=12;};
   handle.onpointerup=e=>{if(drag?.id!==e.pointerId)return;const hit=hitAt(e),to=hit?Number(hit.dataset.slot):index;clear();if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);move(index,to);};
   handle.onpointercancel=handle.onlostpointercapture=clear;
   handle.onkeydown=e=>{if(id===anchorId||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const to=index+(e.key==='ArrowUp'?-1:1);if(to>=0&&to<6)move(index,to);};
   list.append(card);
  });update();
 };
 confirm.onclick=async()=>{if(confirm.disabled)return;confirm.disabled=true;confirm.dataset.sending='true';list.inert=true;try{await submit([...order]);}catch{if(list.isConnected){live.textContent='尚未送出成功，請再試一次。';update();}}finally{confirm.dataset.sending='false';list.inert=false;if(confirm.isConnected)update();}};
 container.append(list,live,confirm);paint();
}
