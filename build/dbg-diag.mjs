/* 진단 정보 버튼이 실제로 쓸 만한 내용을 뽑는지 확인한다.
 * 사용자가 이걸 붙여 넣어 줄 텐데, 정작 필요한 값이 빠져 있으면 왕복이 한 번 더 는다. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await p.waitForFunction(() => window.TRYON && window.FITROOM);
const fx = fs.readFileSync('build/fixture-photo.js', 'utf8');

// 실제 UI 를 띄워 버튼이 무엇을 내놓는지 그대로 본다
const out = await p.evaluate(async (fx) => {
  const cv = new Function(fx + '; return person;')()().canvas;
  const full = BODY.analyzeFull(cv, { gender: 'male' });
  const host = document.createElement('div');
  host.innerHTML = '<div class="tab-panel" data-panel="tryon"></div>';
  document.body.innerHTML = ''; document.body.appendChild(host);
  FITROOM.mount(host, { hasBody: true, body: full, sourceImage: cv,
                        dx: null, rec: null, gender: 'male' });
  await new Promise(r => setTimeout(r, 600));

  const pick = (id) => {
    const el = document.querySelector('.fit-item[data-id="' + id + '"]');
    if (el) el.click();
    return !!el;
  };
  const cat = (k) => { const el = document.querySelector('[data-cat="' + k + '"]'); if (el) el.click(); };
  cat('bottom'); await new Promise(r => setTimeout(r, 250));
  const okBot = pick('b-straight-denim');
  await new Promise(r => setTimeout(r, 900));
  cat('top'); await new Promise(r => setTimeout(r, 250));
  const okTop = pick('t-crew-cotton');
  await new Promise(r => setTimeout(r, 1500));

  const btn = document.getElementById('fitDiag');
  if (!btn) return { fail: '진단 버튼 없음' };
  btn.click();
  await new Promise(r => setTimeout(r, 500));
  const ta = document.querySelector('#fitReport textarea, textarea.diag-text');
  const txt = ta ? ta.value : '(textarea 없음 — 클립보드로 갔거나 폴백이 안 떴다)';
  return { okBot, okTop, len: txt.length, txt };
}, fx);

if (out.fail) console.log('실패:', out.fail);
else {
  console.log('옷 선택 하의/상의:', out.okBot, out.okTop, '  길이', out.len, '자\n');
  console.log(out.txt);
}
console.log('\nerrors:', errs.length ? errs.join(' | ') : 'none');
await b.close();
