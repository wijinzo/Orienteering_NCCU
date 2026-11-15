import {storyNode as node,storyButton as button} from './story-ui.js';
let active=null;
export function closeJourneyViewer(){active?.close();}
export function openJourneyViewer({title,kind='replay',closeLabel='收起',onClose=()=>{},dismissible=true}){
 closeJourneyViewer();const previous=document.activeElement,root=node('section',undefined,'journey-viewer');root.dataset.kind=kind;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label',title);root.tabIndex=-1;
 const stage=node('div',undefined,'journey-viewer-stage'),header=node('header',undefined,'game-header'),heading=node('h1',title),body=node('div',undefined,'game-body'),status=node('p','','viewer-status');status.setAttribute('role','status');
 let disposed=false;const cleanups=[];
 const close=()=>{if(disposed)return;disposed=true;for(const fn of cleanups)fn();root.remove();if(active?.root===root)active=null;document.body.classList.remove('journey-viewer-open');document.querySelector('.app-shell').inert=!!document.querySelector('#checkpoint-overlay:not([hidden]),.sighting-viewer,.memory-viewer');onClose();if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true});};
 const exit=button(closeLabel,close);exit.className='text-button';exit.hidden=!dismissible;header.append(heading,exit);stage.append(header,body,status);root.append(stage);document.body.append(root);document.body.classList.add('journey-viewer-open');document.querySelector('.app-shell').inert=true;
 root.onkeydown=e=>{if(e.key==='Escape'&&dismissible){e.preventDefault();close();}if(e.key==='Tab'){const controls=[...root.querySelectorAll('button:not(:disabled),input,a[href]')].filter(el=>el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===root)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===root)){e.preventDefault();first?.focus();}}};
 active={root,stage,body,status,close,onDispose:fn=>cleanups.push(fn)};root.focus({preventScroll:true});return active;
}
window.addEventListener('team-checkpoint-activated',closeJourneyViewer);
window.addEventListener('team-choice-opened',closeJourneyViewer);
window.addEventListener('journey-stopped',closeJourneyViewer);
