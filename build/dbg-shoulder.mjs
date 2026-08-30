/* 어깨 부근에서 몸이 실제로 어떻게 넓어지는지 vs 옷이 어떻게 넓어지는지. */
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
  const spec = GARMENTS.byId('o-linen-jk'), G = GARMENTS.get('o-linen-jk');
  const A = TRYON.bodyAnchors(body, spec, { ease: 1 }, G);
  const shY = A._shY, neckY = A._neckY;
  const shHalf = (A.shR[0] - A.shL[0]) / 2;
  const axis = (A.shL[0] + A.shR[0]) / 2;
  const rows = [];
  for (let y = Math.round(neckY) - 6; y <= Math.round(shY) + 46; y += 4) {
    const r = body.rows[y];
    const half = r && r.x0 >= 0 ? (r.x1 - r.x0) / 2 : 0;
    rows.push({ y, half: +half.toFixed(1), pct: +(half / shHalf * 100).toFixed(0) });
  }
  return { shY: Math.round(shY), neckY: Math.round(neckY), shHalf: +shHalf.toFixed(1), axis: Math.round(axis), rows };
}, fx);
console.log('목선 y' + o.neckY + '  어깨선 y' + o.shY + '  옷 어깨 반폭 ' + o.shHalf + '  축 ' + o.axis);
console.log('y     몸 반폭   옷 어깨폭 대비');
for (const r of o.rows) {
  const bar = '#'.repeat(Math.max(0, Math.round(r.pct / 3)));
  console.log(String(r.y).padStart(5), String(r.half).padStart(8), (r.pct + '%').padStart(7), ' ' + bar);
}
await b.close();
