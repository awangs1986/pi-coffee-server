// Read-only DOM measurements, also usable with any browser automation evaluate API.
export function measureLayout() {
  const r = selector => document.querySelector(selector).getBoundingClientRect();
  const visible = selector => r(selector).width > 0;
  const main = r('main');
  const footer = r('#project-controls').height;
  const card = r('#composer-card');
  const failures = [];
  if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) failures.push('page overflow');
  for (const selector of ['#sidebar', '#workspace-panel', '#diff-dialog']) {
    if (visible(selector) && r(selector).bottom > innerHeight + 1) failures.push(`${selector} height`);
  }
  const filesOpen = document.querySelector('#app').classList.contains('files-open');
  for (const selector of ['#checkpoint-workspace', '#files-toggle', '#send']) {
    // With the Checkout panel open, its toggle intentionally sits over the panel's top-right corner.
    const bounds = selector === '#files-toggle' && filesOpen ? { left: 0, right: innerWidth } : main;
    if (visible(selector) && (r(selector).right > bounds.right + 1 || r(selector).bottom > innerHeight + 1 || r(selector).left < bounds.left - 1)) failures.push(`${selector} bounds`);
  }
  // Diff total and 创建 PR live in the composer card's task strip.
  for (const selector of ['#branch-diff', '#pull-request']) {
    if (visible(selector) && (r(selector).right > card.right + 1 || r(selector).left < card.left - 1 || r(selector).bottom > card.bottom + 1)) failures.push(`${selector} bounds`);
  }
  if (footer > 52) failures.push('task strip exceeds one row');
  if (r('#prompt').height < 60) failures.push('input too short');
  return { viewport: [innerWidth, innerHeight], footer, failures };
}
