/* 합성 뒤에도 원래 몸이 드러난 자리를 빨갛게 칠해 보여준다.
 * "어디가 비었나"를 눈으로 찾으면 엉뚱한 데를 고치게 된다. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
fs.mkdirSync('build/out', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await page.waitForFunction(() => window.TRYON && window.GARMENTS);
const fx = fs.readFileSync('build/fixture-photo.js', 'utf8');

const info = await page.evaluate((fx) => {
  const cv = new Function(fx + '; return person;')()().canvas;
  const full = BODY.analyzeFull(cv, { gender: 'male' });
  const body = TRYON.prepare(full, cv, 900);
  const res = TRYON.compose(body, [
    { garmentId: 'b-straight-denim', colorHex: '#3A4A63' },
    { garmentId: 't-crew-cotton', colorHex: '#8B2D48' }
  ], { ease: 1, lightAmount: 0.75, eraseOriginal: true });
  const W = body.w, H = body.h;

  // compose 는 covered 를 돌려주지 않는다. 원본과 결과를 비교해
  // "달라지지 않은 픽셀 = 옷이 안 닿은 자리"로 잡는다.
  const bc = document.createElement('canvas'); bc.width = W; bc.height = H;
  const bctx = bc.getContext('2d');
  bctx.drawImage(body.canvas || body.work || cv, 0, 0, W, H);
  const before = bctx.getImageData(0, 0, W, H).data;
  const after = res.imageData.data;

  let y0 = 1e9, y1 = -1;
  res.report.layers.forEach(l => {
    if (l.anchors._topY != null) y0 = Math.min(y0, l.anchors._topY);
    if (l.anchors._hemY != null) y1 = Math.max(y1, l.anchors._hemY);
  });

  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const c = out.getContext('2d');
  c.putImageData(res.imageData, 0, 0);
  const im = c.getImageData(0, 0, W, H), d = im.data;
  const gaps = [];
  for (let y = 0; y < H; y++) {
    let run = -1;
    for (let x = 0; x <= W; x++) {
      const i = y * W + x, j = i * 4;
      const same = x < W && Math.abs(before[j] - after[j]) + Math.abs(before[j+1] - after[j+1])
                          + Math.abs(before[j+2] - after[j+2]) < 12;
      const bare = x < W && body.mask[i] && same && y >= y0 && y <= y1;
      if (bare) { if (run < 0) run = x; d[j] = 255; d[j+1] = 40; d[j+2] = 40; }
      else if (run >= 0) { if (x - run >= 3) gaps.push([y, run, x - 1, x - run]); run = -1; }
    }
  }
  c.putImageData(im, 0, 0);
  gaps.sort((a, b) => b[3] - a[3]);
  return { png: out.toDataURL('image/png'), y0: Math.round(y0), y1: Math.round(y1),
    n: gaps.length, top: gaps.slice(0, 14).map(g => 'y' + g[0] + ' x' + g[1] + '~' + g[2] + ' (' + g[3] + 'px)') };
}, fx);
fs.writeFileSync('build/out/gaps.png', Buffer.from(info.png.split(',')[1], 'base64'));
console.log('띠 y' + info.y0 + '~' + info.y1 + '  빈 구간 ' + info.n + '개');
info.top.forEach(t => console.log('  ' + t));
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
