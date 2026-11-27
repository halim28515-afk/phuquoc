/* 여행 플래너 – 항공편: 편명으로 출발·도착 정보 조회 (AirLabs API 키 필요) */
(function () {
  'use strict';
  const PQ = window.PQ;
  const $ = sel => document.querySelector(sel);
  const esc = PQ.esc;

  const KEY_STORE = 'flight-api-key'; // 이 기기에만 저장 (여행 데이터·백업에 안 들어감)
  const API = 'https://airlabs.co/api/v9/';

  const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } };
  const setKey = v => { try { v ? localStorage.setItem(KEY_STORE, v) : localStorage.removeItem(KEY_STORE); } catch (e) { /* noop */ } };

  const normNo = v => String(v || '').toUpperCase().replace(/[\s-]+/g, '');
  const validNo = no => /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(no);

  let current = null; // 편집 중인 일정의 항공편 정보

  // ---------- 조회 (AirLabs) ----------
  const fail = code => { const err = new Error(code); err.code = code; return err; };

  async function call(path, params) {
    const q = new URLSearchParams(Object.assign({ api_key: getKey() }, params));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let r;
    try { r = await fetch(`${API}${path}?${q}`, { signal: ctrl.signal }); }
    catch (e) { throw fail('net'); }
    finally { clearTimeout(timer); }
    const body = await r.json().catch(() => null);
    const err = body && body.error;
    if (err) {
      const c = String(err.code || '');
      if (/limit/.test(c)) throw fail('limit');
      if (/key|auth|permission|access/.test(c)) throw fail('auth');
      throw fail('http');
    }
    if (r.status === 401 || r.status === 403) throw fail('auth');
    if (r.status === 429) throw fail('limit');
    if (!r.ok || !body) throw fail('http');
    return body.response;
  }

  const toMin = hm => { const m = /^(\d{1,2}):(\d{2})/.exec(hm || ''); return m ? +m[1] * 60 + +m[2] : null; };
  // 현지시각 - UTC (분), -12h~+14h로 맞춤
  const offset = (local, utc) => {
    const a = toMin(local), b = toMin(utc);
    if (a === null || b === null) return null;
    let d = a - b;
    if (d < -720) d += 1440;
    if (d > 840) d -= 1440;
    return d;
  };
  const addDays = (iso, n) => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  async function airport(iata) {
    if (!iata) return null;
    try {
      const res = await call('airports', { iata_code: iata });
      return Array.isArray(res) && res[0] ? res[0] : null;
    } catch (e) { return null; } // 공항 이름·위치는 없어도 됨
  }
  async function airlineName(code) {
    if (!code) return '';
    try {
      const res = await call('airlines', { iata_code: code });
      return Array.isArray(res) && res[0] && res[0].name ? res[0].name : '';
    } catch (e) { return ''; }
  }

  // 편명의 정기 운항 시간표(routes)에서 그 날짜 요일에 맞는 편을 고름
  async function lookup(no, date) {
    if (!getKey()) throw fail('nokey');
    const list = await call('routes', { flight_iata: no });
    if (!Array.isArray(list) || !list.length) return null;
    const wd = WD[new Date(date + 'T00:00:00Z').getUTCDay()];
    const hit = list.find(r => Array.isArray(r.days) && r.days.includes(wd));
    const r = hit || list[0];
    const [dep, arr, airline] = await Promise.all([airport(r.dep_iata), airport(r.arr_iata), airlineName(r.airline_iata)]);

    // 도착 날짜: 출발 현지시각 + 비행시간 + 시차로 계산
    let arrDate = date;
    const depMin = toMin(r.dep_time), dur = Number(r.duration);
    const oDep = offset(r.dep_time, r.dep_time_utc), oArr = offset(r.arr_time, r.arr_time_utc);
    if (depMin !== null && dur > 0 && oDep !== null && oArr !== null) {
      arrDate = addDays(date, Math.floor((depMin + dur + (oArr - oDep)) / 1440));
    } else if (toMin(r.arr_time) !== null && depMin !== null && toMin(r.arr_time) < depMin) {
      arrDate = addDays(date, 1);
    }
    const term = v => Array.isArray(v) ? v.filter(Boolean).join(', ') : (v ? String(v) : '');
    const end = (ap, iata, time, d, t) => ({
      iata: iata || '',
      city: (ap && (ap.city || ap.name)) || '',
      date: d, time: /^\d{2}:\d{2}/.test(time || '') ? time.slice(0, 5) : '',
      terminal: term(t),
      lat: ap && typeof ap.lat === 'number' ? ap.lat : null,
      lng: ap && typeof ap.lng === 'number' ? ap.lng : null,
    });
    return {
      no,
      airline,
      status: '',
      offDay: !hit, // 그 요일엔 정기편이 없음
      dep: end(dep, r.dep_iata, r.dep_time, date, r.dep_terminals),
      arr: end(arr, r.arr_iata, r.arr_time, arrDate, r.arr_terminals),
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

  // 편명 칸은 장소에 공항이 들어갔을 때(또는 이미 편명이 있을 때)만 보임
  const AIRPORT = /공항|airport|터미널|terminal/i;
  function syncVisible() {
    const show = AIRPORT.test($('#fPlace').value) || !!normNo($('#fFlight').value);
    $('#flightWrap').hidden = !show;
  }
  $('#fPlace').addEventListener('input', syncVisible);

  // 편집 시트 열 때
  function load(item) {
    current = item && item.flight ? JSON.parse(JSON.stringify(item.flight)) : null;
    $('#fFlight').value = current ? current.no : '';
    renderBox('');
    syncVisible();
  }

  // 저장할 때
  function read() {
    if ($('#flightWrap').hidden) return undefined;
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
        PQ.setPickedAddr(`${f.dep.city || '공항'}${f.dep.iata ? ` (${f.dep.iata})` : ''}`);
      }
      renderBox(f.offDay ? '이 날짜 요일에는 정기 운항편이 없어서 가장 가까운 시간표로 채웠어요. 항공권의 시각과 비교해 보세요.' : '정기 운항 시간표 기준이에요. 출발 전 실시간 운항 정보로 지연 여부를 확인하세요.');
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
