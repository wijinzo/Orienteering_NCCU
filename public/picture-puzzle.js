import {validMemoryOrder,solvedMemoryOrder} from './memory-data.js';
// Reusable strip-swap puzzle. All moves are local; only confirmation is submitted.
export function mountPicturePuzzle(container,{load,save,complete}){
 let order=load();if(!validMemoryOrder(order)){order=[2,4,1,0,3];save(order);}
 const board=document.createElement('div');board.className='memory-puzzle';board.setAttribute('aria-label','拖曳照片碎片交換位置');
 const status=document.createElement('p');status.className='memory-help';status.setAttribute('role','status');
 const confirm=document.createElement('button');confirm.type='button';confirm.className='primary-button';confirm.textContent='照片拼好了';
 let sending=false;
 const update=()=>{confirm.disabled=sending||!solvedMemoryOrder(order);status.textContent=solvedMemoryOrder(order)?'照片完整了！可以確認完成。':'拖曳碎片到另一片上交換，拼回完整照片。';};
 const swap=(a,b)=>{if(sending||a===b)return;[order[a],order[b]]=[order[b],order[a]];save(order);paint();board.children[b]?.focus({preventScroll:true});};
 const paint=()=>{board.replaceChildren();order.forEach((piece,index)=>{
  const tile=document.createElement('button');tile.type='button';tile.className='memory-puzzle-piece';tile.dataset.slot=String(index);tile.style.backgroundPosition=`${piece*25}% 0`;tile.setAttribute('aria-label',`照片第 ${index+1} 格，可拖曳或按 Alt 加左右鍵交換`);
  let drag=null,target=null;const clear=()=>{target?.classList.remove('drop-target');target=null;drag=null;tile.style.transform='';tile.classList.remove('dragging');};
  const hit=e=>{const t=document.elementFromPoint(e.clientX,e.clientY)?.closest('.memory-puzzle-piece');return t&&t!==tile&&board.contains(t)?t:null;};
  tile.onpointerdown=e=>{if(sending||!e.isPrimary||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};tile.setPointerCapture(e.pointerId);tile.classList.add('dragging');};
  tile.onpointermove=e=>{if(drag?.id!==e.pointerId)return;tile.style.transform=`translate(${e.clientX-drag.x}px,${e.clientY-drag.y}px)`;target?.classList.remove('drop-target');target=hit(e);target?.classList.add('drop-target');};
  tile.onpointerup=e=>{if(drag?.id!==e.pointerId)return;const destination=hit(e);const to=destination?Number(destination.dataset.slot):index;clear();if(tile.hasPointerCapture(e.pointerId))tile.releasePointerCapture(e.pointerId);swap(index,to);};
  tile.onpointercancel=tile.onlostpointercapture=clear;
  tile.onkeydown=e=>{if(!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const to=index+(e.key==='ArrowLeft'?-1:1);if(to>=0&&to<5)swap(index,to);};board.append(tile);
 });update();};
 confirm.onclick=async()=>{if(confirm.disabled)return;sending=true;board.inert=true;update();try{await complete();}catch(error){status.textContent=error.message||'尚未記錄成功，請重試。';}finally{sending=false;board.inert=false;confirm.disabled=!solvedMemoryOrder(order);}};
 container.append(board,status,confirm);paint();
}
