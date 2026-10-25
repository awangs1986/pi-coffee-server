import {readFile,appendFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));let input='';for await(const chunk of process.stdin)input+=chunk;const request=JSON.parse(input);const dir=config.fixtureCheckpoint,raw=await readFile(join(dir,'manifest.json')),manifest=JSON.parse(raw);const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(config.recordFile)await appendFile(config.recordFile,JSON.stringify(request)+'\n');
if(request.operation==='stage-extraction'){emit({schema:1,id:request.id,ok:true,result:{extractionId:'22222222-2222-4222-8222-222222222222',jobId:request.jobId,expiresAt:new Date(Date.now()+300000).toISOString(),scopes:['awangs'],checkpoints:[{checkpointId:manifest.checkpointId,manifestSha256:createHash('sha256').update(raw).digest('hex'),scope:'awangs',taskId:'task'}]}});process.exit(0);}
if(request.operation==='close-extraction'){emit({schema:1,id:request.id,ok:true,result:{closed:true}});process.exit(0);}
if(!['export-checkpoint','restore-checkpoint'].includes(request.operation)||request.operation==='export-checkpoint'&&!manifest.members.some(member=>member.scope===request.scope&&member.taskId===request.taskId))process.exit(1);
if(config.fixtureAttack==='path'){manifest.objects[0].path='objects/../../escaped';const changed=Buffer.from(JSON.stringify(manifest));emit({schema:1,type:'header',checkpointId:manifest.checkpointId,manifestBytes:changed.length});emit({type:'manifest',data:changed.toString('base64')});}
else{emit({schema:1,type:'header',checkpointId:manifest.checkpointId,manifestBytes:raw.length});emit({type:'manifest',data:raw.toString('base64')});}
if(config.fixtureAttack==='truncated')process.exit(0);
for(const object of manifest.objects){emit({type:'object',object});if(object.kind==='file'){const bytes=await readFile(join(dir,object.path));emit({type:'chunk',data:bytes.toString('base64')});}emit({type:'object-end'});}
emit({type:'end',checkpointId:manifest.checkpointId,manifestSha256:createHash('sha256').update(raw).digest('hex')});
