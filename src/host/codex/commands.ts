import type {CodexAppServer,Obj} from './rpc.js';
/** Explicit user commands only; never accepts arbitrary JSON-RPC methods or thread IDs. */
export async function codexNativeCommand(server:CodexAppServer,threadId:string,cwd:string,name:string,args:string):Promise<unknown>{
 if(name==='pwd'){if(args)throw Error('/pwd does not accept arguments');return {cwd};}
 if(name==='goal'){
  if(!args)return server.request('thread/goal/get',{threadId});
  if(args==='clear'){await server.request('thread/goal/clear',{threadId,origin:'user'});return {goal:null};}
  if(args==='pause'||args==='resume')return server.request('thread/goal/set',{threadId,status:args==='pause'?'paused':'active',origin:'user'});
  const objective=args.startsWith('edit ')?args.slice(5).trim():args;
  if(objective==='edit'||!objective||objective.length>4000)throw Error('Use /goal <objective> or /goal edit <objective> (1–4000 characters)');
  return server.request('thread/goal/set',{threadId,objective,origin:'user'});
 }
 if(args)throw Error('This Web command currently supports viewing only; arguments were not executed');
 if(name==='mcp'){
  const result=await server.request('mcpServerStatus/list',{threadId,limit:100,detail:'toolsAndAuthOnly'}) as Obj;
  return {servers:((result.data??[]) as Obj[]).map(row=>({name:row.name,authStatus:row.authStatus,tools:Object.keys((row.tools??{}) as Obj)})),more:Boolean(result.nextCursor)};
 }
 if(name==='usage')return server.request('account/rateLimits/read',{});
 if(name==='hooks'){const value=await server.request('hooks/list',{cwds:[cwd]}) as Obj;return {data:((value.data??[]) as Obj[]).map(row=>({cwd:row.cwd,hooks:((row.hooks??[]) as Obj[]).map(h=>({event:h.eventName,type:h.handlerType,enabled:h.enabled,trust:h.trustStatus}))}))};}
 if(name==='apps'){const value=await server.request('app/list',{threadId,limit:50,forceRefetch:false}) as Obj;return {apps:((value.data??[]) as Obj[]).map(a=>({id:a.id,name:a.name,description:a.description})),more:Boolean(value.nextCursor)};}
 if(name==='plugins'){const value=await server.request('plugin/list',{cwds:[cwd],forceRefetch:false}) as Obj;return {marketplaces:((value.marketplaces??[]) as Obj[]).map(m=>({name:m.name,plugins:((m.plugins??[]) as Obj[]).map(p=>({id:p.id,name:p.name,enabled:p.enabled,installed:p.installed}))}))};}
 throw Error('Unsupported native command; no prompt was sent');
}
