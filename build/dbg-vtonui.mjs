import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('퍼스널컬러진단_고화질합성.html'));
await p.waitForFunction(() => window.VTON_UI);
// 피팅 패널을 흉내 내어 붙는지 본다
await p.evaluate(() => {
  const h = document.createElement('div');
  h.className = 'tab-panel'; h.dataset.panel = 'tryon';
  h.style.cssText = 'padding:18px;max-width:860px';
  document.body.innerHTML = ''; document.body.appendChild(h);
  h.dataset.mounted = '1';
});
await p.waitForSelector('.vt-card', { timeout: 4000 });
const info = await p.evaluate(() => {
  const c = document.querySelector('.vt-card');
  return { runDisabled: document.getElementById('vtRun').disabled,
           text: c.innerText.replace(/\s+/g, ' ').slice(0, 150) };
});
console.log('카드 붙음, 합성 버튼 비활성:', info.runDisabled);
console.log(info.text);
const card = await p.$('.vt-card');
await card.screenshot({ path: 'build/out/vton-card.png' });
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await b.close();
