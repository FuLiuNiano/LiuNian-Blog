'use strict';
/* 鼠标光标生成器：把 16x16 像素道具画成 SVG 光标，输出 public/cursors/
 * 运行：node tools/gen-cursors.js
 */

const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'cursors');
fs.mkdirSync(OUT, { recursive: true });

const PAL = {
  // 钻石
  d1: '#a8fff0', d2: '#4aedd9', d3: '#2bbfae', d4: '#177f74',
  // 金色（护手/扣环）
  g1: '#ffd75e', g2: '#d8a03c', g3: '#9c6a1e',
  // 木头（手柄/弓身）
  w1: '#a06a3c', w2: '#7a4a26', w3: '#5a3418',
  // 弓弦/线
  s1: '#f0f0e8',
  // 附魔紫
  p1: '#d8b0ff', p2: '#b07af5', p3: '#8a4fd0',
  // 书
  b1: '#8a5a9c', b2: '#6a3f7a', b3: '#4a2a58',
  page: '#f5eed8',
  dark: '#141428',
};

function svgCursor(name, cells, hotspot) {
  let body = '';
  for (const [x, y, c] of cells) {
    body += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
  }
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16" shape-rendering="crispEdges">${body}</svg>`;
  fs.writeFileSync(path.join(OUT, name + '.svg'), s);
  console.log(`cursors/${name}.svg  hotspot(${hotspot})`);
}

/* ---------- 钻石剑：剑尖朝左上，hotspot 在剑尖 ---------- */
function sword() {
  const cells = [];
  // 剑刃：从 (1,1) 到 (8,8) 两格宽对角线
  for (let k = 0; k < 8; k++) {
    cells.push([1 + k, 1 + k, PAL.d1]);
    cells.push([2 + k, 1 + k, PAL.d2]);
    if (k % 3 === 2) cells.push([2 + k, 2 + k, PAL.d3]);
  }
  cells.push([9, 9, PAL.d3]);
  // 暗部描边（右下一侧）
  for (let k = 2; k < 9; k += 2) cells.push([1 + k, 2 + k, PAL.d3]);
  // 护手（穿过剑身的金色短杠，垂直于剑刃方向）
  for (const [x, y] of [[6, 10], [7, 9], [10, 6], [9, 7], [10, 9], [9, 10], [6, 9], [9, 6]]) {
    cells.push([x, y, PAL.g2]);
  }
  cells.push([7, 10, PAL.g1], [10, 6, PAL.g1]);
  // 手柄
  cells.push([10, 10, PAL.w2], [11, 11, PAL.w1], [12, 12, PAL.w1], [12, 11, PAL.w2]);
  cells.push([13, 13, PAL.g2], [13, 12, PAL.g1]); // 柄尾
  svgCursor('sword', cells, [2, 2]);
}

/* ---------- 附魔弓：弓身朝右弧出，弦在左，hotspot 居中 ---------- */
function bow() {
  const cells = [];
  // 弓弦：左侧竖线
  for (let y = 1; y <= 14; y++) cells.push([3, y, PAL.s1]);
  // 弓身：从弦两端弧出到右侧
  const arc = [[3, 1], [4, 1], [4, 2], [5, 3], [6, 4], [7, 5], [7, 6], [8, 7], [8, 8], [7, 9], [7, 10], [6, 11], [5, 12], [4, 13], [4, 14], [3, 14]];
  for (const [x, y] of arc) cells.push([x, y, PAL.w1]);
  for (const [x, y] of [[5, 2], [6, 3], [6, 4], [6, 12], [5, 13]]) cells.push([x, y, PAL.w2]);
  // 握把
  cells.push([8, 7, PAL.w3], [8, 8, PAL.w3], [9, 7, PAL.w2], [9, 8, PAL.w2]);
  // 附魔紫光（散布）
  for (const [x, y, c] of [[5, 4, PAL.p1], [7, 6, PAL.p2], [6, 11, PAL.p1], [8, 8, PAL.p2], [4, 13, PAL.p1], [9, 8, PAL.p3]]) {
    cells.push([x, y, c]);
  }
  svgCursor('bow', cells, [8, 8]);
}

/* ---------- 附魔书：紫色书面 + 金扣 + 闪光，hotspot 居中 ---------- */
function book() {
  const cells = [];
  for (let y = 3; y <= 12; y++) {
    for (let x = 3; x <= 12; x++) {
      if ((x === 3 || x === 12 || y === 3 || y === 12) && !(y === 7 && x >= 3 && x <= 5)) {
        cells.push([x, y, PAL.b3]);        // 描边
      } else if (x <= 5) {
        cells.push([x, y, PAL.b2]);        // 书脊阴影
      } else {
        cells.push([x, y, PAL.b1]);        // 封面
      }
    }
  }
  cells.push([12, 7, PAL.page], [12, 8, PAL.page]); // 书页
  cells.push([9, 7, PAL.g1], [9, 8, PAL.g1], [10, 7, PAL.g2], [10, 8, PAL.g2]); // 金扣
  // 附魔闪光
  for (const [x, y, c] of [[6, 5, PAL.p1], [8, 10, PAL.p1], [11, 5, PAL.p2], [5, 9, PAL.p2], [7, 4, PAL.p1]]) {
    cells.push([x, y, c]);
  }
  svgCursor('book', cells, [8, 8]);
}

sword();
bow();
book();
console.log('光标生成完毕');
