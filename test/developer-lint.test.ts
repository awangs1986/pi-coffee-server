import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
it('rejects a mechanical browser JavaScript error through the lint command',()=>{
 const run=spawnSync(process.execPath,[resolve('node_modules/eslint/bin/eslint.js'),'--stdin','--stdin-filename','public/fixture.js'],{input:'const fixture = {same: 1, same: 2}; window.fixture = fixture;',encoding:'utf8'});
 expect(run.status).toBe(1);expect(run.stdout).toContain('no-dupe-keys');
});
