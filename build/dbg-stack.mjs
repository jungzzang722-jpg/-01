/* 겹쳐 입을 때 위층이 아래층을 제대로 덮는가 — 어깨선 비교. */
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
  const out = [];
  for (const id of ['t-pique-half-zip', 'o-trench', 't-summer-knit', 'o-linen-jk', 't-crew-cotton']) {
    const spec = GARMENTS.byId(id), G = GARMENTS.get(id);
    const A = TRYON.bodyAnchors(body, spec, { ease: 1 }, G);
    out.push({ id, cat: spec.cat, fit: spec.fit, neck: spec.neck,
      topY: Math.round(A._topY), shY: Math.round(A._shY), neckY: Math.round(A._neckY),
      shL: Math.round(A.shL[0]), shR: Math.round(A.shR[0]),
      neckL: Math.round(A.neckL[0]), neckR: Math.round(A.neckR[0]) });
  }
  // 트렌치가 stackTop 166 을 받았을 때 덮개가 실제로 어디까지 올라가는지
  const spec = GARMENTS.byId('o-trench'), G = GARMENTS.get('o-trench');
  const A = TRYON.bodyAnchors(body, spec, { ease: 1 }, G);
  const over = 14;
  const probe = {};
  for (const st of [null, 166]) {
    const c = TRYON.coverageOf(body, spec, A, over, st);
    let minY = 1e9, minA = 1e9;
    for (let y = 0; y < body.h; y++) {
      if (c.torso[y*2] >= 0) minY = Math.min(minY, y);
      if (c.armL && c.armL[y*2] >= 0) minA = Math.min(minA, y);
    }
    probe['stackTop=' + st] = { torsoTop: minY, armTop: minA === 1e9 ? '-' : minA,
      row170: c.torso[170*2] + '~' + c.torso[170*2+1] };
  }
  return { out, probe };
}, fx);
console.log('옷                 종류   fit  목선      topY  shY  neckY  어깨 x       목 x');
for (const r of o.out) console.log(r.id.padEnd(18), r.cat.padEnd(6), String(r.fit).padEnd(5),
  String(r.neck).padEnd(9), String(r.topY).padStart(4), String(r.shY).padStart(5),
  String(r.neckY).padStart(6), '  ' + (r.shL + '~' + r.shR).padEnd(12), r.neckL + '~' + r.neckR);
console.log('\n트렌치 덮개:', JSON.stringify(o.probe));
await b.close();
