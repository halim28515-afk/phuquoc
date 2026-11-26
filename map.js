/* 푸꾸옥 여행 앱 – 지도 탭, 거리/요금, 장소 검색 */
(function () {
  'use strict';
  const PQ = window.PQ;
  const $ = sel => document.querySelector(sel);
  const esc = PQ.esc;

  const PQ_CENTER = [10.22, 103.96]; // 푸꾸옥 섬 중앙
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const PQ_VIEWBOX = '103.82,10.48,104.11,9.98'; // 푸꾸옥 섬 범위 (좌,상,우,하)
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
  const FARE_DEFAULT = {
    car4: { base: 29000, baseKm: 2, perKm: 10500, perMin: 400 },
    car7: { base: 34000, baseKm: 2, perKm: 13000, perMin: 500 },
    bike: { base: 13000, baseKm: 2, perKm: 4300, perMin: 0 },
    surge: 1,
  };
  const FARE_FIELDS = [
    ['base', '기본요금 (₫)', 1000],
    ['baseKm', '기본거리 (km)', 0.5],
    ['perKm', 'km당 (₫)', 100],
    ['perMin', '분당 (₫)', 50],
  ];

  function num(v, def, min, max) {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
  }
  function getFare() {
    const raw = PQ.state.fare || {};
    const out = { surge: num(raw.surge, FARE_DEFAULT.surge, 0.5, 3) };
    FARE_TYPES.forEach(({ key }) => {
      const r = raw[key] || {};
      const d = FARE_DEFAULT[key];
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
    const r = v => Math.round(v / 1000) * 1000;
    return { low: r(mid * 0.9), high: r(mid * 1.15) };
  }
  const fmtVnd = n => n.toLocaleString('ko-KR') + '₫';

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
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0e7c86';
  }

  function ensureMap() {
    if (map) return true;
    if (typeof L === 'undefined') {
      $('#mapNotice').textContent = '지도 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인하세요.';
      $('#mapNotice').hidden = false;
      return false;
    }
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView(PQ_CENTER, 10);
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
    if (!$('#tab-map').classList.contains('active')) return;
    if (!ensureMap()) { renderStops(); return; }
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
    $('#mapEmpty').hidden = pts.length > 0;
    // 날짜나 좌표 구성이 바뀌었을 때만 화면 맞춤 (선택 시 지도가 튀지 않게)
    const fitKey = PQ.currentDay + '|' + pts.map(p => p.join(',')).join(';');
    if (fitKey !== lastFitKey) {
      lastFitKey = fitKey;
      if (pts.length === 1) map.setView(pts[0], 14);
      else if (pts.length > 1) map.fitBounds(pts, { padding: [36, 36], maxZoom: 15 });
      else map.setView(PQ_CENTER, 10);
    }
    renderStops();
  }

  // 지도 아래 장소 목록 + 이전 장소로부터의 거리
  function renderStops() {
    const list = dayList();
    const ul = $('#stopList');
    ul.innerHTML = list.map((it, i) => `
      <li class="stop${hasCoord(it) ? '' : ' nocoord'}${it.id === selectedId ? ' sel' : ''}" data-id="${esc(it.id)}">
        <span class="idx">${i + 1}</span>
        <span class="st-time">${it.time || ''}</span>
        <span class="st-place">${esc(it.place)}</span>
        <span class="st-leg" data-leg="${esc(it.id)}">${hasCoord(it) ? '' : '좌표 없음'}</span>
      </li>`).join('') || '<li class="muted" style="padding:16px 4px">이 날 일정이 없어요.</li>';
    list.forEach((it, i) => {
      const prev = prevWithCoord(list, i);
      if (!hasCoord(it) || !prev) return;
      getLeg(prev, it).then(leg => {
        const el = ul.querySelector(`[data-leg="${CSS.escape(it.id)}"]`);
        if (el) el.textContent = `${leg.src === 'osrm' ? '' : '약 '}${fmtKm(leg.km)} · ${fmtMin(leg.min)}`;
      });
    });
  }

  function prevWithCoord(list, i) {
    for (let j = i - 1; j >= 0; j--) if (hasCoord(list[j])) return list[j];
    return null;
  }

  $('#stopList').addEventListener('click', e => {
    const li = e.target.closest('.stop');
    if (li) openInfo(li.dataset.id);
  });

  // ---------- 장소 정보 시트 ----------
  function select(id) {
    selectedId = id;
    Object.entries(markers).forEach(([mid, m]) => {
      const el = m.getElement && m.getElement();
      const pin = el && el.querySelector('.pin');
      if (pin) pin.classList.toggle('sel', mid === id);
    });
    document.querySelectorAll('#stopList .stop').forEach(li => li.classList.toggle('sel', li.dataset.id === id));
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
      gmaps.hidden = false; grab.hidden = false;
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
          renderFares(r);
        });
      }
    }
    PQ.openSheet('#infoSheet');
  }

  function renderFares(r) {
    const f = getFare();
    const rows = FARE_TYPES.map(({ key, name }) => {
      const e = estimate(r.km, r.min, f[key], f.surge);
      return `<div class="fare-row"><span>${name}</span><b>${fmtVnd(e.low)} ~ ${fmtVnd(e.high)}</b></div>`;
    }).join('');
    $('#infoFares').innerHTML = `<h3>그랩 요금 <span class="badge">예상치</span></h3>${rows}
      <p class="hint">거리 기반 계산이라 실제 요금과 달라요. 기준값은 지도 탭 오른쪽 위 ⚙︎에서 바꿀 수 있어요.${f.surge !== 1 ? ` (할증 ×${f.surge} 적용)` : ''}</p>`;
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
        <div class="row2">${FARE_FIELDS.map(([fk, label, step]) => `
          <label>${label}<input type="number" id="fare-${key}-${fk}" data-k="${key}" data-f="${fk}" step="${step}" min="0" inputmode="decimal" value="${f[key][fk]}"></label>`).join('')}
        </div>
      </fieldset>`).join('');
    $('#fSurge').value = f.surge;
  }
  $('#btnFareReset').addEventListener('click', () => fillFareForm(FARE_DEFAULT));
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
  async function nominatim(q, bounded) {
    const p = new URLSearchParams({
      format: 'jsonv2', q, limit: '6', 'accept-language': 'ko,en', countrycodes: 'vn',
    });
    if (bounded) { p.set('viewbox', PQ_VIEWBOX); p.set('bounded', '1'); }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(`${NOMINATIM}?${p}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  $('#btnSearch').addEventListener('click', async () => {
    const q = $('#fPlace').value.trim();
    const ul = $('#searchResults');
    if (!q) { PQ.toast('장소명을 먼저 입력하세요'); $('#fPlace').focus(); return; }
    if (searchBusy) return;
    searchBusy = true;
    $('#btnSearch').disabled = true;
    ul.hidden = false;
    ul.innerHTML = '<li class="sr-msg">검색 중…</li>';
    try {
      // 푸꾸옥 안에서 먼저 찾고, 없으면 베트남 전체에서
      let res = await nominatim(q, true);
      if (!res.length) {
        await new Promise(r => setTimeout(r, 1100)); // Nominatim 이용 정책: 초당 1회
        res = await nominatim(q, false);
      }
      if (!res.length) {
        ul.innerHTML = '<li class="sr-msg">검색 결과가 없어요. 영어 이름(예: Night Market Duong Dong)으로 찾거나 좌표를 직접 넣어주세요.</li>';
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
        ul.hidden = true;
        PQ.toast('좌표를 넣었어요');
      };
    } catch (err) {
      ul.innerHTML = '<li class="sr-msg">검색 서버에 연결하지 못했어요. 인터넷 연결을 확인하거나 좌표를 직접 넣어주세요.</li>';
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
  document.addEventListener('pq:tab', e => {
    if (e.detail === 'map') {
      PQ.render(); // 날짜 칩 위치 갱신 + 지도 그리기
      setTimeout(() => map && map.invalidateSize(), 50);
    }
  });
})();
