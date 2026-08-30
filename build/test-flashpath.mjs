/* 플래시 게인이 파이프라인 끝까지 그대로 도착하는지.
 * 중간에 예비 보정(g0)과 곱해지는 지점이 있어 한 번 어긋나면 조용히 틀린다. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('file:///home/user/-01/퍼스널컬러진단.html');
await page.waitForFunction(() => window.DETECT && window.FLASHWB);

const out = await page.evaluate(() => {
  const CC = window.CC, D = window.DETECT;
  // 웜 조명 아래 얼굴 비슷한 그림 — 파이프라인이 얼굴을 찾을 수 있어야 한다
  function face(cast) {
    const W = 420, H = 520;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const tint = ([r, g, b]) => 'rgb(' + [r * cast[0], g * cast[1], b * cast[2]]
      .map(v => Math.round(Math.max(0, Math.min(255, v)))).join(',') + ')';
    c.fillStyle = tint([150, 154, 160]); c.fillRect(0, 0, W, H);           // 배경
    c.fillStyle = tint([206, 168, 143]);                                    // 목
    c.fillRect(W * 0.36, H * 0.62, W * 0.28, H * 0.3);
    c.beginPath(); c.ellipse(W / 2, H * 0.44, W * 0.33, H * 0.34, 0, 0, 7); c.fill();
    c.fillStyle = tint([38, 30, 26]);                                       // 머리
    c.beginPath(); c.ellipse(W / 2, H * 0.16, W * 0.35, H * 0.13, 0, 0, 7); c.fill();
    [[-1, 1]].forEach(() => {});
    [-1, 1].forEach(sx => {                                                 // 눈
      const ex = W / 2 + sx * W * 0.135, ey = H * 0.385;
      c.fillStyle = tint([214, 216, 219]);
      c.beginPath(); c.ellipse(ex, ey, W * 0.070, H * 0.028, 0, 0, 7); c.fill();
      c.fillStyle = tint([44, 34, 28]);
      c.beginPath(); c.ellipse(ex, ey, W * 0.028, H * 0.026, 0, 0, 7); c.fill();
    });
    c.fillStyle = tint([176, 96, 92]);                                      // 입
    c.beginPath(); c.ellipse(W / 2, H * 0.585, W * 0.09, H * 0.026, 0, 0, 7); c.fill();
    return cv;
  }
  // 백열등 느낌의 캐스트
  const cast = [1.10, 1.00, 0.86];
  const cv = face(cast);
  // 이 캐스트를 정확히 되돌리는 게인 (플래시가 완벽히 쟀다고 가정)
  const g = { r: 1 / cast[0], g: 1 / cast[1], b: 1 / cast[2] };
  const m = (g.r + g.g + g.b) / 3;
  const flashGains = { r: g.r / m, g: g.g / m, b: g.b / m };

  const noFlash = D.analyzeBust(cv, {});
  const withFlash = D.analyzeBust(cv, { flashGains: flashGains });
  const off = t => t && t.wb ? [t.wb.gains.r, t.wb.gains.g, t.wb.gains.b] : null;
  return {
    want: [flashGains.r, flashGains.g, flashGains.b],
    noFlash: noFlash.ok ? { m: noFlash.wb.method, g: off(noFlash), conf: noFlash.confidence, skin: noFlash.skin } : { err: noFlash.issues },
    withFlash: withFlash.ok ? { m: withFlash.wb.method, g: off(withFlash), conf: withFlash.confidence, skin: withFlash.skin } : { err: withFlash.issues }
  };
});

const f = n => n == null ? 'null' : n.map(v => v.toFixed(4)).join(', ');
console.log('넘긴 게인       ', f(out.want));
console.log('플래시 없이      ', out.noFlash.m || 'FAIL', f(out.noFlash.g), ' conf', (out.noFlash.conf||0).toFixed(2));
console.log('플래시 적용      ', out.withFlash.m || 'FAIL', f(out.withFlash.g), ' conf', (out.withFlash.conf||0).toFixed(2));
if (out.withFlash.g) {
  const d = out.want.map((v, i) => Math.abs(v - out.withFlash.g[i]));
  console.log('총 게인 오차     ', f(d), Math.max(...d) < 1e-6 ? ' ✓ 정확히 일치' : ' ✗ 어긋남');
}
console.log('사유:', JSON.stringify(out.noFlash.err||out.withFlash.err));
console.log('page errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
