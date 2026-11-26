/* 여행 플래너 – 정산 탭 (현재 여행) */
(function () {
  'use strict';
  const PQ = window.PQ;
  const $ = sel => document.querySelector(sel);
  const esc = PQ.esc;
  const fx = PQ.fx;

  const CATS = [
    { key: 'food', name: '식비', ico: '🍜' },
    { key: 'transport', name: '교통', ico: '🚕' },
    { key: 'stay', name: '숙소', ico: '🏨' },
    { key: 'activity', name: '액티비티', ico: '🏝️' },
    { key: 'etc', name: '기타', ico: '🧾' },
  ];
  const catOf = k => CATS.find(c => c.key === k) || CATS[4];

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  const fmt = fx.fmt;
  const won = n => fmt(n) + '원';
  const fmtCur = (amt, cur) => fx.fmtCur(amt, cur);
  const TS = window.TripStore;
  const validCur = c => TS.CURRENCIES.some(x => x.code === c);
  // 지출에 고를 수 있는 통화: 현지 통화, 원, 달러
  const curChoices = () => [...new Set([PQ.state.currency || 'VND', 'KRW', 'USD'])];

  // ---------- 데이터 ----------
  // 가져온 JSON 등에서 들어온 값을 정리
  function clean() {
    const st = PQ.state;
    st.people = (Array.isArray(st.people) ? st.people : [])
      .filter(p => p && typeof p.id === 'string' && String(p.name || '').trim())
      .map(p => ({ id: p.id, name: String(p.name).trim().slice(0, 20) }));
    const ids = new Set(st.people.map(p => p.id));
    st.expenses = (Array.isArray(st.expenses) ? st.expenses : [])
      .filter(e => e && typeof e.id === 'string' && Number(e.amount) > 0)
      .map(e => ({
        id: e.id,
        title: String(e.title || '지출').slice(0, 60),
        amount: Number(e.amount),
        currency: validCur(e.currency) ? e.currency : (st.currency || 'VND'),
        payer: ids.has(e.payer) ? e.payer : null,
        split: (Array.isArray(e.split) ? e.split : []).filter(id => ids.has(id)),
        cat: catOf(e.cat).key,
        date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : st.start,
        itemId: typeof e.itemId === 'string' ? e.itemId : null,
      }));
  }
  const people = () => PQ.state.people || [];
  const expenses = () => PQ.state.expenses || [];
  const nameOf = id => (people().find(p => p.id === id) || {}).name || '(삭제됨)';
  const toKrw = e => fx.convert(e.amount, e.currency, 'KRW');

  // ---------- 계산 ----------
  function compute() {
    const ps = people();
    const paid = {}, owed = {};
    ps.forEach(p => { paid[p.id] = 0; owed[p.id] = 0; });
    let total = 0, skipped = 0;
    expenses().forEach(e => {
      if (!e.payer || !e.split.length) { skipped++; return; }
      const krw = toKrw(e);
      total += krw;
      paid[e.payer] += krw;
      e.split.forEach(id => { owed[id] += krw / e.split.length; });
    });
    // 원 단위로 반올림한 뒤 합이 정확히 0이 되도록 오차를 가장 큰 쪽에 몰아줌
    const bal = ps.map(p => ({ id: p.id, v: Math.round(paid[p.id] - owed[p.id]) }));
    const resid = bal.reduce((s, b) => s + b.v, 0);
    if (resid && bal.length) {
      bal.reduce((a, b) => (Math.abs(b.v) > Math.abs(a.v) ? b : a)).v -= resid;
    }
    return { total, paid, owed, bal, skipped, transfers: minTransfers(bal) };
  }

  // 최소 송금 횟수: 잔액 합이 0인 묶음으로 최대한 많이 나누면, 묶음마다 (인원-1)번이면 끝남
  function minTransfers(bal) {
    const nz = bal.filter(b => b.v !== 0);
    const n = nz.length;
    if (!n) return [];
    let groups;
    if (n <= 16) {
      const size = 1 << n;
      const sum = new Float64Array(size);
      const dp = new Int8Array(size);
      for (let mask = 1; mask < size; mask++) {
        const low = mask & -mask;
        const i = 31 - Math.clz32(low);
        sum[mask] = sum[mask ^ low] + nz[i].v;
        let best = 0;
        for (let j = 0; j < n; j++) if (mask & (1 << j)) best = Math.max(best, dp[mask ^ (1 << j)]);
        dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
      }
      // 역추적: 원소를 하나씩 빼며 순서를 만들고, 부분합이 0이 되는 지점마다 묶음을 끊음
      const order = [];
      let mask = size - 1;
      while (mask) {
        const need = dp[mask] - (sum[mask] === 0 ? 1 : 0);
        for (let j = 0; j < n; j++) {
          if ((mask & (1 << j)) && dp[mask ^ (1 << j)] === need) { order.push(j); mask ^= 1 << j; break; }
        }
      }
      order.reverse();
      groups = [];
      let cur = [], acc = 0;
      order.forEach(j => {
        cur.push(nz[j]); acc += nz[j].v;
        if (acc === 0) { groups.push(cur); cur = []; }
      });
      if (cur.length) groups.push(cur);
    } else {
      groups = [nz]; // 인원이 아주 많으면 단순 매칭
    }
    const out = [];
    groups.forEach(g => {
      const debt = g.filter(b => b.v < 0).map(b => ({ id: b.id, v: -b.v }));
      const cred = g.filter(b => b.v > 0).map(b => ({ id: b.id, v: b.v }));
      debt.sort((a, b) => b.v - a.v); cred.sort((a, b) => b.v - a.v);
      let i = 0, j = 0;
      while (i < debt.length && j < cred.length) {
        const x = Math.min(debt[i].v, cred[j].v);
        if (x > 0) out.push({ from: debt[i].id, to: cred[j].id, amount: x });
        debt[i].v -= x; cred[j].v -= x;
        if (debt[i].v === 0) i++;
        if (cred[j].v === 0) j++;
      }
    });
    return out;
  }

  // ---------- 렌더 ----------
  let sumMode = 'cat';

  function render() {
    clean();
    const ps = people();
    const ex = expenses();
    $('#stPeopleCount').textContent = ps.length ? `${ps.length}명` : '';
    $('#stPeopleChips').innerHTML = ps.length
      ? ps.map(p => `<span class="st-chip">${esc(p.name)}</span>`).join('')
      : '<span class="muted">아직 없어요. 편집을 눌러 함께 가는 사람을 추가하세요.</span>';

    const empty = $('#stEmpty');
    if (!ps.length || !ex.length) {
      empty.hidden = false;
      $('#stResult').hidden = true;
      empty.innerHTML = !ps.length
        ? '참여자를 먼저 추가하면<br>지출을 기록하고 정산할 수 있어요.<br><button type="button" class="btn primary small" data-act="people">참여자 추가</button>'
        : '아직 지출이 없어요.<br>오른쪽 아래 <b>+</b>나 동선 탭 일정 카드의 💸로 추가하세요.<br><button type="button" class="btn primary small" data-act="add">지출 추가</button>';
      return;
    }
    empty.hidden = true;
    $('#stResult').hidden = false;

    const r = compute();
    const rate = fx.rate();
    $('#stTotal').textContent = won(r.total);
    $('#stRateNote').textContent = (rate.kind === 'manual' ? '내 환전 환율' : rate.kind === 'live' ? '실시간 환율' : '대략 환율')
      + ` 1만 원 = ${fmt(rate.rate * 10000)}동 기준` + (r.skipped ? ` · 낸 사람/나눌 사람이 없는 지출 ${r.skipped}건 제외` : '');

    // 송금
    $('#stTransferCount').textContent = r.transfers.length ? `${r.transfers.length}번이면 끝나요` : '';
    $('#stTransfers').innerHTML = r.transfers.length
      ? r.transfers.map(t => `<li><span class="who"><b>${esc(nameOf(t.from))}</b><span class="arrow">→</span><b>${esc(nameOf(t.to))}</b></span><span class="amt">${won(t.amount)}</span></li>`).join('')
      : '<li><span class="done">주고받을 돈이 없어요 🎉</span></li>';

    // 1인당
    $('#stPerPerson').innerHTML = '<tr><th>이름</th><th>낸 돈</th><th>부담액</th><th>정산</th></tr>' + ps.map(p => {
      const b = r.bal.find(x => x.id === p.id).v;
      const cls = b > 0 ? 'plus' : b < 0 ? 'minus' : '';
      const label = b > 0 ? `+${fmt(b)}` : b < 0 ? `−${fmt(-b)}` : '0';
      return `<tr><td>${esc(p.name)}</td><td>${fmt(r.paid[p.id])}</td><td>${fmt(r.owed[p.id])}</td><td class="${cls}">${label}</td></tr>`;
    }).join('');

    renderSums(ex);
    renderList(ex);
  }

  function renderSums(ex) {
    $('#stSumCat').classList.toggle('on', sumMode === 'cat');
    $('#stSumDate').classList.toggle('on', sumMode === 'date');
    let rows;
    if (sumMode === 'cat') {
      rows = CATS.map(c => ({ label: `${c.ico} ${c.name}`, v: ex.filter(e => e.cat === c.key).reduce((s, e) => s + toKrw(e), 0) }));
    } else {
      const dates = [...new Set(ex.map(e => e.date))].sort();
      rows = dates.map(d => {
        const { m, d: dd, wd, idx } = PQ.dayInfo(d);
        return { label: `${idx >= 0 ? 'Day ' + (idx + 1) + ' · ' : ''}${m}/${dd} (${wd})`, v: ex.filter(e => e.date === d).reduce((s, e) => s + toKrw(e), 0) };
      });
    }
    const max = Math.max(1, ...rows.map(x => x.v));
    $('#stSums').innerHTML = rows.map(x => `
      <li><div class="row"><span>${x.label}</span><b>${won(x.v)}</b></div>
      <div class="bar"><i style="width:${(x.v / max * 100).toFixed(1)}%"></i></div></li>`).join('');
  }

  function renderList(ex) {
    $('#stExpCount').textContent = `${ex.length}건`;
    const dates = [...new Set(ex.map(e => e.date))].sort();
    $('#stExpenses').innerHTML = dates.map(d => {
      const { m, d: dd, wd } = PQ.dayInfo(d);
      const items = ex.filter(e => e.date === d).map(e => {
        const c = catOf(e.cat);
        const linked = e.itemId && PQ.findItem(e.itemId);
        const meta = [
          e.payer ? `${nameOf(e.payer)} 결제` : '낸 사람 없음',
          e.split.length === people().length ? '모두' : `${e.split.length}명`,
          linked ? `📍 ${linked.item.place}` : '',
        ].filter(Boolean).join(' · ');
        return `<li class="exp" data-id="${esc(e.id)}">
          <span class="ico">${c.ico}</span>
          <span class="mid"><div class="t">${esc(e.title)}</div><div class="m">${esc(meta)}</div></span>
          <span class="r"><b>${fmtCur(e.amount, e.currency)}</b>${e.currency !== 'KRW' ? `<small>≈ ${won(toKrw(e))}</small>` : ''}</span>
        </li>`;
      }).join('');
      return `<li class="date-head">${m}/${dd} (${wd})</li>${items}`;
    }).join('');
  }

  $('#stEmpty').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'people') openPeople();
    else PQ.openExpense(null, { date: PQ.currentDay });
  });
  $('#stSumCat').addEventListener('click', () => { sumMode = 'cat'; renderSums(expenses()); });
  $('#stSumDate').addEventListener('click', () => { sumMode = 'date'; renderSums(expenses()); });
  $('#stExpenses').addEventListener('click', e => {
    const li = e.target.closest('.exp');
    if (!li) return;
    const ex = expenses().find(x => x.id === li.dataset.id);
    if (ex) PQ.openExpense(ex);
  });

  // 동선 카드에 붙는 "이 일정에서 쓴 돈"
  PQ.linkedSpent = itemId => {
    const list = expenses().filter(e => e.itemId === itemId);
    if (!list.length) return '';
    const sum = list.reduce((s, e) => s + toKrw(e), 0);
    return `<span class="spent">💸 ${won(sum)}${list.length > 1 ? ` · ${list.length}건` : ''}</span>`;
  };

  // ---------- 참여자 ----------
  function openPeople() {
    renderPeople();
    PQ.openSheet('#peopleSheet');
  }
  function renderPeople() {
    const ps = people();
    $('#peopleList').innerHTML = ps.length
      ? ps.map(p => `<li data-id="${esc(p.id)}"><input type="text" value="${esc(p.name)}" maxlength="20" aria-label="이름"><button type="button" data-del>삭제</button></li>`).join('')
      : '<li class="muted">함께 가는 사람의 이름을 추가하세요.</li>';
  }
  $('#btnPeople').addEventListener('click', openPeople);
  $('#peopleAdd').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#newPerson').value.trim();
    if (!name) return;
    if (people().some(p => p.name === name)) { PQ.toast('같은 이름이 이미 있어요'); return; }
    PQ.state.people = people().concat({ id: uid(), name });
    // 이미 있는 "모두와 나누기" 지출에는 새 사람을 넣지 않음 (기존 정산 유지)
    PQ.save();
    $('#newPerson').value = '';
    renderPeople();
    PQ.render();
    $('#newPerson').focus();
  });
  $('#peopleList').addEventListener('change', e => {
    const li = e.target.closest('li[data-id]');
    if (!li || e.target.tagName !== 'INPUT') return;
    const name = e.target.value.trim();
    const p = people().find(x => x.id === li.dataset.id);
    if (!p) return;
    if (!name || people().some(x => x.id !== p.id && x.name === name)) {
      PQ.toast(name ? '같은 이름이 이미 있어요' : '이름을 비울 수 없어요');
      e.target.value = p.name;
      return;
    }
    p.name = name;
    PQ.save();
    PQ.render();
  });
  $('#peopleList').addEventListener('click', async e => {
    if (!e.target.closest('[data-del]')) return;
    const id = e.target.closest('li[data-id]').dataset.id;
    const used = expenses().filter(x => x.payer === id || x.split.includes(id)).length;
    if (used) { PQ.toast(`지출 ${used}건에 들어 있어서 삭제할 수 없어요. 지출에서 먼저 빼주세요`); return; }
    if (!await PQ.ask(`${nameOf(id)}님을 참여자에서 뺄까요?`, '삭제', true)) return;
    PQ.state.people = people().filter(p => p.id !== id);
    PQ.save();
    renderPeople();
    PQ.render();
  });

  // ---------- 지출 편집 ----------
  let editId = null, form = null, lastPayer = null;

  function pickButtons(el, items, isOn) {
    el.innerHTML = items.map(x => `<button type="button" data-v="${esc(x.v)}" class="${isOn(x.v) ? 'on' : ''}" aria-pressed="${isOn(x.v)}">${esc(x.label)}</button>`).join('');
  }
  function renderForm() {
    const ps = people();
    pickButtons($('#ePayer'), ps.map(p => ({ v: p.id, label: p.name })), v => v === form.payer);
    pickButtons($('#eSplit'), ps.map(p => ({ v: p.id, label: p.name })), v => form.split.has(v));
    pickButtons($('#eCat'), CATS.map(c => ({ v: c.key, label: `${c.ico} ${c.name}` })), v => v === form.cat);
    const curs = curChoices();
    if (!curs.includes(form.cur)) curs.push(form.cur); // 통화를 바꾼 여행의 예전 지출
    $('#eCurSeg').innerHTML = curs.map(c => `<button type="button" data-cur="${c}" class="${c === form.cur ? 'on' : ''}">${c}</button>`).join('');
    $('#eCurSeg').style.gridTemplateColumns = `repeat(${curs.length}, 1fr)`;
    $('#eSplitAll').textContent = form.split.size === ps.length ? '전체 해제' : '전체 선택';
    updateHint();
  }
  function updateHint() {
    const v = fx.parseAmount($('#eAmount').value);
    const n = form.split.size;
    if (!(v > 0)) { $('#eKrwHint').textContent = ''; return; }
    const krw = fx.convert(v, form.cur, 'KRW');
    const loc = PQ.state.currency || 'VND';
    const other = form.cur !== 'KRW' ? `≈ ${won(krw)}` : `≈ ${fx.fmtCur(fx.convert(v, 'KRW', loc), loc)}`;
    $('#eKrwHint').textContent = other + (n ? ` · 1인당 ${won(krw / n)}` : '');
  }
  function fillItems(selected) {
    const date = $('#eDate').value;
    const items = PQ.state.days[date] || [];
    $('#eItem').innerHTML = '<option value="">연결 안 함</option>' +
      items.map((it, i) => `<option value="${esc(it.id)}">${i + 1}. ${esc(it.place)}</option>`).join('');
    $('#eItem').value = items.some(it => it.id === selected) ? selected : '';
  }

  PQ.openExpense = function (exp, opts) {
    opts = opts || {};
    clean();
    const ps = people();
    if (!ps.length) {
      PQ.toast('참여자를 먼저 추가하세요');
      openPeople();
      return;
    }
    editId = exp ? exp.id : null;
    const linked = !exp && opts.itemId ? PQ.findItem(opts.itemId) : null;
    form = {
      cur: exp ? exp.currency : (PQ.state.currency || 'VND'),
      payer: exp ? exp.payer : (ps.some(p => p.id === lastPayer) ? lastPayer : ps[0].id),
      split: new Set(exp ? exp.split : ps.map(p => p.id)),
      cat: exp ? exp.cat : 'food',
    };
    $('#expTitle').textContent = exp ? '지출 수정' : '지출 추가';
    $('#btnExpDelete').hidden = !exp;
    $('#eTitle').value = exp ? exp.title : (linked ? linked.item.place : '');
    $('#eAmount').value = exp ? fx.fmtNum(exp.currency, exp.amount) : '';
    const date = exp ? exp.date : (linked ? linked.date : (opts.date || PQ.currentDay));
    $('#eDate').innerHTML = PQ.dateOptions(date);
    $('#eDate').value = date;
    fillItems(exp ? exp.itemId : (linked ? opts.itemId : ''));
    renderForm();
    PQ.openSheet('#expSheet');
    $('#expForm').scrollTop = 0;
    if (!exp) setTimeout(() => (linked ? $('#eAmount') : $('#eTitle')).focus(), 50);
  };

  fx.bindAmount($('#eAmount'), true, updateHint);
  $('#eDate').addEventListener('change', () => fillItems($('#eItem').value));
  $('#eCurSeg').addEventListener('click', e => {
    const b = e.target.closest('button[data-cur]');
    if (b) { form.cur = b.dataset.cur; renderForm(); }
  });
  $('#ePayer').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (b) { form.payer = b.dataset.v; renderForm(); }
  });
  $('#eSplit').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    if (form.split.has(b.dataset.v)) form.split.delete(b.dataset.v); else form.split.add(b.dataset.v);
    renderForm();
  });
  $('#eSplitAll').addEventListener('click', () => {
    const ps = people();
    form.split = form.split.size === ps.length ? new Set() : new Set(ps.map(p => p.id));
    renderForm();
  });
  $('#eCat').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (b) { form.cat = b.dataset.v; renderForm(); }
  });

  $('#expForm').addEventListener('submit', e => {
    e.preventDefault();
    const title = $('#eTitle').value.trim();
    const amount = fx.parseAmount($('#eAmount').value);
    if (!title) { PQ.toast('항목을 입력하세요'); $('#eTitle').focus(); return; }
    if (!(amount > 0)) { PQ.toast('금액을 입력하세요'); $('#eAmount').focus(); return; }
    if (!form.split.size) { PQ.toast('나눌 사람을 한 명 이상 고르세요'); return; }
    const data = {
      title,
      amount: TS.curOf(form.cur).dec ? Math.round(amount * 100) / 100 : Math.round(amount),
      currency: form.cur,
      payer: form.payer,
      split: [...form.split],
      cat: form.cat,
      date: $('#eDate').value,
      itemId: $('#eItem').value || null,
    };
    if (editId) {
      const ex = expenses().find(x => x.id === editId);
      if (ex) Object.assign(ex, data);
    } else {
      PQ.state.expenses = expenses().concat(Object.assign({ id: uid() }, data));
    }
    lastPayer = form.payer;
    PQ.save();
    PQ.closeSheet('#expSheet');
    PQ.render();
    PQ.toast(editId ? '지출을 수정했어요' : '지출을 추가했어요');
  });

  $('#btnExpDelete').addEventListener('click', async () => {
    const ex = expenses().find(x => x.id === editId);
    if (!ex) return;
    if (!await PQ.ask(`"${ex.title}" 지출을 삭제할까요?`, '삭제', true)) return;
    PQ.state.expenses = expenses().filter(x => x.id !== editId);
    PQ.save();
    PQ.closeSheet('#expSheet');
    PQ.render();
    PQ.toast('지출을 삭제했어요');
  });

  // ---------- 연결 ----------
  PQ.onRender(() => { if ($('#tab-settle').classList.contains('active')) render(); });
  document.addEventListener('pq:tab', e => { if (e.detail === 'settle') render(); });
  PQ._settle = { minTransfers, compute }; // 테스트용
  // 여행 목록 카드용: 그 여행의 총 지출(원) – 여행별 환율 설정으로 환산
  PQ.tripTotalKrw = trip => (trip.expenses || []).reduce((sum, e) => {
    const amt = Number(e.amount);
    if (!(amt > 0)) return sum;
    const cur = validCur(e.currency) ? e.currency : trip.currency;
    return sum + fx.convertFor(trip, amt, cur, 'KRW');
  }, 0);

  clean();
  PQ.render(); // 동선 카드에 지출 배지 표시
})();
