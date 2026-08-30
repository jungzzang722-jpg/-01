/* 조명색 오차가 12타입 판정에 얼마나 옮겨붙는지 실측한다.
 *
 * 실제 파이프라인을 그대로 모사한다:
 *   D65 아래의 진짜 얼굴 → 색온도 T 조명으로 촬영 → 화이트밸런스 추정·적용
 *   → 진단.
 * 화이트밸런스 수단(공막 / 전역추정)에 따라 남는 잔차가 다르고, 그 잔차가
 * 판정까지 얼마나 흘러가는지가 이 테스트의 대상이다.
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('file://' + path.resolve(root, '퍼스널컬러진단.html'));
await page.waitForFunction(() => window.DIAGNOSE && window.CC);
const LINEAR = process.argv.includes('--linear');
await page.evaluate(v => { window.__LINEAR_WB = v; }, LINEAR);
console.log('화이트밸런스 적용 공간: ' + (LINEAR ? '선형 RGB' : '감마 sRGB (현행)'));

const out = await page.evaluate(() => {
  const CC = window.CC, D = window.DIAGNOSE;

  /* ---- 물리: 조명 색온도 변화는 선형 RGB 의 대각 게인이다 ---- */
  function cctToXy(T) {
    let x;
    if (T < 4000) x = -0.2661239e9/(T**3) - 0.2343589e6/(T*T) + 0.8776956e3/T + 0.179910;
    else          x = -3.0258469e9/(T**3) + 2.1070379e6/(T*T) + 0.2226347e3/T + 0.240390;
    let y;
    if (T < 2222)      y = -1.1063814*x**3 - 1.34811020*x*x + 2.18555832*x - 0.20219683;
    else if (T < 4000) y = -0.9549476*x**3 - 1.37418593*x*x + 2.09137015*x - 0.16748867;
    else               y =  3.0817580*x**3 - 5.87338670*x*x + 3.75112997*x - 0.37001483;
    return [x, y];
  }
  const M  = [[0.8951,0.2664,-0.1614],[-0.7502,1.7135,0.0367],[0.0389,-0.0685,1.0296]];
  const Mi = [[0.9869929,-0.1470543,0.1599627],[0.4323053,0.5183603,0.0492912],[-0.0085287,0.0400428,0.9684867]];
  const mul = (m, v) => m.map(r => r[0]*v[0] + r[1]*v[1] + r[2]*v[2]);
  const xyToXyz = (x, y) => [x/y, 1, (1-x-y)/y];

  /** D65 아래 lab 인 물체를 색온도 T 조명 아래에서 찍은 sRGB */
  function shoot(lab, T) {
    const c = CC.labToRgb(lab.L, lab.a, lab.b);
    const l = [CC.srgbToLinear(c.r), CC.srgbToLinear(c.g), CC.srgbToLinear(c.b)];
    const X = l[0]*0.4124564 + l[1]*0.3575761 + l[2]*0.1804375;
    const Y = l[0]*0.2126729 + l[1]*0.7151522 + l[2]*0.0721750;
    const Z = l[0]*0.0193339 + l[1]*0.1191920 + l[2]*0.9503041;
    const ws = mul(M, xyToXyz(...cctToXy(6500))), wd = mul(M, xyToXyz(...cctToXy(T)));
    const co = mul(M, [X, Y, Z]);
    const xyz = mul(Mi, [co[0]*wd[0]/ws[0], co[1]*wd[1]/ws[1], co[2]*wd[2]/ws[2]]);
    return CC.xyzToRgb(xyz[0]*100, xyz[1]*100, xyz[2]*100);
  }

  const SUBJECTS = [
    { ko: '밝은 피부', skin:{L:72,a:12.5,b:18},   hair:{L:26,a:5,b:9}, iris:{L:32,a:4,b:7}, sclera:{L:80,a:0.3,b:2.2}, lip:{L:58,a:22,b:11} },
    { ko: '중간 피부', skin:{L:63,a:14,b:20.5},   hair:{L:22,a:5,b:8}, iris:{L:28,a:4,b:6}, sclera:{L:76,a:0.3,b:2.6}, lip:{L:50,a:24,b:13} },
    { ko: '짙은 피부', skin:{L:48,a:15,b:22},     hair:{L:18,a:4,b:7}, iris:{L:24,a:3,b:6}, sclera:{L:72,a:0.3,b:2.8}, lip:{L:40,a:20,b:12} }
  ];
  const CASES = [['정답', 6500], ['-200K', 6300], ['+200K', 6700], ['-500K', 6000], ['+500K', 7000],
                 ['-1000K', 5500], ['+1000K', 7500], ['-2000K', 4500], ['+2000K', 8500]];
  const KEYS = ['skin','hair','iris','sclera','lip'];
  const LINEAR_WB = !!window.__LINEAR_WB;
  /** 게인을 선형 RGB 에서 곱한다 — 조명 변화와 같은 공간이라 대각 구조가 보존된다 */
  function applyLin(rgb, g) {
    const l = [CC.srgbToLinear(rgb.r), CC.srgbToLinear(rgb.g), CC.srgbToLinear(rgb.b)];
    return { r: CC.linearToSrgb(l[0]*g.r), g: CC.linearToSrgb(l[1]*g.g), b: CC.linearToSrgb(l[2]*g.b) };
  }

  /* 화이트밸런스 수단 두 가지.
   *  sclera        — 공막을 찾은 경우. 앱의 실제 경로 그대로.
   *  shades_of_gray— 기준점을 못 찾은 경우. 얼굴 화면에서 p-norm 평균이
   *                  중성이라고 가정하는 수단이라, 조명색을 부분적으로만
   *                  걷어낸다. 여기서는 절반쯤 걷어내는 것으로 모사한다. */
  function pipeline(subj, T, method, useNeutral) {
    const shot = {};
    for (const k of KEYS) shot[k] = shoot(subj[k], T);
    let gains;
    if (method === 'sclera') gains = CC.gainsFromNeutral(shot.sclera, true);
    else {
      const g = CC.gainsFromNeutral(shot.sclera, true);
      gains = { r: Math.pow(g.r, 0.5), g: Math.pow(g.g, 0.5), b: Math.pow(g.b, 0.5) };
    }
    const f = { quality: { skinVarL: 3.4 } };
    const cor = {};
    for (const k of KEYS) {
      const c = LINEAR_WB ? applyLin(shot[k], gains) : CC.applyGains(shot[k], gains);
      cor[k] = CC.rgbToLab(c.r, c.g, c.b);
      f[k] = cor[k];
    }
    f.neutral = useNeutral ? { lab: cor.sclera, chroma: CC.SCLERA_CHROMA, src: 'sclera' } : null;
    f.wb = { method: method, cast: 0.06, clip: { imbalance: 0.01 } };
    const dx = D.diagnose(f, {});
    dx.pool = D.candidatePool(f, {});
    return dx;
  }

  const rows = [];
  for (const s of SUBJECTS) {
    for (const method of ['sclera', 'shades_of_gray']) {
      /* 기준은 "촬영을 거치지 않은 진짜 얼굴"에 대해 **그 방식 자신이** 내는 답.
       * 두 방식은 서로 다른 측정 함수라 정답도 미세하게 다르다. 공정한 질문은
       * "어느 쪽이 절대 진리에 가까운가"가 아니라 "같은 사람인데 조명만 바뀌었을 때
       * 자기 답을 지키는가" — 사용자가 겪는 불일치가 정확히 그것이다. */
      const truth = u => {
        const f = { quality: { skinVarL: 3.4 } };
        for (const k of KEYS) f[k] = s[k];
        f.neutral = u ? { lab: s.sclera, chroma: CC.SCLERA_CHROMA, src: 'sclera' } : null;
        f.wb = { method: method, cast: 0.06, clip: { imbalance: 0.01 } };
        const dx = D.diagnose(f, {});
        dx.pool = D.candidatePool(f, {});
        return dx;
      };
      const refOffDx = truth(false), refOnDx = truth(true);
      const refOff = refOffDx.type, refOn = refOnDx.type;
      // 풀은 '이 사진이 배제하지 못한 타입들'이라, 정답 풀과 겹치기만 하면
      // 사용자가 보는 답이 모순되지 않는다. 그게 라벨 일치보다 중요한 기준이다.
      const keys = x => new Set(x.pool.pool.map(v => v.type.key));
      const kOff = keys(refOffDx), kOn = keys(refOnDx);
      const covers = (a, b) => [...b].some(k => a.has(k));
      for (const [ko, T] of CASES) {
        const off = pipeline(s, T, method, false);
        const on  = pipeline(s, T, method, true);
        rows.push({ subj: s.ko, method, ko,
          offT: off.type.ko, offS: off.type.season, offW: off.axes.warm,
          onT: on.type.ko,  onS: on.type.season,  onW: on.axes.warm,
          refOffS: refOff.season, refOnS: refOn.season,
          refOffT: refOff.ko, refOnT: refOn.ko,
          offPool: off.pool.pool.map(v => v.type.ko).join('/'),
          onPool: on.pool.pool.map(v => v.type.ko).join('/'),
          offOk: covers(kOff, keys(off)), onOk: covers(kOn, keys(on)) });
      }
    }
  }
  return rows;
});

const groups = [...new Set(out.map(r => r.subj + '|' + r.method))];
let offFlip = 0, onFlip = 0, n = 0;
for (const g of groups) {
  const [subj, method] = g.split('|');
  const rs = out.filter(r => r.subj + '|' + r.method === g);
  console.log('\n' + subj + ' · WB=' + method +
    '   자기 정답: 끔=' + rs[0].refOffT + ' / 켬=' + rs[0].refOnT);
  console.log('  조건        상대화 끔                 상대화 켬');
  for (const r of rs) {
    const a = r.offS !== r.refOffS, b = r.onS !== r.refOnS;
    if (r.ko !== '정답') { n++; if (a) offFlip++; if (b) onFlip++; }
    console.log('  ' + r.ko.padEnd(8),
      (r.offT + ' (w' + r.offW.toFixed(2) + ')' + (a ? ' ⚠' : '  ')).padEnd(26),
      r.onT + ' (w' + r.onW.toFixed(2) + ')' + (b ? ' ⚠' : ''));
  }
}
console.log('\n라벨 하나만 볼 때 계절이 뒤집힌 횟수');
console.log('  상대화 끔 ' + offFlip + '/' + n + '   상대화 켬 ' + onFlip + '/' + n);
const real = out.filter(r => r.ko !== '정답');
const poolBad = k => real.filter(r => !r[k]).length;
console.log('\n후보 풀로 볼 때 정답 풀과 겹치지 않은 횟수 (= 사용자가 모순된 답을 본 횟수)');
console.log('  상대화 끔 ' + poolBad('offOk') + '/' + real.length +
            '   상대화 켬 ' + poolBad('onOk') + '/' + real.length);
const sz = k => (real.reduce((s, r) => s + r[k].split('/').length, 0) / real.length).toFixed(2);
console.log('  평균 후보 수 —  끔 ' + sz('offPool') + '   켬 ' + sz('onPool'));
await browser.close();
