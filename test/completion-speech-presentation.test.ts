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
