/* 푸꾸옥 여행 앱 – 동선 탭 */
(function () {
  'use strict';

  const STORAGE_KEY = 'pq-trip-v1';
  const UI_KEY = 'pq-ui-v1';

  // 여행 정보: 2026-12-10 ~ 12-14, 1~3박 인터컨티넨탈 푸꾸옥, 4박 그린베이
  const TRIP = [
    { date: '2026-12-10', stay: '인터컨티넨탈 푸꾸옥', note: '도착' },
    { date: '2026-12-11', stay: '인터컨티넨탈 푸꾸옥', note: '' },
    { date: '2026-12-12', stay: '인터컨티넨탈 푸꾸옥', note: '' },
    { date: '2026-12-13', stay: '그린베이', note: '숙소 이동' },
    { date: '2026-12-14', stay: null, note: '귀국' },
  ];
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  // 처음 열었을 때 보여줄 예시 일정 (좌표는 대략값)
  const SAMPLE = {
    '2026-12-10': [
      ['14:00', '푸꾸옥 국제공항 도착', '그랩으로 숙소 이동', 10.1698, 103.9931],
      ['15:30', '인터컨티넨탈 푸꾸옥 체크인', '', null, null],
      ['18:00', '선셋타운 키스브릿지', '일몰 + 불꽃쇼', 10.0255, 104.0137],
    ],
    '2026-12-11': [
      ['09:30', '혼텀 케이블카', '선월드 티켓 예약', 10.0295, 104.0090],
      ['15:00', '사오비치', '', 10.0546, 104.0362],
    ],
    '2026-12-12': [
      ['08:30', '남부 호핑투어 픽업', '수영복, 선크림', null, null],
    ],
    '2026-12-13': [
      ['11:00', '인터컨티넨탈 푸꾸옥 체크아웃', '', null, null],
      ['14:00', '그린베이 체크인', '', null, null],
      ['19:00', '즈엉동 야시장', '해산물 저녁', 10.2170, 103.9600],
    ],
    '2026-12-14': [
      ['10:00', '그린베이 체크아웃', '', null, null],
      ['12:00', '푸꾸옥 국제공항', '출국 2시간 전 도착', 10.1698, 103.9931],
    ],
  };

  // ---------- 저장소 ----------
  function emptyData() {
    const days = {};
    TRIP.forEach(d => { days[d.date] = []; });
    return { version: 1, days };
  }

  function sampleData() {
    const data = emptyData();
    data.sample = true;
    Object.keys(SAMPLE).forEach(date => {
      data.days[date] = SAMPLE[date].map(([time, place, memo, lat, lng]) => ({ id: uid(), time, place, memo, lat, lng }));
    });
    return data;
  }

  function normalize(raw) {
    const data = emptyData();
    if (!raw || typeof raw !== 'object' || !raw.days || typeof raw.days !== 'object') {
      throw new Error('형식이 올바르지 않아요');
    }
    Object.keys(raw.days).forEach(date => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(raw.days[date])) return;
      data.days[date] = raw.days[date]
        .filter(it => it && typeof it === 'object' && String(it.place || '').trim())
        .map(it => ({
          id: typeof it.id === 'string' && it.id ? it.id : uid(),
          time: /^\d{2}:\d{2}$/.test(it.time) ? it.time : '',
          place: String(it.place).trim().slice(0, 80),
          memo: String(it.memo || '').slice(0, 500),
          lat: toNum(it.lat),
          lng: toNum(it.lng),
        }));
    });
    if (raw.sample === true) data.sample = true;
    if (raw.fare && typeof raw.fare === 'object') data.fare = raw.fare; // 그랩 요금 설정 (map.js에서 검증)
    if (raw.fx && typeof raw.fx === 'object') data.fx = raw.fx;         // 환율 설정 (fx.js에서 검증)
    if (Array.isArray(raw.people)) data.people = raw.people;            // 정산 참여자 (settle.js에서 검증)
    if (Array.isArray(raw.expenses)) data.expenses = raw.expenses;      // 지출 내역 (settle.js에서 검증)
    return data;
  }

  function load() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? normalize(JSON.parse(s)) : sampleData();
    } catch (e) {
      console.warn('저장 데이터 읽기 실패', e);
      return sampleData();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('저장 실패: 브라우저 저장소를 쓸 수 없어요');
    }
  }

  function loadUI() {
    try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ day: currentDay })); } catch (e) { /* noop */ }
  }

  // ---------- 유틸 ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function dayInfo(date) {
    const [y, m, d] = date.split('-').map(Number);
    const wd = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    const idx = TRIP.findIndex(t => t.date === date);
    return { m, d, wd, idx, trip: TRIP[idx] };
  }
  function allDates() {
    const extra = Object.keys(state.days).filter(d => !TRIP.some(t => t.date === d)).sort();
    return TRIP.map(t => t.date).concat(extra);
  }
  function countAll(data) {
    return Object.values(data.days).reduce((s, l) => s + l.length, 0);
  }
  const $ = sel => document.querySelector(sel);

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // 브라우저 confirm() 대신 쓰는 화면 안 확인창
  function ask(message, okLabel, danger) {
    return new Promise(resolve => {
      $('#askMsg').textContent = message;
      const yes = $('#askYes');
      yes.textContent = okLabel || '확인';
      yes.classList.toggle('danger-fill', !!danger);
      const sheet = $('#askSheet');
      sheet.hidden = false;
      const done = v => {
        sheet.hidden = true;
        yes.onclick = $('#askNo').onclick = sheet.onclick = null;
        resolve(v);
      };
      yes.onclick = () => done(true);
      $('#askNo').onclick = () => done(false);
      sheet.onclick = e => { if (e.target === sheet) done(false); };
      yes.focus();
    });
  }

  // ---------- 상태 ----------
  let state = load();
  let currentDay = (function () {
    const today = new Date();
    const iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    if (state.days[iso]) return iso;
    const ui = loadUI();
    return ui.day && state.days[ui.day] ? ui.day : TRIP[0].date;
  })();
  let editingId = null;

  // ---------- 렌더 ----------
  function renderChips() {
    const html = allDates().map(date => {
      const { m, d, wd, idx } = dayInfo(date);
      const label = idx >= 0 ? 'Day ' + (idx + 1) : '기타';
      const n = (state.days[date] || []).length;
      return `<button class="chip${date === currentDay ? ' active' : ''}" data-date="${date}">
        <span class="d1">${label}${n ? `<span class="badge-n" aria-label="일정 ${n}개">${n}</span>` : ''}</span>
        <span class="d2">${m}/${d} (${wd})</span>
      </button>`;
    }).join('');
    // 동선 탭과 지도 탭이 같은 날짜 칩을 씀
    document.querySelectorAll('.day-chips').forEach(wrap => {
      wrap.innerHTML = html;
      const active = wrap.querySelector('.chip.active');
      if (active && wrap.clientWidth) {
        wrap.scrollLeft = active.offsetLeft - (wrap.clientWidth - active.offsetWidth) / 2;
      }
    });
  }

  function renderHead() {
    const { trip } = dayInfo(currentDay);
    const el = $('#dayHead');
    if (!trip) { el.innerHTML = '<span>여행 기간 외 날짜</span>'; return; }
    el.innerHTML = (trip.note ? `<span>${esc(trip.note)}</span>` : '') +
      (trip.stay ? `<span>🏨 숙박 <b>${esc(trip.stay)}</b></span>` : '<span>✈️ 체크아웃 · 공항</span>');
  }

  function renderCards() {
    const list = state.days[currentDay] || [];
    const ul = $('#cardList');
    ul.innerHTML = list.map((it, i) => {
      return `<li class="card" data-id="${esc(it.id)}">
        <div class="time${it.time ? '' : ' none'}">${it.time || '--:--'}</div>
        <div class="body">
          <div class="place">${esc(it.place)}</div>
          ${it.memo ? `<div class="memo">${esc(it.memo)}</div>` : ''}
          ${window.PQ && PQ.linkedSpent ? PQ.linkedSpent(it.id) : ''}
        </div>
        <div class="card-side">
          <button type="button" class="card-exp" data-exp="${esc(it.id)}" aria-label="이 일정에 지출 추가">💸</button>
          <div class="handle" aria-label="순서 변경">≡</div>
        </div>
      </li>`;
    }).join('');
    $('#emptyState').hidden = list.length > 0;
    $('#sampleBanner').hidden = !state.sample;
  }

  const renderHooks = [];
  function render() {
    renderChips();
    renderHead();
    renderCards();
    renderHooks.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }

  // ---------- 드래그 정렬 ----------
  function initSortable() {
    if (typeof Sortable === 'undefined') {
      console.warn('SortableJS 로드 실패 – 드래그 정렬 비활성화');
      return;
    }
    Sortable.create($('#cardList'), {
      handle: '.handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd(evt) {
        if (evt.oldIndex === evt.newIndex) return;
        const list = state.days[currentDay];
        const [moved] = list.splice(evt.oldIndex, 1);
        list.splice(evt.newIndex, 0, moved);
        save();
        renderCards();
      },
    });
  }

  // ---------- 시트 ----------
  function openSheet(id) { $(id).hidden = false; }
  function closeSheet(id) { $(id).hidden = true; }

  document.querySelectorAll('.sheet-backdrop:not(.center)').forEach(bd => {
    bd.addEventListener('click', e => {
      if (e.target === bd || e.target.closest('[data-close]')) bd.hidden = true;
    });
  });

  // ---------- 편집 ----------
  function openEditor(item) {
    editingId = item ? item.id : null;
    $('#editTitle').textContent = item ? '일정 수정' : '일정 추가';
    $('#btnDelete').hidden = !item;
    const sel = $('#fDate');
    sel.innerHTML = allDates().map(date => {
      const { m, d, wd, idx } = dayInfo(date);
      return `<option value="${date}">${idx >= 0 ? 'Day ' + (idx + 1) + ' · ' : ''}${m}/${d} (${wd})</option>`;
    }).join('');
    sel.value = currentDay;
    $('#fTime').value = item ? item.time : '';
    $('#fPlace').value = item ? item.place : '';
    $('#fMemo').value = item ? item.memo : '';
    $('#fLat').value = item && item.lat !== null ? item.lat : '';
    $('#fLng').value = item && item.lng !== null ? item.lng : '';
    const sr = $('#searchResults');
    if (sr) { sr.innerHTML = ''; sr.hidden = true; }
    openSheet('#editSheet');
    $('#editForm').scrollTop = 0;
    if (!item) setTimeout(() => $('#fPlace').focus(), 50);
  }

  function findItem(id) {
    for (const date of Object.keys(state.days)) {
      const i = state.days[date].findIndex(it => it.id === id);
      if (i >= 0) return { date, i, item: state.days[date][i] };
    }
    return null;
  }

  // "10.2167, 103.96" 형태 붙여넣기 → 위도/경도 분리
  function splitCoordPaste(e) {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const m = text.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      e.preventDefault();
      $('#fLat').value = m[1];
      $('#fLng').value = m[2];
    }
  }
  $('#fLat').addEventListener('paste', splitCoordPaste);
  $('#fLng').addEventListener('paste', splitCoordPaste);

  $('#btnGeo').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('위치 정보를 쓸 수 없어요'); return; }
    toast('현재 위치 확인 중…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        $('#fLat').value = pos.coords.latitude.toFixed(6);
        $('#fLng').value = pos.coords.longitude.toFixed(6);
        toast('현재 위치를 넣었어요');
      },
      () => toast('위치를 가져오지 못했어요 (https 필요)'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  $('#editForm').addEventListener('submit', e => {
    e.preventDefault();
    const place = $('#fPlace').value.trim();
    if (!place) { toast('장소명을 입력하세요'); return; }
    const latRaw = $('#fLat').value.trim();
    const lngRaw = $('#fLng').value.trim();
    const lat = toNum(latRaw);
    const lng = toNum(lngRaw);
    if ((latRaw && lat === null) || (lngRaw && lng === null)) { toast('위도/경도는 숫자로 입력하세요'); return; }
    if ((lat === null) !== (lng === null)) { toast('위도와 경도를 함께 입력하세요'); return; }
    if (lat !== null && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) { toast('좌표 범위를 확인하세요'); return; }

    const date = $('#fDate').value;
    const data = { time: $('#fTime').value, place, memo: $('#fMemo').value.trim(), lat, lng };

    if (editingId) {
      const found = findItem(editingId);
      if (found) {
        Object.assign(found.item, data);
        if (found.date !== date) {
          state.days[found.date].splice(found.i, 1);
          (state.days[date] = state.days[date] || []).push(found.item);
        }
      }
    } else {
      (state.days[date] = state.days[date] || []).push(Object.assign({ id: uid() }, data));
    }
    save();
    currentDay = date;
    saveUI();
    closeSheet('#editSheet');
    render();
    toast(editingId ? '수정했어요' : '추가했어요');
  });

  $('#btnDelete').addEventListener('click', async () => {
    const found = findItem(editingId);
    if (!found) return;
    if (!await ask(`"${found.item.place}" 일정을 삭제할까요?`, '삭제', true)) return;
    state.days[found.date].splice(found.i, 1);
    save();
    closeSheet('#editSheet');
    render();
    toast('삭제했어요');
  });

  // ---------- 이벤트 ----------
  document.querySelectorAll('.day-chips').forEach(wrap => wrap.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    currentDay = chip.dataset.date;
    saveUI();
    render();
  }));

  $('#cardList').addEventListener('click', e => {
    const exp = e.target.closest('.card-exp');
    if (exp) { if (PQ.openExpense) PQ.openExpense(null, { itemId: exp.dataset.exp, date: currentDay }); return; }
    if (e.target.closest('.handle') || e.target.closest('a')) return;
    const card = e.target.closest('.card');
    if (!card) return;
    const found = findItem(card.dataset.id);
    if (found) openEditor(found.item);
  });

  $('#btnAdd').addEventListener('click', () => {
    if (currentTab === 'settle' && PQ.openExpense) PQ.openExpense(null, { date: currentDay });
    else openEditor(null);
  });
  let currentTab = 'route';
  $('#btnMenu').addEventListener('click', () => {
    if (currentTab === 'map' && window.PQ.openFareSettings) window.PQ.openFareSettings();
    else openSheet('#menuSheet');
  });

  $('#btnSampleClear').addEventListener('click', async () => {
    if (!await ask('예시 일정을 모두 지우고 빈 일정으로 시작할까요?', '지우기', true)) return;
    // 일정만 지우고 요금·환율 설정, 정산 데이터는 유지
    const keep = {};
    ['fare', 'fx', 'people', 'expenses'].forEach(k => { if (state[k]) keep[k] = state[k]; });
    state = Object.assign(emptyData(), keep);
    save();
    render();
    toast('예시 일정을 지웠어요');
  });
  $('#btnSampleKeep').addEventListener('click', () => {
    delete state.sample;
    save();
    render();
  });

  $('#btnSortTime').addEventListener('click', () => {
    const list = state.days[currentDay];
    // 시간 없는 일정은 맨 뒤로, 같은 시간은 기존 순서 유지
    state.days[currentDay] = list.map((it, i) => ({ it, i })).sort((a, b) => {
      if (!a.it.time && !b.it.time) return a.i - b.i;
      if (!a.it.time) return 1;
      if (!b.it.time) return -1;
      return a.it.time.localeCompare(b.it.time) || a.i - b.i;
    }).map(x => x.it);
    save();
    closeSheet('#menuSheet');
    render();
    toast('시간순으로 정렬했어요');
  });

  $('#btnClearDay').addEventListener('click', async () => {
    const { m, d } = dayInfo(currentDay);
    if (!state.days[currentDay].length) { toast('삭제할 일정이 없어요'); return; }
    if (!await ask(`${m}/${d} 일정을 모두 삭제할까요?`, '모두 삭제', true)) return;
    state.days[currentDay] = [];
    save();
    closeSheet('#menuSheet');
    render();
    toast('삭제했어요');
  });

  // 내보내기: 파일 저장 + 복사 (파일 저장이 막힌 환경에서도 복사로 보관 가능)
  function exportJSON() {
    const payload = Object.assign({ app: 'phuquoc-trip', exportedAt: new Date().toISOString() }, state);
    return JSON.stringify(payload, null, 2);
  }
  $('#btnExport').addEventListener('click', () => {
    closeSheet('#menuSheet');
    $('#exportText').value = exportJSON();
    openSheet('#exportSheet');
  });
  $('#btnDownload').addEventListener('click', () => {
    const blob = new Blob([$('#exportText').value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    a.href = url;
    a.download = `phuquoc-trip-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('파일 저장을 요청했어요. 안 되면 복사를 쓰세요');
  });
  $('#btnCopy').addEventListener('click', () => {
    const box = $('#exportText');
    const fallback = () => { box.focus(); box.select(); toast('전체 선택했어요. 길게 눌러 복사하세요'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(box.value).then(() => toast('복사했어요'), fallback);
    } else {
      fallback();
    }
  });

  // 가져오기: 파일 선택 또는 붙여넣기
  async function importRaw(text) {
    let data;
    try {
      data = normalize(JSON.parse(text));
    } catch (err) {
      toast('가져오기 실패: ' + (err instanceof SyntaxError ? 'JSON 형식 오류' : err.message));
      return;
    }
    const count = countAll(data);
    if (!await ask(`일정 ${count}개를 가져와요. 현재 일정은 모두 바뀌어요. 계속할까요?`, '가져오기')) return;
    if (!data.fare && state.fare) data.fare = state.fare; // 파일에 설정이 없으면 현재 값 유지
    ['fx', 'people', 'expenses'].forEach(k => { if (!data[k] && state[k]) data[k] = state[k]; });
    state = data;
    delete state.sample;
    if (!state.days[currentDay]) currentDay = TRIP[0].date;
    save();
    closeSheet('#importSheet');
    render();
    toast(`일정 ${count}개를 가져왔어요`);
  }
  $('#btnImport').addEventListener('click', () => {
    closeSheet('#menuSheet');
    $('#importText').value = '';
    openSheet('#importSheet');
  });
  $('#btnImportText').addEventListener('click', () => {
    const text = $('#importText').value.trim();
    if (!text) { toast('붙여넣은 내용이 없어요'); return; }
    importRaw(text);
  });
  $('#btnPickFile').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importRaw(reader.result);
    reader.readAsText(file);
  });

  // 하단 탭
  document.querySelectorAll('.tabbar .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tabbar .tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
      currentTab = tab;
      const btn2 = $('#btnMenu');
      btn2.textContent = tab === 'map' ? '⚙︎' : '⋯';
      btn2.setAttribute('aria-label', tab === 'map' ? '그랩 요금 설정' : '메뉴');
      $('#routeActions').style.visibility = tab === 'route' || tab === 'map' ? 'visible' : 'hidden';
      $('#btnAdd').hidden = tab !== 'route' && tab !== 'settle';
      $('#btnAdd').setAttribute('aria-label', tab === 'settle' ? '지출 추가' : '일정 추가');
      $('#screen').scrollTop = 0;
      document.dispatchEvent(new CustomEvent('pq:tab', { detail: tab }));
    });
  });

  // 다른 탭(map.js 등)에서 쓰는 API
  window.PQ = {
    get state() { return state; },
    get currentDay() { return currentDay; },
    TRIP, esc, dayInfo, toast, ask, save, render, findItem,
    openEditor: item => openEditor(item),
    openSheet, closeSheet,
    onRender: fn => renderHooks.push(fn),
  };

  // 데스크톱 미리보기: iPhone 프레임(852pt + 테두리)이 창보다 크면 축소
  function fitDevice() {
    const dev = $('#device');
    const framed = matchMedia('(min-width: 640px) and (min-height: 600px)').matches;
    const s = framed ? Math.min(1, (window.innerHeight - 48) / 878, (window.innerWidth - 48) / 419) : 1;
    dev.style.setProperty('--s', s.toFixed(3));
  }
  window.addEventListener('resize', fitDevice);
  fitDevice();

  render();
  initSortable();
})();
