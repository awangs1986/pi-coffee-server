// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {createSpeechPresentation,summaryReadProof} from '../packages/completion-speech/presentation.js';
import {syncDigest} from '../public/sync-digest.js';
it('hides authorized waiting metadata while preserving the visible question without summary, replay or read proof',async()=>{
 const question='Please choose the deployment target.';
 const text=question+'\n\n```coffee-speech\n{"profile_version":"0.1.0","status":"awaiting_user"}\n```';
 const item={answerDigest:syncDigest(text),status:'awaiting_user',completionId:'question-1',profileVersion:'0.1.0'};
 const renderAnswer=vi.fn((node:HTMLElement,value:string)=>{node.textContent=value;});
 const presentation=createSpeechPresentation({request:async()=>({items:[item]}),context:()=>({user:'alice',id:'task'}),digest:syncDigest,storage:null,renderAnswer});
 const node=document.createElement('div');node.dataset.messageComplete='true';node.textContent=text;document.body.append(node);const entry={k:'assistant',text,node};
 await presentation.refresh();presentation.apply([entry]);expect(node.textContent).toBe(question);expect(node.querySelector('.speech-summary')).toBeNull();expect(node.querySelector('details')).toBeNull();expect(summaryReadProof(entry,'question-1')).toBe(false);expect(node.querySelector('button')).toBeNull();
 const forgedText='Copied example '+text,forged=document.createElement('div');forged.dataset.messageComplete='true';forged.textContent=forgedText;document.body.append(forged);presentation.apply([{k:'assistant',text:forgedText,node:forged}]);expect(forged.textContent).toBe(forgedText);expect(renderAnswer).toHaveBeenCalledTimes(1);
 presentation.close();node.remove();forged.remove();
});
