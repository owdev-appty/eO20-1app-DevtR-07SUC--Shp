// 計算だけを行う部品。画面や保存には触れないので、Node の自動テストからも読み込める。

export const SCHEMA = 'binge-recovery-app';
export const SCHEMA_VERSION = 1;
export const APP_VERSION = '2.0.0';

// 1日の区切り。夜中0〜5時の食事は前の日の夜として扱う
export const DAY_START_HOUR = 5;

export const SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'];
export const SLOT_LABEL = { breakfast: '朝食', lunch: '昼食', snack: '間食', dinner: '夕食', extra: '予定外' };
export const SOURCES = { home: '自炊', delivery: 'デリバリー', konbini: 'コンビニ', eatout: '外食', other: 'その他' };
export const PURCHASE_SOURCES = ['delivery', 'konbini'];
export const SITUATIONS = ['退屈', '疲れ', 'ストレス', '飲酒後', '仕事の合間'];
export const MAAIIKA = ['もう食べたから', '今の楽しみ', '考えるのが面倒', 'どうせまた', '特に考えず'];
export const FEELINGS = ['落ち着いた', 'ふつう', 'もやもや', '落ち込んだ'];
export const CONDITIONS = ['よく眠れた', '寝不足', '疲れ気味', 'ふつう'];
export const YDAY_TAGS = ['退屈', '疲れ', 'ストレス', '飲酒後', '仕事の合間', 'わからない'];
export const DEFAULT_SCENES = ['夕方、仕事の区切り', '夜、一度注文したあと', 'お酒を飲んだあと', '休日の午後'];
export const DOW = ['月', '火', '水', '木', '金', '土', '日']; // 0 = 月曜
// 時間帯。to が 29 なのは「翌5時」の意味
export const BANDS = [
  { id: 'morning', label: '朝', from: 5, to: 11 },
  { id: 'noon', label: '昼', from: 11, to: 16 },
  { id: 'evening', label: '夕方', from: 16, to: 21 },
  { id: 'night', label: '深夜', from: 21, to: 29 },
];
export const BASELINE_DAYS = 14;

// ---------- 日付と時刻 ----------
const pad2 = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}
export function hhmm(d) {
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
export function clockMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
export function minToHhmm(m) {
  m = ((m % 1440) + 1440) % 1440;
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}
export function shortTime(t) {
  return t.replace(/^0(\d):/, '$1:');
}
// 1日の中での分（5:00 = 300 〜 翌4:59 = 1739）
export function dayMin(t) {
  const m = clockMin(t);
  return m < DAY_START_HOUR * 60 ? m + 1440 : m;
}
export function logicalDay(d) {
  const x = new Date(d.getTime() - DAY_START_HOUR * 3600000);
  return ymd(x);
}
export function dowIndex(s) {
  return (parseYmd(s).getDay() + 6) % 7;
}
export function weekStartOf(s) {
  return addDays(s, -dowIndex(s));
}
export function formatMd(s) {
  const d = parseYmd(s);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + DOW[dowIndex(s)] + '）';
}
export function formatShortMd(s) {
  const d = parseYmd(s);
  return (d.getMonth() + 1) + '/' + d.getDate();
}
export function bandOf(t) {
  const h = Math.floor(dayMin(t) / 60);
  return BANDS.findIndex((b) => h >= b.from && h < b.to);
}
// 並べ替えと連続注文の計算に使う通しの分
export function mealEpochMin(meal) {
  return daysBetween('2000-01-01', meal.date) * 1440 + dayMin(meal.time);
}

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------- データの初期値 ----------
export function defaultSettings() {
  return {
    meals: {
      breakfast: { time: '07:30', on: true },
      lunch: { time: '12:30', on: true },
      snack: { time: '15:30', on: true },
      dinner: { time: '19:00', on: true },
    },
    onTimeToleranceMin: 60,
    chainWindowMin: 180,
    baselineStart: null,
    onboarded: false,
    selfNote: '',
    weightEnabled: false,
    scenes: DEFAULT_SCENES.slice(),
  };
}
export function defaultData(nowIso) {
  return {
    schema: SCHEMA,
    version: SCHEMA_VERSION,
    createdAt: nowIso,
    updatedAt: nowIso,
    settings: defaultSettings(),
    meals: [],
    days: [],
    plans: [],
    aiSummaries: [],
    experiments: [],
    envTips: [],
    checkins: [],
    weights: [],
  };
}
export const COLLECTIONS = ['meals', 'days', 'plans', 'aiSummaries', 'experiments', 'envTips', 'checkins', 'weights'];

// ---------- 形のチェック（バックアップの復元と、読み込み時に使う） ----------
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const RE_HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const optStr = (v) => v == null || isStr(v);
const isScale = (v) => v == null || (Number.isInteger(v) && v >= 0 && v <= 10);
const strArr = (v) => Array.isArray(v) && v.every(isStr);

function checkMeal(m) {
  return m && isStr(m.id) && RE_YMD.test(m.date) && RE_HM.test(m.time) &&
    (SLOTS.includes(m.slot) || m.slot === 'extra') &&
    (m.source == null || Object.prototype.hasOwnProperty.call(SOURCES, m.source)) &&
    optStr(m.content) && isBool(m.cantStop) && isBool(m.extraOrder) &&
    m.details && typeof m.details === 'object' && strArr(m.details.situations || []) &&
    optStr(m.details.maaiika) && isScale(m.details.hunger) && isScale(m.details.fullness) && optStr(m.details.feeling);
}
function checkDay(d) {
  return d && isStr(d.id) && RE_YMD.test(d.date) && optStr(d.condition) && optStr(d.conditionMemo) &&
    optStr(d.yesterdayTag) && (d.recovery == null || d.recovery === 'ate' || d.recovery === 'later') &&
    (d.eveningAnswer == null || ['normal', 'reduced', 'skip'].includes(d.eveningAnswer));
}
function checkPlan(p) {
  return p && isStr(p.id) && isStr(p.ifText) && isStr(p.thenText) && RE_HM.test(p.time) &&
    Number.isInteger(p.beforeMin) && Number.isInteger(p.afterMin) &&
    Array.isArray(p.days) && p.days.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) && isBool(p.active);
}
function checkWeight(w) {
  return w && isStr(w.id) && RE_YMD.test(w.date) && typeof w.kg === 'number' && w.kg > 0 && w.kg < 500;
}
const CHECKERS = {
  meals: checkMeal, days: checkDay, plans: checkPlan, weights: checkWeight,
  aiSummaries: (x) => x && isStr(x.id), experiments: (x) => x && isStr(x.id),
  envTips: (x) => x && isStr(x.id), checkins: (x) => x && isStr(x.id),
};

function mergeSettings(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base, ...raw, meals: { ...base.meals } };
  for (const s of SLOTS) {
    const m = raw.meals && raw.meals[s];
    if (m && RE_HM.test(m.time) && isBool(m.on)) out.meals[s] = { time: m.time, on: m.on };
  }
  if (!Number.isInteger(out.onTimeToleranceMin)) out.onTimeToleranceMin = base.onTimeToleranceMin;
  if (!Number.isInteger(out.chainWindowMin)) out.chainWindowMin = base.chainWindowMin;
  if (!(out.baselineStart == null || RE_YMD.test(out.baselineStart))) out.baselineStart = null;
  if (!isBool(out.onboarded)) out.onboarded = false;
  if (!isStr(out.selfNote)) out.selfNote = '';
  if (!isBool(out.weightEnabled)) out.weightEnabled = false;
  if (!strArr(out.scenes)) out.scenes = base.scenes;
  return out;
}

// 同じIDが重なっていたら、更新日時が新しいほうを残す
function dedupe(list) {
  const byId = new Map();
  for (const item of list) {
    const prev = byId.get(item.id);
    if (!prev || String(item.updatedAt || '') > String(prev.updatedAt || '')) byId.set(item.id, item);
  }
  return [...byId.values()];
}

// データの形を確かめて、足りない項目を補う。1件でもおかしければ ok:false
export function normalizeData(raw, nowIso) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '中身が読み取れません。' };
  if (raw.schema !== SCHEMA) return { ok: false, error: 'このアプリのデータではありません。' };
  if (!Number.isInteger(raw.version)) return { ok: false, error: 'データ形式のバージョンが分かりません。' };
  if (raw.version > SCHEMA_VERSION) return { ok: false, error: '新しいバージョンのアプリで作られたデータです。アプリを更新してから復元してください。' };
  const data = defaultData(nowIso);
  data.createdAt = isStr(raw.createdAt) ? raw.createdAt : nowIso;
  data.updatedAt = isStr(raw.updatedAt) ? raw.updatedAt : nowIso;
  data.settings = mergeSettings(raw.settings);
  for (const key of COLLECTIONS) {
    const list = raw[key] == null ? [] : raw[key];
    if (!Array.isArray(list)) return { ok: false, error: '「' + key + '」の形が正しくありません。' };
    const bad = list.filter((x) => !CHECKERS[key](x)).length;
    if (bad) return { ok: false, error: '「' + key + '」に形の正しくない項目が' + bad + '件あります。' };
    data[key] = dedupe(list);
  }
  return { ok: true, data };
}

export function buildBackup(data, nowIso) {
  return { app: SCHEMA, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt: nowIso, data };
}
export function backupFileName(now) {
  return 'shokuji-backup-' + ymd(now).replace(/-/g, '') + '-' + hhmm(now).replace(':', '') + '.json';
}
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

// バックアップファイルの文字列を確かめる。成功すれば data と確認画面用の情報を返す
export function parseBackup(text, nowIso) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'ファイルが空です。' };
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'ファイルが大きすぎます（5MBまで）。' };
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'ファイルの中身を読み取れませんでした。バックアップのファイルか確かめてください。' }; }
  if (!obj || obj.app !== SCHEMA) return { ok: false, error: 'このアプリのバックアップファイルではありません。' };
  if (!Number.isInteger(obj.schemaVersion)) return { ok: false, error: 'データ形式のバージョンが分かりません。' };
  if (obj.schemaVersion > SCHEMA_VERSION) return { ok: false, error: '新しいバージョンのアプリで作られたファイルです。アプリを更新してから復元してください。' };
  const res = normalizeData(obj.data, nowIso);
  if (!res.ok) return res;
  const dates = res.data.meals.map((m) => m.date).sort();
  return {
    ok: true,
    data: res.data,
    info: {
      exportedAt: isStr(obj.exportedAt) ? obj.exportedAt : null,
      meals: res.data.meals.length,
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null,
      plans: res.data.plans.length,
      aiSummaries: res.data.aiSummaries.length,
    },
  };
}

// ---------- 集計 ----------
export function sortMeals(meals) {
  return meals.slice().sort((a, b) => mealEpochMin(a) - mealEpochMin(b));
}
export function mealsOn(data, date) {
  return sortMeals(data.meals.filter((m) => m.date === date));
}
export function enabledSlots(settings) {
  return SLOTS.filter((s) => settings.meals[s].on);
}
export function isOnTime(meal, settings) {
  if (!SLOTS.includes(meal.slot)) return false;
  const plan = settings.meals[meal.slot];
  if (!plan.on) return false;
  return Math.abs(dayMin(meal.time) - dayMin(plan.time)) <= settings.onTimeToleranceMin;
}
export function isOnTimeDay(data, date) {
  const slots = enabledSlots(data.settings);
  if (!slots.length) return false;
  const meals = data.meals.filter((m) => m.date === date);
  return slots.every((s) => meals.some((m) => m.slot === s && isOnTime(m, data.settings)));
}
export function cantStopDates(data) {
  return new Set(data.meals.filter((m) => m.cantStop).map((m) => m.date));
}
export function dayRecord(data, date) {
  return data.days.find((d) => d.date === date) || null;
}

// 連続注文：デリバリーかコンビニで最初に買ってから window 分以内に、予定外の食事をもう一度買ったか、
// 「追加で注文・買い足した」をオンにした流れを1回と数える。予定の食事を買っただけ（昼食と間食をコンビニで、など）は数えない。
// 返すのは各流れの最初の日付
export function chainOrderDates(data) {
  const win = data.settings.chainWindowMin;
  const events = sortMeals(data.meals.filter((m) => PURCHASE_SOURCES.includes(m.source) || m.extraOrder));
  const out = [];
  let i = 0;
  while (i < events.length) {
    const t0 = mealEpochMin(events[i]);
    let j = i + 1;
    while (j < events.length && mealEpochMin(events[j]) - t0 <= win) j++;
    const group = events.slice(i, j);
    if (group.slice(1).some((m) => m.slot === 'extra') || group.some((m) => m.extraOrder)) out.push(events[i].date);
    i = j;
  }
  return out;
}

// 過食の翌日に制限した日：止められない感じがあった日の翌日で、夜の1問に「少し減らした・抜いた」と答えた日
export function restrictedDates(data) {
  const cs = cantStopDates(data);
  return data.days.filter((d) => d.eveningAnswer === 'reduced' && cs.has(addDays(d.date, -1))).map((d) => d.date);
}

function datesInRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// from〜to（両端を含む）の4つの数字
export function rangeStats(data, from, to) {
  const inRange = (d) => d >= from && d <= to;
  return {
    cantStop: data.meals.filter((m) => m.cantStop && inRange(m.date)).length,
    chains: chainOrderDates(data).filter(inRange).length,
    onTimeDays: datesInRange(from, to).filter((d) => isOnTimeDay(data, d)).length,
    restricted: restrictedDates(data).filter(inRange).length,
  };
}

// 週の集計。今週なら今日までで数える
export function weekStats(data, weekStart, today) {
  const end = addDays(weekStart, 6);
  const to = end > today ? today : end;
  return { ...rangeStats(data, weekStart, to), partial: end > today, days: daysBetween(weekStart, to) + 1 };
}

// 最初の14日間。終わっていなければ remaining に残りの日数が入る
export function baselineInfo(data, today) {
  const start = data.settings.baselineStart;
  if (!start) return { started: false, done: false, remaining: BASELINE_DAYS };
  const end = addDays(start, BASELINE_DAYS - 1);
  const done = today > end;
  const remaining = done ? 0 : daysBetween(today, end) + 1;
  const res = { started: true, done, remaining, start, end };
  if (done) {
    const s = rangeStats(data, start, end);
    const weeks = BASELINE_DAYS / 7;
    res.avg = { cantStop: s.cantStop / weeks, chains: s.chains / weeks, onTimeDays: s.onTimeDays / weeks, restricted: s.restricted / weeks };
    res.interval = averageInterval([...cantStopDates(data)].filter((d) => d >= start && d <= end));
  }
  return res;
}

// 止められない感じがあった日と日のあいだの平均の日数。2日以上なければ null
export function averageInterval(dates) {
  const ds = [...new Set(dates)].sort();
  if (ds.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < ds.length; i++) sum += daysBetween(ds[i - 1], ds[i]);
  return sum / (ds.length - 1);
}

// 曜日×時間帯の回数（7行×4列）
export function heatmap(data, weekStart, kind) {
  const end = addDays(weekStart, 6);
  const grid = DOW.map(() => BANDS.map(() => 0));
  for (const m of data.meals) {
    if (m.date < weekStart || m.date > end) continue;
    if (kind === 'extra' ? m.slot !== 'extra' : !m.cantStop) continue;
    const b = bandOf(m.time);
    if (b >= 0) grid[dowIndex(m.date)][b]++;
  }
  return grid;
}

// 直近4週間で、止められない感じが起きやすい時間帯。3回未満なら null
export function suggestRiskTime(data, today) {
  const from = addDays(today, -27);
  const meals = data.meals.filter((m) => m.cantStop && m.date >= from && m.date <= today);
  if (meals.length < 3) return null;
  const byBand = BANDS.map(() => []);
  for (const m of meals) { const b = bandOf(m.time); if (b >= 0) byBand[b].push(m); }
  let best = 0;
  byBand.forEach((list, i) => { if (list.length > byBand[best].length) best = i; });
  const list = byBand[best];
  if (list.length < 3) return null;
  const dowCount = DOW.map(() => 0);
  list.forEach((m) => dowCount[dowIndex(m.date)]++);
  const days = dowCount.map((c, i) => ({ c, i })).filter((x) => x.c > 0).sort((a, b) => b.c - a.c).slice(0, 3).map((x) => x.i).sort((a, b) => a - b);
  const inDays = list.filter((m) => days.includes(dowIndex(m.date))).length;
  const mins = list.map((m) => dayMin(m.time)).sort((a, b) => a - b);
  const median = mins[Math.floor(mins.length / 2)];
  const rounded = Math.round(median / 30) * 30;
  return { band: best, days, time: minToHhmm(rounded), count: inDays, total: meals.length };
}

// ---------- if-thenプラン ----------
export function planWindow(p) {
  const t = dayMin(p.time);
  return { from: t - p.beforeMin, to: t + p.afterMin };
}
export function planWindowText(p) {
  const w = planWindow(p);
  return shortTime(minToHhmm(w.from)) + '〜' + shortTime(minToHhmm(w.to));
}
// 今「今日」に表示するプラン
export function visiblePlans(data, today, nowTime) {
  const dow = dowIndex(today);
  const now = dayMin(nowTime);
  return data.plans.filter((p) => {
    if (!p.active || !p.days.includes(dow)) return false;
    const w = planWindow(p);
    return now >= w.from && now <= w.to;
  });
}
export function daysLabel(days) {
  const s = days.slice().sort((a, b) => a - b);
  if (s.length === 7) return '毎日';
  if (s.length === 5 && [0, 1, 2, 3, 4].every((x) => s.includes(x))) return '平日';
  if (s.length === 2 && s[0] === 5 && s[1] === 6) return '土日';
  if (!s.length) return '曜日なし';
  return s.map((i) => DOW[i]).join('・');
}

// ---------- 容量 ----------
export const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;
export const STORAGE_WARN_BYTES = 1024 * 1024;
export function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}
