/* 촬영 패널의 플래시 토글이 두 기기 상태에서 각각 어떻게 보이는지 캡처한다. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
fs.mkdirSync('build/out', { recursive: true });

for (const lock of [true, false]) {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: 1000, height: 760 } });
  const page = await ctx.newPage();
  await page.addInitScript((lk) => {
    navigator.mediaDevices.getUserMedia = function () {
      const cv = document.createElement('canvas'); cv.width = 480; cv.height = 480;
      const c = cv.getContext('2d');
      (function draw() {
        c.fillStyle = '#8a7f76'; c.fillRect(0, 0, 480, 480);
        c.fillStyle = '#c9a68c'; c.beginPath(); c.ellipse(240, 250, 120, 150, 0, 0, 7); c.fill();
        requestAnimationFrame(draw);
      })();
      const st = cv.captureStream(30), t = st.getVideoTracks()[0];
      t.getCapabilities = () => lk ? { whiteBalanceMode: ['manual'], exposureMode: ['manual'] } : {};
      let ap = false;
      t.applyConstraints = () => { ap = lk; return Promise.resolve(); };
      t.getSettings = () => ap ? { whiteBalanceMode: 'manual', exposureMode: 'manual' } : {};
      return Promise.resolve(st);
    };
  }, lock);
  await page.goto('file://' + path.resolve('퍼스널컬러진단.html'));
  await page.waitForFunction(() => window.CAPTURE);
  await page.evaluate(() => {
    const h = document.createElement('div');
    h.style.cssText = 'padding:16px;max-width:940px';
    document.body.innerHTML = ''; document.body.appendChild(h);
    return CAPTURE.start(h, { onShots: () => {} });
  });
  await page.waitForTimeout(700);
  const side = await page.$('.cap-side');
  await side.screenshot({ path: 'build/out/flash-ui-' + (lock ? 'lock' : 'nolock') + '.png' });
  await browser.close();
}
console.log('저장: build/out/flash-ui-lock.png, flash-ui-nolock.png');
