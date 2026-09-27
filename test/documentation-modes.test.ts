import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || ["node_modules", "dist"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith(".md") ? [path] : [];
  });
}

function retiredModeNames(text: string): string[] {
  // Historical filenames/URLs remain valid citations, not selectable modes.
  const prose = text.replace(/`(?:N|\d+(?:\.\d+)?)% Full`/g, "")
    .replace(/danger-full-access/g, "")
    .replace(/https?:\/\/[^\s)<>]+/g, "")
    .replace(/[\w./-]+\.(?:md|ts|js|json)\b/g, "");
  return prose.match(/\b(?:simple|lean|full)\b/gi) ?? [];
}

describe("Chat/Work documentation contract", () => {
  it("detects retired commands, tables and prose while allowing source citations", () => {
    expect(retiredModeNames("/harness simple | Lean | Full")).toHaveLength(3);
    expect(retiredModeNames("Chat / Work [audit](docs/gitea-full-audit.md)")).toEqual([]);
    expect(retiredModeNames("Codex sandbox: danger-full-access")).toEqual([]);
    expect(retiredModeNames("Context Usage: `N% Full` or `46% Full`")).toEqual([]);
  });

  it("keeps retired mode vocabulary out of every maintained Markdown document", () => {
    const hits = markdownFiles(root).flatMap((path) => readFileSync(path, "utf8").split("\n")
      .flatMap((line, index) => retiredModeNames(line).length ? [`${relative(root, path)}:${index + 1}`] : []));
    expect(hits, "Retire obsolete design text; do not rename old behavior to Chat/Work").toEqual([]);
  });
});
