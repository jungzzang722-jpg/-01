/* ChatGPT 등이 만들어 준 "평면 상품컷"을 반입해 실제로 입혀 본다.
 * 합성 이미지지만 생성 이미지와 같은 조건이다 — 흰 배경 · 정면 · 평면. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const OUT='build/out'; fs.mkdirSync(OUT,{recursive:true});
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport:{width:1200,height:900} });
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto('file://'+path.resolve('퍼스널컬러진단.html'));
await page.waitForTimeout(300);
const fixture = (()=>{ const src=fs.readFileSync('build/test-real.mjs','utf8');
  return src.slice(src.indexOf('  const W=500, H=1000;'), src.indexOf('  const img = person();')); })();

const r = await page.evaluate(async (fx) => {
  const person = new Function(fx + '; return person;')();

  /* 상품컷 — 흰 배경에 놓인 반팔 티셔츠 (생성 이미지가 흔히 이런 모양이다) */
  function shirtPhoto() {
    const W=600, H=760, cv=document.createElement('canvas');
    cv.width=W; cv.height=H; const c=cv.getContext('2d');
    c.fillStyle='#FFFFFF'; c.fillRect(0,0,W,H);
    const cx=W/2, shY=H*0.12, hemY=H*0.88;
    const shHalf=W*0.30, bodyHalf=W*0.245, cuffOut=W*0.40, cuffY=H*0.40;
    c.fillStyle='#8B3A4A';
    c.beginPath();
    c.moveTo(cx-W*0.09, shY);
    c.lineTo(cx-shHalf, shY+H*0.02);
    c.lineTo(cx-cuffOut, cuffY-H*0.06);
    c.lineTo(cx-cuffOut*0.92, cuffY);
    c.lineTo(cx-bodyHalf, shY+H*0.22);
    c.lineTo(cx-bodyHalf*0.98, hemY);
    c.lineTo(cx+bodyHalf*0.98, hemY);
    c.lineTo(cx+bodyHalf, shY+H*0.22);
    c.lineTo(cx+cuffOut*0.92, cuffY);
    c.lineTo(cx+cuffOut, cuffY-H*0.06);
    c.lineTo(cx+shHalf, shY+H*0.02);
    c.lineTo(cx+W*0.09, shY);
    c.closePath(); c.fill();
    c.strokeStyle='rgba(0,0,0,.35)'; c.lineWidth=4;
    c.beginPath(); c.ellipse(cx, shY+H*0.008, W*0.095, H*0.022, 0, 0, Math.PI); c.stroke();
    return cv;
  }

  /* 상품컷 — 흰 배경에 펼쳐 놓은 바지 */
  function pantsPhoto() {
    const W=600, H=860, cv=document.createElement('canvas');
    cv.width=W; cv.height=H; const c=cv.getContext('2d');
    c.fillStyle='#FFFFFF'; c.fillRect(0,0,W,H);
    const cx=W/2, wY=H*0.06, hipY=H*0.22, crY=H*0.36, hemY=H*0.95;
    const wHalf=W*0.21, hipHalf=W*0.26, legOut=W*0.115, legIn=W*0.035;
    c.fillStyle='#3F5B80';
    c.beginPath();
    c.moveTo(cx-wHalf, wY); c.lineTo(cx-hipHalf, hipY);
    c.lineTo(cx-legOut-W*0.02, hemY); c.lineTo(cx-legIn, hemY);
    c.lineTo(cx-W*0.012, crY); c.lineTo(cx, crY-H*0.012); c.lineTo(cx+W*0.012, crY);
    c.lineTo(cx+legIn, hemY); c.lineTo(cx+legOut+W*0.02, hemY);
    c.lineTo(cx+hipHalf, hipY); c.lineTo(cx+wHalf, wY);
    c.closePath(); c.fill();
    return cv;
  }

  const out = { steps: [] };
  let item=null;
  try {
    item = GARMENTS.importPhoto(shirtPhoto(), { ko:'생성 티셔츠', cat:'top', material:'jersey' });
    out.steps.push('importPhoto ok');
    out.anchorKeys = Object.keys(item.anchors);
    out.size = [item.w, item.h];
  } catch (e) { out.importError = e.message; return out; }

  const img = person();
  const body = BODY.analyzeFull(img, { gender:'male' });
  if (!body.ok) { out.steps.push('analyze fail'); return out; }
  const prep = TRYON.prepare(body, img, 900);

  try {
    const A = TRYON.bodyAnchors(prep, { id:item.id, cat:'top', sleeve:'short', hem:'hip', fit:1 }, { ease:1 });
    out.bodyAnchors = A ? 'ok' : 'null';
  } catch (e) { out.bodyAnchorsError = e.message; }

  let pants=null;
  try {
    pants = GARMENTS.importPhoto(pantsPhoto(), { ko:'생성 바지', cat:'bottom', material:'denim' });
    out.steps.push('pants ok');
    out.pantsAnchors = Object.keys(pants.anchors);
  } catch (e) { out.pantsError = e.message; }

  try {
    const layers = [{ garmentId:item.id, colorHex:'#8B3A4A' }];
    if (pants) layers.unshift({ garmentId:pants.id, colorHex:'#3F5B80' });
    const res = TRYON.compose(prep, layers,
                              { ease:1, lightAmount:0.75, eraseOriginal:true });
    out.compose = res ? res.report.layers.map(l=>({id:l.id, px:l.pixels})) : 'null';
    if (res) {
      const cv=document.createElement('canvas'); cv.width=prep.w; cv.height=prep.h;
      cv.getContext('2d').putImageData(res.imageData,0,0);
      out.png = cv.toDataURL('image/png');
      out.warns = res.report.warnings;
    }
  } catch (e) { out.composeError = e.message + ' | ' + (e.stack||'').split('\n')[1]; }
  return out;
}, fixture);

console.log('반입 :', r.importError ? 'FAIL — '+r.importError : 'ok ' + JSON.stringify(r.size));
if (r.anchorKeys) console.log('대응점:', r.anchorKeys.join(', '));
console.log('몸 대응점:', r.bodyAnchorsError ? 'FAIL — '+r.bodyAnchorsError : r.bodyAnchors);
console.log('바지 :', r.pantsError ? 'FAIL — '+r.pantsError : 'ok');
if (r.pantsAnchors) console.log('  대응점:', r.pantsAnchors.join(', '));
console.log('합성 :', r.composeError ? 'FAIL — '+r.composeError : JSON.stringify(r.compose));
(r.warns||[]).forEach(w=>console.log('  ⚠', w.slice(0,80)));
if (r.png) fs.writeFileSync(`${OUT}/import.png`, Buffer.from(r.png.split(',')[1],'base64'));
console.log('errors:', errs.length?errs.join('\n'):'none');
await browser.close();
