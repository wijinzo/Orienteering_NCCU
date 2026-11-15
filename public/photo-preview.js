// A local preview: countdown begins after the image is decoded and pauses off screen.
export function mountPhotoPreview(container,{src,seconds,read,write,complete}){
 const root=document.createElement('section');root.className='photo-preview';
 const image=document.createElement('img');image.className='puzzle-photo';image.alt='老照片完整預覽';
 const status=document.createElement('p');status.className='stage-note';status.setAttribute('role','status');status.textContent='正在找回完整照片…';
 const retry=document.createElement('button');retry.type='button';retry.textContent='重新載入照片';retry.hidden=true;
 let left=Number(read('puzzle-preview-left',String(seconds*1000)));if(!Number.isFinite(left)||left<0||left>seconds*1000)left=seconds*1000;
 let frame=0,last=0,lastSaved=-1,wasVisible=false;
 const tick=now=>{
  if(!root.isConnected){cancelAnimationFrame(frame);return;}
  const elapsed=last?Math.min(now-last,200):0;last=now;
  const visible=!document.hidden&&!root.closest('[hidden]');
  if(visible&&wasVisible)left=Math.max(0,left-elapsed);wasVisible=visible;
  const whole=Math.ceil(left/1000);status.textContent=`趁奶龍還記得，看看原本的照片！${whole} 秒`;
  if(whole!==lastSaved){write('puzzle-preview-left',left);lastSaved=whole;}
  if(left===0){write('puzzle-preview-left',0);write('puzzle-preview-done','1');complete();return;}
  frame=requestAnimationFrame(tick);
 };
 image.onload=async()=>{await image.decode().catch(()=>{});if(!root.isConnected)return;retry.hidden=true;last=0;cancelAnimationFrame(frame);frame=requestAnimationFrame(tick);};
 image.onerror=()=>{cancelAnimationFrame(frame);status.textContent='照片還沒載入成功，請重試。';retry.hidden=false;};
 retry.onclick=()=>{retry.hidden=true;status.textContent='正在找回完整照片…';image.src=src+'?retry='+Date.now();};
 root.append(image,status,retry);container.append(root);image.src=src;
}
