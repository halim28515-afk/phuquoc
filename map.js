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
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView(c || WORLD[0], c ? 11 : WORLD[1]);
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

    $('#infoTitle').textContent = `${i + 1}. ${it.place}`;
    $('#infoSub').textContent = [it.time, it.memo].filter(Boolean).join(' · ') || ' ';
    const leg = $('#infoLeg');
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
        leg.innerHTML = '<div class="route">이 날 첫 장소예요</div>이전 장소가 없어서 거리는 계산하지 않아요. 길찾기는 현재 위치에서 출발해요.';
        fares.innerHTML = '';
      } else {
        const pi = list.indexOf(prev) + 1;
        leg.innerHTML = `<div class="route">${pi}. ${esc(prev.place)} → ${i + 1}. ${esc(it.place)}</div><div class="big">계산 중…</div>`;
        fares.innerHTML = '';
        getLeg(prev, it).then(r => {
          if (token !== infoToken) return;
          leg.innerHTML = `<div class="route">${pi}. ${esc(prev.place)} → ${i + 1}. ${esc(it.place)}</div>
            <div class="big">${fmtKm(r.km)} · ${fmtMin(r.min)}</div>
            <div class="src">${r.src === 'osrm' ? '차량 도로 경로 기준 (OSRM)' : '경로 서버에 연결하지 못해 직선거리로 추정했어요'}</div>`;
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
  // "장소명 + 여행 목적지"로 먼저 찾고, 없으면 장소명만(그 나라 안 → 전체)
  async function searchPlace(place, trip) {
    const cc = TS.curOf(trip.currency).cc;
    const dest = [trip.city, trip.country].filter(Boolean).join(' ');
    const tries = [];
    if (dest) tries.push([`${place} ${dest}`, { cc, near: trip.center }]);
    tries.push([place, { cc, near: trip.center }]);
    if (cc) tries.push([place, {}]);
    for (let i = 0; i < tries.length; i++) {
      if (i) await wait(1100);
      const res = await nominatim(tries[i][0], tries[i][1]);
      if (res.length) return res;
    }
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
      const res = await nominatim([trip.city, trip.country].filter(Boolean).join(' '), { cc: TS.curOf(trip.currency).cc });
      if (res.length && TS.get(trip.id)) {
        trip.center = [Number(res[0].lat), Number(res[0].lon)];
        TS.save();
        if (PQ.state.id === trip.id) renderMap();
      }
    } catch (e) { /* 오프라인이면 다음에 */ }
  }

  $('#btnSearch').addEventListener('click', async () => {
    const q = $('#fPlace').value.trim();
    const ul = $('#searchResults');
    if (!q) { PQ.toast('장소명이나 주소를 먼저 입력하세요'); $('#fPlace').focus(); return; }
    if (searchBusy) return;
    searchBusy = true;
    $('#btnSearch').disabled = true;
    ul.hidden = false;
    ul.innerHTML = '<li class="sr-msg">검색 중…</li>';
    try {
      const res = await searchPlace(q, PQ.state);
      if (!res.length) {
        ul.innerHTML = '<li class="sr-msg">검색 결과가 없어요. 주소를 더 자세히 쓰거나 영어 이름으로 다시 검색해 보세요.</li>';
        return;
      }
      ul.innerHTML = res.map((r, i) => {
        const name = r.name || String(r.display_name).split(',')[0];
        return `<li data-i="${i}"><div class="sr-name">${esc(name)}</div><div class="sr-addr">${esc(r.display_name)}</div></li>`;
      }).join('');
      ul.onclick = e => {
        const li = e.target.closest('li[data-i]');
        if (!li) return;
        const r = res[Number(li.dataset.i)];
        $('#fLat').value = Number(r.lat).toFixed(6);
        $('#fLng').value = Number(r.lon).toFixed(6);
        PQ.setPickedAddr(String(r.display_name || ''));
        ul.hidden = true;
        PQ.toast('주소를 넣었어요');
      };
    } catch (err) {
      ul.innerHTML = '<li class="sr-msg">주소 검색 서버에 연결하지 못했어요. 인터넷 연결을 확인하거나 아래 좌표 직접 입력을 써 주세요.</li>';
    } finally {
      searchBusy = false;
      $('#btnSearch').disabled = false;
    }
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
