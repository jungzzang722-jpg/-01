/* 합성 결과에서 실제로 날아간(포화된) 픽셀을 센다.
 * 재색 단계에서는 0% 인데 화면은 하얗다 — 그 사이 어디서 날아가는지 본다. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
await p.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await p.waitForFunction(() => window.TRYON);
const fx = fs.readFileSync('build/fixture-photo.js', 'utf8');
const o = await p.evaluate((fx) => {
  const cv = new Function(fx + '; return person;')()().canvas;
  const body = TRYON.prepare(BODY.analyzeFull(cv, { gender: 'male' }), cv, 760);
  // 조명장의 분포 — 얼마나 세게 곱해지는지
  let lmin = 1e9, lmax = -1e9, ls = 0, ln = 0;
  for (let i = 0; i < body.mask.length; i++) if (body.mask[i]) {
    const v = body.light[i]; lmin = Math.min(lmin, v); lmax = Math.max(lmax, v); ls += v; ln++;
  }
  const lmean = ls / ln;

  const CASES = [
    ['밝은 리넨',  [['b-linen-easy', '#D6CBB4'], ['t-boxy-tee', '#2F3238']]],
    ['크림 니트',  [['b-wide-slacks', '#2E3440'], ['t-summer-knit', '#E7DCC8']]],
    ['중간 색',    [['b-straight-denim', '#3A4A63'], ['t-crew-cotton', '#8B2D48']]]
  ];
  const out = [];
  for (const [ko, set] of CASES) {
    const r = TRYON.compose(body, set.map(([id, hex]) => ({ garmentId: id, colorHex: hex })),
      { ease: 1, lightAmount: 0.75, eraseOriginal: true });
    const d = r.imageData.data;
    let hot = 0, n = 0;
    for (const L of r.report.layers) {
      for (let i = 0; i < L.painted.length; i++) {
        if (!L.painted[i]) continue;
        n++;
        const j = i * 4;
        if (d[j] > 250 || d[j+1] > 250 || d[j+2] > 250) hot++;
      }
    }
    out.push({ ko, hot: hot / Math.max(1, n), n });
  }
  return { lmin, lmax, lmean, lo: lmin / lmean, hi: lmax / lmean, out };
}, fx);
console.log('조명장  최소 ' + o.lmin.toFixed(0) + '  평균 ' + o.lmean.toFixed(0) +
  '  최대 ' + o.lmax.toFixed(0) + '   → 비율 ' + o.lo.toFixed(2) + ' ~ ' + o.hi.toFixed(2));
console.log('lightAmount 0.75 일 때 곱해지는 값: ' +
  (1 + (o.lo - 1) * 0.75).toFixed(2) + ' ~ ' + (1 + (o.hi - 1) * 0.75).toFixed(2) + ' (상한 1.42)');
console.log('\n조합        옷 픽셀 중 날아간 비율');
for (const r of o.out) console.log('  ' + r.ko.padEnd(12) + (r.hot * 100).toFixed(1) + '%');
await b.close();
