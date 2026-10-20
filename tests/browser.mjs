import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.RECALL_PLAYWRIGHT_PATH
    ? pathToFileURL(process.env.RECALL_PLAYWRIGHT_PATH).href
    : 'playwright'
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.RECALL_BROWSER ? { executablePath: process.env.RECALL_BROWSER } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const base = process.env.RECALL_URL || 'http://127.0.0.1:4173';
let passed = 0;
async function check(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
try {
  await page.goto(base);
  await page.getByRole('heading', { name: '让知识，慢慢变牢固。' }).waitFor();
  await check('初始 5 科目且没有虚构用户记录', async () => {
    assert.equal(await page.locator('.subject-row').count(), 5);
    assert.equal(await page.locator('.metrics strong').nth(2).innerText(), '0题');
  });
  await page.locator('#top-add').click();
  await check('上传图片、多行与 HTML 文本录入', async () => {
    await page.locator('[name=content]').fill('虚构示例：逻辑门化简\n<script>alert(1)</script>');
    await page.locator('[name=answer]').fill('A + AB = A\n使用吸收律');
    await page.locator('[name=reason]').fill('未识别吸收律');
    await page.locator('[name=tags]').fill('逻辑门，化简');
    await page
      .locator('#image-input')
      .setInputFiles({
        name: 'sample.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
          'base64',
        ),
      });
    await page.locator('#image-preview img').waitFor();
    await page.locator('#save-question').click();
    await page.locator('.question-card').waitFor();
    assert.equal(await page.locator('.question-card').count(), 1);
    assert.match(await page.locator('.question-card h2').innerText(), /<script>/);
  });
  await check('刷新后图片与错题持久化', async () => {
    await page.reload();
    await page.locator('.question-thumbnail').waitFor();
    assert.equal(
      await page.locator('.question-thumbnail').evaluate((i) => i.complete && i.naturalWidth > 0),
      true,
    );
  });
  await check('搜索及科目筛选', async () => {
    await page.locator('#search').fill('逻辑门');
    assert.equal(await page.locator('.question-card').count(), 1);
    await page.locator('#subject-filter').selectOption('subject-2');
    assert.equal(await page.locator('.question-card').count(), 0);
    await page.locator('#subject-filter').selectOption('');
    await page.locator('#search').fill('');
  });
  await check('编辑保留图片和创建信息', async () => {
    await page.getByRole('button', { name: '查看 / 编辑' }).click();
    await page.locator('[name=reason]').fill('更新：需要先尝试代数化简');
    await page.locator('#save-question').click();
    await page.locator('.question-card').waitFor();
    await page.reload();
    await page.getByRole('button', { name: '查看 / 编辑' }).click();
    assert.match(await page.locator('[name=reason]').inputValue(), /更新/);
    assert.equal(await page.locator('#image-preview img').count(), 1);
    await page.getByRole('button', { name: '取消', exact: true }).click();
  });
  await check('科目添加、编辑及禁止删除有题科目', async () => {
    await page.goto(base + '/#settings');
    await page.locator('#subject-form input').fill('测试课程');
    await page.locator('#subject-form button').click();
    await page.getByText('测试课程', { exact: true }).waitFor();
    const row = page.locator('.subject-manager>div').filter({ hasText: '测试课程' });
    await row.getByRole('button', { name: '编辑' }).click();
    await page.locator('#rename-subject input').fill('改名课程');
    await page
      .locator('#rename-subject button[type=submit], #rename-subject button.primary')
      .click();
    await page.getByText('改名课程', { exact: true }).waitFor();
    await page.locator('[data-subject-delete="subject-1"]').click();
    await page.locator('#confirm-dialog').click();
    await page.getByRole('status').filter({ hasText: '仍有错题' }).waitFor();
    await page.locator('#cancel-dialog').click();
  });
  if (process.env.RECALL_PHASE === '1') {
    await check('删除需要确认，取消保留、确认移除', async () => {
      await page.goto(base + '/#library');
      await page.locator('[data-delete]').click();
      await page.locator('#cancel-dialog').click();
      assert.equal(await page.locator('.question-card').count(), 1);
      await page.locator('[data-delete]').click();
      await page.locator('#confirm-dialog').click();
      await page.locator('.question-card').waitFor({ state: 'detached' });
      await page.reload();
      assert.equal(await page.locator('.question-card').count(), 0);
    });
  } else {
    await import('./browser-extended.mjs').then((m) =>
      m.run({ page, context, base, check, assert }),
    );
  }
  if (!process.env.RECALL_PHASE) {
    await check('关闭整个浏览器后重新启动，错题、图片、历史仍保留', async () => {
      const profile = await mkdtemp(join(tmpdir(), 'recall-test-'));
      let persistent;
      const launch = {
        headless: true,
        ...(process.env.RECALL_BROWSER ? { executablePath: process.env.RECALL_BROWSER } : {}),
      };
      try {
        persistent = await chromium.launchPersistentContext(profile, launch);
        let p = await persistent.newPage();
        await p.goto(base);
        await p.locator('h1').waitFor();
        await p.evaluate(async () => {
          const db = await import('./src/db.js');
          const q = await db.saveQuestion({
            content: '重启持久化验证（虚构）',
            answer: '示例答案',
            reason: '测试用途',
            tags: ['测试'],
            images: [
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
            ],
            subjectId: 'subject-1',
          });
          await db.submitReview(q.id, q.revision, 'good');
        });
        await persistent.close();
        persistent = await chromium.launchPersistentContext(profile, launch);
        p = await persistent.newPage();
        await p.goto(base + '/#library');
        await p.locator('.question-card').waitFor();
        assert.equal(await p.locator('.question-card').count(), 1);
        assert.equal(
          await p.locator('.question-thumbnail').evaluate((i) => i.complete && i.naturalWidth > 0),
          true,
        );
        const s = await p.evaluate(async () => await (await import('./src/db.js')).snapshot());
        assert.equal(s.reviews.length, 1);
      } finally {
        await persistent?.close();
        await rm(profile, { recursive: true, force: true });
      }
    });
  }
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed: ${passed}; uncaught errors: ${errors.length}`);
} finally {
  await context.close();
  await browser.close();
}
