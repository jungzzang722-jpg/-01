/* 후보 풀 박스가 실제로 보이는지 눈으로 확인한다. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
fs.mkdirSync('build/out', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await page.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await page.waitForFunction(() => window.REPORT && window.DIAGNOSE);

const info = await page.evaluate(() => {
  const D = window.DIAGNOSE, R = window.RECOMMEND, CC = window.CC;
  // 경계에 앉은 사람 + 기준점 없는 사진 → 후보가 여럿이어야 한다
  const L = 60, a = 14, bb = 19;
  const f = {
    skin: { L, a, b: bb },
    hair: { L: L - 40, a: a * 0.35, b: bb * 0.42 },
    iris: { L: L - 34, a: a * 0.28, b: bb * 0.32 },
    sclera: { L: L + 10, a: 0.2, b: 2.4 },
    lip: { L: L - 12, a: a + 8, b: bb * 0.6 },
    neutral: null,
    wb: { method: 'shades_of_gray', cast: 0.09, clip: { imbalance: 0.02 } },
    quality: { skinVarL: 3.4, faceRatio: 0.3, blurVar: 120, clipHigh: 0.01, clipLow: 0.01, lightDiff: 5 },
    issues: []
  };
  const dx = D.diagnose(f, {});
  dx.margin = D.decisionMargin(f, {});
  dx.pool = D.candidatePool(f, {});
  const el = document.createElement('div');
  el.style.cssText = 'max-width:820px;padding:20px;background:var(--bg)';
  document.body.innerHTML = '';
  document.body.appendChild(el);
  el.innerHTML = REPORT.colorResult(dx, f);
  const box = el.querySelector('.pool-box');
  return {
    type: dx.type.ko, sigma: dx.pool.sigma,
    pool: dx.pool.pool.map(x => x.type.ko + ' ' + (x.share * 100).toFixed(0) + '%'),
    boxShown: !!box, text: box ? box.innerText.replace(/\s+/g, ' ').slice(0, 260) : null
  };
});
console.log('1순위', info.type, ' σ', info.sigma.toFixed(2));
console.log('후보', info.pool.join(' | '));
console.log('박스 표시:', info.boxShown);
console.log(info.text);
const box = await page.$('.pool-box');
if (box) await box.screenshot({ path: 'build/out/pool-box.png' });
console.log('page errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
