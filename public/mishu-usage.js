/** No monetary estimates or inferred zeroes: native coverage and unknown stay visible. */
export function initMishuUsage({context,request,toast}) {
 let dialog=null;function close(){dialog?.remove();dialog=null;}
 async function open(){close();const source=context();if(!source?.id||(source.engine||'pi')!=='pi')return toast('MISHU 用量入口仅支持已启用的 Pi Chat');
  const modal=document.createElement('dialog');dialog=modal;modal.style.cssText='width:min(680px,94vw);max-height:85dvh;overflow:auto';
  const title=document.createElement('h2');title.textContent='MISHU 分类用量与辅助额度';
  const purpose=document.createElement('select');purpose.setAttribute('aria-label','用量用途');for(const [value,label]of [['','所有用途'],['foreground','前台对话'],['report','原生报告'],['memory','记忆整理'],['context','上下文辅助']]){const option=document.createElement('option');option.value=value;option.textContent=label;purpose.append(option);}
  const model=document.createElement('input');model.placeholder='精确模型 ID（留空全部）';model.setAttribute('aria-label','用量模型');
  const since=document.createElement('input');since.type='datetime-local';since.setAttribute('aria-label','用量起始时间');const until=document.createElement('input');until.type='datetime-local';until.setAttribute('aria-label','用量结束时间');
  for(const input of [purpose,model,since,until])input.style.cssText='display:block;width:100%;margin:8px 0;box-sizing:border-box';
  const search=document.createElement('button');search.textContent='查询用量';const more=document.createElement('button');more.textContent='下一页';more.hidden=true;const done=document.createElement('button');done.textContent='关闭';done.onclick=close;const output=document.createElement('div');output.setAttribute('aria-live','polite');let next=null;
  const read=async(offset=0)=>{search.disabled=true;more.disabled=true;try{const result=await request({action:'usage',id:source.id,version:1,...(purpose.value?{purpose:purpose.value}:{}),...(model.value.trim()?{model:model.value.trim()}:{}),...(since.value?{since:new Date(since.value).toISOString()}:{}),...(until.value?{until:new Date(until.value).toISOString()}:{}),offset,limit:20});if(dialog!==modal||context()?.id!==source.id)return close();output.replaceChildren();const coverage=document.createElement('p');coverage.textContent=`统计起点 ${result.startedAt||'未知'}；覆盖 ${result.coverage||'unknown'}。Host Watch：确定 0 次模型调用；其他未知不能算零。辅助调用本小时剩余 ${result.budget?.remaining??'未知'} / ${result.limits?.hourlyCalls??'未知'}。${result.diagnostic||''}`;output.append(coverage);
    const gaps=document.createElement('p');gaps.textContent=(result.gaps||[]).join('；');output.append(gaps);
    const total=document.createElement('p');const value=n=>typeof n==='number'?String(n):'未知';total.textContent=`已知范围 input ${value(result.totals?.input)} / output ${value(result.totals?.output)} / cache-read ${value(result.totals?.cacheRead)} / cache-write ${value(result.totals?.cacheWrite)}；缓存不重复加入 input，不估算金额。`;output.append(total);
    for(const row of result.records||[]){const item=document.createElement('p');item.textContent=`${row.at} · ${row.purpose} · ${row.model} · ${row.source} · input ${value(row.input)} / output ${value(row.output)} / cache-read ${value(row.cacheRead)} / cache-write ${value(row.cacheWrite)} · ${row.status||'状态未知'}`;item.style.overflowWrap='anywhere';output.append(item);}next=result.next;more.hidden=next===null||next===undefined;
   }catch(error){if(dialog===modal)output.textContent=error.message||'用量读取失败，普通对话仍可继续';}finally{search.disabled=false;more.disabled=false;}};
  search.onclick=()=>void read(0);more.onclick=()=>void read(next||0);modal.append(title,purpose,model,since,until,search,more,done,output);modal.addEventListener('cancel',event=>{event.preventDefault();close();});document.body.append(modal);modal.showModal();await read();
 }
 return {open,close};
}
