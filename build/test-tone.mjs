/* 조명색 오차가 12타입 판정에 얼마나 옮겨붙는지 실측한다.
 * 절대 Lab 을 쓰는 축(웜/라이트)과 상대 대비를 쓰는 축(브라이트)의
 * 민감도 차이를 수치로 보기 위한 것. */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('file://' + path.resolve(root, '퍼스널컬러진단.html'));
await page.waitForFunction(() => window.DIAGNOSE && window.CC);

const out = await page.evaluate(() => {
  const CC = window.CC, D = window.DIAGNOSE;

  // CCT → xy (Kang 2002), xy → XYZ(Y=1)
  function cctToXy(T) {
    let x;
    if (T < 4000) x = -0.2661239e9/(T*T*T) - 0.2343589e6/(T*T) + 0.8776956e3/T + 0.179910;
    else          x = -3.0258469e9/(T*T*T) + 2.1070379e6/(T*T) + 0.2226347e3/T + 0.240390;
    let y;
    if (T < 2222)      y = -1.1063814*x*x*x - 1.34811020*x*x + 2.18555832*x - 0.20219683;
    else if (T < 4000) y = -0.9549476*x*x*x - 1.37418593*x*x + 2.09137015*x - 0.16748867;
    else               y =  3.0817580*x*x*x - 5.87338670*x*x + 3.75112997*x - 0.37001483;
    return [x, y];
  }
  function xyToXyz(x, y) { return [x/y, 1, (1-x-y)/y]; }

  const M  = [[0.8951,0.2664,-0.1614],[-0.7502,1.7135,0.0367],[0.0389,-0.0685,1.0296]];
  const Mi = [[0.9869929,-0.1470543,0.1599627],[0.4323053,0.5183603,0.0492912],[-0.0085287,0.0400428,0.9684867]];
  const mul = (m, v) => m.map(r => r[0]*v[0] + r[1]*v[1] + r[2]*v[2]);

  // 원본이 srcT 조명인데 카메라/보정이 dstT 로 착각했을 때의 Lab 이동
  function adapt(lab, srcT, dstT) {
    const c = CC.labToRgb(lab.L, lab.a, lab.b);
    const lin = [CC.srgbToLinear(c.r), CC.srgbToLinear(c.g), CC.srgbToLinear(c.b)];
    const X = lin[0]*0.4124564 + lin[1]*0.3575761 + lin[2]*0.1804375;
    const Y = lin[0]*0.2126729 + lin[1]*0.7151522 + lin[2]*0.0721750;
    const Z = lin[0]*0.0193339 + lin[1]*0.1191920 + lin[2]*0.9503041;
    const ws = mul(M, xyToXyz(...cctToXy(srcT)));
    const wd = mul(M, xyToXyz(...cctToXy(dstT)));
    const cone = mul(M, [X, Y, Z]);
    const adj = [cone[0]*wd[0]/ws[0], cone[1]*wd[1]/ws[1], cone[2]*wd[2]/ws[2]];
    const xyz = mul(Mi, adj);
    const rgb = CC.xyzToRgb(xyz[0]*100, xyz[1]*100, xyz[2]*100);
    return CC.rgbToLab(rgb.r, rgb.g, rgb.b);
  }

  // 대표 피부 3종 (밝은/중간/짙은) + 그에 맞춘 모발·홍채·공막
  const SUBJECTS = [
    { ko: '밝은 피부', skin: {L:72,a:12.5,b:18.0}, hair:{L:26,a:5,b:9}, iris:{L:32,a:4,b:7}, sclera:{L:80,a:0,b:2}, lip:{L:58,a:22,b:11} },
    { ko: '중간 피부', skin: {L:63,a:14.0,b:20.5}, hair:{L:22,a:5,b:8}, iris:{L:28,a:4,b:6}, sclera:{L:76,a:0,b:3}, lip:{L:50,a:24,b:13} },
    { ko: '짙은 피부', skin: {L:48,a:15.0,b:22.0}, hair:{L:18,a:4,b:7}, iris:{L:24,a:3,b:6}, sclera:{L:72,a:0,b:3}, lip:{L:40,a:20,b:12} }
  ];
  // 실제로 겪는 잔여 오차 범위
  const CASES = [
    ['정답(D65)',        6500],
    ['-200K',            6300],
    ['+200K',            6700],
    ['-500K',            6000],
    ['+500K',            7000],
    ['-1000K',           5500],
    ['+1000K',           7500],
    ['실내 백열 잔여 -2000K', 4500],
    ['그늘/창가 +2000K',  8500]
  ];

  const rows = [];
  for (const s of SUBJECTS) {
    const feat0 = { skin:s.skin, hair:s.hair, iris:s.iris, sclera:s.sclera, lip:s.lip, quality:{skinVarL:3.4} };
    const base = D.diagnose(feat0, {});
    for (const [ko, T] of CASES) {
      const f = { quality:{skinVarL:3.4} };
      for (const k of ['skin','hair','iris','sclera','lip']) f[k] = adapt(s[k], 6500, T);
      const r = D.diagnose(f, {});
      rows.push({
        subj: s.ko, ko, T,
        dE: CC.deltaE2000(s.skin, f.skin),
        dh: CC.labToLch(f.skin.L,f.skin.a,f.skin.b).h - CC.labToLch(s.skin.L,s.skin.a,s.skin.b).h,
        db: f.skin.b - s.skin.b,
        warm: r.axes.warm, light: r.axes.light, bright: r.axes.bright,
        base: base.type.ko, got: r.type.ko,
        season: r.type.season, baseSeason: base.type.season,
        conf: r.confidence
      });
    }
  }
  // 마진도 같이
  const margins = SUBJECTS.map(s => {
    const f = { skin:s.skin, hair:s.hair, iris:s.iris, sclera:s.sclera, lip:s.lip, quality:{skinVarL:3.4} };
    const m = D.decisionMargin ? D.decisionMargin(f, {}) : null;
    return { subj: s.ko, m: m ? { level: m.level, dE: m.season ? +m.season.dE.toFixed(2) : null } : null };
  });
  return { rows, margins, keys: Object.keys(D) };
});

console.log('DIAGNOSE keys:', out.keys.join(', '));
console.log('\n주체        조건                 ΔE00   Δh°    Δb*   warm   light  bright  판정              계절');
for (const r of out.rows) {
  const flip = r.got !== r.base ? (r.season !== r.baseSeason ? '  ⚠계절바뀜' : '  △타입바뀜') : '';
  console.log(
    r.subj.padEnd(10),
    r.ko.padEnd(20),
    r.dE.toFixed(1).padStart(5),
    r.dh.toFixed(1).padStart(6),
    r.db.toFixed(1).padStart(6),
    r.warm.toFixed(2).padStart(6),
    r.light.toFixed(2).padStart(6),
    r.bright.toFixed(2).padStart(6),
    ' ' + r.got.padEnd(16), r.season.padEnd(6), flip);
}
console.log('\n마진:', JSON.stringify(out.margins));
await browser.close();
