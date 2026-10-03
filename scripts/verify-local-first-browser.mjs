// Isolated Chromium acceptance. Each protocol gets its own fixture server because
// the probe deliberately leaves HTTP reads suspended at the end.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
const evidence=resolve(process.env.EVIDENCE_DIR||'.cache/local-first-browser');await mkdir(evidence,{recursive:true});
const seconds=Number(process.env.PROBE_SECONDS||60),protocols=(process.env.PROBE_PROTOCOLS||'2,legacy').split(',');
for(const protocol of protocols){
 const dir=join(evidence,protocol+'-'+seconds);await mkdir(dir,{recursive:true});
 const child=spawn(process.execPath,['scripts/probe-local-first-sync.mjs'],{env:{...process.env,PORT:'0',EVIDENCE_DIR:dir},stdio:['ignore','pipe','pipe']});
 let browser,log='',port;child.stdout.on('data',chunk=>{log+=chunk;port=Number(/localhost:(\d+)/.exec(log)?.[1]);});child.stderr.on('data',chunk=>{log+=chunk;});
 try{
  const deadline=Date.now()+10000;while(!port){if(Date.now()>deadline||child.exitCode!==null)throw Error('Fixture failed to start: '+log);await new Promise(r=>setTimeout(r,20));}
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--enable-precise-memory-info']});
  const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[],samples=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await page.context().newCDPSession(page);if(process.env.CPU_RATE)await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.CPU_RATE)});
  const started=Date.now();let sampling=false;
  const sample=async()=>{if(sampling)return;sampling=true;try{samples.push({elapsedMs:Date.now()-started,...await cdp.send('Runtime.getHeapUsage'),domNodes:await page.locator('*').count()});await writeFile(join(dir,'memory.json'),JSON.stringify(samples,null,2));}catch{}finally{sampling=false;}};
  const timer=setInterval(()=>void sample(),30000);
  let result;
  try{
   await page.goto('http://127.0.0.1:'+port+'/?protocol='+protocol+'&seconds='+seconds+(process.env.PROBE_ANCHOR_ONLY?'&anchorOnly=1':''));
   await page.waitForFunction(()=>typeof window.__localFirstProbe?.pass==='boolean',null,{timeout:(seconds+90)*1000});
   result=await page.evaluate(()=>window.__localFirstProbe);await sample();
  }catch(error){result={pass:false,error:String(error),lastStage:await page.evaluate(()=>window.__localFirstProbe).catch(()=>null)};}
  finally{clearInterval(timer);}
  await page.screenshot({path:join(dir,'result.png'),timeout:10000});
  await writeFile(join(dir,'result.json'),JSON.stringify({...result,pageErrors:errors,samples,cpuRate:Number(process.env.CPU_RATE||1)},null,2));
  console.log(JSON.stringify({protocol,seconds,pass:result.pass,error:result.error,checks:result.checks,switchTiming:result.switchTiming,inputTiming:result.inputTiming,workers:result.peakWorkers,pageErrors:errors}));
  if(!result.pass||errors.length)process.exitCode=1;
 }finally{
  await browser?.close();child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');await writeFile(join(dir,'fixture.log'),log);
 }
}
