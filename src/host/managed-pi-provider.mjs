// Pi1.1.0 documented provider registration. The endpoint is the exact broker
// socket pinned by the outside supervisor; no private auth/config enters here.
export default async function managedProvider(pi){
 const provider=process.env.PI_COFFEE_PROVIDER_ID,port=Number(process.env.PI_COFFEE_PROVIDER_PORT);
 if(!provider||!/^[A-Za-z0-9_-]{1,80}$/.test(provider)||!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Managed provider mapping unavailable');
 const response=await fetch(`http://127.0.0.1:${port}/_coffee/models`,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Managed provider catalog unavailable');const catalog=await response.json();
 if(catalog.schema!==1||catalog.provider!==provider||!['openai-completions','openai-responses','openai-codex-responses'].includes(catalog.api)||!Array.isArray(catalog.models)||!catalog.models.length||catalog.models.length>256)throw Error('Managed provider catalog refused');
 const placeholder='e30.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'managed-placeholder'}})).toString('base64')+'.managed-placeholder';
 pi.registerProvider(provider,{baseUrl:`http://127.0.0.1:${port}/v1`,api:catalog.api,models:catalog.models,apiKey:placeholder});
}
