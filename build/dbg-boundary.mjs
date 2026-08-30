/* 판정 경계가 실제로 얼마나 촘촘한가.
 * 현실적인 피부·모발·홍채 조합을 격자로 훑어 경계까지의 거리 분포를 낸다.
 * "knife" 가 내가 만든 인물의 우연인지, 구조적인 것인지 가른다. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
await p.goto('file:///home/user/-01/퍼스널컬러진단.html');
await p.waitForFunction(() => window.DIAGNOSE);

const out = await p.evaluate(() => {
  const D = window.DIAGNOSE, CC = window.CC;
  const res = [];
  // 한국인 얼굴 실측 범위를 넉넉히 덮는 격자
  for (let L = 52; L <= 74; L += 2.5)
  for (let a = 9; a <= 19; a += 1.25)
  for (let bb = 12; bb <= 26; bb += 1.75) {
    const skin = { L, a, b: bb };
    // 모발·홍채·입술은 피부와 함께 움직이는 전형값으로 묶는다
    const hair = { L: Math.max(14, L - 40), a: a * 0.35, b: bb * 0.42 };
    const iris = { L: Math.max(20, L - 34), a: a * 0.28, b: bb * 0.32 };
    const sclera = { L: Math.min(88, L + 10), a: 0.2, b: 2.4 };
    const lip = { L: L - 12, a: a + 8, b: bb * 0.6 };
    const f = { skin, hair, iris, sclera, lip, quality: { skinVarL: 3.4 } };
    const m = D.decisionMargin(f, {});
    res.push({ dE: m && m.season ? m.season.dE : 99, lv: m ? m.level : 'wide' });
  }
  const n = res.length;
  const cnt = k => res.filter(k).length;
  const q = t => { const s = res.map(r => r.dE).sort((x, y) => x - y); return s[Math.floor(s.length * t)]; };
  return {
    n,
    lv: ['knife','tight','ok','wide'].map(l => [l, cnt(r => r.lv === l), (cnt(r => r.lv === l) / n * 100)]),
    under: [0.5, 1, 2, 3, 5].map(t => [t, cnt(r => r.dE < t) / n * 100]),
    med: q(0.5), p25: q(0.25), p75: q(0.75)
  };
});
console.log('표본', out.n, '명 (합성 격자)');
console.log('\n판정 여유 등급');
for (const [l, c, pct] of out.lv) console.log(' ', l.padEnd(6), String(c).padStart(6), pct.toFixed(1).padStart(6) + '%');
console.log('\n경계까지 ΔE 가 t 미만인 비율');
for (const [t, pct] of out.under) console.log('  ΔE <', String(t).padEnd(4), pct.toFixed(1).padStart(6) + '%');
console.log('\n중앙값 ΔE', out.med.toFixed(2), ' 사분위', out.p25.toFixed(2), '~', out.p75.toFixed(2));
await b.close();
