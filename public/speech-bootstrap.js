/** One optional component bootstrap; failures cannot disable ordinary chat. */
export function mountOptionalSpeech({load,mount,onReady=()=>{},onError=()=>{}}){
 let closed=false,instance,inflight,timer,failures=0,epoch=0,wakeExpired=false;
 const listeners=[],listen=(target,event,fn)=>{target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));};
 function schedule(delay){if(closed||instance)return;clearTimeout(timer);timer=setTimeout(()=>{timer=undefined;void attempt();},delay);}
 async function attempt(){
  if(closed||instance||inflight)return;
  const token=++epoch,abort=new AbortController();let timeout;
  const expired=new Promise((_,reject)=>{timeout=()=>{abort.abort();reject(Error('播报组件加载超时'));};});
  const entry={deadline:Date.now()+10000,expire:timeout};inflight=entry;const deadline=setTimeout(timeout,10000);
  try{const module=await Promise.race([load({signal:abort.signal}),expired]);if(closed||token!==epoch)return;instance=mount(module);onReady(instance);clearTimeout(timer);timer=undefined;}
  catch(error){if(!closed&&token===epoch){onError(error);if(error.kind!=='compatibility')schedule(wakeExpired?0:[1000,2000,5000,10000,30000][Math.min(failures++,4)]);}}
  finally{wakeExpired=false;clearTimeout(deadline);if(inflight===entry)inflight=undefined;}
 }
 const wake=()=>{if(closed||instance)return;if(inflight?.deadline<=Date.now()){wakeExpired=true;inflight.expire();}schedule(0);};
 for(const event of ['online','focus','pageshow'])listen(window,event,wake);
 listen(document,'resume',wake);listen(document,'visibilitychange',()=>{if(document.visibilityState==='visible')wake();});
 schedule(0);
 return {close(){closed=true;epoch++;clearTimeout(timer);inflight?.expire();instance?.close();for(const remove of listeners)remove();}};
}
