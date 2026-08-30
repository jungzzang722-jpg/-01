/* 후드 반입이 왜 실패하는지, 바지 기장이 왜 미디로 잡히는지. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await p.waitForFunction(() => window.GARMENTS);
const gf = fs.readFileSync('build/fixture-garment.js', 'utf8');
const o = await p.evaluate((gf) => {
  new Function(gf)();
  const out = [];
  for (const g of GARMENT_FIXTURE.all()) {
    const cut = GARMENTS.cutout(g.canvas, 560);
    const w = cut.w, h = cut.h, m = cut.mask;
    // 행별 폭 프로파일
    const rows = [];
    for (let y = 0; y < h; y++) {
      let lo = -1, hi = -1, runs = 0, run = -1;
      for (let x = 0; x <= w; x++) {
        const on = x < w && m[y * w + x];
        if (on) { if (lo < 0) lo = x; hi = x; if (run < 0) run = x; }
        else if (run >= 0) { runs++; run = -1; }
      }
      rows.push({ w: lo < 0 ? 0 : hi - lo + 1, runs });
    }
    let top = 0; while (top < h && rows[top].w === 0) top++;
    let bot = h - 1; while (bot > top && rows[bot].w === 0) bot--;
    const HH = bot - top;
    const refBand = Math.round(HH * 0.45);
    let wRef = 0;
    for (let yr = top; yr <= top + refBand && yr <= bot; yr++) wRef = Math.max(wRef, rows[yr].w);
    const wTop = rows[top + Math.max(1, Math.round(HH * 0.015))].w;
    const prof = [];
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const y = Math.round(top + HH * t);
      prof.push(t.toFixed(2) + ':' + rows[Math.min(bot, y)].w + '/' + rows[Math.min(bot, y)].runs);
    }
    const P = g.cat === 'bottom' ? GARMENTS.measureBottom(m, w, h) : GARMENTS.measureTop(m, w, h);
    out.push({ ko: g.ko, cat: g.cat, w, h, ratio: +cut.ratio.toFixed(3),
      top, bot, HH, wRef, wTop, 목후드분기: wTop < wRef * 0.45,
      P: P ? Object.keys(P).map(k => k + '=' + (typeof P[k] === 'number' ? Math.round(P[k]) : P[k])).join(' ') : 'null',
      prof: prof.join(' ') });
  }
  // 잘라낸 마스크를 그림으로 — 숫자만 봐서는 어디가 뚫렸는지 모른다
  const strip = document.createElement('canvas');
  const gs = GARMENT_FIXTURE.all();
  const SW = 380;
  strip.width = SW * gs.length * 2; strip.height = SW;
  const sc = strip.getContext('2d');
  sc.fillStyle = '#f0f0f0'; sc.fillRect(0, 0, strip.width, SW);
  gs.forEach((g, i) => {
    const cut = GARMENTS.cutout(g.canvas, 560);
    const sc1 = Math.min(SW / cut.w, SW / cut.h);
    // 원본
    sc.drawImage(g.canvas, i * SW * 2, 0, cut.w * sc1, cut.h * sc1);
    // 마스크
    const mc = document.createElement('canvas'); mc.width = cut.w; mc.height = cut.h;
    const mx = mc.getContext('2d'), mi = mx.createImageData(cut.w, cut.h);
    for (let k = 0; k < cut.mask.length; k++) {
      const v = cut.mask[k] ? 30 : 250;
      mi.data[k*4] = cut.mask[k] ? 40 : 250;
      mi.data[k*4+1] = v; mi.data[k*4+2] = v; mi.data[k*4+3] = 255;
    }
    mx.putImageData(mi, 0, 0);
    sc.drawImage(mc, i * SW * 2 + SW, 0, cut.w * sc1, cut.h * sc1);
  });
  return { out, strip: strip.toDataURL('image/png') };
}, gf);
fs.writeFileSync('build/out/cutout.png', Buffer.from(o.strip.split(',')[1], 'base64'));
for (const r of o.out) {
  console.log('\n■ ' + r.ko + '  ' + r.w + 'x' + r.h + '  전경비 ' + r.ratio);
  console.log('  top' + r.top + ' bot' + r.bot + ' HH' + r.HH + '  wRef ' + r.wRef +
    ' wTop ' + r.wTop + '  목후드분기 ' + r.목후드분기);
  console.log('  폭 프로파일(높이비:폭/조각수)');
  console.log('   ', r.prof);
  console.log('  측정: ' + r.P);
}
console.log('\npage errors:', errs.length ? errs.join(' | ') : 'none');
await b.close();
