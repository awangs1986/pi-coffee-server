// Display-only grouping. Native history, entity IDs and pagination remain intact.
// Reuse groups and message nodes so live refreshes preserve explicit expansion.
function place(parent,nodes,end=null){
  let next=end;
  for(let i=nodes.length-1;i>=0;i--){const node=nodes[i];if(node.parentNode!==parent||node.nextSibling!==next)parent.insertBefore(node,next);next=node;}
}
export function renderProcessEntries(container,items,{groups=new Map(),end=null}={}){
  const document=container.ownerDocument,used=new Set(),top=[];
  for(let i=0;i<items.length;){
    const item=items[i];
    if(item.kind!=='tool'){if(item.node)top.push(item.node);i++;continue;}
    const run=[];while(i<items.length&&items[i].kind==='tool')run.push(items[i++]);
    const key=String(item.id);used.add(key);
    let group=groups.get(key);
    if(!group){
      group=document.createElement('details');group.className='activity history-process';
      const summary=document.createElement('summary'),chevron=document.createElement('span'),label=document.createElement('span'),count=document.createElement('span');
      chevron.className='chev';chevron.textContent='▸';label.className='label';count.className='count';
      summary.append(chevron,label,count);const body=document.createElement('div');body.className='activity-body';group.append(summary,body);groups.set(key,group);
    }
    // The group can anchor a collapsed tool without inventing a server entity.
    group.dataset.messageId=key;
    const label=run.some(entry=>entry.error)?'工作过程（含错误）':'工作过程',count=run.length+' 步';
    if(group.querySelector('.label').textContent!==label)group.querySelector('.label').textContent=label;
    if(group.querySelector('.count').textContent!==count)group.querySelector('.count').textContent=count;
    place(group.querySelector('.activity-body'),run.map(entry=>entry.node).filter(Boolean));top.push(group);
  }
  place(container,top,end);
  for(const [key,group] of groups)if(!used.has(key)){group.remove();groups.delete(key);}
  return groups;
}
