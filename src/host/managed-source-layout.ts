import {join,resolve} from 'node:path';
import {normalizeUsername} from '../shared/identity.js';
import {LEGACY_BACKUP_SCOPE} from './backup.js';
/** Public native data and Host credential bookkeeping have separate backing
 * roots. Only scopeRoot is a namespace source grant; authority is never one. */
export function managedScopeLayout(sourceParent:string,scope:string){
 if(resolve(sourceParent)!==sourceParent||scope!==LEGACY_BACKUP_SCOPE&&normalizeUsername(scope)!==scope)throw Error('Invalid managed data scope');
 const scopeRoot=join(sourceParent,'scopes',scope),controlRoot=join(sourceParent,'authority','scopes',scope);
 return Object.freeze({scopeRoot,controlRoot,work:join(scopeRoot,'work'),native:join(scopeRoot,'native'),tasks:join(scopeRoot,'tasks'),home:join(scopeRoot,'home'),codex:join(scopeRoot,'codex'),agentDir:join(scopeRoot,'pi-config'),githubAccounts:join(controlRoot,'github-accounts'),runners:join(controlRoot,'runners')});
}
