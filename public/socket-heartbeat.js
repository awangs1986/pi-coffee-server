// One connection's liveness; task state and request delivery remain separate.
export function createSocketHeartbeat({sendPing,onFailure,intervalMs=15000,timeoutMs=10000}) {
  let interval=null,deadline=null,pending=null,sequence=0;
  const stop=()=>{clearInterval(interval);clearTimeout(deadline);interval=deadline=null;pending=null;};
  const fail=reason=>{stop();onFailure(reason);};
  const probe=()=>{
    if(pending!==null)return; // Repeated wake events cannot postpone an outstanding deadline.
    const nonce='hb-'+Date.now()+'-'+(++sequence);
    pending=nonce;
    deadline=setTimeout(()=>{if(pending===nonce)fail('pong_timeout');},timeoutMs);
    if(!sendPing(nonce))fail('ping_send_failed');
  };
  return {
    start(){if(interval===null)interval=setInterval(probe,intervalMs);},
    probe,stop,
    pong(nonce){
      if(pending===null || nonce!==pending)return false;
      pending=null;clearTimeout(deadline);deadline=null;return true;
    },
  };
}
