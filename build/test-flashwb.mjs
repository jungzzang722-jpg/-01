/* 플래시 2연사 화이트밸런스가 물리적으로 성립하는지 합성 장면으로 검증한다.
 *
 * 장면을 직접 만든다: 반사율이 제각각인 면들 + 알려진 주변광 + 알려진 화면광.
 * 정답(주변광 색)을 알고 있으므로 추정치와 직접 비교할 수 있다.
 * 회색 세상 가정을 깨는 장면(온통 붉은 벽 등)에서 특히 중요하다 —
 * 기존 전역 추정이 무너지는 바로 그 조건이다.
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('file:///home/user/-01/퍼스널컬러진단.html');
await page.waitForFunction(() => window.FLASHWB && window.CC);

const out = await page.evaluate(() => {
  const CC = window.CC, F = window.FLASHWB;
  // 테스트가 실행마다 다른 답을 내면 회귀를 못 잡는다. 난수를 고정한다.
  let _seed = 12345;
  const rnd = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };

  function cctToXy(T){let x;if(T<4000)x=-0.2661239e9/(T**3)-0.2343589e6/(T*T)+0.8776956e3/T+0.179910;else x=-3.0258469e9/(T**3)+2.1070379e6/(T*T)+0.2226347e3/T+0.240390;let y;if(T<2222)y=-1.1063814*x**3-1.34811020*x*x+2.18555832*x-0.20219683;else if(T<4000)y=-0.9549476*x**3-1.37418593*x*x+2.09137015*x-0.16748867;else y=3.0817580*x**3-5.87338670*x*x+3.75112997*x-0.37001483;return[x,y];}
  /** 색온도 T 조명의 선형 RGB 세기 (평균 1 로 정규화) */
  function illum(T) {
    const [x, y] = cctToXy(T);
    const X = x / y, Y = 1, Z = (1 - x - y) / y;
    const r = X*3.2404542 + Y*-1.5371385 + Z*-0.4985314;
    const g = X*-0.9692660 + Y*1.8760108 + Z*0.0415560;
    const b = X*0.0556434 + Y*-0.2040259 + Z*1.0572252;
    const m = (r + g + b) / 3;
    return [r/m, g/m, b/m];
  }

  /** 반사율 패치들을 두 조명으로 렌더해 캔버스 두 장을 만든다 */
  function scene(patches, amb, scr, flashScale, jitterPct) {
    const W = 240, H = 240, N = Math.ceil(Math.sqrt(patches.length));
    const mk = withFlash => {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      patches.forEach((p, i) => {
        // 거리에 따라 플래시 도달량이 다르다 — 실제와 같게 만든다
        const reach = p.reach == null ? 1 : p.reach;
        const j = jitterPct ? (1 + (rnd() - 0.5) * jitterPct) : 1;
        const rgb = [0, 1, 2].map(k => {
          const v = p.rho[k] * amb[k] + (withFlash ? p.rho[k] * scr[k] * flashScale * reach : 0);
          return CC.linearToSrgb(v * j);
        });
        c.fillStyle = 'rgb(' + rgb.join(',') + ')';
        c.fillRect((i % N) * W / N, Math.floor(i / N) * H / N, W / N + 1, H / N + 1);
      });
      return cv;
    };
    return [mk(false), mk(true)];
  }

  // 반사율 — 일부러 회색 세상 가정을 깬다
  const SCENES = {
    '보통 실내': [
      { rho: [.62,.48,.40] }, { rho: [.78,.70,.62] }, { rho: [.30,.32,.36] },
      { rho: [.55,.42,.34] }, { rho: [.20,.22,.25] }, { rho: [.85,.84,.82] },
      { rho: [.45,.50,.44] }, { rho: [.66,.55,.47] }, { rho: [.38,.30,.26] },
      { rho: [.72,.62,.55] }, { rho: [.28,.36,.44] }, { rho: [.50,.46,.42] },
      { rho: [.15,.14,.16], reach: 0.15 }, { rho: [.40,.38,.35], reach: 0.10 },
      { rho: [.60,.58,.55], reach: 0.12 }, { rho: [.25,.24,.22], reach: 0.08 }
    ],
    '온통 붉은 벽': [
      { rho: [.70,.24,.20] }, { rho: [.66,.22,.18] }, { rho: [.74,.28,.22] },
      { rho: [.62,.20,.16] }, { rho: [.68,.26,.21] }, { rho: [.72,.25,.19] },
      { rho: [.60,.45,.38] }, { rho: [.64,.23,.19] }, { rho: [.70,.27,.23] },
      { rho: [.58,.42,.35] }, { rho: [.66,.24,.20] }, { rho: [.71,.26,.21] },
      { rho: [.69,.25,.20], reach: 0.12 }, { rho: [.67,.23,.19], reach: 0.10 },
      { rho: [.65,.24,.20], reach: 0.09 }, { rho: [.73,.27,.22], reach: 0.11 }
    ],
    '어두운 옷 · 어두운 배경': [
      { rho: [.12,.11,.13] }, { rho: [.15,.14,.16] }, { rho: [.10,.10,.11] },
      { rho: [.58,.44,.36] }, { rho: [.62,.48,.40] }, { rho: [.18,.17,.19] },
      { rho: [.13,.12,.14] }, { rho: [.55,.42,.34] }, { rho: [.16,.15,.17] },
      { rho: [.11,.11,.12] }, { rho: [.60,.46,.38] }, { rho: [.14,.13,.15] },
      { rho: [.09,.09,.10], reach: 0.10 }, { rho: [.12,.11,.13], reach: 0.08 },
      { rho: [.10,.10,.11], reach: 0.12 }, { rho: [.13,.12,.14], reach: 0.09 }
    ]
  };

  const D65 = illum(6500);
  const scr = illum(6500);   // 화면은 sRGB(D65) 목표라고 본다
  const rows = [];
  for (const [sceneKo, patches] of Object.entries(SCENES)) {
    for (const [ambKo, T] of [['백열등 2700K',2700],['웜 LED 3500K',3500],['형광등 4200K',4200],['주광 6500K',6500],['그늘 8000K',8000]]) {
      const amb = illum(T);
      for (const [strKo, fs] of [['플래시 강함',1.4],['플래시 보통',0.7],['플래시 약함',0.25]]) {
        const [A, Fc] = scene(patches, amb, scr, fs, 0);
        const r = F.gainsFromPair(A, Fc, { locked: true });
        // 정답: 주변광을 걷어내는 게인 = D65/amb (평균 1 정규화)
        const want = [0,1,2].map(k => D65[k] / amb[k]);
        const wm = (want[0]+want[1]+want[2])/3;
        const truth = want.map(v => v/wm);
        let err = null;
        if (r.ok) {
          const got = [r.gains.r, r.gains.g, r.gains.b];
          // 게인 오차를 중성색 ΔE 로 환산 — 해석 가능한 단위로
          const mid = 0.35;
          const t = CC.rgbToLab(...truth.map(v => CC.linearToSrgb(mid*v)));
          const gq = CC.rgbToLab(...got.map(v => CC.linearToSrgb(mid*v)));
          err = CC.deltaE2000(t, gq);
        }
        // 비교군: 기존 전역 추정(shades-of-gray)을 같은 장면에 돌린다
        const ictx = A.getContext('2d');
        const sog = CC.shadesOfGrayGains(ictx.getImageData(0,0,A.width,A.height).data, 6);
        const sm = (sog.r+sog.g+sog.b)/3;
        const sgv = [sog.r/sm, sog.g/sm, sog.b/sm];
        const midv = 0.35;
        const sgE = CC.deltaE2000(
          CC.rgbToLab(...truth.map(v => CC.linearToSrgb(midv*v))),
          CC.rgbToLab(...sgv.map(v => CC.linearToSrgb(midv*v))));
        rows.push({ sceneKo, ambKo, strKo, ok: r.ok, ko: r.ko, err, sgE,
          tiles: r.tiles, spread: r.spread, flashRatio: r.flashRatio });
      }
    }
  }

  /* ---- 실패 모드: 움직임과 자동 노출 변화 ----
   * 둘 다 뺄셈의 전제를 깬다. 틀린 답을 자신 있게 내놓느니 거부해야 한다. */
  const fails = [];
  const amb = illum(3000), patches = SCENES['보통 실내'];

  // (1) 움직임 — 두 번째 장에서 패치들이 서로 다르게 밝아진다(장면이 어긋남)
  for (const [ko, j] of [['미동 3%',0.03],['흔들림 12%',0.12],['크게 움직임 35%',0.35]]) {
    const [A, Fc] = scene(patches, amb, scr, 0.7, j);
    const r = F.gainsFromPair(A, Fc, { locked: true });
    fails.push({ mode: ko, ok: r.ok, spread: r.spread, ko2: r.ko, err: r.ok ? errOf(r, amb) : null });
  }
  // (2) 자동 노출/AWB 변화 — 플래시 장에 전역 게인이 곱해진다.
  //     고정을 못 하는 기기는 애초에 거부되므로, 여기서는 "고정했다고 하는데
  //     실제로는 카메라가 적응 중이던" 경우를 본다. 플래시 두 번째 장으로 잡아야 한다.
  const gain = (cv, g) => {
    const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height;
    const c = o.getContext('2d'); c.drawImage(cv, 0, 0);
    const im = c.getImageData(0,0,o.width,o.height), d = im.data;
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++)
      d[i+k] = CC.linearToSrgb(CC.srgbToLinear(d[i+k]) * g[k]);
    c.putImageData(im, 0, 0); return o;
  };
  for (const [ko, g1, g2] of [
    ['적응 중 · 노출 -10%',  [0.90,0.90,0.90], [0.97,0.97,0.97]],
    ['적응 중 · AWB 5%',    [1.05,1.00,0.95], [1.01,1.00,0.99]],
    ['적응 중 · AWB 15%',   [1.15,1.00,0.87], [1.04,1.00,0.97]],
    ['적응 끝 · AWB 15%',   [1.15,1.00,0.87], [1.15,1.00,0.87]]
  ]) {
    const [A, F0] = scene(patches, amb, scr, 0.7, 0);
    const r = F.gainsFromPair(A, gain(F0, g1), { locked: true, flashed2: gain(F0, g2) });
    fails.push({ mode: ko, ok: r.ok, spread: r.spread, ko2: r.ko, err: r.ok ? errOf(r, amb) : null });
  }
  // (3) 정상 — 고정이 걸렸고 두 플래시 장이 같다. 거부되면 안 된다.
  {
    const [A, F0] = scene(patches, amb, scr, 0.7, 0);
    const r = F.gainsFromPair(A, F0, { locked: true, flashed2: F0 });
    fails.push({ mode: '정상 (고정 O)', ok: r.ok, spread: r.spread, ko2: r.ko, err: r.ok ? errOf(r, amb) : null });
  }
  // (4) 고정 실패 기기
  {
    const [A, F0] = scene(patches, amb, scr, 0.7, 0);
    const r = F.gainsFromPair(A, F0, { locked: false });
    fails.push({ mode: '고정 불가 기기', ok: r.ok, spread: r.spread, ko2: r.ko, err: r.ok ? errOf(r, amb) : null });
  }
  function errOf(r, ambI) {
    const want = [0,1,2].map(k => D65[k] / ambI[k]);
    const wm = (want[0]+want[1]+want[2])/3;
    const truth = want.map(v => v/wm);
    const got = [r.gains.r, r.gains.g, r.gains.b], mid = 0.35;
    return CC.deltaE2000(
      CC.rgbToLab(...truth.map(v => CC.linearToSrgb(mid*v))),
      CC.rgbToLab(...got.map(v => CC.linearToSrgb(mid*v))));
  }

  return { rows, fails };
});

const w = (s, n) => String(s).padEnd(n);
let curScene = '';
for (const r of out.rows) {
  if (r.sceneKo !== curScene) {
    curScene = r.sceneKo;
    console.log('\n■ ' + curScene);
    console.log('  주변광          플래시      타일  기여   플래시WB ΔE   전역추정 ΔE');
  }
  console.log('  ' + w(r.ambKo, 15) + w(r.strKo, 11) +
    (r.ok ? String(r.tiles).padStart(4) + (r.flashRatio*100).toFixed(0).padStart(6) + '%'
          : '   —      —') +
    (r.ok ? r.err.toFixed(2).padStart(12) : '     거부'.padStart(13)) +
    r.sgE.toFixed(2).padStart(14) +
    (r.ok ? '' : '   ← ' + r.ko.slice(0, 30)));
}
const ok = out.rows.filter(r => r.ok);
console.log('\n채택 ' + ok.length + '/' + out.rows.length +
  '   플래시WB 평균 ΔE ' + (ok.reduce((s,r)=>s+r.err,0)/ok.length).toFixed(2) +
  '   같은 조건 전역추정 평균 ΔE ' + (ok.reduce((s,r)=>s+r.sgE,0)/ok.length).toFixed(2));
console.log('\n■ 실패 모드 — 틀린 답을 내놓는가, 거부하는가');
for (const f of out.fails) console.log('  ' + w(f.mode, 16) +
  (f.ok ? '채택  ΔE ' + f.err.toFixed(2) + '  흩어짐 ' + (f.spread||0).toFixed(3)
        : '거부  ' + f.ko2.slice(0, 46)));
console.log('page errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
