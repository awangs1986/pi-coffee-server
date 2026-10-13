import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { GiteaClient } from "../src/host/gitea.js";

let server:ReturnType<typeof createServer>|undefined;
afterEach(async()=>{if(server){server.close();await once(server,"close");server=undefined;}});

describe("Gitea code collaboration adapter",()=>{
  it('rejects another account’s token before creating a repository',async()=>{
    let created=false;
    server=createServer((req,res)=>{
      res.setHeader('content-type','application/json');
      if(req.url==='/api/v1/user')return res.end(JSON.stringify({id:1,login:'owner',active:true}));
      created=true;res.end(JSON.stringify({id:10,name:'private',default_branch:'main',clone_url:'http://gitea/owner/private.git',html_url:'http://gitea/owner/private'}));
    });server.listen(0,'127.0.0.1');await once(server,'listening');
    const address=server.address();if(!address||typeof address==='string')throw Error('fixture address');
    const client=new GiteaClient({baseUrl:`http://127.0.0.1:${address.port}`,token:'wrong-owner-fixture',owner:'participant',userId:2});
    await expect(client.createRepository('private')).rejects.toThrow('Gitea credential identity does not match this account');
    expect(created).toBe(false);
  });
  it("creates and reuses a PR in the shared repository owned by another user",async()=>{
    let created=false;
    server=createServer((request,response)=>{
      response.setHeader("content-type","application/json");
      if(request.url==="/api/v1/repositories/32")return response.end(JSON.stringify({owner:{login:"other-user"},name:"shared"}));
      const pull={number:2,html_url:"http://gitea/other-user/shared/pulls/2",state:"open",head:{ref:"coffee/vm/task",repo_id:32},base:{ref:"main",repo_id:32}};
      const unrelated={number:1,html_url:"http://gitea/other-user/shared/pulls/1",state:"open",head:{ref:"coffee/another-vm/another-task",repo_id:32},base:{ref:"main",repo_id:32}};
      if(request.method==="GET" && request.url==="/api/v1/repos/other-user/shared/pulls?state=open&head=other-user%3Acoffee%2Fvm%2Ftask&base=main&page=1&limit=50")return response.end(JSON.stringify(created?[unrelated,pull]:[unrelated]));
      if(request.method==="POST" && request.url==="/api/v1/repos/other-user/shared/pulls"){
        let body="";request.on("data",chunk=>body+=chunk);request.on("end",()=>{
          if(created || JSON.stringify(JSON.parse(body))!==JSON.stringify({head:"coffee/vm/task",base:"main",title:"Ready"})){response.statusCode=409;return response.end('{}');}
          created=true;response.end(JSON.stringify(pull));
        });return;
      }
      response.statusCode=404;response.end('{}');
    });server.listen(0,"127.0.0.1");await once(server,"listening");
    const address=server.address();if(!address || typeof address==="string")throw new Error("missing address");
    const client=new GiteaClient({baseUrl:`http://127.0.0.1:${address.port}`,token:"fixture",owner:"collaborator"});
    const project={id:"32",repoId:"32",name:"local-alias",path:"",branch:"main"};
    const expected={number:2,url:"http://gitea/other-user/shared/pulls/2",source:"coffee/vm/task",target:"main"};
    expect(await client.createPullRequest(project,"coffee/vm/task","main","Ready")).toMatchObject(expected);
    expect(await client.createPullRequest(project,"coffee/vm/task","main","Ready")).toMatchObject(expected);
  });
  it("creates repositories and returns an existing pull request idempotently",async()=>{
    const requests:Array<{method?:string;url?:string;body:string}>=[];
    server=createServer((request,response)=>{
      let body="";request.on("data",chunk=>body+=chunk);request.on("end",()=>{
        requests.push({method:request.method,url:request.url,body});response.setHeader("content-type","application/json");
        if(request.url==="/api/v1/user/repos")return response.end(JSON.stringify({id:9,name:"demo",default_branch:"main",clone_url:"http://gitea/a/demo.git",html_url:"http://gitea/a/demo"}));
        if(request.url==="/api/v1/repositories/9")return response.end(JSON.stringify({owner:{login:"a"},name:"demo"}));
        if(request.url?.includes("/pulls?"))return response.end(JSON.stringify([{number:4,html_url:"http://gitea/a/demo/pulls/4",state:"open",head:{ref:"coffee/vm/c1",repo_id:9},base:{ref:"main",repo_id:9}}]));
        response.statusCode=500;response.end('{}');
      });
    });server.listen(0,"127.0.0.1");await once(server,"listening");
    const address=server.address();if(!address || typeof address==="string")throw new Error("missing address");
    const client=new GiteaClient({baseUrl:`http://127.0.0.1:${address.port}`,token:"secret",owner:"a"});
    expect(await client.createRepository("demo")).toMatchObject({repoId:"9",branch:"main",repoUrl:"http://gitea/a/demo.git"});
    expect(await client.createPullRequest({id:"9",name:"demo",path:"",branch:"main",repoId:"9",repoUrl:"http://gitea/a/demo.git"},"coffee/vm/c1","main","Ready")).toMatchObject({number:4,url:"http://gitea/a/demo/pulls/4"});
    expect(requests.map(item=>item.url)).toContain("/api/v1/repos/a/demo/pulls?state=open&head=a%3Acoffee%2Fvm%2Fc1&base=main&page=1&limit=50");
  });
});
