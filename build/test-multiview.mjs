import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
fs.mkdirSync('build/out', { recursive: true });
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto('file://'+path.resolve('퍼스널컬러진단.html'));
await page.waitForTimeout(300);

const out = await page.evaluate(() => {
  const W = 440, H = 940;
  const SH = 0.205, HIP = 0.545, FOOT = 0.965;   // 몸 높이 대비 위치
  const TOP = 0.040;

  /* 정답 프로파일 — 키 대비 비율.
   * 어깨 넓고 허리 좁고 골반 넓은 전형적 형태. 두께는 가슴·골반에서 두껍다. */
  function truth(t) {                             // t: 0=어깨 … 1=골반
    const a = 0.098 - 0.030 * Math.sin(t * Math.PI * 0.92) + 0.020 * t * t;
    const b = a * (0.62 + 0.20 * Math.sin(t * Math.PI) + 0.06 * t);
    return { a, b };
  }

  /* 회전한 실루엣의 반폭.
   * m=2 면 타원, m<2 면 타원보다 납작한 초타원(superellipse) 단면이다.
   * (초타원 |x/a|^n+|z/b|^n=1 의 지지함수 지수는 m=n/(n-1)) */
  function projected(a, b, degrees, m) {
    const th = degrees * Math.PI / 180;
    const ca = Math.abs(a * Math.cos(th)), sb = Math.abs(b * Math.sin(th));
    if (m === 2) return Math.sqrt(ca * ca + sb * sb);
    return Math.pow(Math.pow(ca, m) + Math.pow(sb, m), 1 / m);
  }

  /* 제대로 된 3D→2D 투영으로 그린다.
   * 예전에는 팔을 "투영된 어깨 폭"의 바깥에 붙였는데, 옆모습에서는 그러면
   * 팔이 몸통 앞뒤로 튀어나와 두께가 46%나 부풀었다. 실제 팔은 몸의 **옆**에
   * 달려 있어 옆에서 보면 몸통 뒤에 가려진다. 부위마다 3D 위치를 주고
   * 회전시켜야 시험이 의미가 있다. */
  function render(deg, m) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#EFEFF2'; c.fillRect(0, 0, W, H);
    const cx = W / 2, bodyH = H * (FOOT - TOP);
    const shY = H * SH, hipY = H * HIP, footY = H * FOOT;
    const th = deg * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);

    // 좌우 x_b, 앞뒤 z_b 에 놓인 원기둥(반지름 r)의 투영 중심과 반폭
    const cyl = (xb, r) => ({ c: cx + xb * ct * bodyH, h: r * bodyH });

    // 다리 — 몸통 뒤에 먼저 그린다
    const hipA = truth(1).a;
    c.fillStyle = '#2F3947';
    [-1, 1].forEach(s2 => {
      const leg = cyl(s2 * hipA * 0.46, hipA * 0.40);
      c.beginPath();
      c.moveTo(leg.c - leg.h, hipY); c.lineTo(leg.c - leg.h * 0.80, footY);
      c.lineTo(leg.c + leg.h * 0.80, footY); c.lineTo(leg.c + leg.h, hipY);
      c.closePath(); c.fill();
    });

    // 팔 — 몸 옆(z=0)에 달려 있다. 옆에서 보면 몸통에 가려진다.
    c.fillStyle = '#d9a97f';
    const shA = truth(0).a;
    [-1, 1].forEach(s2 => {
      const arm = cyl(s2 * (shA + 0.026), 0.020);
      c.fillRect(arm.c - arm.h, shY + bodyH * 0.02, arm.h * 2, bodyH * 0.36);
    });

    // 소매 — 맨살 팔이 머리보다 크면 얼굴 검출이 팔을 집는다
    c.fillStyle = '#4A6D9B';
    [-1, 1].forEach(s2 => {
      const arm = cyl(s2 * (shA + 0.026), 0.024);
      c.fillRect(arm.c - arm.h, shY + bodyH * 0.02, arm.h * 2, bodyH * 0.20);
    });

    // 몸통
    c.fillStyle = '#4A6D9B';
    c.beginPath();
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60, y = shY + t * (hipY - shY);
      const { a, b } = truth(t);
      pts.push([cx - projected(a, b, deg, m) * bodyH, y]);
    }
    pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
    for (let i = pts.length - 1; i >= 0; i--) c.lineTo(2 * cx - pts[i][0], pts[i][1]);
    c.closePath(); c.fill();

    // 머리 — 앞뒤가 좌우보다 1.28배 길다(두개지수). 목도 함께.
    const Hb = 0.090, Hl = Hb * 1.28;
    const headHalf = projected(Hb / 2, Hl / 2, deg, 2) * bodyH;
    const headTopY = H * TOP, headBotY = headTopY + Hb * 1.35 * bodyH;
    c.fillStyle = '#d9a97f';
    c.beginPath();
    c.ellipse(cx, (headTopY + headBotY) / 2, headHalf, (headBotY - headTopY) / 2, 0, 0, 7);
    c.fill();
    const neck = cyl(0, 0.026);
    c.fillRect(neck.c - neck.h, headBotY - 4, neck.h * 2, shY - headBotY + 8);
    return cv;
  }

  function run(angles, m, heightCm) {
    const views = [0].concat(angles).map(d => {
      const img = render(d, m);
      const body = BODY.analyzeFull(img, { gender: 'female' });
      return body.ok ? { body, img } : null;
    });
    if (!views[0]) return { fail: 'front analyze' };
    const sol = MULTIVIEW.solve(views, { heightCm });
    if (!sol.ok) return { fail: 'solve', issues: sol.issues };

    /* 정답과 비교 — **같은 물리적 높이**에서 잰다.
     * 레벨 인덱스끼리 비교하면 body.js 의 어깨·골반 검출 오차까지 섞여
     * multiview 가 실제로 얼마나 정확한지 알 수 없다. 샘플한 y 를 원본
     * 좌표로 되돌린 뒤 그 높이의 정답과 맞춰야 이 모듈만의 오차가 나온다. */
    const N = MULTIVIEW.LEVELS;
    const work = views[0].body.work;
    const sc = work.h / H;                       // 원본 → 분석 캔버스 배율
    const shTrue = H * SH, hipTrue = H * HIP;
    let errB = 0, mA = 0, nn = 0;
    for (let i = 0; i < N; i++) {
      const yw = sol.front.levelY(i / (N - 1));
      const ys = yw / sc;                        // 원본 좌표
      const tt = (ys - shTrue) / (hipTrue - shTrue);
      if (tt < -0.05 || tt > 1.05) continue;
      const gt = truth(Math.max(0, Math.min(1, tt)));
      errB += Math.pow(sol.depth[i] - gt.b, 2);
      mA += gt.a; nn++;
    }
    mA /= Math.max(1, nn);
    const rmsB = Math.sqrt(errB / Math.max(1, nn));
    // 정답 둘레 — 검출된 랜드마크가 가리키는 실제 높이에서
    const gtCirc = {};
    ['bust','waist','hip'].forEach(k => {
      const i = sol.circ.picks[k];
      const ys = sol.front.levelY(i / (N - 1)) / sc;
      const tt = Math.max(0, Math.min(1, (ys - shTrue) / (hipTrue - shTrue)));
      const gt = truth(tt);
      gtCirc[k] = MULTIVIEW.ellipsePerimeter(gt.a, gt.b) * (heightCm || 0);
    });
    const pf = sol.profiles;
    return {
      diag: {
        headFront: pf[0].head, headSide: pf[1] ? pf[1].head : null,
        headRatio: pf[1] && pf[0].head ? (pf[1].head / pf[0].head) : null,
        lm: { top: pf[0].lm.top, chin: pf[0].lm.chinY, sh: pf[0].lm.shoulder.y, hip: pf[0].lm.hip.y },
        halfLast3: Array.from(pf[0].half).slice(-3),
        gtLast3: [12,13,14].map(i => truth(i/14).a)
      },
      angles: sol.angles, trueAngles: angles, ratio: sol.depthRatio,
      depthRms: rmsB, depthRmsPctOfWidth: rmsB / mA * 100,
      spread: sol.spread, penalty: sol.penalty, conf: sol.confidence,
      cm: sol.circ.cm, gtCm: gtCirc,
      issues: sol.issues.map(i => i.ko.slice(0, 60))
    };
  }

  return {
    '옆모습 정확90':   run([90, -90], 2, 168),
    '옆모습 80도':     run([80, -80], 2, 168),      // 덜 돌아섬 — 각도 둔감성 확인
    '옆모습 70도':     run([70, -70], 2, 168),
    '좌우 비대칭':     run([90, -72], 2, 168),      // 한쪽만 덜 돌아섬 → 경고?
    '초타원 단면':     run([90, -90], 1.667, 168),  // 타원 가정이 틀린 경우
    '옆모습 1장':      run([90], 2, 168),
    '45도만(잘못)':    run([45, -45], 2, 168)       // 안내를 어겼을 때 감지되는가
  };
});

for (const [k, v] of Object.entries(out)) {
  if (v.fail) { console.log(k.padEnd(11), 'FAIL', v.fail, JSON.stringify(v.issues || '')); continue; }
  const cmErr = v.cm ? ['bust','waist','hip'].map(x =>
    (v.cm[x] - v.gtCm[x]).toFixed(1)).join('/') : '-';
  console.log(k.padEnd(14),
    '두께오차', v.depthRmsPctOfWidth.toFixed(1).padStart(5) + '%',
    '| b/a', v.ratio.toFixed(2),
    '| 좌우편차', (v.spread == null ? '  -  ' : (v.spread*100).toFixed(1).padStart(4) + '%'),
    '| 신뢰도', v.conf.toFixed(2),
    '| 둘레오차cm(가슴/허리/골반)', cmErr);
  if (k === '옆모습 정확90' || k === '45도만(잘못)')
    console.log(''.padEnd(14), '  머리폭 정면', (v.diag.headFront||0).toFixed(4),
                '옆', (v.diag.headSide||0).toFixed(4),
                '비', v.diag.headRatio ? v.diag.headRatio.toFixed(3) : '-');
  if (v.issues.length) console.log(''.padEnd(14), '  ⚠', v.issues.map(x=>x.slice(0,50)).join(' / '));
}
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
