import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error browser module
import { syncDigest } from '../public/sync-digest.js';
describe('bounded synchronization receipt digests',()=>{
 it('matches SHA-256 for empty, Unicode, padding boundaries and maximum batches',()=>{
  for(const text of ['', 'abc', '😀工具', ...[55,56,63,64,65,1024,65536].map(n=>'x'.repeat(n))]) expect(syncDigest(text)).toBe(createHash('sha256').update(text).digest('hex'));
 });
});
