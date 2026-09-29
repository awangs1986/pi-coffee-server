import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { expect, it } from "vitest";
import { HostServer } from "../src/host/server.js";
import { WebServer } from "../src/web/server.js";
import { resolveHostPiExtensions } from "../src/host/pi-extensions.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { RpcPiSessionFactory } from "../src/host/pi-adapter.js";

it("keeps Web/Host Pi replies and reconnect history working through the installed Pi package", async () => {
  const runtime = await import("pi-coffee");
  const root = await mkdtemp(join(tmpdir(), "coffee-consumer-"));
  const agentDir = join(root, "agent"),cwd=join(root,"workspace"); await mkdir(agentDir);await mkdir(cwd);await writeFile(join(cwd,"protected.txt"),"keep");
  const requests:any[]=[];let invalidHandoff=false;let releaseSynthesis:(()=>void)|undefined;
  const provider = createServer(async (req, res) => {
    let body="";for await(const chunk of req)body+=chunk;
    const request=JSON.parse(body);requests.push(request);
    const synthesis=request.messages.some((m:any)=>String(m.content).startsWith("PI_HANDOFF_SYNTHESIS"));
    if(synthesis && !invalidHandoff)await new Promise<void>(r=>{releaseSynthesis=r;});
    const input=synthesis ? JSON.parse(request.messages.find((m:any)=>m.role==="user").content) : undefined;
    const content=synthesis ? JSON.stringify(invalidHandoff ? {} : {status:"active",nextAction:"Continue the test",claims:[{id:"next",kind:"nextAction",text:"Continue the test",refs:[input.sources.find((s:any)=>s.role==="user").id]}],steps:[],exactValues:[]}) : "PACKAGE_CONSUMER_OK "+"Maintain the test constraint. ".repeat(150);
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const choice of [
      { index: 0, delta: { role: "assistant", content }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: "stop" },
    ]) res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [choice] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(r => provider.listen(0, "127.0.0.1", r));
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: {
    baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`, api: "openai-completions", apiKey: "synthetic-fixture",
    models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096 }],
  } } }));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 20, reserveTokens: 1024 }, retry: { enabled: false } }));
  const toolsFile=join(root,'native-tools.json'), inspector=join(root,'inspect.mjs');
  await writeFile(inspector,`import {writeFileSync} from 'node:fs';export default function(pi){pi.on('session_start',()=>writeFileSync(${JSON.stringify(toolsFile)},JSON.stringify(pi.getAllTools())));}`);
  const host = new HostServer({ host: "127.0.0.1", port: 0, idleTimeoutMs:50, factory: new RpcPiSessionFactory({
    cwd, agentDir, sessionDir: join(root, "sessions"), provider: "fixture", model: "fixture", args: ["--offline"],
    extensions: [...resolveHostPiExtensions({}), inspector], skills: runtime.resolvePiSkills({}),
    env: { ...runtime.withCoffeeLspPath(), PI_OFFLINE: "1", PI_COFFEE_SCHEDULER_DIR: join(root, "admission") },
  }) });
  let web: WebServer | undefined;
  const sockets: WebSocket[] = [];
  async function connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${web!.address().port}/ws`); sockets.push(socket);
    const frames: any[] = []; socket.on("message", data => {const frame=JSON.parse(data.toString());frames.push(frame);});
    await once(socket, "open");
    return { socket, frames };
  }
  try {
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host` });
    await web.start();
    const first = await connect(); first.socket.send(JSON.stringify({ v: 1, type: "open" }));
    await expect.poll(() => first.frames.find(frame => frame.type === "opened"), { timeout: 15000 }).toBeTruthy();
    const tools=JSON.parse(await readFile(toolsFile,'utf8'));
    expect(tools.filter((t:any)=>t.name==='web_search')).toHaveLength(1);
    expect(tools.some((t:any)=>t.name==='research_seal')).toBe(false);
    const search=tools.find((t:any)=>t.name==='web_search');
    expect(search.parameters.properties.provider).toBeDefined();
    expect(search.parameters.properties.delegate).toBeUndefined();
    const id = first.frames.find(frame => frame.type === "opened").sessionId;
    first.socket.send(JSON.stringify({ v: 1, type: "prompt", requestId: "package-probe", text: "Reply with the test marker." }));
    await expect.poll(() => first.frames.some(frame => frame.type === "event" && frame.event.type === "agent_settled"), { timeout: 15000 }).toBe(true);
    expect(JSON.stringify(first.frames)).toContain("PACKAGE_CONSUMER_OK");
    expect(first.frames.filter(frame => frame.type === "error" || frame.event?.type === "extension_error")).toEqual([]);
    first.socket.send(JSON.stringify({v:1,type:"get_commands"}));
    await expect.poll(()=>first.frames.find(f=>f.type==="commands")).toBeTruthy();
    const commands=first.frames.find(f=>f.type==="commands").commands;
    expect(commands.filter((c:any)=>c.name==="handoff")).toHaveLength(1);
    expect(commands.some((c:any)=>c.name==="context-recovery")).toBe(false);
    first.socket.send(JSON.stringify({v:1,type:"compact",requestId:"real-handoff"}));
    await expect.poll(()=>releaseSynthesis,{timeout:10000}).toBeTruthy();
    first.socket.send(JSON.stringify({v:1,type:"get_stats"}));
    await expect.poll(()=>first.frames.find(f=>f.type==="stats")).toBeTruthy();
    releaseSynthesis!();
    await expect.poll(()=>first.frames.find(f=>f.type==="ack" && f.requestId==="real-handoff"),{timeout:15000}).toBeTruthy();
    expect(first.frames.some(f=>f.event?.type==="context_operation" && f.event.success===true)).toBe(true);
    const native=await SessionManager.listAll(join(root,"sessions"));expect(native).toHaveLength(1);
    const entries=SessionManager.open(native[0].path).getEntries();
    expect(entries.filter((e:any)=>e.type==="compaction" && e.details?.plugin==="pi-handoff")).toHaveLength(1);
    expect(entries.find((e:any)=>e.type==="compaction")).toMatchObject({details:{pluginVersion:"0.2.0-experimental.1",trigger:"manual"}});
    invalidHandoff=true;
    first.socket.send(JSON.stringify({v:1,type:"compact",requestId:"bad-handoff"}));
    await expect.poll(()=>first.frames.find(f=>f.type==="error" && f.requestId==="bad-handoff"),{timeout:15000}).toBeTruthy();
    expect(SessionManager.open(native[0].path).getEntries().filter(e=>e.type==="compaction")).toHaveLength(1);
    first.socket.close(); await once(first.socket, "close");
    await new Promise(r=>setTimeout(r,400));
    const second = await connect(); second.socket.send(JSON.stringify({ v: 1, type: "open", sessionId: id }));
    await expect.poll(() => second.frames.find(frame => frame.type === "history"), { timeout: 5000 }).toBeTruthy();
    expect(JSON.stringify(second.frames.find(frame => frame.type === "history"))).toContain("PACKAGE_CONSUMER_OK");
    expect(second.frames.find(f=>f.type==="opened").sessionId).toBe(id);
    expect(second.frames.find(f=>f.type==="opened").state.isCompacting).toBe(false);
    expect(requests.some(r=>JSON.stringify(r.tools).includes("handoff_evidence_read"))).toBe(true);
    expect(await readFile(join(cwd,"protected.txt"),"utf8")).toBe("keep");
  } finally {
    for (const socket of sockets) socket.terminate();
    await web?.close(); await host.close(); provider.closeAllConnections();
    await new Promise<void>(r => provider.close(() => r())); await rm(root, { recursive: true, force: true });
  }
}, 40000);
