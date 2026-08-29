import { chromium } from 'playwright';
import path from 'path'; import fs from 'fs';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
const url = 'file://'+path.resolve('퍼스널컬러진단.html');
await p.goto(url); await p.waitForTimeout(300);
const fx = (()=>{ const s=fs.readFileSync('build/test-real.mjs','utf8');
  return s.slice(s.indexOf('  const W=500, H=1000;'), s.indexOf('  const img = person();')); })();

const saved = await p.evaluate(async () => {
  const W=700,H=900, cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const c=cv.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,W,H);
  c.fillStyle='#6d4a7a'; c.beginPath();
  c.moveTo(W*0.38,H*0.09); c.lineTo(W*0.20,H*0.13); c.lineTo(W*0.06,H*0.46);
  c.lineTo(W*0.15,H*0.50); c.lineTo(W*0.27,H*0.28); c.lineTo(W*0.28,H*0.92);
  c.lineTo(W*0.72,H*0.92); c.lineTo(W*0.73,H*0.28); c.lineTo(W*0.85,H*0.50);
  c.lineTo(W*0.94,H*0.46); c.lineTo(W*0.80,H*0.13); c.lineTo(W*0.62,H*0.09);
  c.closePath(); c.fill();
  const it = GARMENTS.importPhoto(cv, { ko:'라운드트립', cat:'top', material:'knit' });
  await GARMENTS.saveUser(it);
  return { id: it.id, sleeve: it.sleeve, hem: it.hem, hasPixels: !!(it.pixels&&it.pixels.length) };
});
console.log('저장 :', JSON.stringify(saved));

// 새 페이지 = 메모리 초기화. IndexedDB 만 남는다.
const p2 = await ctx.newPage();
p2.on('pageerror',e=>errs.push(e.message));
await p2.goto(url); await p2.waitForTimeout(300);
const r = await p2.evaluate(async (fx) => {
  const items = await GARMENTS.listUser();
  GARMENTS.registerUser(items);
  const it = items[0];
  const out = { n: items.length, hasPixels: !!(it && it.pixels && it.pixels.length),
                sleeve: it && it.sleeve, hem: it && it.hem };
  const person = new Function(fx + '; return person;')();
  const img = person();
  const body = BODY.analyzeFull(img, { gender:'male' });
  const prep = TRYON.prepare(body, img, 900);
  try {
    const res = TRYON.compose(prep, [{ garmentId: it.id, colorHex:'#6d4a7a' }],
                              { ease:1, lightAmount:0.75, eraseOriginal:true });
    out.px = res.report.layers[0].pixels;
    const cv=document.createElement('canvas'); cv.width=prep.w; cv.height=prep.h;
    cv.getContext('2d').putImageData(res.imageData,0,0);
    out.png = cv.toDataURL('image/png');
  } catch (e) { out.err = e.message; }
  return out;
}, fx);
console.log('재적재:', JSON.stringify({n:r.n, hasPixels:r.hasPixels, sleeve:r.sleeve, hem:r.hem, px:r.px, err:r.err}));
if (r.png) fs.writeFileSync('build/out/roundtrip.png', Buffer.from(r.png.split(',')[1],'base64'));
console.log('errors:', errs.length?errs.join('\n'):'none');
await b.close();
