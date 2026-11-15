// Local simulation: only completion is submitted to the server.
export const PINBALL_HP=8;
export function initialPinballState(stored,choice){
 const valid=Array.isArray(stored?.hp)&&stored.hp.length===4&&stored.hp.every(n=>Number.isInteger(n)&&n>=0&&n<=PINBALL_HP);
 const shots=Number.isInteger(stored?.shots)&&stored.shots>=0?stored.shots:0;
 const hp=valid?[...stored.hp]:[PINBALL_HP,PINBALL_HP,PINBALL_HP,PINBALL_HP];
 if(choice==='care'&&!stored?.effectApplied)for(let i=0;i<hp.length;i++)hp[i]=Math.max(0,hp[i]-1);
 return {hp,shots,effectApplied:true,boostAvailable:choice==='egg'&&(typeof stored?.boostAvailable==='boolean'?stored.boostAvailable:shots===0)};
}
export function startPinballShot(state){
 return {...state,shots:state.shots+1,boostAvailable:false,damage:state.boostAvailable?2:1};
}
export function mountPinball(container,{load,save,complete,choice}){
 const W=360,H=490,origin={x:180,y:408};
 const initial=initialPinballState(load(),choice);let hp=initial.hp,boostAvailable=initial.boostAvailable,shotDamage=1;
 let shots=initial.shots,active=false,elapsed=0,angle=0,drag=null,last=0,frame=0,submitted=false;
 const enemies=[{x:85,y:125},{x:275,y:125},{x:100,y:270},{x:265,y:285}].map((e,i)=>({...e,hp:hp[i],cool:0}));
 let ball={...origin,vx:0,vy:0};
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let particles=[],floating=[],trail=[],combo=0,hitPause=0,shake=0,clearDelay=0,pull={x:0,y:0};
 const circle=(x,y,r,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();};
 const impact=(e,damage)=>{
  combo++;e.flash=.12;hitPause=32;shake=reduced.matches?0:4;
  floating.push({x:e.x,y:e.y-30,text:e.hp?`命中 −${damage}`:'擊倒！',life:.8});
  if(!reduced.matches)for(let i=0;i<(e.hp?12:22);i++){const a=Math.random()*Math.PI*2,speed=40+Math.random()*130;particles.push({x:e.x,y:e.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:.35,color:e.hp?'#b4864c':'#5a7c6b'});}
 };
 const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const root=el('div');root.className='pinball';const status=el('p');status.className='find-instruction';status.setAttribute('aria-live','polite');
 const canvas=el('canvas');canvas.width=W;canvas.height=H;canvas.tabIndex=0;canvas.setAttribute('aria-label','向後拉動奶蛋，放開朝反方向發射，也可以用方向滑桿和發射按鈕');
 const ctx=canvas.getContext('2d');const controls=el('div');controls.className='pinball-controls';
 const label=el('label','發射方向');const slider=el('input');slider.type='range';slider.min=-70;slider.max=70;slider.value=0;label.append(slider);
 const launch=el('button','發射奶蛋'),recall=el('button','召回'),retry=el('button','記錄完成');for(const b of [launch,recall,retry])b.type='button';retry.hidden=true;
 controls.append(label,launch,recall,retry);const help=el('p','向後拉動奶蛋，放手發射！');help.className='find-instruction';
 const board=el('div');board.className='pinball-board';board.append(canvas);
 enemies.forEach(e=>{const image=el('img');image.className='pinball-frog';image.alt='';image.draggable=false;image.hidden=e.hp===0;image.style.left=`${(e.x-29)/W*100}%`;image.style.top=`${(e.y-29)/H*100}%`;image.onload=()=>{e.spriteReady=true;};image.onerror=()=>{e.spriteReady=false;image.hidden=true;};image.src=reduced.matches?'/assets/characters/naifrog.png':'/assets/checkpoint3/frog.gif';e.sprite=image;board.append(image);});
 const bonus=el('p');bonus.className='pinball-bonus';bonus.hidden=choice==='practice';bonus.setAttribute('role','status');root.append(status,bonus,help,board,controls);container.append(root);
 const frog=new Image(),egg=new Image();frog.src='/assets/characters/naifrog.png';egg.src='/assets/checkpoint3/naiegg_ball.png';
 const persist=()=>save({hp:enemies.map(e=>e.hp),shots,effectApplied:true,boostAvailable});
 const cleared=()=>enemies.every(e=>e.hp===0);
 const updateUi=()=>{status.textContent=cleared()?'奶蛙都清完了！':`第 ${Math.floor(shots/3)+1} 輪 · 本輪剩餘 ${3-shots%3} 次發射`;bonus.textContent=choice==='care'?'奶蛋的威壓：全體奶蛙已減少 1 點生命':boostAvailable?'奶蛋生氣了！下一次彈射傷害 ×2':active&&shotDamage===2?'憤怒彈射！本次傷害 ×2':'憤怒加成已使用';launch.disabled=active||cleared();recall.disabled=!active;slider.disabled=active||cleared();};
 const report=()=>{if(submitted)return;submitted=true;retry.hidden=true;Promise.resolve().then(()=>complete({shots})).catch(()=>{submitted=false;if(root.isConnected){retry.hidden=false;status.textContent='完成記錄尚未送出，請重試。';}});};
 const finish=()=>{active=false;drag=null;pull={x:0,y:0};ball={...origin,vx:0,vy:0};persist();updateUi();if(cleared())report();};
 const fire=()=>{if(active||cleared())return;const shot=startPinballShot({shots,boostAvailable});shots=shot.shots;boostAvailable=shot.boostAvailable;shotDamage=shot.damage;active=true;elapsed=0;combo=0;trail=[];pull={x:0,y:0};ball={...origin,vx:Math.sin(angle)*820,vy:-Math.cos(angle)*820};persist();updateUi();};
 launch.onclick=fire;recall.onclick=finish;retry.onclick=report;slider.oninput=()=>{angle=Number(slider.value)*Math.PI/180;};
 const point=e=>{const b=canvas.getBoundingClientRect();return{x:(e.clientX-b.left)*W/b.width,y:(e.clientY-b.top)*H/b.height};};
 const aim=e=>{const p=point(e),dx=p.x-drag.x,dy=p.y-drag.y,length=Math.hypot(dx,dy),scale=Math.min(1,65/Math.max(length,1));pull={x:dx*scale,y:dy*scale};if(length>4){angle=Math.max(-70*Math.PI/180,Math.min(70*Math.PI/180,Math.atan2(-dx,Math.max(8,dy))));slider.value=String(Math.round(angle*180/Math.PI));}};
 canvas.onpointerdown=e=>{if(active||cleared()||!e.isPrimary||e.button!==0)return;drag={id:e.pointerId,...point(e)};canvas.setPointerCapture(e.pointerId);};
 canvas.onpointermove=e=>{if(drag?.id===e.pointerId)aim(e);};
 canvas.onpointerup=e=>{if(drag?.id!==e.pointerId)return;aim(e);const distance=Math.hypot(pull.x,pull.y);drag=null;pull={x:0,y:0};if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(distance>=8)fire();};canvas.onpointercancel=canvas.onlostpointercapture=()=>{drag=null;pull={x:0,y:0};};
 canvas.onkeydown=e=>{if(['ArrowLeft','ArrowRight',' '].includes(e.key)){e.preventDefault();if(e.key===' ')fire();else if(!active){slider.value=String(Math.max(-70,Math.min(70,Number(slider.value)+(e.key==='ArrowLeft'?-5:5))));slider.oninput();}}};
 const draw=()=>{
  ctx.save();board.style.transform=shake&&!reduced.matches?`translate(${(Math.random()-.5)*shake*2}px,${(Math.random()-.5)*shake*2}px)`:'';
  ctx.fillStyle='#f8f1e3';ctx.fillRect(0,0,W,H);ctx.strokeStyle='#59758d';ctx.lineWidth=5;ctx.strokeRect(9,9,W-18,H-18);
  enemies.forEach(e=>{e.sprite.hidden=!e.hp||!e.spriteReady;e.sprite.classList.toggle('hit',!!e.flash&&!reduced.matches);if(!e.hp)return;const size=e.flash&&!reduced.matches?64:58;if(e.flash)circle(e.x,e.y,34,'#f5d89a');if(!e.spriteReady){if(frog.complete&&frog.naturalWidth)ctx.drawImage(frog,e.x-size/2,e.y-size/2,size,size);else circle(e.x,e.y,25,'#91a98c');}ctx.fillStyle='#d8d4c9';ctx.fillRect(e.x-28,e.y-40,56,7);ctx.fillStyle=e.flash?'#b4864c':'#5a7c6b';ctx.fillRect(e.x-28,e.y-40,56*e.hp/PINBALL_HP,7);ctx.fillStyle='#32485c';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText(`${e.hp}/${PINBALL_HP}`,e.x,e.y-47);});
  if(!active&&!cleared()){ctx.setLineDash([5,7]);ctx.strokeStyle='#b4864c';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(origin.x,origin.y);ctx.lineTo(origin.x+Math.sin(angle)*100,origin.y-Math.cos(angle)*100);ctx.stroke();ctx.setLineDash([]);}
  if(!reduced.matches)trail.forEach((p,i)=>{ctx.globalAlpha=i/Math.max(1,trail.length)*.4;circle(p.x,p.y,7,'#b4864c');});ctx.globalAlpha=1;
  const bx=ball.x+pull.x,by=ball.y+pull.y;
  if(drag){ctx.strokeStyle='#b4864c';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(origin.x-23,origin.y);ctx.lineTo(bx,by);ctx.lineTo(origin.x+23,origin.y);ctx.stroke();}
  if(egg.complete&&egg.naturalWidth)ctx.drawImage(egg,bx-16,by-16,32,32);else circle(bx,by,13,'#e6b965');
  particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life/.35);circle(p.x,p.y,2.5,p.color);});ctx.globalAlpha=1;
  ctx.textAlign='center';ctx.font='bold 18px sans-serif';floating.forEach(f=>{ctx.globalAlpha=Math.min(1,f.life*3);ctx.fillStyle='#735023';ctx.fillText(f.text,f.x,f.y);});ctx.globalAlpha=1;
  if(combo>=2){ctx.fillStyle='#735023';ctx.font='bold 23px sans-serif';ctx.fillText(`COMBO ×${combo}`,W/2,48);}
  ctx.restore();
 };
 const tick=time=>{
  if(!root.isConnected){cancelAnimationFrame(frame);return;}
  const dt=document.hidden||root.closest('[hidden]')?0:Math.min(last?time-last:0,40);last=time;
  enemies.forEach(e=>e.flash=Math.max(0,(e.flash||0)-dt/1000));shake=Math.max(0,shake-dt*.04);
  particles=particles.filter(p=>(p.life-=dt/1000)>0);particles.forEach(p=>{p.x+=p.vx*dt/1000;p.y+=p.vy*dt/1000;});floating=floating.filter(f=>(f.life-=dt/1000)>0);floating.forEach(f=>{if(!reduced.matches)f.y-=dt*.025;});
  if(active&&cleared()){clearDelay+=dt;if(clearDelay>=650)finish();}
  else if(active&&hitPause>0){hitPause=Math.max(0,hitPause-dt);}
  else if(active){elapsed+=dt;const steps=Math.max(1,Math.ceil(dt/3)),step=dt/steps/1000;
   for(let n=0;n<steps;n++){
    ball.x+=ball.vx*step;ball.y+=ball.vy*step;
    if(ball.x<24){ball.x=24;ball.vx=Math.abs(ball.vx);}if(ball.x>W-24){ball.x=W-24;ball.vx=-Math.abs(ball.vx);}if(ball.y<24){ball.y=24;ball.vy=Math.abs(ball.vy);}if(ball.y>H-24){ball.y=H-24;ball.vy=-Math.abs(ball.vy);}
    enemies.forEach(e=>{e.cool=Math.max(0,e.cool-step);if(!e.hp)return;const dx=ball.x-e.x,dy=ball.y-e.y,d=Math.hypot(dx,dy);if(d>=39)return;const nx=d?dx/d:0,ny=d?dy/d:-1;ball.x=e.x+nx*39.1;ball.y=e.y+ny*39.1;const dot=ball.vx*nx+ball.vy*ny;if(dot>=0)return;ball.vx-=2*dot*nx;ball.vy-=2*dot*ny;if(!e.cool){const damage=Math.min(e.hp,shotDamage);e.hp=Math.max(0,e.hp-shotDamage);e.cool=.14;impact(e,damage);persist();}});
   }
   if(!reduced.matches){trail.push({x:ball.x,y:ball.y});if(trail.length>14)trail.shift();}
   if(elapsed>=5000&&!cleared())finish();
  }
  draw();frame=requestAnimationFrame(tick);
 };
 persist();updateUi();frame=requestAnimationFrame(tick);if(cleared())retry.hidden=false;
}
