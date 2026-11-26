/* 푸꾸옥 여행 앱 – 환전 탭 (VND ↔ KRW) */
(function () {
  'use strict';
  const PQ = window.PQ;
  const $ = sel => document.querySelector(sel);

  const API = 'https://open.er-api.com/v6/latest/KRW'; // rates.VND = 1원당 동
  const CACHE_KEY = 'pq-fx-cache-v1';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const FALLBACK_RATE = 18.5; // 네트워크도 캐시도 없을 때 쓰는 대략값 (1원 ≈ 18.5동)

  // ---------- 숫자 입력 ----------
  const UNITS = { k: 1e3, m: 1e6, '천': 1e3, '만': 1e4 };

  // "150k" → 150000, "1.5m" → 1500000, "50만" → 500000, "1,234" → 1234
  function parseAmount(text) {
    const s = String(text).replace(/[,\s₫원]/g, '').toLowerCase();
    const m = s.match(/^(\d*\.?\d*)(k|m|천|만)?$/);
    if (!m || !m[1] || m[1] === '.') return null;
    const n = parseFloat(m[1]) * (m[2] ? UNITS[m[2]] : 1);
    return Number.isFinite(n) ? n : null;
  }
  const fmt = n => Math.round(n).toLocaleString('ko-KR');

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
      // 숫자/점 외 문자는 버림 (단위 입력 중인 경우 제외)
      if (allowUnits && /^\d*\.?\d*(k|m|천|만)?$/i.test(cleaned)) return;
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

  // ---------- 환율 ----------
  let cache = null; // { rate, fetchedAt, apiUpdated }
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { cache = null; }
  let liveState = cache ? 'cached' : 'none'; // none | loading | ok | cached | failed

  function fxSettings() {
    const f = PQ.state.fx || {};
    const krw = Number(f.krw), vnd = Number(f.vnd);
    const manualOk = krw > 0 && vnd > 0;
    return { mode: f.mode === 'manual' && manualOk ? 'manual' : 'live', wantManual: f.mode === 'manual', krw, vnd, manualOk };
  }

  // 1원당 동
  function currentRate() {
    const s = fxSettings();
    if (s.mode === 'manual') return { rate: s.vnd / s.krw, kind: 'manual' };
    if (cache && cache.rate > 0) return { rate: cache.rate, kind: 'live' };
    return { rate: FALLBACK_RATE, kind: 'fallback' };
  }

  async function refreshLive(force) {
    if (!force && cache && Date.now() - cache.fetchedAt < DAY_MS) return;
    liveState = 'loading';
    renderRate();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(API, { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const rate = j && j.result === 'success' && j.rates && Number(j.rates.VND);
      if (!(rate > 0)) throw new Error('no VND rate');
      cache = { rate, fetchedAt: Date.now(), apiUpdated: (j.time_last_update_unix || 0) * 1000 };
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
    const s = fxSettings();
    const { rate, kind } = currentRate();
    $('#fxModeLive').classList.toggle('on', !s.wantManual);
    $('#fxModeManual').classList.toggle('on', s.wantManual);
    $('#fxModeLive').setAttribute('aria-selected', String(!s.wantManual));
    $('#fxModeManual').setAttribute('aria-selected', String(s.wantManual));
    $('#fxManual').hidden = !s.wantManual;

    $('#fxRateMain').innerHTML = `1만 원 = ${fmt(rate * 10000)}동<small>1,000동 = ${(1000 / rate).toFixed(1)}원 · 10만 동 = ${fmt(100000 / rate)}원</small>`;

    const st = $('#fxStatus');
    st.classList.remove('warn');
    let msg = '';
    if (kind === 'manual') {
      msg = `내 환전 환율: ${fmt(s.krw)}원 → ${fmt(s.vnd)}동`;
    } else if (s.wantManual && !s.manualOk) {
      msg = '아래에 환전 금액을 넣으면 그 환율로 계산해요. 지금은 실시간 환율로 계산 중이에요.';
    } else if (liveState === 'loading') {
      msg = '환율 불러오는 중…';
    } else if (kind === 'fallback') {
      msg = '환율을 불러오지 못해 대략값(1원 ≈ 18.5동)으로 계산 중이에요. 인터넷 연결 후 새로고침하거나 내 환전 환율을 넣어주세요.';
      st.classList.add('warn');
    } else {
      const when = fmtTime(cache.fetchedAt);
      msg = liveState === 'failed'
        ? `새 환율을 못 받아 ${when}에 저장한 환율을 쓰고 있어요`
        : `open.er-api.com · ${when} 받음 · 하루 1번 갱신`;
      if (liveState === 'failed') st.classList.add('warn');
    }
    st.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = msg;
    st.appendChild(span);
    if (kind !== 'manual' && liveState !== 'loading') {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '새로고침';
      b.addEventListener('click', () => refreshLive(true));
      st.appendChild(b);
    }
    renderTable(rate);
  }

  function renderTable(rate) {
    const rows = [10000, 20000, 50000, 100000, 200000, 500000, 1000000];
    $('#fxTable').innerHTML = rows.map(v => `<tr data-vnd="${v}"><td>${fmt(v)}동</td><td>${fmt(v / rate)}원</td></tr>`).join('');
  }

  // ---------- 양방향 변환 ----------
  let source = 'vnd'; // 마지막으로 입력한 칸
  function recalc() {
    const { rate } = currentRate();
    const vndIn = $('#fxVnd'), krwIn = $('#fxKrw');
    if (source === 'vnd') {
      const v = parseAmount(vndIn.value);
      krwIn.value = v === null ? '' : fmt(v / rate);
    } else {
      const k = parseAmount(krwIn.value);
      vndIn.value = k === null ? '' : fmt(k * rate);
    }
  }

  // 한글 입력(예: "만") 조합 중에는 손대지 않고, 조합이 끝나면 정리
  function bindAmount(input, allowUnits, onChange) {
    const run = () => { formatLive(input, allowUnits); if (onChange) onChange(); };
    input.addEventListener('input', e => { if (!e.isComposing) run(); });
    input.addEventListener('compositionend', run);
  }
  bindAmount($('#fxVnd'), true, () => { source = 'vnd'; recalc(); });
  bindAmount($('#fxKrw'), false, () => { source = 'krw'; recalc(); });
  // 포커스 잃을 때 소수점 등 정리
  $('#fxVnd').addEventListener('blur', e => { const v = parseAmount(e.target.value); if (v !== null) e.target.value = fmt(v); });
  $('#fxKrw').addEventListener('blur', e => { const v = parseAmount(e.target.value); if (v !== null) e.target.value = fmt(v); });
  [$('#fxVnd'), $('#fxKrw')].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); }));

  function setVnd(v) {
    source = 'vnd';
    $('#fxVnd').value = fmt(v);
    recalc();
  }
  document.querySelectorAll('.fx-quick button').forEach(b => b.addEventListener('click', () => setVnd(Number(b.dataset.vnd))));
  $('#fxTable').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-vnd]');
    if (tr) { setVnd(Number(tr.dataset.vnd)); $('#screen').scrollTop = 0; }
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
    const s = fxSettings();
    $('#fxPayKrw').value = s.krw > 0 ? fmt(s.krw) : '';
    $('#fxGotVnd').value = s.vnd > 0 ? fmt(s.vnd) : '';
  }
  bindAmount($('#fxPayKrw'), true);
  bindAmount($('#fxGotVnd'), true);
  $('#fxSaveManual').addEventListener('click', () => {
    const krw = parseAmount($('#fxPayKrw').value);
    const vnd = parseAmount($('#fxGotVnd').value);
    if (!(krw > 0) || !(vnd > 0)) { PQ.toast('낸 원화와 받은 동을 모두 입력하세요'); return; }
    const r = vnd / krw;
    if (r < 5 || r > 50) { PQ.toast(`1원 = ${r.toFixed(1)}동이 맞는지 확인하세요`); return; }
    PQ.state.fx = { mode: 'manual', krw: Math.round(krw), vnd: Math.round(vnd) };
    PQ.save();
    fillManual();
    recalc();
    renderRate();
    PQ.toast('내 환전 환율로 계산해요');
  });

  // 다른 탭(지도 요금 등)에서 쓰기
  PQ.fx = {
    toKrw: vnd => vnd / currentRate().rate,
    fmtKrw: vnd => fmt(vnd / currentRate().rate) + '원',
  };

  // 탭 열 때와 데이터 가져오기 후 갱신
  document.addEventListener('pq:tab', e => {
    if (e.detail === 'fx') { fillManual(); recalc(); renderRate(); refreshLive(false); }
  });
  PQ.onRender(() => { if ($('#tab-fx').classList.contains('active')) { recalc(); renderRate(); } });

  fillManual();
  renderRate();
  refreshLive(false); // 하루 지났으면 백그라운드 갱신
})();
