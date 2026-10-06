import { describe, expect, it, vi } from "vitest";
// Pure browser-shell logic (no DOM) shared by public/app.js; tested at the module seam.
import { attentionOf, createSidebarOrder, orderSessions, sessionGroups, orderRecentSessions, conversationActivityAt, usageBadge, formatReset } from "../public/sidebar.js";

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

it('uses stable IDs for tied or missing creation dates without activity fallback',()=>{
 const result=sessionGroups([
  {id:'z',createdAt:'2026-10-04T10:00:00Z'},
  {id:'a',createdAt:'2026-10-04T12:00:00+02:00'},
  {id:'missing-z',updatedAt:'2099-01-01T00:00:00Z',attention:'waiting'},
  {id:'missing-a',createdAt:'invalid',running:true},
 ],{byCreatedAt:true});
 expect(result.flatMap(g=>g.sessions.map(s=>s.id))).toEqual(['a','z','missing-a','missing-z']);
 expect(result.at(-1)?.label).toBe('更早');
});


it('uses recent conversation time for both buckets and order rather than creation or telemetry',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
 try{
  const rows=[
   {id:'fresh-talk',createdAt:'2026-10-04T00:00:00Z',lastActivityAt:'2026-10-06T11:00:00Z',updatedAt:'2026-10-04T00:00:00Z',running:true},
   {id:'newer-project',createdAt:'2026-10-05T00:00:00Z',lastActivityAt:'2026-10-05T11:00:00Z',updatedAt:'2026-10-06T12:00:00Z',attention:'waiting'},
  ];
  expect(sessionGroups(rows,{byActivity:true}).map(g=>[g.label,g.sessions.map(s=>s.id)])).toEqual([
   ['今天',['fresh-talk']],['昨天',['newer-project']],
  ]);
 }finally{vi.useRealTimers();}
});

it('uses valid native activity fallbacks, absolute timestamp ties and stable legacy streaming time',()=>{
 expect(conversationActivityAt({lastActivityAt:'invalid',updatedAt:'1970-01-01T00:00:00Z'})).toBe('1970-01-01T00:00:00Z');
 expect(conversationActivityAt({updatedAt:'invalid',createdAt:'2026-10-04T00:00:00Z'})).toBe('2026-10-04T00:00:00Z');
 expect(orderRecentSessions([
  {id:'z',lastActivityAt:'2026-10-06T10:00:00Z'},
  {id:'a',lastActivityAt:'2026-10-06T12:00:00+02:00'},
  {id:'epoch',updatedAt:'1970-01-01T00:00:00Z'},
  {id:'missing-z'},{id:'missing-a',updatedAt:'invalid'},
 ]).map(s=>s.id)).toEqual(['a','z','epoch','missing-a','missing-z']);
 const stable=createSidebarOrder(),a={id:'a',running:true,updatedAt:'2026-10-06T10:00:00Z'},b={id:'b',running:true,updatedAt:'2026-10-06T11:00:00Z'};
 stable.snapshot([a,b]);
 expect(orderRecentSessions(stable.snapshot([{...a,updatedAt:'2026-10-06T12:00:00Z'},b])).map(s=>s.id)).toEqual(['b','a']);
 expect(orderRecentSessions(stable.snapshot([{...a,lastActivityAt:'2026-10-06T12:00:00Z'},b])).map(s=>s.id)).toEqual(['a','b']);
});
