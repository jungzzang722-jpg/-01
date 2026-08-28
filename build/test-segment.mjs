import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const OUT='build/out'; fs.mkdirSync(OUT,{recursive:true});
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto('file://'+path.resolve('퍼스널컬러진단.html'));
await page.waitForTimeout(300);

const out = await page.evaluate(() => {
  const W=460, H=940;
  /* 인물을 그리는 함수 하나로 (a) 실제 사진용 (b) 정답 실루엣용 을 모두 만든다.
   * 정답은 배경을 마젠타로 두고 인물을 전부 검게 칠해 얻는다. */
  function draw(c, bg, skin, top, pant, hair, silhouette, vignette) {
    c.fillStyle = bg; c.fillRect(0,0,W,H);
    const cx=W/2, topY=H*0.035, footY=H*0.972, bodyH=footY-topY;
    const headR=bodyH*0.062, chinY=topY+headR*2.05, shY=chinY+bodyH*0.045;
    const waistY=topY+bodyH*0.44, hipY=topY+bodyH*0.525;
    const shHalf=bodyH*0.115, waistHalf=bodyH*0.098, hipHalf=bodyH*0.105;
    const S = silhouette ? '#000' : null;
    const g=(a,b,x0,y0,x1,y1)=>{ if(S) return S;
      const gr=c.createLinearGradient(x0,y0,x1,y1); gr.addColorStop(0,a);
      gr.addColorStop(0.55,a); gr.addColorStop(1,b); return gr; };

    // 바지
    const crotchY=hipY+bodyH*0.135;
    c.fillStyle=g(pant,'#00000022',cx-hipHalf,hipY,cx+hipHalf,footY);
    if(S) c.fillStyle=S;
    c.beginPath();
    c.moveTo(cx-hipHalf,hipY); c.lineTo(cx-hipHalf*0.86,footY);
    c.lineTo(cx-hipHalf*0.16,footY); c.lineTo(cx-hipHalf*0.10,crotchY);
    c.lineTo(cx,crotchY-bodyH*0.012); c.lineTo(cx+hipHalf*0.10,crotchY);
    c.lineTo(cx+hipHalf*0.16,footY); c.lineTo(cx+hipHalf*0.86,footY);
    c.lineTo(cx+hipHalf,hipY); c.closePath(); c.fill();
    // 팔
    const armW=bodyH*0.042;
    [-1,1].forEach(s=>{ const x0=cx+s*(shHalf+armW*0.15);
      c.fillStyle = S || skin;
      c.beginPath();
      c.moveTo(x0-s*armW*0.5, shY+bodyH*0.02); c.lineTo(x0+s*armW*0.9, shY+bodyH*0.03);
      c.lineTo(x0+s*armW*0.7, hipY+bodyH*0.045); c.lineTo(x0-s*armW*0.35, hipY+bodyH*0.04);
      c.closePath(); c.fill(); });
    // 상의
    c.fillStyle=g(top,'#00000022',cx-shHalf,shY,cx+shHalf,hipY); if(S) c.fillStyle=S;
    c.beginPath();
    c.moveTo(cx-shHalf*0.42, shY-bodyH*0.004); c.lineTo(cx-shHalf, shY+bodyH*0.008);
    c.lineTo(cx-shHalf*1.02, shY+bodyH*0.115); c.lineTo(cx-shHalf*0.80, shY+bodyH*0.125);
    c.lineTo(cx-waistHalf, waistY); c.lineTo(cx-hipHalf*0.97, hipY+bodyH*0.012);
    c.lineTo(cx+hipHalf*0.97, hipY+bodyH*0.012); c.lineTo(cx+waistHalf, waistY);
    c.lineTo(cx+shHalf*0.80, shY+bodyH*0.125); c.lineTo(cx+shHalf*1.02, shY+bodyH*0.115);
    c.lineTo(cx+shHalf, shY+bodyH*0.008); c.lineTo(cx+shHalf*0.42, shY-bodyH*0.004);
    c.closePath(); c.fill();
    // 머리 · 목
    c.fillStyle = S || skin;
    c.fillRect(cx-bodyH*0.028, chinY-6, bodyH*0.056, shY-chinY+10);
    c.beginPath(); c.ellipse(cx, topY+headR*1.05, headR*0.80, headR*1.05,0,0,7); c.fill();
    c.fillStyle = S || hair;
    c.beginPath(); c.ellipse(cx, topY+headR*0.72, headR*0.82, headR*0.70,0,Math.PI,0); c.fill();

    // 배경 비네팅 — 실제 사진처럼 위아래 밝기가 다르다
    if (vignette && !S) {
      const v=c.createLinearGradient(0,0,0,H);
      v.addColorStop(0,'rgba(0,0,0,0.00)'); v.addColorStop(1,'rgba(0,0,0,0.10)');
      c.fillStyle=v; c.fillRect(0,0,W,H);
    }
  }
  function make(cfg, silhouette) {
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    draw(cv.getContext('2d'), silhouette ? '#FF00FF' : cfg.bg,
         cfg.skin, cfg.top, cfg.pant, cfg.hair, silhouette, cfg.vignette);
    return cv;
  }
  function truthMask(cv) {
    const c=cv.getContext('2d').getImageData(0,0,W,H).data;
    const m=new Uint8Array(W*H);
    for(let i=0,p=0;p<W*H;p++,i+=4) m[p] = (c[i]>200 && c[i+1]<80 && c[i+2]>200) ? 0 : 1;
    return m;
  }
  function iou(a,b){ let inter=0,uni=0;
    for(let i=0;i<a.length;i++){ const x=a[i]?1:0,y=b[i]?1:0; if(x|y)uni++; if(x&y)inter++; }
    return uni? inter/uni : 0; }

  const CASES = [
    { ko:'어두운 옷 · 밝은 벽 (쉬움)',
      bg:'#F2F2F4', skin:'#D3A177', top:'#2B3A55', pant:'#232A3A', hair:'#2A2018', vignette:true },
    { ko:'흰 옷 · 흰 벽 (어려움)',
      bg:'#F4F4F6', skin:'#E0BB94', top:'#EDEFF2', pant:'#DCE0E6', hair:'#3A2C22', vignette:true },
    { ko:'베이지 옷 · 베이지 벽',
      bg:'#E8DFD2', skin:'#D8AE85', top:'#DED3C4', pant:'#C9BCA9', hair:'#302318', vignette:true },
    { ko:'어두운 옷 · 어두운 벽',
      bg:'#3A3A40', skin:'#C79A72', top:'#2E3038', pant:'#26282F', hair:'#1A1410', vignette:true }
  ];

  return CASES.map(cfg => {
    const photo = make(cfg,false), sil = make(cfg,true);
    const truth = truthMask(sil);
    const ctx = photo.getContext('2d');
    const img = ctx.getImageData(0,0,W,H);

    // 옛 방식 (body.js)
    const old = BODY.personMask(ctx, W, H);
    // 새 방식
    let neu=null; try { neu = SEGMENT.person(img, W, H); } catch(e){ neu={mask:new Uint8Array(W*H),issues:[{ko:e.message}],separability:0,fgRatio:0}; }

    return {
      ko: cfg.ko,
      oldIoU: iou(old.mask, truth), oldFg: old.fgRatio,
      newIoU: iou(neu.mask, truth), newFg: neu.fgRatio,
      sep: neu.separability, thr: neu.thr, hole: neu.holeRatio,
      issues: (neu.issues||[]).map(i=>i.ko.slice(0,46))
    };
  });
});

console.log('인물 분리 정확도 (IoU · 1.0 이 완벽)\n');
console.log('조건'.padEnd(26), '옛방식   새방식   개선     분리도  임계');
for (const r of out) {
  const d = r.newIoU - r.oldIoU;
  console.log(r.ko.padEnd(24),
    r.oldIoU.toFixed(3).padStart(7),
    r.newIoU.toFixed(3).padStart(8),
    ((d>=0?'+':'')+d.toFixed(3)).padStart(8),
    (r.sep*100).toFixed(0).padStart(7)+'%',
    r.thr.toFixed(1).padStart(6));
  r.issues.forEach(i=>console.log(' '.repeat(26),'⚠',i));
}
console.log('\nerrors:', errs.length?errs.join('\n'):'none');
await browser.close();
