// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {createSpeechPresentation} from '../packages/completion-speech/presentation.js';
import {assistantNode} from '../public/render.js';
import {syncDigest} from '../public/sync-digest.js';

it('projects only exact captured assistant replies, preserves full Markdown and expansion through navigation, and never calls models',async()=>{
 const text='**Done**\n\n```bash\necho ready\n```\n\n[Download](../attachments/report.html)\n\n```coffee-speech\n{"profile_version":"0.1.0","summary":"Ready; tests pending."}\n```';
 const item={answerDigest:syncDigest(text),summary:'Ready; tests pending.',completionId:'c1',profileVersion:'0.1.0'};
 let task={user:'alice',id:'task'};const request=vi.fn(async()=>({items:[item]}));
 const controller=createSpeechPresentation({request,context:()=>task,digest:syncDigest,storage:null});
 const host=document.createElement('div');document.body.append(host);
 const entry={k:'assistant',text,node:assistantNode({text})};host.append(entry.node);
 await controller.refresh();controller.apply([entry]);
 const details=entry.node.querySelector('details')!;expect(details.open).toBe(false);expect(entry.node.querySelector('.speech-summary')?.textContent).toBe(item.summary);
 expect(details.querySelector('pre code')?.textContent).toContain('echo ready');expect(details.querySelector('a[data-workspace-path]')?.getAttribute('data-workspace-path')).toBe('../attachments/report.html');
 expect(details.querySelector('summary')?.textContent).toBe('显示完整信息');details.open=true;details.dispatchEvent(new Event('toggle'));
 const forged={k:'assistant',text:'Copied example '+text,node:assistantNode({text:'Copied example '+text})};host.append(forged.node);controller.apply([forged]);expect(forged.node.querySelector('.speech-summary')).toBeNull();
 task={user:'alice',id:'other'};await controller.refresh();task={user:'alice',id:'task'};await controller.refresh();
 const reload={k:'assistant',text,node:assistantNode({text})};host.replaceChildren(reload.node);controller.apply([reload]);expect(reload.node.querySelector('details')?.open).toBe(true);
 task={user:'bob',id:'task'};request.mockResolvedValueOnce({items:[]});await controller.refresh();const bob={k:'assistant',text,node:assistantNode({text})};host.replaceChildren(bob.node);controller.apply([bob]);expect(bob.node.querySelector('.speech-summary')).toBeNull();
 expect(request.mock.calls.every(([body]:any[])=>body.action==='summaries')).toBe(true);controller.close();host.remove();
});

it('requires exact digest and visible current completion identity for summary read proof, and preserves paged full-answer controls',async()=>{
 const {summaryReadProof}=await import('../packages/completion-speech/presentation.js');
 const text='Long original answer';const item={answerDigest:syncDigest(text),summary:'Latest result.',completionId:'current',profileVersion:'0.1.0'};
 const controller=createSpeechPresentation({request:async()=>({items:[item]}),context:()=>({user:'alice',id:'task'}),digest:syncDigest,storage:null});
 const host=document.createElement('div');host.dataset.speechScroller='';document.body.append(host);
 const entry={k:'assistant',text:'Only latest portion',status:'completed',contentTruncated:true,contentDigest:item.answerDigest,node:assistantNode({text:'Only latest portion'},{done:false})};
 const download=document.createElement('button');download.textContent='下载完整内容';entry.node.append(download);host.append(entry.node);
 await controller.refresh();controller.apply([entry]);
 expect(summaryReadProof(entry,'current')).toBe(true);expect(summaryReadProof(entry,'previous')).toBe(false);expect(entry.node.querySelector('details')?.contains(download)).toBe(true);
 host.hidden=true;expect(summaryReadProof(entry,'current')).toBe(false);host.hidden=false;
 entry.node.querySelector('.speech-summary')!.getBoundingClientRect=()=>({top:-200,bottom:-100}) as DOMRect;
 expect(summaryReadProof(entry,'current')).toBe(false);host.remove();expect(summaryReadProof(entry,'current')).toBe(false);controller.close();
});

it('rejects late metadata from another account and does not change model input on rendering or expansion',async()=>{
 let resolve:(value:unknown)=>void=()=>{};let task={user:'alice',id:'same'};let first=true;
 const request=vi.fn((body:unknown)=>{if(first){first=false;return new Promise(done=>{resolve=done;});}return Promise.resolve({items:[]});});
 const controller=createSpeechPresentation({request,context:()=>task,digest:syncDigest,storage:null});
 const old=controller.refresh();await Promise.resolve();task={user:'bob',id:'same'};await controller.refresh();
 const text='Private Alice result';resolve({items:[{answerDigest:syncDigest(text),summary:'Alice private brief',completionId:'old'}]});await old;
 const node=assistantNode({text});document.body.append(node);controller.apply([{k:'assistant',text,node}]);expect(node.querySelector('.speech-summary')).toBeNull();
 expect(request.mock.calls.map(([value]:any[])=>value.action)).toEqual(['summaries','summaries']);node.remove();controller.close();
});

it('replays the captured completion without sending another native input',async()=>{
 const text='Finished.';const replay=vi.fn();const request=vi.fn(async()=>({items:[{answerDigest:syncDigest(text),summary:'Done.',completionId:'c1'}]}));
 const controller=createSpeechPresentation({request,context:()=>({user:'alice',id:'task'}),digest:syncDigest,storage:null,onReplay:replay});
 const node=assistantNode({text});document.body.append(node);await controller.refresh();controller.apply([{k:'assistant',text,node}]);
 const button=[...node.querySelectorAll('button')].find(value=>value.textContent==='重播摘要');expect(button).toBeDefined();button!.click();expect(replay).toHaveBeenCalledWith('task','c1');expect(request).toHaveBeenCalledTimes(1);node.remove();controller.close();
});

it('leaves identical historical replies complete when their captured completion identity is ambiguous',async()=>{
 const {summaryReadProof}=await import('../packages/completion-speech/presentation.js');
 const text='Identical completed answer.';const answerDigest=syncDigest(text),replay=vi.fn();
 const controller=createSpeechPresentation({request:async()=>({items:[{answerDigest,summary:'The same result.',completionId:'new-turn'},{answerDigest,summary:'The same result.',completionId:'old-turn'}]}),context:()=>({user:'alice',id:'task'}),digest:syncDigest,storage:null,onReplay:replay});
 const root=document.createElement('div');document.body.append(root);
 const entries=['old-native-message','new-native-message'].map(id=>({k:'assistant',id,text,node:assistantNode({text})}));root.append(...entries.map(entry=>entry.node));
 await controller.refresh();controller.apply(entries);
 for(const entry of entries){expect(entry.node.querySelector('.speech-summary')).toBeNull();expect(entry.node.querySelector('.speech-replay')).toBeNull();expect(entry.node.querySelector('.body')?.textContent?.trim()).toBe(text);expect(summaryReadProof(entry,'new-turn')).toBe(false);}
 expect(replay).not.toHaveBeenCalled();controller.close();root.remove();
});

it('restores an already folded answer when late metadata makes its completion identity ambiguous',async()=>{
 const text='Identical answer.';const answerDigest=syncDigest(text);let items=[{answerDigest,summary:'Result.',completionId:'old-turn'}];
 const controller=createSpeechPresentation({request:async()=>({items}),context:()=>({user:'alice',id:'task'}),digest:syncDigest,storage:null});
 const entry={k:'assistant',text,node:assistantNode({text})};document.body.append(entry.node);await controller.refresh();controller.apply([entry]);expect(entry.node.querySelector('.speech-summary')).not.toBeNull();
 items=[{answerDigest,summary:'Result.',completionId:'new-turn'},...items];await controller.refresh();controller.apply([entry]);
 expect(entry.node.querySelector('.speech-summary')).toBeNull();expect(entry.node.querySelector('.speech-replay')).toBeNull();expect(entry.node.dataset.speechCompletionId).toBeUndefined();expect(entry.node.querySelector('.body')?.textContent?.trim()).toBe(text);controller.close();entry.node.remove();
});
