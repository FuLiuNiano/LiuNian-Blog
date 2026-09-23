'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const store = { posts: [], journals: [], comments: [], users: [], site: null, stats: null, editing: null, journalEditing: null, journalMode: false };
let csrfToken = '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const formatButtons = [
  ['bold', 'B', '粗体'], ['italic', 'I', '斜体'], ['strike', 'S', '删除线'], ['inline-code', '</>', '行内代码'],
  ['link', '↗', '链接'], ['image', '▧', '图片'], ['h2', 'H2', '二级标题'], ['h3', 'H3', '三级标题'],
  ['quote', '❯', '引用'], ['ul', '•', '无序列表'], ['ol', '1.', '有序列表'], ['code-block', '{ }', '代码块'], ['clear-format', 'Tx', '清除特效'],
  ['table', '▦', '表格'], ['hr', '―', '分隔线'],
];
const formatStyle = document.createElement('style');
formatStyle.textContent = `.format-toolbar{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--paper) 94%,var(--green) 6%)}.format-toolbar button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:var(--ink);padding:5px 8px;font-size:12px;line-height:1;white-space:nowrap}.format-toolbar button:first-letter{font-weight:700}.format-toolbar button:hover{border-color:var(--green);color:var(--green);background:color-mix(in srgb,var(--paper) 90%,var(--green) 10%)}.format-toolbar button:active{transform:translateY(1px)}.format-toolbar .format-mark{font-family:Consolas,monospace;font-weight:700}.format-toolbar .format-label{opacity:.8}@media(max-width:700px){.format-toolbar{gap:4px;padding:7px}.format-toolbar button{padding:6px;font-size:11px}.format-toolbar .format-label{display:none}}`;
document.head.appendChild(formatStyle);

function insertEditorText(replacement, start, end, selectStart = start + replacement.length, selectEnd = selectStart) {
  const textarea = $('#content'); const value = textarea.value;
  const pageX = window.scrollX; const pageY = window.scrollY;
  const scrollTop = textarea.scrollTop; const scrollLeft = textarea.scrollLeft;
  textarea.value = value.slice(0, start) + replacement + value.slice(end);
  textarea.focus({ preventScroll: true }); textarea.setSelectionRange(selectStart, selectEnd);
  textarea.scrollTop = scrollTop; textarea.scrollLeft = scrollLeft;
  window.scrollTo(pageX, pageY);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  requestAnimationFrame(() => { textarea.scrollTop = scrollTop; textarea.scrollLeft = scrollLeft; window.scrollTo(pageX, pageY); });
}

function selectionInfo() {
  const textarea = $('#content');
  return { textarea, value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd };
}

function stripMarkdownFormatting(value) {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(```[\w-]*\n?|```)/g, '')
    .replace(/[`*_~]{1,3}/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/^\s*\d+[.)、]\s+/gm, '');
}

function clearSourceFormatting() {
  const { value, start, end } = selectionInfo();
  const from = start === end ? 0 : start;
  const to = start === end ? value.length : end;
  const cleaned = stripMarkdownFormatting(value.slice(from, to));
  insertEditorText(cleaned, from, to, from, from + cleaned.length);
}

function applyInlineFormat(type) {
  const { value, start, end } = selectionInfo(); const selected = value.slice(start, end);
  const formats = {
    bold: ['**', '**', '粗体文字'], italic: ['*', '*', '斜体文字'], strike: ['~~', '~~', '删除线文字'],
    'inline-code': ['`', '`', '代码'], link: ['[', '](https://example.com)', '链接文字'],
    image: ['![', '](/path/to/image.jpg)', '图片描述'],
  };
  const [before, after, placeholder] = formats[type]; const content = selected || placeholder;
  insertEditorText(before + content + after, start, end, start + before.length, start + before.length + content.length);
}

function applyBlockFormat(type) {
  const { value, start, end } = selectionInfo();
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf('\n', end); const lineEnd = nextBreak < 0 ? value.length : nextBreak;
  const selected = value.slice(lineStart, lineEnd) || (type === 'code-block' ? '代码' : '列表项');
  const lines = selected.split('\n'); let replacement;
  if (type === 'h2' || type === 'h3') {
    const prefix = type === 'h2' ? '## ' : '### ';
    replacement = lines.map((line) => prefix + line.replace(/^\s*#{1,6}\s+/, '')).join('\n');
  } else if (type === 'quote') {
    const quoted = lines.every((line) => /^\s*>\s?/.test(line));
    replacement = lines.map((line) => quoted ? line.replace(/^\s*>\s?/, '') : `> ${line}`).join('\n');
  } else if (type === 'ul') {
    const listed = lines.every((line) => /^\s*[-*+]\s+/.test(line));
    replacement = lines.map((line) => listed ? line.replace(/^\s*[-*+]\s+/, '') : `- ${line}`).join('\n');
  } else if (type === 'ol') {
    const listed = lines.every((line) => /^\s*\d+[.)、]\s+/.test(line));
    replacement = lines.map((line, index) => listed ? line.replace(/^\s*\d+[.)、]\s+/, '') : `${index + 1}. ${line}`).join('\n');
  } else if (type === 'code-block') {
    const fence = '```'; replacement = `${fence}\n${selected}\n${fence}`;
  } else if (type === 'table') {
    const cell = selected.replace(/\s+/g, ' ').slice(0, 80) || '内容';
    replacement = `| 项目 | 内容 |\n| --- | --- |\n| ${cell} | 说明 |`;
  } else {
    replacement = '---';
  }
  insertEditorText(replacement, lineStart, lineEnd, lineStart, lineStart + replacement.length);
}

function applyEditorFormat(type) {
  if (type === 'clear-format') {
    if (!applyVisualFormat(type)) clearSourceFormatting();
    return;
  }
  if (applyVisualFormat(type)) return;
  if (type === 'hr' || ['h2', 'h3', 'quote', 'ul', 'ol', 'code-block', 'table'].includes(type)) applyBlockFormat(type);
  else applyInlineFormat(type);
}

function setupFormattingToolbar() {
  const writing = $('.writing'); if (!writing || $('.format-toolbar', writing)) return;
  const toolbar = document.createElement('div'); toolbar.className = 'format-toolbar'; toolbar.setAttribute('aria-label', '可视化格式工具栏');
  for (const [type, mark, label] of formatButtons) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.format = type; button.title = label;
    button.innerHTML = `<span class="format-mark">${mark}</span><span class="format-label">${label}</span>`; toolbar.appendChild(button);
  }
  toolbar.addEventListener('click', (event) => { const button = event.target.closest('button[data-format]'); if (button) applyEditorFormat(button.dataset.format); });
  toolbar.addEventListener('mousedown', (event) => { if (event.target.closest('button[data-format]')) event.preventDefault(); });
  writing.insertBefore(toolbar, writing.firstElementChild);
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || `请求失败 (${response.status})`); error.status = response.status; throw error; }
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data;
}

function notify(message) {
  const node = $('#toast'); node.textContent = message; node.classList.remove('hidden');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => node.classList.add('hidden'), 2200);
}

function imageFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取剪贴板图片失败'));
    reader.readAsDataURL(file);
  });
}

async function uploadPastedImage(file) {
  const dataUrl = await imageFileDataUrl(file);
  const result = await request('/api/admin/upload-image', { method: 'POST', body: JSON.stringify({ dataUrl }) });
  return result.url;
}

function clipboardImages(event) {
  const files = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile()).filter(Boolean);
  if (!files.length) files.push(...[...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/')));
  return files;
}

function insertPastedImage(preview, range, url) {
  const image = document.createElement('img');
  image.src = url; image.alt = '粘贴的图片';
  const selection = window.getSelection();
  preview.focus({ preventScroll: true });
  if (range && preview.contains(range.commonAncestorContainer)) {
    range.deleteContents(); range.insertNode(image); range.setStartAfter(image); range.collapse(true);
    selection?.removeAllRanges(); selection?.addRange(range);
  } else preview.append(image);
  preview.dispatchEvent(new Event('input', { bubbles: true }));
}

async function handleImagePaste(event, target) {
  const files = clipboardImages(event);
  if (!files.length) return;
  event.preventDefault();
  const preview = target === $('#preview') ? target : null;
  const selection = window.getSelection();
  const range = preview && selection?.rangeCount && preview.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
  const start = target === $('#content') ? target.selectionStart : 0;
  const end = target === $('#content') ? target.selectionEnd : 0;
  notify(`正在上传 ${files.length} 张图片…`);
  try {
    const urls = [];
    for (const file of files) urls.push(await uploadPastedImage(file));
    if (preview) {
      for (const url of urls) insertPastedImage(preview, range, url);
    } else {
      const markdown = urls.map((url) => `![粘贴的图片](${url})`).join('\n');
      insertEditorText(markdown, start, end, start + markdown.length, start + markdown.length);
      target.focus({ preventScroll: true });
    }
    notify(`已插入 ${urls.length} 张图片`);
  } catch (error) {
    notify(`图片上传失败：${error.message}`);
  }
}

async function loadAdmin() {
  await request('/api/admin/session');
  [store.posts, store.site, store.journals] = await Promise.all([request('/api/admin/posts'), request('/api/admin/site'), request('/api/admin/journals')]);
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  fillSiteForm(); setView('dashboard'); await refresh();
}

async function enter(password) {
  if (typeof password === 'string') await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
  await loadAdmin();
}

function fillSiteForm() {
  const form = $('#site-form'); if (!form || !store.site) return;
  ['title', 'en', 'subtitle', 'description', 'avatar', 'logo', 'since', 'authorName', 'authorRole', 'authorAccount', 'about', 'github', 'email', 'footer', 'musicTitle', 'musicUrl', 'introTitle', 'introText', 'heroImage', 'journalName', 'journalDescription', 'donationQr', 'donationText'].forEach((key) => { form.elements[key].value = store.site[key] || ''; });
  form.elements.musicPlaylist.value = (store.site.musicPlaylist || []).map((item) => `${item.title} | ${item.url}`).join('\n');
  form.elements.skills.value = (store.site.skills || []).join(', ');
  form.elements.timeline.value = (store.site.timeline || []).map((item) => `${item.date} | ${item.text}`).join('\n');
  form.elements.heroRotation.checked = store.site.heroRotation !== false;
  form.elements.journalEnabled.checked = store.site.journalEnabled !== false;
  form.elements.effectSakura.checked = store.site.effects?.sakura !== false;
  form.elements.effectLanterns.checked = store.site.effects?.lanterns !== false;
  form.elements.donationEnabled.checked = store.site.donationEnabled === true;
  form.elements.heroImages.value = (store.site.heroImages || []).map((item) => `${item.kind || '其他'} | ${item.label || ''} | ${item.url}`).join('\n');
  form.elements.friendLinks.value = (store.site.friendLinks || []).map((item) => `${item.name} | ${item.url} | ${item.description || ''}`).join('\n');
}

async function refresh() {
  const [stats, guestbook, articleComments, users, journals] = await Promise.all([
    request('/api/stats'), request('/api/guestbook'), request('/api/admin/comments'), request('/api/admin/users'), request('/api/admin/journals'),
  ]);
  store.stats = stats;
  store.users = users;
  store.journals = journals;
  store.comments = [
    ...guestbook.items.map((item) => ({ ...item, scope: 'guestbook' })),
    ...articleComments.map((item) => ({ ...item, scope: 'article' })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time));
  $('#stats').innerHTML = [
    ['文章总数', stats.posts], ['随笔数量', stats.journals || 0], ['总浏览量', stats.views], ['总点赞数', stats.likes], ['注册用户', stats.users],
  ].map(([label, value]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join('');
  renderDashboard(stats); renderPosts(); renderJournals(); renderComments(); renderUsers();
}

function renderDashboard(stats) {
  const items = (stats.topPosts || []).slice(0, 8);
  const maxViews = Math.max(1, ...items.map((item) => item.views || 0));
  const maxLikes = Math.max(1, ...items.map((item) => item.likes || 0));
  const empty = '<div class="chart-empty">还没有足够的数据，发布文章后这里会自动生成统计图。</div>';
  $('#views-chart').innerHTML = items.length ? items.map((item) => `<div class="bar-row"><span title="${esc(item.title)}">${esc(item.title)}</span><div class="bar-track"><i style="width:${Math.round((item.views / maxViews) * 100)}%"></i></div><b>${item.views}</b></div>`).join('') : empty;
  $('#likes-chart').innerHTML = items.length ? items.map((item) => `<div class="bar-row"><span title="${esc(item.title)}">${esc(item.title)}</span><div class="bar-track likes"><i style="width:${Math.round((item.likes / maxLikes) * 100)}%"></i></div><b>${item.likes}</b></div>`).join('') : empty;
}

function renderPosts() {
  const query = $('#search').value.trim().toLowerCase(); const filter = $('#filter').value;
  const rows = store.posts.filter((post) => {
    const text = [post.title, post.slug, post.category, ...(post.tags || [])].join(' ').toLowerCase();
    return (!query || text.includes(query)) && (filter === 'all' || (filter === 'published' && post.published) || (filter === 'draft' && !post.published) || (filter === 'pinned' && post.pinned));
  });
  $('#post-list').innerHTML = rows.map((post) => `<tr>
    <td class="post-name"><strong>${esc(post.title)}</strong><small>/${esc(post.slug)}</small></td>
    <td><span class="badge ${post.published ? '' : 'draft'}">${post.published ? '已发布' : '草稿'}</span>${post.pinned ? '<span class="pin">置顶</span>' : ''}</td>
    <td>${esc(post.category)}</td><td>${esc(post.date)}</td><td>${post.views} 阅读 · ${post.likes} 喜欢</td>
    <td class="actions"><button data-edit="${esc(post.slug)}">编辑</button><button class="delete" data-delete="${esc(post.slug)}">删除</button></td>
  </tr>`).join('');
  $('#post-empty').classList.toggle('hidden', rows.length > 0);
}

function renderJournals() {
  const list = $('#journal-list');
  if (!list) return;
  list.innerHTML = store.journals.length ? store.journals.map((item) => `
    <article class="journal-admin-card">
      <time>${item.time ? new Date(item.time).toLocaleString('zh-CN') : '未记录时间'}</time>
      <p>${esc(String(item.content || '').replace(/\s+/g, ' ').slice(0, 260))}${String(item.content || '').length > 260 ? '…' : ''}</p>
      <div class="actions"><button data-journal-edit="${esc(item.id)}">编辑</button><button class="delete" data-journal-delete="${esc(item.id)}">删除</button></div>
    </article>`).join('') : '<div class="empty">还没有随笔，点击右上角开始写第一段吧。</div>';
}

function renderComments() {
  $('#comment-list').innerHTML = store.comments.length ? store.comments.map((item) => {
    const target = item.postSlug ? `文章：${esc(item.postSlug)}` : item.journalId ? `随笔：${esc(item.journalId)}` : '站点留言板';
    const status = item.status || 'approved';
    const statusLabel = status === 'pending' ? '待审核' : status === 'rejected' ? '已拒绝' : '已通过';
    const scope = item.scope || (item.postSlug ? 'article' : 'guestbook');
    const reviewButtons = status === 'approved'
      ? `<button data-comment-moderate="rejected" data-comment-id="${esc(item.id)}" data-comment-scope="${scope}">拒绝</button>`
      : `<button data-comment-moderate="approved" data-comment-id="${esc(item.id)}" data-comment-scope="${scope}">通过</button>`;
    return `<article class="comment"><div><header><strong>${esc(item.name)}</strong><span class="comment-status comment-status-${status}">${statusLabel}</span><time>${new Date(item.time).toLocaleString('zh-CN')}</time></header><small class="comment-target">${target}</small><p>${esc(item.message)}</p></div><div class="actions">${reviewButtons}<button data-comment-delete="${esc(item.id)}" data-comment-scope="${scope}">删除</button></div></article>`;
  }).join('') : '<div class="empty">暂时没有留言</div>';
}

function renderUsers() {
  const list = $('#user-list');
  if (!list) return;
  list.innerHTML = store.users.map((user) => `<tr>
    <td><img class="user-avatar" src="${esc(user.avatar)}" alt="" onerror="this.src='/img/avatar.svg?v=g1'"></td>
    <td>${esc(user.email)}</td><td>${esc(user.username || '未设置')}</td>
    <td>${user.createdAt ? new Date(user.createdAt).toLocaleString('zh-CN') : '—'}</td>
    <td>${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN') : '—'}</td>
    <td class="actions"><button class="delete" data-user-delete="${esc(user.id)}" data-user-email="${esc(user.email)}">删除</button></td>
  </tr>`).join('');
  $('#user-empty')?.classList.toggle('hidden', store.users.length > 0);
}

function openEditor(post = null, defaultCategory = '') {
  store.journalMode = false; store.journalEditing = null;
  store.editing = post ? post.slug : null;
  const form = $('#post-form'); form.reset();
  setArticleFieldsDisabled(false);
  $('#article-fields').classList.remove('hidden'); $('.editor-grid').classList.remove('journal-only');
  form.elements.date.value = new Date().toISOString().slice(0, 10);
  form.elements.cover.value = '/covers/theme.svg?v=g1'; form.elements.published.checked = true;
  form.elements.category.value = defaultCategory;
  if (post) {
    ['title', 'slug', 'date', 'category', 'minutes', 'excerpt', 'cover', 'content'].forEach((key) => { form.elements[key].value = post[key] ?? ''; });
    form.elements.tags.value = (post.tags || []).join(', '); form.elements.published.checked = post.published; form.elements.pinned.checked = post.pinned;
  }
  form.elements.slug.readOnly = !!post;
  $('#editor-title').textContent = post ? '编辑文章' : '新建文章'; $('#save-editor').textContent = '保存文章'; $('#save-status').textContent = '';
  showTab('preview'); updateCount(); $('#editor-mask').classList.remove('hidden'); form.elements.title.focus();
}

function setArticleFieldsDisabled(disabled) {
  $$('#article-fields input, #article-fields textarea, #article-fields select').forEach((field) => { field.disabled = disabled; });
}

function openJournalEditor(entry = null) {
  store.journalMode = true; store.journalEditing = entry ? entry.id : null; store.editing = null;
  const form = $('#post-form'); form.reset();
  setArticleFieldsDisabled(true);
  $('#article-fields').classList.add('hidden'); $('.editor-grid').classList.add('journal-only');
  $('#content').value = entry?.content || '';
  $('#editor-title').textContent = entry ? '编辑随笔' : '写一条随笔'; $('#save-editor').textContent = '发布随笔'; $('#save-status').textContent = '';
  showTab('preview'); updateCount(); $('#editor-mask').classList.remove('hidden'); $('#preview').focus({ preventScroll: true });
}

function closeEditor() {
  $('#editor-mask').classList.add('hidden');
  store.journalMode = false; store.journalEditing = null; store.editing = null;
  setArticleFieldsDisabled(false); $('#article-fields').classList.remove('hidden'); $('.editor-grid').classList.remove('journal-only');
}

function htmlToMarkdown(root) {
  const inline = (node) => [...node.childNodes].map((child) => {
    if (child.nodeType === Node.TEXT_NODE) return child.nodeValue;
    if (child.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = child.tagName.toLowerCase();
    if (child.matches('.md-anchor')) return '';
    if (child.matches('.resource-unavailable-label')) return '';
    const text = inline(child);
    if (tag === 'strong' || tag === 'b') return `**${text}**`;
    if (tag === 'em' || tag === 'i') return `*${text}*`;
    if (tag === 'del' || tag === 's') return `~~${text}~~`;
    if (tag === 'code' && child.parentElement?.tagName.toLowerCase() !== 'pre') return `\`${text}\``;
    if (tag === 'a') return `[${text}](${child.getAttribute('href') || '#'})`;
    if (tag === 'img') return `![${child.dataset.originalAlt ?? child.getAttribute('alt') ?? ''}](${child.getAttribute('src') || ''})`;
    if (tag === 'br') return '\n';
    return text;
  }).join('');
  const block = (node) => [...node.childNodes].map((child) => {
    if (child.nodeType === Node.TEXT_NODE) return child.nodeValue.trim();
    if (child.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = child.tagName.toLowerCase();
    if (/^h[1-4]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inline(child).trim()}\n\n`;
    if (tag === 'pre') return `\`\`\`\n${child.textContent.trim()}\n\`\`\`\n\n`;
    if (tag === 'figure') {
      const pre = child.querySelector('pre');
      return pre ? `\`\`\`${child.querySelector('figcaption')?.textContent.trim() || ''}\n${pre.textContent.trim()}\n\`\`\`\n\n` : block(child);
    }
    if (tag === 'ul' || tag === 'ol') {
      return [...child.children].map((li, index) => `${tag === 'ol' ? `${index + 1}.` : '-'} ${inline(li).trim()}`).join('\n') + '\n\n';
    }
    if (tag === 'blockquote') return inline(child).split('\n').map((line) => `> ${line}`).join('\n') + '\n\n';
    if (tag === 'hr') return '---\n\n';
    if (tag === 'table') {
      const rows = [...child.querySelectorAll('tr')].map((row) => `| ${[...row.children].map((cell) => inline(cell).trim()).join(' | ')} |`);
      return rows.length > 1 ? `${rows[0]}\n| ${[...child.querySelector('tr').children].map(() => '---').join(' | ')} |\n${rows.slice(1).join('\n')}\n\n` : '';
    }
    if (tag === 'div' || tag === 'p' || tag === 'section' || tag === 'article') return `${inline(child).trim()}\n\n`;
    return inline(child);
  }).join('');
  return block(root).replace(/\n{3,}/g, '\n\n').trim();
}

function syncVisualEditor() {
  const preview = $('#preview');
  if (!preview || preview.classList.contains('hidden')) return;
  $('#content').value = htmlToMarkdown(preview);
  updateCount();
}

function applyVisualFormat(type) {
  const preview = $('#preview');
  if (!preview || preview.classList.contains('hidden')) return false;
  preview.focus();
  if (type === 'clear-format') {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      const range = document.createRange(); range.selectNodeContents(preview);
      selection?.removeAllRanges(); selection?.addRange(range);
    }
    document.execCommand('removeFormat');
    syncVisualEditor();
    return true;
  }
  const commands = { bold: 'bold', italic: 'italic', strike: 'strikeThrough', ul: 'insertUnorderedList', ol: 'insertOrderedList' };
  if (commands[type]) document.execCommand(commands[type]);
  else if (type === 'h2' || type === 'h3') document.execCommand('formatBlock', false, type.toUpperCase());
  else if (type === 'quote') document.execCommand('formatBlock', false, 'BLOCKQUOTE');
  else if (type === 'code-block') document.execCommand('formatBlock', false, 'PRE');
  else if (type === 'hr') document.execCommand('insertHorizontalRule');
  else if (type === 'table') document.execCommand('insertHTML', false, '<table><thead><tr><th>项目</th><th>内容</th></tr></thead><tbody><tr><td>示例</td><td>说明</td></tr></tbody></table>');
  else if (type === 'link') {
    const url = window.prompt('链接地址', 'https://');
    if (url) document.execCommand('createLink', false, url);
  } else if (type === 'image') {
    const url = window.prompt('图片地址', 'https://');
    if (url) document.execCommand('insertImage', false, url);
  } else if (type === 'inline-code') {
    const text = window.getSelection()?.toString() || '代码';
    document.execCommand('insertHTML', false, `<code>${esc(text)}</code>`);
  } else return false;
  syncVisualEditor();
  return true;
}

function showTab(name) {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  if (name === 'write') syncVisualEditor();
  $('#content').classList.toggle('hidden', name !== 'write'); $('#preview').classList.toggle('hidden', name !== 'preview');
  if (name === 'preview') loadPreview();
}
async function loadPreview() {
  $('#preview').innerHTML = '<p class="muted">正在生成预览…</p>';
  try { $('#preview').innerHTML = (await request('/api/admin/preview', { method: 'POST', body: JSON.stringify({ content: $('#content').value }) })).html || ''; $('#preview').focus({ preventScroll: true }); }
  catch (error) { $('#preview').textContent = error.message; }
}
function updateCount() { $('#word-count').textContent = `${$('#content').value.replace(/\s/g, '').length} 字`; }

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const password = $('#password').value; $('#login-error').textContent = '';
  try { await enter(password); $('#password').value = ''; } catch (error) { $('#login-error').textContent = error.message; }
});
$('#logout').addEventListener('click', async () => { try { await request('/api/admin/logout', { method: 'POST' }); } finally { location.reload(); } });
$('#new-post').addEventListener('click', () => { setView('posts'); openEditor(); });
$('#new-journal').addEventListener('click', () => { setView('journals'); openJournalEditor(); });
$('#close-editor').addEventListener('click', closeEditor); $('#cancel-editor').addEventListener('click', closeEditor);
$('#editor-mask').addEventListener('click', (event) => { if (event.target === $('#editor-mask')) closeEditor(); });
$('#search').addEventListener('input', renderPosts); $('#filter').addEventListener('change', renderPosts); $('#content').addEventListener('input', () => { updateCount(); if (!$('#preview').classList.contains('hidden')) loadPreview(); });
$('#preview').addEventListener('input', syncVisualEditor);
$('#preview').addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || image.dataset.unavailableHandled) return;
  image.dataset.unavailableHandled = 'true';
  image.dataset.originalAlt = image.getAttribute('alt') || '';
  image.classList.add('resource-unavailable-source');
  const label = document.createElement('span');
  label.className = 'resource-unavailable-label';
  label.contentEditable = 'false';
  label.setAttribute('role', 'img');
  label.setAttribute('aria-label', image.dataset.originalAlt ? `图片无法加载：${image.dataset.originalAlt}` : '外部资源暂时不可用');
  label.textContent = '▧ 外部资源暂时不可用';
  image.after(label);
}, true);
$('#preview').addEventListener('paste', (event) => handleImagePaste(event, $('#preview')));
$('#content').addEventListener('paste', (event) => handleImagePaste(event, $('#content')));
$('#content').addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const type = event.key.toLowerCase() === 'b' ? 'bold' : event.key.toLowerCase() === 'i' ? 'italic' : event.key.toLowerCase() === 'k' ? 'link' : '';
  if (type) { event.preventDefault(); applyEditorFormat(type); }
});
$$('.tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
function setView(view) {
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $('#dashboard-view').classList.toggle('hidden', view !== 'dashboard');
  $('#posts-view').classList.toggle('hidden', view !== 'posts');
  $('#journals-view').classList.toggle('hidden', view !== 'journals');
  $('#comments-view').classList.toggle('hidden', view !== 'comments');
  $('#users-view').classList.toggle('hidden', view !== 'users');
  $('#settings-view').classList.toggle('hidden', view !== 'settings');
  $('#new-post').classList.toggle('hidden', view !== 'posts');
  $('#new-journal').classList.toggle('hidden', view !== 'journals');
  $('#page-title').textContent = view === 'dashboard' ? '仪表盘' : view === 'comments' ? '留言管理' : view === 'users' ? '用户管理' : view === 'settings' ? '站点设置' : view === 'journals' ? '随笔管理' : '文章管理';
}
$$('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

$('#site-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
  data.skills = data.skills.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  data.timeline = data.timeline.split('\n').map((line) => { const split = line.indexOf('|'); return split < 0 ? { date: '', text: line.trim() } : { date: line.slice(0, split).trim(), text: line.slice(split + 1).trim() }; }).filter((item) => item.date || item.text);
  data.musicPlaylist = data.musicPlaylist.split(/\r?\n/).map((line) => { const split = line.indexOf('|'); return split < 0 ? { title: line.trim(), url: '' } : { title: line.slice(0, split).trim(), url: line.slice(split + 1).trim() }; }).filter((item) => item.title && item.url);
  data.heroRotation = form.elements.heroRotation.checked;
  data.journalEnabled = form.elements.journalEnabled.checked;
  data.heroImages = data.heroImages.split('\n').map((line) => {
    const parts = line.split('|').map((item) => item.trim());
    return { kind: parts[0] || '其他', label: parts[1] || '', url: parts.slice(2).join('|') };
  }).filter((item) => item.url);
  data.effects = { sakura: form.elements.effectSakura.checked, lanterns: form.elements.effectLanterns.checked };
  data.donationEnabled = form.elements.donationEnabled.checked;
  data.friendLinks = data.friendLinks.split('\n').map((line) => {
    const parts = line.split('|').map((item) => item.trim());
    return { name: parts[0] || '', url: parts[1] || '', description: parts.slice(2).join('|') };
  }).filter((item) => item.name && item.url);
  $('#site-status').textContent = '正在保存…';
  try { store.site = await request('/api/admin/site', { method: 'PUT', body: JSON.stringify(data) }); $('#site-status').textContent = '已保存，刷新博客即可看到更新'; notify('站点设置已保存'); }
  catch (error) { $('#site-status').textContent = error.message; }
});

$('#post-list').addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-edit]'); const del = event.target.closest('[data-delete]');
  if (edit) openEditor(store.posts.find((post) => post.slug === edit.dataset.edit));
  if (del && confirm('确定删除这篇文章吗？正文文件也会一并删除，此操作无法撤销。')) {
    try { await request(`/api/admin/posts/${encodeURIComponent(del.dataset.delete)}`, { method: 'DELETE' }); store.posts = store.posts.filter((post) => post.slug !== del.dataset.delete); await refresh(); notify('文章已删除'); }
    catch (error) { notify(error.message); }
  }
});

$('#journal-list').addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-journal-edit]');
  const del = event.target.closest('[data-journal-delete]');
  if (edit) openJournalEditor(store.journals.find((item) => item.id === edit.dataset.journalEdit));
  if (del && confirm('确定删除这条随笔吗？它下面的评论也会一并删除。')) {
    try {
      await request(`/api/admin/journals/${encodeURIComponent(del.dataset.journalDelete)}`, { method: 'DELETE' });
      await refresh(); notify('随笔已删除');
    } catch (error) { notify(error.message); }
  }
});

$('#comment-list').addEventListener('click', async (event) => {
  const moderate = event.target.closest('[data-comment-moderate]');
  if (moderate) {
    moderate.disabled = true;
    try {
      await request(`/api/admin/${moderate.dataset.commentScope}/${encodeURIComponent(moderate.dataset.commentId)}`, {
        method: 'PATCH', body: JSON.stringify({ status: moderate.dataset.commentModerate }),
      });
      await refresh();
      notify(moderate.dataset.commentModerate === 'approved' ? '留言已通过' : '留言已拒绝');
    } catch (error) {
      moderate.disabled = false;
      notify(error.message);
    }
    return;
  }
  const button = event.target.closest('[data-comment-delete]'); if (!button || !confirm('确定删除这条留言吗？')) return;
  const scope = button.dataset.commentScope === 'article' ? 'comments' : 'guestbook';
  try { await request(`/api/admin/${scope}/${encodeURIComponent(button.dataset.commentDelete)}`, { method: 'DELETE' }); store.comments = store.comments.filter((item) => item.id !== button.dataset.commentDelete); await refresh(); notify('留言已删除'); }
  catch (error) { notify(error.message); }
});

$('#user-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-user-delete]');
  if (!button) return;
  const email = button.dataset.userEmail || '这个用户';
  if (!confirm(`确定删除 ${email} 吗？账号资料会被移除，之后可以用同一个邮箱重新注册；历史留言会保留。`)) return;
  button.disabled = true;
  try {
    await request(`/api/admin/users/${encodeURIComponent(button.dataset.userDelete)}`, { method: 'DELETE' });
    await refresh();
    notify('用户已删除，现在可以重新注册');
  } catch (error) {
    button.disabled = false;
    notify(error.message);
  }
});

$('#post-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
  if (store.journalMode) {
    syncVisualEditor();
    const isEditing = Boolean(store.journalEditing);
    $('#save-status').textContent = '正在保存…';
    try {
      const path = isEditing ? `/api/admin/journals/${encodeURIComponent(store.journalEditing)}` : '/api/admin/journals';
      await request(path, { method: isEditing ? 'PUT' : 'POST', body: JSON.stringify({ content: $('#content').value }) });
      closeEditor(); await refresh(); notify(isEditing ? '随笔已更新' : '随笔已发布');
    } catch (error) { $('#save-status').textContent = error.message; }
    return;
  }
  data.tags = data.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean); data.minutes = Number(data.minutes); data.published = form.elements.published.checked; data.pinned = form.elements.pinned.checked;
  $('#save-status').textContent = '正在保存…';
  const isEditing = Boolean(store.editing);
  try {
    await request('/api/admin/posts', { method: store.editing ? 'PUT' : 'POST', body: JSON.stringify(data) });
    store.posts = await request('/api/admin/posts'); closeEditor(); await refresh(); notify(isEditing ? '文章已更新' : '文章已创建');
  } catch (error) { $('#save-status').textContent = error.message; }
});

setupFormattingToolbar();
loadAdmin().catch(() => {});
