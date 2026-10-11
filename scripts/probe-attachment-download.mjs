// Chromium + actual renderer/binder + HTTP; synthetic grant/binary, no model turn.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
const root=resolve('public'),binary=Buffer.from('SYNTHETIC-APK-BYTES'),html=Buffer.from('<!doctype html><html><body>Animated HTML fixture<script>globalThis.HTML_EXECUTED=true;</script></body></html>'),requests=[];
const markdown='[APK](/synthetic/task/workspace/build/app.apk)\n\n![Preview](picture.png)\n\n\uE200visualize\uE202{"path":"output/animation.html"}\uE201';
const server=createServer(async(req,res)=>{
 const u=new URL(req.url,'http://fixture');
 if(u.pathname==='/'){
  res.setHeader('content-type','text/html; charset=utf-8');res.end(`<div id="thread"></div><script type="module">
  import {renderMarkdown} from '/render.js';import {bindWorkspaceArtifactLinks} from '/workspace-artifacts.js';
  const root=document.querySelector('#thread');root.innerHTML=renderMarkdown(${JSON.stringify(markdown)});
  bindWorkspaceArtifactLinks(root,(route,path)=>'/files/'+route+'?scope=synthetic&path='+encodeURIComponent(path));window.fixtureReady=true;
  </script>`);return;
 }
 if(u.pathname.startsWith('/files/')){
  requests.push({route:u.pathname,path:u.searchParams.get('path')});
  if(u.searchParams.get('scope')!=='synthetic'){res.writeHead(401);res.end();return;}
  if(u.pathname==='/files/preview'&&u.searchParams.get('path')?.endsWith('.apk')){res.writeHead(413);res.end('Preview exceeds 10 MiB; download instead');return;}
  if(u.pathname==='/files/preview'){res.setHeader('content-type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4T8AAAAASUVORK5CYII=','base64'));return;}
  if(u.pathname==='/files/workspace-download'){const isHTML=u.searchParams.get('path')?.endsWith('.html');res.setHeader('content-type',isHTML?'text/html; charset=utf-8':'application/octet-stream');res.setHeader('content-disposition',isHTML?'attachment; filename="animation.html"':'attachment; filename="app.apk"');res.end(isHTML?html:binary);return;}
  res.writeHead(404);res.end();return;
 }
 const path=u.pathname.slice(1);if(!/^[\w.-]+$/.test(path)){res.writeHead(404);res.end();return;}
 try{res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(resolve(root,path)));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.fixtureReady);
 const link=page.getByRole('link',{name:'APK',exact:true});
 assert.match(await link.getAttribute('href'),/\/files\/workspace-download\?/,'Local attachment links must use download, not bounded preview');
 const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);
 assert.equal(download.suggestedFilename(),'app.apk');assert.equal(await download.failure(),null);
 assert.deepEqual(await readFile(await download.path()),binary);
 const htmlLink=page.getByRole('link',{name:/下载 HTML/});
 assert.match(await htmlLink.getAttribute('href'),/\/files\/workspace-download\?/);
 const [htmlDownload]=await Promise.all([page.waitForEvent('download'),htmlLink.click()]);
 assert.equal(htmlDownload.suggestedFilename(),'animation.html');assert.equal(await htmlDownload.failure(),null);
 assert.deepEqual(await readFile(await htmlDownload.path()),html);
 assert.equal(await page.evaluate(()=>globalThis.HTML_EXECUTED),undefined,'Generated HTML ran in the parent page');

 assert.match(await page.locator('a:has(img)').getAttribute('href'),/\/files\/preview\?/);
 assert.match(await page.getByRole('link',{name:'下载图片',exact:true}).getAttribute('href'),/\/files\/workspace-download\?/);
 assert.deepEqual(errors,[]);const result={passed:true,actualChromiumDownload:true,downloadedBytes:binary.length,imagePreviewRetained:true,nativeVisualizeHTMLDownload:true,htmlDidNotExecuteInParent:true,requests,errors};
 if(process.env.EVIDENCE_DIR){await mkdir(process.env.EVIDENCE_DIR,{recursive:true});await writeFile(resolve(process.env.EVIDENCE_DIR,'attachment-download.json'),JSON.stringify(result,null,2)+'\n');}
 console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(r=>server.close(r));}
