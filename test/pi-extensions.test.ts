import { describe, expect, it } from "vitest";
import { delimiter, isAbsolute, join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import {
  resolveWebExtension,
  resolveContextUsageExtension,
  resolveHarnessExtension,
  resolvePiExtensions,
  resolveContextFoldExtension,
  resolvePiLensExtension,
  resolveRpivTodoExtension,
  resolvePiMcpAdapterExtension,
  resolvePiSubagentsExtension,
  resolvePiSubagentsResourceExtension,
  resolvePiWebAccessExtension,
  resolvePiWebAccessPackage,
} from "../src/pi-extensions.js";
import subagentsResourceExtension from "../src/subagents/extension.js";

describe("PI Coffee native extension selection", () => {
  it("loads the read-only context observer after the final Harness boundary", () => {
    const extensions = resolvePiExtensions({});
    expect(extensions).toEqual([
      resolveWebExtension(),
      resolvePiSubagentsExtension(),
      resolvePiWebAccessExtension(),
      resolvePiSubagentsResourceExtension(),
      resolveContextFoldExtension(),
      resolveHarnessExtension(),
      resolveContextUsageExtension(),
    ]);
    expect(extensions.every((path) => isAbsolute(path))).toBe(true);
    // Local extension entries point at the build output (`dist/src`); the
    // package entry is the only source path that must exist before a build.
    expect(resolvePiSubagentsExtension()).toMatch(/[\\/]subagents[\\/]native-adapter\.js$/);
    expect(resolvePiWebAccessExtension()).toMatch(/[\\/]extensions[\\/]web-access[\\/]pi-web-access-adapter\.js$/);
    expect(resolvePiWebAccessPackage()).toMatch(/node_modules[\\/]pi-web-access[\\/]index\.ts$/);
    expect(resolveContextFoldExtension()).toMatch(/[\\/]context[\\/]extension\.js$/);
  });

  it("can disable only pi-subagents while retaining Harness", () => {
    expect(resolvePiExtensions({ PI_COFFEE_SUBAGENTS: "off" })).toEqual([
      resolveWebExtension(),
      resolvePiWebAccessExtension(),
      resolveContextFoldExtension(),
      resolveHarnessExtension(),
      resolveContextUsageExtension(),
    ]);
    expect(resolvePiExtensions({ PI_COFFEE_SUBAGENTS: "false" })).toEqual([
      resolveWebExtension(),
      resolvePiWebAccessExtension(),
      resolveContextFoldExtension(),
      resolveHarnessExtension(),
      resolveContextUsageExtension(),
    ]);
  });

  it("can disable context-fold independently, leaving Pi native compaction available", () => {
    expect(resolvePiExtensions({ PI_COFFEE_CONTEXT_FOLD: "off" })).toEqual([
      resolveWebExtension(),
      resolvePiSubagentsExtension(),
      resolvePiWebAccessExtension(),
      resolvePiSubagentsResourceExtension(),
      resolveHarnessExtension(),
      resolveContextUsageExtension(),
    ]);
  });

  it("can disable the web adapters independently", () => {
    expect(resolvePiExtensions({ PI_COFFEE_WEB: "off" })).toEqual([
      resolvePiSubagentsExtension(),
      resolvePiWebAccessExtension(),
      resolvePiSubagentsResourceExtension(),
      resolveContextFoldExtension(),
      resolveHarnessExtension(),
      resolveContextUsageExtension(),
    ]);
    expect(resolvePiExtensions({ PI_COFFEE_WEB_ACCESS: "off" })).toEqual([
      resolveWebExtension(),
      resolvePiSubagentsExtension(),
      resolvePiSubagentsResourceExtension(),
      resolveContextFoldExtension(),
      resolveHarnessExtension(),
      resolveContextUsageExtension(),
    ]);
  });

  it("keeps pi-lens optional and explains an explicit opt-in without an installed package", () => {
    expect(resolvePiExtensions({}).some(path => path.includes("pi-lens"))).toBe(false);
    expect(() => resolvePiExtensions({
      PI_COFFEE_PI_LENS: "on", PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent",
    })).toThrow("requires a separately installed, Pi-compatible pi-lens package");
  });

  it("resolves an explicitly installed pi-lens only when opted in", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-optional-lens-"));
    const entry = join(root, "npm", "node_modules", "pi-lens", "dist", "index.js");
    try {
      await mkdir(join(root, "npm", "node_modules", "pi-lens", "dist"), { recursive: true });
      await writeFile(entry, "export default function () {}\n");
      const env = { PI_COFFEE_AGENT_DIR: root };
      expect(resolvePiExtensions(env)).not.toContain(entry);
      const enabled = resolvePiExtensions({ ...env, PI_COFFEE_PI_LENS: "on" });
      expect(resolvePiLensExtension(env)).toBe(entry);
      expect(enabled.indexOf(entry)).toBeGreaterThanOrEqual(0);
      expect(enabled.indexOf(entry)).toBeLessThan(enabled.indexOf(resolveContextFoldExtension(env)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps rpiv-todo non-visible until explicitly opted in", () => {
    const defaults = resolvePiExtensions({});
    expect(defaults.some((path) => /[\\/]rpiv-todo[\\/]/.test(path))).toBe(false);

    const agentEnv = { PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent" };
    const enabled = resolvePiExtensions({ ...agentEnv, PI_COFFEE_RPIV_TODO: "on" });
    const todo = resolveRpivTodoExtension(agentEnv);
    expect(enabled).toContain(todo);
    expect(enabled.indexOf(todo)).toBeLessThan(
      enabled.indexOf(resolveContextFoldExtension(agentEnv)),
    );
    expect(todo).toMatch(/node_modules[\\/]@juicesharp[\\/]rpiv-todo[\\/]index\.ts$/);
  });

  it("keeps pi-mcp-adapter non-visible until explicitly opted in", () => {
    const defaults = resolvePiExtensions({});
    expect(defaults.some((path) => /[\\/]pi-mcp-adapter[\\/]/.test(path))).toBe(false);

    const agentEnv = { PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent" };
    const enabled = resolvePiExtensions({ ...agentEnv, PI_COFFEE_PI_MCP_ADAPTER: "on" });
    const adapter = resolvePiMcpAdapterExtension(agentEnv);
    expect(enabled).toContain(adapter);
    expect(enabled.indexOf(adapter)).toBeLessThan(
      enabled.indexOf(resolveContextFoldExtension(agentEnv)),
    );
    expect(adapter).toMatch(/node_modules[\\/]pi-mcp-adapter[\\/]index\.ts$/);
  });

  it("loads the pinned context-fold entry through Pi's native loader", async () => {
    const result = await discoverAndLoadExtensions(
      [resolveContextFoldExtension({ PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent" })],
      process.cwd(),
      "/tmp/pi-coffee-no-agent",
    );
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
  });

  it("keeps an explicit extension replacement list authoritative", () => {
    expect(resolvePiExtensions({ PI_COFFEE_EXTENSIONS: ` ./one.js${delimiter}/two.js${delimiter} ` })).toEqual([
      "./one.js",
      "/two.js",
    ]);
    expect(resolvePiExtensions({ PI_COFFEE_EXTENSIONS: "off", PI_COFFEE_SUBAGENTS: "on" })).toEqual([]);
  });

  it("exposes upstream skills and prompt templates through Pi resource discovery", () => {
    const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
    const fakePi = {
      on(event: string, handler: (payload: unknown, context: unknown) => unknown) {
        handlers.set(event, handler);
      },
    };
    subagentsResourceExtension(fakePi as never);
    const result = handlers.get("resources_discover")?.({ type: "resources_discover", cwd: "/tmp", reason: "startup" }, {});
    expect(result).toEqual({
      skillPaths: [expect.stringMatching(/node_modules[\\/]pi-subagents[\\/]skills$/)],
      promptPaths: [expect.stringMatching(/node_modules[\\/]pi-subagents[\\/]prompts$/)],
    });
  });
});
