import * as db from './db.js';
import { today, filterQuestions, schedule, addDays } from './model.js';
import { compressImage } from './images.js';
import { makeBackup, parseBackup, MAX_BACKUP_BYTES } from './backup.js';
let state = { subjects: [], questions: [], reviews: [] };
let page = 'dashboard',
  search = '',
  subjectFilter = '',
  editId = null,
  formImages = [],
  imageBusy = false;
const $ = (s) => document.querySelector(s);
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const localDay = (value) => today(new Date(value));
const subjectName = (id) => state.subjects.find((s) => s.id === id)?.name || '未知科目';
const due = () => state.questions.filter((q) => q.dueDate <= today());
const options = (selected) =>
  state.subjects
    .map(
      (s) =>
        `<option value="${escape(s.id)}" ${s.id === selected ? 'selected' : ''}>${escape(s.name)}</option>`,
    )
    .join('');
function notify(message, error = false) {
  $('#toast').textContent = message;
  $('#toast').className = `visible ${error ? 'error' : ''}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => ($('#toast').className = ''), 5000);
}
function heading(kicker, title, description, action = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p class="muted">${description}</p></div>${action}</div>`;
}
function empty(title, description, action = '') {
  return `<div class="empty"><span class="empty-icon">▤</span><h3>${title}</h3><p>${description}</p>${action}</div>`;
}
function go(target) {
  location.hash = target;
}
async function refresh() {
  state = await db.snapshot();
  $('#nav-due').textContent = due().length;
}
async function confirmAction(title, message, action) {
  const dialog = $('#dialog');
  dialog.innerHTML = `<h2>${escape(title)}</h2><p>${escape(message)}</p><div class="actions"><button class="button" id="cancel-dialog">取消</button><button class="button danger" id="confirm-dialog">确认${escape(title)}</button></div>`;
  dialog.showModal();
  $('#cancel-dialog').onclick = () => dialog.close();
  $('#confirm-dialog').onclick = async (e) => {
    e.target.disabled = true;
    try {
      await action();
      dialog.close();
      await refresh();
      render();
    } catch (error) {
      notify(error.message, true);
      e.target.disabled = false;
    }
  };
}
function dashboard() {
  const pending = due(),
    late = pending.filter((q) => q.dueDate < today()).length;
  return (
    heading(
      'YOUR LEARNING, REVISITED',
      '让知识，慢慢变牢固。',
      '从今天的一次回顾开始，把每个「不会」变成「掌握」。',
    ) +
    `
  <section class="hero"><div><span class="pill">今日学习计划</span><h2>${pending.length ? '留一点时间，回顾一下。' : '今天，也向前一步。'}</h2><p>${pending.length ? `有 ${pending.length} 道错题等待回顾。先尝试回忆，再揭晓答案。` : '还没有待复习的错题。记录学习中的疑问，从这里开始积累。'}</p><button class="button primary" data-go="${pending.length ? 'review' : 'new'}">${pending.length ? '开始今日复习 →' : '记录第一道错题 ＋'}</button><small>按掌握情况安排 · 5 级规则型间隔复习</small></div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="paper back"></div><div class="paper front"><span>一点一滴</span><b>学过的，<br>也能记得。</b><i>↗</i></div><div class="spark">✳</div></div></section>
  <section class="metrics" aria-label="学习数据"><article><span>今日到期</span><strong>${pending.length - late}<small>题</small></strong><p>今天新到期的复习</p></article><article><span>逾期待复习</span><strong class="amber">${late}<small>题</small></strong><p>从这里重新开始就好</p></article><article><span>累计错题</span><strong>${state.questions.length}<small>题</small></strong><p>每一道都是进步的起点</p></article><article><span>已完成复习</span><strong>${state.reviews.length}<small>次</small></strong><p>来自每一次真实回顾</p></article></section>
  <div class="two-column"><section class="panel"><div class="section-title"><h2>我的科目 <small>${state.subjects.length} 个科目</small></h2><a href="#settings">管理科目 ↗</a></div>${subjectBars()}<a class="text-link" href="#library">查看全部错题 →</a></section><section class="panel"><div class="section-title"><h2>最近复习</h2><a href="#stats">学习统计 ↗</a></div>${recentReviews()}</section></div><div class="gentle-note"><span>✦</span><p>不必一次记住所有，给记忆一点时间。<small>诚实地选择掌握情况，让下一次复习更有针对性。</small></p></div>`
  );
}
function subjectBars() {
  const max = Math.max(
    1,
    ...state.subjects.map((s) => state.questions.filter((q) => q.subjectId === s.id).length),
  );
  return `<div class="subject-bars">${state.subjects
    .map((s, i) => {
      const n = state.questions.filter((q) => q.subjectId === s.id).length;
      return `<div class="subject-row"><span class="subject-swatch c${i % 5}">${escape(s.name.slice(0, 1))}</span><div><div class="bar-label"><span>${escape(s.name)}</span><b>${n} <small>题</small></b></div><div class="bar-track"><div style="width:${(n / max) * 100}%" class="c${i % 5}"></div></div></div></div>`;
    })
    .join('')}</div>`;
}
function recentReviews() {
  return state.reviews.length
    ? `<div class="recent-list">${[...state.reviews]
        .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
        .slice(0, 5)
        .map((r) => {
          const q = state.questions.find((q) => q.id === r.questionId);
          return `<div><span class="review-mark">✓</span><div><b>${escape(q?.content || '图片题目')}</b><small>${escape(subjectName(q?.subjectId))} · ${escape(new Date(r.reviewedAt).toLocaleString('zh-CN'))}</small></div><span class="tag">${{ again: '不会', hard: '模糊', good: '掌握' }[r.rating]}</span></div>`;
        })
        .join('')}</div>`
    : empty('每一次回顾，都值得记录', '完成第一次复习后，你的学习足迹会出现在这里。');
}
function library() {
  const list = filterQuestions(state.questions, search, subjectFilter).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return (
    heading(
      'QUESTION LIBRARY',
      '我的错题库',
      '收好每一次疑问，也收好每一次进步。',
      `<button class="button primary" data-go="new">＋ 新增错题</button>`,
    ) +
    `<div class="toolbar"><label class="search-field"><span>⌕</span><input id="search" type="search" placeholder="搜索题目、答案或标签" aria-label="搜索错题" value="${escape(search)}"></label><select id="subject-filter" aria-label="按科目筛选"><option value="">全部科目</option>${options(subjectFilter)}</select><span class="muted">${list.length} 道错题</span></div><div id="question-list">${list.length ? list.map((q) => `<article class="question-card"><div class="question-meta"><span class="tag subject">${escape(subjectName(q.subjectId))}</span><span>第 ${q.level} 级 · ${q.dueDate <= today() ? '待复习' : '下次 ' + q.dueDate}</span></div><h2>${escape(q.content || '图片题目')}</h2>${q.images.length ? `<img class="question-thumbnail" src="${q.images[0]}" alt="题目图片预览">` : ''}<div class="tags">${q.tags.map((t) => `<span class="tag">${escape(t)}</span>`).join('')}</div><div class="card-bottom"><small>创建于 ${escape(localDay(q.createdAt))}</small><div><button class="button small" data-edit="${escape(q.id)}">查看 / 编辑</button><button class="button small danger-text" data-delete="${escape(q.id)}">删除</button></div></div></article>`).join('') : empty('给学习留一份记录', search || subjectFilter ? '没有符合条件的错题，试试其他关键词或科目。' : '把难住你的题目记下来，下一次再从容作答。', `<button class="button primary" data-go="new">＋ 新增错题</button>`)}</div>`
  );
}
function editor() {
  const q = state.questions.find((q) => q.id === editId);
  formImages = [...(q?.images || [])];
  return (
    heading(
      'CAPTURE & REFLECT',
      q ? '编辑错题' : '记录一道错题',
      '想一想哪里卡住了，把思路也一起留下。',
    ) +
    `<form id="question-form" class="panel editor"><label>所属科目<select name="subjectId" required>${options(q?.subjectId)}</select></label><label>题目内容<textarea name="content" rows="5" maxlength="50000" placeholder="输入题目，支持多行文字…">${escape(q?.content || '')}</textarea></label><div class="image-uploader"><label class="upload-label" for="image-input">＋ 添加题目图片</label><input id="image-input" type="file" accept="image/jpeg,image/png,image/webp" multiple><span class="muted">可在此页面粘贴图片 · 最多 4 张 · 原图 ≤15 MB，保存 ≤1 MB/张</span><div id="image-preview"></div><p id="image-status" role="status"></p></div><label>正确答案 <span class="required">*</span><textarea name="answer" rows="4" required maxlength="50000" placeholder="写下正确答案与解题步骤…">${escape(q?.answer || '')}</textarea></label><label>错误原因 / 个人理解<textarea name="reason" rows="3" maxlength="50000" placeholder="是概念不清、步骤遗漏，还是粗心？">${escape(q?.reason || '')}</textarea></label><label>知识点标签<input name="tags" value="${escape(q?.tags.join('，') || '')}" placeholder="使用逗号分隔，例如：逻辑门，化简"></label><p class="muted">${q ? `创建：${localDay(q.createdAt)} · 第 ${q.level} 级 · 下次复习：${q.dueDate}` : '新错题将加入今日复习，第 1 级。'}</p><div class="actions"><button type="button" class="button" data-go="library">取消</button><button class="button primary" id="save-question">保存错题</button></div></form>`
  );
}
function imagePreview() {
  $('#image-preview').innerHTML = formImages
    .map(
      (src, i) =>
        `<div><img src="${src}" alt="题目图片 ${i + 1}"><button type="button" class="button small" data-remove-image="${i}" aria-label="移除图片 ${i + 1}">移除</button></div>`,
    )
    .join('');
}
async function addImages(files) {
  if (imageBusy) return;
  const form = $('#question-form');
  if (!form) return;
  imageBusy = true;
  form.querySelector('#save-question').disabled = true;
  form.querySelector('#image-status').textContent = '正在压缩图片…';
  try {
    const list = [...files];
    if (formImages.length + list.length > 4) throw new Error('每道题最多 4 张图片');
    const next = [];
    for (const file of list) next.push(await compressImage(file));
    if (!form.isConnected) return;
    formImages.push(...next);
    imagePreview();
    form.querySelector('#image-status').textContent = '图片已压缩，保存错题后写入数据库';
  } catch (error) {
    if (form.isConnected) {
      notify(error.message, true);
      form.querySelector('#image-status').textContent = error.message;
    }
  } finally {
    imageBusy = false;
    if (form.isConnected) form.querySelector('#save-question').disabled = false;
  }
}
function settings() {
  return (
    heading('YOUR SPACE', '设置与备份', '让每一次积累，都稳妥地保存在自己手中。') +
    `<section class="panel settings-section"><h2>科目管理</h2><p class="muted">自由整理你的课程。已有错题的科目需要先迁移题目才能删除。</p><div class="subject-manager">${state.subjects.map((s) => `<div><span>${escape(s.name)}</span><button class="button small" data-subject-edit="${escape(s.id)}">编辑</button><button class="button small danger-text" data-subject-delete="${escape(s.id)}">删除</button></div>`).join('')}</div><form id="subject-form" class="inline-form"><input name="name" required maxlength="50" placeholder="新科目名称" aria-label="新科目名称"><button class="button primary">添加科目</button></form></section><div id="backup-section"></div>`
  );
}
function render() {
  $('#header-date').textContent = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  $('#breadcrumb').textContent =
    {
      dashboard: '学习概览',
      library: '我的错题库',
      new: '新增错题',
      edit: '编辑错题',
      review: '今日复习',
      stats: '学习统计',
      settings: '设置与备份',
    }[page] || '学习概览';
  document
    .querySelectorAll('[data-page]')
    .forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  $('#main').innerHTML =
    {
      dashboard,
      library,
      new: editor,
      edit: editor,
      settings,
      review: () => reviewPage(),
      stats: () => statsPage(),
    }[page]?.() || dashboard();
  bind();
}
function bind() {
  document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  document.querySelectorAll('[data-edit]').forEach(
    (b) =>
      (b.onclick = () => {
        editId = b.dataset.edit;
        go('edit');
      }),
  );
  document
    .querySelectorAll('[data-delete]')
    .forEach(
      (b) =>
        (b.onclick = () =>
          confirmAction('删除错题', '此操作将删除这道题及其复习历史，无法撤销。', () =>
            db.deleteQuestion(b.dataset.delete),
          )),
    );
  if ($('#search'))
    $('#search').oninput = (e) => {
      search = e.target.value;
      const start = e.target.selectionStart;
      render();
      $('#search').focus();
      $('#search').setSelectionRange(start, start);
    };
  if ($('#subject-filter'))
    $('#subject-filter').onchange = (e) => {
      subjectFilter = e.target.value;
      render();
    };
  if ($('#question-form')) {
    imagePreview();
    $('#image-input').onchange = (e) => addImages(e.target.files);
    $('#image-preview').onclick = (e) => {
      const b = e.target.closest('[data-remove-image]');
      if (b) {
        formImages.splice(Number(b.dataset.removeImage), 1);
        imagePreview();
      }
    };
    const revision = state.questions.find((q) => q.id === editId)?.revision;
    $('#question-form').onsubmit = async (e) => {
      e.preventDefault();
      if (imageBusy) return;
      const button = $('#save-question');
      button.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(e.target));
        await db.saveQuestion({
          ...data,
          id: editId,
          revision,
          images: formImages,
          tags: data.tags
            .split(/[,，\n]/)
            .map((t) => t.trim())
            .filter(Boolean),
        });
        await refresh();
        notify('错题已保存');
        go('library');
      } catch (error) {
        notify(error.message, true);
        button.disabled = false;
      }
    };
  }
  if ($('#subject-form')) {
    $('#subject-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await db.saveSubject(null, new FormData(e.target).get('name'));
        await refresh();
        render();
        notify('科目已添加');
      } catch (error) {
        notify(error.message, true);
      }
    };
    document
      .querySelectorAll('[data-subject-delete]')
      .forEach(
        (b) =>
          (b.onclick = () =>
            confirmAction('删除科目', '确认删除这个空科目？', () =>
              db.deleteSubject(b.dataset.subjectDelete),
            )),
      );
    document.querySelectorAll('[data-subject-edit]').forEach(
      (b) =>
        (b.onclick = () => {
          const s = state.subjects.find((s) => s.id === b.dataset.subjectEdit),
            d = $('#dialog');
          d.innerHTML = `<form id="rename-subject"><h2>编辑科目</h2><label>科目名称<input name="name" maxlength="50" required value="${escape(s.name)}"></label><div class="actions"><button type="button" class="button" id="cancel-dialog">取消</button><button class="button primary">保存</button></div></form>`;
          d.showModal();
          $('#cancel-dialog').onclick = () => d.close();
          $('#rename-subject').onsubmit = async (e) => {
            e.preventDefault();
            try {
              await db.saveSubject(s.id, new FormData(e.target).get('name'));
              await refresh();
              d.close();
              render();
            } catch (error) {
              notify(error.message, true);
            }
          };
        }),
    );
  }
  bindExtended();
}
let reviewRevealed = false,
  reviewBusy = false;
function reviewPage() {
  reviewRevealed = false;
  const queue = due().sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt),
    ),
    q = queue[0];
  return (
    heading('A LITTLE EVERY DAY', '今日复习', '先独立回忆，再核对答案。诚实的反馈比答对更重要。') +
    `<div class="review-container">${!q ? `<div class="panel review-done"><span>✓</span><h2>今天的待复习已完成</h2><p>${state.questions.length ? '所有到期错题都已回顾，明天再见。' : '录入一道错题，就可以开始第一次复习。'}</p><button class="button primary" data-go="library">返回错题库 →</button></div>` : `<div class="review-progress"><span>还有 ${queue.length} 道待复习</span><span>优先复习最早到期的题目</span></div><article class="panel review-card"><div class="question-meta"><span class="tag subject">${escape(subjectName(q.subjectId))}</span><span>第 ${q.level} 级 · 到期 ${q.dueDate}</span></div><div class="review-content">${escape(q.content || '请查看图片中的题目')}</div><div class="review-images">${q.images.map((src) => `<img src="${src}" alt="题目图片">`).join('')}</div><div class="tags">${q.tags.map((t) => `<span class="tag">${escape(t)}</span>`).join('')}</div><button class="button primary reveal" id="reveal-answer">我已思考，查看答案 ↓</button><div id="answer-slot"></div></article>`}</div>`
  );
}
function bindReview() {
  if (!$('#reveal-answer')) return;
  const q = due().sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt),
  )[0];
  $('#reveal-answer').onclick = () => {
    reviewRevealed = true;
    $('#reveal-answer').remove();
    $('#answer-slot').innerHTML =
      `<div class="answer-section"><h3>正确答案</h3><p>${escape(q.answer)}</p><h3>错误原因 / 个人理解</h3><p>${escape(q.reason || '尚未填写')}</p><h3>这一次，你掌握得怎么样？</h3><div class="rating-buttons">${[
        ['again', '不会'],
        ['hard', '模糊'],
        ['good', '掌握'],
      ]
        .map(([rating, label]) => {
          const next = schedule(q.level, rating);
          return `<button class="button ${rating === 'good' ? 'primary' : ''}" data-rating="${rating}">${label}<small>第 ${next.level} 级 · ${next.dueDate}</small></button>`;
        })
        .join('')}</div></div>`;
    document.querySelectorAll('[data-rating]').forEach(
      (b) =>
        (b.onclick = async () => {
          if (!reviewRevealed || reviewBusy) return;
          reviewBusy = true;
          document.querySelectorAll('[data-rating]').forEach((b) => (b.disabled = true));
          try {
            await db.submitReview(q.id, q.revision, b.dataset.rating);
            await refresh();
            notify('已记录复习，下次见');
            render();
          } catch (error) {
            notify(error.message, true);
            await refresh();
            render();
          } finally {
            reviewBusy = false;
          }
        }),
    );
  };
}
function statsPage() {
  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), i - 13));
  const counts = days.map((day) => state.reviews.filter((r) => r.reviewDay === day).length),
    max = Math.max(1, ...counts);
  const levelCounts = Array.from(
      { length: 5 },
      (_, i) => state.questions.filter((q) => q.level === i + 1).length,
    ),
    levelMax = Math.max(1, ...levelCounts);
  return (
    heading('LEARNING INSIGHTS', '学习统计', '进步有迹可循。这里的每个数字，都来自你保存的记录。') +
    `<section class="metrics"><article><span>累计错题</span><strong>${state.questions.length}<small>题</small></strong><p>当前错题库总量</p></article><article><span>完成复习</span><strong>${state.reviews.length}<small>次</small></strong><p>保存的全部复习记录</p></article><article><span>今日复习</span><strong>${state.reviews.filter((r) => r.reviewDay === today()).length}<small>次</small></strong><p>按复习时本地日期统计</p></article><article><span>待复习</span><strong>${due().length}<small>题</small></strong><p>包含今日到期及逾期</p></article></section><section class="panel"><div class="section-title"><h2>每日复习次数</h2><span class="muted">最近 14 天</span></div><div class="chart" role="img" aria-label="最近14天复习次数：${days.map((d, i) => `${d} ${counts[i]}次`).join('；')}">${days.map((day, i) => `<div class="chart-column" title="${day}：${counts[i]} 次"><span>${counts[i]}</span><div class="chart-bar" style="height:${(counts[i] / max) * 78}%"></div><small>${day.slice(5).replace('-', '/')}</small></div>`).join('')}</div></section><div class="two-column" style="margin-top:24px"><section class="panel"><div class="section-title"><h2>各科目错题数量</h2></div>${subjectBars()}</section><section class="panel"><h2>复习等级分布</h2>${levelCounts.map((n, i) => `<div class="level-row"><span>第 ${i + 1} 级</span><div class="bar-track"><div style="width:${(n / levelMax) * 100}%"></div></div><b>${n}</b></div>`).join('')}<p class="muted"><small>等级仅用于安排下次复习，不代表经过验证的掌握程度。</small></p></section></div><div class="notice">删除错题会同时删除对应复习历史，统计也会随之更新。这里展示的是当前保存的数据，不是不可变的终身累计记录。</div>`
  );
}
let pendingImport = null;
function backupContent() {
  return `<section class="panel settings-section"><h2>数据备份</h2><p class="muted">包含所有科目、题目、图片与复习历史。备份文件包含你的完整学习内容，请妥善保管。</p><div class="actions"><button class="button primary" id="export-backup">↓ 导出完整 JSON</button><label class="button import-label" for="import-backup">↑ 选择 JSON 备份</label><input class="sr-only" id="import-backup" type="file" accept=".json,application/json"></div><div id="import-preview">${pendingImport ? `<div class="backup-preview"><h3>文件校验通过</h3><p>${pendingImport.subjects.length} 个科目 · ${pendingImport.questions.length} 道错题 · ${pendingImport.reviews.length} 次复习</p><p class="muted">导入将完整覆盖当前浏览器数据，包括图片与历史。建议先导出当前数据。此操作无法撤销。</p><div class="actions"><button class="button" id="cancel-import">取消导入</button><button class="button danger" id="apply-import">覆盖本地数据…</button></div></div>` : ''}</div><div class="notice">数据仅保存在当前浏览器的 IndexedDB 中，不能跨设备自动同步。清理网站数据、更换浏览器、隐私浏览结束或设备损坏都可能导致丢失。建议每周导出一次备份。单个导入文件最多 50 MB。</div></section><section class="panel settings-section"><h2>本地存储与复习规则</h2><p class="muted">5 个等级分别间隔 1、3、7、14、30 天。不会回到第 1 级；模糊降低一级；掌握升高一级。用变化后的等级安排下一次复习，以本地日历日期计算。</p><button class="button" id="persist-storage">请求浏览器持久存储</button><p class="muted" id="storage-state"></p><div class="notice">Recall 使用透明的规则型调度，未接入 AI 模型，也不承诺最优记忆效果。站点地址、协议或端口变化会形成独立的数据空间；迁移前请备份。</div></section>`;
}
function bindBackup() {
  if (!$('#backup-section')) return;
  $('#backup-section').innerHTML = backupContent();
  $('#export-backup').onclick = async () => {
    try {
      const backup = makeBackup(await db.snapshot());
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `recall-backup-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('完整备份已生成');
    } catch (error) {
      notify(error.message, true);
    }
  };
  $('#import-backup').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImport = null;
    const button = $('#export-backup');
    button.disabled = true;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 50 MB');
      const data = parseBackup(await file.text());
      for (const q of data.questions) {
        for (const src of q.images) {
          const image = new Image();
          image.src = src;
          try {
            await image.decode();
          } catch {
            throw new Error('备份中的图片已损坏，未导入任何数据');
          }
        }
      }
      pendingImport = data;
      notify('备份校验通过，请检查摘要并确认覆盖');
    } catch (error) {
      notify(error.message, true);
    } finally {
      bindBackup();
    }
  };
  if ($('#cancel-import'))
    $('#cancel-import').onclick = () => {
      pendingImport = null;
      bindBackup();
    };
  if ($('#apply-import'))
    $('#apply-import').onclick = () =>
      confirmAction(
        '覆盖本地数据',
        '当前所有科目、题目、图片和复习历史将被替换。确定已备份并继续？',
        async () => {
          await db.replaceData(pendingImport);
          pendingImport = null;
          notify('数据导入完成');
        },
      );
  $('#persist-storage').onclick = async () => {
    try {
      const granted = await navigator.storage?.persist?.();
      $('#storage-state').textContent = granted
        ? '浏览器已授予持久存储。仍建议定期备份。'
        : '浏览器未授予持久存储。请继续定期导出备份。';
    } catch (error) {
      notify(error.message, true);
    }
  };
}
function bindExtended() {
  bindReview();
  bindBackup();
}
async function route() {
  await refresh();
  const next = location.hash.slice(1) || 'dashboard';
  if (next === 'new') editId = null;
  if (next === 'edit' && !state.questions.some((q) => q.id === editId)) {
    go('library');
    return;
  }
  page = next;
  render();
}
let dark = false;
try {
  dark =
    (localStorage.getItem('recall-theme') || 'system') === 'dark' ||
    (!localStorage.getItem('recall-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
} catch {}
function applyTheme() {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme span').textContent = dark ? '切换浅色模式' : '切换深色模式';
  $('#theme').setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式');
}
applyTheme();
$('#theme').onclick = () => {
  dark = !dark;
  applyTheme();
  try {
    localStorage.setItem('recall-theme', dark ? 'dark' : 'light');
  } catch {}
};
$('#top-add').onclick = () => {
  if (page === 'new') {
    editId = null;
    render();
  } else go('new');
};
$('#header-date').textContent = new Date().toLocaleDateString('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});
window.addEventListener('hashchange', () => route().catch((error) => notify(error.message, true)));
window.addEventListener('paste', (e) => {
  if (!['new', 'edit'].includes(page)) return;
  const files = [...(e.clipboardData?.items || [])]
    .filter((i) => i.kind === 'file')
    .map((i) => i.getAsFile())
    .filter(Boolean);
  if (files.length) {
    e.preventDefault();
    addImages(files);
  }
});
window.addEventListener('focus', async () => {
  if (['new', 'edit'].includes(page) || $('#dialog').open) return;
  try {
    await refresh();
    render();
  } catch (error) {
    notify(error.message, true);
  }
});
let lastDay = today();
setInterval(async () => {
  if (lastDay !== today()) {
    lastDay = today();
    await refresh();
    if (!['new', 'edit'].includes(page)) render();
  }
}, 30000);
try {
  await db.initialize();
  await refresh();
  await route();
} catch (error) {
  $('#main').innerHTML = empty(
    '无法打开本地数据库',
    '请关闭浏览器隐私限制并重试。浏览器需要允许 IndexedDB。',
  );
  notify(error.message, true);
}
