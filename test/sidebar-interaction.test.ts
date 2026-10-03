// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createSidebarInteraction } from '../public/sidebar-interaction.js';
afterEach(()=>{vi.useRealTimers();document.body.replaceChildren();});
it('keeps the action button clickable while a running conversation updates the sidebar',()=>{
  vi.useFakeTimers();const list=document.createElement('ul');document.body.append(list);
  const controls=createSidebarInteraction(list);let opened=false;
  const paint=()=>{list.innerHTML='<li class="session-item"><button class="more">对话操作</button></li>';list.querySelector('button')!.addEventListener('click',()=>{opened=true;controls.menu(true);});};
  controls.render(paint);const anchor=list.querySelector('button')!;
  anchor.dispatchEvent(new Event('pointerdown',{bubbles:true}));
  controls.render(paint);controls.render(paint);
  expect(anchor.isConnected).toBe(true);
  document.dispatchEvent(new Event('pointerup',{bubbles:true}));anchor.click();vi.runOnlyPendingTimers();
  expect(opened).toBe(true);expect(anchor.isConnected).toBe(true);
  controls.menu(false);vi.runOnlyPendingTimers();expect(anchor.isConnected).toBe(false);
  controls.dispose();expect(vi.getTimerCount()).toBe(0);
});
