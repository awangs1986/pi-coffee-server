import { parentPort } from "node:worker_threads";

parentPort!.on("message", async ({ id, kind, args }) => {
  try {
    let value;
    if (kind === "pi") {
      const { RpcPiSessionFactory } = await import("../pi-adapter.js");
      value = await new RpcPiSessionFactory(args.options).readHistory(args.sessionId);
    } else if (kind === "claude") {
      const { readClaudeHistory } = await import("./claude.js");
      value = await readClaudeHistory(args.command, args.cwd, args.nativeId);
    } else if (kind === "codex") {
      const { readCodexHistory } = await import("../codex/history.js");
      value = await readCodexHistory(args.options, args.nativeId);
    } else if (kind === "takeover") {
      const { readTakeoverHistory } = await import("./history-source.js");
      value = await readTakeoverHistory(args.read, args.root, args.segment);
    } else throw new Error("Unsupported native source audit");
    parentPort!.postMessage({ id, value });
  } catch { parentPort!.postMessage({ id, error: "Native source audit unavailable" }); }
});
