import {createWaitFrog} from './network-wait.js';
import {choiceResultSeen,mountChoiceResult} from './choice-result.js';
// Labels mirror the actual scene options. No totals or other players' choices reach the client.
export const STORY_OPTIONS={
 '1:intro':[['genius','政大小天才就是我們！'],['hint','如果答不出來，你會提示嗎？']],
 '2:intro':[['ask','你就不能直接告訴我們嗎？'],['ready','好吧，讓我們看看題目！']],
 '3:intro':[['egg','真的要把奶蛋彈出去嗎？'],['care','奶蛋，你還好嗎？']],
 '5:intro':[['help','猜密碼也能認識校史？'],['tease','你是不是又想考倒我們？']],
 '5:ending':[['history','1998 年，究竟發生了什麼？'],['continue','先記下來，我們繼續找碎片。']],
 '7:intro':[['help','別慌，我們先找最早的，其他張你抱好！'],['tease','這些事件全混在一起了，先找最近的吧？']],
 '9:intro':[['tease','連樓層都忘了？你還好嗎？'],['help','交給我們，現場確認最準！']],
 '10:guess':[['nailong','奶龍'],['pikachu','皮卡丘'],['duck','黃色小鴨'],['egg','一顆忘記孵化的蛋']],
 '10:reflection':[['campus','原來每天經過的校園，藏著這樣的故事。'],['remember','還好這段記憶沒有真的消失。'],['mine','我也有一段想留下的政大回憶。']],
 '11:intro':[['question','你怎麼連自己的守護力量都弄丟了？'],['promise','六隻奶蛙，交給我們！']],
 '12:intro':[['tease','你還記得什麼線索嗎？'],['help','拿來吧，我們一起看看。']],
 '13:intro':[['help','放心，我們幫你拼回來。'],['tease','你真的連自己找到的照片都忘了？']]
};
const OPTIONS=STORY_OPTIONS;
export function updateVoteCountdown(ballot,serverNow=Date.now()){
 for(const clock of document.querySelectorAll('#story-vote-panel .story-vote-countdown,#story-vote-notice .story-vote-countdown')){
  if(ballot?.phase!=='open'||!ballot.deadline){clock.textContent='隊長選擇後，開始 10 秒確認時間';clock.dataset.urgent='false';continue;}
  const seconds=Math.max(0,Math.ceil((Date.parse(ballot.deadline)-serverNow)/1000));clock.textContent=seconds?`剩餘 ${seconds} 秒`:'正在確認結果…';clock.dataset.urgent=String(seconds>0&&seconds<=3);
 }
}
export function hasPendingChoiceResult(run){
 const result=run?.choice_result;
 return !!result&&!choiceResultSeen(result.id)&&!(run.checkpoint===10&&run.my_read)&&!run.ballot&&(!run.vote_slot||run.vote_slot===result.slot);
}
function renderChoiceResult(run,visible,solo=false){
 let card=document.getElementById('story-choice-result');const result=run?.choice_result;
 if(!visible||!hasPendingChoiceResult(run)){card?.remove();return;}
 if(card?.dataset.result===result.id)return;
 card?.remove();
 const options=OPTIONS[`${run.checkpoint}:${result.slot}`]??[],label=options.find(([id])=>id===result.choice)?.[1]??result.choice;
 mountChoiceResult(document.querySelector('.checkpoint-stage'),{id:result.id,label,solo,myLabel:options.find(([id])=>id===result.my_choice)?.[1],onConfirm:()=>window.dispatchEvent(new Event('choice-result-confirmed'))});
}
export function renderStoryVote({run,visible,inFlight,submit,leader=false,solo=false,serverNow=Date.now()}){
 renderChoiceResult(run,visible,solo);
 updateVoteCountdown(run?.ballot,serverNow);
 let panel=document.getElementById('story-vote-panel'),notice=document.getElementById('story-vote-notice');const ballot=run?.ballot;
 const controls=document.querySelector('#game-body .story-controls'),atOptions=controls?.querySelectorAll('button:not(.story-next)').length>1;
 let hint=document.getElementById('story-vote-leader-hint');
 if(visible&&leader&&!solo&&atOptions&&run?.vote_slot&&ballot?.phase!=='open'){
  if(!hint){hint=document.createElement('p');hint.id='story-vote-leader-hint';hint.className='story-vote-leader-hint';hint.textContent='選擇任一選項後，全隊會進入 10 秒投票。請先確認隊員都準備好了。';controls.before(hint);}
 }else hint?.remove();
 if(ballot?.phase==='open'&&!visible){
  panel?.remove();if(!notice){notice=document.createElement('aside');notice.id='story-vote-notice';notice.className='story-vote-notice';notice.setAttribute('role','status');const label=document.createElement('span');label.textContent='隊伍正在確認選擇';const clock=document.createElement('strong');clock.className='story-vote-countdown';notice.append(label,clock);}notice.classList.toggle('story-vote-notice-floating',!visible);if(visible)document.querySelector('.game-header').after(notice);else document.body.append(notice);updateVoteCountdown(ballot,serverNow);return;
 }
 notice?.remove();
 if(!atOptions&&ballot?.phase!=='open'){panel?.remove();return;}
 if(!visible||!ballot||!OPTIONS[`${run.checkpoint}:${run.vote_slot}`]){panel?.remove();return;}
 // Before the captain picks, only players who already selected see their waiting state.
 if(ballot.phase==='waiting'&&!ballot.my_choice){panel?.remove();return;}
 const key=[ballot.id,ballot.phase,ballot.my_choice,inFlight].join(':');if(panel?.dataset.key===key)return;
 const focus=panel?.contains(document.activeElement)?document.activeElement?.dataset.choice:null;
 if(!panel){panel=document.createElement('section');panel.id='story-vote-panel';panel.className='story-vote-panel';document.querySelector('.checkpoint-stage').append(panel);}
 panel.dataset.key=key;panel.replaceChildren();panel.setAttribute('aria-label','確認隊伍選擇');
 const status=document.createElement('p');status.className='story-vote-status';status.setAttribute('role','status');status.textContent='此對話會影響後續關卡，正在確認大家的選擇…';const waiting=document.createElement('div');waiting.className='story-vote-wait';waiting.append(createWaitFrog(),status);panel.append(waiting);const countdown=document.createElement('p');countdown.className='story-vote-countdown';panel.append(countdown);updateVoteCountdown(ballot,serverNow);
 for(const [choice,label] of OPTIONS[`${run.checkpoint}:${run.vote_slot}`]){
  const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.choice=choice;button.disabled=inFlight||!!ballot.my_choice;button.setAttribute('aria-pressed',String(ballot.my_choice===choice));
  button.onclick=()=>{panel.dataset.key='';button.setAttribute('aria-pressed','true');panel.querySelectorAll('button').forEach(b=>b.disabled=true);submit(run.vote_slot==='guess'?'guess':run.vote_slot==='reflection'?'reflect':'choose',choice);};panel.append(button);
 }
 const note=document.createElement('p');note.className='stage-note';note.textContent=ballot.my_choice?(ballot.phase==='waiting'?'已收到你的選擇，等待隊長確認。':'已收到你的選擇，正在確認結果。'):'選一個你想說的回應。';panel.append(note);
 if(focus)panel.querySelector(`[data-choice="${focus}"]`)?.focus({preventScroll:true});
}
