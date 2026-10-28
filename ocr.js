// 逛女装 · 小票离线识别引擎
// 只在手机本地运行：PaddleOCR PP-OCRv4 中文识别模型 + onnxruntime-web。
// 思路：电子小票是规整表格 → 用分隔线切出每一行，用表头切出每一列，逐个格子识别。
'use strict';
const GnzOCR = (() => {
  let session = null, keys = null, loading = null;

  async function init(onProgress) {
    if (session) return;
    if (loading) return loading;
    loading = (async () => {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = new URL('vendor/', location.href).href;
      onProgress && onProgress('正在加载识别模型…');
      const [modelBuf, keyText] = await Promise.all([
        fetch('models/rec.onnx').then(r => { if (!r.ok) throw new Error('模型文件下载失败（' + r.status + '）'); return r.arrayBuffer(); }),
        fetch('models/keys.txt').then(r => { if (!r.ok) throw new Error('字表文件下载失败（' + r.status + '）'); return r.text(); }),
      ]);
      keys = ['', ...keyText.replace(/\r/g, '').split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')), ' '];
      session = await ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] });
    })();
    try { await loading; } finally { loading = null; }
  }

  // ---------- image helpers ----------
  async function loadToCanvas(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('图片无法读取，请换成截图或 JPG/PNG')); i.src = url; });
      let w = img.naturalWidth, h = img.naturalHeight;
      // 统一宽度，便于用固定阈值。太宽缩小，太窄放大。
      const target = Math.min(1400, Math.max(1000, w));
      const s = target / w;
      w = Math.round(w * s); h = Math.round(h * s);
      if (h > 16000) throw new Error('图片太长了，请分成几张截图');
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return c;
    } finally { URL.revokeObjectURL(url); }
  }

  // 把彩色的大色块（屏幕上的悬浮按钮等）涂白，并记下位置
  function maskFloaters(data, W, H) {
    const sat = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 80 && mx - mn > 60) sat[i] = 1;
    }
    const lab = new Int32Array(W * H), mask = new Uint8Array(W * H);
    const stack = new Int32Array(W * H);
    const boxes = [];
    let id = 0;
    for (let i = 0; i < W * H; i++) {
      if (!sat[i] || lab[i]) continue;
      id++; let sp = 0, area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      stack[sp++] = i; lab[i] = id;
      while (sp) {
        const j = stack[--sp]; area++;
        const x = j % W, y = (j / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && sat[j - 1] && !lab[j - 1]) { lab[j - 1] = id; stack[sp++] = j - 1; }
        if (x < W - 1 && sat[j + 1] && !lab[j + 1]) { lab[j + 1] = id; stack[sp++] = j + 1; }
        if (y > 0 && sat[j - W] && !lab[j - W]) { lab[j - W] = id; stack[sp++] = j - W; }
        if (y < H - 1 && sat[j + W] && !lab[j + W]) { lab[j + W] = id; stack[sp++] = j + W; }
      }
      if (area > 2500 && x1 - x0 > 30 && y1 - y0 > 30 && area > 0.35 * (x1 - x0 + 1) * (y1 - y0 + 1)) boxes.push([x0, y0, x1, y1, id]);
    }
    // 只涂掉色块本身的像素（外扩 2 像素抹掉边缘过渡色），不碰旁边深色的字
    const keep = new Set(boxes.map(b => b[4]));
    const pad = 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x; if (!keep.has(lab[k])) continue;
      for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++) {
        const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
        const q = yy * W + xx, p = q * 4;
        if (mask[q]) continue;
        const lum = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
        if (q === k || lum > 140) { mask[q] = 1; data[p] = data[p + 1] = data[p + 2] = 255; }
      }
    }
    // 色块里面的白字/图标：整块范围内的浅色像素也涂白
    for (const [x0, y0, x1, y1] of boxes) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const q = y * W + x, p = q * 4; const lum = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
      if (lum > 140) { data[p] = data[p + 1] = data[p + 2] = 255; }
    }
    const padB = 6;
    return { mask, boxes: boxes.map(b => [b[0] - padB, b[1] - padB, b[2] + padB, b[3] + padB]) };
  }

  function grayOf(data, W, H) {
    const g = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < W * H; i++, p += 4) g[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    return g;
  }
  const INK = 165;

  // 表格横线：一整行大部分像素是浅灰色
  function findSeparators(g, W, H) {
    const runs = [];
    for (let y = 0; y < H; y++) {
      let n = 0, ink = 0; const o = y * W;
      for (let x = 0; x < W; x++) { const v = g[o + x]; if (v > 195 && v < 249) n++; else if (v < INK) ink++; }
      if ((n > 0.6 * W && ink < 0.01 * W) || ink > 0.8 * W) {
        if (runs.length && y - runs[runs.length - 1][1] <= 1) runs[runs.length - 1][1] = y; else runs.push([y, y]);
      }
    }
    // 只要细线（≤6 像素），表头那种整块浅灰底色不算分隔线；相邻的细线合并
    const seps = [];
    for (const r of runs) {
      if (r[1] - r[0] > 6) continue;
      if (seps.length && r[0] - seps[seps.length - 1][1] <= 8) seps[seps.length - 1][1] = r[1]; else seps.push([r[0], r[1]]);
    }
    return seps;
  }
  // 每个横条按自己的底色定“字”的阈值（表头常是浅灰字配浅灰底）
  function bandThresh(g, W, y0, y1) {
    const hist = new Uint32Array(256);
    for (let y = y0; y < y1; y += 2) { const o = y * W; for (let x = 0; x < W; x += 3) hist[g[o + x]]++; }
    let mode = 255, best = -1; for (let v = 0; v < 256; v++) if (hist[v] > best) { best = hist[v]; mode = v; }
    return Math.max(110, Math.min(215, mode - 45));
  }
  function rowInk(g, W, y) { let n = 0; const o = y * W; for (let x = 0; x < W; x++) if (g[o + x] < INK) n++; return n; }
  // 文字行（没有分隔线时的后备做法）
  function textLines(g, W, y0, y1) {
    const lines = []; let s = -1;
    for (let y = y0; y < y1; y++) {
      const has = rowInk(g, W, y) > 1;
      if (has && s < 0) s = y;
      if (!has && s >= 0) { if (y - s > 6) lines.push([s, y]); s = -1; }
    }
    if (s >= 0 && y1 - s > 6) lines.push([s, y1]);
    return lines;
  }
  // 一个横条里按竖向空白切成若干段
  function isLineRow(g, W, y, th) { let n = 0; const o = y * W; for (let x = 0; x < W; x++) if (g[o + x] < th) n++; return n > 0.5 * W; }
  function segments(g, W, y0, y1, gap, th) {
    const col = new Uint8Array(W);
    for (let y = y0; y < y1; y++) { if (isLineRow(g, W, y, th)) continue; const o = y * W; for (let x = 0; x < W; x++) if (g[o + x] < th) col[x] = 1; }
    const raw = []; let s = -1, lastInk = -1;
    for (let x = 0; x < W; x++) {
      if (col[x]) { if (s < 0) s = x; else if (x - lastInk > gap) { raw.push([s, lastInk + 1]); s = x; } lastInk = x; }
    }
    if (s >= 0) raw.push([s, lastInk + 1]);
    // 去掉贯穿整行高度的细竖条（滚动条、竖线）
    const bh = y1 - y0;
    return raw.filter(([a, b]) => a < W * 0.965 || b - a > W * 0.02).filter(([a, b]) => { if (b - a > 14) return true; const bx = inkBox(g, W, a, y0, b, y1, th); return !bx || (bx[3] - bx[1]) < bh * 0.85; });
  }
  function inkBox(g, W, x0, y0, x1, y1, th = INK) {
    let bx0 = x1, by0 = y1, bx1 = -1, by1 = -1;
    for (let y = y0; y < y1; y++) { if (x1 - x0 > W * 0.5 && isLineRow(g, W, y, th)) continue; const o = y * W; for (let x = x0; x < x1; x++) if (g[o + x] < th) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; } }
    return bx1 < 0 ? null : [bx0, by0, bx1 + 1, by1 + 1];
  }

  // ---------- recognition ----------
  const recCanvas = document.createElement('canvas');
  let digitIdx = null;
  async function recognize(srcCanvas, box, numeric) {
    const [x0, y0, x1, y1] = box;
    const bw = x1 - x0, bh = y1 - y0;
    const H = 48, tw = Math.min(2000, Math.max(8, Math.round(bw * H / bh)));
    // 单个字太窄时模型容易认错（如 2→N），两边补白到至少和高度一样宽（实测 1 倍最好）
    const Wd = Math.max(tw, H), off = Math.round((Wd - tw) / 2);
    recCanvas.width = Wd; recCanvas.height = H;
    const ctx = recCanvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, Wd, H);
    ctx.drawImage(srcCanvas, x0, y0, bw, bh, off, 0, tw, H);
    const d = ctx.getImageData(0, 0, Wd, H).data;
    const t = new Float32Array(3 * H * Wd), plane = H * Wd;
    for (let i = 0, p = 0; i < plane; i++, p += 4) { // BGR，和 PaddleOCR 训练时一致
      t[i] = d[p + 2] / 127.5 - 1; t[plane + i] = d[p + 1] / 127.5 - 1; t[2 * plane + i] = d[p] / 127.5 - 1;
    }
    const feeds = {}; feeds[session.inputNames[0]] = new ort.Tensor('float32', t, [1, 3, H, Wd]);
    const out = (await session.run(feeds))[session.outputNames[0]];
    const [, T, C] = out.dims, v = out.data;
    if (!digitIdx) digitIdx = [0, ...'0123456789.'.split('').map(ch => keys.indexOf(ch)).filter(i => i > 0)];
    const decode = (allowed) => {
      let text = '', minP = 1, last = 0;
      for (let i = 0; i < T; i++) {
        let bi = 0, bp = -1; const o = i * C;
        if (allowed) { for (const c of allowed) if (v[o + c] > bp) { bp = v[o + c]; bi = c; } }
        else for (let c = 0; c < C; c++) if (v[o + c] > bp) { bp = v[o + c]; bi = c; }
        if (bi !== 0 && bi !== last) { text += keys[bi] || ''; if (bp < minP) minP = bp; }
        last = bi;
      }
      return { text: text.trim(), conf: text ? minP : 0 };
    };
    const raw = decode(null);
    // 数字列只允许输出数字和小数点；但“合计/总计”这种字要保留，用来识别合计行
    if (numeric && !/[合总共计]/.test(raw.text)) return decode(digitIdx);
    return raw;
  }

  // ---------- header mapping ----------
  const HEAD = [
    ['seq', /序号|序|行号|^No\.?$|^NO$/i],
    ['code', /款号|货号|款式|编号|型号|款/],
    ['name', /名称|品名|商品|品牌|名/],
    ['qty', /数量|件数|数/],
    ['price', /单价|批发价|价格|进价|价/],
    ['amount', /金额|小计|合计/],
  ];
  const NUMERIC = new Set(['seq', 'qty', 'price', 'amount']);
  function headKey(t) { for (const [k, re] of HEAD) if (re.test(t)) return k; return null; }

  let lastLayout = null; // 长小票分几张截图时，后面的截图没有表头，沿用第一张的列位置

  // 主流程：一张图 → 行数组
  async function readReceipt(file, onProgress) {
    await init(onProgress);
    const canvas = await loadToCanvas(file);
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // 保留一份原图，核对时给人看的是没处理过的样子（被按钮挡住的地方照样能看出来）
    const orig = document.createElement('canvas'); orig.width = W; orig.height = H; orig.getContext('2d').drawImage(canvas, 0, 0);
    const imgData = ctx.getImageData(0, 0, W, H);
    const { mask, boxes: floaters } = maskFloaters(imgData.data, W, H);
    ctx.putImageData(imgData, 0, 0);
    const g = grayOf(imgData.data, W, H);
    const gap = Math.max(14, Math.round(W * 0.018));

    // 1) 切行
    const seps = findSeparators(g, W, H);
    let bands = [];
    if (seps.length >= 3) {
      for (let i = 0; i < seps.length - 1; i++) bands.push([seps[i][1] + 1, seps[i + 1][0]]);
      bands.push([seps[seps.length - 1][1] + 1, H]);
      bands = bands.filter(([a, b]) => b - a > 24 && inkBox(g, W, 0, a, W, b));
    } else {
      bands = textLines(g, W, 0, H).map(([a, b]) => [Math.max(0, a - 6), Math.min(H, b + 6)]);
    }
    const heights = bands.map(([a, b]) => b - a).sort((a, b) => a - b);
    const medH = heights[Math.floor(heights.length / 2)] || 0;

    // 2) 找表头：第一条分隔线上方最近的一行字；或任何能读出 ≥3 个表头词的行
    let layout = null;
    const tryHeader = async (y0, y1) => {
      const th = bandThresh(g, W, y0, y1);
      const segs = segments(g, W, y0, y1, Math.round(gap * 1.2), th);
      if (segs.length < 3) return null;
      const cols = [];
      for (const [sx0, sx1] of segs) {
        const b = inkBox(g, W, sx0, y0, sx1, y1, th); if (!b) continue;
        const r = await recognize(canvas, pad(b, W, H));
        const k = headKey(r.text);
        if (k && !cols.some(c => c.key === k)) cols.push({ key: k, x0: sx0, x1: sx1, text: r.text });
      }
      if (cols.length >= 3 && cols.some(c => c.key === 'qty' || c.key === 'price')) return { cols: cols.sort((a, b) => a.x0 - b.x0), W };
      return null;
    };
    let headerLineBottom = -1;
    if (seps.length >= 3) {
      const lines = textLines(g, W, 0, seps[0][0]);
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4) && !layout; i--) {
        layout = await tryHeader(lines[i][0], lines[i][1]);
        if (layout) headerLineBottom = lines[i][1];
      }
    }
    if (!layout) { // 后备：前几行里找表头
      for (const [a, b] of bands.slice(0, 4)) { layout = await tryHeader(a, b); if (layout) { headerLineBottom = b; break; } }
    }
    let usedPrev = false;
    if (!layout && lastLayout && Math.abs(lastLayout.W - W) < 4) { layout = lastLayout; usedPrev = true; }
    if (!layout) throw new Error('没有找到表头（序号 / 款号 / 名称 / 数量 / 单价）。如果是长小票的后半截，请和带表头的第一张一起选上。也可以改用“豆包识别”。');
    lastLayout = layout;

    const cols = layout.cols;
    const centers = cols.map(c => (c.x0 + c.x1) / 2);
    // 表头下面、第一条分隔线上面如果还夹着一行（表头下没画线的情况），补成一行
    if (headerLineBottom >= 0 && seps.length >= 3 && seps[0][0] - headerLineBottom > 24) {
      const extra = [headerLineBottom + 1, seps[0][0]];
      if (inkBox(g, W, 0, extra[0], W, extra[1], bandThresh(g, W, extra[0], extra[1]))) bands.unshift(extra);
    }

    // 3) 逐行逐格识别：每一段字归到离它最近的表头那一列
    const rows = [];
    const dataBands = bands.filter(([a]) => a > headerLineBottom);
    for (let bi = 0; bi < dataBands.length; bi++) {
      const [y0, y1] = dataBands[bi];
      onProgress && onProgress(`正在识别第 ${bi + 1} / ${dataBands.length} 行…`);
      const cells = {};
      const th = bandThresh(g, W, y0, y1);
      const groups = cols.map(() => []);
      for (const sg of segments(g, W, y0, y1, gap, th)) {
        const cx = (sg[0] + sg[1]) / 2;
        let best = 0, bd = Infinity;
        // 左对齐的长内容（如款号带中文描述）以起点判断，短内容以中心判断
        for (let i = 0; i < cols.length; i++) {
          const d = Math.min(Math.abs(cx - centers[i]), Math.abs(sg[0] - cols[i].x0) * 1.2);
          if (d < bd) { bd = d; best = i; }
        }
        groups[best].push(sg);
      }
      for (let i = 0; i < cols.length; i++) {
        const key = cols[i].key, segs = groups[i];
        if (!segs.length) { cells[key] = { text: '', conf: 1 }; continue; }
        const sx0 = Math.min(...segs.map(s => s[0])), sx1 = Math.max(...segs.map(s => s[1]));
        const b = inkBox(g, W, sx0, y0, sx1, y1, th);
        if (!b) { cells[key] = { text: '', conf: 1 }; continue; }
        const r = await recognize(canvas, pad(b, W, H), NUMERIC.has(key));
        let covered = false;
        for (const [fx0, fy0, fx1, fy1] of floaters) if (fx0 < sx1 + gap && fx1 > sx0 - gap && fy0 < y1 && fy1 > y0) covered = true;
        cells[key] = { ...r, covered };
      }
      const partial = medH && (y1 - y0) < medH * 0.62;
      rows.push({ cells, box: [0, y0, W, y1], partial });
    }
    const crop = (box) => { const [x0, y0, x1, y1] = box; const c = document.createElement('canvas'); const s = Math.min(1, 900 / (x1 - x0)); c.width = Math.round((x1 - x0) * s); c.height = Math.round((y1 - y0) * s); c.getContext('2d').drawImage(orig, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.8); };
    return { rows, crop, usedPrev, header: cols.map(c => c.text) };
  }
  function pad(b, W, H) { return [Math.max(0, b[0] - 10), Math.max(0, b[1] - 8), Math.min(W, b[2] + 10), Math.min(H, b[3] + 8)]; }

  function resetLayout() { lastLayout = null; }
  return { init, readReceipt, resetLayout, get ready() { return !!session; } };
})();
