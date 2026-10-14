const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const observations = [];
  for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto('file:///' + path.join(root, 'index.html').replaceAll('\\', '/'));
    await page.waitForTimeout(150);
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, contentWidth: document.documentElement.scrollWidth, contentHeight: document.documentElement.scrollHeight }));
    const filename = width === 1600 ? 'preview-desktop.png' : width === 390 ? 'preview-mobile.png' : `preview-${width}.png`;
    await page.screenshot({ path: path.join(root, 'docs', filename), fullPage: true });
    let controlsFit = true;
    for (const [mode, selectors] of [['engineering', ['#diagnostic', '.engineering-only']], ['navigation', ['[data-route="2"]', '.navigation-only']]]) {
      await page.locator(`[data-mode="${mode}"]`).click();
      const button = await page.locator(selectors[0]).boundingBox(), parent = await page.locator(selectors[1]).boundingBox();
      controlsFit &&= button.y + button.height <= parent.y + parent.height + 1;
      if (width === 1440 || width === 390) await page.screenshot({ path: path.join(root, 'docs', `preview-${mode}-${width}.png`), fullPage: true });
    }
    observations.push({ ...size, controlsFit, pass: size.contentWidth <= width && controlsFit });
  }
  const report = ['# 布局复核', '', `执行时间：${new Date().toISOString()}`, '', '| 视窗 | 内容尺寸 | 横向溢出 | 导航与诊断控件位于面板内 |', '| --- | --- | --- | --- |', ...observations.map(s => `| ${s.width} × ${s.height} | ${s.contentWidth} × ${s.contentHeight} | ${s.contentWidth > s.width ? '存在' : '无'} | ${s.controlsFit ? '是' : '否'} |`), '', '桌面按紧凑驾驶舱排列；窄屏保留可读尺寸，纵向滚动。', ''];
  fs.writeFileSync(path.join(root, 'docs', 'LAYOUT_QA.md'), report.join('\n'));
  console.log(report.join('\n'));
  await browser.close();
  if (observations.some(item => !item.pass)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
