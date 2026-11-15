import {storyNode as node,storyButton as button} from './story-ui.js';
const confirmed=new Set();
export function choiceResultSeen(id){
 if(confirmed.has(id))return true;
 try{return localStorage.getItem('memory:choice-result:'+id)==='true';}catch{return false;}
}
export function mountChoiceResult(container,{id,label,myLabel,onConfirm=()=>{},elementId='story-choice-result'}){
 const panel=node('section',undefined,'story-choice-result');panel.id=elementId;panel.dataset.result=id;panel.setAttribute('role','alertdialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','隊伍選擇結果');
 panel.append(node('h2','大家的選擇已確認'),node('p','本次採用'),node('blockquote',label,'choice-result-label'));
 if(myLabel&&myLabel!==label)panel.append(node('p',`你選的是「${myLabel}」，這次依隊伍的共同選擇繼續。`,'choice-result-mine'));
 const proceed=button('繼續對話',()=>{confirmed.add(id);try{localStorage.setItem('memory:choice-result:'+id,'true');}catch{}panel.remove();onConfirm();});proceed.className='primary-button';panel.append(proceed);
 panel.onkeydown=event=>{if(event.key==='Tab'){event.preventDefault();event.stopPropagation();proceed.focus();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();proceed.click();}};
 container.append(panel);proceed.focus({preventScroll:true});return panel;
}
