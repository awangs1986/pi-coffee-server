import { describe, expect, it } from "vitest";
// Pure browser-shell logic (no DOM) shared by public/app.js; tested at the module seam.
import { attentionOf, createSidebarOrder, orderSessions, sessionGroups, usageBadge, formatReset } from "../public/sidebar.js";

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

describe("sidebar ordering (P0: who needs you first)", () => {
  it("ranks waiting > finished > running > the rest, newest first inside each rank", () => {
    const list = [
      { id: "old", updatedAt: at(600), running: false },
      { id: "run-old", updatedAt: at(500), running: true },
      { id: "done", updatedAt: at(400), running: false, attention: "finished" },
      { id: "new", updatedAt: at(1), running: false },
      { id: "wait", updatedAt: at(300), running: true, attention: "waiting" },
      { id: "run-new", updatedAt: at(2), running: true },
    ];
    expect(orderSessions(list).map((s) => s.id)).toEqual(["wait", "done", "run-new", "run-old", "new", "old"]);
  });

  it("derives the attention badge and the group label from the summary", () => {
    expect(attentionOf({ attention: "waiting" })).toBe("waiting");
    expect(attentionOf({ attention: "finished" })).toBe("finished");
    expect(attentionOf({ running: true })).toBe("running");
    expect(attentionOf({})).toBeNull();
    const groups = sessionGroups([
      { id: "a", updatedAt: at(1), running: false, attention: "waiting" },
      { id: "b", updatedAt: at(1), running: true },
      { id: "c", updatedAt: at(1), running: false },
      { id: "d", updatedAt: at(1), running: false, source: "cli" },
    ]);
    expect(groups.map((g) => [g.label, g.sessions.map((s) => s.id)])).toEqual([
      ["需要你", ["a"]],
      ["运行中", ["b"]],
      ["今天", ["c"]],
      ["本机终端会话", ["d"]],
    ]);
  });
});

describe("usage badge (P1)", () => {
  it("shows remaining percent per window and warns when a window is nearly used up", () => {
    const limits = { fiveHour: { usedPercent: 42, windowMinutes: 300, resetsAt: at(-90) }, weekly: { usedPercent: 91, windowMinutes: 10080, resetsAt: at(-60 * 24 * 3) } };
    expect(usageBadge(limits)).toEqual({ text: "5h 余 58% · 周 余 9%", level: "danger" });
    expect(usageBadge({ fiveHour: { usedPercent: 80, windowMinutes: 300, resetsAt: at(-10) } })).toEqual({ text: "5h 余 20%", level: "warn" });
    expect(usageBadge({ weekly: { usedPercent: 10, windowMinutes: 10080, resetsAt: null } })).toEqual({ text: "周 余 90%", level: "ok" });
    expect(usageBadge(undefined)).toBeNull();
  });

  it("formats reset times as a relative countdown", () => {
    expect(formatReset(at(-90))).toBe("1 小时 30 分后重置");
    expect(formatReset(at(-5))).toBe("5 分后重置");
    expect(formatReset(at(-60 * 24 * 3 - 60 * 2))).toBe("3 天 2 小时后重置");
    expect(formatReset(null)).toBe("");
  });
});

describe("docked diff panel (P2)", () => {
  it("splits a unified diff into per-file sections with their own +/- counts", async () => {
    const { patchFiles } = await import("../public/sidebar.js");
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,2 +1,3 @@", " x", "+y", "+z", "-w",
      "diff --git a/README.md b/README.md",
      "new file mode 100644",
      "--- /dev/null", "+++ b/README.md", "@@ -0,0 +1 @@", "+# hi",
      "diff --git a/old.txt b/old.txt",
      "deleted file mode 100644",
      "--- a/old.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "-bye",
    ].join("\n");
    const files = patchFiles(patch);
    expect(files.map((f) => [f.path, f.add, f.del, f.status])).toEqual([
      ["src/a.ts", 2, 1, "modified"],
      ["README.md", 1, 0, "added"],
      ["old.txt", 0, 1, "deleted"],
    ]);
    expect(files[1].text.split("\n")[0]).toBe("diff --git a/README.md b/README.md");
    expect(patchFiles("")).toEqual([]);
  });
});

describe('stable active sidebar ordering',()=>{
 it('keeps output changes inert, but honors attention transitions and clears account state',()=>{
  const order=createSidebarOrder(),ids=(list:any[])=>orderSessions(order.snapshot(list)).map(item=>item.id);
  const a={id:'a',running:true,updatedAt:'2026-10-04T00:00:01Z'},b={id:'b',running:true,updatedAt:'2026-10-04T00:00:02Z'};
  expect(ids([a,b])).toEqual(['b','a']);
  expect(ids([{...a,updatedAt:'2026-10-04T00:00:03Z'},b])).toEqual(['b','a']);
  expect(ids([{...a,attention:'waiting'},b])).toEqual(['a','b']);
  order.clear();expect(ids([{...a,updatedAt:'2026-10-04T00:00:03Z'},b])).toEqual(['a','b']);
 });
 it('uses a deterministic tie break even when the Host list order changes',()=>{
  const order=createSidebarOrder(),a={id:'a',running:true,updatedAt:'same'},b={...a,id:'b'};
  expect(orderSessions(order.snapshot([b,a])).map(s=>s.id)).toEqual(['a','b']);
  expect(orderSessions(order.snapshot([a,b])).map(s=>s.id)).toEqual(['a','b']);
 });
});
