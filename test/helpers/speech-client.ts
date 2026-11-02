/** Test-side client for the v2 HTTP contract; a claim means reserve then commit. */
export function speechClient(send:(body:Record<string,unknown>)=>Promise<any>){
 const grants=new Map<string,any>();let sequence=0;
 return async(input:Record<string,unknown>)=>{
  const action=String(input.action),body={protocol:2,...(['pending','claim','finish','replay','reserve','commit','release'].includes(action)?{pageId:'test-page'}:{}),...(['claim','finish','replay','reserve','commit','release'].includes(action)?{operationId:'test-operation-'+(++sequence)}:{}),...input};
  const key=JSON.stringify([input.browserId,input.id,input.completionId]);
  if(action==='claim'){
   const reserve=await send({...body,action:'reserve'});if(!reserve.reserved)return {claimed:false};
   const commit=await send({...body,action:'commit',operationId:'test-operation-'+(++sequence),token:reserve.reservation.token,ownerEpoch:reserve.reservation.ownerEpoch});
   if(commit.committed)grants.set(key,commit);return commit.committed?{...commit,claimed:true}:{claimed:false};
  }
  if(action==='finish'){const grant=grants.get(key);return send({...body,deliveryId:grant?.deliveryId??'missing-delivery',outcome:'played'});}
  const result=await send(body);if(action==='replay'&&result.claimed)grants.set(key,result);return result;
 };
}
const clients=new WeakMap<object,ReturnType<typeof speechClient>>();
export function speechCall(policy:{handle(body:Record<string,unknown>):Promise<any>},input:Record<string,unknown>){
 let client=clients.get(policy);if(!client){client=speechClient(body=>policy.handle(body));clients.set(policy,client);}return client(input);
}
