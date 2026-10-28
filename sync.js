'use strict';
// 逛女装 · 数据同步
// 数据加密后存成仓库里的 data.enc.json。
// 查看：任何设备只要有“查价密码”，就从网页地址读取并解密。
// 录入：设备上填了 GitHub 令牌（只能写这个仓库），才能通过 GitHub 接口写入。
const GnzSync = (() => {
  const FILE = 'data.enc.json';
  const CFG = 'gnz-cfg-v1', CACHE = 'gnz-cache-v1';
  // 网址形如 https://用户名.github.io/仓库名/ ，从网址推出仓库位置
  const OWNER = /\.github\.io$/.test(location.hostname) ? location.hostname.split('.')[0] : 'heyankuan';
  const REPO = /\.github\.io$/.test(location.hostname) ? (location.pathname.split('/')[1] || 'gnz') : 'gnz';
  const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };
  let cfg = ls.get(CFG) || {};
  const saveCfg = () => ls.set(CFG, cfg);

  // ---------- 加密 ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function keyFrom(pass, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(obj, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(pass, salt), enc.encode(JSON.stringify(obj)));
    return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
  }
  async function decrypt(text, pass) {
    const f = JSON.parse(text);
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, await keyFrom(pass, unb64(f.salt)), unb64(f.ct));
      return JSON.parse(dec.decode(pt));
    } catch { const e = new Error('查价密码不对'); e.code = 'bad_pass'; throw e; }
  }
  const utf8b64 = s => b64(enc.encode(s));
  const fromUtf8b64 = s => dec.decode(unb64(s.replace(/\s/g, '')));

  // ---------- GitHub 接口（录入用） ----------
  const ghHeaders = () => ({ Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  async function ghGet() {
    let r;
    try { r = await fetch(API + '?ref=main&t=' + Date.now(), { headers: ghHeaders(), cache: 'no-store' }); }
    catch { const e = new Error('连不上 GitHub，请检查网络后重试'); e.code = 'network'; throw e; }
    if (r.status === 404) return { sha: null, text: null };
    if (r.status === 401) { const e = new Error('录入令牌无效或已过期，请重新填写'); e.code = 'bad_token'; throw e; }
    if (r.status === 403) { const e = new Error('录入令牌没有写入权限，或请求太频繁'); e.code = 'forbidden'; throw e; }
    if (!r.ok) { const e = new Error('GitHub 暂时不可用（' + r.status + '）'); e.code = 'upstream'; throw e; }
    const j = await r.json();
    return { sha: j.sha, text: fromUtf8b64(j.content) };
  }
  async function ghPut(text, sha, message) {
    let r;
    try { r = await fetch(API, { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: utf8b64(text), branch: 'main', ...(sha ? { sha } : {}) }) }); }
    catch { const e = new Error('连不上 GitHub，没有保存，请检查网络后重试'); e.code = 'network'; throw e; }
    if (r.status === 409 || r.status === 422) { const e = new Error('数据刚被另一台设备改过'); e.code = 'conflict'; throw e; }
    if (r.status === 401) { const e = new Error('录入令牌无效或已过期，请重新填写'); e.code = 'bad_token'; throw e; }
    if (r.status === 403 || r.status === 404) { const e = new Error('录入令牌没有这个仓库的写入权限'); e.code = 'forbidden'; throw e; }
    if (!r.ok) { const e = new Error('保存失败（' + r.status + '）'); e.code = 'upstream'; throw e; }
  }

  // ---------- 对外接口 ----------
  const empty = () => ({ version: 2, receipts: [] });
  function cached() { return ls.get(CACHE); } // {data, at}
  function setCache(data) { ls.set(CACHE, { data, at: new Date().toISOString() }); }

  // 读取最新数据。有令牌走 GitHub 接口（最新），没有令牌读网页上的文件（有一两分钟延迟）。
  async function pull() {
    if (!cfg.pass) { const e = new Error('需要查价密码'); e.code = 'need_pass'; throw e; }
    let text = null;
    if (cfg.token) {
      text = (await ghGet()).text;
    } else {
      let r;
      try { r = await fetch(FILE + '?t=' + Date.now(), { cache: 'no-store' }); }
      catch { const e = new Error('网络不通，显示的是上次同步的数据'); e.code = 'network'; throw e; }
      if (r.status === 404) text = null;
      else if (!r.ok) { const e = new Error('读取数据失败（' + r.status + '）'); e.code = 'upstream'; throw e; }
      else text = await r.text();
    }
    const data = text ? await decrypt(text, cfg.pass) : empty();
    if (!Array.isArray(data.receipts)) data.receipts = [];
    setCache(data);
    return data;
  }

  // 修改数据：先取最新版，改完加密写回；被别的设备抢先改了就重来一次
  async function mutate(fn, message) {
    if (!cfg.token) { const e = new Error('这台设备只能查看，不能录入'); e.code = 'read_only'; throw e; }
    for (let attempt = 0; attempt < 3; attempt++) {
      const { sha, text } = await ghGet();
      const data = text ? await decrypt(text, cfg.pass) : empty();
      if (!Array.isArray(data.receipts)) data.receipts = [];
      fn(data);
      data.updatedAt = new Date().toISOString();
      try { await ghPut(await encrypt(data, cfg.pass), sha, message || '更新数据'); setCache(data); return data; }
      catch (e) { if (e.code !== 'conflict' || attempt === 2) throw e; }
    }
  }

  async function checkPass(pass) {
    // 有数据文件就用它验证密码；没有文件说明是第一次用
    let text = null;
    if (cfg.token) text = (await ghGet()).text;
    else {
      const r = await fetch(FILE + '?t=' + Date.now(), { cache: 'no-store' }).catch(() => null);
      if (!r) { const e = new Error('网络不通，第一次设置需要联网'); e.code = 'network'; throw e; }
      if (r.ok) text = await r.text(); else if (r.status !== 404) { const e = new Error('读取数据失败（' + r.status + '）'); e.code = 'upstream'; throw e; }
    }
    if (text) await decrypt(text, pass);
    return { exists: !!text };
  }
  async function checkToken(token) {
    const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } }).catch(() => null);
    if (!r) throw new Error('连不上 GitHub，请检查网络');
    if (r.status === 401) throw new Error('令牌无效，请检查是否复制完整');
    if (!r.ok) throw new Error('这个令牌访问不了 ' + OWNER + '/' + REPO + ' 仓库');
    const j = await r.json();
    if (!j.permissions?.push) throw new Error('这个令牌没有写入权限（Contents 需要选 Read and write）');
  }

  return {
    get pass() { return cfg.pass || ''; }, get canWrite() { return !!cfg.token; }, repo: OWNER + '/' + REPO,
    setPass(p) { cfg.pass = p; saveCfg(); }, setToken(t) { cfg.token = t || undefined; saveCfg(); },
    pull, mutate, cached, checkPass, checkToken,
  };
})();
