/* 여행 플래너 – 일정 파일 가져오기 (xlsx / csv / 붙여넣기 → 미리보기 → 추가) */
(function () {
  'use strict';
  const PQ = window.PQ;
  const TS = window.TripStore;
  const $ = sel => document.querySelector(sel);
  const esc = PQ.esc;

  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const HEAD = ['날짜', '시간', '장소', '메모', '위도', '경도'];

  // ---------- SheetJS (엑셀) – 필요할 때만 불러옴 ----------
  let xlsxPromise = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxPromise) {
      xlsxPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = XLSX_URL;
        s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('엑셀 라이브러리 오류')));
        s.onerror = () => { xlsxPromise = null; reject(new Error('엑셀 라이브러리를 불러오지 못했어요 (인터넷 필요). CSV로 저장해서 올리거나 붙여넣기를 써 주세요')); };
        document.head.appendChild(s);
      });
    }
    return xlsxPromise;
  }

  // ---------- CSV / TSV ----------
  function parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delim = firstLine.includes('\t') ? '\t' : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  // ---------- 머리글 찾기 ----------
  const ALIASES = {
    date: /^(날짜|일자|일정일|date|day|일차|요일|dd?ate)$/i,
    time: /^(시간|시각|time|출발|start)$/i,
    place: /^(장소|장소명|일정|이름|명칭|place|name|title|spot|location|where)$/i,
    memo: /^(메모|비고|내용|노트|설명|memo|note|notes|desc|description)$/i,
    lat: /^(위도|lat|latitude)$/i,
    lng: /^(경도|lng|lon|long|longitude)$/i,
    coord: /^(좌표|coord|coords|coordinates|위치|gps)$/i,
  };
  function mapHeader(row) {
    const map = {};
    row.forEach((c, i) => {
      const s = String(c == null ? '' : c).trim().replace(/\s+/g, '');
      Object.entries(ALIASES).forEach(([k, re]) => { if (map[k] === undefined && re.test(s)) map[k] = i; });
    });
    return map.place !== undefined ? map : null;
  }

  // ---------- 날짜 / 시간 해석 ----------
  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  function validYMD(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  // 연도 없는 날짜: 여행 시작일과 가장 가까운 연도
  function guessYear(m, d, trip) {
    const sy = Number(trip.start.slice(0, 4));
    let best = sy, bestDiff = Infinity;
    [sy - 1, sy, sy + 1].forEach(y => {
      if (!validYMD(y, m, d)) return;
      const diff = Math.abs(TS.diffDays(trip.start, iso(y, m, d)));
      if (diff < bestDiff) { bestDiff = diff; best = y; }
    });
    return best;
  }
  function excelSerialToISO(n) {
    const t = new Date(Math.round((n - 25569) * 86400000));
    return t.toISOString().slice(0, 10);
  }
  // 반환: 'YYYY-MM-DD' | null(해석 불가) | '' (비어 있음)
  function parseDate(v, trip) {
    if (v === null || v === undefined || String(v).trim() === '') return '';
    if (v instanceof Date && !isNaN(v)) {
      // SheetJS cellDates: 현지 시간 자정 기준
      return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    }
    if (typeof v === 'number') {
      if (v >= 1 && v <= 60 && Number.isInteger(v)) return TS.addDays(trip.start, v - 1); // 1, 2, 3 → Day N
      if (v > 20000 && v < 80000) return excelSerialToISO(v);
      return null;
    }
    const s = String(v).trim();
    let m;
    if ((m = s.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/))) {
      const y = +m[1], mo = +m[2], d = +m[3];
      return validYMD(y, mo, d) ? iso(y, mo, d) : null;
    }
    if ((m = s.match(/^(?:day|d)\s*-?\s*(\d{1,2})$/i)) || (m = s.match(/^(\d{1,2})\s*일\s*차$/)) || (m = s.match(/^(\d{1,2})$/))) {
      const n = +m[1];
      return n >= 1 && n <= 60 ? TS.addDays(trip.start, n - 1) : null;
    }
    if ((m = s.match(/^(\d{1,2})\s*[./월-]\s*(\d{1,2})\s*일?/))) {
      const mo = +m[1], d = +m[2];
      const y = guessYear(mo, d, trip);
      return validYMD(y, mo, d) ? iso(y, mo, d) : null;
    }
    return null;
  }
  // 반환: 'HH:MM' | '' (없음/해석 불가는 빈 값 + 경고)
  function parseTime(v) {
    if (v === null || v === undefined || String(v).trim() === '') return { t: '' };
    if (v instanceof Date && !isNaN(v)) return { t: `${pad(v.getHours())}:${pad(v.getMinutes())}` };
    if (typeof v === 'number') {
      if (v >= 0 && v < 1) { const mins = Math.round(v * 1440); return { t: `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}` }; }
      if (Number.isInteger(v) && v >= 0 && v <= 2359 && v % 100 < 60) return { t: `${pad(Math.floor(v / 100))}:${pad(v % 100)}` };
      return { t: '', bad: true };
    }
    let s = String(v).trim().toLowerCase();
    let pm = /오후|pm|p\.m\./.test(s), am = /오전|am|a\.m\./.test(s);
    s = s.replace(/오전|오후|am|pm|a\.m\.|p\.m\./g, '').trim();
    let m = s.match(/^(\d{1,2})\s*[:시.]\s*(\d{1,2})?\s*분?/) || s.match(/^(\d{1,2})(\d{2})$/) || s.match(/^(\d{1,2})\s*시?$/);
    if (!m) return { t: '', bad: true };
    let h = +m[1], mi = m[2] ? +m[2] : 0;
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h > 23 || mi > 59) return { t: '', bad: true };
    return { t: `${pad(h)}:${pad(mi)}` };
  }
  function parseCoord(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : NaN;
  }

  // ---------- 행 → 일정 후보 ----------
  // 각 행: { date, time, place, memo, lat, lng, warn: [], skip: '' , include }
  function buildRows(table, trip) {
    if (!table.length) return { rows: [], headerFound: false };
    let map = mapHeader(table[0]);
    let body = table.slice(1);
    const headerFound = !!map;
    if (!map) { map = { date: 0, time: 1, place: 2, memo: 3, lat: 4, lng: 5 }; body = table; } // 머리글 없으면 템플릿 순서
    const dates = TS.tripDates(trip);
    const get = (r, k) => (map[k] === undefined ? '' : r[map[k]]);
    let lastDate = dates[0] || trip.start;
    const rows = body.map((r, i) => {
      const row = { n: i + (headerFound ? 2 : 1), warn: [], skip: '' };
      row.place = String(get(r, 'place') == null ? '' : get(r, 'place')).trim().slice(0, 80);
      row.memo = String(get(r, 'memo') == null ? '' : get(r, 'memo')).trim().slice(0, 500);
      const d = parseDate(get(r, 'date'), trip);
      if (d === null) { row.skip = `날짜를 읽을 수 없어요 (${String(get(r, 'date')).slice(0, 20)})`; row.date = lastDate; row.badDate = true; }
      else if (d === '') { row.date = lastDate; if (i > 0) row.inherited = true; }
      else { row.date = d; lastDate = d; }
      const tm = parseTime(get(r, 'time'));
      row.time = tm.t;
      if (tm.bad) row.warn.push('시간을 읽지 못해 비워둠');
      let lat = parseCoord(get(r, 'lat')), lng = parseCoord(get(r, 'lng'));
      if (map.coord !== undefined && lat === null) {
        const mm = String(get(r, 'coord') || '').match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
        if (mm) { lat = +mm[1]; lng = +mm[2]; }
      }
      if (Number.isNaN(lat) || Number.isNaN(lng) || (lat !== null && (Math.abs(lat) > 90 || lng === null || Math.abs(lng) > 180))) {
        row.warn.push('좌표 형식 오류 → 비워둠'); lat = lng = null;
      }
      row.lat = lat; row.lng = lng;
      if (!row.place) row.skip = row.skip || '장소가 비어 있어요';
      row.outside = !row.skip && !dates.includes(row.date);
      row.include = !row.skip;
      return row;
    }).filter(r => r.place || r.skip !== '장소가 비어 있어요' || r.memo); // 완전히 빈 줄 제외
    return { rows, headerFound };
  }

  // ---------- 화면 ----------
  let rows = [];
  let geoRun = 0; // 좌표 검색 실행 번호 (취소용)

  function resetView() {
    rows = [];
    geoRun++;
    $('#fiPick').hidden = false;
    $('#fiPreview').hidden = true;
    $('#fiPaste').value = '';
    $('#fiMsg').textContent = '';
  }

  function openFileImport() {
    resetView();
    const t = PQ.state;
    $('#fiTripRange').textContent = `${t.name} · ${t.start.replace(/-/g, '.')} – ${t.end.slice(5).replace('-', '.')}`;
    PQ.openSheet('#fileSheet');
  }
  PQ.openFileImport = openFileImport;

  function dayLabel(date) {
    const { m, d, wd, idx } = PQ.dayInfo(date);
    return `${idx >= 0 ? 'Day ' + (idx + 1) + ' · ' : ''}${m}/${d}(${wd})`;
  }

  function renderPreview() {
    const ok = rows.filter(r => !r.skip);
    const inc = rows.filter(r => r.include);
    const outside = ok.filter(r => r.outside);
    const noCoord = inc.filter(r => r.lat === null);
    const skipped = rows.filter(r => r.skip);
    const t = PQ.state;
    const summary = [`읽은 일정 ${ok.length}개`];
    if (skipped.length) summary.push(`건너뜀 ${skipped.length}`);
    $('#fiSummary').textContent = summary.join(' · ');
    const warn = $('#fiOutside');
    warn.hidden = !outside.length;
    warn.innerHTML = outside.length
      ? `⚠️ <b>여행 기간 밖 ${outside.length}개</b> (${t.start.slice(5).replace('-', '/')}~${t.end.slice(5).replace('-', '/')} 밖). 그대로 추가하면 ‘기타’ 날짜로 들어가요. 빼려면 체크를 해제하세요.`
      : '';
    $('#fiGeoBox').hidden = !noCoord.length && !geoState.running;
    $('#fiGeoCount').textContent = geoState.running ? `좌표 찾는 중… ${geoState.done}/${geoState.total}` : `좌표 없는 장소 ${noCoord.length}개`;
    $('#btnFiGeo').textContent = geoState.running ? '멈추기' : '좌표 자동 검색';

    $('#fiList').innerHTML = rows.map((r, i) => {
      const cls = r.skip ? 'skip' : r.outside ? 'outside' : '';
      const coord = r.skip ? '' : r.lat !== null ? `<span class="fi-tag ok">📍 ${r.geo ? '검색됨' : '좌표'}</span>` : r.geoFail ? '<span class="fi-tag">좌표 못 찾음</span>' : r.searching ? '<span class="fi-tag">검색 중…</span>' : '<span class="fi-tag">좌표 없음</span>';
      const notes = [];
      if (r.skip) notes.push(r.skip);
      if (r.outside) notes.push('여행 기간 밖');
      r.warn.forEach(w => notes.push(w));
      return `<li class="fi-row ${cls}">
        <label class="fi-check"><input type="checkbox" data-i="${i}" ${r.include ? 'checked' : ''} ${r.skip ? 'disabled' : ''} aria-label="${esc(r.place || '빈 행')} 포함"></label>
        <div class="fi-main">
          <div class="fi-l1"><span class="fi-date">${r.badDate ? '날짜 ?' : dayLabel(r.date)}</span><span class="fi-time">${r.time || '--:--'}</span>${coord}</div>
          <div class="fi-place">${esc(r.place || '(장소 없음)')}</div>
          ${r.memo ? `<div class="fi-memo">${esc(r.memo)}</div>` : ''}
          ${notes.length ? `<div class="fi-note">${r.n}행 · ${esc(notes.join(' · '))}</div>` : ''}
        </div>
      </li>`;
    }).join('');
    $('#btnFiAdd').textContent = `${inc.length}개 추가`;
    $('#btnFiAdd').disabled = !inc.length;
  }

  // 읽은 표 → 미리보기
  function showTable(table, sourceName) {
    const { rows: rs, headerFound } = buildRows(table, PQ.state);
    if (!rs.length) { $('#fiMsg').textContent = '읽을 일정이 없어요. 템플릿 형식(날짜, 시간, 장소, 메모, 위도, 경도)을 확인해 주세요.'; return; }
    rows = rs;
    $('#fiPick').hidden = true;
    $('#fiPreview').hidden = false;
    $('#fiSource').textContent = `${sourceName}${headerFound ? '' : ' · 머리글이 없어 템플릿 순서로 읽었어요'}`;
    renderPreview();
    // 좌표 없는 장소는 바로 자동 검색 시작
    if (rows.some(r => r.include && r.lat === null)) startGeo();
  }

  async function readFile(file) {
    $('#fiMsg').textContent = '파일 읽는 중…';
    const name = file.name || '파일';
    try {
      if (/\.(xlsx|xlsm|xls|ods)$/i.test(name)) {
        const XLSX = await loadXLSX();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
          .filter(r => r.some(c => String(c).trim() !== ''));
        showTable(table, `${name} (${wb.SheetNames[0]} 시트)`);
      } else {
        const text = await file.text();
        showTable(parseDelimited(text), name);
      }
      if (!$('#fiPreview').hidden) $('#fiMsg').textContent = '';
    } catch (e) {
      $('#fiMsg').textContent = '읽기 실패: ' + (e.message || e);
    }
  }

  // ---------- 좌표 자동 검색 (Nominatim, 1초에 1번) ----------
  const geoState = { running: false, done: 0, total: 0 };
  async function startGeo() {
    if (!PQ.searchPlace) return;
    const run = ++geoRun;
    const targets = rows.filter(r => r.include && r.lat === null && !r.geoFail);
    if (!targets.length) return;
    Object.assign(geoState, { running: true, done: 0, total: targets.length });
    renderPreview();
    let failedNet = false;
    for (const r of targets) {
      if (run !== geoRun) return; // 멈춤 또는 창 닫힘
      r.searching = true;
      renderPreview();
      try {
        const res = await PQ.searchPlace(r.place, PQ.state);
        if (run !== geoRun) return;
        if (res.length) { r.lat = +Number(res[0].lat).toFixed(6); r.lng = +Number(res[0].lon).toFixed(6); r.geo = true; }
        else r.geoFail = true;
      } catch (e) {
        r.geoFail = true; failedNet = true;
      }
      r.searching = false;
      geoState.done++;
      renderPreview();
      await new Promise(res => setTimeout(res, 1100));
      if (failedNet) break; // 오프라인이면 나머지 시도하지 않음
    }
    if (run !== geoRun) return;
    geoState.running = false;
    renderPreview();
    if (failedNet) $('#fiMsg').textContent = '좌표 검색 서버에 연결하지 못했어요. 좌표 없이 추가하고 나중에 일정에서 검색할 수 있어요.';
  }
  function stopGeo() {
    geoRun++;
    geoState.running = false;
    rows.forEach(r => { r.searching = false; });
    renderPreview();
  }
  $('#btnFiGeo').addEventListener('click', () => {
    if (geoState.running) stopGeo();
    else { rows.forEach(r => { r.geoFail = false; }); startGeo(); }
  });

  // ---------- 추가 ----------
  $('#btnFiAdd').addEventListener('click', async () => {
    const inc = rows.filter(r => r.include);
    if (!inc.length) return;
    const replace = $('#fiReplace').checked;
    const t = PQ.state;
    const existing = Object.values(t.days).reduce((s, l) => s + l.length, 0);
    if (replace && existing && !await PQ.ask(`지금 있는 일정 ${existing}개를 지우고 파일의 일정 ${inc.length}개로 바꿀까요? (지출은 그대로)`, '바꾸기', true)) return;
    stopGeo();
    if (replace) Object.keys(t.days).forEach(d => { t.days[d] = []; });
    inc.forEach(r => {
      (t.days[r.date] = t.days[r.date] || []).push({ id: TS.uid(), time: r.time, place: r.place, memo: r.memo, lat: r.lat, lng: r.lng });
    });
    delete t.sample;
    PQ.save();
    PQ.closeSheet('#fileSheet');
    PQ.render();
    PQ.toast(`일정 ${inc.length}개를 추가했어요`);
  });

  $('#fiList').addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox][data-i]');
    if (!cb) return;
    rows[Number(cb.dataset.i)].include = cb.checked;
    renderPreview();
  });

  // ---------- 입력: 파일 / 붙여넣기 ----------
  $('#btnFiPick').addEventListener('click', () => $('#fiFile').click());
  $('#fiFile').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) readFile(f);
  });
  $('#btnFiPaste').addEventListener('click', () => {
    const text = $('#fiPaste').value;
    if (!text.trim()) { $('#fiMsg').textContent = '붙여넣은 내용이 없어요.'; return; }
    showTable(parseDelimited(text), '붙여넣은 표');
  });
  $('#btnFiBack').addEventListener('click', resetView);
  // 시트 닫으면 좌표 검색 멈춤
  new MutationObserver(() => { if ($('#fileSheet').hidden) { geoRun++; geoState.running = false; } })
    .observe($('#fileSheet'), { attributes: true, attributeFilter: ['hidden'] });

  // ---------- 템플릿 ----------
  function templateRows() {
    const dates = TS.tripDates(PQ.state);
    const d1 = dates[0], d2 = dates[1] || d1, dl = dates[dates.length - 1];
    return [
      HEAD,
      [d1, '14:00', '공항 도착', '숙소까지 택시', '', ''],
      ['', '18:00', `${PQ.state.city || '시내'} 야시장`, '날짜를 비우면 윗줄 날짜로 들어가요', '', ''],
      [d2, '09:30', '관광지 이름', '좌표를 비우면 자동으로 찾아요', '', ''],
      [dl, '12:00', '공항', '출국', '', ''],
    ];
  }
  const csvCell = v => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const templateCSV = () => '﻿' + templateRows().map(r => r.map(csvCell).join(',')).join('\r\n');
  const tplName = ext => `itinerary-template-${PQ.state.start}.${ext}`; // 파일명은 영문 (일부 브라우저가 한글 이름을 무시)

  $('#btnTplCsv').addEventListener('click', () => {
    PQ.saveFile(tplName('csv'), new Blob([templateCSV()], { type: 'text/csv;charset=utf-8' }));
  });
  $('#btnTplXlsx').addEventListener('click', async () => {
    try {
      const XLSX = await loadXLSX();
      const ws = XLSX.utils.aoa_to_sheet(templateRows());
      ws['!cols'] = [{ wch: 12 }, { wch: 7 }, { wch: 22 }, { wch: 30 }, { wch: 11 }, { wch: 11 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '일정');
      const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      PQ.saveFile(tplName('xlsx'), new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    } catch (e) {
      PQ.toast(e.message || '엑셀 템플릿을 만들지 못했어요');
    }
  });
  $('#btnTplCopy').addEventListener('click', () => {
    // 탭으로 구분 → 엑셀·구글 시트에 붙여넣으면 칸이 나뉨
    const text = templateRows().map(r => r.join('\t')).join('\n');
    const box = $('#fiPaste');
    const fallback = () => { box.value = text; box.focus(); box.select(); PQ.toast('아래 칸에 넣었어요. 길게 눌러 복사하세요'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => PQ.toast('템플릿을 복사했어요. 엑셀·구글 시트에 붙여넣으세요'), fallback);
    else fallback();
  });

  $('#btnFileImport').addEventListener('click', () => { PQ.closeSheet('#menuSheet'); openFileImport(); });

  PQ._import = { parseDelimited, buildRows, parseDate, parseTime }; // 테스트용
})();
