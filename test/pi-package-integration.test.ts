import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { expect, it } from "vitest";
import { HostServer } from "../src/host/server.js";
import { WebServer } from "../src/web/server.js";
import { RpcPiSessionFactory } from "../src/host/pi-adapter.js";

it("keeps Web/Host Pi replies and reconnect history working through the installed Pi package", async () => {
  const runtime = await import("pi-coffee");
  const root = await mkdtemp(join(tmpdir(), "coffee-consumer-"));
  const agentDir = join(root, "agent"); await mkdir(agentDir);
  const provider = createServer(async (req, res) => {
    for await (const _ of req) { /* Drain the synthetic request. */ }
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const choice of [
      { index: 0, delta: { role: "assistant", content: "PACKAGE_CONSUMER_OK" }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: "stop" },
    ]) res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [choice] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(r => provider.listen(0, "127.0.0.1", r));
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: {
    baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`, api: "openai-completions", apiKey: "synthetic-fixture",
    models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 1024 }],
  } } }));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
  const host = new HostServer({ host: "127.0.0.1", port: 0, factory: new RpcPiSessionFactory({
    cwd: root, agentDir, sessionDir: join(root, "sessions"), provider: "fixture", model: "fixture", args: ["--offline"],
    extensions: runtime.resolvePiExtensions({}), skills: runtime.resolvePiSkills({}),
    env: { ...runtime.withCoffeeLspPath(), PI_OFFLINE: "1", PI_COFFEE_SCHEDULER_DIR: join(root, "admission") },
  }) });
  let web: WebServer | undefined;
  const sockets: WebSocket[] = [];
  async function connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${web!.address().port}/ws`); sockets.push(socket);
    const frames: any[] = []; socket.on("message", data => frames.push(JSON.parse(data.toString())));
    await once(socket, "open");
    return { socket, frames };
  }
  try {
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host` });
    await web.start();
    const first = await connect(); first.socket.send(JSON.stringify({ v: 1, type: "open" }));
    await expect.poll(() => first.frames.find(frame => frame.type === "opened"), { timeout: 15000 }).toBeTruthy();
    const id = first.frames.find(frame => frame.type === "opened").sessionId;
    first.socket.send(JSON.stringify({ v: 1, type: "prompt", requestId: "package-probe", text: "Reply with the test marker." }));
    await expect.poll(() => first.frames.some(frame => frame.type === "event" && frame.event.type === "agent_settled"), { timeout: 15000 }).toBe(true);
    expect(JSON.stringify(first.frames)).toContain("PACKAGE_CONSUMER_OK");
    expect(first.frames.filter(frame => frame.type === "error" || frame.event?.type === "extension_error")).toEqual([]);
    first.socket.close(); await once(first.socket, "close");
    const second = await connect(); second.socket.send(JSON.stringify({ v: 1, type: "open", sessionId: id }));
    await expect.poll(() => second.frames.find(frame => frame.type === "history"), { timeout: 5000 }).toBeTruthy();
    expect(JSON.stringify(second.frames.find(frame => frame.type === "history"))).toContain("PACKAGE_CONSUMER_OK");
  } finally {
    for (const socket of sockets) socket.terminate();
    await web?.close(); await host.close(); provider.closeAllConnections();
    await new Promise<void>(r => provider.close(() => r())); await rm(root, { recursive: true, force: true });
  }
}, 40000);
