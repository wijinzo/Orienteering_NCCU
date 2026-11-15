import {ACHIEVEMENTS,elapsedText,achievementProgress} from './achievement-data.js';
import {storyNode as node} from './story-ui.js';
let api,player,result=null,version=0,busy=false,dirty=false,delay,ticker,toastTimer,toast,baseline=false,seen=new Set(),clock=0,anchor=0;
const key=()=>`memory:achievements:${player?.id}`;
function announce(items){
 if(!items.length)return;toast?.remove();clearTimeout(toastTimer);toast=node('aside',undefined,'achievement-toast');toast.setAttribute('role','status');toast.append(node('small','新成就解鎖'),node('strong',items.map(item=>item.name).join('、')));document.body.append(toast);toastTimer=setTimeout(()=>{toast?.remove();toast=null;},4500);
}
function renderTiming(){
 const panel=document.getElementById('achievement-timing');if(!panel||!result)return;const timing=result.timing??{},current=clock+(performance.now()-anchor),finish=timing.finished_at?Date.parse(timing.finished_at):current;
 const date=value=>value?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'—';
 const elapsed=elapsedText(timing.started_at,finish);
 const values=[['開始探索',date(timing.started_at)],['完成時間',timing.finished_at?date(timing.finished_at):'尚未完成'],[timing.finished_at?'總耗時':'目前耗時',elapsed]];
 // Only the local duration changes each second; no polling request is made by this clock.
 if(panel.dataset.started===String(timing.started_at)&&panel.dataset.finished===String(timing.finished_at)){panel.querySelector('[data-duration]').textContent=elapsed;return;}
 panel.dataset.started=String(timing.started_at);panel.dataset.finished=String(timing.finished_at);panel.replaceChildren();const list=node('dl',undefined,'achievement-times');values.forEach(([label,value],index)=>{const row=node('div');const text=node('dd',value);if(index===2)text.dataset.duration='true';row.append(node('dt',label),text);list.append(row);});panel.append(list);
}
function render(){
 const list=document.getElementById('achievement-list');if(!list)return;list.replaceChildren();list.setAttribute('role','list');
 for(const [index,item] of ACHIEVEMENTS.entries()){
  const value=result?.achievements.find(value=>value.code===item.code),card=node('section',undefined,'achievement-card');card.dataset.achievement=item.code;card.dataset.unlocked=String(!!value?.unlocked);card.setAttribute('role','listitem');
  const badge=node('span',value?.unlocked?'✓':String(index+1).padStart(2,'0'),'achievement-badge');badge.setAttribute('aria-hidden','true');const copy=node('div');copy.append(node('span',item.scope,'achievement-scope'),node('h3',item.name),node('p',item.description),node('strong',achievementProgress(value),'achievement-progress'));card.append(badge,copy);list.append(card);
 }renderTiming();
}
async function refresh({explicit=false}={}){
 if(!player)return;if(document.hidden||busy){dirty=true;return;}busy=true;dirty=false;const expected=version,status=document.getElementById('achievement-status'),button=document.getElementById('achievement-refresh');button.disabled=true;if(explicit)status.textContent='正在找回成就…';
 try{const data=await api('/api/achievements',{wait:explicit,waitLabel:'正在找回你的成就…'});if(expected!==version)return;result=data;clock=Date.parse(data.server_time);anchor=performance.now();
  const unlocked=data.achievements.filter(item=>item.unlocked).map(item=>item.code),fresh=ACHIEVEMENTS.filter(item=>unlocked.includes(item.code)&&!seen.has(item.code));if(baseline)announce(fresh);for(const code of unlocked)seen.add(code);baseline=true;try{localStorage.setItem(key(),JSON.stringify([...seen]));}catch{}
  render();status.textContent=`已解鎖 ${unlocked.length}／${ACHIEVEMENTS.length} 個成就`;
 }catch{if(expected===version)status.textContent='成就暫時無法載入，請稍後按「更新成就」重試。';}
 finally{if(expected===version){busy=false;button.disabled=false;if(dirty&&!document.hidden)schedule();}}
}
function schedule(){if(!player)return;dirty=true;clearTimeout(delay);delay=setTimeout(()=>refresh(),350);}
export function startAchievements(client,currentPlayer){stopAchievements();api=client;player=currentPlayer;try{seen=new Set(JSON.parse(localStorage.getItem(key())??'[]'));}catch{seen=new Set();}render();refresh();ticker=setInterval(()=>{if(!document.hidden)renderTiming();},1000);}
export function stopAchievements(){version++;clearTimeout(delay);clearTimeout(toastTimer);clearInterval(ticker);toast?.remove();toast=null;player=null;result=null;busy=false;dirty=false;baseline=false;seen=new Set();const timing=document.getElementById('achievement-timing');if(timing){timing.replaceChildren();delete timing.dataset.started;delete timing.dataset.finished;}}
document.getElementById('achievement-refresh').onclick=()=>refresh({explicit:true});
window.addEventListener('journey-stopped',stopAchievements);
for(const event of ['achievement-check','checkpoint-progress','checkpoint-state','opening-complete'])window.addEventListener(event,schedule);
window.addEventListener('journey-tab',event=>{if(event.detail==='records')refresh();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});window.addEventListener('online',()=>refresh());
