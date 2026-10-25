// Pi1.1.0 documented provider override. Source models and defaults stay intact;
// Host prompt/model admission enforces this profile's one enrolled provider.
// Pi swallows extension hook errors, so a hook is not an authorization gate.
export default function managedProvider(pi){
 const provider=process.env.PI_COFFEE_PROVIDER_ID,port=Number(process.env.PI_COFFEE_PROVIDER_PORT);
 if(!provider||!/^[A-Za-z0-9_-]{1,80}$/.test(provider)||!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Managed provider mapping unavailable');
 pi.registerProvider(provider,{baseUrl:`http://127.0.0.1:${port}/v1`,apiKey:'managed-provider-placeholder'});
}
