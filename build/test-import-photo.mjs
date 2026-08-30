/* 반입 경로를 실제 상품컷 모양의 입력으로 재본다.
 *
 * 지금까지 반입 경로는 한 번도 테스트되지 않았다. 절차적 카탈로그의
 * 옷본으로만 확인했는데, 그 옷본은 소매가 몸에 붙어 있어서 상품컷과
 * 형태가 근본적으로 다르다. 사용자가 겪는 결함은 이 경로에 있다.
 */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
fs.mkdirSync('build/out', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await page.waitForFunction(() => window.GARMENTS && window.TRYON);
const gf = fs.readFileSync('build/fixture-garment.js', 'utf8');
const pf = fs.readFileSync('build/fixture-photo.js', 'utf8');

const out = await page.evaluate(({ gf, pf }) => {
  new Function(gf)();
  const person = new Function(pf + '; return person;')();
  const pcv = person().canvas;
  const body = TRYON.prepare(BODY.analyzeFull(pcv, { gender: 'male' }), pcv, 760);

  const items = [], report = [];
  for (const g of GARMENT_FIXTURE.all()) {
    let it, err = null;
    try {
      it = GARMENTS.importPhoto(g.canvas, { ko: g.ko, cat: g.cat, material: g.material });
    } catch (e) { err = e.message; }
    if (err) { report.push({ ko: g.ko, err }); continue; }
    const A = it.anchors, G = it.geom;
    // 옷본이 잰 값들 — 어깨 폭이 소매 폭으로 잡히는지가 핵심
    const srcW = g.canvas.width, srcH = g.canvas.height;
    report.push({
      ko: g.ko, cat: g.cat, id: it.id, w: it.w, h: it.h,
      가로세로: (srcW / srcH).toFixed(2),
      shHalf: G.shHalf != null ? Math.round(G.shHalf) : null,
      cuffOut: G.cuffOut != null ? Math.round(G.cuffOut) : null,
      bodyHalf: G.bodyHalf != null ? Math.round(G.bodyHalf) : null,
      waistHalf: G.waistHalf != null ? Math.round(G.waistHalf) : null,
      shY: G.shY != null ? Math.round(G.shY) : null,
      armpitY: G.armpitY != null ? Math.round(G.armpitY) : null,
      hemY: G.hemY != null ? Math.round(G.hemY) : null,
      sleeve: it.sleeve, hem: it.hem,
      // 어깨 폭이 몸통 폭의 몇 배인가 — 정상이면 1.1~1.4 배쯤이다
      어깨몸통비: G.bodyHalf ? +(G.shHalf / G.bodyHalf).toFixed(2) : null,
      // 어깨 폭이 소맷부리 최대 폭의 몇 배인가 — 1.0 이면 어깨=소매폭(날개)
      어깨소매비: G.cuffOut ? +(G.shHalf / G.cuffOut).toFixed(2) : null
    });
    items.push(it);
  }

  // 실제로 입혀 본다
  const layers = [];
  const bot = items.find(i => i.cat === 'bottom');
  const top = items.find(i => i.cat === 'top');
  if (bot) layers.push({ garmentId: bot.id, colorHex: '#8A5A2C', material: 'cotton' });
  if (top) layers.push({ garmentId: top.id, colorHex: '#3F5A7E', material: 'denim' });
  let composed = null, cerr = null;
  try {
    const r = TRYON.compose(body, layers, { ease: 1, lightAmount: 0.75, eraseOriginal: true });
    const cv2 = document.createElement('canvas'); cv2.width = body.w; cv2.height = body.h;
    cv2.getContext('2d').putImageData(r.imageData, 0, 0);
    composed = cv2.toDataURL('image/png');
    report.push({ 합성: r.report.layers.map(l => l.ko + ' ' + l.pixels + 'px').join(' / '),
      reveal: +(r.report.revealRatio || 0).toFixed(3) });
  } catch (e) { cerr = e.message; }

  // 옷본 자체도 붙여서 저장 (잘 잘렸는지 눈으로)
  const strip = document.createElement('canvas');
  const SW = 420, SH = 420;
  strip.width = SW * 3; strip.height = SH;
  const sc = strip.getContext('2d');
  sc.fillStyle = '#eee'; sc.fillRect(0, 0, strip.width, SH);
  GARMENT_FIXTURE.all().forEach((g, i) => {
    const s = Math.min(SW / g.canvas.width, SH / g.canvas.height);
    sc.drawImage(g.canvas, i * SW + (SW - g.canvas.width * s) / 2,
      (SH - g.canvas.height * s) / 2, g.canvas.width * s, g.canvas.height * s);
  });
  return { report, composed, cerr, strip: strip.toDataURL('image/png') };
}, { gf, pf });

if (out.strip) fs.writeFileSync('build/out/import-src.png', Buffer.from(out.strip.split(',')[1], 'base64'));
if (out.composed) fs.writeFileSync('build/out/import-worn.png', Buffer.from(out.composed.split(',')[1], 'base64'));
for (const r of out.report) console.log(JSON.stringify(r, null, 0));
if (out.cerr) console.log('합성 오류:', out.cerr);
console.log('page errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
