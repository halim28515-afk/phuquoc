/* 푸꾸옥 여행 앱 – 환전 탭 (VND ↔ KRW ↔ USD) */
(function () {
  'use strict';
  const PQ = window.PQ;
  const $ = sel => document.querySelector(sel);

  const API = 'https://open.er-api.com/v6/latest/KRW'; // rates.VND = 1원당 동, rates.USD = 1원당 달러
  const CACHE_KEY = 'pq-fx-cache-v1';
  const DAY_MS = 24 * 60 * 60 * 1000;
  // 네트워크도 캐시도 없을 때 쓰는 대략값
  const FALLBACK = { VND: 18.5, USD: 1 / 1400 }; // 1원 ≈ 18.5동, 1달러 ≈ 1,400원

  const CURS = ['vnd', 'krw', 'usd'];
  const CODE = { vnd: 'VND', krw: 'KRW', usd: 'USD' };

  // ---------- 숫자 입력 ----------
  const UNITS = { k: 1e3, m: 1e6, '천': 1e3, '만': 1e4 };

  // "150k" → 150000, "1.5m" → 1500000, "50만" → 500000, "1,234" → 1234
  function parseAmount(text) {
    const s = String(text).replace(/[,\s₫원$]/g, '').toLowerCase();
    const m = s.match(/^(\d*\.?\d*)(k|m|천|만)?$/);
    if (!m || !m[1] || m[1] === '.') return null;
    const n = parseFloat(m[1]) * (m[2] ? UNITS[m[2]] : 1);
    return Number.isFinite(n) ? n : null;
  }
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  // 달러: 센트까지, 정수면 소수점 없이
  const fmtUsdNum = n => {
    const r = Math.round(n * 100) / 100;
    return r.toLocaleString('en-US', { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 });
  };
  const fmtIn = (cur, n) => (cur === 'usd' ? fmtUsdNum(n) : fmt(n));

  // 입력 중 콤마 넣기. 단위(k/m/만)를 치면 바로 숫자로 바꿈. 커서 위치는 숫자 개수 기준으로 유지
  function formatLive(input, allowUnits) {
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
  let cache = null; // { rate(=VND/원), usd(=USD/원), fetchedAt }
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { cache = null; }
  let liveState = cache ? 'cached' : 'none'; // none | loading | ok | cached | failed

  // 내 환전 환율: 쌍마다 { from: 낸 금액, to: 받은 금액 }
  const PAIRS = {
    KV: { from: 'krw', to: 'vnd', label: '원 → 동', range: [5, 50] },
    UV: { from: 'usd', to: 'vnd', label: '달러 → 동', range: [15000, 40000] },
    KU: { from: 'krw', to: 'usd', label: '원 → 달러', range: [1 / 2500, 1 / 900] },
  };
  function settings() {
    const f = PQ.state.fx || {};
    const pairs = {};
    const src = f.pairs || {};
    // 예전 형식({krw, vnd})도 원 → 동 쌍으로 읽음
    const old = Number(f.krw) > 0 && Number(f.vnd) > 0 ? { from: Number(f.krw), to: Number(f.vnd) } : null;
    Object.keys(PAIRS).forEach(k => {
      const p = src[k] || (k === 'KV' ? old : null);
      if (p && Number(p.from) > 0 && Number(p.to) > 0) pairs[k] = { from: Number(p.from), to: Number(p.to) };
    });
    return { wantManual: f.mode === 'manual', pairs };
  }

  function liveRates() {
    if (cache && cache.rate > 0) {
      return { VND: cache.rate, USD: cache.usd > 0 ? cache.usd : FALLBACK.USD, kind: 'live', usdKind: cache.usd > 0 ? 'live' : 'fallback' };
    }
    return { VND: FALLBACK.VND, USD: FALLBACK.USD, kind: 'fallback', usdKind: 'fallback' };
  }

  // a 1단위 = b 몇 단위인지. { r, kind: manual | live | fallback }
  function pair(a, b) {
    if (a === b) return { r: 1, kind: 'live' };
    const s = settings();
    if (s.wantManual) {
      for (const [k, p] of Object.entries(PAIRS)) {
        const m = s.pairs[k];
        if (!m) continue;
        if (p.from === a && p.to === b) return { r: m.to / m.from, kind: 'manual' };
        if (p.from === b && p.to === a) return { r: m.from / m.to, kind: 'manual' };
      }
    }
    const L = liveRates();
    const perKrw = { krw: 1, vnd: L.VND, usd: L.USD };
    const kind = (a === 'usd' || b === 'usd') ? (L.usdKind === 'live' && L.kind === 'live' ? 'live' : 'fallback') : L.kind;
    return { r: perKrw[b] / perKrw[a], kind };
  }

  async function refreshLive(force) {
    const fresh = cache && cache.usd > 0 && Date.now() - cache.fetchedAt < DAY_MS;
    if (!force && fresh) return;
    liveState = 'loading';
    renderRate();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(API, { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const vnd = j && j.result === 'success' && j.rates && Number(j.rates.VND);
      const usd = j && j.rates && Number(j.rates.USD);
      if (!(vnd > 0) || !(usd > 0)) throw new Error('no rate');
      cache = { rate: vnd, usd, fetchedAt: Date.now(), apiUpdated: (j.time_last_update_unix || 0) * 1000 };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* noop */ }
      liveState = 'ok';
    } catch (e) {
      liveState = 'failed';
    } finally {
      clearTimeout(t);
    }
    recalc();
    renderRate();
  }

  function fmtTime(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function renderRate() {
    const s = settings();
    $('#fxModeLive').classList.toggle('on', !s.wantManual);
    $('#fxModeManual').classList.toggle('on', s.wantManual);
    $('#fxModeLive').setAttribute('aria-selected', String(!s.wantManual));
    $('#fxModeManual').setAttribute('aria-selected', String(s.wantManual));
    $('#fxManual').hidden = !s.wantManual;

    const kv = pair('krw', 'vnd'), uv = pair('usd', 'vnd'), uk = pair('usd', 'krw');
    const tag = p => p.kind === 'manual' ? '<span class="tag">내 환율</span>' : p.kind === 'fallback' ? '<span class="tag">대략값</span>' : '';
    $('#fxRates').innerHTML = `
      <li><span>1만 원</span><b>${fmt(kv.r * 10000)}동${tag(kv)}</b></li>
      <li><span>1달러</span><b>${fmt(uv.r)}동${tag(uv)}</b></li>
      <li><span>1달러</span><b>${fmt(uk.r)}원${tag(uk)}</b></li>`;

    const st = $('#fxStatus');
    st.classList.remove('warn');
    const L = liveRates();
    const used = Object.keys(s.pairs).map(k => PAIRS[k].label);
    let msg;
    if (liveState === 'loading') {
      msg = '환율 불러오는 중…';
    } else if (L.kind === 'fallback') {
      msg = '실시간 환율을 불러오지 못해 대략값(1원 ≈ 18.5동, 1달러 ≈ 1,400원)을 쓰고 있어요. 인터넷 연결 후 새로고침하거나 내 환전 환율을 넣어주세요.';
      st.classList.add('warn');
    } else {
      const when = fmtTime(cache.fetchedAt);
      msg = liveState === 'failed'
        ? `새 환율을 못 받아 ${when}에 저장한 환율을 쓰고 있어요`
        : `open.er-api.com · ${when} 받음 · 하루 1번 갱신`;
      if (liveState === 'failed') st.classList.add('warn');
    }
    if (s.wantManual) {
      msg = (used.length ? `내 환율 적용: ${used.join(', ')}. 나머지는 ` : '아래에 환전 금액을 넣으면 그 환율로 계산해요. 지금은 ') + msg;
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

  function renderTable() {
    const rows = [10000, 20000, 50000, 100000, 200000, 500000, 1000000];
    const vk = pair('vnd', 'krw').r, vu = pair('vnd', 'usd').r;
    $('#fxTable').innerHTML = '<tr><th>동</th><th>원</th><th>달러</th></tr>' +
      rows.map(v => `<tr data-vnd="${v}"><td>${fmt(v)}</td><td>${fmt(v * vk)}</td><td>$${fmtUsdNum(v * vu)}</td></tr>`).join('');
  }

  // ---------- 3방향 변환 ----------
  let source = 'vnd'; // 마지막으로 입력한 칸
  const inputOf = c => $('#fx' + c[0].toUpperCase() + c.slice(1));
  function recalc() {
    const v = parseAmount(inputOf(source).value);
    CURS.forEach(c => {
      if (c === source) return;
      inputOf(c).value = v === null ? '' : fmtIn(c, v * pair(source, c).r);
    });
  }

  CURS.forEach(c => {
    const inp = inputOf(c);
    bindAmount(inp, c !== 'usd', () => { source = c; recalc(); });
    inp.addEventListener('blur', () => { const v = parseAmount(inp.value); if (v !== null) inp.value = fmtIn(c, v); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });

  function setAmount(cur, v) {
    source = cur;
    inputOf(cur).value = fmtIn(cur, v);
    recalc();
  }
  document.querySelectorAll('.fx-quick button').forEach(b => b.addEventListener('click', () => setAmount(b.dataset.cur, Number(b.dataset.v))));
  $('#fxTable').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-vnd]');
    if (tr) { setAmount('vnd', Number(tr.dataset.vnd)); $('#screen').scrollTop = 0; }
  });

  // ---------- 모드 / 내 환율 ----------
  function setMode(mode) {
    PQ.state.fx = Object.assign({}, PQ.state.fx, { mode });
    PQ.save();
    if (mode === 'manual') fillManual();
    recalc();
    renderRate();
  }
  $('#fxModeLive').addEventListener('click', () => setMode('live'));
  $('#fxModeManual').addEventListener('click', () => setMode('manual'));

  function fillManual() {
    const s = settings();
    Object.keys(PAIRS).forEach(k => {
      const p = s.pairs[k];
      $(`#m${k}_from`).value = p ? fmtIn(PAIRS[k].from, p.from) : '';
      $(`#m${k}_to`).value = p ? fmtIn(PAIRS[k].to, p.to) : '';
    });
  }
  Object.keys(PAIRS).forEach(k => {
    bindAmount($(`#m${k}_from`), PAIRS[k].from !== 'usd');
    bindAmount($(`#m${k}_to`), PAIRS[k].to !== 'usd');
  });
  $('#fxSaveManual').addEventListener('click', () => {
    const pairs = {};
    for (const [k, p] of Object.entries(PAIRS)) {
      const a = parseAmount($(`#m${k}_from`).value);
      const b = parseAmount($(`#m${k}_to`).value);
      if (a === null && b === null) continue; // 비운 쌍은 실시간 환율
      if (!(a > 0) || !(b > 0)) { PQ.toast(`${p.label}: 낸 금액과 받은 금액을 모두 넣으세요`); return; }
      const r = b / a;
      if (r < p.range[0] || r > p.range[1]) {
        const shown = p.to === 'usd' ? `1달러 = ${fmt(a / b)}원` : `1${p.from === 'usd' ? '달러' : '원'} = ${r < 100 ? r.toFixed(1) : fmt(r)}동`;
        PQ.toast(`${p.label}: ${shown}이 맞는지 확인하세요`);
        return;
      }
      pairs[k] = { from: a, to: b };
    }
    PQ.state.fx = { mode: 'manual', pairs };
    PQ.save();
    fillManual();
    recalc();
    renderRate();
    PQ.toast(Object.keys(pairs).length ? '내 환전 환율로 계산해요' : '입력한 환율이 없어 실시간 환율로 계산해요');
  });

  // 다른 탭(그랩 요금, 정산)에서 쓰기
  PQ.fx = {
    parseAmount, bindAmount, fmt,
    rate: () => { const p = pair('krw', 'vnd'); return { rate: p.r, kind: p.kind }; }, // 1원당 동
    convert: (amount, from, to) => amount * pair(from.toLowerCase(), to.toLowerCase()).r,
    toKrw: vnd => vnd * pair('vnd', 'krw').r,
    fmtKrw: vnd => fmt(vnd * pair('vnd', 'krw').r) + '원',
  };

  // 탭 열 때와 데이터 가져오기 후 갱신
  document.addEventListener('pq:tab', e => {
    if (e.detail === 'fx') { fillManual(); recalc(); renderRate(); refreshLive(false); }
  });
  PQ.onRender(() => { if ($('#tab-fx').classList.contains('active')) { recalc(); renderRate(); } });

  fillManual();
  renderRate();
  refreshLive(false); // 하루 지났거나 달러 환율이 없으면 갱신
})();
