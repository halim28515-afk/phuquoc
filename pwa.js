/* 여행 플래너 – PWA: 서비스워커 등록, 홈 화면 추가, 오프라인 알림 */
(function () {
  'use strict';
  const PQ = window.PQ;
  const $ = sel => document.querySelector(sel);

  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // 서비스워커: https 또는 localhost에서만 (미리보기 안에서는 쓰지 않음)
  if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('서비스워커 등록 실패', e));
    });
  }

  // 홈 화면 추가: 안드로이드/크롬은 설치 창, 아이폰은 방법 안내
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    updateInstallUI();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    updateInstallUI();
    PQ.toast('홈 화면에 추가했어요');
  });

  // 설치할 수 있는 환경: https(또는 localhost)로 직접 연 페이지 (다른 화면 안에 끼워진 미리보기 제외)
  let embedded = true;
  try { embedded = window.top !== window.self; } catch (e) { embedded = true; }
  const installable = 'serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:' && !embedded;
  function updateInstallUI() {
    const can = installable && !standalone();
    document.querySelectorAll('.install-btn').forEach(b => { b.hidden = !can; });
  }

  async function install() {
    if (deferred) {
      deferred.prompt();
      const choice = await deferred.userChoice.catch(() => null);
      deferred = null;
      updateInstallUI();
      if (choice && choice.outcome === 'dismissed') PQ.toast('나중에 메뉴에서 다시 추가할 수 있어요');
      return;
    }
    $('#installHelp').innerHTML = isIOS
      ? '<ol><li>사파리 아래쪽 <b>공유</b> 버튼(□↑)을 누르세요.</li><li><b>홈 화면에 추가</b>를 고르세요.</li><li>오른쪽 위 <b>추가</b>를 누르면 끝이에요.</li></ol><p class="hint">사파리에서 열어야 보여요. 다른 앱 안의 브라우저라면 사파리로 열어 주세요.</p>'
      : '<ol><li>브라우저 오른쪽 위 <b>⋮ 메뉴</b>를 누르세요.</li><li><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 고르세요.</li></ol><p class="hint">설치 창이 바로 뜨지 않는 브라우저에서는 메뉴에서 추가할 수 있어요.</p>';
    PQ.closeSheet('#tripsMenuSheet');
    PQ.openSheet('#installSheet');
  }
  document.querySelectorAll('.install-btn').forEach(b => b.addEventListener('click', install));
  updateInstallUI();

  // 오프라인/온라인 알림
  window.addEventListener('offline', () => PQ.toast('오프라인이에요. 저장된 일정·환율로 계속 쓸 수 있어요'));
  window.addEventListener('online', () => PQ.toast('다시 연결됐어요'));
})();
