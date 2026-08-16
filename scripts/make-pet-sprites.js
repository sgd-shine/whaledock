'use strict';

// 生成内置宠物包的 PNG 帧图。原创像素画，零依赖（Node 自带 zlib 写 PNG）。
// 只在需要重绘出厂宠物时手动运行：node scripts/make-pet-sprites.js
// 产物入库，运行时不依赖本脚本。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GRID = 32;          // 逻辑像素网格
const SCALE = 4;          // 每个逻辑像素放大成 4x4，最终 128x128
const SIZE = GRID * SCALE;

// 鲸坞品牌色板；不使用任何第三方或官方素材。
const C = {
  none: [0, 0, 0, 0],
  outline: [11, 18, 37, 255],
  bodyDark: [30, 42, 94, 255],
  body: [47, 64, 136, 255],
  belly: [138, 160, 214, 255],
  accent: [34, 211, 238, 255],
  primary: [79, 70, 229, 255],
  white: [230, 237, 247, 255],
  eye: [5, 7, 12, 255],
  warn: [248, 113, 113, 255]
};

function blankGrid() {
  return Array.from({ length: GRID }, () => Array.from({ length: GRID }, () => C.none));
}

function put(grid, x, y, color) {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
  grid[y][x] = color;
}

function fillEllipse(grid, cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) put(grid, x, y, color);
    }
  }
}

function outlineOpaque(grid, color) {
  const before = grid.map((row) => row.slice());
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (before[y][x] !== C.none) continue;
      const touching = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < GRID && ny < GRID && before[ny][nx] !== C.none;
      });
      if (touching) put(grid, x, y, color);
    }
  }
}

// 一只原创像素鲸鱼：椭圆身体 + 尾鳍 + 肚皮 + 眼睛，可整体上下微移。
function whaleBase(offsetY = 0) {
  const grid = blankGrid();
  const cx = 14;
  const cy = 17 + offsetY;
  fillEllipse(grid, cx, cy, 9, 6, C.body);
  fillEllipse(grid, cx, cy + 2.5, 8, 3.5, C.belly);
  fillEllipse(grid, cx - 1, cy - 1.5, 8.5, 4, C.body);
  // 尾鳍
  for (let i = 0; i < 6; i += 1) {
    for (let y = cy - 5 + i; y <= cy + 5 - i; y += 1) {
      if (Math.abs(y - cy) >= 2 - i * 0.3) put(grid, cx + 8 + i, y, C.bodyDark);
    }
  }
  // 侧鳍
  fillEllipse(grid, cx - 1, cy + 4, 2.5, 1.5, C.bodyDark);
  return { grid, cx, cy };
}

function eyeOpen(grid, cx, cy) {
  put(grid, cx - 6, cy - 1, C.eye);
  put(grid, cx - 6, cy - 2, C.eye);
  put(grid, cx - 5, cy - 2, C.eye);
  put(grid, cx - 5, cy - 1, C.white);
}

function eyeClosed(grid, cx, cy) {
  put(grid, cx - 6, cy - 1, C.eye);
  put(grid, cx - 5, cy - 1, C.eye);
}

function eyeCross(grid, cx, cy) {
  put(grid, cx - 6, cy - 2, C.warn);
  put(grid, cx - 5, cy - 1, C.warn);
  put(grid, cx - 6, cy - 1, C.warn);
  put(grid, cx - 5, cy - 2, C.warn);
  put(grid, cx - 7, cy - 3, C.warn);
  put(grid, cx - 4, cy, C.warn);
}

function spout(grid, cx, cy, height) {
  const top = cy - 8;
  for (let i = 0; i < height; i += 1) put(grid, cx - 2, top - i, C.accent);
  if (height >= 2) {
    put(grid, cx - 3, top - height + 1, C.accent);
    put(grid, cx - 1, top - height + 1, C.accent);
  }
  if (height >= 3) {
    put(grid, cx - 4, top - height + 2, C.accent);
    put(grid, cx, top - height + 2, C.accent);
  }
}

function bubble(grid, cx, cy, char) {
  // 头顶的小提示块：等待用主色方块，庆祝用亮色星点。
  const x = cx - 3;
  const y = cy - 12;
  if (char === 'wait') {
    for (let dy = 0; dy < 3; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) put(grid, x + dx, y + dy, C.primary);
    }
    put(grid, x, y + 4, C.primary);
    put(grid, x + 1, y + 4, C.primary);
  }
  if (char === 'party') {
    for (const [dx, dy] of [[0, 0], [3, -1], [-3, 1], [5, 2], [-5, 0]]) {
      put(grid, x + dx, y + dy, C.accent);
      put(grid, x + dx + 1, y + dy, C.white);
    }
  }
}

function frame(kind) {
  const offsets = { 'idle-1': 0, 'idle-2': 1 };
  const { grid, cx, cy } = whaleBase(offsets[kind] || 0);
  if (kind === 'idle-2') eyeClosed(grid, cx, cy);
  else if (kind === 'error') eyeCross(grid, cx, cy);
  else eyeOpen(grid, cx, cy);

  if (kind.startsWith('busy')) spout(grid, cx, cy, Number(kind.slice(-1)));
  if (kind === 'waiting') bubble(grid, cx, cy, 'wait');
  if (kind === 'celebrate') { bubble(grid, cx, cy, 'party'); spout(grid, cx, cy, 3); }
  outlineOpaque(grid, C.outline);
  return grid;
}

// 极简款：一只纯色圆润小鲸，只有一张图，专门演示「单图宠物」。
function minimalGrid() {
  const grid = blankGrid();
  fillEllipse(grid, 16, 17, 10, 8, C.primary);
  fillEllipse(grid, 16, 20, 8, 4, C.accent);
  put(grid, 11, 15, C.white);
  put(grid, 11, 14, C.white);
  put(grid, 12, 15, C.eye);
  put(grid, 12, 14, C.eye);
  for (let i = 0; i < 5; i += 1) {
    for (let y = 12 + i; y <= 22 - i; y += 1) put(grid, 26 + i, y, C.primary);
  }
  outlineOpaque(grid, C.outline);
  return grid;
}

function encodePng(grid) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  let offset = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[offset] = 0; // filter type 0
    offset += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b, a] = grid[Math.floor(y / SCALE)][Math.floor(x / SCALE)];
      raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b; raw[offset + 3] = a;
      offset += 4;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function write(dir, name, grid) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, encodePng(grid));
  console.log(`WROTE ${path.relative(process.cwd(), file)}`);
}

function main() {
  const root = path.join(__dirname, '..', 'assets', 'pets');
  const whaleDir = path.join(root, 'pixel-whale');
  for (const kind of [
    'idle-1', 'idle-2', 'busy-1', 'busy-2', 'busy-3', 'waiting', 'celebrate', 'error'
  ]) {
    write(whaleDir, `${kind}.png`, frame(kind));
  }
  fs.writeFileSync(path.join(whaleDir, 'manifest.json'), `${JSON.stringify({
    name: '像素鲸鱼',
    author: '鲸坞 WhaleDock',
    license: 'MIT',
    frameRate: 4,
    size: { width: 128, height: 128 },
    anchor: 'bottom-right',
    states: {
      idle: ['idle-1.png', 'idle-2.png'],
      busy: ['busy-1.png', 'busy-2.png', 'busy-3.png'],
      waiting: ['waiting.png'],
      celebrate: ['celebrate.png'],
      error: ['error.png']
    }
  }, null, 2)}\n`);
  console.log('WROTE assets/pets/pixel-whale/manifest.json');

  // 极简款故意不带 manifest：它本身就是「单图宠物」的活教材。
  write(path.join(root, 'minimal-whale'), 'idle.png', minimalGrid());
}

main();
