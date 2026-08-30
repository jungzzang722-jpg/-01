/* 여러 조합을 한 판에 늘어놓고 눈으로 본다.
 * 한 조합만 보고 고치면 다른 조합이 깨지는 걸 놓친다. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
fs.mkdirSync('build/out', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await page.waitForFunction(() => window.TRYON && window.GARMENTS);
const fx = fs.readFileSync('build/fixture-photo.js', 'utf8');

const png = await page.evaluate((fx) => {
  const cv = new Function(fx + '; return person;')()().canvas;
  const body = TRYON.prepare(BODY.analyzeFull(cv, { gender: 'male' }), cv, 760);
  const SETS = [
    [['b-straight-denim', '#3A4A63'], ['t-crew-cotton', '#8B2D48']],
    [['b-chino-shorts', '#C8B79A'], ['t-open-collar', '#4E6E5D']],
    [['b-wide-slacks', '#2E3440'], ['t-summer-knit', '#E7DCC8'], ['o-linen-jk', '#8C7A5E']],
    [['b-straight-denim', '#41506B'], ['t-pique-half-zip', '#B4483C'], ['o-trench', '#B9A483']],
    [['b-linen-easy', '#D6CBB4'], ['t-boxy-tee', '#2F3238']]
  ];
  const W = body.w, H = body.h;
  const out = document.createElement('canvas');
  out.width = W * SETS.length; out.height = H;
  const c = out.getContext('2d');
  SETS.forEach((set, i) => {
    const layers = set.map(([id, hex]) => ({ garmentId: id, colorHex: hex }));
    const r = TRYON.compose(body, layers, { ease: 1, lightAmount: 0.75, eraseOriginal: true });
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    t.getContext('2d').putImageData(r.imageData, 0, 0);
    c.drawImage(t, i * W, 0);
  });
  return out.toDataURL('image/png');
}, fx);
fs.writeFileSync('build/out/looks.png', Buffer.from(png.split(',')[1], 'base64'));
console.log('저장: build/out/looks.png', errs.length ? 'errors: ' + errs.join(' | ') : 'errors: none');
await browser.close();
