import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hardenCurrentProcess} from './host/linux-file-lease.js';
import {ProviderHttpBroker} from './host/provider-http-broker.js';
import {ProviderCredentialGrant,readPrivateProviderJson,validateProviderCredentialConfig} from './host/provider-credentials.js';

/** Independent service entry point, never run inside the Host or model UID.
 * Configuration supplies one fixed actor/provider grant and private auth roots.
 */
export async function runProviderBroker(configPath:string){
 hardenCurrentProcess();const config=validateProviderCredentialConfig(await readPrivateProviderJson(configPath));
 if(process.getuid?.()!==config.serviceUid||process.geteuid?.()!==config.serviceUid||config.serviceUid===config.sourceUid||(process.getgroups?.()??[-1]).some(group=>group!==process.getgid?.()))throw Error('Managed provider service identity unavailable');
 const grant=new ProviderCredentialGrant(config),broker=new ProviderHttpBroker({socket:config.socket,peerUid:config.sourceUid,operations:grant.operations,credentials:request=>grant.credentials(request),...(config.auth.kind==='pi'?{metadata:()=>grant.publicCatalog()}:{}),socketMode:0o660});await broker.listen();
 let stopping=false;for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{if(stopping)return;stopping=true;void broker.close().then(()=>{process.exitCode=0;});});return broker;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--config'||resolve(args[1])!==args[1]){process.stderr.write('Usage: provider-broker-worker --config /absolute/private/config.json\n');process.exitCode=64;}
 else await runProviderBroker(args[1]).catch(()=>{process.stderr.write('Managed provider service unavailable\n');process.exitCode=78;});
}
