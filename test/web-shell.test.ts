import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('public/index.html', 'utf8');
const css = readFileSync('public/app.css', 'utf8');
const app = readFileSync('public/app.js', 'utf8');
const diffView = readFileSync('public/diff-view.js', 'utf8');
const render = readFileSync('public/render.js', 'utf8');

describe('compact Agent composer shell', () => {
  it('keeps the legacy model state seams while hiding them from the composer', () => {
    expect(html).toContain('id="agent-menu-btn"');
    expect(html).toContain('aria-haspopup="menu"');
    for (const id of ['model-source', 'model', 'thinking']) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toMatch(new RegExp(`id="${id}"[^>]*tabindex="-1"`));
    }
    expect(html).not.toContain('model-controls');
    expect(app).toContain('function renderAgentSettings()');
    expect(app).toContain('function renderAgentPane(kind)');
  });

  it('uses a sparse rounded composer card with one horizontal attachment rail', () => {
    expect(css).toContain('--thread-width: 828px;');
    expect(css).toContain('--composer-width: 860px;');
    expect(css).toMatch(/\.attachments \{[\s\S]*flex-wrap: nowrap;[\s\S]*overflow-x: auto;/);
    expect(css).toMatch(/\.upload-chip \{[\s\S]*width: 220px;[\s\S]*height: 64px;/);
    expect(css).toContain('bottom: var(--composer-offset);');
  });
});

describe('light palette', () => {
  it('is pure white with neutral grayscale surfaces instead of slate blue', () => {
    expect(css).toContain('--bg: #ffffff;');
    expect(css).toContain('--bg-side: #ffffff;');
    expect(css).toContain('--bg-subtle: #f4f4f5;');
    expect(css).toContain('--border: #e6e6e8;');
    expect(css).not.toContain('--bg-side: #f8fafc;');
    expect(css).not.toContain('--bg-subtle: #f1f5f9;');
    expect(css).not.toContain('--border: #e2e8f0;');
  });
});

describe('Gitea context strip', () => {
  it('keeps repository/branch context visible while collapsing management actions', () => {
    expect(html).toContain('class="project-context hidden"');
    expect(app).toContain("$('#project-controls').classList.remove('hidden')");
    // One composer card: prompt, toolbar, then the repository/branch strip with Diff and PR.
    expect(html).toMatch(/<div class="composer-card" id="composer-card">\s*<form class="composer"[\s\S]*<\/form>\s*<section id="project-controls"/);
    for (const id of ['task-details-btn', 'task-details', 'branch-diff', 'pull-request', 'strip-kind', 'task-branch']) expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain('class="project-manage"');
    expect(html).not.toContain('id="turn-diff"');
    expect(html.match(/id="diff-close"/g)).toHaveLength(1);
    for (const id of ['project-select', 'start-branch', 'project-add', 'project-discover', 'show-active', 'show-archive']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(app).toContain('function renderProjectContext()');
    expect(app).toContain('ui.projectSelect.disabled = lockedToConversation;');
    expect(app).toContain('ui.startBranch.disabled = lockedToConversation;');
  });
});

describe('Checkout review and Gitea synchronization surfaces', () => {
  it('shows synchronization, checkpoint and real pull request actions beside Diff/Checks', () => {
    for (const id of ['files-diff', 'files-checks', 'files-close', 'wt-download', 'workspace-summary', 'workspace-list', 'workspace-detail', 'view-all-changes', 'sync-state', 'checkpoint-workspace', 'pull-request']) {
      expect(html).toContain(`id="${id}"`);
    }
    for (const id of ['files-tree', 'files-uploads', 'files-refresh', 'file-path', 'file-list', 'artifact-preview']) {
      expect(html).not.toContain(`id="${id}"`);
    }
    expect(app).toContain('function renderWorkspaceList(data=workspaceChanges)');
    expect(app).toContain('function middleTruncate(path,max=24)');
    expect(app).toContain('function closeWorkspaceDetail()');
    expect(app).toContain('async function downloadWorkspacePatch()');
    expect(app).toContain("action:'checkpoint'");
    expect(app).toContain("changes?.checkpointPaths || []");
    expect(app).toContain("action:'pull_request'");
    expect(app).toContain("data.stale?'远端刷新失败 · 基线可能陈旧'");
    expect(app).not.toContain("action:'merge_preview'");
    expect(app).not.toContain("action:'merge'");
    expect(css).toContain('.wt-file');
    expect(css).toContain('.workspace-panel.detail-open .workspace-list');
  });

  it('keeps the transcript-only changed-files card and per-file Diff focus', () => {
    expect(app).toContain('function changedFilesCard(data)');
    expect(app).toContain('function maybeRenderChangesCard');
    // Per-file patches for the Diff body (a section cut by the Host's cap is refetched whole).
    expect(diffView).toContain('export function patchSections(patch, truncated = false)');
    expect(app).toContain("showDiffDialog(file.path,{scope:'turn'})");
    expect(css).toContain('.changes-card[open] > .changes-card-head::before');
  });

  it('adds a center reconnection banner, an upload log card, and in-panel artifact preview', () => {
    expect(html).toContain('id="conn-banner"');
    expect(css).toContain('.conn-banner');
    expect(app).toContain("ui.connBanner.classList.toggle('hidden', connected)");
    expect(app).toContain('function renderUploadLogCard()');
    expect(app).toContain("renderUploadLogCard(); // relink rows with the fresh token");
    expect(app).toContain('async function showWorkspacePreview(path)');
    expect(css).toContain('.upload-log-row');
  });
});

describe('Markdown and Diff rendering safeguards', () => {
  it('keeps copy/data attributes through sanitization and supports optional raw Diff columns', () => {
    expect(render).toContain("button.closest('.codeblock')");
    expect(render).toContain('ADD_ATTR');
    expect(render).toContain("'data-workspace-path'");
    expect(render).toContain("'data-workspace-download'");
    expect(render).toContain('renderPatchText(patch, { cursor = false }');
    expect(render).toContain("event.target.closest('[data-copy]')");
  });
});
