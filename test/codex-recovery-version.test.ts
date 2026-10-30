import {it,expect} from 'vitest';import {join} from 'node:path';
import {codexRecoveryVersion} from '../src/host/codex-recovery-version.js';
it('does not qualify an unavailable or different native executable as the supported Codex version',async()=>{expect(await codexRecoveryVersion('/unavailable/codex')).toBe('unknown');expect(await codexRecoveryVersion('/usr/bin/python3')).toBe('unknown');});
it.skipIf(!process.env.PI_COFFEE_TEST_CODEX_ROOT)('reads the actual installed Codex CLI version without opening a provider turn',async()=>{expect(await codexRecoveryVersion(join(process.env.PI_COFFEE_TEST_CODEX_ROOT!,'coffee-codex'))).toBe('0.159.1');});
