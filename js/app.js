// 画面の部品。計算は logic.js、保存は store.js に任せる。

import * as L from './logic.js?v=20261029c';
import { createStore, prefixFor } from './store.js?v=20261029c';

// ---------- 準備 ----------
function memoryStorage() {
  const m = new Map();
  return {
    get length() { return m.size; }, key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
  };
}
let storage;
let storageOk = true;
try { storage = window.localStorage; storage.getItem('__probe'); } catch { storage = memoryStorage(); storageOk = false; }

const PREFIX = prefixFor(location);
const IS_TEST = PREFIX !== 'v2-';
const store = createStore(storage, PREFIX);

// テスト版だけ、URLに ?now=2026-10-28T07:10 を付けると時刻を変えて確かめられる
let clockOffset = 0;
if (IS_TEST) {
  const q = new URLSearchParams(location.search).get('now');
  if (q && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(q)) {
    const [d, t] = q.split('T');
    const target = L.parseYmd(d);
    target.setHours(...t.split(':').map(Number));
    clockOffset = target.getTime() - Date.now();
  }
}
const nowDate = () => new Date(Date.now() + clockOffset);
const nowIso = () => nowDate().toISOString();
const today = () => L.logicalDay(nowDate());
const nowTime = () => L.hhmm(nowDate());

const loaded = store.load(nowIso());
let data = loaded.data;
let meta = store.loadMeta();
const savedUi = store.loadUi();
const ui = {
  tab: ['today', 'review', 'plan', 'settings'].includes(savedUi.tab) ? savedUi.tab : 'today',
  reviewWeek: null,
  trendKind: 'cantStop',
  heatKind: 'extra',
  calMonth: null,
  calSel: null,
  onbStep: 1,
  brokenNotice: loaded.status === 'broken',
};
let sheet = null;

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

// ---------- 小さな道具 ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const slotPlan = (slot) => data.settings.meals[slot];
const slotsByTime = () => L.enabledSlots(data.settings).sort((a, b) => L.dayMin(slotPlan(a).time) - L.dayMin(slotPlan(b).time));
const fmt1 = (v) => (Math.round(v * 10) / 10).toString();

// データを変えるときは必ずここを通す。保存に失敗したら画面のデータも元のまま
function commit(fn) {
  const next = structuredClone(data);
  fn(next);
  next.updatedAt = nowIso();
  const r = store.save(next);
  if (r.ok) { data = next; return true; }
  toast(r.error === 'quota'
    ? '容量が足りないため保存できませんでした。入力した内容はそのまま残っています。'
    : 'この端末に保存できませんでした。プライベートブラウズでないか確かめてください。');
  return false;
}
function upsertDay(d, date, patch) {
  let rec = d.days.find((x) => x.date === date);
  if (!rec) {
    rec = { id: L.uuid(), date, condition: null, conditionMemo: '', yesterdayTag: null, recovery: null, eveningAnswer: null, createdAt: nowIso(), updatedAt: nowIso() };
    d.days.push(rec);
  }
  Object.assign(rec, patch, { updatedAt: nowIso() });
}
function newMeal(fields) {
  return {
    id: L.uuid(), date: today(), time: nowTime(), slot: 'extra', source: null, content: '', cantStop: false, extraOrder: false,
    details: { situations: [], maaiika: null, hunger: null, fullness: null, feeling: null },
    createdAt: nowIso(), updatedAt: nowIso(), ...fields,
  };
}
function mealSub(m) {
  return [m.source ? L.SOURCES[m.source] : '', m.content, m.cantStop ? '止められない感じ' : '', m.extraOrder ? '追加注文' : ''].filter(Boolean).join(' ・ ');
}
function chipsHtml(group, options, selected, mode, cls = '') {
  const sel = Array.isArray(selected) ? selected : [selected];
  return '<div class="chips" data-group="' + group + '" data-mode="' + mode + '">' + options.map(([v, label]) =>
    '<button type="button" class="chip ' + cls + (sel.includes(v) ? ' on' : '') + '" data-value="' + esc(v) + '">' + esc(label) + '</button>').join('') + '</div>';
}
function groupValue(root, group) {
  const on = $$('[data-group="' + group + '"] .chip.on', root).map((c) => c.dataset.value);
  const mode = ($('[data-group="' + group + '"]', root) || {}).dataset?.mode;
  return mode === 'multi' ? on : (on[0] ?? null);
}
const pairs = (arr) => arr.map((x) => [x, x]);

// ---------- 全体の描画 ----------
function render() {
  $('#test-banner').classList.toggle('hidden', !IS_TEST);
  $('#app').classList.toggle('has-banner', IS_TEST);
  const onb = !data.settings.onboarded;
  $('#tabbar').classList.toggle('hidden', onb);
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const el = $('#scroll');
  if (onb) el.innerHTML = renderOnboarding();
  else if (ui.tab === 'today') el.innerHTML = renderToday();
  else if (ui.tab === 'review') el.innerHTML = renderReview();
  else if (ui.tab === 'plan') el.innerHTML = renderPlans();
  else el.innerHTML = renderSettings();
}
function showTab(tab) {
  ui.tab = tab;
  store.saveUi({ tab });
  render();
  $('#scroll').scrollTop = 0;
}

// ---------- 初めて開いたとき ----------
function slotRowsHtml() {
  return L.SLOTS.map((s) => {
    const p = slotPlan(s);
    return '<div class="lrow slot-row' + (p.on ? '' : ' off') + '">'
      + '<input type="checkbox" class="sw" data-setting="slot-on" data-slot="' + s + '"' + (p.on ? ' checked' : '') + ' aria-label="' + L.SLOT_LABEL[s] + 'を使う">'
      + '<span class="name">' + L.SLOT_LABEL[s] + '</span>'
      + '<input type="time" data-setting="slot-time" data-slot="' + s + '" value="' + p.time + '"' + (p.on ? '' : ' disabled') + '></div>';
  }).join('');
}
function renderOnboarding() {
  if (ui.onbStep === 1) {
    return '<div class="onb">'
      + '<h1>はじめに</h1>'
      + '<p>このアプリは、食べることを「止める」ためではなく、<b>崩れにくくして、崩れても戻りやすくする</b>ためのものです。</p>'
      + '<p>食事の予定を決めて記録し、週に1回ふりかえります。カロリーや量を入力する必要はありません。記録しない日があっても大丈夫です。</p>'
      + '<p>最初の14日間は、今の状態を知るための期間です。いつもどおり過ごして、記録してみてください。</p>'
      + '<button class="btn primary" data-action="onb-next">はじめる</button>'
      + '<p class="kind"><button class="link" data-action="restore">バックアップから復元する</button></p>'
      + '</div>';
  }
  return '<div class="onb">'
    + '<h1>食事の予定</h1>'
    + '<p>ふだん食べたい時刻を決めます。使わない食事はオフにできます。あとから「記録・設定」で変えられます。</p>'
    + '<div class="card list-card">' + slotRowsHtml() + '</div>'
    + '<p class="hint">予定の時刻の前後1時間以内に食べたら「予定どおり」と数えます。</p>'
    + '<div style="height:12px"></div>'
    + '<button class="btn primary" data-action="onb-done">この予定で始める</button>'
    + '<button class="btn" data-action="onb-back">戻る</button>'
    + '</div>';
}

// ---------- 今日 ----------
function nextOpenSlot(t) {
  const meals = data.meals.filter((m) => m.date === t);
  return slotsByTime().find((s) => !meals.some((m) => m.slot === s)) || null;
}
function storageWarning() {
  const u = store.usage();
  if (!storageOk) return '<div class="notice">この端末では記録を保存できない設定になっています（プライベートブラウズなど）。</div>';
  if (u.remaining < L.STORAGE_WARN_BYTES) return '<div class="notice">保存できる容量が残り少なくなっています（残り約' + L.formatMB(u.remaining) + '）。「記録・設定」で確かめられます。</div>';
  return '';
}
function renderToday() {
  const t = today(), nt = nowTime(), now = L.dayMin(nt), y = L.addDays(t, -1);
  const yCant = data.meals.some((m) => m.date === y && m.cantStop);
  const rec = L.dayRecord(data, t) || {};
  let h = '<h1 class="page-title">' + L.formatMd(t) + '</h1><p class="page-sub">今日</p>';
  h += storageWarning();
  if (ui.brokenNotice) {
    h += '<div class="notice">前回のデータを読み取れませんでした。元のデータは消さずに残しています。バックアップがあれば「記録・設定」から復元できます。'
      + ' <button class="link" data-action="dismiss-broken">閉じる</button></div>';
  }
  const bl = L.baselineInfo(data, t);
  if (bl.started && !bl.done) {
    h += '<p class="hint" style="margin:-8px 4px 12px;">最初の14日間は、今の状態を知るための期間です（あと' + bl.remaining + '日）。</p>';
  }

  // 過食の翌日：予定どおりの食事に戻る
  if (yCant) {
    const next = nextOpenSlot(t);
    const note = data.settings.selfNote.trim();
    const noteHtml = note ? '<div class="self-note"><small>自分への一言</small>' + esc(note) + '</div>' : '';
    if (rec.recovery === 'ate' && now < 12 * 60) {
      h += '<div class="card return-card"><div class="eyebrow">記録しました</div><h3>制限しないで食べました</h3>'
        + '<p class="reassure" style="margin:0;">' + (next ? '次は' + L.shortTime(slotPlan(next).time) + 'の' + L.SLOT_LABEL[next] + 'です。' : '') + 'いつもどおりで大丈夫です。</p></div>';
    } else if (rec.recovery !== 'ate' && next) {
      const p = slotPlan(next);
      if (rec.recovery === 'later') {
        h += '<div class="card return-card"><div class="eyebrow">あとで記録できます</div>'
          + '<p class="next" style="margin:0 0 10px;">' + L.SLOT_LABEL[next] + 'は <b>' + L.shortTime(p.time) + '</b> の予定です。</p>' + noteHtml
          + '<button class="btn primary" data-action="return-ate" data-slot="' + next + '">食べた</button></div>';
      } else {
        h += '<div class="card return-card"><div class="eyebrow">今日のこと</div><h3>今日は、予定どおりの食事に戻る日</h3>'
          + '<p class="next">次の食事は <b>' + L.shortTime(p.time) + '</b>（' + L.SLOT_LABEL[next] + '）</p>'
          + '<p class="reassure">昨日の分を減らして調整する必要はありません。</p>' + noteHtml
          + '<div class="btn-row"><button class="btn" data-action="return-later">あとで</button>'
          + '<button class="btn primary" data-action="return-ate" data-slot="' + next + '">食べた</button></div></div>';
      }
    }
    // 翌日の夜の1問
    const lastSlot = slotsByTime().slice(-1)[0];
    if (lastSlot && now >= L.dayMin(slotPlan(lastSlot).time) && rec.eveningAnswer == null) {
      h += '<div class="card"><div class="card-head"><h3>今日は、減らさずに食べられた？</h3><small>任意</small></div>'
        + '<p class="hint" style="margin:0 0 10px;">ふりかえりの数字に使います。答えなくても大丈夫です。</p>'
        + '<div class="btn-row"><button class="btn small" data-action="evening" data-value="normal">いつもどおり食べた</button>'
        + '<button class="btn small" data-action="evening" data-value="reduced">少し減らした・抜いた</button></div>'
        + '<button class="btn small" data-action="evening" data-value="skip" style="border-color:transparent;background:none;color:var(--muted);">答えない</button></div>';
    }
  }

  // 今朝の1分（過食の翌朝）／今朝の体調（ふだん）
  if (yCant && !rec.morningDone) {
    h += '<div class="card" id="morning-card"><div class="card-head"><h3>今朝の1分</h3><small>任意 ・ スキップできます</small></div>'
      + '<div class="field-label" style="margin-top:8px;">今朝の体調</div>' + chipsHtml('m-cond', pairs(L.CONDITIONS), rec.condition, 'toggle', 'sm')
      + '<div class="field-label" style="margin-top:12px;">昨日の夜、近かったもの</div>' + chipsHtml('m-tag', pairs(L.YDAY_TAGS), rec.yesterdayTag, 'toggle', 'sm')
      + '<input type="text" id="m-memo" placeholder="体調メモ（任意）" value="' + esc(rec.conditionMemo || '') + '" style="margin-top:12px;">'
      + '<div class="btn-row" style="margin-top:12px;"><button class="btn" data-action="morning-skip">スキップ</button><button class="btn primary" data-action="morning-save">残す</button></div></div>';
  }

  // 食事予定
  const meals = L.mealsOn(data, t);
  const tol = data.settings.onTimeToleranceMin;
  h += '<div class="card"><div class="card-head"><h3>今日の食事予定</h3><small>タップで記録・編集</small></div><div class="meal-list">';
  for (const s of slotsByTime()) {
    const p = slotPlan(s);
    const m = meals.find((x) => x.slot === s);
    let right;
    if (m) right = L.isOnTime(m, data.settings) ? '<span class="pill good">✓ 予定どおり</span>' : '<span class="pill plain">✓ 記録済み</span>';
    else if (now >= L.dayMin(p.time) - tol) right = '<button class="rec-btn" data-action="quick" data-slot="' + s + '">記録する</button>';
    else right = '<span class="later">まだ</span>';
    const sub = m ? mealSub(m) : '';
    h += '<div class="meal' + (m ? ' tap" data-action="edit-meal" data-id="' + m.id : '') + '"><span class="meal-time">' + L.shortTime(m ? m.time : p.time) + '</span>'
      + '<span class="meal-name">' + L.SLOT_LABEL[s] + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' + right + '</div>';
  }
  const others = meals.filter((m) => m.slot === 'extra' || !slotPlan(m.slot)?.on || meals.filter((x) => x.slot === m.slot)[0] !== m);
  for (const m of others) {
    const sub = mealSub(m);
    h += '<div class="meal tap" data-action="edit-meal" data-id="' + m.id + '"><span class="meal-time">' + L.shortTime(m.time) + '</span>'
      + '<span class="meal-name">' + L.SLOT_LABEL[m.slot] + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><span class="later">›</span></div>';
  }
  h += '</div></div>';

  // 今のプラン
  for (const p of L.visiblePlans(data, t, nt)) {
    h += '<div class="card plan-card"><div class="plan-when">今のプラン ・ ' + L.shortTime(p.time) + 'ごろ</div>'
      + '<div class="ifthen"><p><span class="k">もし</span>' + esc(p.ifText) + '</p><p><span class="k">そのとき</span>' + esc(p.thenText) + '</p></div>'
      + '<p class="hint">' + L.planWindowText(p) + 'に表示 ・ 「プラン」で編集できます</p></div>';
  }

  // ふだんの朝の体調
  if (!(yCant && !rec.morningDone)) {
    h += '<div class="card"><div class="card-head"><h3>今朝の体調</h3><small>任意</small></div>'
      + chipsHtml('cond', pairs(L.CONDITIONS), rec.condition, 'toggle', 'sm')
      + '<details class="more" style="margin:10px 0 0;"' + (rec.conditionMemo ? ' open' : '') + '><summary>体調メモ</summary><div class="more-body">'
      + '<input type="text" data-setting="cond-memo" value="' + esc(rec.conditionMemo || '') + '" placeholder="例：少し頭が重い"></div></details></div>';
  }

  if (data.settings.weightEnabled) {
    const w = data.weights.find((x) => x.date === t);
    h += '<div class="card"><div class="card-head"><h3>体重</h3><small>任意</small></div><div class="inline">'
      + '<input type="number" id="w-input" inputmode="decimal" step="0.1" min="20" max="300" value="' + (w ? w.kg : '') + '" placeholder="kg" style="width:120px;">'
      + '<button class="btn small" data-action="save-weight" style="width:auto;">保存</button></div></div>';
  }

  h += '<button class="btn" data-action="new-meal" data-slot="extra" style="margin-top:4px;">＋ 予定外の食事・飲み物を記録</button>'
    + '<p class="okay-note">記録しない日があっても大丈夫です。</p>'
    + '<p class="center" style="margin-top:14px;"><button class="link" data-action="new-meal" data-date="' + y + '">昨日の分を記録する</button></p>';
  return h;
}

// ---------- 記録シート ----------
function rangeField(key, label, value) {
  const set = value != null;
  return '<div class="field"><div class="range-head"><span>' + label + '</span><b data-out="' + key + '">' + (set ? value : '—') + '</b></div>'
    + '<input type="range" min="0" max="10" step="1" value="' + (set ? value : 5) + '" data-range="' + key + '" data-set="' + (set ? 1 : 0) + '">'
    + '<div class="range-ends"><span>0 まったく</span><span>10 とても</span></div></div>';
}
function openMealSheet(meal, isNew) {
  sheet = { kind: 'meal', id: isNew ? null : meal.id };
  const t = today();
  const d = meal.details;
  const slotOpts = L.SLOTS.filter((s) => slotPlan(s).on || meal.slot === s).map((s) => [s, L.SLOT_LABEL[s]]).concat([['extra', '予定外']]);
  const detailsOpen = d.situations.length || d.maaiika || d.hunger != null || d.fullness != null || d.feeling;
  let h = '<div class="sheet-head"><h2>' + (isNew ? '食事・飲み物を記録' : '記録を編集') + '</h2><button class="link" data-action="close-sheet">閉じる</button></div>'
    + '<div class="field"><div class="field-label">いつ</div><div class="inline">'
    + chipsHtml('dayq', [[t, '今日'], [L.addDays(t, -1), '昨日']], meal.date, 'single')
    + '<input type="date" id="f-date" value="' + meal.date + '" max="' + t + '"><input type="time" id="f-time" value="' + meal.time + '"></div>'
    + '<p class="hint">夜中0〜5時の食事は、前の日の夜の分として記録します。</p></div>'
    + '<div class="field"><div class="field-label">どの食事？ <span class="req">必須</span></div>' + chipsHtml('slot', slotOpts, isNew && meal.slot === 'extra' && meal._noSlot ? null : meal.slot, 'single') + '<p class="err hidden" id="f-slot-err">1つ選んでください</p></div>'
    + '<div class="field"><div class="field-label">入手方法 <span class="opt">任意</span></div>' + chipsHtml('source', Object.entries(L.SOURCES), meal.source, 'toggle') + '</div>'
    + '<div class="field"><div class="field-label">内容 <span class="opt">任意</span></div><input type="text" id="f-content" maxlength="200" value="' + esc(meal.content) + '" placeholder="例：おにぎり、お茶（書かなくてもOK）"></div>'
    + '<div class="card" style="padding:0 16px;">'
    + '<label class="switch-row"><span>止められない感じがあった</span><input type="checkbox" class="sw" id="f-cant"' + (meal.cantStop ? ' checked' : '') + '></label>'
    + '<label class="switch-row"><span>追加で注文・買い足した</span><input type="checkbox" class="sw" id="f-extra"' + (meal.extraOrder ? ' checked' : '') + '></label></div>'
    + '<details class="more"' + (detailsOpen ? ' open' : '') + '><summary>くわしく（任意）</summary><div class="more-body">'
    + '<div class="field"><div class="field-label">状況 <span class="opt">いくつでも</span></div>' + chipsHtml('sit', pairs(L.SITUATIONS), d.situations, 'multi') + '</div>'
    + '<div class="field"><div class="field-label">「まぁいっか」の種類</div>' + chipsHtml('maa', pairs(L.MAAIIKA), d.maaiika, 'toggle') + '</div>'
    + rangeField('hunger', '空腹感（食べる前）', d.hunger) + rangeField('fullness', '満腹感（食べ終わり）', d.fullness)
    + '<div class="field" style="margin-bottom:6px;"><div class="field-label">食後の気持ち</div>' + chipsHtml('feel', pairs(L.FEELINGS), d.feeling, 'toggle') + '</div>'
    + '</div></details>'
    + '<button class="btn primary" data-action="save-meal">保存</button>'
    + (isNew ? '' : '<button class="btn del-btn" data-action="delete-meal" data-label="この記録を削除">この記録を削除</button>')
    + '<p class="kind">どんな内容でも、書けたこと自体がふりかえりの材料になります。</p>';
  openSheet(h);
}
function saveMealFromSheet() {
  const root = $('#sheet-body');
  const slot = groupValue(root, 'slot');
  if (!slot) { $('#f-slot-err').classList.remove('hidden'); return; }
  const date = $('#f-date').value, time = $('#f-time').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) { toast('日付と時刻を確かめてください'); return; }
  if (date > today()) { toast('未来の日付には記録できません'); return; }
  const range = (k) => { const r = $('[data-range="' + k + '"]', root); return r.dataset.set === '1' ? Number(r.value) : null; };
  const fields = {
    date, time, slot, source: groupValue(root, 'source'), content: $('#f-content').value.trim(),
    cantStop: $('#f-cant').checked, extraOrder: $('#f-extra').checked,
    details: { situations: groupValue(root, 'sit'), maaiika: groupValue(root, 'maa'), hunger: range('hunger'), fullness: range('fullness'), feeling: groupValue(root, 'feel') },
  };
  const id = sheet.id;
  const ok = commit((d) => {
    if (id) {
      const m = d.meals.find((x) => x.id === id);
      if (m) Object.assign(m, fields, { updatedAt: nowIso() });
    } else {
      d.meals.push(newMeal(fields));
    }
  });
  if (!ok) return;
  closeSheet();
  render();
  toast(id ? '記録を更新しました' : '記録しました');
}

// ---------- ふりかえり ----------
const STAT_DEFS = [
  { key: 'cantStop', label: '止められない感じの食事', unit: '回', higherBetter: false },
  { key: 'chains', label: '連続注文', unit: '回', higherBetter: false },
  { key: 'onTimeDays', label: '予定どおり食べた日', unit: '日', higherBetter: true },
  { key: 'restricted', label: '過食の翌日に制限した日', unit: '日', higherBetter: false },
];
function firstDataDate() {
  const ds = data.meals.map((m) => m.date).concat(data.settings.baselineStart ? [data.settings.baselineStart] : []).sort();
  return ds[0] || today();
}
function renderReview() {
  const t = today();
  const cur = L.weekStartOf(t);
  const ws = ui.reviewWeek || cur;
  const we = L.addDays(ws, 6);
  const minWeek = L.weekStartOf(firstDataDate());
  const st = L.weekStats(data, ws, t);
  const bl = L.baselineInfo(data, t);
  let h = '<div class="week-nav"><button data-action="week" data-step="-1" aria-label="前の週"' + (ws <= minWeek ? ' disabled' : '') + '>‹</button>'
    + '<h2>' + L.formatShortMd(ws) + '〜' + L.formatShortMd(we) + (st.partial ? '<small>今週（途中）</small>' : '') + '</h2>'
    + '<button data-action="week" data-step="1" aria-label="次の週"' + (ws >= cur ? ' disabled' : '') + '>›</button></div>';
  if (!bl.done) {
    h += '<p class="baseline-note">最初の14日間（現状を測る期間）です。' + (bl.started ? 'あと' + bl.remaining + '日で、その平均と比べられるようになります。' : '') + '</p>';
  } else {
    h += '<p class="baseline-note">比べる基準：最初の14日間（' + L.formatShortMd(bl.start) + '〜' + L.formatShortMd(bl.end) + '）の平均</p>';
  }
  if (!data.meals.length) {
    h += '<div class="card"><p class="muted" style="margin:0;font-size:14px;">記録がたまると、ここに週ごとの数字が出ます。</p></div>';
    return h;
  }
  const prev = ws > minWeek ? L.weekStats(data, L.addDays(ws, -7), t) : null;
  const chainWin = data.settings.chainWindowMin / 60;
  h += '<div class="stats">';
  for (const def of STAT_DEFS) {
    const v = st[def.key];
    let cmp = '', cls = '';
    if (st.partial) {
      cmp = '今週はまだ途中です';
    } else if (bl.done && ws > bl.end) {
      const avg = bl.avg[def.key], diff = v - avg;
      if (Math.abs(diff) < 0.05) cmp = '平均' + fmt1(avg) + def.unit + 'と同じ';
      else {
        const better = def.higherBetter ? diff > 0 : diff < 0;
        const word = diff > 0 ? '多い' : '少ない';
        cmp = better ? '平均' + fmt1(avg) + def.unit + ' → ' + fmt1(Math.abs(diff)) + def.unit + word : '平均' + fmt1(avg) + def.unit + 'より' + fmt1(Math.abs(diff)) + def.unit + word;
        if (better) cls = ' good';
      }
    } else if (prev) {
      cmp = '先週 ' + prev[def.key] + def.unit;
    }
    const sub = def.key === 'chains' ? '<br><span class="muted" style="font-size:11px;">（' + fmt1(chainWin) + '時間以内の追加）</span>' : '';
    h += '<div class="stat"><div class="lbl">' + def.label + sub + '</div><div class="num">' + v + '<small>' + def.unit + '</small></div><div class="cmp' + cls + '">' + cmp + '</div></div>';
  }
  h += '</div>';

  const interval = L.averageInterval([...L.cantStopDates(data)].filter((d) => d <= we));
  if (interval != null) {
    let small = '';
    if (bl.done && bl.interval != null) {
      small = interval > bl.interval + 0.05 ? '<small class="good">最初の14日間は' + fmt1(bl.interval) + '日</small>' : '<small>最初の14日間は' + fmt1(bl.interval) + '日</small>';
    }
    h += '<div class="card interval" style="margin-top:12px;"><div class="lbl">止められない感じの食事の間隔（平均）<small>週に1回、ここでだけ表示します</small></div>'
      + '<div class="val"><b>' + fmt1(interval) + '日</b>' + small + '</div></div>';
  }

  // 4週間の推移
  const def = STAT_DEFS.find((d) => d.key === ui.trendKind);
  const weeks = [-21, -14, -7, 0].map((o) => L.addDays(ws, o));
  const vals = weeks.map((w) => (L.addDays(w, 6) < firstDataDate() ? null : L.weekStats(data, w, t)));
  const nums = vals.map((v) => (v ? v[def.key] : 0));
  const avgLine = bl.done ? bl.avg[def.key] : null;
  const max = Math.max(1, ...nums, avgLine || 0) + 1;
  h += '<div class="section-title"><span>4週間の推移</span></div><div class="card">'
    + chipsHtml('trend', STAT_DEFS.map((d) => [d.key, d.key === 'cantStop' ? '止められない感じ' : d.key === 'chains' ? '連続注文' : d.key === 'onTimeDays' ? '予定どおりの日' : '翌日の制限']), ui.trendKind, 'single', 'sm')
    + '<div class="bars">' + weeks.map((w, i) => {
      if (!vals[i]) return '<div class="bar-col"><span class="bar-v muted">—</span><div class="bar base" style="height:0"></div></div>';
      const inBase = bl.started && w <= (bl.end || L.addDays(bl.start, 13)) && L.addDays(w, 6) >= bl.start;
      const cls = 'bar' + (inBase ? ' base' : '') + (vals[i].partial ? ' part' : '');
      return '<div class="bar-col"><span class="bar-v">' + nums[i] + def.unit + '</span><div class="' + cls + '" style="height:' + (nums[i] / max * 82) + '%"></div></div>';
    }).join('') + (avgLine != null ? '<div class="baseline" style="bottom:' + (avgLine / max * 82) + '%"></div>' : '') + '</div>'
    + '<div class="bar-labels">' + weeks.map((w) => '<span>' + L.formatShortMd(w) + '〜</span>').join('') + '</div>'
    + '<p class="hint">灰色＝最初の14日間' + (avgLine != null ? ' ・ 点線＝その平均（' + fmt1(avgLine) + def.unit + '）' : '') + ' ・ 薄い棒＝今週（途中）</p></div>';

  // 曜日×時間帯
  const grid = L.heatmap(data, ws, ui.heatKind);
  h += '<div class="section-title"><span>曜日と時間帯</span></div><div class="card">'
    + chipsHtml('heat', [['extra', '予定外の食事'], ['ctrl', '止められない感じ']], ui.heatKind, 'single', 'sm')
    + '<table class="heat" style="margin-top:10px;"><tr><th></th>' + L.BANDS.map((b) => '<th>' + b.label + '</th>').join('') + '</tr>'
    + grid.map((row, i) => '<tr><td class="day">' + L.DOW[i] + '</td>' + row.map((v) => '<td class="' + (v === 0 ? '' : v === 1 ? 'l1' : v === 2 ? 'l2' : 'l3') + '">' + (v || '') + '</td>').join('') + '</tr>').join('')
    + '</table><p class="hint">朝 5〜11時 ／ 昼 11〜16時 ／ 夕方 16〜21時 ／ 深夜 21〜翌5時</p></div>';

  const sug = riskSuggestion();
  if (sug) {
    h += '<div class="card suggest-card"><div class="eyebrow">記録から見た、起きやすい時間帯</div>'
      + '<p>この4週間では、<b>' + sug.days.map((i) => L.DOW[i]).join('・') + 'の' + L.shortTime(sug.time) + 'ごろ</b>に止められない感じが起きやすいようです（' + sug.total + '回中' + sug.count + '回）。この時間に合わせたプランは、まだありません。</p>'
      + '<button class="btn" data-action="new-plan-sug">この時間帯のプランを作る</button></div>';
  }
  return h;
}
function riskSuggestion() {
  const sug = L.suggestRiskTime(data, today());
  if (!sug) return null;
  const covered = data.plans.some((p) => p.active && p.days.some((d) => sug.days.includes(d)) && Math.abs(L.dayMin(p.time) - L.dayMin(sug.time)) <= 60);
  return covered ? null : sug;
}

// ---------- プラン ----------
function renderPlans() {
  let h = '<h1 class="page-title">プラン</h1><p class="page-sub">意志ではなく「条件」を変えてみる場所です</p>'
    + '<div class="how-box"><b>しくみ：</b>プランごとに「起きやすい時刻」「曜日」「表示する時間」を決めます。その時間のあいだだけ、「今日」画面にプランが表示されます。Pausedにしたプランは表示されません。タップすると編集・削除できます。</div>';
  if (!data.plans.length) {
    h += '<div class="card"><p class="muted" style="margin:0;font-size:14px;">プランはまだありません。</p></div>';
  } else {
    h += '<div class="card">' + data.plans.map((p) => '<div class="plan-item' + (p.active ? '' : ' off') + '" data-action="edit-plan" data-id="' + p.id + '">'
      + '<div class="ifthen"><p><span class="k">もし</span>' + esc(p.ifText) + '</p><p><span class="k">そのとき</span>' + esc(p.thenText) + '</p></div>'
      + '<div class="meta"><span>' + L.daysLabel(p.days) + ' ' + L.shortTime(p.time) + '（' + (p.active ? L.planWindowText(p) + 'に表示' : '表示しない') + '）</span>'
      + (p.active ? '<span class="pill accent">Active</span>' : '<span class="pill plain">Paused</span>') + '</div></div>').join('') + '</div>';
  }
  h += '<button class="btn ghost" data-action="new-plan">＋ プランを作る</button>';
  return h;
}
const BEFORE_OPTS = [[30, '30分前から'], [60, '1時間前から'], [90, '1時間半前から'], [120, '2時間前から'], [180, '3時間前から']];
const AFTER_OPTS = [[0, 'その時刻まで'], [30, '30分後まで'], [60, '1時間後まで'], [120, '2時間後まで'], [180, '3時間後まで']];
function openPlanSheet(plan, isNew) {
  sheet = { kind: 'plan', id: isNew ? null : plan.id, sceneMode: 'pick', scene: null, autoIf: '' };
  const sug = riskSuggestion();
  const opt = (list, v) => list.map(([val, label]) => '<option value="' + val + '"' + (val === v ? ' selected' : '') + '>' + label + '</option>').join('');
  const h = '<div class="sheet-head"><h2>' + (isNew ? 'プランを作る' : 'プランを編集') + '</h2><button class="link" data-action="close-sheet">閉じる</button></div>'
    + '<div class="field"><div class="field-label split">どんな場面で起きやすい？<button class="link" data-action="scene-edit" id="scene-edit-btn" style="font-size:13px;">編集</button></div><div id="scene-area"></div></div>'
    + '<div class="field"><div class="field-label">もし（起きやすい場面）</div><textarea id="p-if" rows="2" maxlength="200" placeholder="例：平日の夕方、仕事の区切りでデリバリーアプリを開きたくなったら">' + esc(plan.ifText) + '</textarea></div>'
    + '<div class="field"><div class="field-label">そのとき（代わりにすること）</div><textarea id="p-then" rows="2" maxlength="200" placeholder="例：先に作り置きを温める。それでも食べたければ、そのあと注文してもいい">' + esc(plan.thenText) + '</textarea>'
    + '<p class="hint">「〜しない」より「先に〜する」の形のほうが続けやすいです。</p></div>'
    + '<div class="field"><div class="field-label">起きやすい時刻</div><div class="inline"><input type="time" id="p-time" value="' + plan.time + '">'
    + (sug ? '<button type="button" class="chip sm dashed" data-action="plan-sug" data-time="' + sug.time + '" data-days="' + sug.days.join(',') + '">記録からの候補：' + sug.days.map((i) => L.DOW[i]).join('・') + ' ' + L.shortTime(sug.time) + '</button>' : '')
    + '</div></div>'
    + '<div class="field"><div class="field-label">「今日」に表示する時間</div><div class="inline">'
    + '<select id="p-before" style="width:auto;">' + opt(BEFORE_OPTS, plan.beforeMin) + '</select><select id="p-after" style="width:auto;">' + opt(AFTER_OPTS, plan.afterMin) + '</select></div>'
    + '<p class="hint" id="p-window"></p></div>'
    + '<div class="field"><div class="field-label">曜日</div>' + chipsHtml('pdays', L.DOW.map((d, i) => [String(i), d]), plan.days.map(String), 'multi', 'sm') + '</div>'
    + '<div class="card" style="padding:0 16px;"><label class="switch-row"><span class="lab">「今日」に表示する<small>オフにするとPausedになります</small></span><input type="checkbox" class="sw" id="p-active"' + (plan.active ? ' checked' : '') + '></label></div>'
    + '<p class="err hidden" id="p-err"></p>'
    + '<button class="btn primary" data-action="save-plan">保存</button>'
    + (isNew ? '' : '<button class="btn del-btn" data-action="delete-plan" data-label="このプランを削除">このプランを削除</button>')
    + '<p class="kind">使わなくなったプランは、削除しなくてもPausedにしておけます。</p>';
  openSheet(h);
  renderScenes();
  updatePlanWindow();
}
function renderScenes() {
  const area = $('#scene-area');
  if (!area || !sheet) return;
  const scenes = data.settings.scenes;
  const btn = $('#scene-edit-btn');
  if (sheet.sceneMode === 'edit') {
    btn.textContent = '完了';
    area.innerHTML = scenes.map((s, i) => '<div class="scene-row"><input type="text" maxlength="60" data-scene-input="' + i + '" value="' + esc(s) + '">'
      + '<button class="btn small del-btn" data-action="scene-del" data-idx="' + i + '" data-label="削除">削除</button></div>').join('')
      + (scenes.length ? '' : '<p class="hint" style="margin:0;">場面はまだありません。</p>') + '<p class="hint">書き換えると、そのまま保存されます。</p>';
    return;
  }
  btn.textContent = '編集';
  const chips = scenes.map((s, i) => '<button type="button" class="chip' + (sheet.scene === i ? ' on' : '') + '" data-action="scene-pick" data-idx="' + i + '">' + esc(s) + '</button>').join('');
  if (sheet.sceneMode === 'add') {
    area.innerHTML = '<div class="chips" style="margin-bottom:8px;">' + chips + '</div><div class="scene-row"><input type="text" id="scene-new" maxlength="60" placeholder="例：寝る前、スマホを見ているとき">'
      + '<button class="btn small primary" data-action="scene-add-save">追加</button></div>';
    setTimeout(() => { const n = $('#scene-new'); if (n) n.focus(); }, 0);
  } else {
    area.innerHTML = '<div class="chips">' + chips + '<button type="button" class="chip dashed" data-action="scene-add">＋ 場面を追加</button></div>'
      + '<p class="hint">選ぶと「もし」の欄に入ります。</p>';
  }
}
function updatePlanWindow() {
  const t = $('#p-time'), el = $('#p-window');
  if (!t || !el || !t.value) return;
  el.textContent = L.planWindowText({ time: t.value, beforeMin: Number($('#p-before').value), afterMin: Number($('#p-after').value) }) + 'のあいだ、「今日」に表示されます。';
}
function savePlanFromSheet() {
  const root = $('#sheet-body');
  const fields = {
    ifText: $('#p-if').value.trim(), thenText: $('#p-then').value.trim(), time: $('#p-time').value,
    beforeMin: Number($('#p-before').value), afterMin: Number($('#p-after').value),
    days: groupValue(root, 'pdays').map(Number).sort((a, b) => a - b), active: $('#p-active').checked,
  };
  const err = $('#p-err');
  const msg = !fields.ifText ? '「もし」を書いてください' : !fields.thenText ? '「そのとき」を書いてください' : !/^\d{2}:\d{2}$/.test(fields.time) ? '時刻を選んでください' : !fields.days.length ? '曜日を1つ以上選んでください' : '';
  if (msg) { err.textContent = msg; err.classList.remove('hidden'); return; }
  const id = sheet.id;
  const ok = commit((d) => {
    if (id) { const p = d.plans.find((x) => x.id === id); if (p) Object.assign(p, fields, { updatedAt: nowIso() }); }
    else d.plans.push({ id: L.uuid(), ...fields, createdAt: nowIso(), updatedAt: nowIso() });
  });
  if (!ok) return;
  closeSheet();
  render();
  toast(id ? 'プランを更新しました' : 'プランを保存しました');
}
function blankPlan(extra = {}) {
  return { ifText: '', thenText: '', time: '16:30', beforeMin: 60, afterMin: 60, days: [0, 1, 2, 3, 4], active: true, ...extra };
}

// ---------- 記録・設定 ----------
function renderCalendar() {
  const t = today();
  const month = ui.calMonth || t.slice(0, 7);
  const sel = ui.calSel || t;
  const first = month + '-01';
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const cs = L.cantStopDates(data);
  const has = new Set(data.meals.map((m) => m.date).concat(data.days.map((d) => d.date)));
  let g = L.DOW.map((d) => '<div class="dow">' + d + '</div>').join('');
  for (let i = 0; i < L.dowIndex(first); i++) g += '<div></div>';
  for (let n = 1; n <= lastDay; n++) {
    const ds = month + '-' + String(n).padStart(2, '0');
    const cls = ['d'];
    if (ds > t) cls.push('future');
    if (has.has(ds)) cls.push('has');
    if (cs.has(ds)) cls.push('m');
    if (ds === t) cls.push('today');
    if (ds === sel) cls.push('sel');
    g += '<button class="' + cls.join(' ') + '" data-action="cal-day" data-date="' + ds + '"' + (ds > t ? ' disabled' : '') + '>' + n + '<span class="r"></span></button>';
  }
  const [yy, mm] = month.split('-').map(Number);
  let h = '<div class="card"><div class="cal-head"><button data-action="cal-month" data-step="-1" aria-label="前の月">‹</button><b>' + yy + '年' + mm + '月</b>'
    + '<button data-action="cal-month" data-step="1" aria-label="次の月"' + (month >= t.slice(0, 7) ? ' disabled style="opacity:.25"' : '') + '>›</button></div>'
    + '<div class="cal">' + g + '</div>'
    + '<div class="cal-legend"><span><i style="background:var(--mark-bg);border:1px solid var(--mark)"></i>止められない感じがあった日</span><span><i style="border:1.5px solid var(--accent)"></i>今日</span></div>';
  const meals = L.mealsOn(data, sel);
  const rec = L.dayRecord(data, sel);
  h += '<div class="day-detail"><div class="dd-head"><b>' + L.formatMd(sel) + '</b>' + (meals.length ? '<small>タップで編集・削除</small>' : '') + '</div>';
  if (!meals.length && !rec) h += '<p class="muted" style="margin:6px 0 0;">この日は記録がありません。記録しない日があっても大丈夫です。</p>';
  h += meals.map((m) => { const sub = mealSub(m); return '<div class="de" data-action="edit-meal" data-id="' + m.id + '"><span class="t">' + L.shortTime(m.time) + '</span><span class="x">' + L.SLOT_LABEL[m.slot] + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></div>'; }).join('');
  if (rec) {
    const notes = [rec.condition ? '朝の体調：' + rec.condition : '', rec.conditionMemo ? '体調メモ：' + rec.conditionMemo : '', rec.yesterdayTag ? '前の夜に近かったもの：' + rec.yesterdayTag : '',
      rec.recovery === 'ate' ? '翌朝の立て直し：制限しないで食べた' : '', rec.eveningAnswer === 'normal' ? '夜の1問：いつもどおり食べた' : rec.eveningAnswer === 'reduced' ? '夜の1問：少し減らした・抜いた' : ''].filter(Boolean);
    h += notes.map((n) => '<div class="dd-note">' + esc(n) + '</div>').join('');
  }
  h += '<button class="btn small" data-action="new-meal" data-date="' + sel + '" style="margin-top:10px;">＋ この日の分を記録する</button></div></div>';
  return h;
}
function formatDateTime(iso) {
  const d = new Date(iso);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + L.hhmm(d);
}
function renderSettings() {
  const s = data.settings;
  const u = store.usage();
  let h = '<h1 class="page-title">記録・設定</h1><p class="page-sub">日付をタップすると、その日の記録が見られます</p>' + renderCalendar();
  h += '<div class="section-title"><span>食事予定の時刻</span></div><div class="card list-card">' + slotRowsHtml()
    + '<div class="lrow"><span class="lab">「予定どおり」とみなす幅<small>予定の時刻からのずれ</small></span><select data-setting="tolerance">'
    + [[30, '前後30分'], [60, '前後1時間'], [120, '前後2時間']].map(([v, l]) => '<option value="' + v + '"' + (s.onTimeToleranceMin === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>'
    + '<div class="lrow"><span class="lab">連続注文とみなす時間<small>最初の注文・購入からの時間</small></span><select data-setting="chain">'
    + [[120, '2時間以内'], [180, '3時間以内'], [240, '4時間以内']].map(([v, l]) => '<option value="' + v + '"' + (s.chainWindowMin === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div></div>';
  h += '<div class="section-title"><span>過食の翌朝に表示する、自分への一言</span></div><div class="card">'
    + '<textarea data-setting="self-note" rows="2" maxlength="200" placeholder="例：完璧じゃなくていい。次の一食を、いつもどおりに。">' + esc(s.selfNote) + '</textarea>'
    + '<p class="hint">落ち着いている日に書いておくのがおすすめです。翌朝の「戻る日」カードに表示されます。</p></div>';
  h += '<div class="section-title"><span>バックアップ</span></div><div class="card">'
    + '<div class="lrow" style="padding-top:0;border:none;"><span>最後のバックアップ</span><span class="v">' + (meta.lastBackupAt ? formatDateTime(meta.lastBackupAt) : 'まだありません') + '</span></div>'
    + '<button class="btn primary" data-action="backup">バックアップを保存</button><button class="btn" data-action="restore">バックアップから復元</button>'
    + '<p class="hint">iPhoneの共有メニューが開きます。「"ファイル"に保存」でiCloud Driveに保存するのがおすすめです。データはこの端末の中だけに保存されています。</p></div>';
  h += '<div class="section-title"><span>保存容量</span></div><div class="card">'
    + '<div class="lrow" style="padding-top:0;border:none;"><span>このアプリのデータ</span><span class="v">約' + L.formatMB(u.mine) + '</span></div>'
    + '<div class="lrow" style="padding:8px 0 0;"><span class="lab">残りの目安<small>同じアドレスのほかのアプリと共有</small></span><span class="v">約' + L.formatMB(u.remaining) + '</span></div>'
    + (u.remaining < L.STORAGE_WARN_BYTES ? '<div class="notice" style="margin:10px 0 0;">残りが少なくなっています。</div>' : '') + '</div>';
  h += '<div class="section-title"><span>任意の機能</span></div><div class="card list-card">'
    + '<label class="switch-row"><span class="lab">体重の記録<small>オンにすると「今日」に入力欄が出ます</small></span><input type="checkbox" class="sw" data-setting="weight"' + (s.weightEnabled ? ' checked' : '') + '></label></div>';
  h += '<div class="section-title"><span>そのほか</span></div><div class="card list-card">'
    + '<div class="lrow go" data-action="safety"><span>安全のための情報</span></div>'
    + '<div class="lrow"><span>このアプリについて</span><span class="v">v' + L.APP_VERSION + (IS_TEST ? '（テスト版）' : '') + '</span></div></div>';
  return h;
}

// ---------- バックアップ・復元 ----------
function markBackup() {
  meta = { ...meta, lastBackupAt: nowIso() };
  store.saveMeta(meta);
}
async function doBackup() {
  const now = nowDate();
  const text = JSON.stringify(L.buildBackup(data, now.toISOString()), null, 2);
  const name = L.backupFileName(now);
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '食事記録のバックアップ' });
      markBackup(); render(); toast('バックアップを保存しました');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markBackup(); render(); toast('バックアップを書き出しました');
}
function onRestoreFile(file) {
  if (!file) return;
  if (file.size > L.MAX_BACKUP_BYTES) { showRestoreError('ファイルが大きすぎます（5MBまで）。'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const res = L.parseBackup(String(reader.result), nowIso());
    if (!res.ok) { showRestoreError(res.error); return; }
    sheet = { kind: 'restore', data: res.data };
    const i = res.info;
    openSheet('<div class="sheet-head"><h2>バックアップから復元</h2><button class="link" data-action="close-sheet">閉じる</button></div>'
      + '<div class="card"><h3 style="font-size:14px;">選んだファイルの中身</h3>'
      + '<div class="lrow" style="border:none;padding:6px 0;"><span>ファイル</span><span class="v">' + esc(file.name) + '</span></div>'
      + '<div class="lrow" style="padding:6px 0;"><span>作成日時</span><span class="v">' + (i.exportedAt ? formatDateTime(i.exportedAt) : '不明') + '</span></div>'
      + '<div class="lrow" style="padding:6px 0;"><span>食事の記録</span><span class="v">' + i.meals + '件' + (i.firstDate ? '（' + L.formatShortMd(i.firstDate) + '〜' + L.formatShortMd(i.lastDate) + '）' : '') + '</span></div>'
      + '<div class="lrow" style="padding:6px 0;"><span>プラン</span><span class="v">' + i.plans + '件</span></div>'
      + '<div class="lrow" style="padding:6px 0;"><span>AIのまとめ</span><span class="v">' + i.aiSummaries + '件</span></div></div>'
      + '<p style="font-size:13px;color:var(--text-2);margin:4px 0 14px;">今の端末にあるデータは、このファイルの内容に置き換わります。必要なら、先に「バックアップを保存」をしておいてください。途中でうまくいかなかった場合は、今のデータをそのまま残します。</p>'
      + '<button class="btn primary" data-action="restore-apply">内容を確認して復元する</button><button class="btn" data-action="close-sheet">やめる</button>');
  };
  reader.onerror = () => showRestoreError('ファイルを読み込めませんでした。');
  reader.readAsText(file);
}
function showRestoreError(msg) {
  sheet = { kind: 'restore-error' };
  openSheet('<div class="sheet-head"><h2>復元できませんでした</h2><button class="link" data-action="close-sheet">閉じる</button></div>'
    + '<div class="notice">' + esc(msg) + '</div><p style="font-size:14px;color:var(--text-2);">今のデータは何も変わっていません。</p>'
    + '<button class="btn" data-action="close-sheet">閉じる</button>');
}
function applyRestore() {
  const next = sheet.data;
  const r = store.save(next);
  if (!r.ok) { showRestoreError(r.error === 'quota' ? '容量が足りないため復元できませんでした。' : 'この端末に保存できませんでした。'); return; }
  data = next;
  ui.brokenNotice = false;
  closeSheet();
  render();
  toast('復元しました');
}

function openSafety() {
  sheet = { kind: 'safety' };
  openSheet('<div class="sheet-head"><h2>安全のための情報</h2><button class="link" data-action="close-sheet">閉じる</button></div>'
    + '<div class="card"><p style="margin:0 0 10px;font-size:14px;">このアプリは食習慣を整えるための道具で、診断や治療をするものではありません。</p>'
    + '<p style="margin:0 0 6px;font-size:14px;">次のようなことが続くときは、ひとりで抱えずに相談できる場所があります。</p>'
    + '<ul class="ul"><li>食べたあとに吐く、下剤を使う</li><li>丸1日以上なにも食べない</li><li>消えてしまいたい気持ちが強い</li><li>めまい・失神など体の症状がある</li></ul></div>'
    + '<div class="card list-card">'
    + '<a class="lrow go" style="color:inherit;text-decoration:none;" href="https://www.mhlw.go.jp/mamorouyokokoro/" target="_blank" rel="noopener"><span class="lab">まもろうよ こころ<small>厚生労働省の相談窓口の案内</small></span></a>'
    + '<a class="lrow go" style="color:inherit;text-decoration:none;" href="https://www.edportal.jp/" target="_blank" rel="noopener"><span class="lab">摂食障害情報ポータルサイト<small>国立精神・神経医療研究センター</small></span></a></div>');
}

// ---------- シート・トースト ----------
function openSheet(html) {
  const body = $('#sheet-body');
  body.innerHTML = html;
  body.scrollTop = 0;
  $('#sheet').classList.add('on');
  $('#backdrop').classList.add('on');
}
function closeSheet() {
  $('#sheet').classList.remove('on');
  $('#backdrop').classList.remove('on');
  sheet = null;
}
let toastTimer;
function toast(msg, actLabel, actFn) {
  $('#toast-msg').textContent = msg;
  const a = $('#toast-act');
  if (actLabel) { a.textContent = actLabel; a.classList.remove('hidden'); a.onclick = () => { hideToast(); actFn(); }; }
  else { a.classList.add('hidden'); a.onclick = null; }
  $('#toast').classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actLabel ? 4500 : 2800);
}
function hideToast() { $('#toast').classList.remove('on'); }

// 削除は2回押しで確定（押し間違い防止）
function confirmTwice(btn) {
  if (btn.classList.contains('confirm')) return true;
  btn.classList.add('confirm');
  btn.textContent = 'もう一度押すと削除します';
  setTimeout(() => { if (btn.isConnected) { btn.classList.remove('confirm'); btn.textContent = btn.dataset.label; } }, 3000);
  return false;
}

// ---------- 操作 ----------
const actions = {
  'close-sheet': () => closeSheet(),
  'dismiss-broken': () => { ui.brokenNotice = false; render(); },
  'onb-next': () => { ui.onbStep = 2; render(); },
  'onb-back': () => { ui.onbStep = 1; render(); },
  'onb-done': () => {
    if (commit((d) => { d.settings.onboarded = true; d.settings.baselineStart = today(); })) { ui.tab = 'today'; render(); }
  },
  quick: (el) => {
    const slot = el.dataset.slot;
    const plan = slotPlan(slot);
    const late = L.dayMin(nowTime()) > L.dayMin(plan.time) + data.settings.onTimeToleranceMin;
    const meal = newMeal({ slot, time: late ? plan.time : nowTime() });
    if (!commit((d) => d.meals.push(meal))) return;
    render();
    toast(L.SLOT_LABEL[slot] + 'を記録しました', 'くわしく', () => openMealSheet(data.meals.find((m) => m.id === meal.id), false));
  },
  'new-meal': (el) => {
    const t = today();
    const date = el.dataset.date || t;
    const slot = el.dataset.slot || 'extra';
    const m = newMeal({ date, slot, time: date === t ? nowTime() : '21:00' });
    if (!el.dataset.slot) m._noSlot = true;
    openMealSheet(m, true);
  },
  'edit-meal': (el) => { const m = data.meals.find((x) => x.id === el.dataset.id); if (m) openMealSheet(m, false); },
  'save-meal': () => saveMealFromSheet(),
  'delete-meal': (el) => {
    if (!confirmTwice(el)) return;
    const id = sheet.id;
    if (!commit((d) => { d.meals = d.meals.filter((m) => m.id !== id); })) return;
    closeSheet(); render(); toast('記録を削除しました');
  },
  'return-ate': (el) => {
    const slot = el.dataset.slot;
    const t = today();
    commit((d) => {
      d.meals.push(newMeal({ slot, time: nowTime() }));
      upsertDay(d, t, { recovery: 'ate' });
    });
    render();
  },
  'return-later': () => { commit((d) => upsertDay(d, today(), { recovery: 'later' })); render(); },
  evening: (el) => {
    const v = el.dataset.value;
    if (!commit((d) => upsertDay(d, today(), { eveningAnswer: v }))) return;
    render();
    if (v === 'reduced') toast('教えてくれてありがとう。明日も、予定の時刻にいつもどおり食べてみましょう。');
    else if (v === 'normal') toast('記録しました');
  },
  'morning-save': () => {
    const root = $('#morning-card');
    const patch = { condition: groupValue(root, 'm-cond'), yesterdayTag: groupValue(root, 'm-tag'), conditionMemo: $('#m-memo').value.trim(), morningDone: true };
    if (commit((d) => upsertDay(d, today(), patch))) { render(); toast('残しました。ふりかえりで使います。'); }
  },
  'morning-skip': () => { if (commit((d) => upsertDay(d, today(), { morningDone: true }))) render(); },
  'save-weight': () => {
    const v = Number($('#w-input').value);
    if (!(v > 20 && v < 300)) { toast('数字を確かめてください'); return; }
    const t = today();
    if (commit((d) => {
      const w = d.weights.find((x) => x.date === t);
      if (w) Object.assign(w, { kg: Math.round(v * 10) / 10, updatedAt: nowIso() });
      else d.weights.push({ id: L.uuid(), date: t, kg: Math.round(v * 10) / 10, createdAt: nowIso(), updatedAt: nowIso() });
    })) toast('保存しました');
  },
  week: (el) => {
    const cur = ui.reviewWeek || L.weekStartOf(today());
    ui.reviewWeek = L.addDays(cur, 7 * Number(el.dataset.step));
    render();
  },
  'new-plan': () => openPlanSheet(blankPlan(), true),
  'new-plan-sug': () => { const s = riskSuggestion(); openPlanSheet(blankPlan(s ? { time: s.time, days: s.days } : {}), true); },
  'edit-plan': (el) => { const p = data.plans.find((x) => x.id === el.dataset.id); if (p) openPlanSheet(p, false); },
  'save-plan': () => savePlanFromSheet(),
  'delete-plan': (el) => {
    if (!confirmTwice(el)) return;
    const id = sheet.id;
    if (!commit((d) => { d.plans = d.plans.filter((p) => p.id !== id); })) return;
    closeSheet(); render(); toast('プランを削除しました');
  },
  'plan-sug': (el) => {
    $('#p-time').value = el.dataset.time;
    const days = el.dataset.days.split(',');
    $$('[data-group="pdays"] .chip').forEach((c) => c.classList.toggle('on', days.includes(c.dataset.value)));
    updatePlanWindow();
  },
  'scene-pick': (el) => {
    const i = Number(el.dataset.idx);
    sheet.scene = i;
    const box = $('#p-if');
    if (!box.value.trim() || box.value === sheet.autoIf) { box.value = data.settings.scenes[i]; sheet.autoIf = box.value; }
    renderScenes();
  },
  'scene-add': () => { sheet.sceneMode = 'add'; renderScenes(); },
  'scene-add-save': () => {
    const v = ($('#scene-new').value || '').trim();
    if (v && commit((d) => d.settings.scenes.push(v))) sheet.scene = data.settings.scenes.length - 1;
    sheet.sceneMode = 'pick';
    renderScenes();
  },
  'scene-edit': () => { sheet.sceneMode = sheet.sceneMode === 'edit' ? 'pick' : 'edit'; renderScenes(); },
  'scene-del': (el) => {
    if (!confirmTwice(el)) return;
    const i = Number(el.dataset.idx);
    if (!commit((d) => d.settings.scenes.splice(i, 1))) return;
    if (sheet.scene === i) sheet.scene = null; else if (sheet.scene > i) sheet.scene--;
    renderScenes();
  },
  'cal-day': (el) => { ui.calSel = el.dataset.date; render(); },
  'cal-month': (el) => {
    const m = ui.calMonth || today().slice(0, 7);
    const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + Number(el.dataset.step), 1);
    ui.calMonth = L.ymd(d).slice(0, 7);
    render();
  },
  backup: () => doBackup(),
  restore: () => $('#restore-file').click(),
  'restore-apply': () => applyRestore(),
  safety: () => openSafety(),
};

document.addEventListener('click', (ev) => {
  const tab = ev.target.closest('#tabbar [data-tab]');
  if (tab) { showTab(tab.dataset.tab); return; }

  const chip = ev.target.closest('.chips[data-group] .chip');
  if (chip && !chip.dataset.action) {
    const group = chip.parentElement, mode = group.dataset.mode, name = group.dataset.group;
    if (mode === 'multi') chip.classList.toggle('on');
    else {
      const was = chip.classList.contains('on');
      $$('.chip', group).forEach((c) => c.classList.remove('on'));
      if (!(was && mode === 'toggle')) chip.classList.add('on');
    }
    if (name === 'dayq') $('#f-date').value = chip.dataset.value;
    if (name === 'slot') $('#f-slot-err')?.classList.add('hidden');
    if (name === 'trend') { ui.trendKind = groupValue(document, 'trend'); render(); }
    if (name === 'heat') { ui.heatKind = groupValue(document, 'heat'); render(); }
    if (name === 'cond') {
      const v = groupValue(group.parentElement, 'cond');
      commit((d) => upsertDay(d, today(), { condition: v }));
    }
    return;
  }

  const act = ev.target.closest('[data-action]');
  if (act && actions[act.dataset.action]) { ev.preventDefault(); actions[act.dataset.action](act); }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.range) {
    t.dataset.set = '1';
    const out = $('[data-out="' + t.dataset.range + '"]', t.closest('.field'));
    if (out) out.textContent = t.value;
  }
  if (t.id === 'p-time' || t.id === 'p-before' || t.id === 'p-after') updatePlanWindow();
  if (t.id === 'f-date') $$('[data-group="dayq"] .chip').forEach((c) => c.classList.toggle('on', c.dataset.value === t.value));
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.id === 'restore-file') { onRestoreFile(t.files[0]); t.value = ''; return; }
  if (t.dataset.sceneInput != null) {
    const i = Number(t.dataset.sceneInput), v = t.value.trim();
    if (v) commit((d) => { d.settings.scenes[i] = v; });
    return;
  }
  const s = t.dataset.setting;
  if (!s) return;
  if (s === 'slot-on') {
    const slot = t.dataset.slot;
    if (!t.checked && L.enabledSlots(data.settings).length <= 1) { t.checked = true; toast('食事は1つ以上オンにしてください'); return; }
    commit((d) => { d.settings.meals[slot].on = t.checked; });
    render();
  } else if (s === 'slot-time') {
    if (/^\d{2}:\d{2}$/.test(t.value)) commit((d) => { d.settings.meals[t.dataset.slot].time = t.value; });
  } else if (s === 'tolerance') {
    commit((d) => { d.settings.onTimeToleranceMin = Number(t.value); });
  } else if (s === 'chain') {
    commit((d) => { d.settings.chainWindowMin = Number(t.value); });
  } else if (s === 'self-note') {
    if (commit((d) => { d.settings.selfNote = t.value.trim(); })) toast('保存しました');
  } else if (s === 'weight') {
    commit((d) => { d.settings.weightEnabled = t.checked; });
  } else if (s === 'cond-memo') {
    commit((d) => upsertDay(d, today(), { conditionMemo: t.value.trim() }));
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.id === 'scene-new') { ev.preventDefault(); actions['scene-add-save'](); }
});

// 時間がたつと表示（プラン・記録するボタンなど）が変わるので、1分ごとと、アプリに戻ったときに描き直す
function refreshIfIdle() {
  if (sheet) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  if (!data.settings.onboarded) return;
  if (ui.tab === 'today' || ui.tab === 'review') render();
}
setInterval(refreshIfIdle, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfIdle(); });

render();
