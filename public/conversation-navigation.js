// Selection is a local transaction. Native attachment runs after paint and may
// fail or remain pending without owning the route or blocking another selection.
const routeId = path => /^\/conversations\/([A-Za-z0-9_-]{1,256})$/.exec(path)?.[1];
export function conversationHref(id) {
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(id))throw new Error('Invalid conversation ID');
  return '/conversations/'+id;
}
export function createConversationNavigation({window:win=window,onSelect,onAttach,onError=()=>{}}) {
  let generation=0,timer=null,closed=false,current;
  const path=id=>id?conversationHref(id):'/';
  const write=(id,replace)=>{
    const next=path(id)+win.location.search;
    if(win.location.pathname+win.location.search!==next)win.history[replace?'replaceState':'pushState'](null,'',next);
  };
  const cancel=()=>{generation++;if(timer!==null)clearTimeout(timer);timer=null;};
  const select=(id,{replace=false,fromHistory=false}={})=>{
    if(closed)return;
    if(id!==null)conversationHref(id);
    if(onSelect(id)===false){if(fromHistory&&current!==undefined)write(current,true);return;}
    cancel();current=id;const token=generation;
    if(!fromHistory)write(id,replace);
    timer=setTimeout(()=>{timer=null;if(!closed&&token===generation)Promise.resolve(onAttach(id)).catch(error=>{if(token===generation)onError(error);});},0);
  };
  const pop=()=>select(routeId(win.location.pathname)??null,{fromHistory:true});
  win.addEventListener('popstate',pop);
  return {
    select,
    initial(remembered){return routeId(win.location.pathname)??remembered??null;},
    adopt(id){if(closed)return;current=id;write(id,true);},
    reset(){cancel();current=undefined;},
    get current(){return current;},
    dispose(){closed=true;cancel();win.removeEventListener('popstate',pop);},
  };
}
