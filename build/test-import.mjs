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
    c.lineTo(cx-cuffOut, cuffY-H*0.05);
    c.lineTo(cx-cuffOut*0.92, cuffY);
    c.lineTo(cx-bodyHalf, shY+H*0.18);
    c.lineTo(cx-bodyHalf*0.98, hemY);
    c.lineTo(cx+bodyHalf*0.98, hemY);
    c.lineTo(cx+bodyHalf, shY+H*0.18);
    c.lineTo(cx+cuffOut*0.92, cuffY);
    c.lineTo(cx+cuffOut, cuffY-H*0.05);
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

  /* 흔한 실패 사진 — 소매를 몸통에 붙여 찍은 티셔츠 (겨드랑이 틈이 없다) */
  function shirtArmsDown() {
    const W=600, H=760, cv=document.createElement('canvas');
    cv.width=W; cv.height=H; const c=cv.getContext('2d');
    c.fillStyle='#FFFFFF'; c.fillRect(0,0,W,H);
    const cx=W/2, shY=H*0.12, hemY=H*0.88, shHalf=W*0.30, bodyHalf=W*0.245;
    c.fillStyle='#8B3A4A';
    c.beginPath();
    c.moveTo(cx-W*0.09, shY);
    c.lineTo(cx-shHalf, shY+H*0.02);
    c.lineTo(cx-shHalf*0.98, shY+H*0.26);   // 소매가 몸통 옆에 딱 붙어 내려온다
    c.lineTo(cx-bodyHalf, shY+H*0.27);
    c.lineTo(cx-bodyHalf*0.98, hemY);
    c.lineTo(cx+bodyHalf*0.98, hemY);
    c.lineTo(cx+bodyHalf, shY+H*0.27);
    c.lineTo(cx+shHalf*0.98, shY+H*0.26);
    c.lineTo(cx+shHalf, shY+H*0.02);
    c.lineTo(cx+W*0.09, shY);
    c.closePath(); c.fill();
    return cv;
  }

  /* 후드가 어깨선 위로 펼쳐진 사진 — 실제 상품컷에서 가장 흔한 모양 */
  function hoodiePhoto() {
    const W=620, H=780, cv=document.createElement('canvas');
    cv.width=W; cv.height=H; const c=cv.getContext('2d');
    c.fillStyle='#FFFFFF'; c.fillRect(0,0,W,H);
    const cx=W/2, shY=H*0.22, hemY=H*0.92;
    const shHalf=W*0.31, bodyHalf=W*0.28, cuffOut=W*0.44, cuffY=H*0.86;
    c.fillStyle='#9A9A9E';
    // 후드 — 어깨선 위로 크게 펼쳐진다
    c.beginPath(); c.ellipse(cx, shY-H*0.04, W*0.155, H*0.085, 0, Math.PI, 0); c.fill();
    c.fillRect(cx-W*0.155, shY-H*0.05, W*0.31, H*0.06);
    // 몸통 + 소매
    c.beginPath();
    c.moveTo(cx-W*0.12, shY);
    c.lineTo(cx-shHalf, shY+H*0.02);
    c.lineTo(cx-cuffOut, cuffY-H*0.05);
    c.lineTo(cx-cuffOut*0.90, cuffY);
    c.lineTo(cx-bodyHalf, shY+H*0.20);
    c.lineTo(cx-bodyHalf*0.99, hemY);
    c.lineTo(cx+bodyHalf*0.99, hemY);
    c.lineTo(cx+bodyHalf, shY+H*0.20);
    c.lineTo(cx+cuffOut*0.90, cuffY);
    c.lineTo(cx+cuffOut, cuffY-H*0.05);
    c.lineTo(cx+shHalf, shY+H*0.02);
    c.lineTo(cx+W*0.12, shY);
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
    out.topSpec = { sleeve: item.sleeve, hem: item.hem,
      shHalf: Math.round((item.anchors.shR[0]-item.anchors.shL[0])/2) };
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
    out.pantsSpec = { hem: pants.hem, shape: pants.shape };
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
  /* ── 손으로 고친 것이 실제로 반영되는가 ──────────────────────────
   * 반입 화면은 "점을 끌어서 고치세요"라고 안내한다. 그 약속이 지켜지는지는
   * 눈이 아니라 숫자로 확인해야 한다. 대응점만 고치고 옷본 수치(geom)를
   * 그대로 두면 화면은 꿈쩍도 하지 않는다. */
  try {
    const src = GARMENTS.get(item.id);
    const base = TRYON.compose(prep, [{ garmentId:item.id, colorHex:'#8B3A4A' }],
                               { ease:1, lightAmount:0.75, eraseOriginal:true });
    const px0 = base.report.layers[0].pixels;
    const A0 = TRYON.bodyAnchors(prep, GARMENTS.byId(item.id), { ease:1 });
    const shHalf0 = A0 ? Math.round((A0.shR[0]-A0.shL[0])/2) : null;

    /* 어깨만 25% 넓힌다.
     * 전부 넓히면 아무 일도 안 일어난다 — 크기는 옷본 폭의 **중앙값 대비**로
     * 정규화되므로 통째로 키우면 그대로 약분된다. 끌어서 바뀌는 것은
     * 크기가 아니라 **비율**이다. */
    const cx = (item.anchors.shL[0] + item.anchors.shR[0]) / 2;
    ['L','R'].forEach(sd=>{
      const a = item.anchors['sh'+sd];
      a[0] = cx + (a[0] - cx) * 0.72;   // 자동 측정이 어깨를 놓쳤을 때를 흉내낸다
    });
    item.geom = GARMENTS.geomFromAnchors(item.anchors, item.cat, item.geom);
    GARMENTS.invalidate(item.id);
    /* 끌어서 고친 값이 **몸에 붙는 좌표까지** 내려가는지 본다.
     * 합성 픽셀 수로 재려 했더니 드러난 자리를 주변 색으로 메우는 단계가
     * 그 차이를 덮어 버려 보이지 않았다. 확인해야 할 것은 그 연쇄다:
     *   끌어놓은 점 → 옷본 수치(geom) → 몸 대응점 */
    const G2 = GARMENTS.get(item.id);
    out.probe = { itemGeom: item.geom && Math.round(item.geom.shHalf),
                  renderGeom: G2 && G2.geom && Math.round(G2.geom.shHalf),
                  bodyBefore: shHalf0 };
    const A3 = TRYON.bodyAnchors(prep, GARMENTS.byId(item.id), { ease:1 });
    out.probe.bodyAfter = A3 ? Math.round((A3.shR[0]-A3.shL[0])/2) : null;
    const wide = TRYON.compose(prep, [{ garmentId:item.id, colorHex:'#8B3A4A' }],
                               { ease:1, lightAmount:0.75, eraseOriginal:true });
    out.manual = { before: px0, after: wide.report.layers[0].pixels };

    // 여유분 슬라이더도 폭을 실제로 바꾸는가
    const tight = TRYON.compose(prep, [{ garmentId:item.id, colorHex:'#8B3A4A' }],
                                { ease:0.70, lightAmount:0.75, eraseOriginal:true });
    const loose = TRYON.compose(prep, [{ garmentId:item.id, colorHex:'#8B3A4A' }],
                                { ease:1.50, lightAmount:0.75, eraseOriginal:true });
    out.ease = { tight: tight.report.layers[0].pixels, loose: loose.report.layers[0].pixels };
  } catch (e) { out.manualError = e.message; }

  /* 후드가 어깨 위로 올라온 사진에서도 어깨 폭을 제대로 재야 한다 */
  try {
    const hd = GARMENTS.importPhoto(hoodiePhoto(), { ko:'후디', cat:'top', material:'cotton' });
    const A2 = hd.anchors;
    out.hood = { sleeve: hd.sleeve, hem: hd.hem,
      shHalf: Math.round((A2.shR[0]-A2.shL[0])/2),
      bodyHalf: Math.round((A2.chestR[0]-A2.chestL[0])/2),
      shY: Math.round(A2.shL[1]), h: hd.h };
    const res3 = TRYON.compose(prep, [{ garmentId:hd.id, colorHex:'#9A9A9E' }],
                               { ease:1, lightAmount:0.75, eraseOriginal:true });
    out.hoodPx = res3.report.layers[0].pixels;
  } catch (e) { out.hoodError = e.message; }

  /* 실패 사진도 터지지 않고 들어와야 한다 */
  try {
    const bad = GARMENTS.importPhoto(shirtArmsDown(), { ko:'붙은소매', cat:'top', material:'jersey' });
    out.badSleeve = bad.sleeve; out.badHem = bad.hem;
    const res2 = TRYON.compose(prep, [{ garmentId:bad.id, colorHex:'#8B3A4A' }],
                               { ease:1, lightAmount:0.75, eraseOriginal:true });
    out.badPx = res2.report.layers[0].pixels;
  } catch (e) { out.badError = e.message; }

  return out;
}, fixture);

console.log('반입 :', r.importError ? 'FAIL — '+r.importError : 'ok ' + JSON.stringify(r.size));
if (r.topSpec) console.log('  판정 :', JSON.stringify(r.topSpec));
if (r.anchorKeys) console.log('대응점:', r.anchorKeys.join(', '));
console.log('몸 대응점:', r.bodyAnchorsError ? 'FAIL — '+r.bodyAnchorsError : r.bodyAnchors);
console.log('바지 :', r.pantsError ? 'FAIL — '+r.pantsError : 'ok ' + JSON.stringify(r.pantsSpec));
if (r.pantsAnchors) console.log('  대응점:', r.pantsAnchors.join(', '));
console.log('합성 :', r.composeError ? 'FAIL — '+r.composeError : JSON.stringify(r.compose));
(r.warns||[]).forEach(w=>console.log('  ⚠', w.slice(0,80)));
if (r.png) fs.writeFileSync(`${OUT}/import.png`, Buffer.from(r.png.split(',')[1],'base64'));
if (r.probe) console.log('  probe:', JSON.stringify(r.probe));
if (r.manualError) console.log('수동 조정: FAIL —', r.manualError);
else {
  const q = r.probe;
  console.log('수동 조정: 어깨점 28% 안으로 →',
    '옷본', q.itemGeom, '· 렌더', q.renderGeom, '· 몸 대응점', q.bodyBefore, '→', q.bodyAfter,
    (q.bodyAfter != null && q.bodyBefore != null && q.bodyAfter < q.bodyBefore * 0.95 ? '✓' : '✗ 반영 안 됨'));
  console.log('여유분   : 0.70 →', r.ease.tight, '· 1.50 →', r.ease.loose,
    (r.ease.loose > r.ease.tight * 1.15 ? '✓' : '✗ 폭이 안 바뀜'));
}
console.log('후드 사진:', r.hoodError ? 'FAIL — '+r.hoodError
  : JSON.stringify(r.hood) + ' px=' + r.hoodPx);
console.log('소매 붙은 사진:', r.badError ? 'FAIL — '+r.badError
  : 'sleeve=' + r.badSleeve + ' hem=' + r.badHem + ' px=' + r.badPx);
console.log('errors:', errs.length?errs.join('\n'):'none');
await browser.close();
