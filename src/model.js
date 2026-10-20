export const DEFAULT_SUBJECTS = ['数字电子技术', '信息论与编码', '微处理器', '高等数学', '英语'];
export const INTERVALS = [1, 3, 7, 14, 30];
export const MAX_IMAGE_BYTES = 1024 * 1024;
export function today(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
export function addDays(day, amount) {
  if (!validDay(day)) throw new Error('日期格式无效');
  const [y, m, d] = day.split('-').map(Number);
  return today(new Date(y, m - 1, d + amount, 12));
}
export function filterQuestions(questions, search = '', subjectId = '') {
  const query = search.trim().toLocaleLowerCase();
  return questions.filter(
    (q) =>
      (!subjectId || q.subjectId === subjectId) &&
      `${q.content}\n${q.answer}\n${q.reason}\n${q.tags.join(' ')}`
        .toLocaleLowerCase()
        .includes(query),
  );
}
export function validateQuestion(q, subjects) {
  if (!subjects.some((s) => s.id === q.subjectId)) throw new Error('请选择有效科目');
  for (const key of ['content', 'answer', 'reason'])
    if (typeof q[key] !== 'string') throw new Error('题目、答案和错误原因必须为文本');
    else if (q[key].length > 50000) throw new Error('每个文本字段最多 50,000 字');
  if (
    !Array.isArray(q.tags) ||
    q.tags.length > 30 ||
    q.tags.some((t) => typeof t !== 'string' || t.length > 50)
  )
    throw new Error('标签最多 30 个，每个最多 50 字');
  if (!Array.isArray(q.images) || q.images.length > 4) throw new Error('每道题最多 4 张图片');
  if (
    q.images.some(
      (i) =>
        typeof i !== 'string' ||
        !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(i) ||
        i.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 100,
    )
  )
    throw new Error('图片格式或大小无效');
  if (!q.content.trim() && !q.images.length) throw new Error('请填写题目或添加图片');
  if (!q.answer.trim()) throw new Error('请填写正确答案');
}
export function schedule(level, rating, day = today()) {
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error('复习等级无效');
  if (!['again', 'hard', 'good'].includes(rating)) throw new Error('复习结果无效');
  const nextLevel =
    rating === 'again' ? 1 : rating === 'hard' ? Math.max(1, level - 1) : Math.min(5, level + 1);
  return { level: nextLevel, dueDate: addDays(day, INTERVALS[nextLevel - 1]) };
}
