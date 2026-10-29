// 端末への保存（localStorage）。storage を外から渡すので、自動テストでは偽物に差し替えられる。

import { defaultData, normalizeData, STORAGE_LIMIT_BYTES } from './logic.js?v=20261029b';

const PROD_HOST = 'owdev-appty.github.io';
const PROD_PATH = '/eO20-1app-DevtR-07SUC--Shp/';

// 本番の公開URLで開いたときだけ v2- を使う。それ以外は自動でテスト用の v2test-
export function prefixFor(loc) {
  return loc.hostname === PROD_HOST && loc.pathname.startsWith(PROD_PATH) ? 'v2-' : 'v2test-';
}

export function createStore(storage, prefix) {
  const KEY = { data: prefix + 'data', meta: prefix + 'meta', ui: prefix + 'ui', broken: prefix + 'data-broken' };

  function readJson(key) {
    const raw = storage.getItem(key);
    if (raw == null) return { raw: null, value: null };
    try { return { raw, value: JSON.parse(raw) }; } catch { return { raw, value: undefined }; }
  }

  // 返り値の status: 'new'（初めて）／'ok'／'broken'（読めなかった。元の文字列は別の名前で残す）
  function load(nowIso) {
    let r;
    try { r = readJson(KEY.data); } catch { return { status: 'unavailable', data: defaultData(nowIso) }; }
    if (r.raw == null) return { status: 'new', data: defaultData(nowIso) };
    const res = r.value === undefined ? { ok: false } : normalizeData(r.value, nowIso);
    if (res.ok) return { status: 'ok', data: res.data };
    try { if (storage.getItem(KEY.broken) == null) storage.setItem(KEY.broken, r.raw); } catch { /* 容量不足なら残せない */ }
    return { status: 'broken', data: defaultData(nowIso) };
  }

  // 1回の setItem で全部を書くので、失敗しても前のデータはそのまま残る
  function save(data) {
    try {
      storage.setItem(KEY.data, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      const quota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
      return { ok: false, error: quota ? 'quota' : 'unavailable' };
    }
  }

  function loadMeta() {
    try { const r = readJson(KEY.meta); return r.value && typeof r.value === 'object' ? r.value : {}; } catch { return {}; }
  }
  function saveMeta(meta) {
    try { storage.setItem(KEY.meta, JSON.stringify(meta)); return true; } catch { return false; }
  }
  function loadUi() {
    try { const r = readJson(KEY.ui); return r.value && typeof r.value === 'object' ? r.value : {}; } catch { return {}; }
  }
  function saveUi(ui) {
    try { storage.setItem(KEY.ui, JSON.stringify(ui)); } catch { /* 画面の状態は残せなくてもよい */ }
  }

  // localStorage は1文字を2バイトとして目安を出す。同じアドレスのほかのアプリの分も数える
  function usage() {
    let all = 0, mine = 0;
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        const n = (k.length + (storage.getItem(k) || '').length) * 2;
        all += n;
        if (k.startsWith(prefix)) mine += n;
      }
    } catch { /* 読めない環境では0のまま */ }
    return { all, mine, remaining: Math.max(0, STORAGE_LIMIT_BYTES - all) };
  }

  return { prefix, KEY, load, save, loadMeta, saveMeta, loadUi, saveUi, usage };
}
