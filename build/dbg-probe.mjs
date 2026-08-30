import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
await p.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await p.waitForFunction(() => window.TRYON);
const fx = fs.readFileSync('build/fixture-photo.js', 'utf8');
const o = await p.evaluate((fx) => {
  const cv = new Function(fx + '; return person;')()().canvas;
  const body = TRYON.prepare(BODY.analyzeFull(cv, { gender: 'male' }), cv, 900);
  const spec = GARMENTS.byId('b-straight-denim'), G = GARMENTS.get('b-straight-denim');
  const A = TRYON.bodyAnchors(body, spec, { ease: 1 }, G);
  const cover = TRYON.coverageOf(body, spec, A, 7);
  const rows = [];
  for (const y of [500, 530, 545, 560, 580, 600, 620, 640]) {
    const r = body.rows[y];
    const runs = [];
    { let run = -1;
      for (let x = 0; x <= body.w; x++) {
        if (x < body.w && body.mask[y * body.w + x]) { if (run < 0) run = x; }
        else if (run >= 0) { runs.push([run, x - 1, x - run]); run = -1; } } }
    const le = TRYON.limbEdges(body, y);
    rows.push({ y,
      runs: runs.map(q => q[0] + '~' + q[1] + '(' + q[2] + ')').join(' '),
      sil: r ? r.x0 + '~' + r.x1 : '-',
      legL: cover.legL[y*2] + '~' + cover.legL[y*2+1],
      legR: cover.legR[y*2] + '~' + cover.legR[y*2+1],
      seat: cover.torso[y*2] + '~' + cover.torso[y*2+1] });
  }
  return { crotch: A.crotchC ? A.crotchC[1] : null, hemY: A.hemY, rows };
}, fx);
console.log('crotch', o.crotch);
console.log('y     실루엣      런들                              legL       legR       seat');
for (const r of o.rows) console.log(
  String(r.y).padEnd(6), r.sil.padEnd(11), r.runs.padEnd(34), r.legL.padEnd(11), r.legR.padEnd(11), r.seat);
await b.close();
