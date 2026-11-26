/* 여행 플래너 – 여행 목록 저장소 (여러 여행, 마이그레이션, 내보내기/가져오기) */
(function () {
  'use strict';

  const KEY = 'trips-v2';
  const LEGACY_KEY = 'pq-trip-v1';   // 예전 푸꾸옥 전용 저장값 (지우지 않음)
  const LEGACY_UI = 'pq-ui-v1';

  // 통화: 이름, 단위, 기호, 소수 자리, 국가 코드(장소 검색용), 그랩 서비스 여부, 대략 환율(1원당), 빠른 버튼
  const CURRENCIES = [
    { code: 'VND', name: '베트남 동', unit: '동', sym: '₫', dec: 0, cc: 'vn', grab: true, fb: 18.5, q: [100000, 200000, 500000] },
    { code: 'THB', name: '태국 바트', unit: '바트', sym: '฿', dec: 0, cc: 'th', grab: true, fb: 0.024, q: [100, 500, 1000] },
    { code: 'PHP', name: '필리핀 페소', unit: '페소', sym: '₱', dec: 0, cc: 'ph', grab: true, fb: 0.041, q: [100, 500, 1000] },
    { code: 'IDR', name: '인도네시아 루피아', unit: '루피아', sym: 'Rp', dec: 0, cc: 'id', grab: true, fb: 11.5, q: [50000, 100000, 200000] },
    { code: 'MYR', name: '말레이시아 링깃', unit: '링깃', sym: 'RM', dec: 2, cc: 'my', grab: true, fb: 0.0031, q: [10, 50, 100] },
    { code: 'SGD', name: '싱가포르 달러', unit: '싱가포르달러', sym: 'S$', dec: 2, cc: 'sg', grab: true, fb: 0.00094, q: [10, 50, 100] },
    { code: 'KHR', name: '캄보디아 리엘', unit: '리엘', sym: '៛', dec: 0, cc: 'kh', grab: true, fb: 2.9, q: [10000, 20000, 50000] },
    { code: 'MMK', name: '미얀마 짯', unit: '짯', sym: 'K', dec: 0, cc: 'mm', grab: true, fb: 1.5, q: [5000, 10000, 50000] },
    { code: 'LAK', name: '라오스 킵', unit: '킵', sym: '₭', dec: 0, cc: 'la', grab: false, fb: 15, q: [50000, 100000, 200000] },
    { code: 'JPY', name: '일본 엔', unit: '엔', sym: '¥', dec: 0, cc: 'jp', grab: false, fb: 0.107, q: [1000, 5000, 10000] },
    { code: 'CNY', name: '중국 위안', unit: '위안', sym: '¥', dec: 2, cc: 'cn', grab: false, fb: 0.0051, q: [50, 100, 500] },
    { code: 'TWD', name: '대만 달러', unit: '대만달러', sym: 'NT$', dec: 0, cc: 'tw', grab: false, fb: 0.023, q: [100, 500, 1000] },
    { code: 'HKD', name: '홍콩 달러', unit: '홍콩달러', sym: 'HK$', dec: 2, cc: 'hk', grab: false, fb: 0.0055, q: [50, 100, 500] },
    { code: 'USD', name: '미국 달러', unit: '달러', sym: '$', dec: 2, cc: '', grab: false, fb: 1 / 1400, q: [10, 20, 50, 100] },
    { code: 'EUR', name: '유로', unit: '유로', sym: '€', dec: 2, cc: '', grab: false, fb: 0.00064, q: [10, 50, 100] },
    { code: 'GBP', name: '영국 파운드', unit: '파운드', sym: '£', dec: 2, cc: 'gb', grab: false, fb: 0.00054, q: [10, 50, 100] },
    { code: 'AUD', name: '호주 달러', unit: '호주달러', sym: 'A$', dec: 2, cc: 'au', grab: false, fb: 0.0011, q: [10, 50, 100] },
    { code: 'KRW', name: '대한민국 원', unit: '원', sym: '원', dec: 0, cc: 'kr', grab: false, fb: 1, q: [10000, 50000, 100000] },
  ];
  const curOf = code => CURRENCIES.find(c => c.code === code) || CURRENCIES[0];

  // ---------- 유틸 ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const toNum = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  }
  function diffDays(a, b) { // b - a
    const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((p(b) - p(a)) / 86400000);
  }
  function todayISO() {
    const t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }

  // 여행 날짜 목록 (최대 60일)
  function tripDates(trip) {
    if (!trip || !isDate(trip.start) || !isDate(trip.end)) return [];
    const n = Math.min(60, Math.max(0, diffDays(trip.start, trip.end)));
    return Array.from({ length: n + 1 }, (_, i) => addDays(trip.start, i));
  }

  function status(trip, today) {
    today = today || todayISO();
    if (today < trip.start) return { kind: 'upcoming', label: `D-${diffDays(today, trip.start)}`, order: 0 };
    if (today > trip.end) return { kind: 'past', label: '완료', order: 2 };
    return { kind: 'ongoing', label: `여행 중 · Day ${diffDays(trip.start, today) + 1}`, order: 1 };
  }

  // ---------- 정규화 ----------
  function normItems(list) {
    return (Array.isArray(list) ? list : [])
      .filter(it => it && typeof it === 'object' && String(it.place || '').trim())
      .map(it => ({
        id: typeof it.id === 'string' && it.id ? it.id : uid(),
        time: /^\d{2}:\d{2}$/.test(it.time) ? it.time : '',
        place: String(it.place).trim().slice(0, 80),
        memo: String(it.memo || '').slice(0, 500),
        lat: toNum(it.lat),
        lng: toNum(it.lng),
      }));
  }

  // 예전 환율 설정({krw,vnd} 또는 pairs.KV/UV/KU) → 새 형식(pairs.KL/UL/KU)
  function normFx(fx) {
    if (!fx || typeof fx !== 'object') return {};
    const out = { mode: fx.mode === 'manual' ? 'manual' : 'live', pairs: {} };
    const p = fx.pairs || {};
    const take = (src, dst) => { if (src && Number(src.from) > 0 && Number(src.to) > 0) out.pairs[dst] = { from: Number(src.from), to: Number(src.to) }; };
    take(p.KL || p.KV || (Number(fx.krw) > 0 ? { from: fx.krw, to: fx.vnd } : null), 'KL');
    take(p.UL || p.UV, 'UL');
    take(p.KU, 'KU');
    return out;
  }

  function normalizeTrip(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('여행 형식이 올바르지 않아요');
    const start = isDate(raw.start) ? raw.start : null;
    const end = isDate(raw.end) ? raw.end : null;
    if (!start || !end || end < start) throw new Error('여행 기간이 올바르지 않아요');
    const t = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      name: String(raw.name || '이름 없는 여행').trim().slice(0, 40),
      city: String(raw.city || '').trim().slice(0, 40),
      country: String(raw.country || '').trim().slice(0, 40),
      start, end,
      currency: CURRENCIES.some(c => c.code === raw.currency) ? raw.currency : 'VND',
      stays: {},
      center: Array.isArray(raw.center) && raw.center.length === 2 && raw.center.every(Number.isFinite) ? raw.center : null,
      days: {},
      people: Array.isArray(raw.people) ? raw.people : [],
      expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
      fx: normFx(raw.fx),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
    };
    if (raw.fare && typeof raw.fare === 'object') t.fare = raw.fare;
    if (raw.sample === true) t.sample = true;
    if (raw.stays && typeof raw.stays === 'object') {
      Object.keys(raw.stays).forEach(d => {
        const s = raw.stays[d];
        if (isDate(d) && s && typeof s === 'object') t.stays[d] = { stay: s.stay ? String(s.stay).slice(0, 40) : null, note: String(s.note || '').slice(0, 30) };
      });
    }
    tripDates(t).forEach(d => { t.days[d] = []; });
    if (raw.days && typeof raw.days === 'object') {
      Object.keys(raw.days).forEach(d => { if (isDate(d)) t.days[d] = normItems(raw.days[d]); });
    }
    return t;
  }

  // ---------- 예전 푸꾸옥 데이터 → 여행 1개 ----------
  const PQ_STAYS = {
    '2026-12-10': { stay: '인터컨티넨탈 푸꾸옥', note: '도착' },
    '2026-12-11': { stay: '인터컨티넨탈 푸꾸옥', note: '' },
    '2026-12-12': { stay: '인터컨티넨탈 푸꾸옥', note: '' },
    '2026-12-13': { stay: '그린베이', note: '숙소 이동' },
    '2026-12-14': { stay: null, note: '귀국' },
  };
  function fromLegacy(old) {
    return normalizeTrip({
      id: 'phuquoc-2026',
      name: '푸꾸옥 여행', city: '푸꾸옥', country: '베트남',
      start: '2026-12-10', end: '2026-12-14', currency: 'VND',
      stays: PQ_STAYS, center: [10.22, 103.96],
      days: old.days, people: old.people, expenses: old.expenses, fx: old.fx, fare: old.fare, sample: old.sample,
    });
  }

  // ---------- 저장 ----------
  let db = { version: 2, trips: [], lastTripId: null, ui: {} };
  let migrated = false;

  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) { raw = null; }
    if (raw && Array.isArray(raw.trips)) {
      db = { version: 2, trips: [], lastTripId: raw.lastTripId || null, ui: raw.ui && typeof raw.ui === 'object' ? raw.ui : {} };
      raw.trips.forEach(t => { try { db.trips.push(normalizeTrip(t)); } catch (e) { console.warn('여행 읽기 실패', e); } });
      return;
    }
    // 새 저장값이 없으면 예전 푸꾸옥 데이터를 변환
    try {
      const old = JSON.parse(localStorage.getItem(LEGACY_KEY));
      if (old && old.days) {
        const t = fromLegacy(old);
        db.trips = [t];
        db.lastTripId = t.id;
        try { const ui = JSON.parse(localStorage.getItem(LEGACY_UI)); if (ui && ui.day) db.ui[t.id] = { day: ui.day }; } catch (e) { /* noop */ }
        migrated = true;
        save();
      }
    } catch (e) { console.warn('예전 데이터 변환 실패', e); }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- 여행 조작 ----------
  function create(info) {
    const t = normalizeTrip(Object.assign({ id: uid(), createdAt: Date.now() }, info));
    db.trips.push(t);
    save();
    return t;
  }
  function remove(id) {
    db.trips = db.trips.filter(t => t.id !== id);
    if (db.lastTripId === id) db.lastTripId = null;
    delete db.ui[id];
    save();
  }
  function get(id) { return db.trips.find(t => t.id === id) || null; }
  // 일정만 복사 (지출 제외, 새 id)
  function duplicate(id) {
    const src = get(id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.name = (src.name + ' (복사)').slice(0, 40);
    copy.expenses = [];
    copy.createdAt = copy.updatedAt = Date.now();
    delete copy.sample;
    Object.keys(copy.days).forEach(d => { copy.days[d] = copy.days[d].map(it => Object.assign({}, it, { id: uid() })); });
    const t = normalizeTrip(copy);
    db.trips.push(t);
    save();
    return t;
  }
  // 기간을 바꾸면 새 날짜 칸을 만들고, 기존 일정은 그대로 둠 (기간 밖이면 '기타'로 보임)
  function updateInfo(id, info) {
    const t = get(id);
    if (!t) return null;
    ['name', 'city', 'country', 'start', 'end'].forEach(k => { if (info[k] !== undefined) t[k] = info[k]; });
    if (info.currency && info.currency !== t.currency) {
      t.currency = info.currency;
      delete t.fare;         // 요금 기준은 새 통화 기본값으로
      t.fx = { mode: t.fx && t.fx.mode, pairs: t.fx && t.fx.pairs && t.fx.pairs.KU ? { KU: t.fx.pairs.KU } : {} };
    }
    if (info.city !== undefined || info.country !== undefined) t.center = info.center || null;
    tripDates(t).forEach(d => { if (!t.days[d]) t.days[d] = []; });
    t.updatedAt = Date.now();
    save();
    return t;
  }

  // ---------- 내보내기 / 가져오기 ----------
  const APP = 'trip-planner';
  function exportTrip(id) {
    const t = get(id);
    return JSON.stringify({ app: APP, kind: 'trip', version: 2, exportedAt: new Date().toISOString(), trip: t }, null, 2);
  }
  function exportAll() {
    return JSON.stringify({ app: APP, kind: 'backup', version: 2, exportedAt: new Date().toISOString(), trips: db.trips }, null, 2);
  }
  // 반환: { kind: 'trip', trip } | { kind: 'backup', trips }
  function parseImport(text) {
    const raw = JSON.parse(text);
    if (raw && raw.kind === 'backup' && Array.isArray(raw.trips)) {
      const trips = [];
      raw.trips.forEach(t => { try { trips.push(normalizeTrip(t)); } catch (e) { /* 건너뜀 */ } });
      if (!trips.length) throw new Error('백업에 여행이 없어요');
      return { kind: 'backup', trips };
    }
    if (raw && raw.kind === 'trip' && raw.trip) return { kind: 'trip', trip: normalizeTrip(raw.trip) };
    if (raw && raw.start && raw.end && raw.days) return { kind: 'trip', trip: normalizeTrip(raw) };
    if (raw && raw.days) return { kind: 'trip', trip: fromLegacy(raw) }; // 예전 푸꾸옥 앱 내보내기 파일
    throw new Error('여행 파일 형식이 아니에요');
  }
  function addImported(trip, replace) {
    if (replace) {
      const i = db.trips.findIndex(t => t.id === trip.id);
      if (i >= 0) db.trips[i] = trip; else db.trips.push(trip);
    } else {
      if (get(trip.id)) trip.id = uid();
      db.trips.push(trip);
    }
    save();
    return trip;
  }
  function restoreAll(trips) {
    db.trips = trips;
    db.lastTripId = null;
    db.ui = {};
    save();
  }

  load();

  window.TripStore = {
    CURRENCIES, curOf, tripDates, status, todayISO, diffDays, addDays, uid,
    get trips() { return db.trips; },
    get lastTripId() { return db.lastTripId; },
    set lastTripId(id) { db.lastTripId = id; save(); },
    uiFor: id => (db.ui[id] = db.ui[id] || {}),
    get migrated() { return migrated; },
    save, get, create, remove, duplicate, updateInfo,
    exportTrip, exportAll, parseImport, addImported, restoreAll,
    // 여행이 하나도 없을 때 화면이 깨지지 않게 쓰는 빈 여행 (저장 안 됨)
    blank: () => normalizeTrip({ id: '__blank__', name: '', start: todayISO(), end: todayISO(), currency: 'VND' }),
  };
})();
