// Run against serve-layout-fixture.mjs only: no real accounts or model turns.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {measureLayout} from './check-layout.mjs';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
try {
 const page=await browser.newPage({viewport:{width:1280,height:796}});
 await page.goto('http://127.0.0.1:'+(process.env.PI_COFFEE_LAYOUT_PORT || '4175'));
 await page.getByRole('button',{name:/^布局验收 0/}).click();
 await page.getByRole('button',{name:'Checkpoint',exact:true}).waitFor();
 assert.equal(await page.locator('#workspace-panel').isVisible(),false);
 await page.getByRole('button',{name:'打开变更面板',exact:true}).click();
 await page.locator('.wt-file').first().waitFor();
 for(const collapsed of [false,true]) {
  await page.setViewportSize({width:1280,height:796});
  if(collapsed)await page.getByRole('button',{name:'折叠侧栏',exact:true}).click();
  for(const [width,height] of [[1440,900],[1280,796],[1110,640],[1100,640],[820,640],[390,844],[1280,480]]) {
   await page.setViewportSize({width,height});
   const result=await page.evaluate(measureLayout);console.log(JSON.stringify({...result,collapsed}));assert.deepEqual(result.failures,[]);
  }
 }
 await page.getByRole('button',{name:'关闭 Checkout 面板',exact:true}).click();
 for(const [width,height] of [[1280,796],[390,844],[820,480],[1280,480]]) {
  await page.setViewportSize({width,height});
  await page.locator('#stats').click();
  const panel=await page.evaluate(()=>{const p=document.querySelector('#stats-pop'),r=p.getBoundingClientRect();return {modal:p.matches(':modal'),rows:[...p.querySelectorAll('.legend-label')].map(e=>e.textContent),bounds:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,overflow:p.scrollWidth>p.clientWidth};});
  assert.equal(panel.modal,true);assert.equal(panel.bounds,true);assert.equal(panel.overflow,false);
  assert.deepEqual(panel.rows,['System prompt','Tool definitions','Rules','Skills','MCP & dynamic tools','Subagent definitions','Conversation']);
  await page.locator('#stats-close').press('Escape');
  assert.equal(await page.locator('#stats-pop').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'stats');
  await page.locator('#stats').click();await page.locator('#stats-close').click();
 }
 // Diff: docked beside the chat on wide screens, a full-screen overlay when narrow; never modal.
 await page.getByRole('button',{name:'打开变更面板',exact:true}).click();
 await page.locator('.wt-file').first().click();
 await page.locator('#diff-content .review-file').first().waitFor();
 for(const [width,height] of [[1440,900],[1280,796],[1100,640],[390,844],[820,480]]) {
  await page.setViewportSize({width,height});
  const bounds=await page.locator('#diff-dialog').evaluate(p=>{const r=p.getBoundingClientRect(),m=document.querySelector('main').getBoundingClientRect();return {modal:p.matches(':modal'),fits:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,overflow:p.scrollWidth>p.clientWidth,docked:r.left>=m.right-1&&m.width>=300,full:r.width>=innerWidth-1&&r.height>=innerHeight-1};});
  assert.deepEqual({modal:bounds.modal,fits:bounds.fits,overflow:bounds.overflow},{modal:false,fits:true,overflow:false});
  assert.equal(width>=1100 ? bounds.docked : bounds.full,true,JSON.stringify({width,bounds}));
  const layout=await page.evaluate(measureLayout);console.log(JSON.stringify({...layout,diff:true}));assert.deepEqual(layout.failures,[]);
 }
 await page.setViewportSize({width:1280,height:796});
 await page.getByRole('button',{name:'Split',exact:true}).click();
 assert.equal(await page.locator('.review-code').first().getAttribute('data-layout'),'split');
 assert.match(await page.locator('.review-code').first().innerText(),/merge-base[\s\S]*mergeBase/);
 // 最近一轮 lists only the files the latest turn changed.
 await page.locator('#diff-scope').click();
 await page.getByRole('menuitemradio',{name:/最近一轮/}).click();
 await page.locator('#diff-scope-label',{hasText:'最近一轮'}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('#diff-content .review-file').length===2);
 await page.getByRole('button',{name:'关闭 Diff',exact:true}).press('Escape');
 assert.equal(await page.locator('#diff-dialog').isVisible(),false);
 await page.getByRole('button',{name:'关闭 Checkout 面板',exact:true}).click();
 // The composer strip opens the same Diff and creates the PR in one click.
 await page.locator('#branch-diff').click();
 await page.locator('#diff-content .review-file').first().waitFor();
 await page.getByRole('button',{name:'关闭 Diff',exact:true}).click();
 await page.getByRole('button',{name:'创建 PR',exact:true}).click();
 await page.locator('#modal-ok').click();
 await page.locator('#pull-request-label',{hasText:'PR #12'}).waitFor();
 await page.getByRole('textbox',{name:'输入',exact:true}).fill('Synthetic draft\n'.repeat(35));
 assert.deepEqual((await page.evaluate(measureLayout)).failures,[]);
 await page.getByRole('button',{name:'任务详情',exact:true}).click();
 await page.getByRole('button',{name:'详情',exact:true}).click();
 assert.match(await page.locator('#modal-text').textContent(),/00000000-0000-4000-8000-000000000000/);
 console.log('Compact layout passed');
} finally {await browser.close();}
