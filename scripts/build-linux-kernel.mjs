import {spawnSync} from 'node:child_process';
import {mkdir,rename,rm,stat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform==='linux'){
 const headers=resolve(dirname(process.execPath),'../include/node'),output=resolve(root,'dist/src/host/linux-kernel.node'),temp=output+'.building';
 await stat(resolve(headers,'node_api.h'));await mkdir(dirname(output),{recursive:true});
 try{const result=spawnSync(process.env.CC||'cc',['-std=c11','-O2','-Wall','-Wextra','-Werror','-fPIC','-shared','-DNODE_GYP_MODULE_NAME=pi_coffee_linux_kernel','-I',headers,resolve(root,'src/host/linux-kernel.c'),'-o',temp],{encoding:'utf8',timeout:30000});if(result.status!==0)throw Error('Linux kernel helper build failed: '+(result.stderr||result.error?.message||result.status));await rename(temp,output);}finally{await rm(temp,{force:true});}
}
