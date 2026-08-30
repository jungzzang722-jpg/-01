/* 후보 풀이 실제로 얼마나 좁혀지는지, 그리고 조명이 바뀌어도
 * 풀 자체는 유지되는지 본다. 라벨 하나는 흔들려도 풀이 안 흔들리면
 * 사용자가 보는 답은 일정하다. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto('file:///home/user/-01/퍼스널컬러진단.html');
await p.waitForFunction(() => window.DIAGNOSE);

const out = await p.evaluate(() => {
  const D = window.DIAGNOSE, CC = window.CC;
  const mk = (L, a, bb, wbm) => ({
    skin: { L, a, b: bb },
    hair: { L: Math.max(14, L - 40), a: a * 0.35, b: bb * 0.42 },
    iris: { L: Math.max(20, L - 34), a: a * 0.28, b: bb * 0.32 },
    sclera: { L: Math.min(88, L + 10), a: 0.2, b: 2.4 },
    lip: { L: L - 12, a: a + 8, b: bb * 0.6 },
    neutral: wbm === 'none' ? null
      : { lab: { L: Math.min(88, L + 10), a: 0.2, b: 2.4 }, chroma: CC.SCLERA_CHROMA,
          src: wbm === 'flash' ? 'sclera' : wbm },
    wb: { method: wbm === 'none' ? 'shades_of_gray' : wbm, cast: 0.06, clip: { imbalance: 0.01 } },
    quality: { skinVarL: 3.4 }
  });
  const res = {};
  for (const wbm of ['flash', 'sclera', 'gray_surface', 'none']) {
    const sizes = [], settled = [], seasonSettled = [], sigmas = [];
    for (let L = 54; L <= 72; L += 3)
    for (let a = 10; a <= 18; a += 2)
    for (let bb = 13; bb <= 25; bb += 3) {
      const cp = D.candidatePool(mk(L, a, bb, wbm), {});
      sizes.push(cp.pool.length); settled.push(cp.settled);
      seasonSettled.push(cp.seasonSettled); sigmas.push(cp.sigma);
    }
    const avg = v => v.reduce((s, x) => s + (x === true ? 1 : x === false ? 0 : x), 0) / v.length;
    res[wbm] = { n: sizes.length, size: avg(sizes), settled: avg(settled) * 100,
      seasonSettled: avg(seasonSettled) * 100, sigma: avg(sigmas) };
  }
  return res;
});
console.log('기준점         σ(ΔE)  평균 후보 수   타입 확정   계절 확정');
for (const [k, v] of Object.entries(out))
  console.log(k.padEnd(14), v.sigma.toFixed(2).padStart(5), v.size.toFixed(2).padStart(12),
    (v.settled.toFixed(1) + '%').padStart(11), (v.seasonSettled.toFixed(1) + '%').padStart(11));
await b.close();
