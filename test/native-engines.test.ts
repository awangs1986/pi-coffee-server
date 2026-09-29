import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostServer } from "../src/host/server.js";
import { RpcPiSessionFactory } from "../src/host/pi-adapter.js";
import { Workspaces } from "../src/host/workspaces.js";
import { NativeAgentFactory } from "../src/host/native/factory.js";
import { WebSocket } from "ws";
import { once } from "node:events";

const roots: string[] = [];
const hosts: HostServer[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function start(root?: string, native = false, kind: "codex" | "claude" = "codex", extraEnv:Record<string,string>={}) {
  root ??= await mkdtemp(join(tmpdir(), "coffee-native-"));
  if (!roots.includes(root)) roots.push(root);
  const workspaces = new Workspaces(join(root, "projects"));
  const pi = new RpcPiSessionFactory();
  const command = { command: process.execPath, args: [join(import.meta.dirname, `fixtures/fake-${kind}.mjs`)], env: { ...extraEnv, CLAUDE_CONFIG_DIR: join(root, "native-home") } };
  const factory = native ? new NativeAgentFactory({ pi, workspaces, [kind]: command }) : pi;
  const host = new HostServer({ port: 0, token: "test-token", workspaces, factory });
  hosts.push(host); await host.start();
  const url = `http://127.0.0.1:${host.address().port}/api/workspace`;
  const request = (body?: unknown) => fetch(url, { method: body ? "POST" : "GET", headers: { authorization: "Bearer test-token", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let project=(await (await request()).json()).projects.find((p:any)=>p.name==='native-fixture');
  if(!project){
    const source=join(root,'fixture-source'),remote=join(root,'fixture.git');await mkdir(source);
    const git=promisify(execFile),run=(args:string[])=>git('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:source});
    await run(['init','-b','main']);await writeFile(join(source,'note.txt'),'base\n');await run(['add','.']);await run(['commit','-m','base']);await run(['clone','--bare',source,remote]);
    project=await (await request({action:'project',name:'native-fixture',url:remote})).json();
  }
  return { root, host, request, projectId:project.id };
}

it("fixes the Task Agent at creation before the first prompt and retains it across Host restart", async () => {
  const first = await start();
  const created = await first.request({ action: "conversation", workspaceKind: "chat", id: "fixed-agent", engine: "pi" });
  expect(created.status).toBe(200);
  expect(await created.json()).toMatchObject({ id: "fixed-agent", engine: "pi" });
  const changed = await first.request({ action: "conversation", workspaceKind: "chat", id: "fixed-agent", engine: "codex" });
  expect(changed.status).toBe(409);
  await first.host.close(); hosts.splice(hosts.indexOf(first.host), 1);
  const reopened = await start(first.root);
  const list = await (await reopened.request()).json();
  expect(list.conversations).toEqual([expect.objectContaining({ id: "fixed-agent", engine: "pi" })]);
});

it("runs the native Claude CLI and reloads its own transcript after Host restart", async () => {
  const app = await start(undefined, true, "claude");
  expect((await app.request({ action: "conversation", workspaceKind: "project", projectId:app.projectId, id: "claude-task", engine: "claude" })).status).toBe(200);
  const client = await connect(app.host, "claude-task");
  expect(await client.next(f => f.type === "opened")).toMatchObject({ engine: "claude" });
  client.socket.send(JSON.stringify({ v: 1, type: "prompt", requestId: "read", text: "Read a native file" }));
  expect(await client.next(f => f.type === "event" && f.event.type === "run_completed")).toMatchObject({ event: { status: "completed" } });
  client.socket.close(); await app.host.close(); hosts.splice(hosts.indexOf(app.host), 1);
  const reopened = await start(app.root, true, "claude");
  const next = await connect(reopened.host, "claude-task");
  expect((await next.next(f => f.type === "history")).entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "assistant", text: "Claude native marker" }),
  ]));
  next.socket.close();
});

it("answers a Claude native permission request without bypassing its permission mode", async () => {
  const app = await start(undefined, true, "claude");
  await app.request({ action: "conversation", workspaceKind: "project", projectId:app.projectId, id: "claude-approval", engine: "claude" });
  const client = await connect(app.host, "claude-approval");
  await client.next(f => f.type === "opened");
  client.socket.send(JSON.stringify({ v: 1, type: "prompt", requestId: "ask", text: "ask approval" }));
  const pending = await client.next(f => f.type === "event" && f.event.type === "native_request");
  expect(pending.event.options).toEqual(["allow", "deny"]);
  client.socket.send(JSON.stringify({ v: 1, type: "ui_response", id: pending.event.id, value: "deny", requestId: "answer" }));
  expect(await client.next(f => f.type === "event" && f.event.type === "message_completed")).toMatchObject({ event: { text: "permission denied" } });
  await client.next(f => f.type === "event" && f.event.type === "run_completed");
  client.socket.close();
});

it("blocks a Checkpoint while Claude has background writers and allows it after their native completion", async () => {
  const app = await start(undefined, true, "claude");
  const git = promisify(execFile), source = join(app.root, "source"), remote = join(app.root, "remote.git");
  await mkdir(source);
  const run = (args: string[], cwd = source) => git("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { cwd });
  await run(["init", "-b", "main"]); await writeFile(join(source, "note.txt"), "base\n");
  await run(["add", "."]); await run(["commit", "-m", "base"]); await run(["clone", "--bare", source, remote]);
  const project = await (await app.request({ action: "project", name: "native-test", url: remote })).json();
  const task = await (await app.request({ action: "conversation", projectId: project.id, workspaceKind: "project", id: "background-task", engine: "claude" })).json();
  await run(["config", "user.name", "Test"], task.cwd); await run(["config", "user.email", "test@localhost"], task.cwd);
  await writeFile(join(task.cwd, "note.txt"), "changed\n");
  const client = await connect(app.host, task.id); await client.next(f => f.type === "opened");
  client.socket.send(JSON.stringify({ v: 1, type: "prompt", requestId: "background", text: "background" }));
  await client.next(f => f.type === "event" && f.event.type === "run_completed");
  const checkpoint = { action: "checkpoint", id: task.id, paths: ["note.txt"], message: "Native change" };
  expect((await app.request(checkpoint)).status).toBe(409);
  client.socket.send(JSON.stringify({ v: 1, type: "prompt", requestId: "settle", text: "finish background" }));
  await client.next(f => f.type === "event" && f.event.type === "run_completed");
  const synced = await app.request(checkpoint);
  expect(await synced.json()).toMatchObject({ state: "synced", localSha: expect.any(String), remoteSha: expect.any(String) });
  expect(synced.status).toBe(200);
  expect(client.socket.readyState).toBe(WebSocket.OPEN);
  client.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'orphan',text:'background'}));
  await client.next(f=>f.type==='event'&&f.event.type==='run_completed');
  client.socket.close();await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
  const restarted=await start(app.root,true,'claude');const resumed=await connect(restarted.host,task.id);await resumed.next(f=>f.type==='opened');
  await writeFile(join(task.cwd,'note.txt'),'another change\n');
  expect((await restarted.request(checkpoint)).status).toBe(409);resumed.socket.close();
});

async function connect(host: HostServer, id: string, nativeProtocol = 1) {
  const socket = new WebSocket(`ws://127.0.0.1:${host.address().port}/host`, { headers: { authorization: "Bearer test-token" } });
  const frames: any[] = [];
  socket.on("message", data => frames.push(JSON.parse(String(data))));
  await once(socket, "open");
  socket.send(JSON.stringify({ v: 1, type: "open", sessionId: id, nativeProtocol }));
  const next = async (predicate: (frame: any) => boolean) => {
    for (let i = 0; i < 300; i++) {
      const index = frames.findIndex(predicate);
      if (index >= 0) return frames.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Frame did not arrive: " + JSON.stringify(frames));
  };
  return { socket, next };
}

it("runs a Codex Task through the Host and resumes its native history after Host restart", async () => {
  const app = await start(undefined, true);
  expect((await app.request({ action: "conversation", workspaceKind: "project", projectId:app.projectId, id: "codex-task", engine: "codex" })).status).toBe(200);
  const client = await connect(app.host, "codex-task");
  expect(await client.next(f => f.type === "opened")).toMatchObject({ engine: "codex", state: { isStreaming: false } });
  client.socket.send(JSON.stringify({ v: 1, type: "prompt", requestId: "first", text: "Read the workspace marker" }));
  expect(await client.next(f => f.type === "event" && f.event.type === "run_completed")).toMatchObject({ event: { status: "completed" } });
  client.socket.close();
  await app.host.close(); hosts.splice(hosts.indexOf(app.host), 1);
  const reopened = await start(app.root, true);
  const resumed = await connect(reopened.host, "codex-task");
  const history = await resumed.next(f => f.type === "history");
  expect(history.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "user", text: "Read the workspace marker" }),
    expect.objectContaining({ kind: "assistant", text: "native marker" }),
  ]));
  resumed.socket.close();
});

it("restores a native approval on reconnect and rejects a stale second answer", async () => {
  const app = await start(undefined, true);
  await app.request({ action: "conversation", workspaceKind: "project", projectId:app.projectId, id: "approval-task", engine: "codex" });
  const first = await connect(app.host, "approval-task");
  await first.next(f => f.type === "opened");
  first.socket.send(JSON.stringify({ v: 1, type: "prompt", requestId: "ask", text: "ask approval" }));
  const pending = await first.next(f => f.type === "event" && f.event.type === "native_request");
  expect(pending.event.options).toContain("decline");
  first.socket.close();
  const reopened = await connect(app.host, "approval-task");
  const restored = await reopened.next(f => f.type === "event" && f.event.type === "native_request");
  expect(restored.event.id).toBe(pending.event.id);
  const answer = { v: 1, type: "ui_response", id: restored.event.id, value: "decline", requestId: "answer" };
  reopened.socket.send(JSON.stringify(answer));
  await reopened.next(f => f.type === "event" && f.event.type === "run_completed");
  reopened.socket.send(JSON.stringify({ ...answer, requestId: "stale" }));
  expect(await reopened.next(f => f.type === "error" && f.requestId === "stale")).toMatchObject({ code: "unknown_ui_request" });
  reopened.socket.close();
});

it("interrupts only the requested Task and keeps another native run alive across browser disconnect", async () => {
  const app = await start(undefined, true);
  for (const id of ["stop-one", "keep-two"]) await app.request({ action: "conversation", workspaceKind: "project", projectId:app.projectId, id, engine: "codex" });
  const one = await connect(app.host, "stop-one"), two = await connect(app.host, "keep-two");
  await one.next(f => f.type === "opened"); await two.next(f => f.type === "opened");
  for (const client of [one, two]) client.socket.send(JSON.stringify({ v: 1, type: "prompt", requestId: "hold", text: "hold" }));
  await one.next(f => f.type === "event" && f.event.type === "run_started");
  await two.next(f => f.type === "event" && f.event.type === "run_started");
  two.socket.close();
  one.socket.send(JSON.stringify({ v: 1, type: "abort", requestId: "stop" }));
  expect(await one.next(f => f.type === "event" && f.event.type === "run_completed")).toMatchObject({ event: { status: "interrupted" } });
  const resumed = await connect(app.host, "keep-two");
  expect(await resumed.next(f => f.type === "opened")).toMatchObject({ state: { isStreaming: true } });
  expect((await app.request({ action: "delete", id: "keep-two", confirmation: "keep-two", includeLocalFiles: true })).status).toBe(409);
  resumed.socket.send(JSON.stringify({ v: 1, type: "abort", requestId: "finish" }));
  await resumed.next(f => f.type === "event" && f.event.type === "run_completed");
  one.socket.close(); resumed.socket.close();
});

it("reports three Agent choices without activating unconfigured engines or falling back to Pi", async () => {
  const app = await start();
  const base = `http://127.0.0.1:${app.host.address().port}`;
  expect((await fetch(base + "/api/engines")).status).toBe(401);
  const discovery = await fetch(base + "/api/engines", { headers: { authorization: "Bearer test-token" } });
  expect(discovery.status).toBe(200);
  expect((await discovery.json()).engines).toEqual([
    expect.objectContaining({ id: "pi", available: true }),
    expect.objectContaining({ id: "codex", available: false, reason: expect.any(String) }),
    expect.objectContaining({ id: "claude", available: false, reason: expect.any(String) }),
  ]);
  const unavailable = await app.request({ action: "conversation", workspaceKind: "project", projectId:app.projectId, id: "no-native", engine: "codex" });
  expect(unavailable.status).toBe(409);
  const invalid = await app.request({ action: "conversation", workspaceKind: "project", projectId:app.projectId, id: "invalid-native", engine: "other" });
  expect(invalid.status).toBe(409);
  expect((await (await app.request()).json()).conversations).toEqual([]);
});

it('advertises native capabilities and retains native workspace data when cleanup is unsupported', async()=>{
 const app=await start(undefined,true);
 const task=await (await app.request({action:'conversation',workspaceKind:'project',projectId:app.projectId,id:'retained',engine:'codex'})).json();
 const old=await connect(app.host,task.id,0);
 expect(await old.next(f=>f.type==='error')).toMatchObject({message:expect.any(String)});old.socket.close();
 const client=await connect(app.host,task.id);
 expect(await client.next(f=>f.type==='opened')).toMatchObject({engine:'codex',capabilities:{models:true,steer:false,followUp:false,stats:false,extensions:false,cleanup:false}});
 await app.request({action:'archive',id:task.id});
 expect((await app.request({action:'delete',id:task.id,confirmation:task.id,includeLocalFiles:true})).status).toBe(409);
 expect((await (await app.request()).json()).conversations).toContainEqual(expect.objectContaining({id:task.id,archived:true}));
 expect((await app.request({action:'restore',id:task.id})).status).toBe(200);
 const reopened=await connect(app.host,task.id);expect(await reopened.next(f=>f.type==='opened')).toMatchObject({engine:'codex'});
 client.socket.close();reopened.socket.close();
});

 it('streams stable native tool results and correlates native questions through the Host',async()=>{
 const app=await start(undefined,true);await app.request({action:'conversation',workspaceKind:'project',projectId:app.projectId,id:'interactions',engine:'codex'});
 const client=await connect(app.host,'interactions');await client.next(f=>f.type==='opened');
 client.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'tool',text:'tool'}));
 expect(await client.next(f=>f.type==='event'&&f.event.type==='tool_update'&&f.event.status==='completed')).toMatchObject({event:{id:'tool-1',result:'file content'}});
 await client.next(f=>f.type==='event'&&f.event.type==='run_completed');
 client.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'question',text:'ask question'}));
 const question=await client.next(f=>f.type==='event'&&f.event.type==='native_request');
 expect(question.event).toMatchObject({method:'input',title:'Choose color'});
 client.socket.send(JSON.stringify({v:1,type:'ui_response',id:question.event.id,value:'blue'}));
 expect(await client.next(f=>f.type==='event'&&f.event.type==='message_completed'&&f.event.id==='answer')).toMatchObject({event:{text:'blue'}});
 client.socket.close();
 });
it('fails visibly when native history is missing and never replaces the bound Session',async()=>{
 const app=await start(undefined,true);const task=await (await app.request({action:'conversation',workspaceKind:'project',projectId:app.projectId,id:'missing',engine:'codex'})).json();
 const first=await connect(app.host,task.id);await first.next(f=>f.type==='opened');first.socket.close();await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
 await rm(join(task.cwd,'.fake-native-thread.json'));
 const resumed=await start(app.root,true);const client=await connect(resumed.host,task.id);expect(await client.next(f=>f.type==='error')).toMatchObject({message:expect.stringContaining('Native session missing')});client.socket.close();
 const listed=(await (await resumed.request()).json()).conversations.find((c:any)=>c.id===task.id);expect(listed.nativeBinding).toMatchObject({state:'bound',id:'native-fixed'});
});
it('keeps an invalid native approval pending for a corrected answer',async()=>{
 const app=await start(undefined,true);await app.request({action:'conversation',workspaceKind:'project',projectId:app.projectId,id:'correct-approval',engine:'codex'});
 const client=await connect(app.host,'correct-approval');await client.next(f=>f.type==='opened');client.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'ask',text:'ask approval'}));
 const pending=await client.next(f=>f.type==='event'&&f.event.type==='native_request');
 client.socket.send(JSON.stringify({v:1,type:'ui_response',id:pending.event.id,value:'invalid',requestId:'invalid'}));await client.next(f=>f.type==='error'&&f.requestId==='invalid');
 client.socket.send(JSON.stringify({v:1,type:'ui_response',id:pending.event.id,value:'decline',requestId:'valid'}));
 expect(await client.next(f=>(f.type==='event'&&f.event.type==='run_completed') || (f.type==='error'&&f.requestId==='valid'))).toMatchObject({event:{status:'completed'}});client.socket.close();
});
it('does not treat an unknown Task identifier as a new Pi Session',async()=>{
 const app=await start(undefined,true);const client=await connect(app.host,'unknown-task');expect(await client.next(f=>f.type==='error'||f.type==='opened')).toMatchObject({type:'error',message:expect.stringContaining('Unknown Task')});client.socket.close();
});

it.each(['0.156.1','0.159.1'])('discovers verified Codex %s and opens a Task with empty native history',async(version)=>{
 const app=await start(undefined,true,'codex',{FIXTURE_VERSION:'codex-cli '+version});
 const response=await fetch(`http://127.0.0.1:${app.host.address().port}/api/engines`,{headers:{authorization:'Bearer test-token'}});
 expect((await response.json()).engines.find((e:any)=>e.id==='codex')).toMatchObject({available:true,authentication:'configured'});
 expect((await app.request({action:'conversation',id:'current-codex',workspaceKind:'project',projectId:app.projectId,engine:'codex'})).status).toBe(200);
 const client=await connect(app.host,'current-codex');
 expect(await client.next(f=>f.type==='opened')).toMatchObject({engine:'codex'});
 expect(await client.next(f=>f.type==='history')).toMatchObject({entries:[]});
 client.socket.close();
});

it('disables an unverified native CLI version with an explicit readiness reason',async()=>{
 const app=await start(undefined,true,'codex',{FIXTURE_VERSION:'codex-cli 9.0.0'});const response=await fetch(`http://127.0.0.1:${app.host.address().port}/api/engines`,{headers:{authorization:'Bearer test-token'}});
 expect((await response.json()).engines.find((e:any)=>e.id==='codex')).toMatchObject({available:false,reason:expect.stringContaining('Unsupported')});
 expect((await app.request({action:'conversation',id:'wrong-version',workspaceKind:'project',projectId:app.projectId,engine:'codex'})).status).toBe(409);
});
it('rejects replay of an already accepted native prompt after Host restart',async()=>{
 const app=await start(undefined,true);await app.request({action:'conversation',workspaceKind:'project',projectId:app.projectId,id:'once-only',engine:'codex'});
 const first=await connect(app.host,'once-only');await first.next(f=>f.type==='opened');const prompt={v:1,type:'prompt',requestId:'stable-delivery',text:'Run once'};first.socket.send(JSON.stringify(prompt));await first.next(f=>f.type==='event'&&f.event.type==='run_completed');first.socket.close();await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
 const next=await start(app.root,true);const client=await connect(next.host,'once-only');await client.next(f=>f.type==='opened');client.socket.send(JSON.stringify(prompt));expect(await client.next(f=>f.requestId==='stable-delivery'&&(f.type==='ack'||f.type==='error'))).toMatchObject({type:'error',message:expect.stringContaining('already accepted')});client.socket.close();
});

it('reports confirmed Claude cancellation as interrupted rather than a provider failure',async()=>{
 const app=await start(undefined,true,'claude');await app.request({action:'conversation',workspaceKind:'project',projectId:app.projectId,id:'claude-stop',engine:'claude'});const client=await connect(app.host,'claude-stop');await client.next(f=>f.type==='opened');
 client.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'hold',text:'hold'}));await client.next(f=>f.type==='event'&&f.event.type==='run_started');client.socket.send(JSON.stringify({v:1,type:'abort'}));
 expect(await client.next(f=>f.type==='event'&&f.event.type==='run_completed')).toMatchObject({event:{status:'interrupted'}});client.socket.close();
});

it('restores a pending native approval even when its cursor fell outside the replay buffer',async()=>{
 const app=await start(undefined,true);await app.request({action:'conversation',workspaceKind:'project',projectId:app.projectId,id:'overflow',engine:'codex'});const client=await connect(app.host,'overflow');await client.next(f=>f.type==='opened');
 client.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'overflow',text:'ask approval overflow'}));const request=await client.next(f=>f.type==='event'&&f.event.type==='native_request');await client.next(f=>f.type==='event'&&f.cursor>=300);client.socket.close();
 const next=await connect(app.host,'overflow');await next.next(f=>f.type==='resync_required');expect(await next.next(f=>f.type==='event'&&f.event.type==='native_request')).toMatchObject({event:{id:request.event.id}});next.socket.close();
});

it.each(['codex','claude'] as const)('reports missing native authentication before creating a %s Task',async engine=>{
 const app=await start(undefined,true,engine,{FIXTURE_AUTH_MISSING:'1'});const result=await fetch(`http://127.0.0.1:${app.host.address().port}/api/engines`,{headers:{authorization:'Bearer test-token'}});
 expect((await result.json()).engines.find((e:any)=>e.id===engine)).toMatchObject({available:false,authentication:'required',reason:expect.stringContaining('authentication')});
 expect((await app.request({action:'conversation',workspaceKind:'project',projectId:app.projectId,id:'no-auth',engine})).status).toBe(409);
});

it('rejects native Chat creation without persisting a Task and defaults Chat to Pi',async()=>{
 const app=await start(undefined,true);
 const denied=await app.request({action:'conversation',workspaceKind:'chat',id:'native-chat',engine:'codex'});
 expect(denied.status).toBe(409);expect(await denied.json()).toMatchObject({error:expect.stringContaining('Chat is available only with Pi')});
 expect((await (await app.request()).json()).conversations).toEqual([]);
 const allowed=await app.request({action:'conversation',workspaceKind:'chat',id:'default-chat'});
 expect(allowed.status).toBe(200);expect(await allowed.json()).toMatchObject({engine:'pi',workspaceKind:'chat'});
});
