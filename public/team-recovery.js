import {storyNode as node,storyButton as button} from './story-ui.js';
export function recoverySeconds(deadline,now=Date.now()){return deadline?Math.max(0,Math.ceil((Date.parse(deadline)-now)/1000)):null;}
export function pinballWaitText(run,now=Date.now()){
 if(run.phase!=='play')return run.skipped?'本輪等待已結束，你未提交的成績不計入。':run.skipped_count?`本輪已完成 ${run.completed_count}／${run.total} 人，略過 ${run.skipped_count} 位未提交隊員。`:`全隊完成 ${run.completed_count}／${run.total} 人`;
 const seconds=recoverySeconds(run.skip_at,now);
 return seconds===null?'第一位隊員完成提交後，其餘隊員仍有 90 秒完成。':seconds>0?`第一位隊員已完成，剩 ${seconds} 秒；時間到後略過未提交隊員。`:'90 秒等待已結束，正在確認本輪結果…';
}
export function updateRecoveryClocks(root,run,now){
 root.querySelectorAll('[data-pinball-wait]').forEach(item=>{const text=pinballWaitText(run,now);if(item.textContent!==text)item.textContent=text;});
 root.querySelectorAll('[data-photo-recovery-clock]').forEach(item=>{const seconds=recoverySeconds(run.recovery?.available_at,now);item.textContent=seconds===null?'選擇對話、開始搜尋後才開始計時。':seconds>0?`再 ${seconds} 秒開放接手；仍需找到全部奶蛙。`:'已滿 90 秒，可申請接手未完成照片。';});
}
export function mountPhotoRecovery(container,{run,team,player,leader,busy,submit,now}){
 const recovery=run.recovery;if(!recovery)return;
 const panel=node('details',undefined,'team-recovery'),summary=node('summary','照片接手'),pending=recovery.handoffs.filter(item=>item.status==='pending');
 if(pending.length)summary.textContent=`照片接手 · ${pending.length} 筆待確認`;
 panel.append(summary);const clock=node('p',undefined,'stage-note');clock.dataset.photoRecoveryClock='true';panel.append(clock);
 if(recovery.available){
  panel.append(node('p',`${recovery.self_confirm_allowed?'兩人小隊可由隊長自行確認接手。':'隊長提出、另一名隊員確認。'}接手者需先找完手上的照片，照片仍要實際找到才算完成。`,'field-help'));
  const name=id=>{const member=team?.members.find(item=>item.id===id);return member?.name||member?.code||'隊員';};
  for(const item of recovery.handoffs.slice(-6)){
   const row=node('section',undefined,'recovery-record');row.append(node('p',`照片 ${item.photo}：${name(item.from_player)} → ${name(item.to_player)}（${{pending:'待確認',approved:'已接手',cancelled:'已取消'}[item.status]}）`));
   if(item.status==='pending'){
    if(leader){const cancel=button('取消申請',()=>submit('handoff_cancel',{handoff_id:item.id}));cancel.disabled=busy;row.append(cancel);}
    if((!leader&&player.id!==item.proposer)||(leader&&recovery.self_confirm_allowed)){const accept=button('確認接手安排',()=>{if(confirm(`確認將照片 ${item.photo} 交給 ${name(item.to_player)}？仍需實際找出照片中的奶蛙。`))submit('handoff_confirm',{handoff_id:item.id});});accept.disabled=busy;row.append(accept);}
   }else if(item.status==='approved')row.append(node('small',`提出：${name(item.proposer)} · 確認：${name(item.confirmed_by)}`));
   panel.append(row);
  }
  const photos=recovery.photos.filter(photo=>!photo.found&&photo.assigned_to&&!pending.some(item=>item.photo===photo.photo));
  const available=team?.members.filter(member=>!recovery.photos.some(photo=>!photo.found&&photo.assigned_to===member.id))??[];
  if(leader&&photos.length&&available.length){
   const form=node('form',undefined,'recovery-form'),photoLabel=node('label','未完成照片'),photoSelect=node('select'),targetLabel=node('label','接手隊員'),targetSelect=node('select');
   photoSelect.id='recovery-photo';targetSelect.id='recovery-player';photoLabel.htmlFor=photoSelect.id;targetLabel.htmlFor=targetSelect.id;photoSelect.required=targetSelect.required=true;
   for(const photo of photos){const option=node('option',`照片 ${photo.photo} · ${name(photo.assigned_to)}`);option.value=photo.photo;photoSelect.append(option);}
   for(const member of available){const option=node('option',name(member.id));option.value=member.id;targetSelect.append(option);}
   const send=button('提出接手申請');send.type='submit';send.disabled=busy;photoSelect.disabled=targetSelect.disabled=busy;
   form.append(photoLabel,photoSelect,targetLabel,targetSelect,send);form.onsubmit=event=>{event.preventDefault();submit('handoff_request',{photo:Number(photoSelect.value),to_player:targetSelect.value});};panel.append(form);
  }else if(leader&&!available.length)panel.append(node('p','先找到自己手上的奶蛙，才能安排接手其他照片。','field-help'));
 }
 container.append(panel);updateRecoveryClocks(panel,run,now);
}
