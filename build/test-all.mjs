import { chromium } from 'playwright';
import path from 'path';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await page.waitForTimeout(300);
const r = await page.evaluate(() => {
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
    return cv;
  }
  const out = { fails: [], low: [], badRecolor: [], n: 0, tRender: 0, tCompose: 0 };
  // 체형 3종 × 전체 카탈로그
  const bodies = [
    ['보통', synth(420,900,'#d9a97f','#3F6EA8','#2E3A52','#EEEEF1')],
    ['어두운 피부', synth(420,900,'#6B4A33','#8FA9C4','#3A3F4A','#E4E6EA')],
    ['밝은 배경/밝은 옷', synth(420,900,'#EAC8A8','#DCE4EC','#B7C4CC','#F4F4F6')]
  ];
  const preps = [];
  bodies.forEach(([ko, cv]) => {
    const b = BODY.analyzeFull(cv, { gender: 'female' });
    if (!b.ok) { out.fails.push(ko + ': body analyze 실패'); return; }
    preps.push([ko, TRYON.prepare(b, cv, 900)]);
  });
  const colors = ['#8E2F4A', '#F2E3C8', '#1B2B3A', '#5FA36A', '#D8722C'];
  GARMENTS.CATALOG.forEach((g, gi) => {
    let t0 = performance.now();
    let R;
    try { R = GARMENTS.get(g.id); } catch (e) { out.fails.push(g.id + ' render: ' + e.message); return; }
    out.tRender += performance.now() - t0;
    if (!R || !R.canvas) { out.fails.push(g.id + ': 렌더 결과 없음'); return; }
    preps.forEach(([ko, prep]) => {
      const hex = colors[gi % colors.length];
      let res;
      t0 = performance.now();
      try {
        res = TRYON.compose(prep, [{ garmentId: g.id, colorHex: hex }],
          { ease: 1, lightAmount: 0.75, eraseOriginal: true });
      } catch (e) { out.fails.push(g.id + ' @' + ko + ' compose: ' + e.message); return; }
      out.tCompose += performance.now() - t0;
      out.n++;
      const L = res.report.layers[0];
      if (!L) { out.fails.push(g.id + ' @' + ko + ': 레이어 없음'); return; }
      const area = prep.w * prep.h;
      if (L.pixels < area * 0.012) out.low.push(g.id + '@' + ko + '=' + L.pixels);
      const v = L.recolor && L.recolor.verify;
      if (v && (v.hitDeltaE > 12 || v.textureKeep < 0.55)) {
        out.badRecolor.push(g.id + '@' + ko + ' ΔE' + v.hitDeltaE.toFixed(1) + ' keep' + v.textureKeep.toFixed(2));
      }
    });
  });
  out.tRender = Math.round(out.tRender); out.tCompose = Math.round(out.tCompose);
  return out;
});
console.log('composes:', r.n, '| render total', r.tRender + 'ms', '| compose total', r.tCompose + 'ms',
            '| avg compose', (r.tCompose / Math.max(1,r.n)).toFixed(0) + 'ms');
console.log('FAILS (' + r.fails.length + '):', r.fails.slice(0,15).join(' | ') || 'none');
console.log('LOW COVERAGE (' + r.low.length + '):', r.low.slice(0,15).join(' | ') || 'none');
console.log('BAD RECOLOR (' + r.badRecolor.length + '):', r.badRecolor.slice(0,15).join(' | ') || 'none');
console.log('page errors:', errs.length ? errs.slice(0,5).join('\n') : 'none');
await browser.close();
