import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule } from '../src/model.js';
test('五等级三种反馈，使用变化后的等级计算间隔', () => {
  const intervals = [1, 3, 7, 14, 30];
  for (let level = 1; level <= 5; level++) {
    for (const rating of ['again', 'hard', 'good']) {
      const next = schedule(level, rating, '2026-01-01');
      const expected =
        rating === 'again'
          ? 1
          : rating === 'hard'
            ? Math.max(1, level - 1)
            : Math.min(5, level + 1);
      assert.equal(next.level, expected);
      assert.equal(next.dueDate, `2026-01-${String(1 + intervals[expected - 1]).padStart(2, '0')}`);
    }
  }
});
test('复习日期使用本地日历天，跨年、闰年正确', () => {
  assert.equal(schedule(1, 'again', '2026-12-31').dueDate, '2027-01-01');
  assert.equal(schedule(1, 'good', '2024-02-27').dueDate, '2024-03-01');
  assert.equal(schedule(1, 'again', '2026-03-08').dueDate, '2026-03-09');
});
test('非法反馈与等级不允许写入', () => {
  assert.throws(() => schedule(0, 'good'));
  assert.throws(() => schedule(6, 'again'));
  assert.throws(() => schedule(2, 'unknown'));
});
