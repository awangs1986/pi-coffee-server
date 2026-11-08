/** Current native objective only. No polling, synthetic prompts or automatic mutations. */
export function initGoalControls({root,send,requestId,details}){
 const status=root.querySelector('#goal-state'),objective=root.querySelector('#goal-objective'),usage=root.querySelector('#goal-usage');
 const toggle=root.querySelector('#goal-toggle'),retry=root.querySelector('#goal-refresh'),more=root.querySelector('#goal-details');
 const labels={active:'进行中',paused:'已暂停',blocked:'遇到阻碍',usageLimited:'用量受限',budgetLimited:'预算已用尽',complete:'已完成'};
 let session=null,goal,revision=0,pending=null,online=false,available=false,confirmed=false,notice='';
 const cancel=()=>{if(pending)clearTimeout(pending.timer);pending=null;};
 const number=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
 const tokens=value=>value>=1000?`${(value/1000).toFixed(value<10000?1:0)}K`:String(value);
 function accept(value){
  if(value!==null&&(!value||typeof value.objective!=='string'||value.objective.length>4000||!Object.hasOwn(labels,value.status)))throw Error('目标状态不可用');
  goal=value;confirmed=true;notice='';render();
 }
 function render(){
  root.hidden=!session||(goal===null&&confirmed&&!notice)||(goal===null&&!online);
  status.textContent=confirmed&&goal?labels[goal.status]:notice||'同步中';
  root.dataset.status=confirmed&&goal?goal.status:'unknown';
  objective.textContent=goal?.objective||'';objective.title=goal?.objective||'';
  usage.textContent=confirmed&&goal&&number(goal.tokensUsed)&&number(goal.tokenBudget)?`${tokens(goal.tokensUsed)} / ${tokens(goal.tokenBudget)} Token`:confirmed&&goal&&number(goal.timeUsedSeconds)?`已用 ${Math.floor(goal.timeUsedSeconds/60)}分${goal.timeUsedSeconds%60}秒`:'';
  const action=goal?.status==='active'?'pause':['paused','blocked','usageLimited'].includes(goal?.status)?'resume':null;
  toggle.hidden=!confirmed||!action;toggle.textContent=action==='pause'?'暂停':'继续';
  toggle.disabled=!online||!available||Boolean(pending);toggle.title=action==='pause'?'暂停持续目标（原生控制当前轮次的停止时机）':'恢复持续目标，由 Codex 继续推进';
  retry.hidden=confirmed&&!notice;retry.disabled=!online||!available||Boolean(pending);
  more.disabled=!online||!available||Boolean(pending);more.hidden=!goal;
 }
 function request(args){
  if(!session||!online||!available||pending)return;
  const request=requestId('goal'),item={request,id:session,revision,args,timer:null};
  pending=item;item.timer=setTimeout(()=>{
   if(pending!==item)return;
   cancel();confirmed=false;notice='状态未确认，请刷新';render();
  },15000);
  if(!send({v:1,type:'agent_command',requestId:request,name:'goal',args})){
   cancel();confirmed=false;notice='未连接，请刷新';
  }
  render();
 }
 toggle.onclick=()=>{if(confirmed&&goal)request(goal.status==='active'?'pause':'resume');};
 retry.onclick=()=>request('');
 more.onclick=()=>{if(goal)details(JSON.stringify({goal}));};
 return {
  reset(){cancel();session=null;goal=undefined;revision++;online=false;available=false;confirmed=false;notice='';render();},
  opened(id){cancel();session=id;goal=undefined;revision++;online=true;available=true;confirmed=false;notice='';request('');},
  availability(value){available=value;render();},
  connection(value){online=value;if(!value){cancel();confirmed=false;notice='连接断开，状态待同步';}render();},
  event(event){
   if(!session)return;
   if(event.type==='goal_unavailable'){revision++;confirmed=false;notice='目标状态不可用，请刷新';render();return;}
   if(event.type!=='goal_updated')return;
   revision++;
   try{accept(event.goal);}catch{confirmed=false;notice='目标状态不可用，请刷新';render();}
  },
  receive(frame){
   if(!pending||pending.request!==frame.requestId)return false;
   const item=pending;cancel();
   if(item.id!==session)return true;
   if(frame.type==='error'){confirmed=false;notice='操作未确认，请刷新';render();return true;}
   if(frame.sessionId!==session||frame.name!=='goal'){confirmed=false;notice='状态未确认，请刷新';render();return true;}
   if(item.revision===revision){
    try{accept(JSON.parse(frame.text).goal);}catch{confirmed=false;notice='目标状态不可用，请刷新';}
   }
   render();return true;
  },
 };
}
