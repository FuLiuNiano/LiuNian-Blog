'use strict';
/* 叶语博客封面生成器：平滑扁平插画风 SVG（非像素），输出 public/covers/
 * 运行：node tools/gen-art.js
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'covers');
const IMG = path.join(__dirname, '..', 'public', 'img');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(IMG, { recursive: true });

let uid = 0;
const gid = () => `g${++uid}`;

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}

function lg(id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
  const s = stops.map(([o, c, op]) => `<stop offset="${o}%" stop-color="${c}"${op != null ? ` stop-opacity="${op}"` : ''}/>`).join('');
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${s}</linearGradient>`;
}

function rg(id, stops, cx = 0.5, cy = 0.5, r = 0.7) {
  const s = stops.map(([o, c, op]) => `<stop offset="${o}%" stop-color="${c}"${op != null ? ` stop-opacity="${op}"` : ''}/>`).join('');
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${s}</radialGradient>`;
}

const W = 800, H = 450;

/* 山脉（平滑贝塞尔） */
function mountains(color, baseY, amp, seedPhase, opacity = 1) {
  const pts = [];
  for (let x = 0; x <= W; x += 100) {
    const y = baseY - Math.round(Math.sin((x + seedPhase) / 160) * amp) - Math.round(Math.cos((x + seedPhase) / 90) * amp * 0.3);
    pts.push([x, y]);
  }
  let d = `M0,${H} L0,${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    d += ` C${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}`;
  }
  d += ` L${W},${H} Z`;
  return `<path d="${d}" fill="${color}" opacity="${opacity}"/>`;
}

function cloud(x, y, s = 1, opacity = 0.9) {
  return `<g opacity="${opacity}" transform="translate(${x},${y}) scale(${s})">
    <ellipse cx="0" cy="0" rx="52" ry="18" fill="#fff"/>
    <ellipse cx="-24" cy="-10" rx="30" ry="16" fill="#fff"/>
    <ellipse cx="22" cy="-12" rx="34" ry="18" fill="#fff"/>
  </g>`;
}

function sun(x, y, r, color = '#ffe29a', glow = '#ffd75e') {
  const id = gid();
  return `${rg(id, [[0, glow, 0.9], [60, glow, 0.35], [100, glow, 0]])}
  <circle cx="${x}" cy="${y}" r="${r * 2.2}" fill="url(#${id})"/>
  <circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
}

/* ---------- 各封面场景 ---------- */

const scenes = {};

// 1. MC Mod 指南：草地小岛 + 树 + 云
scenes['mc-mod'] = () => {
  const sky = gid(), gr = gid(), gr2 = gid();
  return svg(W, H, `
    <defs>${lg(sky, [[0, '#8ed8f8'], [55, '#b8e7fb'], [100, '#e8f7ff']])}${lg(gr, [[0, '#8fd07a'], [100, '#5fa85c']])}${lg(gr2, [[0, '#7cb866'], [100, '#4c8a4c']])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${sky})"/>
    ${sun(650, 90, 46)}
    ${cloud(150, 90, 1, .95)}${cloud(420, 60, 0.8, .85)}${cloud(560, 150, 0.6, .7)}
    ${mountains('#a8d8e8', 330, 50, 30, .8)}
    <path d="M0,${H} L0,360 C150,330 300,345 420,362 C560,380 680,368 800,350 L800,${H} Z" fill="url(#${gr})"/>
    <path d="M0,${H} L0,410 C180,385 360,400 520,412 C640,420 730,410 800,400 L800,${H} Z" fill="url(#${gr2})"/>
    <g transform="translate(590,268)">
      <rect x="-9" y="26" width="18" height="64" rx="6" fill="#8a6238"/>
      <circle cx="0" cy="-6" r="52" fill="#63b356"/>
      <circle cx="-38" cy="12" r="34" fill="#5aa84e"/>
      <circle cx="36" cy="10" r="36" fill="#6fbf5f"/>
      <circle cx="-8" cy="-34" r="26" fill="#79c96a"/>
    </g>
    <g transform="translate(170,330)" opacity=".95">
      <rect x="-6" y="14" width="12" height="42" rx="5" fill="#8a6238"/>
      <circle cx="0" cy="0" r="34" fill="#63b356"/>
      <circle cx="-24" cy="12" r="22" fill="#5aa84e"/>
      <circle cx="24" cy="10" r="22" fill="#6fbf5f"/>
    </g>
    <ellipse cx="400" cy="120" rx="120" ry="26" fill="#ffffff" opacity=".35"/>
  `);
};

// 2. Redux：抽象数据流
scenes['redux'] = () => {
  const bg = gid(), n1 = gid(), n2 = gid(), n3 = gid();
  return svg(W, H, `
    <defs>${lg(bg, [[0, '#667eea'], [100, '#764ba2']])}
    ${rg(n1, [[0, '#ffffff', .95], [100, '#ffffff', .1]])}
    ${rg(n2, [[0, '#ffd75e', .95], [100, '#ffd75e', .1]])}
    ${rg(n3, [[0, '#7dfcb4', .95], [100, '#7dfcb4', .1]])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${bg})"/>
    <circle cx="620" cy="90" r="150" fill="#ffffff" opacity=".06"/>
    <circle cx="130" cy="380" r="190" fill="#ffffff" opacity=".06"/>
    <g fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="5" stroke-linecap="round">
      <path d="M150,225 C260,225 260,140 400,140"/>
      <path d="M150,225 C260,225 260,310 400,310"/>
      <path d="M400,140 C540,140 540,225 660,225"/>
      <path d="M400,310 C540,310 540,225 660,225"/>
    </g>
    <circle cx="400" cy="140" r="12" fill="#fff" opacity=".9"/>
    <circle cx="400" cy="310" r="12" fill="#fff" opacity=".9"/>
    <circle cx="150" cy="225" r="46" fill="url(#${n1})"/>
    <circle cx="660" cy="225" r="52" fill="url(#${n3})"/>
    <g transform="translate(400,140)">
      <circle r="40" fill="url(#${n2})"/>
      <text x="0" y="10" text-anchor="middle" font-family="Arial" font-size="30" font-weight="bold" fill="#7a5a10">+</text>
    </g>
    <g font-family="Consolas,monospace" font-size="20" fill="#fff" opacity=".9">
      <text x="118" y="290">state</text>
      <text x="368" y="86">dispatch</text>
      <text x="560" y="290">reducer</text>
    </g>
  `);
};

// 3. Linux：终端窗口
scenes['linux'] = () => {
  const bg = gid(), win = gid();
  return svg(W, H, `
    <defs>${lg(bg, [[0, '#1d2b3a'], [55, '#22384c'], [100, '#2a4258']])}${lg(win, [[0, '#2b3a4a'], [100, '#1e2a36']])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${bg})"/>
    <circle cx="700" cy="380" r="220" fill="#3a5a78" opacity=".25"/>
    <circle cx="90" cy="60" r="150" fill="#3a5a78" opacity=".2"/>
    <g filter="url(#none)">
      <rect x="150" y="70" width="500" height="310" rx="14" fill="url(#${win})"/>
      <rect x="150" y="70" width="500" height="44" rx="14" fill="#39526a"/>
      <rect x="150" y="100" width="500" height="14" fill="#39526a"/>
      <circle cx="180" cy="92" r="7" fill="#ff6b6b"/>
      <circle cx="204" cy="92" r="7" fill="#ffd75e"/>
      <circle cx="228" cy="92" r="7" fill="#5cf08a"/>
      <g font-family="Consolas,monospace" font-size="19">
        <text x="176" y="152" fill="#5cf08a">❯</text><text x="198" y="152" fill="#cfe3d8">whoami</text>
        <text x="176" y="184" fill="#8fb8d8">leaf</text>
        <text x="176" y="222" fill="#5cf08a">❯</text><text x="198" y="222" fill="#cfe3d8">uname -a</text>
        <text x="176" y="254" fill="#8fb8d8" font-size="16">Linux kali 6.6.0 amd64 GNU/Linux</text>
        <text x="176" y="292" fill="#5cf08a">❯</text><text x="198" y="292" fill="#cfe3d8">sudo apt install neofetch</text>
        <rect x="198" y="316" width="12" height="20" fill="#5cf08a"/>
      </g>
    </g>
  `);
};

// 4. 番茄炒蛋：餐盘
scenes['tomato-egg'] = () => {
  const bg = gid(), plate = gid();
  return svg(W, H, `
    <defs>${lg(bg, [[0, '#ffe9d6'], [55, '#ffd9c0'], [100, '#ffc9b8']])}${lg(plate, [[0, '#ffffff'], [100, '#f0ece4']])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${bg})"/>
    <circle cx="90" cy="80" r="120" fill="#ffbf9e" opacity=".35"/>
    <circle cx="720" cy="390" r="150" fill="#ffbf9e" opacity=".3"/>
    <ellipse cx="400" cy="290" rx="235" ry="120" fill="#e8a87c" opacity=".35"/>
    <ellipse cx="400" cy="268" rx="235" ry="120" fill="url(#${plate})"/>
    <ellipse cx="400" cy="272" rx="185" ry="90" fill="#f7f4ee"/>
    <g transform="translate(330,258)">
      <circle r="34" fill="#e85548"/>
      <circle cx="-10" cy="-10" r="10" fill="#ff8a7a" opacity=".8"/>
      <path d="M-6,-30 q6,-10 14,-6" stroke="#5f9e3c" stroke-width="5" fill="none" stroke-linecap="round"/>
    </g>
    <g transform="translate(430,240)">
      <path d="M-38,10 q-6,-26 20,-30 q30,-4 34,22 q3,22 -22,26 q-26,3 -32,-18z" fill="#ffcf4d"/>
      <path d="M-12,22 q-4,-16 12,-18 q18,-2 20,12" fill="#fff6e0"/>
    </g>
    <g transform="translate(472,300)">
      <circle r="24" fill="#ffcf4d"/><circle cx="10" cy="6" r="16" fill="#fff6e0" opacity=".9"/>
    </g>
    <g stroke="#5f9e3c" stroke-width="4" stroke-linecap="round" fill="none">
      <path d="M300,270 q4,-8 12,-6"/><path d="M520,258 q6,-6 12,0"/>
    </g>
    <g stroke="#d8c8b8" stroke-width="5" stroke-linecap="round" opacity=".7" fill="none">
      <path d="M360,140 q10,-16 0,-32"/><path d="M410,132 q12,-18 2,-36"/><path d="M460,140 q10,-16 0,-32"/>
    </g>
  `);
};

// 5. SSH：夜晚传送门
scenes['ssh'] = () => {
  const bg = gid(), po = gid(), glow = gid();
  return svg(W, H, `
    <defs>${lg(bg, [[0, '#141b33'], [55, '#1b2547'], [100, '#25315c']])}
    ${lg(po, [[0, '#b06af5'], [50, '#8a3fe0'], [100, '#6a2ab8']])}
    ${rg(glow, [[0, '#b06af5', .5], [100, '#b06af5', 0]])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${bg})"/>
    <g fill="#cdd6ff">
      <circle cx="90" cy="70" r="2.5"/><circle cx="180" cy="130" r="2"/><circle cx="300" cy="60" r="2.5"/>
      <circle cx="700" cy="90" r="2.5"/><circle cx="640" cy="180" r="2"/><circle cx="740" cy="250" r="2"/>
      <circle cx="120" cy="250" r="2"/><circle cx="420" cy="90" r="2"/><circle cx="540" cy="50" r="2.5"/>
    </g>
    <circle cx="120" cy="90" r="34" fill="#e8ecff"/><circle cx="110" cy="84" r="26" fill="#141b33"/>
    <ellipse cx="400" cy="430" rx="420" ry="120" fill="#2a2440"/>
    <ellipse cx="400" cy="405" rx="420" ry="90" fill="#332b52"/>
    <ellipse cx="400" cy="240" rx="240" ry="230" fill="url(#${glow})"/>
    <g transform="translate(400,245)">
      <rect x="-105" y="-160" width="210" height="320" rx="18" fill="#241a38"/>
      <rect x="-86" y="-140" width="172" height="280" rx="12" fill="url(#${po})"/>
      <g fill="#d8b8ff" opacity=".8">
        <circle cx="-40" cy="-80" r="4"/><circle cx="30" cy="-30" r="3.5"/><circle cx="0" cy="30" r="4"/>
        <circle cx="52" cy="70" r="3"/><circle cx="-52" cy="90" r="3.5"/><circle cx="10" cy="-110" r="3"/>
      </g>
      <g stroke="#ffffff" stroke-opacity=".25" stroke-width="8" stroke-linecap="round">
        <path d="M-60,-120 q-20,120 20,240"/><path d="M60,-120 q20,120 -20,240"/>
      </g>
    </g>
    <g fill="none" stroke="#3a3158" stroke-width="6" opacity=".9">
      <path d="M-20,368 C120,344 260,380 400,368 C560,354 680,380 820,362"/>
    </g>
  `);
};

// 6. 旅行：日落湖景
scenes['travel'] = () => {
  const sky = gid(), sea = gid(), mt = gid();
  return svg(W, H, `
    <defs>${lg(sky, [[0, '#8a4a8a'], [35, '#d8695f'], [70, '#f2a052'], [100, '#ffd07f']])}
    ${lg(sea, [[0, '#e8956a'], [30, '#c8696a'], [100, '#5a3a70']])}
    ${lg(mt, [[0, '#5a2d5e'], [100, '#3d1f4a']])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${sky})"/>
    ${sun(400, 268, 52, '#ffe9a8', '#ffc46b')}
    <path d="M0,300 L0,260 C80,220 150,240 220,268 C300,298 380,258 460,272 C560,290 640,250 720,262 C760,268 780,262 800,258 L800,300 Z" fill="url(#${mt})" opacity=".92"/>
    <rect y="300" width="${W}" height="150" fill="url(#${sea})"/>
    <g stroke="#ffe9a8" stroke-width="5" stroke-linecap="round" opacity=".65">
      <path d="M330,322 h140"/><path d="M352,348 h96"/><path d="M368,374 h64"/>
    </g>
    <g stroke="#ffffff" stroke-opacity=".3" stroke-width="4" stroke-linecap="round">
      <path d="M90,330 h80"/><path d="M620,340 h90"/><path d="M120,390 h60"/><path d="M600,400 h70"/>
    </g>
    <g transform="translate(430,362)">
      <path d="M-46,0 q46,26 92,0 l-12,18 q-34,14 -68,0 Z" fill="#4a2a20"/>
      <rect x="-2" y="-58" width="4" height="58" fill="#3a221a"/>
      <path d="M2,-56 L44,-8 L2,-8 Z" fill="#fff4e0"/>
      <path d="M-2,-50 L-34,-10 L-2,-10 Z" fill="#ffe9c8"/>
    </g>
    <g stroke="#3d1f3a" stroke-width="4" stroke-linecap="round" fill="none">
      <path d="M150,120 q10,-12 20,0 q10,-12 20,0"/><path d="M210,90 q8,-10 16,0 q8,-10 16,0"/>
    </g>
  `);
};

// 7. Docker：集装箱与鲸
scenes['docker'] = () => {
  const bg = gid(), sea = gid();
  const box = (x, y, c1, c2) => `
    <rect x="${x}" y="${y}" width="76" height="46" rx="6" fill="${c1}"/>
    <rect x="${x}" y="${y}" width="76" height="14" rx="6" fill="${c2}"/>
    <g stroke="${c2}" stroke-width="4" opacity=".6">${[1, 2, 3].map((k) => `<line x1="${x + k * 19}" y1="${y + 4}" x2="${x + k * 19}" y2="${y + 42}"/>`).join('')}</g>`;
  return svg(W, H, `
    <defs>${lg(bg, [[0, '#bfe8f5'], [100, '#8ed0ea']])}${lg(sea, [[0, '#5ab4d8'], [100, '#2a7ab0']])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${bg})"/>
    ${sun(660, 84, 40, '#fff2c8', '#ffe29a')}
    ${cloud(160, 80, 0.9, .9)}${cloud(520, 130, 0.7, .75)}
    <path d="M0,320 C140,300 260,330 400,322 C560,314 680,334 800,318 L800,${H} L0,${H} Z" fill="url(#${sea})"/>
    <g transform="translate(378,236)">
      ${box(-160, -46, '#3dbd9d', '#2b8f74')}
      ${box(-76, -46, '#f2b544', '#c78a1e')}
      ${box(8, -46, '#5a8fe8', '#3a68b8')}
      ${box(-118, -94, '#f07a5a', '#c25a3a')}
      ${box(-34, -94, '#7a68e8', '#5a48b8')}
      <path d="M-190,0 q-16,-38 24,-44 q-2,26 10,30 q60,16 150,10 q80,-6 120,-24 q26,-12 40,-34 q14,44 -18,72 q-40,34 -130,36 q-120,4 -196,-46z" fill="#5a7a9a"/>
      <g transform="translate(122,-24)"><circle r="7" fill="#fff"/><circle cx="2.4" r="3.4" fill="#1d3a52"/></g>
      <path d="M-186,6 q-30,-6 -44,-28 q30,-4 48,12z" fill="#4a6a8a"/>
      <path d="M-40,44 q6,-22 -12,-30 M20,46 q8,-20 -8,-32" stroke="#4a9ac4" stroke-width="5" fill="none" stroke-linecap="round"/>
    </g>
  `);
};

// 8. 红石：发光电路
scenes['redstone'] = () => {
  const bg = gid(), lamp = gid();
  return svg(W, H, `
    <defs>${lg(bg, [[0, '#232838'], [100, '#151a28']])}${lg(lamp, [[0, '#ffe9a8'], [100, '#ffb84d']])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${bg})"/>
    <g stroke="#3a4258" stroke-width="2" opacity=".5">
      ${[80, 240, 400, 560, 720].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`).join('')}
      ${[75, 150, 225, 300, 375].map((y) => `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`).join('')}
    </g>
    <g fill="none" stroke="#ff5a4a" stroke-width="5" stroke-linecap="round">
      <path d="M80,375 H400 V225 H720"/>
      <path d="M240,375 V300 H560 V150"/>
    </g>
    <g fill="#ffe9a8">
      <circle cx="400" cy="225" r="9"/><circle cx="560" cy="300" r="9"/><circle cx="240" cy="375" r="9"/><circle cx="720" cy="225" r="9"/>
    </g>
    <g transform="translate(560,150)">
      <circle r="52" fill="#ff9a2e" opacity=".18"/>
      <rect x="-30" y="-30" width="60" height="60" rx="10" fill="url(#${lamp})"/>
      <rect x="-30" y="-30" width="60" height="60" rx="10" fill="none" stroke="#c88a3a" stroke-width="4"/>
      <path d="M-12,-2 L-2,10 L14,-10" stroke="#8a5a1a" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g transform="translate(150,300)" font-family="Consolas,monospace" font-size="17" fill="#8a92a8">
      <rect x="-12" y="-26" width="150" height="52" rx="10" fill="#2a3048"/>
      <text x="2" y="-6" fill="#ffb84d">POWER 100%</text>
      <text x="2" y="16" fill="#5cf08a">SIGNAL OK</text>
    </g>
    <circle cx="80" cy="375" r="12" fill="#ff5a4a"/>
    <circle cx="80" cy="375" r="22" fill="#ff5a4a" opacity=".25"/>
  `);
};

// 9. Git：分支曲线
scenes['git'] = () => {
  const bg = gid();
  return svg(W, H, `
    <defs>${lg(bg, [[0, '#2a3348'], [100, '#1a2130']])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${bg})"/>
    <circle cx="660" cy="110" r="180" fill="#3a4a68" opacity=".25"/>
    <g fill="none" stroke-linecap="round" stroke-width="6">
      <path d="M70,260 C160,260 180,180 290,180 C400,180 420,260 530,260 C620,260 660,220 740,220" stroke="#4a9a5f"/>
      <path d="M180,260 C280,260 300,120 400,120 C500,120 520,180 620,180" stroke="#5a9ae8"/>
      <path d="M530,260 C590,260 610,320 700,320" stroke="#f2b544"/>
    </g>
    <g stroke-width="0">
      ${[[70, 260, '#7adf8f'], [180, 260, '#7adf8f'], [290, 180, '#7adf8f'], [400, 120, '#8fc4ff'], [530, 260, '#7adf8f'], [400, 180, '#8fc4ff'], [620, 180, '#8fc4ff'], [740, 220, '#7adf8f'], [700, 320, '#ffd75e']].map(([x, y, c]) => `
        <circle cx="${x}" cy="${y}" r="20" fill="#141a28"/>
        <circle cx="${x}" cy="${y}" r="12" fill="${c}"/>
      `).join('')}
    </g>
    <g font-family="Consolas,monospace" font-size="18">
      <rect x="620" y="238" width="92" height="34" rx="17" fill="#2e5a3a"/>
      <text x="666" y="261" text-anchor="middle" fill="#b8f8c8">main</text>
      <rect x="560" y="96" width="92" height="34" rx="17" fill="#2a4a72"/>
      <text x="606" y="119" text-anchor="middle" fill="#bfe0ff">feature</text>
    </g>
  `);
};

// 10. 主题改造：调色与卡片
scenes['theme'] = () => {
  const bg = gid();
  return svg(W, H, `
    <defs>${lg(bg, [[0, '#e8f0f8'], [100, '#d0dcea']])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${bg})"/>
    <circle cx="120" cy="90" r="110" fill="#c2d4ea" opacity=".6"/>
    <circle cx="700" cy="380" r="140" fill="#c2d4ea" opacity=".6"/>
    <g transform="translate(250,225) rotate(-8)">
      <rect x="-150" y="-95" width="300" height="190" rx="16" fill="#ffffff"/>
      <rect x="-150" y="-95" width="300" height="56" rx="16" fill="#8ed8c8"/>
      <rect x="-150" y="-55" width="300" height="16" fill="#8ed8c8"/>
      <rect x="-126" y="-18" width="180" height="10" rx="5" fill="#d8e2ec"/>
      <rect x="-126" y="4" width="230" height="10" rx="5" fill="#e4ecf4"/>
      <rect x="-126" y="26" width="150" height="10" rx="5" fill="#e4ecf4"/>
      <rect x="-126" y="52" width="90" height="10" rx="5" fill="#eef4f8"/>
    </g>
    <g transform="translate(540,235)">
      <circle r="88" fill="#f5efe4"/>
      <circle cx="-32" cy="-28" r="17" fill="#ff8a7a"/>
      <circle cx="8" cy="-40" r="17" fill="#ffd75e"/>
      <circle cx="44" cy="-16" r="17" fill="#7adf8f"/>
      <circle cx="36" cy="28" r="17" fill="#8fc4ff"/>
      <circle cx="-16" cy="40" r="17" fill="#b89af0"/>
      <circle cx="52" cy="52" r="12" fill="#f5efe4"/>
    </g>
    <g transform="translate(660,110) rotate(24)">
      <rect x="-7" y="-52" width="14" height="74" rx="7" fill="#c8a06a"/>
      <path d="M-9,-52 q9,-16 18,0 q-2,10 -9,10 q-7,0 -9,-10z" fill="#ff8a7a"/>
    </g>
    <g stroke="#9ab4cc" stroke-width="5" stroke-linecap="round" fill="none" opacity=".8">
      <path d="M130,360 q14,-20 0,-38 q-12,-16 2,-34"/>
    </g>
  `);
};

// 11. 像素画：画架与方块
scenes['pixel-art'] = () => {
  const bg = gid();
  const px = (x, y, s, c) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${c}"/>`;
  const g = ['#8fd460', '#79c04c', '#63aa3a'];
  let face = '';
  const F = [
    '........', '.##..##.', '.##..##.', '...##...', '..####..', '..#..#..', '........', '........',
  ];
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const c = F[j][i] === '#' ? '#2a3a28' : g[(i + j) % 3];
    face += px(-96 + i * 24, -96 + j * 24, 24, c);
  }
  return svg(W, H, `
    <defs>${lg(bg, [[0, '#f8e8d0'], [100, '#f0d8b8']])}</defs>
    <rect width="${W}" height="${H}" fill="url(#${bg})"/>
    <circle cx="680" cy="90" r="130" fill="#f8d8b0" opacity=".7"/>
    <ellipse cx="400" cy="420" rx="330" ry="36" fill="#d8b088" opacity=".4"/>
    <g transform="translate(400,238)">
      <rect x="-118" y="-118" width="236" height="236" rx="12" fill="#a0784a"/>
      <rect x="-104" y="-104" width="208" height="208" rx="6" fill="#ffffff"/>
      <rect x="-96" y="-96" width="192" height="192" fill="#fbf6ea"/>
      ${face}
      <g stroke="#8a6238" stroke-width="14" stroke-linecap="round">
        <line x1="-90" y1="130" x2="-60" y2="200"/><line x1="90" y1="130" x2="60" y2="200"/><line x1="0" y1="118" x2="0" y2="200"/>
      </g>
    </g>
    <g transform="translate(140,150) rotate(-12)">
      <rect x="-24" y="-24" width="48" height="48" rx="8" fill="#8fd460"/>
      <rect x="-14" y="-14" width="28" height="28" rx="5" fill="#5a8a4a"/>
    </g>
    <g transform="translate(672,330) rotate(10)">
      <rect x="-20" y="-20" width="40" height="40" rx="7" fill="#63aa3a"/>
    </g>
  `);
};

/* ---------- 输出 ---------- */
for (const [name, fn] of Object.entries(scenes)) {
  const s = fn().replace(/\n\s*/g, '');
  fs.writeFileSync(path.join(OUT, `${name}.svg`), s);
  console.log(`covers/${name}.svg  ${(s.length / 1024).toFixed(1)} KB`);
}

/* ---------- 头像：渐变叶片 ---------- */
function avatar() {
  const g1 = gid(), g2 = gid();
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    ${lg(g1, [[0, '#5ec9a0'], [100, '#3a9ad8']])}
    ${lg(g2, [[0, '#e8fff4'], [100, '#b8f0d8']])}
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#${g1})"/>
  <path d="M96 30 C58 30 36 52 34 84 C33 98 38 106 40 106 C44 106 44 96 52 88 C64 76 78 74 78 74 C78 74 62 82 52 98 C46 108 48 112 54 111 C86 104 100 82 98 48 C97 38 96 30 96 30 Z" fill="url(#${g2})"/>
  <path d="M46 104 C56 84 72 72 88 64" stroke="#5ec9a0" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>
  <circle cx="100" cy="34" r="6" fill="#ffffff" opacity=".8"/>
</svg>`;
  fs.writeFileSync(path.join(IMG, 'avatar.svg'), s);
  console.log('img/avatar.svg');

  const f = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>${lg('fg', [[0, '#5ec9a0'], [100, '#3a9ad8']])}</defs>
  <rect width="64" height="64" rx="14" fill="url(#fg)"/>
  <path d="M48 15 C29 15 18 26 17 42 C16.5 49 19 53 20 53 C22 53 22 48 26 44 C32 38 39 37 39 37 C39 37 31 41 26 49 C23 54 24 56 27 55.5 C43 52 50 41 49 24 C48.5 19 48 15 48 15 Z" fill="#eafff5"/>
</svg>`;
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), f);
  console.log('favicon.svg');
}
avatar();
console.log('全部生成完毕');
