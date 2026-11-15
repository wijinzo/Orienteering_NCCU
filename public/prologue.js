import {checkpointFromLocation} from './routing.js';
import {openJourneyViewer} from './journey-viewer.js';
import {OPENING_SCENES,OPENING_OPTIONS} from './prologue-data.js';
import {storyNode as node,storyButton as button,storyNext,renderStoryScene} from './story-ui.js';
import {createWaitFrog} from './network-wait.js';
import {choiceResultSeen,mountChoiceResult} from './choice-result.js';
let api,player,team,run,viewer,timer,ticker,epoch=0,pending=false,reading=false,cursor=0,viewKey='',serverOffset=0,request=0;
const key=part=>`memory:opening:${player?.id}:${run?.id}:${part}`;
const read=(part,fallback='')=>{try{return localStorage.getItem(key(part))??fallback;}catch{return fallback;}};
const write=(part,value)=>{try{localStorage.setItem(key(part),String(value));}catch{}};
const leader=()=>team?.leader_id===player?.id;
const introSeen=()=>{try{return localStorage.getItem(`memory:sightings:${player?.id}:intro`)==='true';}catch{return false;}};
function maybeOpen(){
 if(!player||!run||read('done')==='true'||!introSeen()||document.querySelector('.sighting-viewer')||checkpointFromLocation())return;
 // Existing teams already exploring before this feature do not get pulled into a new prologue.
 if(run.finished&&!run.choices.help){write('done',true);return;}
 if(!viewer){cursor=Math.max(0,Math.min(OPENING_SCENES.length,Number(read('cursor','0'))||0));viewer=openJourneyViewer({title:'奶龍的委託',kind:'opening',dismissible:false,onClose:()=>{viewer=null;viewKey='';}});viewKey='';}
 render();
}
function adopt(result){run=result.run;serverOffset=Date.parse(result.server_time)-Date.now();maybeOpen();render();}
async function refresh(){
 if(!player||team?.phase!=='elected'||document.hidden||pending||reading)return;
 const version=epoch,id=++request;reading=true;
 try{const result=await api('/api/prologue',{wait:!run,waitLabel:'正在準備奶龍的委託…'});if(version!==epoch||id!==request)return;adopt(result);}
 catch(error){if(version!==epoch)return;if(viewer){viewer.status.replaceChildren(node('span',error.message),button('重試',refresh));}else if(!run&&introSeen()){viewer=openJourneyViewer({title:'奶龍的委託',kind:'opening'});viewer.status.replaceChildren(node('span',error.message),button('重試',refresh));}}
 finally{if(version===epoch)reading=false;}
}
async function poll(){const version=epoch;await refresh();if(version===epoch&&player&&(!run?.finished||read('done')!=='true'&&!!run.choices.help))timer=setTimeout(poll,2000);}
async function send(action,payload={}){
 if(pending||!run)return;const version=epoch;pending=true;++request;viewKey='';render();
 try{const result=await api('/api/prologue/'+action,{method:'POST',body:{run_id:run.id,...payload},waitLabel:action==='finish'?'正在開啟探索首頁…':'正在確認大家的選擇…'});if(version!==epoch)return;adopt(result);if(action==='finish')complete();}
 catch(error){if(version===epoch&&viewer)viewer.status.textContent=error.message;}
 finally{if(version===epoch){pending=false;viewKey='';render();}}
}
function complete(){write('done',true);clearTimeout(timer);viewer?.close();window.dispatchEvent(new Event('opening-complete'));}
function advance(){cursor++;write('cursor',cursor);viewKey='';render();}
function clock(){const label=viewer?.root.querySelector('.opening-countdown');if(label&&run?.ballot?.deadline){const seconds=Math.max(0,Math.ceil((Date.parse(run.ballot.deadline)-Date.now()-serverOffset)/1000));label.textContent=seconds?`剩餘 ${seconds} 秒`:'正在確認結果…';}}
function render(){
 if(!viewer||!run)return;
 const nextKey=JSON.stringify([run,cursor,pending,leader()]);if(viewKey===nextKey){clock();return;}viewKey=nextKey;
 const body=viewer.body;body.replaceChildren();viewer.root.querySelector('.opening-ballot')?.remove();
 if(cursor>=OPENING_SCENES.length){
  if(run.finished){complete();return;}
  renderStoryScene(body,{text:leader()?'準備好了就出發！五條支線先去哪裡，由你們決定！':'本龍已經準備好了！等隊長一起出發吧。',actions:[button(leader()?'開始探索':'等待隊長出發',()=>send('finish'),true)]});body.querySelector('button').disabled=!leader()||pending;
 }else{
  const current=OPENING_SCENES[cursor];
  if(!current.slot)renderStoryScene(body,{text:current.text,character:current.speaker??'奶龍',actions:[storyNext(advance)]});
  else{
   const question=OPENING_OPTIONS[current.slot],selected=question.options.find(([id])=>id===run.choices[current.slot]);
   if(selected){renderStoryScene(body,{text:selected[2],actions:[storyNext(advance)]});}
   else{
    renderStoryScene(body,{text:question.question,actions:question.options.map(([choice,label])=>button(label,()=>send('choose',{slot:current.slot,choice})))});
    body.append(node('p',leader()?'選擇任一選項後，全隊會進入 10 秒投票。請先確認隊員都準備好了。':'各自選擇；隊長選擇後開始 10 秒確認時間。','stage-note'));
   }
  }
 }
 viewer.status.textContent=`開場 ${Math.min(cursor+1,OPENING_SCENES.length)}／${OPENING_SCENES.length}`;
 const ballot=run.ballot;
 if(ballot)viewer.root.querySelector('.story-choice-result')?.remove();
 if(ballot&&(ballot.phase==='open'||ballot.my_choice&&OPENING_SCENES[cursor]?.slot===ballot.slot)){
  const panel=node('section',undefined,'opening-ballot'),question=OPENING_OPTIONS[ballot.slot];panel.setAttribute('aria-label','確認隊伍選擇');panel.append(createWaitFrog(),node('p','此對話會影響後續關卡，正在確認大家的選擇…'),node('strong',ballot.deadline?'':'隊長選擇後開始 10 秒確認','opening-countdown'));
  for(const [choice,label] of question.options){const option=button(label,()=>send('choose',{slot:ballot.slot,choice}));option.disabled=pending||!!ballot.my_choice;if(choice===ballot.my_choice)option.textContent+='（你的選擇）';panel.append(option);}if(ballot.my_choice)panel.append(node('p','已收到你的選擇，正在等大家確認。'));viewer.stage.append(panel);clock();
 }
 if(pending)body.querySelectorAll('button').forEach(el=>el.disabled=true);
 if(!ballot){
  const slot=['help','depart'].find(slot=>run.choices[slot]&&!choiceResultSeen(`opening:${player.id}:${run.id}:${slot}`));
  if(slot&&!viewer.root.querySelector('.story-choice-result')){const selected=OPENING_OPTIONS[slot].options.find(([id])=>id===run.choices[slot]);mountChoiceResult(viewer.stage,{elementId:'opening-choice-result',id:`opening:${player.id}:${run.id}:${slot}`,label:selected[1],onConfirm:()=>{viewKey='';render();viewer?.body.querySelector('button:not(:disabled)')?.focus({preventScroll:true});}});}
 }
}
export function startPrologue(client,currentPlayer){stopPrologue();api=client;player=currentPlayer;ticker=setInterval(clock,250);}
export function stopPrologue(){epoch++;++request;clearTimeout(timer);clearInterval(ticker);viewer?.close();viewer=null;player=null;team=null;run=null;pending=false;reading=false;viewKey='';}
window.addEventListener('team-state',event=>{if(!player)return;const first=team?.phase!=='elected';team=event.detail;if(first&&team.phase==='elected'){clearTimeout(timer);poll();}});
window.addEventListener('sighting-intro-complete',()=>{maybeOpen();if(!run)refresh();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('online',refresh);
window.addEventListener('journey-stopped',stopPrologue);
