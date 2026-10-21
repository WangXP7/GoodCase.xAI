// 浏览器冒烟测试：真实 Chromium 走完整用户流程
// 运行：node test/ui-smoke.mjs
// 断言：首页渲染 → 提问 → 步骤动线 → 来源卡片 → 流式回答 → 引用角标可点击跳转 → 无控制台错误 → 截图
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pw from 'file:///C:/Users/xp772/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';

const { chromium } = pw;
const PORT = 3218;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = resolve(import.meta.dirname, 'shots');
mkdirSync(SHOTS, { recursive: true });

process.env.PORT = String(PORT);
const { server } = await import('../server.js');
await new Promise((r) => server.once('listening', r));
console.log(`[ui] 服务已启动 ${BASE}`);

const QUESTION = 'DeepSeek V4.1 Flash 模型有哪些新特性？';

const browser = await chromium.launch({
  executablePath: 'C:/Users/xp772/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  args: ['--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.message || String(e))));
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });

let passed = 0;
const failures = [];
async function step(name, fn, timeoutMs = 60000) {
  const timer = setTimeout(() => {
    failures.push(name);
    console.log(`  ✗ ${name}（超时）`);
  }, timeoutMs);
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  ✗ ${name}\n    ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ---- 1. 首页 ----
console.log('\n[1] 首页');
await step('页面加载：标题/输入框/示例问题/模型徽章', async () => {
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#home:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#ask-input', { timeout: 5000 });
  const chips = await page.locator('.chip').count();
  assert.equal(chips, 4, `应有 4 个示例问题，实际 ${chips}`);
  const badge = await page.locator('.model-badge').textContent();
  assert.ok(badge.includes('deepseek-flash'));
  assert.equal(await page.title(), '灵犀搜索 · AI 搜索引擎');
  await page.screenshot({ path: resolve(SHOTS, 'ui-01-home.png') });
});

// ---- 2. 提问并等待回答 ----
console.log('\n[2] 提问 → 流式回答');
await step('提交问题后出现对话卡片与步骤动线', async () => {
  await page.fill('#ask-input', QUESTION);
  await page.press('#ask-input', 'Enter');
  await page.waitForSelector('.turn', { timeout: 10000 });
  await page.waitForSelector('.step[data-step="search"][data-state="active"], .step[data-step="search"][data-state="done"]', { timeout: 15000 });
  await page.screenshot({ path: resolve(SHOTS, 'ui-02-searching.png') });
}, 30000);

await step('来源卡片渲染（可点击、含编号与图标）', async () => {
  await page.waitForSelector('.src-card', { timeout: 120000 });
  const cards = page.locator('.src-card');
  const n = await cards.count();
  assert.ok(n >= 1, `应有来源卡片，实际 ${n}`);
  const first = cards.first();
  const href = await first.getAttribute('href');
  assert.ok(/^https?:\/\//.test(href), `来源链接无效：${href}`);
  assert.equal(await first.getAttribute('target'), '_blank');
  const badge = await first.locator('.src-n').textContent();
  assert.equal(badge.trim(), '1', '首个来源编号应为 1');
}, 150000);

await step('思考过程面板展示思维链', async () => {
  await page.waitForSelector('.think:not([hidden])', { timeout: 120000 });
  await page.waitForFunction(() => {
    const b = document.querySelector('.think-body');
    return b && b.textContent.length > 20;
  }, { timeout: 120000 });
}, 150000);

await step('回答流式输出完成且包含引用角标', async () => {
  await page.waitForFunction(() => {
    const a = document.querySelector('.answer');
    return a && a.textContent.length > 200;
  }, null, { timeout: 240000 });
  // 等待完成态（操作栏出现）
  await page.waitForSelector('.turn-actions:not([hidden])', { timeout: 240000 });
  const cites = await page.locator('.answer .cite').count();
  assert.ok(cites >= 1, `回答应包含引用角标，实际 ${cites}`);
  const steps = await page.locator('.step[data-state="done"]').count();
  assert.equal(steps, 4, `4 个步骤应全部完成，实际 ${steps}`);
  const answerText = await page.locator('.answer').textContent();
  assert.ok(answerText.length > 300, `回答过短：${answerText.length}`);
  await page.screenshot({ path: resolve(SHOTS, 'ui-03-answer.png'), fullPage: false });
  console.log(`    · 回答 ${answerText.length} 字 · 引用角标 ${cites} 个`);
}, 250000);

// ---- 3. 引用跳转 ----
console.log('\n[3] 引用跳转');
await step('点击引用角标打开原文（新标签页）', async () => {
  const cite = page.locator('.answer .cite').first();
  const n = Number(await cite.getAttribute('data-n'));
  let popup = null;
  try {
    const [p] = await Promise.all([
      page.waitForEvent('popup', { timeout: 15000 }),
      cite.click(),
    ]);
    popup = p;
    // popup 初始为 about:blank，轮询等待导航提交
    let url = '';
    for (let i = 0; i < 20 && !/^https?:\/\//.test(url); i++) {
      await popup.waitForTimeout(300);
      url = popup.url();
    }
    assert.ok(/^https?:\/\//.test(url), `跳转 URL 无效：${url}`);
    // 角标编号应与该标签页来源一致（浏览器导航可能补尾斜杠，归一化后比较）
    const norm = (u) => u.replace(/\/+$/, '');
    const srcHref = await page.locator('.src-card').nth(n - 1).getAttribute('href');
    assert.equal(norm(url), norm(srcHref), `角标 [${n}] 应跳转到第 ${n} 个来源`);
  } finally {
    await popup?.close().catch(() => {});
  }
}, 40000);

// ---- 4. 复制与元信息 ----
console.log('\n[4] 操作与元信息');
await step('复制按钮与耗时元信息可见', async () => {
  await page.waitForSelector('.act-meta', { timeout: 5000 });
  const meta = await page.locator('.act-meta').textContent();
  assert.ok(/\d+\.\d+s/.test(meta), `元信息应含耗时：${meta}`);
  assert.ok(meta.includes('来源'), '元信息应含来源数');
});

// ---- 5. 多轮 ----
console.log('\n[5] 多轮对话');
await step('追问后新增第二轮卡片', async () => {
  assert.equal(await page.locator('.send-btn.is-stop').count(), 0, '提交前应处于空闲状态');
  await page.fill('#ask-input', '它的 API 调用价格是多少？');
  assert.equal(await page.inputValue('#ask-input'), '它的 API 调用价格是多少？', '输入应生效');
  await page.press('#ask-input', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.turn').length === 2, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const turns = document.querySelectorAll('.turn');
    const last = turns[turns.length - 1];
    const a = last.querySelector('.answer');
    return a && a.textContent.length > 100;
  }, null, { timeout: 240000 });
}, 250000);

// ---- 6. 新对话 ----
console.log('\n[6] 新对话重置');
await step('点击新对话回到首页', async () => {
  await page.click('#btn-new');
  await page.waitForSelector('#home:not([hidden])', { timeout: 5000 });
  assert.equal(await page.locator('.turn').count(), 0);
  await page.screenshot({ path: resolve(SHOTS, 'ui-04-newchat.png') });
});

// ---- 7. 移动端 ----
console.log('\n[7] 移动端视口');
await step('390×844 视口正常渲染（无横向溢出）', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#home:not([hidden])');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `移动端出现横向溢出 ${overflow}px`);
  await page.screenshot({ path: resolve(SHOTS, 'ui-05-mobile.png') });
});

// ---- 8. 控制台清洁 ----
console.log('\n[8] 控制台');
await step('全程无 JS 错误与资源 404', async () => {
  const real = errors.filter((e) => !/favicon/i.test(e));
  assert.equal(real.length, 0, `控制台错误：\n${real.join('\n')}`);
});

// ---- 汇总 ----
console.log(`\n结果：${passed} 通过，${failures.length} 失败`);
await browser.close();
server.close();
setTimeout(() => process.exit(failures.length ? 1 : 0), 500);
