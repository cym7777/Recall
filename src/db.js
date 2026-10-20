import { DEFAULT_SUBJECTS, today, validateQuestion, schedule } from './model.js';
const DB_NAME = 'recall';
let connection;
export async function openDB() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('subjects', { keyPath: 'id' });
      db.createObjectStore('questions', { keyPath: 'id' });
      db.createObjectStore('reviews', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'id' });
    };
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      connection = undefined;
      reject(new Error('数据库升级受阻，请关闭其他 Recall 标签页后重试'));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
  });
  return connection;
}
export async function transaction(stores, mode, action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value, failure;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => {
      const error = failure || tx.error;
      reject(
        error?.name === 'QuotaExceededError'
          ? new Error('浏览器存储空间不足，保存未完成。请导出备份并释放设备空间。')
          : error || new Error('数据保存失败，未更改任何记录'),
      );
    };
    tx.onerror = () => {};
    const fail = (e) => {
      failure = e;
      tx.abort();
    };
    try {
      action(tx, (v) => (value = v), fail);
    } catch (e) {
      fail(e);
    }
  });
}
export async function initialize() {
  await transaction(['subjects', 'meta'], 'readwrite', (tx) => {
    const meta = tx.objectStore('meta');
    meta.get('initialized').onsuccess = (e) => {
      if (e.target.result) return;
      DEFAULT_SUBJECTS.forEach((name, i) =>
        tx.objectStore('subjects').put({ id: `subject-${i + 1}`, name }),
      );
      meta.put({ id: 'initialized', value: true });
    };
  });
}
export async function snapshot() {
  return transaction(['subjects', 'questions', 'reviews'], 'readonly', (tx, set) => {
    const state = {};
    for (const name of ['subjects', 'questions', 'reviews'])
      tx.objectStore(name).getAll().onsuccess = (e) => {
        state[name] = e.target.result;
        set(state);
      };
  });
}
export async function saveSubject(id, name) {
  name = name.trim();
  if (!name || name.length > 50) throw new Error('科目名称应为 1–50 字');
  return transaction(['subjects'], 'readwrite', (tx, set, fail) => {
    const store = tx.objectStore('subjects');
    store.getAll().onsuccess = (e) => {
      if (e.target.result.some((s) => s.name === name && s.id !== id))
        return fail(new Error('科目名称已存在'));
      if (id && !e.target.result.some((s) => s.id === id))
        return fail(new Error('科目已不存在，请刷新后重试'));
      const subject = { id: id || crypto.randomUUID(), name };
      store.put(subject);
      set(subject);
    };
  });
}
export async function deleteSubject(id) {
  return transaction(['subjects', 'questions'], 'readwrite', (tx, set, fail) => {
    tx.objectStore('questions').getAll().onsuccess = (e) => {
      if (e.target.result.some((q) => q.subjectId === id))
        return fail(new Error('该科目下仍有错题，请先修改题目所属科目'));
      tx.objectStore('subjects').delete(id);
    };
  });
}
export async function saveQuestion(input) {
  return transaction(['subjects', 'questions'], 'readwrite', (tx, set, fail) => {
    tx.objectStore('subjects').getAll().onsuccess = (e) => {
      try {
        validateQuestion(input, e.target.result);
      } catch (error) {
        return fail(error);
      }
      const store = tx.objectStore('questions');
      const write = (old) => {
        if (input.id && (!old || old.revision !== input.revision))
          return fail(new Error('此题已在其他页面更改，请刷新后重新编辑'));
        const q = {
          id: old?.id || crypto.randomUUID(),
          content: input.content.trim(),
          answer: input.answer.trim(),
          reason: input.reason.trim(),
          subjectId: input.subjectId,
          tags: [...new Set(input.tags)],
          images: input.images,
          createdAt: old?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          dueDate: old?.dueDate || today(),
          level: old?.level || 1,
          revision: (old?.revision || 0) + 1,
        };
        store.put(q);
        set(q);
      };
      if (input.id) store.get(input.id).onsuccess = (e) => write(e.target.result);
      else write();
    };
  });
}
export async function deleteQuestion(id) {
  return transaction(['questions', 'reviews'], 'readwrite', (tx) => {
    tx.objectStore('questions').delete(id);
    tx.objectStore('reviews').openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (c) {
        if (c.value.questionId === id) c.delete();
        c.continue();
      }
    };
  });
}

export async function submitReview(questionId, revision, rating) {
  const id = `${questionId}:${revision}`;
  return transaction(['questions', 'reviews'], 'readwrite', (tx, set, fail) => {
    const reviews = tx.objectStore('reviews'),
      questions = tx.objectStore('questions');
    reviews.get(id).onsuccess = (e) => {
      if (e.target.result) {
        set(e.target.result);
        return;
      }
      questions.get(questionId).onsuccess = (e) => {
        const q = e.target.result;
        if (!q || q.revision !== revision || q.dueDate > today())
          return fail(new Error('此题已经更新或完成复习，请刷新列表后继续'));
        try {
          const next = schedule(q.level, rating);
          const record = {
            id,
            questionId,
            rating,
            fromLevel: q.level,
            toLevel: next.level,
            dueDate: next.dueDate,
            reviewedAt: new Date().toISOString(),
            reviewDay: today(),
            revision,
          };
          questions.put({ ...q, ...next, revision: q.revision + 1, updatedAt: record.reviewedAt });
          reviews.add(record);
          set(record);
        } catch (error) {
          fail(error);
        }
      };
    };
  });
}
export async function replaceData(backup) {
  const { validateBackup } = await import('./backup.js');
  const data = validateBackup(backup);
  return transaction(['subjects', 'questions', 'reviews', 'meta'], 'readwrite', (tx) => {
    for (const name of ['subjects', 'questions', 'reviews']) {
      const store = tx.objectStore(name);
      store.clear();
      for (const item of data[name]) store.add(item);
    }
    tx.objectStore('meta').put({ id: 'initialized', value: true });
  });
}
