import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { renderRuntimeStatus } from '../public/runtime-status.js';

it('shows persistent Chinese emergency guidance and clears it after recovery', () => {
  const dom = new JSDOM('<div id="runtime-banner" class="hidden"></div>');
  const banner = dom.window.document.querySelector('#runtime-banner')!;
  renderRuntimeStatus(banner,{mode:'emergency',reason:'plugin_unavailable'});
  expect(banner.classList.contains('hidden')).toBe(false);
  expect(banner.textContent).toContain('Pi 应急模式');expect(banner.textContent).toContain('Codex 不受影响');
  renderRuntimeStatus(banner,{mode:'normal'});
  expect(banner.classList.contains('hidden')).toBe(true);expect(banner.textContent).toBe('');
  dom.window.close();
});
