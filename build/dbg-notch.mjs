/* 흰 노치의 정체 — 몸인가 배경인가, 누가 거절했나. */
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
  const spec = GARMENTS.byId('t-open-collar'), G = GARMENTS.get('t-open-collar');
  const A = TRYON.bodyAnchors(body, spec, { ease: 1 }, G);
  const over = Math.round(Math.min(body.w, body.h) * 0.012 * 2);
  const cover = TRYON.coverageOf(body, spec, A, over);
  const r = TRYON.compose(body, [
    { garmentId: 'b-chino-shorts', colorHex: '#C8B79A' },
    { garmentId: 't-open-collar', colorHex: '#4E6E5D' }], { ease: 1, eraseOriginal: true });
  const d = r.imageData.data, W = body.w;
  const rows = [];
  for (const y of [200, 230, 260, 280, 300, 320]) {
    // 이 행에서 흰(배경색) 픽셀 구간을 찾는다 — 몸 안쪽인지 함께 본다
    let segs = [], run = -1;
    for (let x = 0; x <= W; x++) {
      const i = y * W + x, j = i * 4;
      const white = x < W && d[j] > 244 && d[j+1] > 244 && d[j+2] > 244;
      if (white) { if (run < 0) run = x; }
      else if (run >= 0) { if (x - run >= 2) segs.push([run, x-1]); run = -1; }
    }
    const rr = body.rows[y];
    rows.push({ y,
      sil: rr ? rr.x0 + '~' + rr.x1 : '-',
      core: rr ? rr.cx0 + '~' + rr.cx1 : '-',
      white: segs.map(s => s[0]+'~'+s[1] + (body.mask[y*W+((s[0]+s[1])>>1)] ? '[몸]' : '[배경]')).join(' '),
      covT: cover.torso[y*2] + '~' + cover.torso[y*2+1],
      covA: cover.armL ? cover.armL[y*2] + '~' + cover.armL[y*2+1] : '-' });
  }
  // 쐐기 부근의 실제 색과 상태를 그대로 찍는다
  const pts = [];
  for (const [x, y] of [[140,270],[145,280],[148,300],[143,320],[150,330],[155,300],[135,300]]) {
    const i = y*W+x, j = i*4;
    pts.push({ x, y, rgb: [d[j],d[j+1],d[j+2]].join(','),
      mask: !!body.mask[i], skin: !!body.skin[i], edge: body.edge ? +body.edge[i].toFixed(2) : 1 });
  }
  return { sleeveEnd: A._sleeveEndY, rows, pts };
}, fx);
console.log('sleeveEnd', Math.round(o.sleeveEnd));
console.log('y     실루엣     심(core)    흰 구간                        덮개몸통    덮개팔L');
for (const r of o.rows) console.log(String(r.y).padEnd(6), r.sil.padEnd(10), r.core.padEnd(11),
  r.white.padEnd(30), r.covT.padEnd(11), r.covA);
console.log('\n점    색            몸  피부  edge');
for (const q of o.pts) console.log(('('+q.x+','+q.y+')').padEnd(11), q.rgb.padEnd(14),
  (q.mask?'O':'X') + '   ' + (q.skin?'O':'X') + '    ' + q.edge);
await b.close();
