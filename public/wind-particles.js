// Reusable wind dissolve, bounded for mobile devices. Returns an explicit disposer.
export function windDissolve(element,snapshot){
 let frame=0,cancelled=false,settled=false,resolve;const finished=new Promise(done=>{resolve=done;});const canvas=document.createElement('canvas');canvas.className='sighting-wind';canvas.setAttribute('aria-hidden','true');const stage=element.parentElement;stage.append(canvas);
 const clear=()=>{cancelAnimationFrame(frame);canvas.remove();element.style.clipPath='';element.style.opacity='';};
 const settle=value=>{if(settled)return;settled=true;clear();resolve(value);};
 const run=async()=>{try{
  const source=await snapshot();if(cancelled)return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){await element.animate([{opacity:1},{opacity:0}],{duration:350,fill:'forwards'}).finished;if(!cancelled)settle(true);return;}
  const r=element.getBoundingClientRect(),parent=stage.getBoundingClientRect();canvas.width=Math.ceil(parent.width);canvas.height=Math.ceil(parent.height);const ctx=canvas.getContext('2d');const pixels=source.getContext('2d').getImageData(0,0,source.width,source.height).data;const step=Math.max(5,Math.ceil(Math.sqrt(source.width*source.height/1500))),points=[];
  for(let y=0;y<source.height;y+=step)for(let x=0;x<source.width;x+=step){const i=(y*source.width+x)*4;if(pixels[i+3]<20||Math.max(pixels[i],pixels[i+1],pixels[i+2])<45)continue;points.push({x:x+r.left-parent.left,y:y+r.top-parent.top,delay:x/source.width*.7,color:`rgb(${pixels[i]} ${pixels[i+1]} ${pixels[i+2]})`,speed:.7+Math.random()*.6,rise:30+Math.random()*100,phase:Math.random()*6});}
  let start=null;const tick=now=>{if(cancelled)return;if(start===null)start=now;const progress=Math.min(1,(now-start)/2800);ctx.clearRect(0,0,canvas.width,canvas.height);element.style.clipPath=`inset(0 0 0 ${Math.min(1,progress/.7)*100}%)`;
   for(const p of points){if(progress<p.delay)continue;const t=Math.min(1,(progress-p.delay)/(1-p.delay));ctx.globalAlpha=(1-t)**1.4;ctx.fillStyle=p.color;const dx=t*canvas.width*p.speed,dy=-t*p.rise+Math.sin(t*6+p.phase)*t*13;ctx.fillRect(p.x+dx,p.y+dy,Math.max(1,step*(1-t)*.7),Math.max(1,step*(1-t)*.7));}
   ctx.globalAlpha=1;if(progress===1)settle(true);else frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
 }catch{if(!cancelled){element.style.opacity='0';settle(true);}}};run();
 return{finished,cancel(){cancelled=true;settle(false);}};
}
