import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, parseBackup, validateBackup } from '../src/backup.js';
const state = {
  subjects: [{ id: 's', name: '数学' }],
  questions: [
    {
      id: 'q',
      content: '示例',
      answer: '1',
      reason: '',
      tags: [],
      images: [],
      subjectId: 's',
      level: 2,
      revision: 2,
      dueDate: '2026-10-23',
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:00.000Z',
    },
  ],
  reviews: [
    {
      id: 'q:1',
      questionId: 'q',
      rating: 'good',
      fromLevel: 1,
      toLevel: 2,
      dueDate: '2026-10-23',
      reviewedAt: '2026-10-20T10:00:00.000Z',
      reviewDay: '2026-10-20',
      revision: 1,
    },
  ],
};
test('完整备份 JSON 无损往返', () => {
  const b = makeBackup(state);
  assert.deepEqual(parseBackup(JSON.stringify(b)), b);
});
test('损坏 JSON、错误版本、遗漏字段被拒绝', () => {
  assert.throws(() => parseBackup('{'));
  assert.throws(() => validateBackup({}));
  const b = makeBackup(state);
  assert.throws(() => validateBackup({ ...b, version: 2 }));
  assert.throws(() => validateBackup({ ...b, subjects: null }));
  const invalid = structuredClone(b);
  invalid.questions[0].content = { bad: true };
  assert.throws(() => validateBackup(invalid), /必须为文本/);
});
test('悬空引用、重复 ID、恶意图片及错误日期被拒绝', () => {
  for (const modify of [
    (b) => (b.subjects = []),
    (b) => b.questions.push(b.questions[0]),
    (b) => (b.questions[0].images = ['data:text/html;base64,AAAA']),
    (b) => (b.questions[0].dueDate = '2026-02-30'),
    (b) => (b.reviews[0].toLevel = 5),
    (b) => (b.reviews[0].revision = 2),
  ]) {
    const b = makeBackup(state);
    modify(b);
    assert.throws(() => validateBackup(b));
  }
});
