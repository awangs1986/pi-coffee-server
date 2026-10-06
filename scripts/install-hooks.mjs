import {execFileSync} from 'node:child_process';
// Local checkout only; no global Git configuration or shared credentials.
execFileSync('git',['config','--local','core.hooksPath','.githooks'],{stdio:'inherit'});
console.log('Installed repository pre-push verification hook');
