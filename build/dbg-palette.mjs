/* 타입 라벨이 바뀌면 추천 색까지 그만큼 바뀌는가.
 * 경계에 앉은 사람에 대해 1순위 타입과 2순위(뒤집히는) 타입의 팔레트를
 * 그 사람 본인의 조화·드레이핑 점수로 평가해 비교한다.
 * 점수 차가 작다면 문제는 색이 아니라 "라벨 하나만 크게 내미는 표현"이다. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
await p.goto('file:///home/user/-01/퍼스널컬러진단.html');
await p.waitForFunction(() => window.DIAGNOSE && window.PALETTES);

const out = await p.evaluate(() => {
  const D = window.DIAGNOSE, P = window.PALETTES, CC = window.CC;
  const rows = [];
  for (let L = 54; L <= 72; L += 3)
  for (let a = 10; a <= 18; a += 2)
  for (let bb = 13; bb <= 25; bb += 3) {
    const skin = { L, a, b: bb };
    const f = {
      skin,
      hair: { L: Math.max(14, L - 40), a: a * 0.35, b: bb * 0.42 },
      iris: { L: Math.max(20, L - 34), a: a * 0.28, b: bb * 0.32 },
      sclera: { L: Math.min(88, L + 10), a: 0.2, b: 2.4 },
      lip: { L: L - 12, a: a + 8, b: bb * 0.6 },
      quality: { skinVarL: 3.4 }
    };
    const dx = D.diagnose(f, {});
    const m = D.decisionMargin(f, {});
    if (!m || !m.season) continue;                 // 안 뒤집히면 볼 것 없다
    const t1 = dx.type, t2 = m.season.to;
    if (t1.key === t2.key) continue;

    // 각 팔레트를 이 사람 본인 기준으로 채점
    const sc = t => {  // 채점 기준은 사람(dx.person), 후보 목록만 타입에서 온다
      const r = D.rankColors(t.best, dx.person, true);
      return r.reduce((s, c) => s + c.score, 0) / r.length;
    };
    // 두 팔레트 색 자체가 얼마나 겹치는가 (A의 각 색 → B의 최근접 ΔE)
    const nearest = (A, B) => A.reduce((s, c) => {
      const la = c.lab || CC.hexToLab(c.hex);
      return s + Math.min(...B.map(d => CC.deltaE2000(la, d.lab || CC.hexToLab(d.hex))));
    }, 0) / A.length;

    rows.push({
      dE: m.season.dE,
      s1: sc(t1), s2: sc(t2),
      gap: sc(t1) - sc(t2),
      pal: (nearest(t1.best, t2.best) + nearest(t2.best, t1.best)) / 2,
      from: t1.ko, to: t2.ko
    });
  }
  const avg = k => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  const gaps = rows.map(r => Math.abs(r.gap)).sort((x, y) => x - y);
  return {
    n: rows.length,
    s1: avg('s1'), s2: avg('s2'), gap: avg('gap'),
    absGapMed: gaps[gaps.length >> 1], absGapP90: gaps[Math.floor(gaps.length * 0.9)],
    pal: avg('pal'),
    // 2순위 팔레트가 오히려 더 잘 맞는 비율
    inverted: rows.filter(r => r.gap < 0).length / rows.length * 100,
    sample: rows.slice(0, 8)
  };
});
console.log('경계에서 뒤집히는 표본', out.n, '명');
console.log('\n본인 기준 팔레트 평균 점수');
console.log('  1순위 타입 팔레트  ', out.s1.toFixed(4));
console.log('  뒤집혀 나오는 타입  ', out.s2.toFixed(4));
console.log('  차이               ', out.gap.toFixed(4),
  ' (등급 한 칸 = 0.10)');
console.log('  |차이| 중앙값', out.absGapMed.toFixed(4), ' 상위10%', out.absGapP90.toFixed(4));
console.log('  2순위가 오히려 더 잘 맞는 비율', out.inverted.toFixed(1) + '%');
console.log('\n두 팔레트 색 자체의 거리(평균 최근접 ΔE00)', out.pal.toFixed(1));
console.log('\n예시:');
for (const s of out.sample) console.log(' ', s.from, '→', s.to,
  ' 경계ΔE', s.dE.toFixed(2), ' 점수차', s.gap.toFixed(4), ' 팔레트거리', s.pal.toFixed(1));
await b.close();
