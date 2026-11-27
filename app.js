/* 여행 플래너 – 동선 탭 (현재 선택된 여행) */
(function () {
  'use strict';
  const TS = window.TripStore;
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  // ---------- 현재 여행 ----------
  // state = 현재 여행 객체 (TripStore 안의 객체를 직접 수정하고 save()로 저장)
  let state = TS.get(TS.lastTripId) || TS.blank();
  let currentDay = pickDay();

  function pickDay() {
    const dates = TS.tripDates(state);
    const today = TS.todayISO();
    if (dates.includes(today)) return today;
    const ui = TS.uiFor(state.id);
    return ui.day && state.days[ui.day] ? ui.day : (dates[0] || today);
  }
  function save() {
    if (state.id === '__blank__') return;
    state.updatedAt = Date.now();
    if (!TS.save()) toast('저장 실패: 브라우저 저장소를 쓸 수 없어요');
  }
  function saveUI() {
    if (state.id === '__blank__') return;
    TS.uiFor(state.id).day = currentDay;
    TS.save();
  }

  // ---------- 유틸 ----------
  const uid = TS.uid;
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const tripDates = () => TS.tripDates(state);
  function dayInfo(date) {
    const [y, m, d] = date.split('-').map(Number);
    const wd = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    const idx = tripDates().indexOf(date);
    return { m, d, wd, idx, stay: (state.stays || {})[date] || null };
  }
  function allDates() {
    const dates = tripDates();
    const extra = Object.keys(state.days).filter(d => !dates.includes(d) && state.days[d].length).sort();
    return dates.concat(extra);
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

  let editingId = null;

  // ---------- 렌더 ----------
  function renderAppbar() {
    $('#tripTitle').textContent = state.name || '여행';
    const dates = tripDates();
    const fmtD = s => s.slice(5).replace('-', '.');
    const place = [state.city, state.country].filter(Boolean).join(' · ');
    $('#tripSub').textContent = [place, dates.length ? `${fmtD(state.start)} – ${fmtD(state.end)} · ${dates.length - 1}박 ${dates.length}일` : ''].filter(Boolean).join(' · ');
    document.title = state.name ? `${state.name} · 여행 플래너` : '여행 플래너';
  }

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
    document.querySelectorAll('.day-chips').forEach(wrap => {
      wrap.innerHTML = html;
      const active = wrap.querySelector('.chip.active');
      if (active && wrap.clientWidth) {
        wrap.scrollLeft = active.offsetLeft - (wrap.clientWidth - active.offsetWidth) / 2;
      }
    });
  }

  function renderHead() {
    const { idx, stay } = dayInfo(currentDay);
    const el = $('#dayHead');
    let html = '';
    if (idx < 0) html = '<span>여행 기간 밖 날짜</span>';
    else if (stay) {
      html = (stay.note ? `<span>${esc(stay.note)}</span>` : '') +
        (stay.stay ? `<span>🏨 숙박 <b>${esc(stay.stay)}</b></span>` : '<span>✈️ 체크아웃 · 공항</span>');
    }
    el.innerHTML = html;
    el.hidden = !html;
  }

  function renderCards() {
    const list = state.days[currentDay] || [];
    const ul = $('#cardList');
    ul.innerHTML = list.map(it => `<li class="card" data-id="${esc(it.id)}">
        <div class="time${it.time ? '' : ' none'}">${it.time || '--:--'}</div>
        <div class="body">
          <div class="place">${esc(it.place)}</div>
          ${it.memo ? `<div class="memo">${esc(it.memo)}</div>` : ''}
          ${window.PQ && PQ.linkedSpent ? PQ.linkedSpent(it.id) : ''}
        </div>
        <div class="card-side">
          <button type="button" class="card-exp" data-exp="${esc(it.id)}" aria-label="이 일정에 지출 추가"><svg class="ico-dollar" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M14.8 9.2c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.8-2.8 2.1 0 1.4 1.2 1.8 2.8 2.2 1.7.4 2.9.9 2.9 2.3 0 1.3-1.3 2.2-2.9 2.2-1.4 0-2.6-.7-3-1.8M12 6v1.6M12 16.4V18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
          <div class="handle" aria-label="순서 변경">≡</div>
        </div>
      </li>`).join('');
    $('#emptyState').hidden = list.length > 0;
    $('#sampleBanner').hidden = !state.sample;
  }

  const renderHooks = [];
  function render() {
    renderAppbar();
    renderChips();
    renderHead();
    renderCards();
    renderHooks.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }

  // 다른 여행으로 전환
  function switchTrip(id) {
    const t = TS.get(id);
    if (!t) return false;
    state = t;
    TS.lastTripId = id;
    currentDay = pickDay();
    document.querySelectorAll('.sheet-backdrop').forEach(s => { s.hidden = true; });
    document.dispatchEvent(new CustomEvent('pq:trip', { detail: id }));
    selectTab('route');
    render();
    return true;
  }
  function clearTrip() {
    state = TS.blank();
    currentDay = pickDay();
    document.dispatchEvent(new CustomEvent('pq:trip', { detail: null }));
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
  function dateOptions(selected) {
    const dates = allDates();
    if (selected && !dates.includes(selected)) dates.push(selected);
    return dates.map(date => {
      const { m, d, wd, idx } = dayInfo(date);
      return `<option value="${date}"${date === selected ? ' selected' : ''}>${idx >= 0 ? 'Day ' + (idx + 1) + ' · ' : ''}${m}/${d} (${wd})</option>`;
    }).join('');
  }

  function openEditor(item) {
    editingId = item ? item.id : null;
    $('#editTitle').textContent = item ? '일정 수정' : '일정 추가';
    $('#btnDelete').hidden = !item;
    const found = item ? findItem(item.id) : null;
    $('#fDate').innerHTML = dateOptions(found ? found.date : currentDay);
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
    $('#screen').scrollTop = 0; // 날짜 바꾸면 일정 목록 맨 위부터
  }));

  $('#cardList').addEventListener('click', e => {
    const exp = e.target.closest('.card-exp');
    if (exp) { if (PQ.openExpense) PQ.openExpense(null, { itemId: exp.dataset.exp, date: currentDay }); return; }
    if (e.target.closest('.handle') || e.target.closest('a')) return;
    const card = e.target.closest('.card');
    if (!card) return;
    const found = findItem(card.dataset.id);
    if (!found) return;
    if (PQ.openInfo) PQ.openInfo(found.item.id); // 거리·요금·길찾기 시트 (수정은 시트 안에서)
    else openEditor(found.item);
  });

  let currentTab = 'route';
  $('#btnAdd').addEventListener('click', () => {
    if (currentTab === 'settle' && PQ.openExpense) PQ.openExpense(null, { date: currentDay });
    else openEditor(null);
  });
  $('#btnMenu').addEventListener('click', () => {
    $('#btnFare').hidden = !(PQ.isGrab && PQ.isGrab());
    openSheet('#menuSheet');
  });
  $('#btnFare').addEventListener('click', () => {
    closeSheet('#menuSheet');
    if (window.PQ.openFareSettings) window.PQ.openFareSettings();
  });
  $('#btnTripHome').addEventListener('click', () => { if (PQ.showTrips) PQ.showTrips(); });

  $('#btnSampleClear').addEventListener('click', async () => {
    if (!await ask('예시 일정을 모두 지우고 빈 일정으로 시작할까요?', '지우기', true)) return;
    // 일정만 지우고 요금·환율 설정, 정산 데이터는 유지
    Object.keys(state.days).forEach(d => { state.days[d] = []; });
    tripDates().forEach(d => { state.days[d] = []; });
    delete state.sample;
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
    const list = state.days[currentDay] || [];
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
    if (!(state.days[currentDay] || []).length) { toast('삭제할 일정이 없어요'); return; }
    if (!await ask(`${m}/${d} 일정을 모두 삭제할까요?`, '모두 삭제', true)) return;
    state.days[currentDay] = [];
    save();
    closeSheet('#menuSheet');
    render();
    toast('삭제했어요');
  });

  // ---------- 내보내기 시트 (여행 하나 / 전체 백업 공용) ----------
  let exportName = 'trip';
  function showExport(title, text, filename) {
    $('#exportTitle').textContent = title;
    $('#exportText').value = text;
    exportName = filename;
    openSheet('#exportSheet');
  }
  $('#btnExport').addEventListener('click', () => {
    closeSheet('#menuSheet');
    showExport('이 여행 내보내기', TS.exportTrip(state.id), 'trip-' + state.start);
  });
  // 파일 저장: Claude 미리보기 안에서는 저장 권한을 쓰고, 일반 브라우저에서는 다운로드 링크
  async function saveFile(filename, blob) {
    try {
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) {
        await dl.save({ filename, data: blob });
        toast('파일을 저장했어요');
        return;
      }
    } catch (e) {
      if (e && (e.code === 'declined' || e.code === 'not_granted')) { toast('저장을 취소했어요'); return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('파일 저장을 요청했어요. 안 되면 복사를 쓰세요');
  }
  $('#btnDownload').addEventListener('click', () => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    saveFile(`${exportName.replace(/[\\/:*?"<>|\s]+/g, '-')}-${stamp}.json`, new Blob([$('#exportText').value], { type: 'application/json' }));
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

  // ---------- 가져오기 시트 (JSON 붙여넣기/파일) – 처리 함수는 여는 쪽에서 지정 ----------
  let importHandler = null;
  function showImport(title, hint, handler) {
    $('#importTitle').textContent = title;
    $('#importHint').textContent = hint;
    $('#importText').value = '';
    importHandler = handler;
    openSheet('#importSheet');
  }
  $('#btnImportText').addEventListener('click', () => {
    const text = $('#importText').value.trim();
    if (!text) { toast('붙여넣은 내용이 없어요'); return; }
    if (importHandler) importHandler(text);
  });
  $('#btnPickFile').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (importHandler) importHandler(reader.result); };
    reader.readAsText(file);
  });

  // ---------- 하단 탭 ----------
  function selectTab(tab) {
    document.querySelectorAll('.tabbar .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
    currentTab = tab;
    $('#routeActions').style.visibility = tab === 'route' ? 'visible' : 'hidden';
    $('#btnAdd').hidden = tab !== 'route' && tab !== 'settle';
    $('#btnAdd').setAttribute('aria-label', tab === 'settle' ? '지출 추가' : '일정 추가');
    $('#screen').scrollTop = 0;
    document.dispatchEvent(new CustomEvent('pq:tab', { detail: tab }));
  }
  document.querySelectorAll('.tabbar .tab').forEach(btn => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));

  // 다른 모듈(map/fx/settle/trips-ui)에서 쓰는 API
  window.PQ = {
    get state() { return state; },
    get currentDay() { return currentDay; },
    get currentTab() { return currentTab; },
    tripDates, allDates, dateOptions, esc, dayInfo, toast, ask, save, render, findItem,
    switchTrip, clearTrip, selectTab, showExport, showImport, saveFile,
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

  // 고정 영역(날짜·지도)이 상단 바 바로 아래에 붙도록 상단 바 높이를 CSS 변수로
  const appbar = document.querySelector('.appbar');
  const setAppbarH = () => $('#device').style.setProperty('--appbar-h', appbar.offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(setAppbarH).observe(appbar);
  setAppbarH();

  render();
  initSortable();
})();
