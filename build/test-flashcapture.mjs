/* 촬영 흐름 전체를 가짜 카메라로 돌린다.
 *
 * 실제 기기 없이도 확인해야 할 것들:
 *   · 고정을 지원하는 기기 → 플래시 2연사가 돌고 게인이 나온다
 *   · 고정을 못 하는 기기   → 토글이 꺼지고 안내가 바뀌며, 촬영은 그대로 된다
 *   · 흰 화면 오버레이가 켜졌다가 반드시 꺼진다 (켜진 채 남으면 앱이 먹통이 된다)
 */
import { chromium } from 'playwright';
import path from 'path';

async function run(supportsLock) {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const ctx = await browser.newContext({ permissions: ['camera'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  // 가짜 카메라 — 색이 있는 장면을 캔버스로 그려 스트림으로 낸다.
  // 흰 화면이 켜지면 장면이 밝아지도록 window.__flashOn 을 본다.
  await page.addInitScript((lock) => {
    window.__lockSupported = lock;
    window.__flashOn = false;
    window.__overlayLog = [];
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function () {
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 320;
      const c = cv.getContext('2d');
      const amb = [1.18, 1.0, 0.72];               // 웜 조명
      const scr = [1.0, 1.0, 1.0];                 // 화면(중성)
      const patch = [
        [.62,.48,.40],[.78,.70,.62],[.30,.32,.36],[.55,.42,.34],
        [.20,.22,.25],[.85,.84,.82],[.45,.50,.44],[.66,.55,.47],
        [.38,.30,.26],[.72,.62,.55],[.28,.36,.44],[.50,.46,.42],
        [.15,.14,.16],[.40,.38,.35],[.60,.58,.55],[.25,.24,.22]
      ];
      (function draw() {
        const ov = document.getElementById('capFlashScreen');
        window.__flashOn = !!(ov && !ov.hidden);
        const f = window.__flashOn ? 0.8 : 0;
        patch.forEach((p, i) => {
          const rgb = [0,1,2].map(k => Math.round(255 * Math.min(1,
            Math.pow(p[k] * amb[k] + p[k] * scr[k] * f, 1 / 2.2) * 0.85)));
          c.fillStyle = 'rgb(' + rgb.join(',') + ')';
          c.fillRect((i % 4) * 80, Math.floor(i / 4) * 80, 81, 81);
        });
        requestAnimationFrame(draw);
      })();
      const stream = cv.captureStream(30);
      const track = stream.getVideoTracks()[0];
      track.getCapabilities = () => lock
        ? { whiteBalanceMode: ['none', 'manual', 'continuous'], exposureMode: ['manual', 'continuous'] }
        : { };
      let applied = false;
      track.applyConstraints = () => { applied = lock; return Promise.resolve(); };
      track.getSettings = () => applied
        ? { whiteBalanceMode: 'manual', exposureMode: 'manual' } : {};
      return Promise.resolve(stream);
    };
  }, supportsLock);

  await page.goto('file://' + path.resolve('퍼스널컬러진단.html'));
  await page.waitForFunction(() => window.CAPTURE);

  // 흰 화면이 켜졌다 꺼지는지 감시
  await page.evaluate(() => {
    const obs = new MutationObserver(() => {
      const f = document.getElementById('capFlashScreen');
      if (f) window.__overlayLog.push(f.hidden ? 'off' : 'on');
    });
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    // 캔버스 스트림은 얼굴이 없으니 분석은 어차피 실패한다. 결과만 붙잡는다.
    window.__res = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    return CAPTURE.start(host, { onShots: r => { window.__res = r; } });
  });
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => ({
    toggle: !!document.getElementById('capFlashOn'),
    checked: document.getElementById('capFlashOn').checked,
    disabled: document.getElementById('capFlashOn').disabled,
    hint: document.getElementById('capFlashHint').textContent.slice(0, 40)
  }));

  // 셔터는 품질 게이트가 통과해야 열리므로 직접 누른다
  await page.evaluate(() => {
    const b = document.getElementById('capShoot');
    b.disabled = false; b.click();
  });
  await page.waitForFunction(() => window.__res, null, { timeout: 15000 });

  const res = await page.evaluate(() => ({
    shots: window.__res.shots.length,
    flashWB: window.__res.flashWB ? {
      ok: window.__res.flashWB.ok, ko: window.__res.flashWB.ko,
      tiles: window.__res.flashWB.tiles,
      gains: window.__res.flashWB.gains,
      ratio: window.__res.flashWB.flashRatio
    } : null,
    skipped: window.__res.flashSkipped,
    overlay: window.__overlayLog.join(','),
    overlayStuck: !document.getElementById('capFlashScreen').hidden
  }));

  await browser.close();
  return { before, res, errs };
}

for (const lock of [true, false]) {
  const { before, res, errs } = await run(lock);
  console.log('\n■ 고정 지원 ' + (lock ? 'O' : 'X'));
  console.log('  토글 상태     checked=' + before.checked + ' disabled=' + before.disabled);
  console.log('  안내 문구     ' + before.hint + '…');
  console.log('  촬영 장수     ' + res.shots);
  console.log('  플래시 결과   ' + (res.flashWB
    ? (res.flashWB.ok
        ? 'ok  타일 ' + res.flashWB.tiles + '  기여 ' + Math.round(res.flashWB.ratio * 100) + '%' +
          '  게인 ' + ['r','g','b'].map(k => res.flashWB.gains[k].toFixed(3)).join('/')
        : '거부  ' + res.flashWB.ko.slice(0, 44))
    : '없음 (skipped=' + res.skipped + ')'));
  console.log('  오버레이      ' + (res.overlay || '(변화 없음)') +
    (res.overlayStuck ? '   ✗ 켜진 채 남음' : '   ✓ 꺼짐'));
  console.log('  page errors  ' + (errs.length ? errs.join(' | ') : 'none'));
}
