/* 여행 플래너 – 환전 탭 (현지 통화 ↔ KRW ↔ USD, 여행별) */
(function () {
  'use strict';
  const PQ = window.PQ;
  const TS = window.TripStore;
  const $ = sel => document.querySelector(sel);

  const API = 'https://open.er-api.com/v6/latest/KRW'; // rates[통화] = 1원당 그 통화
  const CACHE_KEY = 'pq-fx-cache-v1';
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ---------- 숫자 입력 ----------
  const UNITS = { k: 1e3, m: 1e6, '천': 1e3, '만': 1e4 };

  // "150k" → 150000, "1.5m" → 1500000, "50만" → 500000, "1,234" → 1234
  function parseAmount(text) {
    const s = String(text).replace(/[,\s₫원$€£¥฿₱₭៛]/g, '').toLowerCase();
    const m = s.match(/^(\d*\.?\d*)(k|m|천|만)?$/);
    if (!m || !m[1] || m[1] === '.') return null;
    const n = parseFloat(m[1]) * (m[2] ? UNITS[m[2]] : 1);
    return Number.isFinite(n) ? n : null;
  }
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  function fmtNum(code, n) {
    const c = TS.curOf(code);
    if (!c.dec) return fmt(n);
    const r = Math.round(n * 100) / 100;
    return r.toLocaleString('en-US', { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  // 금액 + 통화 표시: 150,000₫ / 8,000원 / $12.50 / ฿350
  function fmtCur(amount, code) {
    const c = TS.curOf(code);
    if (code === 'KRW') return fmt(amount) + '원';
    if (code === 'VND') return fmt(amount) + '₫';
    return c.sym + fmtNum(code, amount);
  }

  // 입력 중 콤마 넣기. 단위(k/m/만)를 치면 바로 숫자로 바꿈. 커서 위치는 숫자 개수 기준으로 유지
  function formatLive(input, allowUnitsOpt) {
    const allowUnits = typeof allowUnitsOpt === 'function' ? allowUnitsOpt() : allowUnitsOpt;
    const raw = input.value;
    const caret = input.selectionStart == null ? raw.length : input.selectionStart;
    let out;
    const cleaned = raw.replace(/[,\s]/g, '');
    if (allowUnits && /^\d*\.?\d+(k|m|천|만)$/i.test(cleaned)) {
      out = fmt(parseAmount(cleaned));
      input.value = out;
      input.setSelectionRange(out.length, out.length);
      return;
    }
    const m = cleaned.match(/^(\d*)(\.\d*)?$/);
    if (!m) {
      if (allowUnits && /^\d*\.?\d*(k|m|천|만)?$/i.test(cleaned)) return; // 단위 입력 중
      out = cleaned.replace(/[^\d.]/g, '');
    } else {
      const int = m[1].replace(/^0+(?=\d)/, '');
      out = (int ? Number(int).toLocaleString('en-US') : (m[2] ? '0' : '')) + (m[2] || '');
    }
    const digitsBefore = raw.slice(0, caret).replace(/[^\d.]/g, '').length;
    input.value = out;
    let pos = 0, seen = 0;
    while (pos < out.length && seen < digitsBefore) { if (/[\d.]/.test(out[pos])) seen++; pos++; }
    input.setSelectionRange(pos, pos);
  }

  // 한글 입력(예: "만") 조합 중에는 손대지 않고, 조합이 끝나면 정리
  function bindAmount(input, allowUnits, onChange) {
    const run = () => { formatLive(input, allowUnits); if (onChange) onChange(); };
    input.addEventListener('input', e => { if (!e.isComposing) run(); });
    input.addEventListener('compositionend', run);
  }

  // ---------- 환율 ----------
  // cache: { rates: {VND, USD, THB, ...}, fetchedAt }  (예전 형식 {rate, usd}도 읽음)
  let cache = null;
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cache && !cache.rates && cache.rate) cache = { rates: { VND: cache.rate, USD: cache.usd }, fetchedAt: cache.fetchedAt, partial: true };
  } catch (e) { cache = null; }
  let liveState = cache ? 'cached' : 'none'; // none | loading | ok | cached | failed

  // 1원당 code
  function perKrw(code) {
    if (code === 'KRW') return { r: 1, kind: 'live' };
    const live = cache && cache.rates && Number(cache.rates[code]);
    if (live > 0) return { r: live, kind: 'live' };
    return { r: TS.curOf(code).fb, kind: 'fallback' };
  }

  // 내 환전 환율 쌍: KL(원→현지), UL(달러→현지), KU(원→달러)
  const PAIRS = { KL: ['KRW', 'LOCAL'], UL: ['USD', 'LOCAL'], KU: ['KRW', 'USD'] };
  const resolve = (x, local) => (x === 'LOCAL' ? local : x);

  // trip 기준으로 a 1단위 = b 몇 단위인지. { r, kind: manual | live | fallback }
  function pairFor(trip, a, b) {
    if (a === b) return { r: 1, kind: 'live' };
    const fx = (trip && trip.fx) || {};
    const local = (trip && trip.currency) || 'VND';
    if (fx.mode === 'manual' && fx.pairs) {
      for (const [k, [f, t]] of Object.entries(PAIRS)) {
        const m = fx.pairs[k];
        if (!m) continue;
        const from = resolve(f, local), to = resolve(t, local);
        if (from === to) continue;
        if (from === a && to === b) return { r: m.to / m.from, kind: 'manual' };
        if (from === b && to === a) return { r: m.from / m.to, kind: 'manual' };
      }
    }
    const pa = perKrw(a), pb = perKrw(b);
    return { r: pb.r / pa.r, kind: pa.kind === 'fallback' || pb.kind === 'fallback' ? 'fallback' : 'live' };
  }
  const pair = (a, b) => pairFor(PQ.state, a, b);

  async function refreshLive(force) {
    const fresh = cache && !cache.partial && Date.now() - cache.fetchedAt < DAY_MS;
    if (!force && fresh) return;
    liveState = 'loading';
    renderRate();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(API, { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || j.result !== 'success' || !j.rates || !(Number(j.rates.USD) > 0)) throw new Error('no rate');
      const rates = {};
      TS.CURRENCIES.forEach(c => { const v = Number(j.rates[c.code]); if (v > 0) rates[c.code] = v; });
      cache = { rates, fetchedAt: Date.now(), apiUpdated: (j.time_last_update_unix || 0) * 1000 };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* noop */ }
      liveState = 'ok';
    } catch (e) {
      liveState = 'failed';
    } finally {
      clearTimeout(t);
    }
    recalc();
    renderRate();
    PQ.render(); // 정산·그랩 요금의 원화 환산도 갱신
  }

  function fmtTime(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ---------- 화면 구성 (여행 통화에 맞춰) ----------
  const local = () => PQ.state.currency || 'VND';
  // 칸: 현지 / 원 / 달러 (현지가 원이나 달러면 겹치는 칸 숨김)
  function fieldCodes() {
    return [...new Set([local(), 'KRW', 'USD'])];
  }
  // 빠른 버튼 라벨: 10만 동, 500 바트, $10
  function quickLabel(code, v) {
    const c = TS.curOf(code);
    if (code === 'USD') return fmtNum(code, v); // 입력칸에 $가 있어서 버튼엔 숫자만
    if (['SGD', 'AUD', 'HKD', 'TWD', 'EUR', 'GBP', 'MYR', 'CNY'].includes(code)) return c.sym + fmtNum(code, v);
    if (v >= 10000 && v % 10000 === 0) return `${fmt(v / 10000)}만 ${c.unit}`;
    return `${fmt(v)} ${c.unit}`;
  }

  function setupFields() {
    const L = local();
    const c = TS.curOf(L);
    $('#fxLocalCode').textContent = c.code;
    $('#fxLocalName').textContent = c.name;
    $('#fxLocalUnit').textContent = c.code === 'VND' ? '₫' : c.unit;
    $('#fxRowKrw').hidden = L === 'KRW';
    $('#fxRowUsd').hidden = L === 'USD';
    $('#fxQuickUsd').hidden = L === 'USD';
    $('#fxQuickLocal').innerHTML = c.q.map(v => `<button type="button" data-cur="${L}" data-v="${v}">${quickLabel(L, v)}</button>`).join('');
    $('#fxQuickLocal').classList.toggle('four', c.q.length === 4);
    $('#fxTip').textContent = c.dec
      ? `150k = 150,000${c.unit}처럼 k·만 단위도 돼요`
      : `150k = 150,000${c.unit}, 50만 = 500,000${c.unit}으로 입력돼요`;
    // 내 환율 입력칸 라벨
    $('#pairKL').hidden = L === 'KRW';
    $('#pairUL').hidden = L === 'USD';
    $('#pairKLt').textContent = `원 → ${c.unit}`;
    $('#pairULt').textContent = `달러 → ${c.unit}`;
    $('#mKL_toL').firstChild.textContent = `받은 ${c.unit}`;
    $('#mUL_toL').firstChild.textContent = `받은 ${c.unit}`;
    ['vnd', 'krw', 'usd'].forEach(k => { inputOf(k).value = ''; });
  }

  // 입력칸: 첫 칸은 현지 통화 (id는 예전 그대로 fxVnd), 원, 달러
  const inputOf = k => $(k === 'vnd' ? '#fxVnd' : k === 'krw' ? '#fxKrw' : '#fxUsd');
  const codeOfField = k => (k === 'vnd' ? local() : k === 'krw' ? 'KRW' : 'USD');

  function renderRate() {
    const trip = PQ.state;
    const wantManual = trip.fx && trip.fx.mode === 'manual';
    $('#fxModeLive').classList.toggle('on', !wantManual);
    $('#fxModeManual').classList.toggle('on', wantManual);
    $('#fxModeLive').setAttribute('aria-selected', String(!wantManual));
    $('#fxModeManual').setAttribute('aria-selected', String(wantManual));
    $('#fxManual').hidden = !wantManual;

    const L = local(), c = TS.curOf(L);
    const tag = p => p.kind === 'manual' ? '<span class="tag">내 환율</span>' : p.kind === 'fallback' ? '<span class="tag">대략값</span>' : '';
    const rows = [];
    if (L !== 'KRW') {
      const kl = pair('KRW', L);
      // 원 기준으로 보기 좋은 단위: 동처럼 큰 통화는 1만 원, 작은 통화는 1,000원
      const base = kl.r >= 1 ? 10000 : 1000;
      rows.push(`<li><span>${fmt(base)}원</span><b>${fmtNum(L, kl.r * base)} ${c.unit}${tag(kl)}</b></li>`);
    }
    if (L !== 'USD') {
      const ul = pair('USD', L);
      rows.push(`<li><span>1달러</span><b>${fmtNum(L, ul.r)} ${c.unit}${tag(ul)}</b></li>`);
    }
    if (L !== 'KRW' && L !== 'USD') {
      const uk = pair('USD', 'KRW');
      rows.push(`<li><span>1달러</span><b>${fmt(uk.r)}원${tag(uk)}</b></li>`);
    } else {
      const uk = pair('USD', 'KRW');
      rows.push(`<li><span>1달러</span><b>${fmt(uk.r)}원${tag(uk)}</b></li>`);
    }
    $('#fxRates').innerHTML = rows.join('');

    const st = $('#fxStatus');
    st.classList.remove('warn');
    const usedPairs = wantManual && trip.fx.pairs ? Object.keys(trip.fx.pairs).filter(k => !(k === 'KL' && L === 'KRW') && !(k === 'UL' && L === 'USD')) : [];
    const anyFallback = perKrw(L).kind === 'fallback' || perKrw('USD').kind === 'fallback';
    let msg;
    if (liveState === 'loading') {
      msg = '환율 불러오는 중…';
    } else if (anyFallback) {
      msg = `실시간 환율을 불러오지 못해 대략값을 쓰고 있어요. 인터넷 연결 후 새로고침하거나 내 환전 환율을 넣어주세요.`;
      st.classList.add('warn');
    } else {
      const when = fmtTime(cache.fetchedAt);
      msg = liveState === 'failed'
        ? `새 환율을 못 받아 ${when}에 저장한 환율을 쓰고 있어요`
        : `${when} 갱신`;
      if (liveState === 'failed') st.classList.add('warn');
    }
    if (wantManual) {
      const label = { KL: `원 → ${c.unit}`, UL: `달러 → ${c.unit}`, KU: '원 → 달러' };
      msg = usedPairs.length ? `내 환율 적용: ${usedPairs.map(k => label[k]).join(', ')}` : '아래에 환전 금액을 넣으면 그 환율로 계산해요.';
    }
    st.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = msg;
    st.appendChild(span);
    if (liveState !== 'loading') {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '새로고침';
      b.addEventListener('click', () => refreshLive(true));
      st.appendChild(b);
    }
    renderTable();
  }

  // 자주 보는 금액: 원화 1천~10만 원 근처의 깔끔한 현지 금액
  function niceRound(v) {
    if (v <= 0) return 0;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const step = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
    return step * p;
  }
  function renderTable() {
    const L = local();
    const codes = fieldCodes();
    const toL = pair('KRW', L).r;
    const rows = [...new Set([1000, 5000, 10000, 30000, 50000, 100000].map(k => niceRound(k * toL)))];
    const head = codes.map(code => `<th>${code === 'KRW' ? '원' : code === 'USD' ? '달러' : TS.curOf(code).unit}</th>`).join('');
    $('#fxTable').innerHTML = `<tr>${head}</tr>` + rows.map(v => `<tr data-v="${v}">${codes.map(code =>
      `<td>${code === L ? fmtNum(code, v) : code === 'USD' ? '$' + fmtNum('USD', v * pair(L, 'USD').r) : fmtNum(code, v * pair(L, code).r)}</td>`).join('')}</tr>`).join('');
  }

  // ---------- 3방향 변환 ----------
  let source = 'vnd'; // 마지막으로 입력한 칸 (vnd=현지 칸)
  function recalc() {
    const v = parseAmount(inputOf(source).value);
    const from = codeOfField(source);
    ['vnd', 'krw', 'usd'].forEach(k => {
      if (k === source) return;
      const to = codeOfField(k);
      inputOf(k).value = v === null ? '' : fmtNum(to, v * pair(from, to).r);
    });
  }

  ['vnd', 'krw', 'usd'].forEach(k => {
    const inp = inputOf(k);
    bindAmount(inp, () => TS.curOf(codeOfField(k)).dec === 0, () => { source = k; recalc(); });
    inp.addEventListener('blur', () => { const v = parseAmount(inp.value); if (v !== null) inp.value = fmtNum(codeOfField(k), v); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });

  function setAmount(code, v) {
    const k = code === local() ? 'vnd' : code === 'KRW' ? 'krw' : 'usd';
    source = k;
    inputOf(k).value = fmtNum(code, v);
    recalc();
  }
  document.querySelector('.fx-card').addEventListener('click', e => {
    const b = e.target.closest('.fx-quick button[data-v]');
    if (b) setAmount(b.dataset.cur, Number(b.dataset.v));
  });
  $('#fxTable').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-v]');
    if (tr) { setAmount(local(), Number(tr.dataset.v)); $('#screen').scrollTop = 0; }
  });

  // ---------- 모드 / 내 환율 ----------
  function setMode(mode) {
    PQ.state.fx = Object.assign({ pairs: {} }, PQ.state.fx, { mode });
    PQ.save();
    if (mode === 'manual') fillManual();
    recalc();
    renderRate();
    PQ.render();
  }
  $('#fxModeLive').addEventListener('click', () => setMode('live'));
  $('#fxModeManual').addEventListener('click', () => setMode('manual'));

  function fillManual() {
    const pairs = (PQ.state.fx && PQ.state.fx.pairs) || {};
    const L = local();
    Object.keys(PAIRS).forEach(k => {
      const p = pairs[k];
      const [f, t] = PAIRS[k].map(x => resolve(x, L));
      $(`#m${k}_from`).value = p ? fmtNum(f, p.from) : '';
      $(`#m${k}_to`).value = p ? fmtNum(t, p.to) : '';
    });
  }
  Object.keys(PAIRS).forEach(k => {
    const [f, t] = PAIRS[k];
    bindAmount($(`#m${k}_from`), () => TS.curOf(resolve(f, local())).dec === 0);
    bindAmount($(`#m${k}_to`), () => TS.curOf(resolve(t, local())).dec === 0);
  });
  $('#fxSaveManual').addEventListener('click', () => {
    const L = local(), c = TS.curOf(L);
    const label = { KL: `원 → ${c.unit}`, UL: `달러 → ${c.unit}`, KU: '원 → 달러' };
    const pairs = {};
    for (const [k, [f, t]] of Object.entries(PAIRS)) {
      const from = resolve(f, L), to = resolve(t, L);
      if (from === to) continue;
      const a = parseAmount($(`#m${k}_from`).value);
      const b = parseAmount($(`#m${k}_to`).value);
      if (a === null && b === null) continue; // 비운 쌍은 실시간 환율
      if (!(a > 0) || !(b > 0)) { PQ.toast(`${label[k]}: 낸 금액과 받은 금액을 모두 넣으세요`); return; }
      // 대략 환율의 1/3 ~ 3배를 벗어나면 확인 요청
      const ref = TS.curOf(to).fb / TS.curOf(from).fb;
      const r = b / a;
      if (r < ref / 3 || r > ref * 3) {
        PQ.toast(`${label[k]}: 1${from === 'KRW' ? '원' : from === 'USD' ? '달러' : TS.curOf(from).unit} = ${fmtNum(to, r)}${to === 'KRW' ? '원' : to === 'USD' ? '달러' : TS.curOf(to).unit}이 맞는지 확인하세요`);
        return;
      }
      pairs[k] = { from: a, to: b };
    }
    PQ.state.fx = { mode: 'manual', pairs };
    PQ.save();
    fillManual();
    recalc();
    renderRate();
    PQ.render();
    PQ.toast(Object.keys(pairs).length ? '내 환전 환율로 계산해요' : '입력한 환율이 없어 실시간 환율로 계산해요');
  });

  // 다른 탭(그랩 요금, 정산, 여행 목록)에서 쓰기
  PQ.fx = {
    parseAmount, bindAmount, fmt, fmtNum, fmtCur,
    rate: () => { const p = pair('KRW', local()); return { rate: p.r, kind: p.kind }; }, // 1원당 현지 통화
    convert: (amount, from, to) => amount * pair(from, to).r,
    convertFor: (trip, amount, from, to) => amount * pairFor(trip, from, to).r,
    toKrw: (amount, code) => amount * pair(code || local(), 'KRW').r,
    fmtKrw: (amount, code) => fmt(amount * pair(code || local(), 'KRW').r) + '원',
  };

  // 탭 열 때, 여행 바꿀 때, 데이터 바뀔 때 갱신
  const refreshUI = () => { setupFields(); fillManual(); recalc(); renderRate(); };
  document.addEventListener('pq:tab', e => { if (e.detail === 'fx') { refreshUI(); refreshLive(false); } });
  document.addEventListener('pq:trip', refreshUI);
  PQ.onRender(() => { if ($('#tab-fx').classList.contains('active')) { recalc(); renderRate(); } });

  refreshUI();
  refreshLive(false); // 하루 지났으면 갱신
})();
