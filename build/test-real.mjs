import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const OUT='build/out'; fs.mkdirSync(OUT,{recursive:true});
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport:{width:1400,height:1100} });
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto('file://'+path.resolve('퍼스널컬러진단.html'));
await page.waitForTimeout(300);

const r = await page.evaluate(() => {
  /* ── 사용자 사진에 가까운 합성 인물 ──────────────────────────────────
   * 지금까지 쓴 합성은 팔이 몸에서 크게 벌어지고 색이 평평했다. 실제
   * 사진은 팔이 몸에 거의 붙어 있고, 옷에 음영이 있고, 경계가 부드럽다.
   * 그 차이가 결과를 갈랐을 가능성이 크므로 그쪽에 맞춰 다시 만든다. */
  const W=500, H=1000;
  function shade(c, base, x0,y0,x1,y1, dark) {
    const g = c.createLinearGradient(x0,y0,x1,y1);
    g.addColorStop(0, base); g.addColorStop(0.55, base); g.addColorStop(1, dark);
    return g;
  }
  function person() {
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const c=cv.getContext('2d');
    c.fillStyle='#F2F2F4'; c.fillRect(0,0,W,H);
    const cx=W/2;
    const topY=H*0.035, footY=H*0.972, bodyH=footY-topY;
    const headR=bodyH*0.062;
    const chinY=topY+headR*2.05;
    const shY=chinY+bodyH*0.045;
    const waistY=topY+bodyH*0.44, hipY=topY+bodyH*0.525;
    const shHalf=bodyH*0.115, waistHalf=bodyH*0.098, hipHalf=bodyH*0.105;

    const SKIN='#D3A177', SKIN_D='#B08356';
    const TOP='#2B3A55', TOP_D='#1B2436';
    const PANT='#232A3A', PANT_D='#161B26';

    // 머리 · 목
    c.fillStyle=SKIN;
    c.beginPath(); c.ellipse(cx, topY+headR*1.05, headR*0.80, headR*1.05, 0,0,7); c.fill();
    c.fillStyle='#2A2018';  // 머리카락
    c.beginPath(); c.ellipse(cx, topY+headR*0.72, headR*0.82, headR*0.70, 0, Math.PI, 0); c.fill();
    c.fillStyle=SKIN; c.fillRect(cx-bodyH*0.028, chinY-6, bodyH*0.056, shY-chinY+10);

    // 바지 — 실제 바지처럼 **한 덩어리**로 그리고 가랑이만 파낸다.
    // 예전 픽스처는 다리 두 짝을 따로 그려 엉덩이 부분이 비어 있었고,
    // 그래서 가랑이가 실제보다 한참 위로 잡혔다.
    // 실제 인체에서 가랑이는 골반선 바로 아래다 (신장의 약 6%).
    const crotchY = hipY + bodyH*0.068;
    c.fillStyle=shade(c, PANT, cx-hipHalf,hipY, cx+hipHalf,footY, PANT_D);
    c.beginPath();
    c.moveTo(cx-hipHalf, hipY);
    c.lineTo(cx-hipHalf*0.86, footY);
    c.lineTo(cx-hipHalf*0.16, footY);
    c.lineTo(cx-hipHalf*0.10, crotchY);
    c.lineTo(cx,              crotchY - bodyH*0.012);
    c.lineTo(cx+hipHalf*0.10, crotchY);
    c.lineTo(cx+hipHalf*0.16, footY);
    c.lineTo(cx+hipHalf*0.86, footY);
    c.lineTo(cx+hipHalf, hipY);
    c.closePath(); c.fill();

    // 팔 — 몸에 거의 붙어 있다 (사용자 사진처럼).
    // 팔의 바깥선은 어깨선 **안쪽**이다. 바깥으로 나가게 그리면 소매가
    // 팔을 덮을 수 없는 몸이 되어, 실제 사진에 없는 상황으로 시험하게 된다.
    const armW=bodyH*0.042;
    [-1,1].forEach(s=>{
      const outT=cx+s*shHalf*0.97, outB=cx+s*shHalf*0.88;
      c.fillStyle=shade(c, SKIN, outT-armW,shY, outT+armW,hipY, SKIN_D);
      c.beginPath();
      c.moveTo(outT,               shY+bodyH*0.02);
      c.lineTo(outT-s*armW,        shY+bodyH*0.03);
      c.lineTo(outB-s*armW*0.86,   hipY+bodyH*0.045);
      c.lineTo(outB,               hipY+bodyH*0.04);
      c.closePath(); c.fill();
    });

    // 상의 — 반팔, 어깨에서 엉덩이까지
    c.fillStyle=shade(c, TOP, cx-shHalf,shY, cx+shHalf,hipY, TOP_D);
    c.beginPath();
    c.moveTo(cx-shHalf*0.42, shY-bodyH*0.004);
    c.lineTo(cx-shHalf, shY+bodyH*0.008);
    c.lineTo(cx-shHalf*1.02, shY+bodyH*0.115);      // 반팔 소매 끝
    c.lineTo(cx-shHalf*0.88, shY+bodyH*0.125);      // 겨드랑이 — 허리보다 넓다
    c.lineTo(cx-waistHalf, waistY);
    c.lineTo(cx-hipHalf*0.97, hipY+bodyH*0.012);
    c.lineTo(cx+hipHalf*0.97, hipY+bodyH*0.012);
    c.lineTo(cx+waistHalf, waistY);
    c.lineTo(cx+shHalf*0.88, shY+bodyH*0.125);
    c.lineTo(cx+shHalf*1.02, shY+bodyH*0.115);
    c.lineTo(cx+shHalf, shY+bodyH*0.008);
    c.lineTo(cx+shHalf*0.42, shY-bodyH*0.004);
    c.closePath(); c.fill();
    return cv;
  }

  const img = person();
  const body = BODY.analyzeFull(img, { gender:'male' });
  if (!body.ok) return { fail:'analyze', issues: body.issues };
  const prep = TRYON.prepare(body, img, 900);

  // 성별 필터 확인
  const all = GARMENTS.all();
  const male = GARMENTS.forGender(all, 'male');
  const female = GARMENTS.forGender(all, 'female');
  const skirtsForMale = male.filter(g => /스커트|원피스|블라우스|크롭|슬리브리스/.test(g.ko)).map(g=>g.ko);

  const res = TRYON.compose(prep, [
    { garmentId:'b-straight-denim', colorHex:'#3A4A63' },
    { garmentId:'t-crew-cotton',    colorHex:'#2F7E76' }
  ], { ease:1, lightAmount:0.75, eraseOriginal:true });

  const out=document.createElement('canvas'); out.width=prep.w; out.height=prep.h;
  out.getContext('2d').putImageData(res.imageData,0,0);
  const before=document.createElement('canvas'); before.width=prep.w; before.height=prep.h;
  before.getContext('2d').putImageData(prep.image,0,0);

  return {
    genderFilter: { 전체: all.length, 남성: male.length, 여성: female.length,
                    남성목록에_남은_여성복: skirtsForMale },
    lm: { top:prep.lm.top, chin:prep.lm.chinY, sh:prep.lm.shoulder.y,
          waist:prep.lm.waist.y, hip:prep.lm.hip.y, bot:prep.lm.bottom },
    arm: (()=>{ const a=TRYON.saneLM(prep.lm); const e=TRYON.limbEdges(prep, a.waist.y);
                return { sepL:e.sepL, sepR:e.sepR, coreL:e.coreL, coreR:e.coreR,
                         Lout:e.Lout, Rout:e.Rout }; })(),
    layers: res.report.layers.map(l=>({id:l.id, px:l.pixels})),
    warns: res.report.warnings,
    reveal: res.report.revealRatio, skin: res.report.skinRatio,
    before: before.toDataURL('image/png'), after: out.toDataURL('image/png')
  };
});

if (r.fail) { console.log('FAIL', r.fail, JSON.stringify(r.issues)); }
else {
  console.log('성별 필터:', JSON.stringify(r.genderFilter, null, 1));
  console.log('랜드마크:', JSON.stringify(r.lm));
  console.log('팔 검출 :', JSON.stringify(r.arm));
  console.log('레이어  :', JSON.stringify(r.layers), '| reveal', (r.reveal||0).toFixed(3), '| skin', (r.skin||0).toFixed(3));
  r.warns.forEach(w=>console.log('  ⚠', w.slice(0,70)));
  for (const k of ['before','after'])
    fs.writeFileSync(`${OUT}/real-${k}.png`, Buffer.from(r[k].split(',')[1],'base64'));
}
console.log('errors:', errs.length?errs.join('\n'):'none');
await browser.close();
