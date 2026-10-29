// 計算と保存の自動テスト。実行：node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { createStore, prefixFor } from '../js/store.js';

const NOW = '2026-10-28T07:00:00.000Z';
let n = 0;
function meal(date, time, slot, extra = {}) {
  return {
    id: 'm' + (++n), date, time, slot, source: null, content: '', cantStop: false, extraOrder: false,
    details: { situations: [], maaiika: null, hunger: null, fullness: null, feeling: null },
    createdAt: NOW, updatedAt: NOW, ...extra,
  };
}
function day(date, extra = {}) {
  return { id: 'd' + (++n), date, condition: null, conditionMemo: '', yesterdayTag: null, recovery: null, eveningAnswer: null, createdAt: NOW, updatedAt: NOW, ...extra };
}
function data(meals = [], days = []) {
  const d = L.defaultData(NOW);
  d.meals = meals; d.days = days;
  return d;
}

test('1日の区切りは朝5時', () => {
  assert.equal(L.logicalDay(new Date(2026, 9, 29, 1, 30)), '2026-10-28');
  assert.equal(L.logicalDay(new Date(2026, 9, 29, 5, 0)), '2026-10-29');
  assert.equal(L.dayMin('01:00'), 25 * 60);
  assert.equal(L.bandOf('01:00'), 3); // 深夜
  assert.equal(L.bandOf('05:00'), 0); // 朝
  assert.equal(L.bandOf('16:00'), 2); // 夕方
});

test('週は月曜始まり', () => {
  assert.equal(L.weekStartOf('2026-10-28'), '2026-10-26'); // 水曜 → 月曜
  assert.equal(L.weekStartOf('2026-11-01'), '2026-10-26'); // 日曜 → 同じ週の月曜
  assert.equal(L.dowIndex('2026-10-26'), 0);
});

test('予定どおりは前後60分まで', () => {
  const s = L.defaultSettings();
  assert.equal(L.isOnTime(meal('2026-10-28', '08:30', 'breakfast'), s), true);
  assert.equal(L.isOnTime(meal('2026-10-28', '08:31', 'breakfast'), s), false);
  assert.equal(L.isOnTime(meal('2026-10-28', '12:30', 'extra'), s), false);
});

test('予定どおりの日は、予定に入れた食事すべて。オフの食事は数えない', () => {
  const d = data([
    meal('2026-10-28', '07:40', 'breakfast'), meal('2026-10-28', '12:30', 'lunch'), meal('2026-10-28', '19:10', 'dinner'),
  ]);
  assert.equal(L.isOnTimeDay(d, '2026-10-28'), false); // 間食がない
  d.settings.meals.snack.on = false;
  assert.equal(L.isOnTimeDay(d, '2026-10-28'), true);
});

test('連続注文：3時間以内の追加を1回と数え、何度追加しても1回', () => {
  const d = data([
    meal('2026-10-24', '21:40', 'extra', { source: 'delivery' }),
    meal('2026-10-24', '23:10', 'extra', { source: 'delivery' }),
    meal('2026-10-24', '00:30', 'extra', { source: 'konbini' }), // 夜中0:30は24日の夜
    meal('2026-10-25', '12:00', 'lunch', { source: 'konbini' }), // 予定の食事を買っただけ → 数えない
    meal('2026-10-25', '15:00', 'snack', { source: 'konbini' }),
    meal('2026-10-26', '20:00', 'extra', { source: 'home', extraOrder: true }), // スイッチだけでも1回
  ]);
  assert.deepEqual(L.chainOrderDates(d), ['2026-10-24', '2026-10-26']);
  d.settings.chainWindowMin = 60;
  assert.deepEqual(L.chainOrderDates(d), ['2026-10-26']);
});

test('翌日の制限は、夜の1問で「減らした」と答えた日だけ', () => {
  const d = data(
    [meal('2026-10-24', '22:00', 'extra', { cantStop: true })],
    [day('2026-10-25', { eveningAnswer: 'reduced' }), day('2026-10-27', { eveningAnswer: 'reduced' }), day('2026-10-26', { eveningAnswer: 'skip' })],
  );
  assert.deepEqual(L.restrictedDates(d), ['2026-10-25']); // 27日は前の日に止められない感じがない
});

test('週の集計と最初の14日間の平均', () => {
  const d = data([
    meal('2026-10-06', '21:00', 'extra', { cantStop: true }),
    meal('2026-10-09', '21:00', 'extra', { cantStop: true }),
    meal('2026-10-15', '22:00', 'extra', { cantStop: true }),
    meal('2026-10-24', '22:00', 'extra', { cantStop: true }),
  ]);
  d.settings.baselineStart = '2026-10-05';
  const b1 = L.baselineInfo(d, '2026-10-10');
  assert.equal(b1.done, false);
  assert.equal(b1.remaining, 9);
  const b2 = L.baselineInfo(d, '2026-10-28');
  assert.equal(b2.done, true);
  assert.equal(b2.avg.cantStop, 1.5);
  assert.equal(b2.interval, 4.5); // 6→9→15
  const w = L.weekStats(d, '2026-10-19', '2026-10-28');
  assert.equal(w.cantStop, 1);
  assert.equal(w.partial, false);
  const cur = L.weekStats(d, '2026-10-26', '2026-10-28');
  assert.equal(cur.partial, true);
  assert.equal(cur.days, 3);
});

test('分布表は曜日×4つの時間帯', () => {
  const d = data([meal('2026-10-24', '00:30', 'extra', { cantStop: true }), meal('2026-10-24', '07:00', 'extra')]);
  const g = L.heatmap(d, '2026-10-19', 'ctrl');
  assert.equal(g[5][3], 1); // 土曜の深夜
  assert.equal(L.heatmap(d, '2026-10-19', 'extra')[5][0], 1); // 土曜の朝
});

test('起きやすい時間帯の提案', () => {
  const d = data([
    meal('2026-10-09', '21:10', 'extra', { cantStop: true }), meal('2026-10-16', '21:40', 'extra', { cantStop: true }),
    meal('2026-10-17', '22:00', 'extra', { cantStop: true }), meal('2026-10-24', '20:50', 'extra', { cantStop: true }),
  ]);
  const s = L.suggestRiskTime(d, '2026-10-28');
  assert.equal(s.band, 3);
  assert.deepEqual(s.days, [4, 5]); // 金・土
  assert.equal(s.time, '21:30');
  assert.equal(L.suggestRiskTime(data([]), '2026-10-28'), null);
});

test('プランは選んだ時間のあいだだけ表示', () => {
  const d = data();
  d.plans = [{ id: 'p1', ifText: 'a', thenText: 'b', time: '16:30', beforeMin: 60, afterMin: 0, days: [0, 1, 2, 3, 4], active: true }];
  assert.equal(L.visiblePlans(d, '2026-10-28', '15:30').length, 1);
  assert.equal(L.visiblePlans(d, '2026-10-28', '16:31').length, 0);
  assert.equal(L.visiblePlans(d, '2026-10-31', '16:00').length, 0); // 土曜
  d.plans[0].active = false;
  assert.equal(L.visiblePlans(d, '2026-10-28', '16:00').length, 0);
  assert.equal(L.planWindowText({ time: '23:30', beforeMin: 60, afterMin: 120 }), '22:30〜1:30');
});

test('バックアップ：書き出したものをそのまま復元できる', () => {
  const d = data([meal('2026-10-24', '07:40', 'breakfast', { content: 'トースト' })]);
  const text = JSON.stringify(L.buildBackup(d, NOW));
  const r = L.parseBackup(text, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.info.meals, 1);
  assert.equal(r.data.meals[0].content, 'トースト');
});

test('バックアップ：おかしなファイルは安全にエラーになる', () => {
  assert.equal(L.parseBackup('', NOW).ok, false);
  assert.equal(L.parseBackup('{oops', NOW).ok, false);
  assert.equal(L.parseBackup(JSON.stringify({ entries: [] }), NOW).ok, false); // 今のアプリの形式
  const newer = L.buildBackup(data(), NOW); newer.schemaVersion = 99;
  assert.match(L.parseBackup(JSON.stringify(newer), NOW).error, /新しいバージョン/);
  const bad = L.buildBackup(data([meal('2026-10-24', '25:00', 'breakfast')]), NOW);
  assert.match(L.parseBackup(JSON.stringify(bad), NOW).error, /1件/);
});

test('バックアップ：同じIDは更新日時が新しいほうを残す', () => {
  const a = meal('2026-10-24', '07:40', 'breakfast', { id: 'same', content: '古い', updatedAt: '2026-10-24T00:00:00Z' });
  const b = { ...a, content: '新しい', updatedAt: '2026-10-25T00:00:00Z' };
  const r = L.parseBackup(JSON.stringify(L.buildBackup(data([a, b]), NOW)), NOW);
  assert.equal(r.data.meals.length, 1);
  assert.equal(r.data.meals[0].content, '新しい');
});

function fakeStorage(limit = Infinity) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const size = [...m].reduce((s, [kk, vv]) => s + (kk === k ? 0 : kk.length + vv.length), 0) + k.length + v.length;
      if (size > limit) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

test('保存：本番のURLだけ v2-、ほかは v2test-', () => {
  assert.equal(prefixFor({ hostname: 'owdev-appty.github.io', pathname: '/eO20-1app-DevtR-07SUC--Shp/' }), 'v2-');
  assert.equal(prefixFor({ hostname: 'owdev-appty.github.io', pathname: '/other-repo/' }), 'v2test-');
  assert.equal(prefixFor({ hostname: 'localhost', pathname: '/' }), 'v2test-');
});

test('保存：旧データには触れず、容量不足なら前のデータが残る', () => {
  const st = fakeStorage(3000);
  st.setItem('diet-monitoring-entries', '[]');
  const store = createStore(st, 'v2test-');
  assert.equal(store.load(NOW).status, 'new');
  const d = data([meal('2026-10-24', '07:40', 'breakfast')]);
  assert.equal(store.save(d).ok, true);
  const big = data([meal('2026-10-24', '07:40', 'breakfast', { content: 'x'.repeat(5000) })]);
  assert.deepEqual(store.save(big), { ok: false, error: 'quota' });
  assert.equal(store.load(NOW).data.meals[0].content, ''); // 前のデータのまま
  assert.equal(st.getItem('diet-monitoring-entries'), '[]');
});

test('保存：読めないデータは消さずに別の名前で残す', () => {
  const st = fakeStorage();
  st.setItem('v2test-data', '{壊れた');
  const store = createStore(st, 'v2test-');
  assert.equal(store.load(NOW).status, 'broken');
  assert.equal(st.getItem('v2test-data-broken'), '{壊れた');
});
