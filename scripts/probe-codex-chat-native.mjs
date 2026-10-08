// Installed Codex + isolated home + no turn/start or provider request.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CodexSessionFactory} from '../dist/src/host/codex-adapter.js';
const root=await mkdtemp(join(tmpdir(),'coffee-codex-empty-'));await mkdir(join(root,'codex'),{mode:0o700});
const config={model:'gpt-6-luna',model_provider:'fixture','model_providers.fixture.name':'fixture','model_providers.fixture.base_url':'http://127.0.0.1:1/v1','model_providers.fixture.wire_api':'responses','model_providers.fixture.requires_openai_auth':false};
let empty=true,factory;
const options={cliPath:process.argv[2]??'codex',cwd:root,codexHome:join(root,'codex'),sandbox:'read-only',approvalPolicy:'never',allowEmptyRecovery:async()=>empty,args:Object.entries(config).flatMap(([key,value])=>['-c',key+'='+JSON.stringify(value)])};
try{
 factory=new CodexSessionFactory(options);const session=await factory.create({sessionId:'empty-native-chat'});
 await session.setModel('codex','gpt-6-luna');await session.setThinkingLevel('medium');await session.setContextPreset('maximum');await session.rename('Synthetic empty Chat');
 assert.equal((await session.getHistory()).entries.length,0);await factory.close();
 factory=new CodexSessionFactory(options);const recovered=await factory.create({sessionId:'empty-native-chat'});
 assert.equal((await recovered.getHistory()).entries.length,0);assert.equal((await recovered.getModels()).current.id,'gpt-6-luna');assert.equal((await recovered.getModels()).thinkingLevel,'medium');assert.equal((await recovered.getModels()).context.preset,'maximum');
 await factory.close();empty=false;factory=new CodexSessionFactory(options);
 await assert.rejects(()=>factory.create({sessionId:'empty-native-chat'}),/thread not loaded|no rollout|Native conversation is unavailable/);
 console.log(JSON.stringify({passed:true,engine:'installed native Codex',emptyRecovery:true,model:'gpt-6-luna',effort:'medium',context:'maximum',revokedRecoveryRejected:true,modelTurns:0}));
}finally{await factory?.close();await rm(root,{recursive:true,force:true});}
