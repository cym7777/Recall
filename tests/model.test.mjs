import test from 'node:test';
import assert from 'node:assert/strict';
import { today, addDays, validDay, validateQuestion, filterQuestions } from '../src/model.js';
test('本地日期与跨月、闰年、跨年', () => {
  assert.equal(today(new Date(2026, 9, 20, 23, 59)), '2026-10-20');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-31', 3), '2026-02-03');
  assert.equal(validDay('2026-02-30'), false);
});
const q = {
  content: '多行题目\nA & B',
  answer: '答案',
  reason: '概念',
  tags: ['逻辑门'],
  images: [],
  subjectId: 's',
};
test('错题必填字段、科目、图片与边界校验', () => {
  assert.doesNotThrow(() => validateQuestion(q, [{ id: 's' }]));
  assert.throws(() => validateQuestion({ ...q, answer: '' }, [{ id: 's' }]));
  assert.throws(() => validateQuestion({ ...q, subjectId: 'missing' }, [{ id: 's' }]));
  assert.throws(() =>
    validateQuestion({ ...q, images: ['data:image/svg+xml;base64,aaa'] }, [{ id: 's' }]),
  );
  assert.throws(() => validateQuestion({ ...q, images: Array(5).fill('x') }, [{ id: 's' }]));
});
test('搜索覆盖题目、答案、理解与标签，且支持科目交集', () => {
  assert.equal(filterQuestions([q], '逻辑门', 's').length, 1);
  assert.equal(filterQuestions([q], '答案').length, 1);
  assert.equal(filterQuestions([q], '概念').length, 1);
  assert.equal(filterQuestions([q], '逻辑门', 'other').length, 0);
  assert.equal(filterQuestions([q], '不存在').length, 0);
});
