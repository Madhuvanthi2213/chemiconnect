/**
 * Tiny QR code generator (no dependencies). Byte mode, error-correction level M, versions 1-10 (up to 213 bytes).
 * Used to make the QR label of a medicine batch. Based on the public QR Code specification (ISO/IEC 18004).
 *
 *   qrMatrix('https://example.com/?trace=CC123')  -> array of rows, each row an array of booleans (true = dark module)
 *   qrSvg(text, { size: 160, margin: 4 })          -> SVG markup string (crisp at any size, prints well)
 */

// [ecc codewords per block, blocks in group 1, data codewords per block in group 1, blocks in group 2, data codewords per block in group 2] for level M
const M_TABLE = [
  null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MAX_V = 10;

/* ---- Reed-Solomon over GF(256), polynomial 0x11D ---- */
const EXP = new Array(512), LOG = new Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

function rsGenerator(deg) {
  let g = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); }
    g = next;
  }
  return g; // highest degree first, leading coefficient 1
}
function rsRemainder(data, gen) {
  const deg = gen.length - 1;
  const rem = new Array(deg).fill(0);
  for (const b of data) {
    const f = b ^ rem.shift();
    rem.push(0);
    if (f !== 0) for (let i = 0; i < deg; i++) rem[i] ^= gmul(gen[i + 1], f);
  }
  return rem;
}

function utf8(str) { return Array.from(new TextEncoder().encode(str)); }

function capacityBytes(v) {
  const [, b1, d1, b2, d2] = M_TABLE[v];
  const dataCw = b1 * d1 + b2 * d2;
  const countBits = 8;                       // byte mode char-count bits for versions 1-9 (v10 uses 16)
  const cb = v >= 10 ? 16 : countBits;
  return Math.floor((dataCw * 8 - 4 - cb) / 8);
}

function buildCodewords(bytes, v) {
  const [eccLen, b1, d1, b2, d2] = M_TABLE[v];
  const dataCw = b1 * d1 + b2 * d2;
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, v >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  const cap = dataCw * 8;
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) { let x = 0; for (let j = 0; j < 8; j++) x = (x << 1) | bits[i + j]; data.push(x); }
  for (let pad = 0xec; data.length < dataCw; pad ^= 0xec ^ 0x11) data.push(pad);

  // split into blocks, add ECC, interleave
  const blocks = []; let pos = 0;
  const gen = rsGenerator(eccLen);
  const add = (count, len) => { for (let i = 0; i < count; i++) { const d = data.slice(pos, pos + len); pos += len; blocks.push({ d, e: rsRemainder(d, gen) }); } };
  add(b1, d1); add(b2, d2);
  const out = [];
  const maxD = Math.max(d1, d2 || 0);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

/* ---- matrix construction ---- */
function makeGrid(v) {
  const n = 17 + 4 * v;
  const mod = Array.from({ length: n }, () => new Array(n).fill(false));
  const fn = Array.from({ length: n }, () => new Array(n).fill(false)); // true = function pattern (not data)
  const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < n && y < n) { mod[y][x] = dark; fn[y][x] = true; } };

  // finder patterns + separators
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  // timing patterns
  for (let i = 0; i < n; i++) { if (!fn[6][i]) set(i, 6, i % 2 === 0); if (!fn[i][6]) set(6, i, i % 2 === 0); }
  // alignment patterns
  const al = ALIGN[v];
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // reserve format info areas + dark module
  for (let i = 0; i < 9; i++) { set(8, i, false); set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(n - 1 - i, 8, false); set(8, n - 1 - i, false); }
  set(8, n - 8, true);
  // reserve version info areas (v >= 7)
  if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { set(n - 11 + j, i, false); set(i, n - 11 + j, false); }
  return { n, mod, fn };
}

function placeData(g, cw) {
  const { n, mod, fn } = g;
  const bits = [];
  for (const b of cw) for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  let k = 0, up = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let t = 0; t < n; t++) {
      const y = up ? n - 1 - t : t;
      for (let c = 0; c < 2; c++) {
        const x = right - c;
        if (!fn[y][x]) { mod[y][x] = k < bits.length ? bits[k] === 1 : false; k++; }
      }
    }
    up = !up;
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

function bchFormat(data) { // 5 data bits (ecc level + mask) -> 15 bit format string
  let r = data << 10;
  for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10);
  return ((data << 10) | r) ^ 0x5412;
}
function bchVersion(v) {
  let r = v << 12;
  for (let i = 17; i >= 12; i--) if ((r >>> i) & 1) r ^= 0x1f25 << (i - 12);
  return (v << 12) | r;
}

function drawFormat(g, mask) {
  const { n, mod } = g;
  const f = bchFormat((0b00 << 3) | mask); // level M = 00
  const bit = i => ((f >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) mod[i][8] = bit(i);
  mod[7][8] = bit(6); mod[8][8] = bit(7); mod[8][7] = bit(8);
  for (let i = 9; i < 15; i++) mod[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) mod[8][n - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) mod[n - 15 + i][8] = bit(i);
  mod[n - 8][8] = true;
}
function drawVersion(g, v) {
  if (v < 7) return;
  const { n, mod } = g;
  const bits = bchVersion(v);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = n - 11 + (i % 3), b = Math.floor(i / 3);
    mod[b][a] = dark; mod[a][b] = dark;
  }
}

function penalty(mod) {
  const n = mod.length;
  let p = 0;
  // rule 1: runs of 5+ same colour
  for (let pass = 0; pass < 2; pass++) for (let a = 0; a < n; a++) {
    let run = 1;
    for (let b = 1; b < n; b++) {
      const cur = pass ? mod[b][a] : mod[a][b], prev = pass ? mod[b - 1][a] : mod[a][b - 1];
      if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
    }
  }
  // rule 2: 2x2 blocks
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
  // rule 3: finder-like 1:1:3:1:1 patterns
  const pat = [true, false, true, true, true, false, true];
  for (let pass = 0; pass < 2; pass++) for (let a = 0; a < n; a++) for (let b = 0; b <= n - 7; b++) {
    const at = i => pass ? mod[b + i][a] : mod[a][b + i];
    let ok = true; for (let i = 0; i < 7; i++) if (at(i) !== pat[i]) { ok = false; break; }
    if (!ok) continue;
    const light = (s, e) => { for (let i = s; i < e; i++) { if (b + i < 0 || b + i >= n) continue; if (at(i)) return false; } return true; };
    if (light(-4, 0)) p += 40;
    if (light(7, 11)) p += 40;
  }
  // rule 4: dark/light balance
  let dark = 0; for (const row of mod) for (const c of row) if (c) dark++;
  const pct = (dark * 100) / (n * n);
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

export function qrMatrix(text) {
  const bytes = utf8(String(text));
  let v = 1;
  while (v <= MAX_V && capacityBytes(v) < bytes.length) v++;
  if (v > MAX_V) throw new Error('Text is too long for the QR label');
  const cw = buildCodewords(bytes, v);
  let best = null, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    const g = makeGrid(v);
    placeData(g, cw);
    for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) if (!g.fn[y][x] && MASKS[m](x, y)) g.mod[y][x] = !g.mod[y][x];
    drawFormat(g, m); drawVersion(g, v);
    const p = penalty(g.mod);
    if (p < bestP) { bestP = p; best = g.mod; }
  }
  return best;
}

export function qrSvg(text, { size = 160, margin = 4, fg = '#000', bg = '#fff' } = {}) {
  const m = qrMatrix(text), n = m.length, t = n + margin * 2;
  let d = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!m[y][x]) { x++; continue; }
      let e = x; while (e < n && m[y][e]) e++;
      d += `M${x + margin} ${y + margin}h${e - x}v1h-${e - x}z`;
      x = e;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${t}" height="${t}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}
