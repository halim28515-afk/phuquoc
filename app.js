/* 푸꾸옥 여행 앱 – 동선 탭 */
(function () {
  'use strict';

  const STORAGE_KEY = 'pq-trip-v1';
  const UI_KEY = 'pq-ui-v1';

  // 여행 정보: 2026-12-10 ~ 12-14, 1~3박 남부 숙소, 4박 그린베이
  const TRIP = [
    { date: '2026-12-10', stay: '남부 숙소', note: '도착 · 1박' },
    { date: '2026-12-11', stay: '남부 숙소', note: '2박' },
    { date: '2026-12-12', stay: '남부 숙소', note: '3박' },
    { date: '2026-12-13', stay: '그린베이', note: '숙소 이동 · 4박' },
    { date: '2026-12-14', stay: null, note: '귀국' },
  ];
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  // ---------- 저장소 ----------
  function emptyData() {
    const days = {};
    TRIP.forEach(d => { days[d.date] = []; });
    return { version: 1, days };
  }

  function normalize(raw) {
    const data = emptyData();
    if (!raw || typeof raw !== 'object' || !raw.days || typeof raw.days !== 'object') {
      throw new Error('형식이 올바르지 않아요');
    }
    Object.keys(raw.days).forEach(date => {
      if (!Array.isArray(raw.days[date])) return;
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
    return data;
  }

  function load() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? normalize(JSON.parse(s)) : emptyData();
    } catch (e) {
      console.warn('저장 데이터 읽기 실패', e);
      return emptyData();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('저장 실패: 브라우저 저장소를 사용할 수 없어요');
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
  const $ = sel => document.querySelector(sel);

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
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
    const wrap = $('#dayChips');
    wrap.innerHTML = allDates().map(date => {
      const { m, d, wd, idx } = dayInfo(date);
      const label = idx >= 0 ? 'Day ' + (idx + 1) : '기타';
      const n = (state.days[date] || []).length;
      return `<button class="chip${date === currentDay ? ' active' : ''}" data-date="${date}">
        <span class="d1">${label}</span>
        <span class="d2">${m}/${d} (${wd})</span>
        <span class="cnt">${n ? n + '개' : '–'}</span>
      </button>`;
    }).join('');
    const active = wrap.querySelector('.chip.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function renderHead() {
    const { trip } = dayInfo(currentDay);
    const el = $('#dayHead');
    if (!trip) { el.innerHTML = '<span>여행 기간 외 날짜</span>'; return; }
    el.innerHTML = `<span>${esc(trip.note)}</span>` +
      (trip.stay ? `<span>🏨 숙박 <b>${esc(trip.stay)}</b></span>` : '<span>✈️ 체크아웃 · 공항</span>');
  }

  function renderCards() {
    const list = state.days[currentDay] || [];
    const ul = $('#cardList');
    ul.innerHTML = list.map((it, i) => {
      const hasCoord = it.lat !== null && it.lng !== null;
      const coord = hasCoord
        ? `<a class="coord" href="https://www.google.com/maps/search/?api=1&query=${it.lat},${it.lng}" target="_blank" rel="noopener">📍 ${it.lat}, ${it.lng}</a>`
        : '';
      return `<li class="card" data-id="${esc(it.id)}">
        <div class="time${it.time ? '' : ' none'}">${it.time || '--:--'}</div>
        <div class="body">
          <div class="place"><span class="idx">${i + 1}</span>${esc(it.place)}</div>
          ${it.memo ? `<div class="memo">${esc(it.memo)}</div>` : ''}
          ${coord}
        </div>
        <div class="handle" aria-label="순서 변경">≡</div>
      </li>`;
    }).join('');
    $('#emptyState').hidden = list.length > 0;
  }

  function render() {
    renderChips();
    renderHead();
    renderCards();
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
      delay: 0,
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

  document.querySelectorAll('.sheet-backdrop').forEach(bd => {
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
    openSheet('#editSheet');
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
    if (!navigator.geolocation) { toast('위치 정보를 사용할 수 없어요'); return; }
    toast('현재 위치 확인 중…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        $('#fLat').value = pos.coords.latitude.toFixed(6);
        $('#fLng').value = pos.coords.longitude.toFixed(6);
        toast('현재 위치를 넣었어요');
      },
      () => toast('위치를 가져오지 못했어요'),
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

  $('#btnDelete').addEventListener('click', () => {
    const found = findItem(editingId);
    if (!found) return;
    if (!confirm(`"${found.item.place}" 일정을 삭제할까요?`)) return;
    state.days[found.date].splice(found.i, 1);
    save();
    closeSheet('#editSheet');
    render();
    toast('삭제했어요');
  });

  // ---------- 이벤트 ----------
  $('#dayChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    currentDay = chip.dataset.date;
    saveUI();
    render();
  });

  $('#cardList').addEventListener('click', e => {
    if (e.target.closest('.handle') || e.target.closest('a')) return;
    const card = e.target.closest('.card');
    if (!card) return;
    const found = findItem(card.dataset.id);
    if (found) openEditor(found.item);
  });

  $('#btnAdd').addEventListener('click', () => openEditor(null));
  $('#btnMenu').addEventListener('click', () => openSheet('#menuSheet'));

  $('#btnSortTime').addEventListener('click', () => {
    const list = state.days[currentDay];
    // 시간 없는 일정은 맨 뒤로, 같은 시간은 기존 순서 유지
    const sorted = list.map((it, i) => ({ it, i })).sort((a, b) => {
      if (!a.it.time && !b.it.time) return a.i - b.i;
      if (!a.it.time) return 1;
      if (!b.it.time) return -1;
      return a.it.time.localeCompare(b.it.time) || a.i - b.i;
    }).map(x => x.it);
    state.days[currentDay] = sorted;
    save();
    closeSheet('#menuSheet');
    render();
    toast('시간순으로 정렬했어요');
  });

  $('#btnClearDay').addEventListener('click', () => {
    const { m, d } = dayInfo(currentDay);
    if (!state.days[currentDay].length) { toast('삭제할 일정이 없어요'); return; }
    if (!confirm(`${m}/${d} 일정을 모두 삭제할까요?`)) return;
    state.days[currentDay] = [];
    save();
    closeSheet('#menuSheet');
    render();
  });

  $('#btnExport').addEventListener('click', () => {
    const payload = Object.assign({ app: 'phuquoc-trip', exportedAt: new Date().toISOString() }, state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    a.href = url;
    a.download = `phuquoc-trip-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    closeSheet('#menuSheet');
    toast('JSON 파일을 내보냈어요');
  });

  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = normalize(JSON.parse(reader.result));
      } catch (err) {
        toast('가져오기 실패: ' + (err.message || 'JSON 오류'));
        return;
      }
      const count = Object.values(data.days).reduce((s, l) => s + l.length, 0);
      if (!confirm(`일정 ${count}개를 가져와요. 현재 일정은 모두 바뀝니다. 계속할까요?`)) return;
      state = data;
      if (!state.days[currentDay]) currentDay = TRIP[0].date;
      save();
      closeSheet('#menuSheet');
      render();
      toast(`일정 ${count}개를 가져왔어요`);
    };
    reader.readAsText(file);
  });

  // 하단 탭
  document.querySelectorAll('.tabbar .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabbar .tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
      $('#routeActions').style.visibility = btn.dataset.tab === 'route' ? 'visible' : 'hidden';
      window.scrollTo(0, 0);
    });
  });

  // 다른 탭에서 쓸 수 있도록 노출
  window.PQ = { get state() { return state; }, TRIP };

  render();
  initSortable();
})();
