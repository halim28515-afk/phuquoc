/* 여행 플래너 – 항공편: 편명으로 출발·도착 정보 조회 (AeroDataBox / RapidAPI 키 필요) */
(function () {
  'use strict';
  const PQ = window.PQ;
  const $ = sel => document.querySelector(sel);
  const esc = PQ.esc;

  const KEY_STORE = 'flight-api-key'; // 이 기기에만 저장 (여행 데이터·백업에 안 들어감)
  const HOST = 'aerodatabox.p.rapidapi.com';

  const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } };
  const setKey = v => { try { v ? localStorage.setItem(KEY_STORE, v) : localStorage.removeItem(KEY_STORE); } catch (e) { /* noop */ } };

  const normNo = v => String(v || '').toUpperCase().replace(/[\s-]+/g, '');
  const validNo = no => /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(no);

  let current = null; // 편집 중인 일정의 항공편 정보

  // ---------- 조회 ----------
  // "2026-12-10 14:05+09:00" → { date, time }
  function splitLocal(s) {
    const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
  }
  function endOf(e) {
    e = e || {};
    const ap = e.airport || {};
    const t = e.revisedTime || e.scheduledTime || {};
    const local = splitLocal(t.local || e.scheduledTimeLocal);
    const loc = ap.location || {};
    return {
      iata: ap.iata || ap.icao || '',
      city: ap.municipalityName || ap.shortName || ap.name || '',
      date: local.date, time: local.time,
      terminal: e.terminal ? String(e.terminal) : '',
      lat: typeof loc.lat === 'number' ? loc.lat : null,
      lng: typeof loc.lon === 'number' ? loc.lon : null,
    };
  }

  async function lookup(no, date) {
    const key = getKey();
    if (!key) { const err = new Error('nokey'); err.code = 'nokey'; throw err; }
    const url = `https://${HOST}/flights/number/${encodeURIComponent(no)}/${date}?dateLocalRole=Departure&withAircraftImage=false&withLocation=false`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let r;
    try {
      r = await fetch(url, { signal: ctrl.signal, headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST } });
    } catch (e) {
      const err = new Error('net'); err.code = 'net'; throw err;
    } finally { clearTimeout(timer); }
    if (r.status === 204 || r.status === 404) return null;
    if (r.status === 401 || r.status === 403) { const err = new Error('auth'); err.code = 'auth'; throw err; }
    if (r.status === 429) { const err = new Error('limit'); err.code = 'limit'; throw err; }
    if (!r.ok) { const err = new Error('HTTP ' + r.status); err.code = 'http'; throw err; }
    const list = await r.json().catch(() => []);
    const f = Array.isArray(list) ? list[0] : null;
    if (!f) return null;
    const dep = endOf(f.departure), arr = endOf(f.arrival);
    return {
      no,
      airline: (f.airline && f.airline.name) || '',
      status: f.status || '',
      dep, arr,
    };
  }

  // ---------- 화면 ----------
  const STATUS = {
    Expected: '예정', Scheduled: '예정', EnRoute: '운항 중', CheckIn: '체크인 중', Boarding: '탑승 중',
    GateClosed: '탑승 마감', Departed: '출발함', Delayed: '지연', Approaching: '도착 임박', Arrived: '도착함',
    Canceled: '결항', Cancelled: '결항', Diverted: '회항', CanceledUncertain: '결항 가능성',
  };
  const trackUrl = no => 'https://www.flightaware.com/live/flight/' + encodeURIComponent(no);
  const nextDay = f => f.dep && f.arr && f.dep.date && f.arr.date && f.arr.date > f.dep.date ? ' <small>+1</small>' : '';
  const endTxt = e => e ? `${esc(e.iata || e.city || '?')}${e.time ? ' ' + esc(e.time) : ''}` : '?';

  function cardLine(f) {
    const route = f.dep || f.arr ? ` · ${endTxt(f.dep)} → ${endTxt(f.arr)}${nextDay(f)}` : '';
    return `<div class="flight-line">✈️ ${esc(f.no)}${route}</div>`;
  }

  function renderBox(msg) {
    const box = $('#flightBox');
    const f = current;
    let html = '';
    if (f && (f.dep || f.arr)) {
      const end = (label, e) => e ? `<div class="fb-end"><span class="fb-l">${label}</span>
          <b>${esc(e.time || '--:--')}</b>
          <span>${esc(e.city || '')}${e.iata ? ` (${esc(e.iata)})` : ''}${e.terminal ? ` · 터미널 ${esc(e.terminal)}` : ''}</span></div>` : '';
      html += `<div class="fb-head"><b>${esc(f.airline || f.no)}</b>${f.airline ? ` ${esc(f.no)}` : ''}${f.status ? `<span class="fb-status">${esc(STATUS[f.status] || f.status)}</span>` : ''}</div>
        ${end('출발', f.dep)}${end('도착', f.arr)}${nextDay(f) ? '<p class="fb-note">다음 날 도착</p>' : ''}`;
    }
    if (msg) html += `<p class="fb-msg">${msg}</p>`;
    if (f) html += `<a class="fb-link" href="${trackUrl(f.no)}" target="_blank" rel="noopener">실시간 운항 정보 보기 ↗</a>`;
    box.innerHTML = html;
    box.hidden = !html;
  }

  // 편집 시트 열 때
  function load(item) {
    current = item && item.flight ? JSON.parse(JSON.stringify(item.flight)) : null;
    $('#fFlight').value = current ? current.no : '';
    renderBox('');
  }

  // 저장할 때
  function read() {
    const no = normNo($('#fFlight').value);
    if (!no) return undefined;
    if (current && current.no === no) return current;
    return { no };
  }

  $('#fFlight').addEventListener('input', () => {
    const no = normNo($('#fFlight').value);
    if (current && current.no !== no) { current = no ? { no } : null; renderBox(''); }
  });

  let busy = false;
  $('#btnFlight').addEventListener('click', async () => {
    const no = normNo($('#fFlight').value);
    if (!no) { PQ.toast('편명을 입력하세요 (예: VJ975)'); $('#fFlight').focus(); return; }
    if (!validNo(no)) { PQ.toast('편명 형식을 확인하세요 (예: VJ975, KE461)'); return; }
    if (busy) return;
    $('#fFlight').value = no;
    current = current && current.no === no ? current : { no };
    if (!getKey()) {
      renderBox('자동 조회를 쓰려면 API 키가 필요해요. <button type="button" class="link-btn" data-flight-key>키 설정하기</button><br>편명은 그대로 저장돼요.');
      return;
    }
    busy = true;
    $('#btnFlight').disabled = true;
    renderBox('조회 중…');
    try {
      const f = await lookup(no, $('#fDate').value);
      if (!f) { renderBox('이 날짜에 이 편명의 운항 정보를 찾지 못했어요. 날짜와 편명을 확인하세요.'); return; }
      current = { no: f.no, airline: f.airline, status: f.status,
        dep: { iata: f.dep.iata, city: f.dep.city, date: f.dep.date, time: f.dep.time, terminal: f.dep.terminal },
        arr: { iata: f.arr.iata, city: f.arr.city, date: f.arr.date, time: f.arr.time, terminal: f.arr.terminal } };
      // 일정 칸 채우기: 출발 시각, 장소(비어 있으면), 출발 공항 위치
      if (f.dep.time) $('#fTime').value = f.dep.time;
      const place = $('#fPlace');
      if (!place.value.trim()) place.value = `${f.no} ${f.dep.city || f.dep.iata} → ${f.arr.city || f.arr.iata}`.slice(0, 80);
      if (f.dep.lat !== null && f.dep.lng !== null) {
        $('#fLat').value = f.dep.lat.toFixed(6);
        $('#fLng').value = f.dep.lng.toFixed(6);
        PQ.setPickedAddr(`${f.dep.city} ${f.dep.iata} 공항`.trim());
      }
      renderBox('');
      PQ.toast('항공편 정보를 채웠어요');
    } catch (err) {
      const why = {
        auth: 'API 키가 맞지 않아요. 설정에서 키를 확인하세요. <button type="button" class="link-btn" data-flight-key>키 설정하기</button>',
        limit: '이번 달 무료 조회 횟수를 다 썼어요. 시각은 직접 입력해 주세요.',
        net: '항공편 서버에 연결하지 못했어요. 인터넷 연결을 확인하세요. (미리보기 링크에서는 조회가 안 돼요)',
      }[err.code] || '조회 중 문제가 생겼어요. 잠시 뒤 다시 시도하세요.';
      renderBox(why);
    } finally {
      busy = false;
      $('#btnFlight').disabled = false;
    }
  });

  // ---------- 키 설정 ----------
  function openKeySheet() {
    $('#fFlightKey').value = getKey();
    PQ.openSheet('#flightKeySheet');
  }
  $('#flightBox').addEventListener('click', e => { if (e.target.closest('[data-flight-key]')) openKeySheet(); });
  $('#btnFlightKey').addEventListener('click', () => { PQ.closeSheet('#menuSheet'); openKeySheet(); });
  $('#flightKeyForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#fFlightKey').value.trim();
    setKey(v);
    PQ.closeSheet('#flightKeySheet');
    PQ.toast(v ? 'API 키를 저장했어요' : 'API 키를 지웠어요');
    if (!$('#editSheet').hidden) renderBox('');
  });
  $('#btnFlightKeyDel').addEventListener('click', () => {
    setKey('');
    $('#fFlightKey').value = '';
    PQ.closeSheet('#flightKeySheet');
    PQ.toast('API 키를 지웠어요');
  });

  PQ.flight = { load, read, cardLine };
  PQ.render(); // 카드에 항공편 줄 표시
})();
