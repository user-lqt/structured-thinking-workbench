/* 二维码编码：把「扫码填写」的链接编成手机相机能直接识别的二维码。
   自实现、零依赖：字节模式 + 纠错等级 M + 版本 1–7 自动选择。
   为什么只到 v7：v1–v7 在 M 级下都是单一分块结构（v4 起为等长多块），不涉及 8 版以后
   「长短块分组交叉排布」；放不下时返回 null，由调用方降级成「表单码」粘贴，不做静默截断。
   依据：ISO/IEC 18004 固定表 + Reed–Solomon(GF(256), 本原多项式 0x11D)。 */
window.WB = window.WB || {};

(function () {
  /* 版本表（纠错等级 M）：total 总码字 / data 数据码字 / ec 每块纠错码字 / blocks 分块数。
     四条数据必须满足 blocks × (data/blocks + ec) = total，自测里有断言。 */
  const VERSIONS = [
    { total: 26, data: 16, ec: 10, blocks: 1 },
    { total: 44, data: 28, ec: 16, blocks: 1 },
    { total: 70, data: 44, ec: 26, blocks: 1 },
    { total: 100, data: 64, ec: 18, blocks: 2 },
    { total: 134, data: 86, ec: 24, blocks: 2 },
    { total: 172, data: 108, ec: 16, blocks: 4 },
    { total: 196, data: 124, ec: 18, blocks: 4 }
  ];
  const MAX_VERSION = VERSIONS.length;
  /* 校正图案的中心坐标（版本 1 没有校正图案；v7 起坐标数变多） */
  const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38]];
  /* 码字排完之后的「剩余位」个数，掩码同样作用在它们上面 */
  const REMAINDER = [0, 7, 7, 7, 7, 7, 0];

  /* ── UTF-8 ─────────────────────────────── */

  function utf8(input) {
    const text = String(input == null ? '' : input);
    if (typeof TextEncoder === 'function') return Array.from(new TextEncoder().encode(text));
    const out = [];
    for (const char of text) {
      const code = char.codePointAt(0);
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return out;
  }

  /* ── GF(256) 与 Reed–Solomon ───────────── */

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initTables() {
    let value = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = value;
      LOG[value] = i;
      value <<= 1;
      if (value & 0x100) value ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  }());

  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
  const expOf = (power) => EXP[((power % 255) + 255) % 255];

  /* 生成多项式 ∏(x - α^i)，i = 0…degree-1，系数从高次到低次，首项恒为 1 */
  function generator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  /* 多项式除法取余：返回 degree 个纠错码字 */
  function rsRemainder(data, degree) {
    const gen = generator(degree);
    const buffer = new Uint8Array(data.length + degree);
    buffer.set(data, 0);
    for (let i = 0; i < data.length; i++) {
      const factor = buffer[i];
      if (!factor) continue;
      for (let j = 0; j < gen.length; j++) buffer[i + j] ^= mul(gen[j], factor);
    }
    return Array.from(buffer.slice(data.length));
  }

  /* ── 容量与版本 ────────────────────────── */

  /* 数据位 = 4 位模式 + 8 位长度（v1–v9）+ 8×字节，必须装进 data 个码字 */
  function maxBytes(version) {
    return Math.floor((VERSIONS[version - 1].data * 8 - 4 - 8) / 8);
  }

  function pickVersion(bytes) {
    for (let version = 1; version <= MAX_VERSION; version++) {
      if (bytes <= maxBytes(version)) return version;
    }
    return 0;
  }

  function dataCodewords(bytes, version) {
    const info = VERSIONS[version - 1];
    const bits = [];
    const push = (value, length) => {
      for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, 8);
    for (const byte of bytes) push(byte, 8);
    const capacityBits = info.data * 8;
    for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
      let value = 0;
      for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j];
      words.push(value);
    }
    for (let i = 0; words.length < info.data; i++) words.push(i % 2 === 0 ? 0xec : 0x11);
    return words;
  }

  /* 分块 → 逐块算纠错 → 按块交错（数据在前、纠错在后） */
  function interleave(words, version) {
    const info = VERSIONS[version - 1];
    const perBlock = info.data / info.blocks;
    const ecPerBlock = info.ec;
    const dataBlocks = [];
    const ecBlocks = [];
    for (let i = 0; i < info.blocks; i++) {
      const block = words.slice(i * perBlock, (i + 1) * perBlock);
      dataBlocks.push(block);
      ecBlocks.push(rsRemainder(block, ecPerBlock));
    }
    const out = [];
    for (let i = 0; i < perBlock; i++) for (const block of dataBlocks) out.push(block[i]);
    for (let i = 0; i < ecPerBlock; i++) for (const block of ecBlocks) out.push(block[i]);
    return out;
  }

  /* ── 矩阵构建 ─────────────────────────── */

  function formatBits(mask) {
    /* 15 位格式信息：5 位数据（2 位纠错等级 M = 00 + 3 位掩码）+ 10 位 BCH，最后异或 0x5412 */
    const data = mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) ? 0x537 : 0);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function drawFormat(modules, fn, size, mask) {
    const bits = formatBits(mask);
    const bit = (i) => ((bits >>> i) & 1) === 1;
    const put = (row, col, dark) => {
      modules[row * size + col] = dark ? 1 : 0;
      if (fn) fn[row * size + col] = 1;
    };
    for (let i = 0; i <= 5; i++) put(i, 8, bit(i));
    put(7, 8, bit(6));
    put(8, 8, bit(7));
    put(8, 7, bit(8));
    for (let i = 9; i < 15; i++) put(8, 14 - i, bit(i));
    for (let i = 0; i < 8; i++) put(8, size - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) put(size - 15 + i, 8, bit(i));
    put(size - 8, 8, true);
  }

  function maskAt(mask, row, col) {
    switch (mask) {
      case 0: return (row + col) % 2 === 0;
      case 1: return row % 2 === 0;
      case 2: return col % 3 === 0;
      case 3: return (row + col) % 3 === 0;
      case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
      case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
      case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
      default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    }
  }

  /* 先摆功能图案，再把数据位从右下角按两列一组蛇形填入（此阶段不加掩码） */
  function buildBase(version, codewords) {
    const size = version * 4 + 17;
    const modules = new Uint8Array(size * size);
    const fn = new Uint8Array(size * size);
    const set = (row, col, dark) => {
      modules[row * size + col] = dark ? 1 : 0;
      fn[row * size + col] = 1;
    };
    const inside = (row, col) => row >= 0 && col >= 0 && row < size && col < size;

    for (const [row0, col0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const row = row0 + dr;
          const col = col0 + dc;
          if (!inside(row, col)) continue;
          const edge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          set(row, col, (dr >= 0 && dr <= 6 && edge) || core);
        }
      }
    }
    for (let i = 8; i <= size - 9; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    const align = ALIGN[version - 1];
    for (const row of align) {
      for (const col of align) {
        if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) set(row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) ? 0x1f25 : 0);
      const bits = (version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(b, a, dark);
        set(a, b, dark);
      }
    }
    drawFormat(modules, fn, size, 0);

    const totalBits = codewords.length * 8 + REMAINDER[version - 1];
    const bitAt = (index) => (index < codewords.length * 8 ? (codewords[index >>> 3] >>> (7 - (index & 7))) & 1 : 0);
    let index = 0;
    let free = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const col = right - j;
          const row = upward ? size - 1 - vert : vert;
          if (fn[row * size + col]) continue;
          free += 1;
          modules[row * size + col] = bitAt(index);
          index += 1;
        }
      }
    }
    return { version, size, modules, fn, totalBits, free, placed: index };
  }

  function maskedCopy(base, mask) {
    const { size, modules, fn } = base;
    const out = Uint8Array.from(modules);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const at = row * size + col;
        if (fn[at]) continue;
        if (maskAt(mask, row, col)) out[at] ^= 1;
      }
    }
    drawFormat(out, null, size, mask);
    return out;
  }

  /* 掩码评分：N1 同色连串 / N2 2×2 同色 / N3 类似探测图案 / N4 黑白失衡 */
  function penalty(size, modules) {
    const at = (row, col) => modules[row * size + col] === 1;
    let score = 0;
    const runs = (line) => {
      let value = 0;
      let run = 1;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) run += 1;
        else {
          if (run >= 5) value += 3 + (run - 5);
          run = 1;
        }
      }
      return value;
    };
    const finderLike = (line) => {
      let count = 0;
      for (let i = 0; i + 11 <= line.length; i++) {
        let window = '';
        for (let j = 0; j < 11; j++) window += line[i + j] ? '1' : '0';
        if (window === '10111010000' || window === '00001011101') count += 1;
      }
      return count;
    };
    const rows = [];
    const cols = [];
    for (let row = 0; row < size; row++) {
      const line = [];
      for (let col = 0; col < size; col++) line.push(at(row, col));
      rows.push(line);
      score += runs(line) + finderLike(line) * 40;
    }
    for (let col = 0; col < size; col++) {
      const line = [];
      for (let row = 0; row < size; row++) line.push(at(row, col));
      cols.push(line);
      score += runs(line) + finderLike(line) * 40;
    }
    for (let row = 0; row < size - 1; row++) {
      for (let col = 0; col < size - 1; col++) {
        const color = at(row, col);
        if (color === at(row, col + 1) && color === at(row + 1, col) && color === at(row + 1, col + 1)) score += 3;
      }
    }
    let dark = 0;
    for (let i = 0; i < modules.length; i++) if (modules[i]) dark += 1;
    const total = size * size;
    const ratio = Math.abs(dark * 20 - total * 10) / total;
    score += Math.floor(ratio) * 10;
    return score;
  }

  /* ── 对外接口 ─────────────────────────── */

  function capacity() {
    return maxBytes(MAX_VERSION);
  }

  function fits(text) {
    return utf8(text).length <= capacity();
  }

  /* 返回 { version, size, modules, mask }，放不下时返回 null */
  function encode(text) {
    const bytes = utf8(text);
    const version = pickVersion(bytes.length);
    if (!version) return null;
    const base = buildBase(version, interleave(dataCodewords(bytes, version), version));
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const modules = maskedCopy(base, mask);
      const score = penalty(base.size, modules);
      if (!best || score < best.score) best = { mask, modules, score };
    }
    return { version, size: base.size, modules: best.modules, mask: best.mask, penalty: best.score, base };
  }

  function svg(text, options = {}) {
    const code = encode(text);
    if (!code) return null;
    const scale = options.scale || 4;
    const margin = options.margin == null ? 4 : options.margin;
    const dim = (code.size + margin * 2) * scale;
    const dark = options.dark || '#0f172a';
    const light = options.light || '#ffffff';
    let path = '';
    for (let row = 0; row < code.size; row++) {
      for (let col = 0; col < code.size; col++) {
        if (!code.modules[row * code.size + col]) continue;
        path += `M${(col + margin) * scale} ${(row + margin) * scale}h${scale}v${scale}h-${scale}z`;
      }
    }
    const background = options.transparent ? '' : `<rect width="${dim}" height="${dim}" fill="${light}"/>`;
    const label = options.label || '扫码填写二维码';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" role="img" aria-label="${label}">${background}<path d="${path}" fill="${dark}"/></svg>`;
  }

  /* 位图版本：浏览器里用离屏 canvas 画出来，方便「下载 PNG」；无 canvas 时返回 null */
  function pngDataUrl(text, options = {}) {
    const code = encode(text);
    if (!code) return null;
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const canvas = document.createElement('canvas');
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const context = canvas.getContext('2d');
    if (!context || typeof context.fillRect !== 'function') return null;
    const scale = options.scale || 8;
    const margin = options.margin == null ? 4 : options.margin;
    const dim = (code.size + margin * 2) * scale;
    canvas.width = dim;
    canvas.height = dim;
    context.fillStyle = options.light || '#ffffff';
    context.fillRect(0, 0, dim, dim);
    context.fillStyle = options.dark || '#0f172a';
    for (let row = 0; row < code.size; row++) {
      for (let col = 0; col < code.size; col++) {
        if (!code.modules[row * code.size + col]) continue;
        context.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
      }
    }
    return typeof canvas.toDataURL === 'function' ? canvas.toDataURL('image/png') : null;
  }

  window.WB.qr = {
    VERSIONS,
    MAX_VERSION,
    MAX_BYTES: capacity(),
    REMAINDER,
    ALIGN,
    utf8,
    byteLength: (text) => utf8(text).length,
    capacity,
    maxBytes,
    pickVersion,
    fits,
    encode,
    svg,
    pngDataUrl,
    formatBits,
    maskAt,
    /* 自检与「回执码校验」用：把矩阵还原成掩码、格式信息与码字长度 */
    inspect: (code) => (code ? { version: code.version, size: code.size, mask: code.mask, bits: code.base.totalBits, free: code.base.free } : null)
  };
}());