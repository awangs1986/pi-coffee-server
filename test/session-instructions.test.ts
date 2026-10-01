import {expect,it} from 'vitest';
import {HOST_ENVIRONMENT_INSTRUCTION as instruction,hostSessionInstructions} from '../src/host/session-instructions.js';
import {withHostEnvironment} from '../src/host/pi-environment-extension.js';

it('keeps one environment sentence with optional runner guidance',()=>{
 expect(hostSessionInstructions()).toBe(instruction);
 expect(hostSessionInstructions(hostSessionInstructions('Runner guidance.'))).toBe(instruction+'\nRunner guidance.');
});

it.each([
 ['openai-completions',{messages:[{role:'system',content:'Keep native guidance.'},{role:'user',content:instruction}],tools:[] }],
 ['openai-responses',{instructions:'Keep native guidance.',input:[{role:'user',content:'Hello'}],tools:[]}],
 ['openai-codex-responses',{input:[{role:'user',content:'Hello'}],tools:[]}],
 ['anthropic-messages',{system:[{type:'text',text:'Keep native guidance.',cache_control:{type:'ephemeral'}}],messages:[{role:'user',content:'Hello'}],tools:[]}],
 ['bedrock-converse-stream',{messages:[{role:'user',content:[{text:'Hello'}]}],tools:[]}],
 ['google-generative-ai',{contents:[{role:'user',parts:[{text:'Hello'}]}],config:{tools:[]}}],
 ['google-vertex',{contents:[{role:'user',parts:[{text:'Hello'}]}],config:{systemInstruction:{parts:[{text:'Keep native guidance.'}]},tools:[]}}],
] as const)('preserves %s content and tools while adding Host context idempotently',(api,payload)=>{
 const before=structuredClone(payload),result=withHostEnvironment(payload,api);
 expect(payload).toEqual(before);
 expect(withHostEnvironment(result,api)).toEqual(result);
 expect(JSON.stringify(result)).toContain(instruction);
 if('messages' in payload)expect((result as any).messages.slice(-payload.messages.length)).toEqual(payload.messages);
 if('input' in payload)expect((result as any).input).toEqual(payload.input);
 if('contents' in payload){expect((result as any).contents).toEqual(payload.contents);expect((result as any).config.tools).toEqual(payload.config.tools);}
 if('tools' in payload)expect((result as any).tools).toEqual(payload.tools);
 if(JSON.stringify(payload).includes('Keep native guidance.'))expect(JSON.stringify(result)).toContain('Keep native guidance.');
});
