// Entry of the Diff panel's browser bundle (built by scripts/build-vendor.mjs).
// Only what public/diff-view.js uses is re-exported, so esbuild can drop the rest.
export { FileDiff, VirtualizedFileDiff, Virtualizer, parsePatchFiles } from "@pierre/diffs";
