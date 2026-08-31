/* 마스크가 사람 밖으로 얼마나 나가 있었는지 잰다.
 * "날개처럼 삐져나왔다"는 눈으로 본 인상이므로, 숫자로 확인하고 고쳐야 한다. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('퍼스널컬러진단_고화질합성.html'));
await p.waitForFunction(() => window.VTON && window.TRYON);
const fx = fs.readFileSync('build/fixture-photo.js', 'utf8');
const out = await p.evaluate(async (fx) => {
  const cv = new Function(fx + '; return person;')()().canvas;
  const body = TRYON.prepare(BODY.analyzeFull(cv, { gender: 'male' }), cv, 760);
  const rows = [];
  for (const id of ['t-crew-cotton', 'b-straight-denim']) {
    const mc = VTON.maskPayload(body, [{ garmentId: id }], 1024);
    if (!mc) { rows.push({ id, fail: 'null' }); continue; }
    // 마스크를 원본 크기로 되돌려 사람 마스크와 겹쳐 본다
    const t = document.createElement('canvas');
    t.width = body.w; t.height = body.h;
    const tx = t.getContext('2d', { willReadFrequently: true });
    tx.drawImage(mc, 0, 0, body.w, body.h);
    const d = tx.getImageData(0, 0, body.w, body.h).data;
    let white = 0, outside = 0;
    for (let i = 0; i < body.w * body.h; i++) {
      if (d[i * 4] > 128) { white++; if (!body.mask[i]) outside++; }
    }
    rows.push({ id, white, outsidePct: +(100 * outside / Math.max(1, white)).toFixed(1) });
  }
  return rows;
}, fx);
console.log(JSON.stringify(out, null, 1));
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await b.close();
