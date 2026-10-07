// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {assistantNode} from '../public/render.js';
import {createDocumentDownloads} from '../public/document-downloads.js';

it('turns verified Word filenames in completed replies into scoped downloads without repeated cards',async()=>{
 const root=document.createElement('div');root.append(assistantNode({text:'Word: `结果.docx` and `../artifacts/结果.doc`'}));
 const downloads=createDocumentDownloads({root,context:()=> 'owner/task',load:async()=>[{path:'结果.docx',available:true},{path:'../artifacts/结果.doc',available:true}],endpoint:(path:string)=>'https://files.example/workspace-download?path='+encodeURIComponent(path)});
 await downloads.refresh();await downloads.refresh();
 expect(root.querySelectorAll('a.generated-document-download')).toHaveLength(2);
 expect(root.querySelector('a.generated-document-download')?.getAttribute('href')).toContain('workspace-download?path=');
 expect(root.textContent).not.toContain('工作区产物');
});

it('leaves examples, inputs, users, fenced commands and ambiguous filenames unlinked',async()=>{
 const root=document.createElement('div');
 root.append(assistantNode({text:'`example.docx` `input.docx` `same.docx`\n```bash\nresult.docx\n```'}));
 const user=document.createElement('div');user.className='msg user';user.innerHTML='<code>result.docx</code>';root.append(user);
 const downloads=createDocumentDownloads({root,context:()=> 'owner/task',load:async()=>[{path:'../attachments/input.docx',available:true},{path:'result.docx',available:true},{path:'x/same.docx',available:true},{path:'y/same.docx',available:true}],endpoint:()=> 'https://files.example/download'});
 await downloads.refresh();expect(root.querySelector('a.generated-document-download')).toBeNull();
});

it('ignores a late artifact response after conversation changes and rebinds renewed grants',async()=>{
 const root=document.createElement('div');root.append(assistantNode({text:'`result.docx`'}));
 let context:string|null='owner/a',url='https://files.example/a',resolve!:(value:any[])=>void;
 let result:Promise<any[]>=new Promise(r=>{resolve=r;});
 const downloads=createDocumentDownloads({root,context:()=>context,load:()=>result,endpoint:()=>url});
 const old=downloads.refresh();context='owner/b';url='https://files.example/b';result=Promise.resolve([{path:'result.docx',available:true}]);
 await downloads.refresh();resolve([{path:'other/result.docx',available:true}]);await old;
 expect(root.querySelector('a')?.href).toBe('https://files.example/b');
 url='https://files.example/b-renewed';await downloads.refresh();expect(root.querySelector('a')?.href).toBe(url);
 context=null;await downloads.refresh();expect(root.querySelector('a.generated-document-download')).toBeNull();
});

it('supports plain filenames and late grants without changing text or adding duplicate labels',async()=>{
 const root=document.createElement('div');root.append(assistantNode({text:'Download result.docx.'}));
 let context:string|null=null,url='https://files.example/first';
 const downloads=createDocumentDownloads({root,context:()=>context,load:async()=>[{path:'result.docx',available:true}],endpoint:()=>url});
 await downloads.refresh();expect(root.querySelector('a')).toBeNull();
 context='owner/a';await downloads.refresh();expect(root.querySelector('a')?.href).toBe(url);
 url='https://files.example/renewed';await downloads.refresh();expect(root.querySelector('a')?.href).toBe(url);
 context=null;await downloads.refresh();expect(root.textContent).toContain('Download result.docx.');expect(root.textContent).not.toContain('下载');
 context='owner/a';await downloads.refresh();expect(root.querySelectorAll('a')).toHaveLength(1);
});

it('does not bind incomplete replies and removes a download when the file disappears',async()=>{
 const root=document.createElement('div'),reply=assistantNode({text:'`result.docx`'},{done:false});root.append(reply);
 let files:any[]=[{path:'result.docx',available:true}],loads=0;
 const downloads=createDocumentDownloads({root,context:()=> 'owner/a',load:async()=>{loads++;return files;},endpoint:()=> 'https://files.example/file'});
 await downloads.refresh();expect(loads).toBe(0);
 reply.dataset.messageComplete='true';reply.querySelector('.body')!.innerHTML='<code>result.docx</code>';
 await downloads.refresh();expect(root.querySelector('a')).not.toBeNull();
 files=[{path:'result.docx',available:false}];await downloads.refresh(true);expect(root.querySelector('a')).toBeNull();expect(root.querySelector('code')?.textContent).toBe('result.docx');
});

it('does not link a substring of a different filename',async()=>{
 const root=document.createElement('div');root.append(assistantNode({text:'xresult.docx result.docx.bak some/result.docx'}));
 const downloads=createDocumentDownloads({root,context:()=> 'owner/a',load:async()=>[{path:'result.docx',available:true}],endpoint:()=> 'https://files.example/file'});
 await downloads.refresh();expect(root.querySelector('a')).toBeNull();
});
