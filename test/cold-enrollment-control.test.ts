import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ManagedSourceAuthority} from '../src/host/managed-source-authority.js';
import {startColdEnrollmentControl} from '../src/host/cold-enrollment-control.js';
it('maintenance socket overrides cannot escape the actual unmounted authority through traversal or a symlink into a native scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cold-control-path-')),authorityRoot=join(root,'authority'),scope=join(root,'scopes');await mkdir(authorityRoot,{mode:0o700});await mkdir(scope,{mode:0o700});await symlink(scope,join(authorityRoot,'native-alias'));const uid=process.getuid!(),authority=new ManagedSourceAuthority({schema:1,executorUid:uid,legacyHostUid:uid+1,keyUid:uid+2,sourceParent:root,sourceSocket:join(root,'source.sock'),legacyAdmissionSocket:join(root,'legacy.sock'),runtimeRoots:[]}),base={profile:join(root,'must-not-be-read.json'),authority,accounts:{} as never,broker:{} as never};
 try{await expect(startColdEnrollmentControl({...base,socket:authorityRoot+'/../scopes/maintenance.sock'})).rejects.toThrow('enrollment_control_unsafe');await expect(startColdEnrollmentControl({...base,socket:join(authorityRoot,'native-alias','maintenance.sock')})).rejects.toThrow('unsafe_directory');}finally{await rm(root,{recursive:true,force:true});}
});
