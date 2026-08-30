/* 진단 경로 전체가 후보 풀과 함께 돌아가는지 — 그리고 풀 때문에
 * 추천 색이 실제로 나아지는지 확인한다.
 * (풀이 하나뿐인 사람에게는 아무 변화가 없어야 한다.) */
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('file:///home/user/-01/퍼스널컬러진단.html');
await page.waitForFunction(() => window.DIAGNOSE && window.RECOMMEND);

const out = await page.evaluate(() => {
  const D = window.DIAGNOSE, R = window.RECOMMEND, CC = window.CC;
  const mk = (L, a, bb, src) => ({
    skin: { L, a, b: bb },
    hair: { L: Math.max(14, L - 40), a: a * 0.35, b: bb * 0.42 },
    iris: { L: Math.max(20, L - 34), a: a * 0.28, b: bb * 0.32 },
    sclera: { L: Math.min(88, L + 10), a: 0.2, b: 2.4 },
    lip: { L: L - 12, a: a + 8, b: bb * 0.6 },
    neutral: src ? { lab: { L: Math.min(88, L + 10), a: 0.2, b: 2.4 }, chroma: CC.SCLERA_CHROMA, src: src } : null,
    wb: { method: src || 'shades_of_gray', cast: 0.06, clip: { imbalance: 0.01 } },
    quality: { skinVarL: 3.4 }
  });

  let n = 0, pooled = 0, heroBetter = 0, heroWorse = 0, dHero = 0, avoidLost = 0, empty = 0;
  const shots = [];
  for (let L = 54; L <= 72; L += 3)
  for (let a = 10; a <= 18; a += 2)
  for (let bb = 13; bb <= 25; bb += 3) {
    const f = mk(L, a, bb, 'sclera');
    const dx = D.diagnose(f, {});
    dx.pool = D.candidatePool(f, {});
    const withPool = R.colorStrategy(dx);
    const solo = R.colorStrategy(Object.assign({}, dx, { pool: null }));
    n++;
    if (!withPool.hero.length || !withPool.base.length) empty++;
    if (!withPool.avoid.length) avoidLost++;
    if (dx.pool.pool.length > 1) {
      pooled++;
      const a1 = withPool.hero.reduce((s, c) => s + c.score, 0) / withPool.hero.length;
      const a0 = solo.hero.reduce((s, c) => s + c.score, 0) / solo.hero.length;
      dHero += a1 - a0;
      if (a1 > a0 + 1e-9) heroBetter++; else if (a1 < a0 - 1e-9) heroWorse++;
      if (shots.length < 3) shots.push({
        type: dx.type.ko, pool: dx.pool.pool.map(x => x.type.ko),
        soloHero: solo.hero.map(c => c.ko), poolHero: withPool.hero.map(c => c.ko),
        d: (a1 - a0).toFixed(4)
      });
    } else {
      // 확정된 사람은 결과가 완전히 같아야 한다
      if (withPool.hero.map(c => c.hex).join() !== solo.hero.map(c => c.hex).join()) heroWorse += 1000;
    }
  }
  return { n, pooled, heroBetter, heroWorse, dHero: dHero / Math.max(1, pooled), avoidLost, empty, shots };
});

console.log('표본', out.n, ' 후보가 둘 이상', out.pooled);
console.log('추천 색이 빈 경우', out.empty, ' 피할 색이 빈 경우', out.avoidLost);
console.log('히어로 컬러 평균 점수 변화', out.dHero.toFixed(4),
  ' (좋아짐 ' + out.heroBetter + ' / 나빠짐 ' + out.heroWorse + ')');
for (const s of out.shots) {
  console.log('\n' + s.type, '→ 후보', s.pool.join(' / '), ' Δ' + s.d);
  console.log('  라벨만:', s.soloHero.join(', '));
  console.log('  풀 적용:', s.poolHero.join(', '));
}
console.log('\npage errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
