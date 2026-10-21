import {writeFileSync} from 'node:fs';
writeFileSync(process.env.MEMORY_TEST_ENV_CAPTURE,JSON.stringify({configuredCapabilityPresent:Object.hasOwn(process.env,'PI_COFFEE_SYNTHETIC_ONLY')}));
await import('./fake-pi-rpc.mjs');
