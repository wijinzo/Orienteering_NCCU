import {CREDITS_AUDIO} from './credits-data.js';
// Created and played inside the farewell/replay click, before the asynchronous wind effect.
export function createCreditsAudio({AudioClass=Audio}={}){
 const audio=new AudioClass(CREDITS_AUDIO);audio.preload='auto';audio.loop=true;
 let disposed=false,attempt=0,state={phase:'idle',muted:false};const listeners=new Set();
 const publish=phase=>{if(disposed)return;state={phase,muted:audio.muted};for(const listener of listeners)listener(state);};
 audio.onwaiting=()=>publish('loading');audio.onplaying=()=>publish('playing');audio.onerror=()=>publish('error');
 return {
  async play(){
   if(disposed)return false;if(state.phase==='playing')return true;const current=++attempt;publish('loading');
   try{if(audio.error)audio.load();await audio.play();if(disposed||current!==attempt)return false;publish('playing');return true;}
   catch(error){if(!disposed&&current===attempt)publish(error.name==='NotAllowedError'?'blocked':'error');return false;}
  },
  toggleMute(){if(disposed)return;audio.muted=!audio.muted;publish(state.phase);},
  subscribe(listener){listeners.add(listener);listener(state);return()=>listeners.delete(listener);},
  dispose(){if(disposed)return;disposed=true;attempt++;listeners.clear();audio.onwaiting=null;audio.onplaying=null;audio.onerror=null;audio.pause();audio.removeAttribute('src');audio.load();}
 };
}
