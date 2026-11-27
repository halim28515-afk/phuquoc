/* 여행 플래너 – 동선 탭 지도, 거리/요금, 장소 검색 (현재 여행 기준) */
(function () {
  'use strict';
  const PQ = window.PQ;
  const $ = sel => document.querySelector(sel);
  const esc = PQ.esc;

  const TS = window.TripStore;
  const WORLD = [[15, 105], 3]; // 목적지 좌표를 모를 때 기본 화면
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const ROUTE_CACHE_KEY = 'pq-route-cache-v1';

  const GRAB_PLAY = 'https://play.google.com/store/apps/details?id=com.grabtaxi.passenger';
  const GRAB_APPSTORE = 'https://apps.apple.com/app/id647268330';

  // ---------- 그랩 요금 ----------
  // 기본값은 대략적인 예상치. 설정에서 수정 가능.
  const FARE_TYPES = [
    { key: 'car4', name: 'GrabCar 4인승' },
    { key: 'car7', name: 'GrabCar 7인승' },
    { key: 'bike', name: 'GrabBike' },
  ];
  // 베트남 동 기준 기본값. 다른 통화는 대략 환율로 바꿔서 시작값으로 씀
  const FARE_VND = {
    car4: { base: 29000, baseKm: 2, perKm: 10500, perMin: 400 },
    car7: { base: 34000, baseKm: 2, perKm: 13000, perMin: 500 },
    bike: { base: 13000, baseKm: 2, perKm: 4300, perMin: 0 },
  };
  // 유효숫자 2자리로 깔끔하게
  function nice(v) {
    if (!v) return 0;
    const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1);
    return Math.round(v / p) * p;
  }
  const localCur = () => PQ.state.currency || 'VND';
  function fareDefault() {
    const k = TS.curOf(localCur()).fb / TS.curOf('VND').fb;
    const out = { surge: 1 };
    Object.keys(FARE_VND).forEach(t => {
      const f = FARE_VND[t];
      out[t] = { base: nice(f.base * k), baseKm: f.baseKm, perKm: nice(f.perKm * k), perMin: nice(f.perMin * k) };
    });
    return out;
  }
  function fareFields() {
    const c = TS.curOf(localCur());
    const unit = c.code === 'VND' ? '₫' : c.sym;
    const step = nice(fareDefault().car4.perKm / 100) || (c.dec ? 0.01 : 1);
    return [
      ['base', `기본요금 (${unit})`, step],
      ['baseKm', '기본거리 (km)', 0.5],
      ['perKm', `km당 (${unit})`, step],
      ['perMin', `분당 (${unit})`, step],
    ];
  }
  // 그랩 서비스 국가(동남아)일 때만 그랩 버튼·요금 표시
  const GRAB_COUNTRY = /베트남|태국|필리핀|인도네시아|말레이시아|싱가포르|캄보디아|미얀마|vietnam|thailand|philippines|indonesia|malaysia|singapore|cambodia|myanmar/i;
  function isGrab(trip) {
    trip = trip || PQ.state;
    return TS.curOf(trip.currency).grab || GRAB_COUNTRY.test(trip.country || '');
  }
  PQ.isGrab = () => isGrab();

  function num(v, def, min, max) {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
  }
  function getFare() {
    const raw = PQ.state.fare || {};
    const DEF = fareDefault();
    const out = { surge: num(raw.surge, 1, 0.5, 3) };
    FARE_TYPES.forEach(({ key }) => {
      const r = raw[key] || {};
      const d = DEF[key];
      out[key] = {
        base: num(r.base, d.base, 0, 1e7),
        baseKm: num(r.baseKm, d.baseKm, 0, 100),
        perKm: num(r.perKm, d.perKm, 0, 1e6),
        perMin: num(r.perMin, d.perMin, 0, 1e6),
      };
    });
    return out;
  }
  function estimate(km, min, f, surge) {
    const raw = f.base + Math.max(0, km - f.baseKm) * f.perKm + min * f.perMin;
    const mid = Math.max(f.base, raw) * surge;
    return { low: nice(mid * 0.9), high: nice(mid * 1.15) };
  }
  const fmtLocal = n => PQ.fx.fmtCur(n, localCur());

  // ---------- 거리/시간 ----------
  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  let routeCache = {};
  try { routeCache = JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY)) || {}; } catch (e) { routeCache = {}; }
  const pending = {};

  // a → b 도로 거리(km)/시간(분). 서버 실패 시 직선거리 × 1.35, 평균 28km/h로 추정
  function getLeg(a, b) {
    const key = `${a.lat},${a.lng};${b.lat},${b.lng}`;
    if (routeCache[key]) return Promise.resolve(routeCache[key]);
    if (pending[key]) return pending[key];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    pending[key] = fetch(`${OSRM}${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(j => {
        if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error(j.code || 'no route');
        const leg = { km: j.routes[0].distance / 1000, min: j.routes[0].duration / 60, src: 'osrm' };
        routeCache[key] = leg;
        try { localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(routeCache)); } catch (e) { /* noop */ }
        return leg;
      })
      .catch(() => {
        const km = haversineKm(a, b) * 1.35;
        return { km, min: km / 28 * 60, src: 'estimate' };
      })
      .finally(() => { clearTimeout(timer); delete pending[key]; });
    return pending[key];
  }
  const fmtKm = km => (km < 10 ? km.toFixed(1) : Math.round(km)) + ' km';
  const fmtMin = m => {
    m = Math.max(1, Math.round(m));
    return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60 ? (m % 60) + '분' : ''}`.trim();
  };

  // ---------- 지도 ----------
  let map = null, markerLayer = null, lineLayer = null, tileOk = false;
  let markers = {};
  let selectedId = null;
  let lastFitKey = '';

  const hasCoord = it => it.lat !== null && it.lng !== null;
  const dayList = () => PQ.state.days[PQ.currentDay] || [];

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#324680';
  }

  function ensureMap() {
    if (map) return true;
    if (typeof L === 'undefined') {
      $('#mapNotice').textContent = '지도 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인하세요.';
      $('#mapNotice').hidden = false;
      return false;
    }
    const c = PQ.state.center;
    map = L.map('map', { zoomControl: true, attributionControl: false }) // 출처는 페이지 맨 아래에 표시.setView(c || WORLD[0], c ? 11 : WORLD[1]);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    tiles.on('tileload', () => { tileOk = true; $('#mapNotice').hidden = true; });
    tiles.on('tileerror', () => { if (!tileOk) $('#mapNotice').hidden = false; });
    lineLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    return true;
  }

  function renderMap() {
    if (!$('#tab-route').classList.contains('active')) return;
    if (!ensureMap()) return;
    map.invalidateSize();
    markerLayer.clearLayers();
    lineLayer.clearLayers();
    markers = {};
    const list = dayList();
    const pts = [];
    list.forEach((it, i) => {
      if (!hasCoord(it)) return;
      const ll = [it.lat, it.lng];
      pts.push(ll);
      const icon = L.divIcon({
        className: 'pin-wrap',
        html: `<div class="pin${it.id === selectedId ? ' sel' : ''}"><span>${i + 1}</span></div>`,
        iconSize: [28, 28], iconAnchor: [14, 28],
      });
      const m = L.marker(ll, { icon, title: it.place, keyboard: true }).addTo(markerLayer);
      m.on('click', () => openInfo(it.id));
      markers[it.id] = m;
    });
    if (pts.length > 1) {
      L.polyline(pts, { color: cssVar('--primary'), weight: 4, opacity: .85, dashArray: '8 8' }).addTo(lineLayer);
    }
    $('#mapEmpty').hidden = pts.length > 0 || !list.length; // 일정 자체가 없으면 아래 안내로 충분
    // 날짜나 좌표 구성이 바뀌었을 때만 화면 맞춤 (선택 시 지도가 튀지 않게)
    const fitKey = PQ.state.id + '|' + PQ.currentDay + '|' + pts.map(p => p.join(',')).join(';') + '|' + (PQ.state.center || '');
    if (fitKey !== lastFitKey) {
      lastFitKey = fitKey;
      if (pts.length === 1) map.setView(pts[0], 14);
      else if (pts.length > 1) map.fitBounds(pts, { padding: [36, 36], maxZoom: 15 });
      else if (PQ.state.center) map.setView(PQ.state.center, 11);
      else { map.setView(WORLD[0], WORLD[1]); geocodeDestination(); }
    }
    markSelectedCard();
  }

  function prevWithCoord(list, i) {
    for (let j = i - 1; j >= 0; j--) if (hasCoord(list[j])) return list[j];
    return null;
  }

  // 시트가 열린 일정 카드 강조
  function markSelectedCard() {
    const open = !$('#infoSheet').hidden;
    document.querySelectorAll('#cardList .card').forEach(li => li.classList.toggle('sel', open && li.dataset.id === selectedId));
  }

  // ---------- 장소 정보 시트 ----------
  function select(id) {
    selectedId = id;
    Object.entries(markers).forEach(([mid, m]) => {
      const el = m.getElement && m.getElement();
      const pin = el && el.querySelector('.pin');
      if (pin) pin.classList.toggle('sel', mid === id);
    });
    markSelectedCard();
    const m = markers[id];
    if (m && map) map.panTo(m.getLatLng(), { animate: true });
  }

  let infoToken = 0;
  function openInfo(id) {
    const list = dayList();
    const i = list.findIndex(it => it.id === id);
    if (i < 0) return;
    const it = list[i];
    const prev = prevWithCoord(list, i);
    select(id);
    const token = ++infoToken;

    $('#infoTitle').textContent = it.place;
    $('#infoSub').textContent = [it.time, it.flight && PQ.flight ? '✈️ ' + it.flight.no : ''].filter(Boolean).join(' · ') || ' ';
    $('#infoMemo').textContent = it.memo || '';
    $('#infoMemo').hidden = !it.memo;
    const leg = $('#infoLeg');
    leg.hidden = false;
    const fares = $('#infoFares');
    const gmaps = $('#btnGmaps');
    const grab = $('#btnGrab');

    if (!hasCoord(it)) {
      leg.innerHTML = '이 일정에는 좌표가 없어요. <b>일정 수정</b>에서 장소를 검색해 좌표를 넣으면 거리와 요금을 볼 수 있어요.';
      fares.innerHTML = '';
      gmaps.hidden = true; grab.hidden = true;
    } else {
      const grabOn = isGrab();
      gmaps.hidden = false; grab.hidden = !grabOn;
      document.querySelector('.info-actions').classList.toggle('single', !grabOn);
      const q = new URLSearchParams({ api: '1', destination: `${it.lat},${it.lng}`, travelmode: 'driving' });
      if (prev) q.set('origin', `${prev.lat},${prev.lng}`);
      gmaps.href = 'https://www.google.com/maps/dir/?' + q.toString();
      grab.onclick = () => openGrab(prev, it);

      if (!prev) {
        leg.innerHTML = '';
        leg.hidden = true;
        fares.innerHTML = '';
      } else {
        const pi = list.indexOf(prev) + 1;
        leg.innerHTML = `<div class="route">${pi}. ${esc(prev.place)} → ${i + 1}. ${esc(it.place)}</div><div class="big">계산 중…</div>`;
        fares.innerHTML = '';
        getLeg(prev, it).then(r => {
          if (token !== infoToken) return;
          leg.innerHTML = `<div class="route">${pi}. ${esc(prev.place)} → ${i + 1}. ${esc(it.place)}</div>
            <div class="big">${fmtKm(r.km)} · ${fmtMin(r.min)}</div>
            <div class="src">${r.src === 'osrm' ? '차량 도로 경로 기준' : '경로 서버에 연결하지 못해 직선거리로 추정했어요'}</div>`;
          if (isGrab()) renderFares(r);
        });
      }
    }
    PQ.openSheet('#infoSheet');
    markSelectedCard();
  }
  PQ.openInfo = openInfo;
  // 시트 닫히면 카드 강조 해제
  new MutationObserver(markSelectedCard).observe($('#infoSheet'), { attributes: true, attributeFilter: ['hidden'] });

  function renderFares(r) {
    const f = getFare();
    const rows = FARE_TYPES.map(({ key, name }) => {
      const e = estimate(r.km, r.min, f[key], f.surge);
      const krw = localCur() !== 'KRW' ? `<span class="krw">약 ${PQ.fx.fmtKrw(e.low).replace('원', '')} ~ ${PQ.fx.fmtKrw(e.high)}</span>` : '';
      return `<div class="fare-row"><span>${name}</span><b>${fmtLocal(e.low)} ~ ${fmtLocal(e.high)}${krw}</b></div>`;
    }).join('');
    $('#infoFares').innerHTML = `<h3>그랩 요금 <span class="badge">예상치</span></h3>${rows}
      <p class="hint">거리 기반 계산이라 실제 요금과 달라요. 기준값은 오른쪽 위 ⋯ 메뉴의 ‘그랩 요금 기준 설정’에서 바꿀 수 있어요.${f.surge !== 1 ? ` (할증 ×${f.surge} 적용)` : ''}</p>`;
  }

  $('#btnInfoEdit').addEventListener('click', () => {
    const found = PQ.findItem(selectedId);
    PQ.closeSheet('#infoSheet');
    if (found) PQ.openEditor(found.item);
  });

  // ---------- 그랩 열기 ----------
  // 앱이 있으면 목적지를 넣은 예약 화면, 없으면 스토어로
  function openGrab(from, to) {
    const q = new URLSearchParams({
      screenType: 'BOOKING',
      dropOffLatitude: to.lat, dropOffLongitude: to.lng, dropOffAddress: to.place, dropOffKeywords: to.place,
    });
    if (from) {
      q.set('pickUpLatitude', from.lat); q.set('pickUpLongitude', from.lng);
      q.set('pickUpAddress', from.place); q.set('pickUpKeywords', from.place);
    }
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) {
      location.href = `intent://open?${q}#Intent;scheme=grab;package=com.grabtaxi.passenger;S.browser_fallback_url=${encodeURIComponent(GRAB_PLAY)};end`;
    } else if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      const t = setTimeout(() => { if (!document.hidden) location.href = GRAB_APPSTORE; }, 1800);
      document.addEventListener('visibilitychange', () => clearTimeout(t), { once: true });
      location.href = 'grab://open?' + q;
    } else {
      PQ.toast('그랩 앱은 휴대폰에서 열려요');
      const a = document.createElement('a');
      a.href = GRAB_PLAY; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    }
  }

  // ---------- 요금 설정 ----------
  PQ.openFareSettings = function () {
    fillFareForm(getFare());
    PQ.openSheet('#fareSheet');
  };
  function fillFareForm(f) {
    $('#fareFields').innerHTML = FARE_TYPES.map(({ key, name }) => `
      <fieldset class="fare-group"><legend>${name}</legend>
        <div class="row2">${fareFields().map(([fk, label, step]) => `
          <label>${label}<input type="number" id="fare-${key}-${fk}" data-k="${key}" data-f="${fk}" step="${step}" min="0" inputmode="decimal" value="${f[key][fk]}"></label>`).join('')}
        </div>
      </fieldset>`).join('');
    $('#fSurge').value = f.surge;
  }
  $('#btnFareReset').addEventListener('click', () => fillFareForm(fareDefault()));
  $('#fareForm').addEventListener('submit', e => {
    e.preventDefault();
    const out = { surge: num($('#fSurge').value, 1, 0.5, 3) };
    let bad = false;
    FARE_TYPES.forEach(({ key }) => { out[key] = {}; });
    document.querySelectorAll('#fareFields input').forEach(inp => {
      const v = Number(inp.value);
      if (inp.value === '' || !Number.isFinite(v) || v < 0) bad = true;
      out[inp.dataset.k][inp.dataset.f] = v;
    });
    if (bad) { PQ.toast('0 이상의 숫자를 입력하세요'); return; }
    PQ.state.fare = out;
    PQ.save();
    PQ.closeSheet('#fareSheet');
    PQ.toast('요금 기준을 저장했어요');
  });

  // ---------- 장소 검색 (Nominatim) ----------
  let searchBusy = false;
  // opts: { cc: 국가코드, near: [lat,lng] (그 근처 우선) }
  async function nominatim(q, opts) {
    opts = opts || {};
    const p = new URLSearchParams({ format: 'jsonv2', q, limit: '6', 'accept-language': 'ko,en' });
    if (opts.cc) p.set('countrycodes', opts.cc);
    if (opts.near) {
      const [la, ln] = opts.near;
      p.set('viewbox', [ln - 0.6, la + 0.6, ln + 0.6, la - 0.6].join(','));
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(`${NOMINATIM}?${p}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  const wait = ms => new Promise(r => setTimeout(r, ms)); // Nominatim 이용 정책: 초당 1회

  // ---------- 한국어 검색어 → 영어 (지도 데이터는 대부분 영어·현지어) ----------
  const KO_WORDS = [
    // 여행지
    ['푸꾸옥', 'Phu Quoc'], ['다낭', 'Da Nang'], ['호치민', 'Ho Chi Minh'], ['하노이', 'Hanoi'], ['나트랑', 'Nha Trang'],
    ['냐짱', 'Nha Trang'], ['호이안', 'Hoi An'], ['달랏', 'Da Lat'], ['하롱베이', 'Ha Long Bay'], ['사파', 'Sa Pa'], ['무이네', 'Mui Ne'],
    ['방콕', 'Bangkok'], ['파타야', 'Pattaya'], ['푸켓', 'Phuket'], ['치앙마이', 'Chiang Mai'], ['끄라비', 'Krabi'], ['코사무이', 'Koh Samui'],
    ['세부', 'Cebu'], ['보라카이', 'Boracay'], ['보홀', 'Bohol'], ['마닐라', 'Manila'], ['코타키나발루', 'Kota Kinabalu'],
    ['쿠알라룸푸르', 'Kuala Lumpur'], ['싱가포르', 'Singapore'], ['발리', 'Bali'], ['자카르타', 'Jakarta'],
    ['도쿄', 'Tokyo'], ['오사카', 'Osaka'], ['교토', 'Kyoto'], ['후쿠오카', 'Fukuoka'], ['삿포로', 'Sapporo'], ['오키나와', 'Okinawa'], ['나고야', 'Nagoya'],
    ['타이베이', 'Taipei'], ['가오슝', 'Kaohsiung'], ['홍콩', 'Hong Kong'], ['마카오', 'Macau'], ['상하이', 'Shanghai'], ['베이징', 'Beijing'],
    ['괌', 'Guam'], ['사이판', 'Saipan'], ['하와이', 'Hawaii'], ['호놀룰루', 'Honolulu'], ['시드니', 'Sydney'],
    ['파리', 'Paris'], ['런던', 'London'], ['로마', 'Rome'], ['바르셀로나', 'Barcelona'], ['뉴욕', 'New York'],
    ['인천', 'Incheon'], ['김포', 'Gimpo'], ['김해', 'Gimhae'], ['제주', 'Jeju'],
    // 푸꾸옥 지명
    ['즈엉동', 'Duong Dong'], ['안터이', 'An Thoi'], ['혼텀', 'Hon Thom'], ['사오비치', 'Sao Beach'], ['선셋타운', 'Sunset Town'],
    ['그랜드월드', 'Grand World'], ['빈원더스', 'VinWonders'], ['빈펄', 'Vinpearl'], ['선월드', 'Sun World'], ['키스브릿지', 'Kiss Bridge'],
    ['롱비치', 'Long Beach'], ['켐비치', 'Kem Beach'], ['옹랑', 'Ong Lang'], ['함닌', 'Ham Ninh'],
    // 일반 단어 (긴 것부터 바뀌도록 정렬됨)
    ['국제공항', 'International Airport'], ['공항', 'Airport'], ['터미널', 'Terminal'], ['야시장', 'Night Market'], ['시장', 'Market'],
    ['해변', 'Beach'], ['비치', 'Beach'], ['리조트', 'Resort'], ['호텔', 'Hotel'], ['케이블카', 'Cable Car'], ['폭포', 'Waterfall'],
    ['사원', 'Temple'], ['성당', 'Cathedral'], ['박물관', 'Museum'], ['공원', 'Park'], ['항구', 'Port'], ['선착장', 'Pier'],
    ['기차역', 'Railway Station'], ['역', 'Station'], ['섬', 'Island'], ['쇼핑몰', 'Mall'], ['마트', 'Mart'], ['병원', 'Hospital'],
    ['인터컨티넨탈', 'InterContinental'], ['그린베이', 'Green Bay'], ['노보텔', 'Novotel'], ['메리어트', 'Marriott'], ['힐튼', 'Hilton'],
    ['쉐라톤', 'Sheraton'], ['하얏트', 'Hyatt'], ['롯데마트', 'Lotte Mart'], ['스타벅스', 'Starbucks'],
  ].sort((a, b) => b[0].length - a[0].length);
  const HANGUL = /[가-힣]/;
  function koToEn(text) {
    let s = String(text || '');
    if (!HANGUL.test(s)) return s.trim();
    KO_WORDS.forEach(([ko, en]) => { s = s.split(ko).join(` ${en} `); });
    // 남은 한글 조사·꾸밈말(도착, 출발, 근처 등)은 검색에 방해돼서 뺌
    s = s.split(/\s+/).filter(w => w && !HANGUL.test(w)).join(' ');
    return s.trim();
  }
  PQ.koToEn = koToEn;

  // ---------- Photon (입력하는 동안 추천 장소, 자동완성용 공개 검색) ----------
  const PHOTON = 'https://photon.komoot.io/api/';
  async function photon(q, near) {
    const p = new URLSearchParams({ q, limit: '6', lang: 'en' });
    if (near) { p.set('lat', near[0]); p.set('lon', near[1]); }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`${PHOTON}?${p}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return (j.features || []).map(f => {
        const pr = f.properties || {};
        const c = (f.geometry && f.geometry.coordinates) || [];
        const addr = [pr.name, [pr.housenumber, pr.street].filter(Boolean).join(' '), pr.district, pr.city, pr.state, pr.country]
          .filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
        return { name: pr.name || addr.split(',')[0], display_name: addr, lat: c[1], lon: c[0] };
      }).filter(r => typeof r.lat === 'number' && typeof r.lon === 'number');
    } finally { clearTimeout(t); }
  }

  // 여행 목적지 이름(영어로 바꾼 것)
  const destEn = trip => koToEn([trip.city, trip.country].filter(Boolean).join(' '));
  // 한 장소가 여러 번 나오면 하나만
  const uniqRes = list => {
    const seen = new Set();
    return list.filter(r => { const k = `${Number(r.lat).toFixed(4)},${Number(r.lon).toFixed(4)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  };

  // 검색 버튼: Photon으로 먼저 찾고, 없으면 Nominatim (영어로 바꾼 검색어 → 원래 검색어)
  async function searchPlace(place, trip) {
    const cc = TS.curOf(trip.currency).cc;
    const en = koToEn(place);
    const dest = destEn(trip);
    let netFail = 0, tried = 0;
    const variants = [...new Set([en, place.trim()].filter(Boolean))];

    for (const q of variants) {
      tried++;
      try {
        const res = await photon(q, trip.center);
        if (res.length) return uniqRes(res);
      } catch (e) { netFail++; }
    }
    const tries = [];
    variants.forEach(q => {
      if (dest && !q.toLowerCase().includes(dest.toLowerCase())) tries.push([`${q} ${dest}`, { cc, near: trip.center }]);
      tries.push([q, { cc, near: trip.center }]);
    });
    if (cc) tries.push([variants[0], {}]);
    for (let i = 0; i < tries.length; i++) {
      if (i) await wait(1100);
      tried++;
      try {
        const res = await nominatim(tries[i][0], tries[i][1]);
        if (res.length) return uniqRes(res);
      } catch (e) { netFail++; }
    }
    if (netFail === tried) throw new Error('net');
    return [];
  }
  PQ.searchPlace = searchPlace;

  // 목적지 좌표(지도 기본 화면)를 모르면 한 번 찾아서 여행에 저장
  const geoTried = new Set();
  async function geocodeDestination() {
    const trip = PQ.state;
    if (trip.center || trip.id === '__blank__' || geoTried.has(trip.id) || !trip.city) return;
    geoTried.add(trip.id);
    try {
      const res = await nominatim(destEn(trip) || [trip.city, trip.country].filter(Boolean).join(' '), { cc: TS.curOf(trip.currency).cc });
      if (res.length && TS.get(trip.id)) {
        trip.center = [Number(res[0].lat), Number(res[0].lon)];
        TS.save();
        if (PQ.state.id === trip.id) renderMap();
      }
    } catch (e) { /* 오프라인이면 다음에 */ }
  }

  // ---------- 구글 장소 검색 (Places API, 키가 있을 때) ----------
  const GKEY_STORE = 'gplaces-key'; // 이 기기에만 저장
  const getGKey = () => { try { return localStorage.getItem(GKEY_STORE) || ''; } catch (e) { return ''; } };
  const setGKey = v => { try { v ? localStorage.setItem(GKEY_STORE, v) : localStorage.removeItem(GKEY_STORE); } catch (e) { /* noop */ } };
  const GAPI = 'https://places.googleapis.com/v1/';
  let gSession = '';
  const newSession = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const gFail = code => { const e = new Error(code); e.code = code; return e; };

  async function gFetch(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let r;
    try { r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts)); }
    catch (e) { throw gFail('net'); }
    finally { clearTimeout(timer); }
    if (!r.ok) {
      // 구글이 알려준 이유(영어)를 그대로 보여줘서 원인을 알 수 있게
      const j = await r.json().catch(() => null);
      const g = j && j.error ? j.error : {};
      const reason = [g.status, (g.details || []).map(d => d.reason).filter(Boolean).join(','), g.message].filter(Boolean).join(' · ');
      const e = gFail(r.status === 429 ? 'limit' : (r.status === 400 || r.status === 401 || r.status === 403) ? 'auth' : 'http');
      e.detail = `HTTP ${r.status}${reason ? ' · ' + reason : ''}`;
      throw e;
    }
    return r.json();
  }

  // 입력한 글자로 추천 장소 (한국어 그대로)
  async function gAutocomplete(input, near) {
    if (!gSession) gSession = newSession();
    const body = { input, languageCode: 'ko', sessionToken: gSession };
    if (near) body.locationBias = { circle: { center: { latitude: near[0], longitude: near[1] }, radius: 50000 } };
    const j = await gFetch(GAPI + 'places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': getGKey() },
      body: JSON.stringify(body),
    });
    return (j.suggestions || []).map(s => s.placePrediction).filter(Boolean).map(p => {
      const sf = p.structuredFormat || {};
      return {
        placeId: p.placeId,
        name: (sf.mainText && sf.mainText.text) || (p.text && p.text.text) || '',
        display_name: (sf.secondaryText && sf.secondaryText.text) || (p.text && p.text.text) || '',
      };
    });
  }
  // 고른 장소의 위치·주소
  async function gDetails(placeId) {
    const q = new URLSearchParams({ languageCode: 'ko' });
    if (gSession) q.set('sessionToken', gSession);
    const j = await gFetch(`${GAPI}places/${encodeURIComponent(placeId)}?${q}`, {
      headers: { 'X-Goog-Api-Key': getGKey(), 'X-Goog-FieldMask': 'location,formattedAddress,displayName' },
    });
    gSession = ''; // 한 번 고르면 검색 묶음 끝
    const loc = j.location || {};
    return {
      lat: loc.latitude, lon: loc.longitude,
      display_name: j.formattedAddress || '',
      name: (j.displayName && j.displayName.text) || '',
    };
  }
  const gMsg = (code, detail) => ({
    auth: '구글 API 키를 확인하세요. 구글 클라우드에서 Places API (New)가 켜져 있어야 해요.',
    limit: '구글 검색 사용량 한도를 넘었어요. 잠시 뒤 다시 해 주세요.',
    net: '구글 검색 서버에 연결하지 못했어요. 인터넷 연결을 확인하세요.',
  }[code] || '구글 검색 중 문제가 생겼어요.') + (detail ? `\n(구글 응답: ${detail})` : '');

  // 검색 결과·추천 목록을 보여주고, 고르면 위치와 주소를 넣음
  function showResults(res, title, google) {
    const ul = $('#searchResults');
    ul.hidden = false;
    ul.innerHTML = (title ? `<li class="sr-msg sr-title">${esc(title)}</li>` : '') + res.map((r, i) => {
      const name = r.name || String(r.display_name).split(',')[0];
      return `<li data-i="${i}"><div class="sr-name">${esc(name)}</div><div class="sr-addr">${esc(r.display_name)}</div></li>`;
    }).join('') + (google ? '<li class="sr-msg sr-by">Google 제공</li>' : '');
    ul.onclick = async e => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      let r = res[Number(li.dataset.i)];
      suggestRun++; // 진행 중인 추천은 무시
      if (r.placeId && typeof r.lat !== 'number') {
        li.classList.add('loading');
        try {
          const d = await gDetails(r.placeId);
          r = Object.assign({}, r, d, { name: d.name || r.name, display_name: d.display_name || r.display_name });
        } catch (err) {
          li.classList.remove('loading');
          PQ.toast(gMsg(err.code, err.detail));
          return;
        }
      }
      if (typeof r.lat !== 'number' || typeof r.lon !== 'number') { PQ.toast('이 장소의 위치를 받지 못했어요'); return; }
      $('#fLat').value = Number(r.lat).toFixed(6);
      $('#fLng').value = Number(r.lon).toFixed(6);
      PQ.setPickedAddr(String(r.display_name || ''));
      // 장소명이 비어 있으면 고른 장소 이름으로
      if (!$('#fPlace').value.trim()) $('#fPlace').value = r.name || '';
      ul.hidden = true;
      PQ.toast('주소를 넣었어요');
    };
  }

  // 추천 장소 찾기: 구글 키가 있으면 구글(한국어 그대로), 없으면 Photon(영어로 바꿔서)
  async function suggest(q) {
    if (getGKey()) {
      const res = await gAutocomplete(q, PQ.state.center);
      return { res, title: '추천 장소', google: true };
    }
    const en = koToEn(q);
    if (!en) return { res: [] };
    const res = uniqRes(await photon(en, PQ.state.center));
    return { res, title: en !== q ? `추천 장소 · "${en}"로 찾았어요` : '추천 장소' };
  }

  // 입력하는 동안 추천 장소
  let suggestTimer = null, suggestRun = 0;
  $('#fPlace').addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = $('#fPlace').value.trim();
    const run = ++suggestRun;
    if (q.length < 2) { $('#searchResults').hidden = true; return; }
    suggestTimer = setTimeout(async () => {
      let out;
      try { out = await suggest(q); } catch (e) { return; } // 오프라인이면 조용히
      if (run !== suggestRun || searchBusy) return;
      if (!out.res.length) { $('#searchResults').hidden = true; return; }
      showResults(out.res, out.title, out.google);
    }, getGKey() ? 300 : 500);
  });

  $('#btnSearch').addEventListener('click', async () => {
    const q = $('#fPlace').value.trim();
    const ul = $('#searchResults');
    if (!q) { PQ.toast('장소명이나 주소를 먼저 입력하세요'); $('#fPlace').focus(); return; }
    if (searchBusy) return;
    searchBusy = true;
    suggestRun++;
    clearTimeout(suggestTimer);
    $('#btnSearch').disabled = true;
    ul.hidden = false;
    ul.onclick = null;
    ul.innerHTML = '<li class="sr-msg">검색 중…</li>';
    try {
      if (getGKey()) {
        try {
          const res = await gAutocomplete(q, PQ.state.center);
          if (res.length) { showResults(res, '', true); return; }
        } catch (err) {
          ul.innerHTML = `<li class="sr-msg sr-err">${esc(gMsg(err.code, err.detail))}</li>`;
          return;
        }
      }
      const res = await searchPlace(q, PQ.state);
      if (!res.length) {
        ul.innerHTML = '<li class="sr-msg">검색 결과가 없어요. 장소 이름을 바꾸거나 주소를 더 자세히 써 보세요.</li>';
        return;
      }
      showResults(res);
    } catch (err) {
      ul.innerHTML = '<li class="sr-msg">주소 검색 서버에 연결하지 못했어요. 인터넷 연결을 확인하거나 아래 좌표 직접 입력을 써 주세요.</li>';
    } finally {
      searchBusy = false;
      $('#btnSearch').disabled = false;
    }
  });

  // ---------- 구글 키 설정 ----------
  $('#btnPlaceKey').addEventListener('click', () => {
    PQ.closeSheet('#menuSheet');
    $('#fPlaceKey').value = getGKey();
    PQ.openSheet('#placeKeySheet');
  });
  $('#placeKeyForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#fPlaceKey').value.trim();
    setGKey(v);
    gSession = '';
    PQ.closeSheet('#placeKeySheet');
    PQ.toast(v ? '구글 API 키를 저장했어요' : '구글 API 키를 지웠어요');
  });
  $('#btnPlaceKeyDel').addEventListener('click', () => {
    setGKey('');
    $('#fPlaceKey').value = '';
    PQ.closeSheet('#placeKeySheet');
    PQ.toast('구글 API 키를 지웠어요');
  });

  // ---------- 연결 ----------
  PQ.onRender(() => {
    renderMap();
    if (!$('#infoSheet').hidden && !PQ.findItem(selectedId)) PQ.closeSheet('#infoSheet');
  });
  // 여행을 바꾸면 선택·화면 맞춤 초기화
  document.addEventListener('pq:trip', () => { selectedId = null; lastFitKey = ''; });
  document.addEventListener('pq:tab', e => {
    if (e.detail === 'route') {
      PQ.render(); // 탭이 다시 보일 때 지도 크기 재계산
      setTimeout(() => map && map.invalidateSize(), 50);
    }
  });
})();
