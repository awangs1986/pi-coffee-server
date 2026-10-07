import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const probes=['probe-conversation-models.mjs','probe-completion-icon.mjs','probe-sidebar-activity.mjs','probe-sidebar-scroll.mjs','probe-streaming-responsiveness.mjs'];
if(process.argv.includes('--list'))console.log(JSON.stringify(probes));
else {
 const base=process.env.PI_COFFEE_CHECK_TMP_ROOT||join(homedir(),'.cache','pi-coffee','checks');await mkdir(base,{recursive:true,mode:0o700});const root=await mkdtemp(join(base,'browser-'));
 try {
  for(const probe of probes){
   console.log('BROWSER '+probe);
   const code=await new Promise(resolve=>{const child=spawn(process.execPath,[join('scripts',probe)],{stdio:'inherit',env:{...process.env,TMPDIR:root,TMP:root,TEMP:root,EVIDENCE_DIR:join(root,probe)}});child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));});
   if(code){process.exitCode=code;break;}
  }
 }finally{await rm(root,{recursive:true,force:true});}
}
