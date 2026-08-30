/* 덮개(coverageOf)가 실제로 어떤 모양인지 그려서 본다.
 * 합성 결과만 보고 원인을 짐작하면 엉뚱한 데를 고치게 된다. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
fs.mkdirSync('build/out', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await page.waitForFunction(() => window.TRYON && window.GARMENTS);
const fx = fs.readFileSync('build/fixture-photo.js', 'utf8');

const info = await page.evaluate((fx) => {
  const cv = new Function(fx + '; return person;')()().canvas;
  const full = BODY.analyzeFull(cv, { gender: 'male' });
  const body = TRYON.prepare(full, cv, 900);
  const out = [];
  for (const [id, cat] of [['t-crew-cotton', 'top'], ['b-straight-denim', 'bottom']]) {
    const spec = GARMENTS.byId(id), G = GARMENTS.get(id);
    const anchors = TRYON.bodyAnchors(body, spec, {}, G);
    const over = Math.round(Math.min(body.w, body.h) * 0.012);
    const cover = TRYON.coverageOf(body, spec, anchors, over);
    out.push({ id, cat, cover, w: body.w, h: body.h,
      sleeveEnd: anchors._sleeveEndY, topY: anchors._topY, hemY: anchors._hemY });
  }
  // 덮개를 몸 위에 겹쳐 그린다
  const W = body.w, H = body.h;
  const cvs = document.createElement('canvas');
  cvs.width = W * out.length; cvs.height = H;
  const c = cvs.getContext('2d');
  const COLORS = { torso: [230,60,60], armL: [60,160,240], armR: [60,240,140],
                   legL: [240,180,40], legR: [190,90,230] };
  out.forEach((o, oi) => {
    const im = c.createImageData(W, H);
    const d = im.data;
    for (let i = 0; i < W * H; i++) {
      const v = body.mask[i] ? 224 : 250;
      d[i*4] = v; d[i*4+1] = v; d[i*4+2] = v; d[i*4+3] = 255;
    }
    for (const [k, col] of Object.entries(COLORS)) {
      const sp = o.cover[k]; if (!sp) continue;
      for (let y = 0; y < H; y++) {
        const a = sp[y*2], b = sp[y*2+1];
        if (a < 0) continue;
        for (let x = a; x <= b; x++) {
          const i = y * W + x;
          d[i*4]   = d[i*4]   * 0.55 + col[0] * 0.45;
          d[i*4+1] = d[i*4+1] * 0.55 + col[1] * 0.45;
          d[i*4+2] = d[i*4+2] * 0.55 + col[2] * 0.45;
        }
      }
    }
    c.putImageData(im, oi * W, 0);
  });
  return { png: cvs.toDataURL('image/png'), meta: out.map(o => ({
    id: o.id, sleeveEnd: o.sleeveEnd, topY: o.topY, hemY: o.hemY,
    rows: ['torso','armL','armR','legL','legR'].map(k => {
      const sp = o.cover[k]; if (!sp) return k + ':없음';
      let n = 0, minY = 1e9, maxY = -1;
      for (let y = 0; y < o.h; y++) if (sp[y*2] >= 0) { n++; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      return k + ':' + n + '행 y' + (n ? minY + '~' + maxY : '-');
    }).join('  ')
  })) };
}, fx);
fs.writeFileSync('build/out/cover.png', Buffer.from(info.png.split(',')[1], 'base64'));
for (const m of info.meta) console.log(m.id, ' top', Math.round(m.topY), 'hem', Math.round(m.hemY),
  'sleeveEnd', m.sleeveEnd == null ? '-' : Math.round(m.sleeveEnd), '\n   ', m.rows);
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
