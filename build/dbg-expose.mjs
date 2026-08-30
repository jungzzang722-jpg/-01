/* 안쪽 옷이 바깥쪽 옷 밖으로 드러난 픽셀을 정확히 집어낸다. */
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
  const r = TRYON.compose(body, [
    { garmentId: 'b-straight-denim', colorHex: '#41506B' },
    { garmentId: 't-pique-half-zip', colorHex: '#B4483C' },
    { garmentId: 'o-trench', colorHex: '#B9A483' }
  ], { ease: 1, eraseOriginal: true });
  const inner = r.report.layers.find(l => l.id === 't-pique-half-zip');
  const outer = r.report.layers.find(l => l.id === 'o-trench');
  const W = body.w, H = body.h;
  let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  const perRow = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (inner.painted[i] && !outer.painted[i]) {
      n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      (perRow[y] = perRow[y] || []).push(x);
    }
  }
  const rows = Object.keys(perRow).map(Number).sort((a,b)=>a-b);
  const sample = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length/8)) === 0).slice(0, 8)
    .map(y => 'y' + y + ': ' + perRow[y].length + 'px x' + Math.min(...perRow[y]) + '~' + Math.max(...perRow[y]));
  return { n, box: [x0, y0, x1, y1],
    innerTop: Math.round(inner.anchors._topY), outerTop: Math.round(outer.anchors._topY),
    innerHem: Math.round(inner.anchors._hemY), outerHem: Math.round(outer.anchors._hemY), sample };
}, fx);
console.log('드러난 픽셀', o.n, ' 상자 x' + o.box[0] + '~' + o.box[2] + ' y' + o.box[1] + '~' + o.box[3]);
console.log('안쪽 topY', o.innerTop, 'hemY', o.innerHem, ' / 바깥 topY', o.outerTop, 'hemY', o.outerHem);
o.sample.forEach(s => console.log('  ' + s));
await b.close();
