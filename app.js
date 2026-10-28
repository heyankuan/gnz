'use strict';
// 逛女装 · 进货查价（手机本地版）
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MULT = [['普通会员', 1.8], ['白金会员', 1.6], ['黄金会员', 1.4]];
const r2 = n => Math.round(n * 100) / 100;
const fmt = n => (n == null || !Number.isFinite(+n)) ? '—' : String(r2(+n));
const pad2 = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};

// ---------- 文本规整 ----------
function normText(s) { return s == null ? '' : String(s).normalize('NFKC').replace(/[‐-―−－]/g, '-').replace(/\s+/g, ' ').trim(); }
function normNum(v) {
  if (v == null || v === '') return null;
  let s = String(v).normalize('NFKC').replace(/[¥￥元,，\s件]/g, '').replace(/[Oo]/g, '0').replace(/[lI|]/g, '1');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
const searchKey = s => normText(s).toUpperCase().replace(/[\s-]/g, '');
function splitCode(code) { const m = /^([A-Za-z0-9][A-Za-z0-9\-]*)(.*)$/.exec(code || ''); return m ? [m[1], m[2]] : ['', code || '']; }

// ---------- 数据（加密同步到 GitHub，本机留一份缓存） ----------
let receipts = (GnzSync.cached()?.data?.receipts) || [];
function renderAll() { renderSearch(); if (!$('#view-records').hidden) renderRecords(); }
let busyN = 0;
function busy(on) { busyN += on ? 1 : -1; document.body.classList.toggle('busy', busyN > 0); }
// 所有修改都走这里：取最新数据 → 修改 → 加密保存到 GitHub
async function commit(fn, msg) {
  busy(true);
  try { const d = await GnzSync.mutate(fn, msg); receipts = d.receipts; renderAll(); setSyncInfo(); return true; }
  catch (e) { toast(e.message || '保存失败'); if (e.code === 'bad_token') renderPerm(); return false; }
  finally { busy(false); }
}
function allItems() {
  const out = [];
  for (const r of receipts) for (const it of (r.items || [])) out.push({ ...it, receiptId: r.id, supplier: r.supplier || '', date: r.date || '', createdAt: r.createdAt || '' });
  out.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  return out;
}
function suppliers() { return [...new Set(receipts.map(r => (r.supplier || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh')); }

// ---------- 通用界面 ----------
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 3500); }
function showTab(t) {
  for (const id of ['search', 'import', 'records']) { $('#view-' + id).hidden = id !== t; $('#tab-' + id).setAttribute('aria-selected', String(id === t)); }
  $('#confirmbar').hidden = !(t === 'import' && draft && !$('#step-review').hidden);
  if (t === 'search') renderSearch();
  if (t === 'records') renderRecords();
  if (t === 'import') { renderPerm(); if (GnzSync.canWrite) warmUp(); }
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
function closeModal() { $('#modal').hidden = true; $('#sheet').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('#modal').dataset.locked) closeModal(); });
function confirmSheet(title, html, okText, onOk, danger) {
  $('#sheet').innerHTML = `<h3>${esc(title)}</h3><p style="margin:0 0 16px">${html}</p><div class="row" style="justify-content:flex-end"><button class="btn" id="mCancel">取消</button><button class="btn ${danger ? 'danger' : 'primary'}" id="mOk">${esc(okText)}</button></div>`;
  $('#modal').hidden = false;
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = () => { closeModal(); onOk(); };
}

// ---------- 查价 ----------
function priceCard(it) {
  const [num, rest] = splitCode(it.code);
  const hide = $('#hideCost').checked;
  return `<article class="tag">
    <div class="tag-head"><div class="code">${num ? `<b>${esc(num)}</b>` : ''}${esc(rest)}</div>
      <button class="icon-btn w" data-edit="${esc(it.receiptId)}|${esc(it.id)}">修改</button></div>
    <div class="meta"><span>名称 <b>${esc(it.name || '—')}</b></span><span>供应商 <b>${esc(it.supplier || '—')}</b></span><span>入库 <b class="num">${esc(it.date || '—')}</b></span><span>进货 <b class="num">${esc(it.qty)}</b> 件</span></div>
    <div class="prices">
      <div class="price cost${hide ? ' hide' : ''}"><small>进货单价</small><strong>¥${fmt(it.cost)}</strong></div>
      ${MULT.map(([n, m]) => `<div class="price"><small>${n} ×${m}</small><strong>¥${fmt(it.cost * m)}</strong></div>`).join('')}
    </div></article>`;
}
function renderSearch() {
  const items = allItems();
  const q = searchKey($('#q').value);
  $('#countInfo').textContent = `共 ${receipts.length} 批 · ${items.length} 条货品`;
  if (!items.length) {
    $('#resultsTitle').textContent = '';
    $('#results').innerHTML = `<div class="empty"><b>还没有商品</b>到“录入小票”选一张供货商的电子小票截图，核对后入库，就能在这里按款号查价。</div>`;
    return;
  }
  let list;
  if (!q) { list = items.slice(0, 15); $('#resultsTitle').textContent = '最近入库'; }
  else {
    const scored = [];
    for (const it of items) {
      const k = searchKey(it.code), num = searchKey(splitCode(it.code)[0]);
      let s = -1;
      if (num === q) s = 3; else if (k.startsWith(q)) s = 2; else if (k.includes(q)) s = 1; else if (searchKey(it.name).includes(q)) s = 0;
      if (s >= 0) scored.push([s, it]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    list = scored.map(x => x[1]);
    $('#resultsTitle').textContent = list.length ? `找到 ${list.length} 条` : '';
  }
  $('#results').innerHTML = list.length ? list.map(priceCard).join('') : `<div class="empty"><b>没有找到这个款号</b>试试只输入款号里的几位数字。</div>`;
}
$('#q').addEventListener('input', renderSearch);
$('#hideCost').checked = LS.get('gnz-hide') === '1';
$('#hideCost').addEventListener('change', () => { LS.set('gnz-hide', $('#hideCost').checked ? '1' : ''); renderSearch(); });
document.addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) { const [rid, iid] = b.dataset.edit.split('|'); openItemEditor(rid, iid); } });

// ---------- 选图 ----------
let images = [];   // [{file, url}]
let draft = null;  // {rows, totalQty, totalAmount, supplier, date, source}
$('#pickBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => {
  for (const f of e.target.files) images.push({ file: f, url: URL.createObjectURL(f) });
  e.target.value = ''; renderThumbs();
};
function renderThumbs() {
  $('#thumbs').innerHTML = images.map((im, i) => `<figure><img src="${im.url}" alt="第 ${i + 1} 张"><button data-rm="${i}" aria-label="移除第 ${i + 1} 张">×</button><figcaption>第 ${i + 1} 张</figcaption></figure>`).join('');
  $('#thumbs').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { URL.revokeObjectURL(images[+b.dataset.rm].url); images.splice(+b.dataset.rm, 1); renderThumbs(); });
  $('#recognizeBtn').disabled = !images.length;
}
let warm = null;
function warmUp() { if (!warm && !GnzOCR.ready) warm = GnzOCR.init().catch(() => { warm = null; }); }

// ---------- 识别 ----------
const FIELDS = ['code', 'name', 'qty', 'price'];
const LOW = 0.85;
function cellToRow(rec, crop) {
  const c = rec.cells, get = k => c[k] || { text: '', conf: 1 };
  const row = {
    key: uid(), strip: crop(rec.box),
    seq: (() => { const n = normNum(get('seq').text); return Number.isInteger(n) ? n : null; })(),
    code: normText(get('code').text), name: normText(get('name').text),
    qty: normNum(get('qty').text), price: normNum(get('price').text),
    amount: c.amount ? normNum(c.amount.text) : null,
    flags: {}, partial: rec.partial,
  };
  for (const f of FIELDS) {
    const cell = get(f);
    if (cell.covered) row.flags[f] = '被屏幕上的按钮挡住，请看上面原图核对';
    else if (cell.text && cell.conf < LOW) row.flags[f] = '这个字段识别把握不大，请核对';
  }
  if (row.qty == null && get('qty').text) row.flags.qty = '读出来是“' + get('qty').text + '”，不是数字';
  if (row.price == null && get('price').text) row.flags.price = '读出来是“' + get('price').text + '”，不是数字';
  return row;
}
function isTotalsRow(rec) { return Object.values(rec.cells).some(c => /合\s*计|总\s*计|共\s*计/.test(c.text || '')); }

$('#recognizeBtn').onclick = async () => {
  if (!images.length) return;
  $('#step-pick').hidden = true; $('#step-run').hidden = false;
  const setRun = (t, p) => { $('#runText').textContent = t; if (p != null) $('#runBar').style.width = Math.round(p * 100) + '%'; };
  setRun('正在准备…', 0.02);
  $('#runHint').hidden = GnzOCR.ready;
  GnzOCR.resetLayout();
  const bySeq = new Map(), noSeq = [];
  let totalQty = null, totalAmount = null;
  try {
    for (let i = 0; i < images.length; i++) {
      const res = await GnzOCR.readReceipt(images[i].file, t => {
        const m = /第 (\d+) \/ (\d+) 行/.exec(t);
        setRun((images.length > 1 ? `第 ${i + 1} / ${images.length} 张：` : '') + t, m ? (i + m[1] / m[2]) / images.length : null);
      });
      for (const rec of res.rows) {
        if (isTotalsRow(rec)) {
          const q = normNum(rec.cells.qty?.text), a = normNum((rec.cells.amount || rec.cells.price)?.text);
          if (q != null) totalQty = q; if (a != null) totalAmount = a;
          continue;
        }
        const row = cellToRow(rec, res.crop);
        if (!row.code && row.qty == null && row.price == null) continue;           // 空行、页脚
        if (row.seq == null && row.qty == null && row.price == null) continue;    // 非商品行
        if (row.seq != null) {
          const prev = bySeq.get(row.seq);
          const score = r => (r.partial ? 10 : 0) + Object.keys(r.flags).length;
          if (!prev || score(row) < score(prev)) bySeq.set(row.seq, row);
        } else noSeq.push(row);
      }
    }
  } catch (e) {
    $('#step-run').hidden = true; $('#step-pick').hidden = false;
    toast(e?.message || '识别失败，请重试');
    return;
  }
  const rows = [...[...bySeq.values()].sort((a, b) => a.seq - b.seq), ...noSeq];
  $('#step-run').hidden = true;
  if (!rows.length) { $('#step-pick').hidden = false; toast('没有在截图里找到商品行。请确认截图里有完整的表格。'); return; }
  draft = { rows, totalQty, totalAmount, supplier: '', date: today(), source: 'ocr' };
  showReview();
};

// ---------- 豆包通道 ----------
const DOUBAO_PROMPT = `请把这张服装进货小票上的商品表格逐行转成文字。
要求：
1. 每个商品一行，格式：款号|名称|数量|单价
2. 款号要完整照抄这一格的全部内容，包括数字后面的中文，例如“51339坑条圆领打底衫”，保留开头的0和中间的横杠。
3. 不要序号，不要表头，不要合计行，不要任何解释文字。
4. 看不清的字用？代替，不要猜。`;
$('#doubaoOpen').onclick = () => { $('#step-pick').hidden = true; $('#step-doubao').hidden = false; };
$('#doubaoCancel').onclick = () => { $('#step-doubao').hidden = true; $('#step-pick').hidden = false; };
$('#copyPrompt').onclick = async () => {
  try { await navigator.clipboard.writeText(DOUBAO_PROMPT); toast('已复制，去豆包粘贴'); }
  catch {
    const ta = $('#doubaoText'); const old = ta.value; ta.value = DOUBAO_PROMPT; ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { }
    ta.value = old; toast(ok ? '已复制，去豆包粘贴' : '复制失败，请手动输入指令');
  }
};
function parsePasted(text) {
  const rows = [];
  for (let line of text.replace(/\r/g, '').split('\n')) {
    line = line.trim();
    if (!line || /^[|\s:：-]+$/.test(line)) continue;                 // markdown 表格分隔线
    if (/款号|货号/.test(line) && /数量|单价/.test(line)) continue;    // 表头
    if (/合\s*计|总\s*计/.test(line)) continue;
    let parts = line.replace(/^\|/, '').replace(/\|$/, '').split(/\s*[|｜\t]\s*/);
    if (parts.length < 3) parts = line.split(/\s*[,，]\s*/);
    if (parts.length < 3) parts = line.split(/\s{2,}|\s+(?=\d+(?:\.\d+)?\s*$)|\s+(?=\d+\s+\d+(?:\.\d+)?\s*$)/);
    parts = parts.map(s => s.trim()).filter(s => s !== '');
    if (parts.length < 3) continue;
    const price = normNum(parts[parts.length - 1]), qty = normNum(parts[parts.length - 2]);
    const code = normText(parts[0].replace(/^\d+[.、]\s*/, ''));
    const name = parts.length >= 4 ? normText(parts.slice(1, parts.length - 2).join(' ')) : '';
    const row = { key: uid(), strip: null, seq: null, code, name, qty, price, amount: null, flags: {}, partial: false };
    if (/[?？]/.test(code + name)) row.flags.code = '有看不清的字（？），请对照小票补全';
    rows.push(row);
  }
  return rows;
}
$('#doubaoParse').onclick = () => {
  const rows = parsePasted($('#doubaoText').value);
  if (!rows.length) return toast('没读到商品行。请把豆包的回复完整粘贴进来');
  $('#step-doubao').hidden = true;
  draft = { rows, totalQty: null, totalAmount: null, supplier: '', date: today(), source: 'doubao' };
  showReview();
};

// ---------- 核对 ----------
function showReview() {
  $('#step-pick').hidden = true; $('#step-run').hidden = true; $('#step-doubao').hidden = true; $('#step-review').hidden = false;
  $('#supplier').value = draft.supplier || ''; $('#inDate').value = draft.date || today();
  $('#supplierList').innerHTML = suppliers().map(s => `<option value="${esc(s)}">`).join('');
  $('#confirmbar').hidden = false;
  renderRows();
  window.scrollTo(0, 0);
}
function rowErrors(r) {
  const e = {};
  if (!normText(r.code)) e.code = '款号不能为空';
  if (!(Number.isInteger(r.qty) && r.qty > 0)) e.qty = '数量应为正整数';
  if (!(r.price != null && r.price >= 0)) e.price = '单价不是有效数字';
  return e;
}
const LABEL = { code: '款号', name: '名称', qty: '数量', price: '单价' };
function fieldHtml(r, f, errs) {
  const cls = errs[f] ? 'cell-err' : (r.flags[f] ? 'cell-flag' : '');
  const im = (f === 'qty' || f === 'price') ? 'inputmode="decimal"' : '';
  return `<label class="${cls}" ${f === 'code' ? 'style="flex:1"' : ''}>${f === 'code' ? '' : LABEL[f]}<input data-k="${r.key}" data-f="${f}" ${im} value="${esc(r[f] ?? '')}" aria-label="${LABEL[f]}" autocomplete="off" autocorrect="off" spellcheck="false"></label>`;
}
function renderRows() {
  $('#rows').innerHTML = draft.rows.map(r => {
    const errs = rowErrors(r);
    const notes = [...new Set([...Object.entries(errs).map(([f, m]) => m), ...Object.entries(r.flags).filter(([f]) => !errs[f]).map(([f, m]) => LABEL[f] + '：' + m)])];
    if (r.partial) notes.push('这一行在截图边缘，可能不完整');
    if (r.amount != null && r.qty != null && r.price != null && Math.abs(r.qty * r.price - r.amount) > 0.01) notes.push(`数量×单价=${fmt(r.qty * r.price)}，和小票金额 ${fmt(r.amount)} 对不上`);
    const hasErr = Object.keys(errs).length, hasFlag = notes.length > hasErr;
    return `<div class="rcard${hasErr ? ' err' : hasFlag ? ' flag' : ''}">
      ${r.strip ? `<img class="strip" src="${r.strip}" alt="小票原图第 ${r.seq ?? ''} 行">` : ''}
      <div class="rtop"><span class="seq" title="小票序号，只用来对照，不会录入">${r.seq != null ? '序号 ' + r.seq : '—'}</span>${fieldHtml(r, 'code', errs)}<button class="icon-btn" data-del="${r.key}">删除</button></div>
      <div class="rgrid">${fieldHtml(r, 'name', errs)}${fieldHtml(r, 'qty', errs)}${fieldHtml(r, 'price', errs)}</div>
      ${notes.length ? `<div class="rnote${hasErr ? ' err' : ''}">${notes.map(esc).join('；')}</div>` : ''}
    </div>`;
  }).join('');
  renderChecks();
}
function renderChecks() {
  const rows = draft.rows, msgs = [];
  const seqs = rows.map(r => r.seq).filter(s => s != null).sort((a, b) => a - b);
  if (seqs.length) {
    const missing = [];
    for (let s = 1; s <= seqs[seqs.length - 1]; s++) if (!seqs.includes(s)) missing.push(s);
    if (missing.length) msgs.push(['bad', `序号 ${missing.join('、')} 没有识别到。可能截图漏了这几行，请补截图后重新识别，或点“手动加一行”补上。`]);
  }
  const qty = rows.reduce((s, r) => s + (Number.isFinite(r.qty) ? r.qty : 0), 0);
  const amt = rows.reduce((s, r) => s + (Number.isFinite(r.qty) && Number.isFinite(r.price) ? r.qty * r.price : 0), 0);
  if (draft.totalQty != null || draft.totalAmount != null) {
    const okQ = draft.totalQty == null || draft.totalQty === qty, okA = draft.totalAmount == null || Math.abs(draft.totalAmount - amt) < 0.01;
    msgs.push([okQ && okA ? 'ok' : 'bad', `小票合计 ${draft.totalQty != null ? draft.totalQty + ' 件' : ''}${draft.totalAmount != null ? ' ¥' + fmt(draft.totalAmount) : ''}，当前 ${qty} 件 ¥${fmt(amt)}：${okQ && okA ? '一致 ✓' : '不一致，请检查'}`]);
  } else {
    msgs.push(['warn', `共 ${rows.length} 款 ${qty} 件，金额 ¥${fmt(amt)}。请和小票底部的合计对一下；如果小票下面还有没截到的，请补截图重新识别。`]);
  }
  const errN = rows.filter(r => Object.keys(rowErrors(r)).length).length;
  const flagN = rows.filter(r => !Object.keys(rowErrors(r)).length && (Object.keys(r.flags).length || r.partial)).length;
  if (errN) msgs.push(['bad', `有 ${errN} 行内容不完整（红框），改好才能入库。`]);
  if (flagN) msgs.push(['warn', `有 ${flagN} 行请对照原图看一眼（黄框）。`]);
  if (!errN && !flagN && draft.source === 'ocr') msgs.push(['ok', '全部识别清晰，没有需要特别注意的行。']);
  if (draft.source === 'doubao') msgs.push(['warn', '这是豆包识别的结果，请逐行对照小票核对。']);
  $('#checks').innerHTML = msgs.map(([k, m]) => `<div class="notice ${k}">${esc(m)}</div>`).join('');
  $('#sumText').innerHTML = `<b>${rows.length}</b> 款 · <b>${qty}</b> 件 · <b>¥${fmt(amt)}</b>`;
}
$('#rows').addEventListener('input', e => {
  const k = e.target.dataset.k, f = e.target.dataset.f; if (!k) return;
  const r = draft.rows.find(x => x.key === k); if (!r) return;
  r[f] = (f === 'qty' || f === 'price') ? normNum(e.target.value) : normText(e.target.value);
  delete r.flags[f];
  clearTimeout(renderRows.t);
  renderRows.t = setTimeout(() => {
    const a = document.activeElement, sel = a?.dataset?.k ? [a.dataset.k, a.dataset.f] : null;
    renderRows();
    if (sel) { const n = document.querySelector(`input[data-k="${sel[0]}"][data-f="${sel[1]}"]`); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch { } } }
  }, 900);
});
$('#rows').addEventListener('click', e => {
  const d = e.target.closest('[data-del]');
  if (d) { draft.rows = draft.rows.filter(x => x.key !== d.dataset.del); renderRows(); }
});
$('#addRow').onclick = () => { draft.rows.push({ key: uid(), strip: null, seq: null, code: '', name: '', qty: null, price: null, amount: null, flags: {}, partial: false }); renderRows(); };
$('#restart').onclick = () => confirmSheet('放弃这次识别？', '已识别和修改的内容不会保存。', '放弃', () => { draft = null; backToPick(); }, true);
function backToPick() { $('#step-review').hidden = true; $('#step-run').hidden = true; $('#step-doubao').hidden = true; $('#step-pick').hidden = false; $('#confirmbar').hidden = true; }

$('#saveBtn').onclick = () => {
  if (!draft) return;
  const supplier = normText($('#supplier').value), date = $('#inDate').value;
  if (!supplier) { toast('请填写供应商'); $('#supplier').focus(); window.scrollTo(0, 0); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('请选择入库时间'); return; }
  if (!draft.rows.length) return toast('没有商品行');
  const bad = draft.rows.filter(r => Object.keys(rowErrors(r)).length);
  if (bad.length) return toast(`还有 ${bad.length} 行款号、数量或单价不完整（红框）`);
  const items = draft.rows.map(r => ({ id: uid(), code: normText(r.code), name: normText(r.name), qty: r.qty, cost: r2(r.price) }));
  const q = items.reduce((s, i) => s + i.qty, 0), a = items.reduce((s, i) => s + i.qty * i.cost, 0);
  confirmSheet('确认入库', `${esc(supplier)} · ${esc(date)}<br>${items.length} 款，${q} 件，进货金额 ¥${fmt(a)}`, '确认入库', async () => {
    const rec = { id: uid(), supplier, date, createdAt: new Date().toISOString(), source: draft.source, items };
    toast('正在保存…');
    if (!await commit(d => { d.receipts.push(rec); }, `入库 ${supplier} ${date} ${items.length}款`)) return;
    draft = null;
    images.forEach(im => URL.revokeObjectURL(im.url)); images = []; renderThumbs();
    backToPick(); toast('已入库并同步 ✓'); showTab('search');
  });
};
$('#supplier').addEventListener('input', e => { if (draft) draft.supplier = e.target.value; });
$('#inDate').addEventListener('input', e => { if (draft) draft.date = e.target.value; });

// ---------- 入库记录 ----------
function renderRecords() {
  const list = [...receipts].sort((a, b) => ((b.date || '') + (b.createdAt || '')).localeCompare((a.date || '') + (a.createdAt || '')));
  const n = list.reduce((s, r) => s + (r.items || []).length, 0);
  $('#recInfo').textContent = list.length ? `${list.length} 批 · ${n} 条货品` : '';
  const lb = LS.get('gnz-last-backup');
  $('#backupInfo').textContent = lb ? '上次备份 ' + lb : '还没有备份过';
  $('#batches').innerHTML = list.length ? list.map(r => {
    const items = r.items || [];
    const q = items.reduce((s, i) => s + (i.qty || 0), 0), a = items.reduce((s, i) => s + (i.qty || 0) * (i.cost || 0), 0);
    return `<details class="batch"><summary><div><div class="bt">${esc(r.supplier || '未填供应商')}</div><div class="muted num">${esc(r.date || '')}${r.source === 'import' ? ' · 旧数据导入' : r.source === 'doubao' ? ' · 豆包识别' : ''}</div></div><div class="num" style="text-align:right">${items.length} 款 · ${q} 件<br><span class="muted">¥${fmt(a)}</span></div></summary>
      <div class="items">${items.map(i => `<div class="item"><div>${esc(i.code)} <span class="muted">${esc(i.name || '')}</span></div><div class="r">${i.qty} × ¥${fmt(i.cost)}</div>
        <div class="acts w"><button class="btn small" data-edit="${esc(r.id)}|${esc(i.id)}">修改</button><button class="btn small danger" data-delitem="${esc(r.id)}|${esc(i.id)}">删除</button></div></div>`).join('')}</div>
      <div class="bacts w"><button class="btn small" data-editbatch="${esc(r.id)}">改供应商 / 日期</button><button class="btn small danger" data-delbatch="${esc(r.id)}">删除整批</button></div></details>`;
  }).join('') : `<div class="empty"><b>还没有入库记录</b>录入第一张小票后会出现在这里。</div>`;
}
$('#batches').addEventListener('click', e => {
  const di = e.target.closest('[data-delitem]'), dbt = e.target.closest('[data-delbatch]'), eb = e.target.closest('[data-editbatch]');
  if (di) {
    const [rid, iid] = di.dataset.delitem.split('|'); const r = receipts.find(x => x.id === rid); const it = r?.items.find(x => x.id === iid); if (!it) return;
    confirmSheet('删除这条货品？', `${esc(it.code)} · ${it.qty} 件 · ¥${fmt(it.cost)}`, '删除', () => {
      commit(d => { const R = d.receipts.find(x => x.id === rid); if (!R) return; R.items = R.items.filter(x => x.id !== iid); if (!R.items.length) d.receipts = d.receipts.filter(x => x.id !== rid); }, '删除货品 ' + it.code).then(ok => ok && toast('已删除'));
    }, true);
  }
  if (dbt) {
    const r = receipts.find(x => x.id === dbt.dataset.delbatch); if (!r) return;
    confirmSheet('删除整批入库？', `${esc(r.supplier)} · ${esc(r.date)} · ${r.items.length} 款。删除后无法恢复。`, '删除整批', () => {
      commit(d => { d.receipts = d.receipts.filter(x => x.id !== r.id); }, '删除整批 ' + r.supplier + ' ' + r.date).then(ok => ok && toast('已删除'));
    }, true);
  }
  if (eb) openBatchEditor(eb.dataset.editbatch);
});
function openItemEditor(rid, iid) {
  const r = receipts.find(x => x.id === rid); const it = r?.items.find(x => x.id === iid); if (!it) return;
  $('#sheet').innerHTML = `<h3>修改货品</h3><div class="stack">
    <label>款号<input id="eCode" value="${esc(it.code)}"></label>
    <label>名称<input id="eName" value="${esc(it.name || '')}"></label>
    <div class="row" style="flex-wrap:nowrap"><label style="flex:1">数量<input id="eQty" inputmode="numeric" value="${esc(it.qty)}"></label><label style="flex:1">进货单价<input id="eCost" inputmode="decimal" value="${esc(it.cost)}"></label></div>
    <p class="muted" style="margin:0">供应商 ${esc(r.supplier)} · 入库 ${esc(r.date)}（整批信息在“入库记录”里修改）</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="mCancel">取消</button><button class="btn primary" id="mOk">保存</button></div></div>`;
  $('#modal').hidden = false;
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = () => {
    const code = normText($('#eCode').value), qty = normNum($('#eQty').value), cost = normNum($('#eCost').value);
    if (!code) return toast('款号不能为空'); if (!(Number.isInteger(qty) && qty > 0)) return toast('数量应为正整数'); if (!(cost != null && cost >= 0)) return toast('单价无效');
    const name = normText($('#eName').value);
    $('#mOk').disabled = true;
    commit(d => { const R = d.receipts.find(x => x.id === rid); const I = R?.items.find(x => x.id === iid); if (I) Object.assign(I, { code, name, qty, cost: r2(cost) }); }, '修改货品 ' + code)
      .then(ok => { if (ok) { closeModal(); toast('已保存'); } else $('#mOk').disabled = false; });
  };
}
function openBatchEditor(rid) {
  const r = receipts.find(x => x.id === rid); if (!r) return;
  $('#sheet').innerHTML = `<h3>修改整批信息</h3><div class="stack">
    <label>供应商<input id="bSup" list="supplierList" value="${esc(r.supplier)}"></label>
    <label>入库时间<input id="bDate" type="date" value="${esc(r.date)}"></label>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="mCancel">取消</button><button class="btn primary" id="mOk">保存</button></div></div>`;
  $('#supplierList').innerHTML = suppliers().map(s => `<option value="${esc(s)}">`).join('');
  $('#modal').hidden = false;
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = () => {
    const supplier = normText($('#bSup').value), date = $('#bDate').value;
    if (!supplier) return toast('请填写供应商'); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('请选择日期');
    $('#mOk').disabled = true;
    commit(d => { const R = d.receipts.find(x => x.id === rid); if (R) Object.assign(R, { supplier, date }); }, '修改整批信息')
      .then(ok => { if (ok) { closeModal(); toast('已保存'); } else $('#mOk').disabled = false; });
  };
}

// ---------- 备份 / 导出 / 导入 ----------
async function giveFile(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return false; }
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); return true;
}
$('#backupBtn').onclick = async () => {
  if (!receipts.length) return toast('还没有数据');
  const blob = new Blob([JSON.stringify({ app: 'guang-nvzhuang', version: 2, exportedAt: new Date().toISOString(), receipts }, null, 1)], { type: 'application/json' });
  if (await giveFile(`逛女装备份-${today()}.json`, blob)) { LS.set('gnz-last-backup', today()); renderRecords(); }
};
$('#exportBtn').onclick = () => {
  const items = allItems(); if (!items.length) return toast('还没有数据');
  const head = ['入库日期', '供应商', '款号', '名称', '数量', '进货单价', ...MULT.map(([n, m]) => `${n}价(×${m})`)];
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + [head, ...items.map(i => [i.date, i.supplier, i.code, i.name, i.qty, fmt(i.cost), ...MULT.map(([, m]) => fmt(i.cost * m))])].map(r => r.map(cell).join(',')).join('\r\n');
  giveFile(`逛女装进货记录-${today()}.csv`, new Blob([csv], { type: 'text/csv' }));
};
$('#restoreBtn').onclick = () => $('#restoreFile').click();
$('#restoreFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let data; try { data = JSON.parse((await f.text()).replace(/^﻿/, '')); } catch { return toast('这个文件不是备份文件'); }
  if (!Array.isArray(data?.receipts)) return toast(Array.isArray(data?.items) ? '这是旧程序的备份，请用“导入旧程序数据”' : '这个文件不是本程序的备份');
  const have = new Set(receipts.map(r => r.id));
  const add = data.receipts.filter(r => r && r.id && Array.isArray(r.items) && !have.has(r.id));
  confirmSheet('从备份恢复', `备份里有 ${data.receipts.length} 批，其中 ${add.length} 批是这部手机上没有的，会被加进来。已有的记录不会被覆盖。`, '恢复', () => {
    commit(d => { const h = new Set(d.receipts.map(r => r.id)); d.receipts.push(...add.filter(r => !h.has(r.id))); }, '从备份恢复').then(ok => ok && toast(`已恢复 ${add.length} 批`));
  });
};
$('#importOldBtn').onclick = () => $('#oldFile').click();
// 读表格文件：支持 csv（UTF-8 或 GBK）、Excel 的 xlsx / xls、旧程序的 json 备份
function loadScriptOnce(src) {
  return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`) && window.XLSX) return res(); const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error('表格组件加载失败，请联网后重试')); document.head.appendChild(sc); });
}
async function readTableFile(f) {
  const buf = new Uint8Array(await f.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4B, isOle = buf[0] === 0xD0 && buf[1] === 0xCF;
  if (isZip || isOle || /\.(xlsx|xls)$/i.test(f.name)) {
    await loadScriptOnce('vendor/xlsx.full.min.js');
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return { table: XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', dateNF: 'yyyy-mm-dd' }) };
  }
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('\uFFFD')) { try { text = new TextDecoder('gbk').decode(buf); } catch { } }  // WPS / Excel 存的 csv 常是 GBK
  text = text.replace(/^\uFEFF/, '');
  if (/^\s*[{\[]/.test(text)) return { json: JSON.parse(text) };
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const sep = lines[0] && lines[0].includes('\t') && !lines[0].includes(',') ? '\t' : ',';
  return { table: lines.map(l => l.split(sep).map(c => c.replace(/^"|"$/g, ''))) };
}
$('#oldFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let rows = [];
  try {
    const got = await readTableFile(f);
    if (got.json) {
      const data = got.json; const list = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(list)) throw new Error(Array.isArray(data.receipts) ? '这是本程序的备份，请用“从备份恢复”' : '没有找到商品列表');
      rows = list.map(x => ({ code: normText(x.code), name: normText(x.name || ''), qty: normNum(x.qty), cost: normNum(x.cost), supplier: normText(x.supplier || '') || '旧数据', date: x.date || '' }));
    } else {
      const table = got.table.filter(r => r.some(c => String(c).trim()));
      // 表头可能不在第一行（前面有标题），找含“款号”的那一行
      const hi = table.findIndex(r => r.some(c => /款号|货号/.test(String(c))));
      if (hi < 0) throw new Error('表格里没找到“款号”这一列的标题');
      const head = table[hi].map(c => String(c).trim());
      const ix = re => head.findIndex(h => re.test(h));
      const [iD, iS, iC, iN, iQ, iP] = [ix(/入库|日期/), ix(/供应商|档口/), ix(/款号|货号/), ix(/名称|品名/), ix(/数量|件数/), ix(/进货|单价|进价|价格/)];
      const miss = [iC < 0 && '款号', iQ < 0 && '数量', iP < 0 && '进货单价'].filter(Boolean);
      if (miss.length) throw new Error('表格里没找到这几列：' + miss.join('、') + '。现在的列是：' + head.filter(Boolean).join('、'));
      const asDate = v => { v = String(v || '').trim(); const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(v); return m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : ''; };
      rows = table.slice(hi + 1).map(c => ({ code: normText(c[iC]), name: iN >= 0 ? normText(c[iN]) : '', qty: normNum(c[iQ]), cost: normNum(c[iP]), supplier: (iS >= 0 ? normText(c[iS]) : '') || '旧数据', date: iD >= 0 ? asDate(c[iD]) : '' }));
    }
  } catch (err) { return toast('文件读不了：' + (err.message || '格式不对')); }
  rows = rows.filter(r => r.code && Number.isInteger(r.qty) && r.qty > 0 && r.cost != null && r.cost >= 0);
  if (!rows.length) return toast('文件里没有可导入的货品');
  const groups = new Map();
  for (const r of rows) { const d = /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : today(); const k = r.supplier + '\u0000' + d; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const existing = [...groups.keys()].filter(k => { const [sp, dt] = k.split('\u0000'); return receipts.some(r => r.supplier === sp && r.date === dt); }).length;
  const qty = rows.reduce((s, r) => s + r.qty, 0);
  confirmSheet('导入表格', `共 ${rows.length} 条货品、${qty} 件。${existing ? '供应商和日期相同的，会并入已有的那一批。' : ''}没有入库日期的记为今天，导入后可以在记录里修改。`, '导入', () => {
    // 供应商 + 日期相同的并入已有批次，否则新建一批
    commit(d => {
      for (const [k, list] of groups) {
        const [supplier, date] = k.split('\u0000');
        const items = list.map(r => ({ id: uid(), code: r.code, name: r.name, qty: r.qty, cost: r2(r.cost) }));
        const same = d.receipts.find(r => r.supplier === supplier && r.date === date);
        if (same) same.items.push(...items);
        else d.receipts.push({ id: uid(), supplier, date, createdAt: new Date().toISOString(), source: 'import', items });
      }
    }, `导入表格 ${rows.length}条`).then(ok => ok && toast(`已导入 ${rows.length} 条`));
  });
};
// ---------- 同步、密码、录入权限 ----------
function setSyncInfo(msg) {
  const c = GnzSync.cached();
  const t = c?.at ? new Date(c.at) : null;
  const when = t ? `${t.getMonth() + 1}-${t.getDate()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}` : '';
  $('#syncInfo').textContent = msg || (when ? '数据更新于 ' + when : '');
}
let lastPull = 0;
async function refresh(force) {
  if (!GnzSync.pass) return askPass();
  if (!force && Date.now() - lastPull < 15000) return;
  lastPull = Date.now();
  $('#syncInfo').textContent = '正在同步…';
  try { const d = await GnzSync.pull(); receipts = d.receipts; renderAll(); setSyncInfo(); }
  catch (e) {
    if (e.code === 'bad_pass') { GnzSync.setPass(''); return askPass('密码不对，或者数据密码已经改过。请重新输入。'); }
    setSyncInfo(); const c = GnzSync.cached();
    $('#syncInfo').textContent = (e.message || '同步失败') + (c?.at ? '（显示的是上次同步的数据）' : '');
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
$('#refreshBtn').onclick = () => refresh(true);

function askPass(note) {
  $('#sheet').innerHTML = `<h3>输入查价密码</h3><div class="stack">
    <p class="muted" style="margin:0" id="pNote">${esc(note || '第一次打开需要输入密码，以后这台手机不用再输。')}</p>
    <label>查价密码<input id="pIn" type="password" autocomplete="current-password"></label>
    <label id="pAgainL" hidden>再输一次<input id="pAgain" type="password" autocomplete="new-password"></label>
    <button class="btn primary" id="pOk">确定</button></div>`;
  $('#modal').hidden = false; $('#modal').dataset.locked = '1';
  setTimeout(() => $('#pIn').focus(), 50);
  let firstTime = false;
  $('#pOk').onclick = async () => {
    const p = $('#pIn').value;
    if (p.length < 6) return toast('密码至少 6 位');
    $('#pOk').disabled = true;
    try {
      if (firstTime) {
        if ($('#pAgain').value !== p) { toast('两次输入不一样'); return; }
      } else {
        const { exists } = await GnzSync.checkPass(p);
        if (!exists) {
          firstTime = true; $('#pAgainL').hidden = false;
          $('#pNote').textContent = '还没有任何数据，这是第一次设置密码。请再输一次确认。以后她的手机也用这个密码。';
          $('#pAgain').focus(); return;
        }
      }
      GnzSync.setPass(p); delete $('#modal').dataset.locked; closeModal(); toast('密码正确'); refresh(true);
    } catch (e) { toast(e.code === 'bad_pass' ? '密码不对' : (e.message || '验证失败')); }
    finally { if ($('#pOk')) $('#pOk').disabled = false; }
  };
}
function renderPerm() {
  const w = GnzSync.canWrite;
  document.body.classList.toggle('ro', !w);
  $('#permInfo').textContent = w ? '这台设备可以录入和修改' : '这台设备只能查看';
  $('#permBtn').textContent = w ? '移除录入权限' : '开启录入';
  $('#noPerm').hidden = w;
  if (!w) { ['#step-pick', '#step-run', '#step-doubao', '#step-review'].forEach(s => $(s).hidden = true); $('#confirmbar').hidden = true; }
  else if (!draft && $('#step-run').hidden && $('#step-doubao').hidden) $('#step-pick').hidden = false;
}
$('#permBtn2').onclick = () => $('#permBtn').click();
$('#permBtn').onclick = () => {
  if (GnzSync.canWrite) return confirmSheet('移除录入权限？', '移除后这台设备只能查看。以后要录入需要重新填写录入钥匙。', '移除', () => { GnzSync.setToken(''); renderPerm(); }, true);
  $('#sheet').innerHTML = `<h3>开启录入</h3><div class="stack">
    <p class="muted" style="margin:0">粘贴录入钥匙（之前生成的那一长串字）。钥匙只保存在这台设备上，不会发给别人。</p>
    <label>录入钥匙<input id="tIn" autocomplete="off" autocorrect="off" spellcheck="false"></label>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="mCancel">取消</button><button class="btn primary" id="mOk">确定</button></div></div>`;
  $('#modal').hidden = false;
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const t = $('#tIn').value.trim(); if (!t) return;
    $('#mOk').disabled = true;
    try { await GnzSync.checkToken(t); GnzSync.setToken(t); closeModal(); renderPerm(); toast('已开启录入'); refresh(true); }
    catch (e) { toast(e.message); $('#mOk').disabled = false; }
  };
};

// ---------- 启动 ----------
renderThumbs();
renderPerm();
showTab('search');
setSyncInfo();
refresh(true);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
