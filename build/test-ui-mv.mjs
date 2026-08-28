import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const OUT='build/out'; fs.mkdirSync(OUT,{recursive:true});
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport:{width:1400,height:1200} });
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
await page.goto('file://'+path.resolve('퍼스널컬러진단.html'));
await page.waitForTimeout(300);

/* 합성 인물 3컷을 파일로 저장 — 실제 파일 입력을 그대로 쓰기 위해 */
const shots = await page.evaluate(() => {
  const W=440,H=940,SH=0.205,HIP=0.545,FOOT=0.965,TOP=0.040;
  function truth(t){const a=0.098-0.030*Math.sin(t*Math.PI*0.92)+0.020*t*t;
    return {a,b:a*(0.62+0.20*Math.sin(t*Math.PI)+0.06*t)};}
  function proj(a,b,d){const th=d*Math.PI/180;
    return Math.sqrt(Math.pow(a*Math.cos(th),2)+Math.pow(b*Math.sin(th),2));}
  function render(deg){
    const cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d');
    c.fillStyle='#EFEFF2';c.fillRect(0,0,W,H);
    const cx=W/2,bodyH=H*(FOOT-TOP),shY=H*SH,hipY=H*HIP,footY=H*FOOT;
    const th=deg*Math.PI/180,ct=Math.cos(th);
    const cyl=(xb,r)=>({c:cx+xb*ct*bodyH,h:r*bodyH});
    const hipA=truth(1).a;
    c.fillStyle='#2F3947';
    [-1,1].forEach(s=>{const l=cyl(s*hipA*0.46,hipA*0.40);
      c.beginPath();c.moveTo(l.c-l.h,hipY);c.lineTo(l.c-l.h*0.8,footY);
      c.lineTo(l.c+l.h*0.8,footY);c.lineTo(l.c+l.h,hipY);c.closePath();c.fill();});
    c.fillStyle='#d9a97f';const shA=truth(0).a;
    [-1,1].forEach(s=>{const a=cyl(s*(shA+0.026),0.020);
      c.fillRect(a.c-a.h,shY+bodyH*0.02,a.h*2,bodyH*0.36);});
    c.fillStyle='#4A6D9B';
    [-1,1].forEach(s=>{const a=cyl(s*(shA+0.026),0.024);
      c.fillRect(a.c-a.h,shY+bodyH*0.02,a.h*2,bodyH*0.20);});
    c.beginPath();const pts=[];
    for(let i=0;i<=60;i++){const t=i/60,y=shY+t*(hipY-shY),{a,b}=truth(t);
      pts.push([cx-proj(a,b,deg)*bodyH,y]);}
    pts.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));
    for(let i=pts.length-1;i>=0;i--)c.lineTo(2*cx-pts[i][0],pts[i][1]);
    c.closePath();c.fill();
    const Hb=0.090,hh=proj(Hb/2,Hb*1.28/2,deg)*bodyH;
    const hT=H*TOP,hB=hT+Hb*1.35*bodyH;
    c.fillStyle='#d9a97f';c.beginPath();
    c.ellipse(cx,(hT+hB)/2,hh,(hB-hT)/2,0,0,7);c.fill();
    const n=cyl(0,0.026);c.fillRect(n.c-n.h,hB-4,n.h*2,shY-hB+8);
    return cv.toDataURL('image/png');
  }
  return { front: render(0), left: render(90), right: render(-90) };
});
for (const [k,v] of Object.entries(shots))
  fs.writeFileSync(`${OUT}/mv-${k}.png`, Buffer.from(v.split(',')[1],'base64'));
await page.evaluate(s => { window.__shots = s; }, [shots.front, shots.left, shots.right]);

/* 3단계를 열고 실제 파일 입력으로 세 컷을 넣는다 */
await page.evaluate(() => {
  document.querySelectorAll('.card[data-step]').forEach(c => c.classList.add('hidden'));
  document.querySelector('.card[data-step="3"]').classList.remove('hidden');
});
await page.setInputFiles('#fileFull', path.resolve(OUT,'mv-front.png'));
await page.waitForTimeout(1800);
// 실측 입력은 <details> 안에 접혀 있다 — 펼쳐야 조작할 수 있다
await page.evaluate(() => { const d=document.querySelector('#measBox'); if(d) d.open = true; });
await page.fill('#mHeight', '168');
await page.dispatchEvent('#mHeight','change');
await page.setInputFiles('#fileSideL', path.resolve(OUT,'mv-left.png'));
await page.waitForTimeout(1800);
await page.setInputFiles('#fileSideR', path.resolve(OUT,'mv-right.png'));
await page.waitForTimeout(2200);

const st = await page.evaluate(() => {
  const p = document.querySelector('#mvPanel');
  return {
    filled: document.querySelectorAll('.mv-drop.filled').length,
    thumbs: document.querySelectorAll('.mv-thumb:not(.hidden)').length,
    hasPanel: !!p.querySelector('.mv-panel'),
    pills: [...p.querySelectorAll('.pill')].map(e=>e.textContent),
    rows: [...p.querySelectorAll('.mv-table tbody tr')].map(r =>
      [...r.querySelectorAll('td')].map(t=>t.textContent).join(' | ')),
    angles: [...p.querySelectorAll('.mv-ang b')].map(e=>e.textContent),
    warns: [...p.querySelectorAll('.note')].map(e=>e.textContent.trim().slice(0,70))
  };
});
console.log('STEP3:', JSON.stringify(st, null, 1));
await page.locator('.card[data-step="3"]').screenshot({ path: OUT+'/ui-mv-step3.png' });

/* 각도 슬라이더 조작 → 재계산되는가 */
await page.evaluate(() => {
  const r = document.querySelector('.mv-ang input');
  r.value = '60';
  r.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(1200);
const after = await page.evaluate(() => {
  const p = document.querySelector('#mvPanel');
  return { pills: [...p.querySelectorAll('.pill')].map(e=>e.textContent),
           rows: [...p.querySelectorAll('.mv-table tbody tr')].map(r=>r.querySelector('td:last-child').textContent) };
});
console.log('각도 60°로 변경 후:', JSON.stringify(after));

/* 리포트를 띄우고 가상 피팅 탭에서 시점 전환 */
const rep = await page.evaluate(async () => {
  const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
  const imgs = await Promise.all(window.__shots.map(load));
  const views = imgs.map(im => {
    const b = BODY.analyzeFull(im, { gender: 'female' });
    return b.ok ? { img: im, body: b } : null;
  });
  const mv = MULTIVIEW.solve(views, { heightCm: 168 });
  const feat = { skin: CC.rgbToLab(201,154,114), hair: CC.rgbToLab(59,42,32),
    iris: CC.rgbToLab(72,54,42), lip: CC.rgbToLab(178,104,98),
    sclera: CC.rgbToLab(238,238,236), quality:{score:.8,level:'good'}, work:null };
  const dx = DIAGNOSE.diagnose(feat, { makeup:0, dyed:0 });
  const rec = RECOMMEND.recommend(dx, views[0].body, 'female');
  const el = document.querySelector('#reportSection');
  document.querySelectorAll('.card[data-step]').forEach(c => c.classList.add('hidden'));
  el.classList.remove('hidden');
  el.innerHTML = REPORT.fullReport(dx, views[0].body, rec, feat, 'all', null, null);
  REPORT.mountFullReport(el, dx, views[0].body, rec, feat, 'all', views[0].img,
    { views: views, mv: mv, img: views[0].img, body: views[0].body });
  window.__diag = views.map((v, i) => {
    if (!v) return null;
    const p = TRYON.prepare(v.body, v.img, 900);
    const L = TRYON.saneLM(p.lm);
    return { i, h: p.h, top: L.top, chin: L.chinY, sh: L.shoulder.y,
             waist: L.waist.y, hip: L.hip.y, bot: L.bottom,
             shW: Math.round(L.shoulder.w), hipW: Math.round(L.hip.w) };
  });
  // 정답(원본 940px 기준을 prep 배율로)
  const p0 = TRYON.prepare(views[0].body, views[0].img, 900);
  const k = p0.h / 940;
  window.__truth = { sh: Math.round(940*0.205*k), hip: Math.round(940*0.545*k),
                     foot: Math.round(940*0.965*k), top: Math.round(940*0.040*k) };
  return { type: dx.type.ko, mvOk: mv.ok, angles: mv.angles, depthRatio: +mv.depthRatio.toFixed(3) };
});
console.log('report:', JSON.stringify(rep));

await page.click('.tab[data-panel="tryon"]');
await page.waitForTimeout(3500);
const vs = await page.evaluate(() => {
  const h = document.querySelector('.tab-panel[data-panel="tryon"]');
  const c = h.querySelector('#fitCanvas');
  return {
    viewButtons: [...h.querySelectorAll('#fitViewSeg .seg-btn')].map(b=>b.textContent),
    canvas: c ? c.width + 'x' + c.height : 'none',
    report: (h.querySelector('#fitReport')||{}).textContent?.slice(0,300)
  };
});
console.log('시점:', JSON.stringify(vs, null, 1));
console.log('랜드마크:', JSON.stringify(await page.evaluate(() => window.__diag)));
console.log('정답:', JSON.stringify(await page.evaluate(() => window.__truth)));
await page.locator('#fitStage').screenshot({ path: OUT+'/mv-view-0.png' });

for (const idx of [1, 2]) {
  const btn = page.locator('#fitViewSeg .seg-btn').nth(idx);
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(3000);
    await page.locator('#fitStage').screenshot({ path: `${OUT}/mv-view-${idx}.png` });
  }
}
console.log('--- errors ---'); console.log(errs.length?errs.join('\n'):'(none)');
await browser.close();
