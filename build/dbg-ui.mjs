import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport:{width:1280,height:1000}, deviceScaleFactor:1 });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.resolve('퍼스널컬러진단.html')); await p.waitForTimeout(400);
const fx = (()=>{ const s=fs.readFileSync('build/test-real.mjs','utf8');
  return s.slice(s.indexOf('  const W=500, H=1000;'), s.indexOf('  const img = person();')); })();
// 진단 결과를 만들고 리포트를 띄운다
await p.evaluate((fx) => {
  const person = new Function(fx + '; return person;')();
  window.__img = person();
}, fx);
const info = await p.evaluate(async () => {
  const img = window.__img;
  const body = BODY.analyzeFull(img, { gender:'male' });
  const dx = { type: (PALETTES && PALETTES.types ? PALETTES.types[0] : null) };
  return { ok: body.ok, keys: Object.keys(window).filter(k=>/^(FITROOM|TRYON|GARMENTS|REPORT|APP)$/.test(k)) };
});
console.log(JSON.stringify(info));
console.log('errors:', errs.join('|')||'none');
await b.close();
