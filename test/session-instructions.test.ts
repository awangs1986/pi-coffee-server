import {expect,it} from 'vitest';
import {HOST_ENVIRONMENT_INSTRUCTION as instruction,hostSessionInstructions} from '../src/host/session-instructions.js';
import {withHostEnvironment,withoutSystemContext} from '../src/host/pi-environment-extension.js';

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


it.each([
 {messages:[{role:'system',content:'system'},{role:'developer',content:'dev'},{role:'user',content:'user instruction'}],tools:[{name:'read'}]},
 {instructions:'system',input:[{role:'developer',content:'dev'},{role:'user',content:'user instruction'}]},
 {system:[{type:'text',text:'system'}],messages:[{role:'user',content:'user instruction'}]},
 {systemInstruction:'system',system_instruction:'system',contents:[{role:'system',parts:[]},{role:'user',parts:[{text:'user instruction'}]}],config:{systemInstruction:'system',system_instruction:'system',tools:[{name:'read'}]}},
])('removes only system instructions at the final Chat provider seam',payload=>{
 const before=structuredClone(payload),result:any=withoutSystemContext(payload);expect(payload).toEqual(before);expect(withoutSystemContext(result)).toEqual(result);
 for(const field of ['system','instructions','systemInstruction','system_instruction'])expect(result[field]).toBeUndefined();
 for(const field of ['messages','input','contents'])if(result[field])expect(result[field].some((m:any)=>['system','developer'].includes(m.role))).toBe(false);
 expect(result.config?.systemInstruction).toBeUndefined();expect(result.config?.system_instruction).toBeUndefined();expect(JSON.stringify(result)).toContain('user instruction');
 if('tools' in payload)expect(result.tools).toEqual(payload.tools);if('config' in payload)expect(result.config.tools).toEqual(payload.config.tools);
});
