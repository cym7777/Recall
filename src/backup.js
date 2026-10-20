import { validateQuestion, validDay, schedule } from './model.js';
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const validId = (v) => typeof v === 'string' && /^[A-Za-z0-9:_-]{1,150}$/.test(v);
const timestamp = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
function ensure(condition, message) {
  if (!condition) throw new Error(`备份校验失败：${message}`);
}
function unique(items, name) {
  const ids = new Set();
  for (const item of items) {
    ensure(object(item) && validId(item.id), `${name}记录 ID 无效`);
    ensure(!ids.has(item.id), `${name}记录 ID 重复`);
    ids.add(item.id);
  }
  return ids;
}
export function validateBackup(data) {
  ensure(
    object(data) && data.format === 'recall-backup' && data.version === 1,
    '文件不是受支持的 Recall v1 备份',
  );
  ensure(timestamp(data.exportedAt), '导出时间无效');
  for (const [key, limit] of [
    ['subjects', 200],
    ['questions', 10000],
    ['reviews', 100000],
  ])
    ensure(Array.isArray(data[key]) && data[key].length <= limit, `${key} 列表无效或超出数量限制`);
  const subjects = unique(data.subjects, '科目'),
    questions = unique(data.questions, '错题');
  unique(data.reviews, '复习');
  const names = new Set();
  const cleanSubjects = data.subjects.map((s) => {
    ensure(
      typeof s.name === 'string' &&
        s.name.trim() &&
        s.name.length <= 50 &&
        !names.has(s.name.trim()),
      '科目名称无效或重复',
    );
    names.add(s.name.trim());
    return { id: s.id, name: s.name.trim() };
  });
  const cleanQuestions = data.questions.map((q) => {
    ensure(subjects.has(q.subjectId), '错题引用了不存在的科目');
    validateQuestion(q, cleanSubjects);
    ensure(Number.isInteger(q.level) && q.level >= 1 && q.level <= 5, '错题等级必须为 1–5');
    ensure(Number.isSafeInteger(q.revision) && q.revision >= 1, '错题版本无效');
    ensure(validDay(q.dueDate) && timestamp(q.createdAt) && timestamp(q.updatedAt), '错题日期无效');
    return {
      id: q.id,
      content: q.content,
      answer: q.answer,
      reason: q.reason,
      tags: [...q.tags],
      images: [...q.images],
      subjectId: q.subjectId,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      dueDate: q.dueDate,
      level: q.level,
      revision: q.revision,
    };
  });
  const questionMap = new Map(cleanQuestions.map((q) => [q.id, q]));
  const revisionKeys = new Set();
  const cleanReviews = data.reviews.map((r) => {
    ensure(questions.has(r.questionId), '复习引用了不存在的错题');
    ensure(timestamp(r.reviewedAt) && validDay(r.reviewDay) && validDay(r.dueDate), '复习日期无效');
    ensure(Number.isSafeInteger(r.revision) && r.revision >= 1, '复习版本无效');
    const q = questionMap.get(r.questionId);
    ensure(r.revision < q.revision, '复习版本必须早于题目当前版本');
    const key = `${r.questionId}:${r.revision}`;
    ensure(!revisionKeys.has(key) && r.id === key, '复习记录重复或 ID 与版本不一致');
    revisionKeys.add(key);
    let next;
    try {
      next = schedule(r.fromLevel, r.rating, r.reviewDay);
    } catch {
      throw new Error('备份校验失败：复习反馈或等级无效');
    }
    ensure(r.toLevel === next.level && r.dueDate === next.dueDate, '复习调度记录不一致');
    return {
      id: r.id,
      questionId: r.questionId,
      rating: r.rating,
      fromLevel: r.fromLevel,
      toLevel: r.toLevel,
      dueDate: r.dueDate,
      reviewedAt: r.reviewedAt,
      reviewDay: r.reviewDay,
      revision: r.revision,
    };
  });
  return {
    format: 'recall-backup',
    version: 1,
    exportedAt: data.exportedAt,
    subjects: cleanSubjects,
    questions: cleanQuestions,
    reviews: cleanReviews,
  };
}
export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw new Error('备份文件不能超过 50 MB');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('无法解析 JSON，请选择完整的 Recall 备份文件');
  }
  return validateBackup(data);
}
export function makeBackup(state) {
  return validateBackup({
    format: 'recall-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    ...state,
  });
}
