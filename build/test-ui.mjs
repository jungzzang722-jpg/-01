import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const OUT='build/out'; fs.mkdirSync(OUT,{recursive:true});
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport:{width:1440,height:1100}, deviceScaleFactor:1 });
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
await page.goto('file://'+path.resolve('퍼스널컬러진단.html'));
await page.waitForTimeout(300);

const setup = await page.evaluate(() => {
  function synth(w,h,skin,shirt,pants,bg){
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;const c=cv.getContext('2d');
    c.fillStyle=bg;c.fillRect(0,0,w,h);
    const cx=w/2,headR=h*0.060,headTop=h*0.045,chinY=headTop+headR*2.1;
    const shY=chinY+h*0.035,waistY=h*0.44,hipY=h*0.54,footY=h*0.965;
    const shHalf=w*0.145,waistHalf=w*0.105,hipHalf=w*0.128;
    c.fillStyle=skin;
    c.beginPath();c.ellipse(cx,headTop+headR*1.05,headR*0.82,headR*1.05,0,0,7);c.fill();
    c.fillRect(cx-w*0.026,chinY-4,w*0.052,shY-chinY+8);
    c.fillRect(cx-hipHalf*0.92,hipY,hipHalf*0.82,footY-hipY);
    c.fillRect(cx+hipHalf*0.10,hipY,hipHalf*0.82,footY-hipY);
    c.save();c.translate(cx-shHalf,shY);c.rotate(0.16);c.fillRect(-w*0.032,0,w*0.062,h*0.36);c.restore();
    c.save();c.translate(cx+shHalf,shY);c.rotate(-0.16);c.fillRect(-w*0.030,0,w*0.062,h*0.36);c.restore();
    c.fillStyle=shirt;c.beginPath();
    c.moveTo(cx-shHalf,shY);c.lineTo(cx-shHalf*1.06,shY+h*0.20);c.lineTo(cx-waistHalf,waistY);
    c.lineTo(cx-hipHalf*0.96,hipY+h*0.015);c.lineTo(cx+hipHalf*0.96,hipY+h*0.015);
    c.lineTo(cx+waistHalf,waistY);c.lineTo(cx+shHalf*1.06,shY+h*0.20);c.lineTo(cx+shHalf,shY);
    c.closePath();c.fill();
    c.fillStyle=pants;c.beginPath();
    c.moveTo(cx-hipHalf,hipY);c.lineTo(cx-hipHalf*0.80,footY-h*0.02);c.lineTo(cx-hipHalf*0.10,footY-h*0.02);
    c.lineTo(cx,hipY+h*0.16);c.lineTo(cx+hipHalf*0.10,footY-h*0.02);c.lineTo(cx+hipHalf*0.80,footY-h*0.02);
    c.lineTo(cx+hipHalf,hipY);c.closePath();c.fill();
    const im=c.getImageData(0,0,w,h),d=im.data;
    const bc=document.createElement('canvas').getContext('2d');bc.fillStyle=bg;bc.fillRect(0,0,1,1);
    const b0=bc.getImageData(0,0,1,1).data;
    for(let y=0,i=0;y<h;y++)for(let x=0;x<w;x++,i+=4){
      if(Math.abs(d[i]-b0[0])<6&&Math.abs(d[i+1]-b0[1])<6&&Math.abs(d[i+2]-b0[2])<6)continue;
      const m=1.18-0.34*(x/w);
      d[i]=Math.min(255,d[i]*m);d[i+1]=Math.min(255,d[i+1]*m);d[i+2]=Math.min(255,d[i+2]*m);
    }
    c.putImageData(im,0,0);return cv;
  }
  const photo = synth(420,900,'#d9a97f','#3F6EA8','#2E3A52','#EEEEF1');
  window.__photo = photo;

  // 진단 결과는 사진 대신 특징값으로 직접 만든다 — 여기서 검증하려는 것은
  // 얼굴 분석이 아니라 가상 피팅 화면이다.
  const feat = {
    skin: CC.rgbToLab(217,169,127), hair: CC.rgbToLab(59,42,32),
    iris: CC.rgbToLab(72,54,42), lip: CC.rgbToLab(178,104,98),
    sclera: CC.rgbToLab(238,238,236),
    quality: { score: 0.8, level: 'good' }, work: null
  };
  const dx = DIAGNOSE.diagnose(feat, { makeup: 0, dyed: 0 });
  const body = BODY.analyzeFull(photo, { gender: 'female' });
  if (!body.ok) return { fail: 'body', issues: body.issues };
  const rec = RECOMMEND.recommend(dx, body, 'female');
  const el = document.querySelector('#reportSection');
  el.classList.remove('hidden');
  document.querySelectorAll('.card[data-step]').forEach(c => c.classList.add('hidden'));
  el.innerHTML = REPORT.fullReport(dx, body, rec, feat, 'all', null, null);
  REPORT.mountFullReport(el, dx, body, rec, feat, 'all', photo);
  return { ok: true, type: dx.type.ko, tabs: [...el.querySelectorAll('.tab')].map(t=>t.textContent) };
});
console.log('setup:', JSON.stringify(setup));
if (setup.fail) { console.log(JSON.stringify(setup.issues)); await browser.close(); process.exit(1); }

await page.click('.tab[data-panel="tryon"]');
await page.waitForTimeout(2500);
const state1 = await page.evaluate(() => {
  const h = document.querySelector(".tab-panel[data-panel=\"tryon\"]");
  const cv = h.querySelector('#fitCanvas');
  return {
    items: h.querySelectorAll('.fit-item').length,
    thumbsDrawn: h.querySelectorAll('.fit-thumb canvas').length,
    swatches: h.querySelectorAll('.fit-sw').length,
    canvas: cv ? cv.width + 'x' + cv.height : 'none',
    selected: [...h.querySelectorAll('.fit-item.on')].map(e=>e.dataset.id),
    report: (h.querySelector('#fitReport')||{}).textContent?.slice(0,180)
  };
});
console.log('after mount:', JSON.stringify(state1, null, 1));
await page.locator(String.raw`.tab-panel[data-panel="tryon"]`).screenshot({ path: OUT+'/ui-tryon.png' });

// 상호작용: 아우터 탭 → 첫 옷 선택 → 다른 색 선택 → 슬라이더
await page.click('#fitCatSeg .seg-btn[data-cat="outer"]');
await page.waitForTimeout(600);
await page.locator('#fitGrid .fit-item').nth(2).click();
await page.waitForTimeout(2000);
await page.locator('#fitColorBox .fit-sw').nth(3).click();
await page.waitForTimeout(2000);
// 세부 조절은 접혀 있다 (스크롤을 줄이려고) — 펴고 만진다
await page.evaluate(() => {
  const d = document.querySelector('.tab-panel[data-panel="tryon"] .fit-fold');
  if (d) d.open = true;
});
await page.waitForTimeout(200);
await page.locator('#fitEase').fill('118');
await page.dispatchEvent('#fitEase','input');
await page.waitForTimeout(1500);
const state2 = await page.evaluate(() => {
  const h = document.querySelector(".tab-panel[data-panel=\"tryon\"]");
  return {
    selected: [...h.querySelectorAll('.fit-item.on')].map(e=>e.dataset.id),
    ease: h.querySelector('#fitEaseV').textContent,
    reportRows: h.querySelectorAll('.fit-rep-row').length,
    report: (h.querySelector('#fitReport')||{}).textContent?.slice(0,300)
  };
});
console.log('after interaction:', JSON.stringify(state2, null, 1));
await page.locator(String.raw`.tab-panel[data-panel="tryon"]`).screenshot({ path: OUT+'/ui-tryon2.png' });

// 와이프 슬라이더
await page.locator('#fitWipe').fill('50');
await page.dispatchEvent('#fitWipe','input');
await page.waitForTimeout(400);
await page.locator('#fitStage').screenshot({ path: OUT+'/ui-wipe.png' });

console.log('--- errors ---'); console.log(errs.length?errs.join('\n'):'(none)');
await browser.close();
