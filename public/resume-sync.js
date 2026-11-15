// A foreground refresh cannot be lost merely because a mutation is still pending.
export function createResumeSync({read,ready,busy,waiting=()=>()=>{},failed=()=>{}}){
 let pending=false,current=null,closed=false,epoch=0,stopWait=null;
 const clear=()=>{stopWait?.();stopWait=null;};
 function kick(){
  if(closed||!pending||current||busy()||!ready())return;
  const marker={epoch};current=marker;pending=false;
  marker.promise=(async()=>{
   try{const result=await read();if(closed||marker.epoch!==epoch)return;if(result===false)pending=true;else clear();}
   catch(error){if(!closed&&marker.epoch===epoch){pending=false;clear();failed(error);}}
   finally{if(current===marker){current=null;if(pending)queueMicrotask(kick);}}
  })();return marker.promise;
 }
 return {
  request(){if(closed||!ready())return;if(!stopWait)stopWait=waiting();if(!current)pending=true;return kick();},
  kick,
  active(){return pending||!!current;},
  pause(){epoch++;pending=false;current=null;clear();},
  dispose(){closed=true;epoch++;pending=false;current=null;clear();}
 };
}
