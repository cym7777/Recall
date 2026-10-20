import { mkdir } from 'node:fs/promises';

export async function run({ page, context, base, check, assert }) {
  const titles = {
    dashboard: '让知识，慢慢变牢固。',
    library: '我的错题库',
    new: '记录一道错题',
    review: '今日复习',
    stats: '学习统计',
    settings: '设置与备份',
  };
  const waitForPage = (route) =>
    page.getByRole('heading', { name: titles[route], exact: true }).waitFor();
  const screenshotDir = process.env.RECALL_SCREENSHOT_DIR || 'docs/screenshots';
  await mkdir(screenshotDir, { recursive: true });
  await check('复习默认隐藏答案，揭晓后记录一次，刷新后持久化', async () => {
    await page.goto(base + '/#review');
    await page.locator('#reveal-answer').waitFor();
    assert.equal(await page.locator('.answer-section').count(), 0);
    await page.locator('#reveal-answer').click();
    assert.match(await page.locator('.answer-section').innerText(), /吸收律/);
    await page.locator('[data-rating=good]').dblclick();
    await page.getByRole('heading', { name: '今天的待复习已完成' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '今天的待复习已完成' }).waitFor();
    const s = await page.evaluate(async () => {
      const db = await import('./src/db.js');
      return db.snapshot();
    });
    assert.equal(s.reviews.length, 1);
    assert.equal(s.questions[0].level, 2);
  });
  await check('并发重复提交仅一次，过期编辑拒绝覆盖', async () => {
    const result = await page.evaluate(async () => {
      const db = await import('./src/db.js');
      const s = await db.snapshot(),
        original = s.questions[0];
      const q = await db.saveQuestion({
        ...original,
        id: undefined,
        content: '并发复习测试（虚构）',
        images: [],
      });
      await Promise.all([
        db.submitReview(q.id, q.revision, 'hard'),
        db.submitReview(q.id, q.revision, 'hard'),
      ]);
      let conflict = false;
      try {
        await db.saveQuestion(q);
      } catch {
        conflict = true;
      }
      return { state: await db.snapshot(), conflict };
    });
    assert.equal(result.state.reviews.length, 2);
    assert.equal(result.conflict, true);
  });
  if (process.env.RECALL_PHASE === '2') return;
  let backup;
  await check('导出包含图片与复习历史，JSON 下载可读取', async () => {
    await page.goto(base + '/#settings');
    const download = page.waitForEvent('download');
    await page.locator('#export-backup').click();
    const file = await download;
    const stream = await file.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    backup = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(backup.questions.length, 2);
    assert.equal(backup.reviews.length, 2);
    assert.equal(backup.questions.filter((q) => q.images.length).length, 1);
  });
  await check('损坏文件与悬空引用导入不改变现有记录', async () => {
    for (const content of ['{broken', JSON.stringify({ ...backup, subjects: [] })]) {
      await page.locator('#import-backup').setInputFiles({
        name: 'invalid.json',
        mimeType: 'application/json',
        buffer: Buffer.from(content),
      });
      await page.locator('#toast.error').waitFor();
      assert.equal(await page.locator('#apply-import').count(), 0);
    }
    const n = await page.evaluate(
      async () => (await (await import('./src/db.js')).snapshot()).questions.length,
    );
    assert.equal(n, 2);
  });
  await check('导入预览、覆盖二次确认、取消安全与完整恢复', async () => {
    await page.evaluate(async () => {
      const db = await import('./src/db.js');
      const s = await db.snapshot();
      await db.deleteQuestion(s.questions.find((q) => q.images.length).id);
    });
    await page.locator('#import-backup').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.locator('#apply-import').click();
    await page.locator('#cancel-dialog').click();
    assert.equal(
      await page.evaluate(
        async () => (await (await import('./src/db.js')).snapshot()).questions.length,
      ),
      1,
    );
    await page.locator('#apply-import').click();
    await page.locator('#confirm-dialog').click();
    await page.getByRole('status').filter({ hasText: '数据导入完成' }).waitFor();
    await page.reload();
    await page.locator('#export-backup').waitFor();
    const restored = await page.evaluate(
      async () => await (await import('./src/db.js')).snapshot(),
    );
    assert.deepEqual(restored.questions, backup.questions);
    assert.deepEqual(restored.reviews, backup.reviews);
  });
  await check('真实保存记录驱动统计与概览', async () => {
    await page.goto(base + '/#stats');
    await page.locator('.chart').waitFor();
    assert.equal(await page.locator('.metrics strong').nth(0).innerText(), '2题');
    assert.equal(await page.locator('.metrics strong').nth(1).innerText(), '2次');
    assert.equal(await page.locator('.chart-column').count(), 14);
  });
  await check('同日与逾期数量，运行时本地跨天，刷新后待复习更新', async () => {
    await page.evaluate(async () => {
      const db = await import('./src/db.js');
      const s = await db.snapshot();
      const { today, addDays } = await import('./src/model.js');
      await db.transaction(['questions'], 'readwrite', (tx) => {
        s.questions.forEach((q, i) =>
          tx.objectStore('questions').put({ ...q, dueDate: addDays(today(), i === 0 ? -1 : 0) }),
        );
      });
    });
    await page.goto(base + '/#dashboard');
    await waitForPage('dashboard');
    assert.equal(await page.locator('.metrics strong').nth(0).innerText(), '1题');
    assert.equal(await page.locator('.metrics strong').nth(1).innerText(), '1题');
    const tomorrow = Date.now() + 86400000;
    await page.clock.install({ time: tomorrow });
    await page.reload();
    await page.locator('#nav-due').waitFor();
    assert.equal(await page.locator('#nav-due').innerText(), '2');
    await page.clock.setFixedTime(Date.now());
  });
  await check('图片粘贴、格式与大小限制', async () => {
    await page.locator('#top-add').click();
    await page.locator('[name=content]').fill('粘贴图片测试');
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2200;
      canvas.height = 1200;
      const c = canvas.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, 2200, 1200);
      c.fillStyle = '#000';
      c.font = '40px sans-serif';
      c.fillText('Fictional example A + AB = A', 50, 100);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'paste.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
    });
    await page.locator('#image-preview img').waitFor();
    const dimensions = await page
      .locator('#image-preview img')
      .evaluate((i) => ({ w: i.naturalWidth, bytes: i.src.length }));
    assert.equal(dimensions.w, 1800);
    assert.ok(dimensions.bytes < 1400000);
    await page
      .locator('#image-input')
      .setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await page.locator('#image-status').filter({ hasText: '仅支持' }).waitFor();
    assert.equal(await page.locator('#image-preview img').count(), 1);
    await page.locator('#image-input').setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(15 * 1024 * 1024 + 1),
    });
    await page.locator('#image-status').filter({ hasText: '不能超过 15 MB' }).waitFor();
  });
  await check('删除确认与历史级联删除', async () => {
    await page.goto(base + '/#library');
    await page.locator('.question-card').first().waitFor();
    const old = await page.locator('.question-card').count();
    assert.equal(old, 2);
    await page.locator('[data-delete]').first().click();
    await page.locator('#cancel-dialog').click();
    assert.equal(await page.locator('.question-card').count(), old);
    await page.locator('[data-delete]').first().click();
    await page.locator('#confirm-dialog').click();
    await page.waitForFunction(() => document.querySelectorAll('.question-card').length === 1);
    const data = await page.evaluate(async () => await (await import('./src/db.js')).snapshot());
    assert.equal(data.reviews.length, 1);
  });
  if (process.env.RECALL_PHASE === '3') return;
  await check('关闭重开页面后仍能读取本地数据', async () => {
    const p = await context.newPage();
    await p.goto(base + '/#library');
    await p.locator('.question-card').waitFor();
    assert.equal(await p.locator('.question-card').count(), 1);
    await p.close();
  });
  await check('测试环境注入存储配额错误后事务回滚', async () => {
    const result = await page.evaluate(async () => {
      const db = await import('./src/db.js');
      const before = await db.snapshot();
      let rejected = false;
      try {
        await db.transaction(['questions'], 'readwrite', (tx, set, fail) => {
          tx.objectStore('questions').clear();
          fail(new DOMException('模拟磁盘配额不足', 'QuotaExceededError'));
        });
      } catch {
        rejected = true;
      }
      return {
        rejected,
        unchanged: JSON.stringify(before) === JSON.stringify(await db.snapshot()),
      };
    });
    assert.equal(result.rejected, true);
    assert.equal(result.unchanged, true);
  });
  await check('独立测试数据准备与核心页面截图', async () => {
    await page.evaluate(async () => {
      const db = await import('./src/db.js');
      const { today, addDays } = await import('./src/model.js');
      const clean = await db.snapshot();
      await db.replaceData({
        format: 'recall-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        subjects: clean.subjects.filter((s) => s.id.startsWith('subject-')),
        questions: [],
        reviews: [],
      });
      const data = [
        [
          '二进制补码 11111010 对应的十进制数是多少？',
          '−6。按位取反再加一得到 6。',
          '忽略了最高位为符号位。',
          '补码',
        ],
        [
          '信源的熵 H(X) 如何计算？',
          'H(X) = −Σ p(x) log₂ p(x)。',
          '混淆信息量与平均信息量。',
          '信息熵',
        ],
        [
          '简述中断与轮询的区别。',
          '中断由事件触发处理；轮询由处理器循环检查状态。',
          '混淆两种响应机制。',
          '中断',
        ],
        [
          '求函数 f(x)=x² sin x 的导数。',
          'f′(x)=2x sin x + x² cos x。',
          '使用乘积求导法则。',
          '导数',
        ],
        [
          'Choose: She has lived here ___ 2020.',
          'since。since 后接时间起点。',
          '混淆 since 与 for。',
          '时态',
        ],
      ];
      for (let i = 0; i < data.length; i++) {
        const [content, answer, reason, tag] = data[i];
        await db.saveQuestion({
          content,
          answer,
          reason,
          tags: [tag],
          images: [],
          subjectId: `subject-${i + 1}`,
        });
      }
      const s = await db.snapshot();
      for (const q of s.questions.slice(0, 2)) await db.submitReview(q.id, q.revision, 'good');
      const fresh = await db.snapshot();
      await db.transaction(['questions'], 'readwrite', (tx) => {
        fresh.questions
          .filter((q) => q.level === 1)
          .forEach((q, i) =>
            tx.objectStore('questions').put({ ...q, dueDate: addDays(today(), i % 2 ? -2 : 0) }),
          );
      });
    });
    await page.reload();
    await page.locator('h1').waitFor();
    await page.locator('#toast.visible').waitFor({ state: 'detached' });
    for (const [route, name] of [
      ['dashboard', 'dashboard-desktop'],
      ['library', 'library-desktop'],
      ['new', 'editor-desktop'],
      ['review', 'review-desktop'],
      ['stats', 'stats-desktop'],
      ['settings', 'settings-desktop'],
    ]) {
      await page.goto(base + '/#' + route);
      await waitForPage(route);
      await page.screenshot({ path: `${screenshotDir}/${name}.png`, fullPage: true });
    }
  });
  await check('桌面、iPad、手机六页面无横向溢出，深浅色可切换', async () => {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 820, height: 1180 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of ['dashboard', 'library', 'new', 'review', 'stats', 'settings']) {
        await page.goto(base + '/#' + route);
        await waitForPage(route);
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${viewport.width} ${route} overflow`,
        );
      }
    }
    await page.locator('#theme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.goto(base + '/#dashboard');
    await waitForPage('dashboard');
    await page.screenshot({ path: `${screenshotDir}/dashboard-mobile-dark.png`, fullPage: true });
    await page.locator('#theme').click();
    await page.screenshot({ path: `${screenshotDir}/dashboard-mobile.png`, fullPage: true });
  });
}
