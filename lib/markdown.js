'use strict';
/* 极简 Markdown 渲染器（零依赖）
 * 支持：h1-h4、段落、粗体/斜体/行内代码/删除线、链接、图片、
 *      围栏代码块（带语言标签）、有序/无序列表、引用、表格、分隔线。
 * 所有输出先转义 HTML，防止 XSS。
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

// 安全链接：仅允许 http/https/相对/锚点
function safeUrl(u) {
  const t = String(u).trim();
  if (/^(https?:|\/|#|\.\/)/i.test(t)) return escapeAttr(t);
  return '#';
}

// 行内元素：code 最先处理并占位，避免内部再被解析
function inline(text) {
  const codes = [];
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push('<code class="md-inline-code">' + c + '</code>');
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
    `<img src="${safeUrl(src)}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, href) =>
    `<a href="${safeUrl(href)}" target="_blank" rel="noopener">${txt}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
  return s;
}

function slugifyHeading(text, seen) {
  let base = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
  if (!base) base = 'sec';
  let slug = base, i = 2;
  while (seen.has(slug)) slug = base + '-' + i++;
  seen.add(slug);
  return slug;
}

function render(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const seen = new Set();
  let i = 0;

  const isTableSep = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-');

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(
        `<figure class="md-code"><figcaption class="md-code-lang">${escapeHtml(lang || 'code')}</figcaption>` +
        `<pre><code>${escapeHtml(buf.join('\n'))}</code></pre></figure>`
      );
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const raw = h[2].trim();
      const slug = slugifyHeading(raw.replace(/[*_`~]/g, ''), seen);
      out.push(`<h${level} id="${slug}"><a class="md-anchor" href="#${slug}">#</a>${inline(raw)}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const parseRow = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) { rows.push(parseRow(lines[i])); i++; }
      out.push('<div class="md-table-wrap"><table><thead><tr>' +
        head.map((c) => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push('<blockquote>' + render(buf.join('\n')) + '</blockquote>');
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        buf.push(inline(lines[i].replace(/^\s*[-*+]\s+/, ''))); i++;
      }
      out.push('<ul>' + buf.map((b) => `<li>${b}</li>`).join('') + '</ul>');
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.、)]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+[.、)]\s+/.test(lines[i])) {
        buf.push(inline(lines[i].replace(/^\s*\d+[.、)]\s+/, ''))); i++;
      }
      out.push('<ol>' + buf.map((b) => `<li>${b}</li>`).join('') + '</ol>');
      continue;
    }

    // 空行
    if (!line.trim()) { i++; continue; }

    // 段落（连续非空行合并）
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() &&
      !/^(#{1,4}\s|```|>|\s*[-*+]\s|\s*\d+[.、)]\s)/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${inline(buf.join(' ').trim())}</p>`);
  }

  return out.join('\n');
}

module.exports = { render, escapeHtml };
