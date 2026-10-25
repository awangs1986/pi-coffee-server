/** Versioned transport overlays only. No model ID, provider ID, reasoning,
 * context, tier or source settings file is changed. Real auth stays in broker. */
function providerId(value:string){if(!/^[A-Za-z0-9_-]{1,80}$/.test(value))throw Error('Unsupported provider identifier');return value;}
export function providerLoopbackBaseUrl(port:number){if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Invalid provider loopback port');return `http://127.0.0.1:${port}/v1`;}
export function codexProviderTransportArgs(provider:string,port:number):string[]{
 const prefix=`model_providers.${providerId(provider)}.`,base=providerLoopbackBaseUrl(port);return ['-c',prefix+'base_url='+JSON.stringify(base),'-c',prefix+'env_key="PI_COFFEE_PROVIDER_PLACEHOLDER"','-c',prefix+'requires_openai_auth=false','-c',prefix+'supports_websockets=false'];
}
/** Pi1.1.0 registerProvider baseUrl override retains its existing model catalog.
 * Mount no native auth file and provide only these public placeholder keys. */
export function piProviderTransportOverrides(providers:readonly string[],port:number){const baseUrl=providerLoopbackBaseUrl(port);if(providers.length!==1)throw Error('Invalid provider set');return Object.fromEntries(providers.map(provider=>[providerId(provider),{baseUrl,apiKey:'managed-provider-placeholder'}]));}
