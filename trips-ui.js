/* 여행 플래너 – 시작 화면, 여행 목록, 새 여행 만들기, 여행 관리 */
(function () {
  'use strict';
  const TS = window.TripStore;
  const PQ = window.PQ;
  const $ = sel => document.querySelector(sel);
  const esc = PQ.esc;

  const PAGES = ['#pageStart', '#pageTrips', '#pageNew', '#pageMethod'];
  function show(page) {
    PAGES.forEach(p => { $(p).hidden = p !== page; });
    document.body.classList.toggle('on-page', !!page);
    if (page) $(page).scrollTop = 0;
  }

  const fmtD = s => s.replace(/-/g, '.');
  function period(t) {
    const n = TS.tripDates(t).length;
    const end = t.end.slice(0, 4) === t.start.slice(0, 4) ? t.end.slice(5).replace('-', '.') : fmtD(t.end);
    return `${fmtD(t.start)} – ${end} · ${n - 1}박 ${n}일`;
  }
  const itemCount = t => Object.values(t.days).reduce((s, l) => s + l.length, 0);

  // ---------- 여행 목록 ----------
  function renderList() {
    const today = TS.todayISO();
    const trips = TS.trips.map(t => ({ t, st: TS.status(t, today) }));
    // 다가오는 여행(가까운 순) → 진행 중 → 지난 여행(최근 순)
    trips.sort((a, b) => a.st.order - b.st.order
      || (a.st.kind === 'past' ? b.t.end.localeCompare(a.t.end) : a.t.start.localeCompare(b.t.start)));
    const groups = [['upcoming', '다가오는 여행'], ['ongoing', '진행 중'], ['past', '지난 여행']];
    const list = $('#tripList');
    if (!trips.length) {
      list.innerHTML = '<div class="trip-empty">아직 여행이 없어요.<br>아래 <b>새로 시작하기</b>로 첫 여행을 만들어 보세요.</div>';
      return;
    }
    list.innerHTML = groups.map(([kind, label]) => {
      const items = trips.filter(x => x.st.kind === kind);
      if (!items.length) return '';
      return `<h2 class="trip-group">${label}</h2>` + items.map(({ t, st }) => {
        const cur = TS.curOf(t.currency);
        const total = PQ.tripTotalKrw ? PQ.tripTotalKrw(t) : 0;
        const place = [t.city, t.country].filter(Boolean).join(' · ');
        return `<article class="trip-card ${st.kind}" data-id="${esc(t.id)}" tabindex="0">
          <div class="tc-top">
            <span class="tc-status">${esc(st.label)}</span>
            <button type="button" class="tc-more" data-more="${esc(t.id)}" aria-label="${esc(t.name)} 메뉴">⋯</button>
          </div>
          <h3>${esc(t.name)}</h3>
          <p class="tc-place">${esc(place)}${place ? ' · ' : ''}${cur.code}</p>
          <p class="tc-period">${period(t)}</p>
          <div class="tc-stats"><span>📍 일정 ${itemCount(t)}개</span><span>💸 ${total ? PQ.fx.fmt(total) + '원' : '지출 없음'}</span></div>
        </article>`;
      }).join('');
    }).join('');
  }

  function showTrips() {
    renderList();
    show('#pageTrips');
  }
  PQ.showTrips = showTrips;

  function openTrip(id) {
    if (PQ.switchTrip(id)) show(null);
  }

  // 카드 탭 / 길게 누르기 / ⋯
  let pressTimer = null, pressed = false;
  $('#tripList').addEventListener('pointerdown', e => {
    const card = e.target.closest('.trip-card');
    if (!card || e.target.closest('.tc-more')) return;
    pressed = false;
    pressTimer = setTimeout(() => { pressed = true; openActions(card.dataset.id); }, 550);
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'pointermove'].forEach(ev => $('#tripList').addEventListener(ev, e => {
    if (ev === 'pointermove' && Math.abs(e.movementX) + Math.abs(e.movementY) < 4) return;
    clearTimeout(pressTimer);
  }));
  $('#tripList').addEventListener('contextmenu', e => { if (e.target.closest('.trip-card')) e.preventDefault(); });
  $('#tripList').addEventListener('click', e => {
    const more = e.target.closest('.tc-more');
    if (more) { openActions(more.dataset.more); return; }
    const card = e.target.closest('.trip-card');
    if (!card) return;
    if (pressed) { pressed = false; return; } // 길게 눌러 메뉴를 연 경우
    openTrip(card.dataset.id);
  });
  $('#tripList').addEventListener('keydown', e => {
    const card = e.target.closest('.trip-card');
    if (card && e.key === 'Enter') openTrip(card.dataset.id);
  });

  // ---------- 카드 메뉴 ----------
  let actId = null;
  function openActions(id) {
    const t = TS.get(id);
    if (!t) return;
    actId = id;
    $('#tripActTitle').textContent = t.name;
    PQ.openSheet('#tripActSheet');
  }
  $('#tripActSheet').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const t = TS.get(actId);
    PQ.closeSheet('#tripActSheet');
    if (!t) return;
    const act = b.dataset.act;
    if (act === 'open') openTrip(t.id);
    else if (act === 'edit') openForm(t);
    else if (act === 'dup') {
      const c = TS.duplicate(t.id);
      renderList();
      PQ.toast(`‘${c.name}’을 만들었어요`);
    } else if (act === 'export') {
      PQ.showExport(`‘${t.name}’ 내보내기`, TS.exportTrip(t.id), 'trip-' + t.start);
    } else if (act === 'delete') {
      const items = itemCount(t), ex = t.expenses.length;
      if (!await PQ.ask(`‘${t.name}’ 여행을 삭제할까요?`, '삭제', true)) return;
      if (!await PQ.ask(`정말 ‘${t.name}’을 삭제할까요?\n일정 ${items}개와 지출 ${ex}건이 모두 사라지고 되돌릴 수 없어요.`, '영구 삭제', true)) return;
      const wasCurrent = PQ.state.id === t.id;
      TS.remove(t.id);
      if (wasCurrent) PQ.clearTrip();
      renderList();
      PQ.toast('여행을 삭제했어요');
    }
  });

  // ---------- 새 여행 / 수정 폼 ----------
  let editId = null;
  let people = [];

  $('#nCurrency').innerHTML = TS.CURRENCIES.filter(c => c.code !== 'KRW')
    .map(c => `<option value="${c.code}">${c.code} · ${c.name}</option>`).join('') +
    '<option value="KRW">KRW · 대한민국 원 (국내 여행)</option>';

  function renderPeople() {
    $('#nPeople').innerHTML = people.length
      ? people.map((p, i) => `<span class="pchip">${esc(p)}<button type="button" data-i="${i}" aria-label="${esc(p)} 빼기">×</button></span>`).join('')
      : '<span class="muted">아직 없어요</span>';
  }
  function updateHints() {
    const s = $('#nStart').value, e = $('#nEnd').value;
    let msg = '';
    if (s && e) {
      const n = TS.diffDays(s, e);
      msg = n < 0 ? '종료일이 시작일보다 빨라요' : n > 59 ? '최대 60일까지 만들 수 있어요' : `${n}박 ${n + 1}일`;
    }
    $('#nDays').textContent = msg;
    const c = TS.curOf($('#nCurrency').value);
    $('#nCurHint').textContent = c.grab
      ? '그랩 서비스 국가예요. 동선 탭에서 그랩 예상 요금과 그랩 열기 버튼이 보여요.'
      : '동선 탭에서는 구글맵 길찾기만 보여요 (그랩 미서비스 지역).';
  }
  ['#nStart', '#nEnd', '#nCurrency'].forEach(s => $(s).addEventListener('change', updateHints));
  $('#nStart').addEventListener('change', () => {
    // 종료일이 비었거나 시작일보다 빠르면 맞춰 줌
    if ($('#nStart').value && (!$('#nEnd').value || $('#nEnd').value < $('#nStart').value)) $('#nEnd').value = $('#nStart').value;
    updateHints();
  });

  function openForm(trip) {
    editId = trip ? trip.id : null;
    $('#newTitle').textContent = trip ? '여행 정보 수정' : '새 여행';
    $('#newStep').hidden = !!trip;
    $('#btnNewNext').textContent = trip ? '저장' : '다음';
    $('#nPeopleBox').hidden = !!trip;
    $('#nUploadBox').hidden = !!trip;
    $('#nName').value = trip ? trip.name : '';
    $('#nCity').value = trip ? trip.city : '';
    $('#nCountry').value = trip ? trip.country : '';
    $('#nStart').value = trip ? trip.start : '';
    $('#nEnd').value = trip ? trip.end : '';
    $('#nCurrency').value = trip ? trip.currency : 'VND';
    people = [];
    $('#nPerson').value = '';
    renderPeople();
    updateHints();
    show('#pageNew');
    if (!trip) setTimeout(() => $('#nName').focus(), 50);
  }

  function addPerson() {
    const name = $('#nPerson').value.trim();
    if (!name) return;
    if (people.includes(name)) { PQ.toast('같은 이름이 이미 있어요'); return; }
    people.push(name);
    $('#nPerson').value = '';
    renderPeople();
    $('#nPerson').focus();
  }
  $('#btnAddPerson').addEventListener('click', addPerson);
  $('#nPerson').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } });
  $('#nPeople').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) { people.splice(Number(b.dataset.i), 1); renderPeople(); }
  });

  $('#newForm').addEventListener('submit', async e => {
    e.preventDefault();
    const info = {
      name: $('#nName').value.trim(),
      city: $('#nCity').value.trim(),
      country: $('#nCountry').value.trim(),
      start: $('#nStart').value,
      end: $('#nEnd').value,
      currency: $('#nCurrency').value,
    };
    if (!info.name) { PQ.toast('여행 이름을 입력하세요'); $('#nName').focus(); return; }
    if (!info.city) { PQ.toast('도시를 입력하세요'); $('#nCity').focus(); return; }
    if (!info.start || !info.end) { PQ.toast('시작일과 종료일을 고르세요'); return; }
    const n = TS.diffDays(info.start, info.end);
    if (n < 0) { PQ.toast('종료일이 시작일보다 빨라요'); return; }
    if (n > 59) { PQ.toast('최대 60일까지 만들 수 있어요'); return; }
    if (people.length === 0 && $('#nPerson').value.trim()) addPerson(); // 입력만 하고 추가를 안 누른 경우

    if (editId) {
      const t = TS.get(editId);
      if (t && info.currency !== t.currency && t.expenses.length) {
        if (!await PQ.ask(`통화를 ${t.currency}에서 ${info.currency}로 바꿔요. 이미 기록한 지출은 원래 통화 그대로 남아요. 계속할까요?`, '바꾸기')) return;
      }
      TS.updateInfo(editId, info);
      if (PQ.state.id === editId) PQ.render();
      PQ.toast('여행 정보를 저장했어요');
      showTrips();
      return;
    }
    info.people = people.map(name => ({ id: TS.uid(), name }));
    const t = TS.create(info);
    newTripId = t.id;
    $('#methodTrip').textContent = `‘${t.name}’ · ${period(t)}`;
    show('#pageMethod');
  });

  $('#btnNewCancel').addEventListener('click', () => {
    if (editId || TS.trips.length) showTrips(); else show('#pageStart');
  });

  // ---------- 일정 추가 방법 ----------
  let newTripId = null;
  $('#btnMethodManual').addEventListener('click', () => openTrip(newTripId));
  $('#btnMethodFile').addEventListener('click', () => {
    openTrip(newTripId);
    if (PQ.openFileImport) PQ.openFileImport();
    else PQ.toast('일정 파일 가져오기는 준비 중이에요. 직접 추가해 주세요');
  });

  $('#btnStart').addEventListener('click', showTrips);
  $('#btnNewTrip').addEventListener('click', () => openForm(null));

  // ---------- 여행 파일 업로드 (새로 시작하기 화면) ----------
  const importErr = err => PQ.toast('불러오기 실패: ' + (err instanceof SyntaxError ? 'JSON 형식 오류' : err.message));

  $('#btnUploadTrip').addEventListener('click', () => {
    PQ.showImport('여행 파일 업로드', '공유받은 여행 파일이나 백업 파일(JSON)을 고르거나 내용을 붙여넣으세요.', async text => {
      let res;
      try { res = TS.parseImport(text); } catch (err) { importErr(err); return; }
      PQ.closeSheet('#importSheet');
      if (res.kind === 'backup' && res.trips.length > 1) { openRestorePick(res.trips); return; }
      const t = res.kind === 'backup' ? res.trips[0] : res.trip;
      const same = TS.get(t.id);
      let replace = false;
      if (same) {
        replace = await PQ.ask(`이미 있는 여행 ‘${same.name}’이에요. 업로드한 내용으로 덮어쓸까요?`, '덮어쓰기', true);
        if (!replace && !await PQ.ask(`그럼 ‘${t.name}’을 새 여행으로 따로 추가할까요?`, '따로 추가')) return;
      }
      if (replace && PQ.state.id === t.id) PQ.clearTrip();
      const added = TS.addImported(t, replace);
      openTrip(added.id);
      PQ.toast(`‘${added.name}’을 불러왔어요`);
    });
  });

  // ---------- 여행 고르기 시트 (백업 / 복원 공용) ----------
  let pick = null; // { trips, selected:Set, onGo, mode }
  function renderPick() {
    const { trips, selected, mode } = pick;
    $('#pickList').innerHTML = trips.map(t => {
      const exists = mode === 'restore' && TS.get(t.id);
      const ex = (t.expenses || []).length;
      return `<li><label class="pick-row">
        <input type="checkbox" data-id="${esc(t.id)}" ${selected.has(t.id) ? 'checked' : ''}>
        <span class="pr-main"><b>${esc(t.name)}</b><small>${period(t)} · 일정 ${itemCount(t)}개 · 지출 ${ex}건</small>
        ${exists ? '<span class="pr-tag">이미 있음 → 덮어쓰기</span>' : mode === 'restore' ? '<span class="pr-tag new">새로 추가</span>' : ''}</span>
      </label></li>`;
    }).join('');
    const n = selected.size;
    $('#pickAll').checked = n === trips.length;
    $('#pickCount').textContent = `${n} / ${trips.length}개`;
    $('#btnPickGo').textContent = mode === 'backup' ? `${n}개 백업` : `${n}개 복원`;
    $('#btnPickGo').disabled = !n;
  }
  function openPick(opts) {
    pick = Object.assign({ selected: new Set(opts.trips.map(t => t.id)) }, opts);
    $('#pickTitle').textContent = opts.title;
    $('#pickHint').textContent = opts.hint;
    renderPick();
    PQ.openSheet('#pickSheet');
  }
  $('#pickList').addEventListener('change', e => {
    const cb = e.target.closest('input[data-id]');
    if (!cb) return;
    if (cb.checked) pick.selected.add(cb.dataset.id); else pick.selected.delete(cb.dataset.id);
    renderPick();
  });
  $('#pickAll').addEventListener('change', e => {
    pick.selected = e.target.checked ? new Set(pick.trips.map(t => t.id)) : new Set();
    renderPick();
  });
  $('#btnPickGo').addEventListener('click', () => { if (pick && pick.selected.size) pick.onGo([...pick.selected]); });

  // ---------- 백업 · 복원 ----------
  $('#btnTripsMenu').addEventListener('click', () => PQ.openSheet('#tripsMenuSheet'));

  $('#btnBackupAll').addEventListener('click', () => {
    PQ.closeSheet('#tripsMenuSheet');
    if (!TS.trips.length) { PQ.toast('백업할 여행이 없어요'); return; }
    openPick({
      mode: 'backup', trips: TS.trips,
      title: '백업할 여행 고르기',
      hint: '고른 여행을 파일 하나로 저장해요. 폰을 바꾸거나 다시 설치할 때 복원하기로 되살릴 수 있어요.',
      onGo: ids => {
        PQ.closeSheet('#pickSheet');
        const stamp = TS.todayISO().replace(/-/g, '');
        PQ.showExport(`백업 (여행 ${ids.length}개)`, TS.exportSome(ids), `trips-backup-${stamp}`);
      },
    });
  });

  function openRestorePick(trips) {
    openPick({
      mode: 'restore', trips,
      title: '복원할 여행 고르기',
      hint: '고른 여행만 복원해요. 이미 있는 여행은 백업 내용으로 덮어쓰고, 나머지 여행은 그대로 둬요.',
      onGo: async ids => {
        const chosen = trips.filter(t => ids.includes(t.id));
        const over = chosen.filter(t => TS.get(t.id));
        if (over.length && !await PQ.ask(`${over.map(t => `‘${TS.get(t.id).name}’`).join(', ')}은(는) 이미 있어서 백업 내용으로 덮어써요. 계속할까요?`, '복원', true)) return;
        chosen.forEach(t => {
          const replace = !!TS.get(t.id);
          if (replace && PQ.state.id === t.id) PQ.clearTrip();
          TS.addImported(t, replace);
        });
        PQ.closeSheet('#pickSheet');
        renderList();
        show('#pageTrips');
        PQ.toast(`여행 ${chosen.length}개를 복원했어요`);
      },
    });
  }

  $('#btnRestoreAll').addEventListener('click', () => {
    PQ.closeSheet('#tripsMenuSheet');
    PQ.showImport('복원하기', '백업 파일(JSON)을 고르거나 내용을 붙여넣으세요. 다음 화면에서 복원할 여행을 골라요.', text => {
      let res;
      try { res = TS.parseImport(text); } catch (err) { importErr(err); return; }
      PQ.closeSheet('#importSheet');
      openRestorePick(res.kind === 'backup' ? res.trips : [res.trip]);
    });
  });

  // ---------- 처음 화면 결정 ----------
  // 마지막으로 보던 여행이 있으면 바로 열고, 없으면 목록 또는 시작 화면
  if (TS.get(TS.lastTripId)) {
    show(null);
    if (TS.migrated) setTimeout(() => PQ.toast('기존 푸꾸옥 일정을 ‘푸꾸옥 여행’으로 옮겼어요'), 300);
  } else if (TS.trips.length) {
    showTrips();
  } else {
    show('#pageStart');
  }
})();
