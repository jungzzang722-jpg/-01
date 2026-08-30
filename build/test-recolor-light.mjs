/* 밝은 색으로 바꿀 때 무엇이 무너지는지 잰다.
 * 화면에서는 크림색·리넨이 하얗게 뜨고 세로 줄무늬가 남았다.
 * 목표색과 실제 평균색의 거리(hitΔE), 결이 남았는지(keep), 그리고
 * 얼마나 날아갔는지(clip)를 함께 본다. */
import { chromium } from 'playwright';
import path from 'path';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await page.waitForFunction(() => window.RECOLOR && window.GARMENTS);

const out = await page.evaluate(() => {
  const rows = [];
  const IDS = ['t-summer-knit', 'b-linen-easy', 't-crew-cotton', 'o-linen-jk',
               'b-straight-denim', 'o-leather-rider', 'b-pleats-skirt'];
  // 밝기를 따라가며 — 어두운 색부터 아주 밝은 색까지
  const TARGETS = [['짙은 남색','#2E3440'], ['중간 올리브','#6B7B5A'], ['중간 베이지','#B39C7D'],
                   ['밝은 크림','#E7DCC8'], ['아주 밝은','#F2ECE0'], ['흰색에 가까움','#F8F5EF']];
  for (const id of IDS) {
    const G = GARMENTS.get(id);
    if (!G) continue;
    const gw = G.canvas.width, gh = G.canvas.height;
    const ctx = G.canvas.getContext('2d', { willReadFrequently: true });
    const src = ctx.getImageData(0, 0, gw, gh);
    const mask = new Uint8Array(gw * gh);
    let mn = 0;
    for (let i = 0; i < mask.length; i++) if (src.data[i*4+3] > 200) { mask[i] = 1; mn++; }
    const spec = GARMENTS.byId(id);
    for (const [ko, hex] of TARGETS) {
      const r = RECOLOR.recolor(src, mask, gw, gh, hex, { material: spec.material });
      const v = RECOLOR.verify(src, r.imageData, mask, gw, gh, hex);
      // 채널이 날아간 비율
      let clip = 0, n = 0;
      const d = r.imageData.data;
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        n++;
        if (d[p*4] > 252 && d[p*4+1] > 252 && d[p*4+2] > 252) clip++;
      }
      rows.push({ id, ko, hex, hit: v.hitDeltaE, keep: v.textureKeep,
        clip: clip / Math.max(1, n), after: v.hexAfter, L: v.meanAfter.L,
        tL: CC.hexToLab(hex).L });
    }
  }
  return rows;
});

let cur = '';
for (const r of out) {
  if (r.id !== cur) { cur = r.id; console.log('\n' + cur); 
    console.log('  목표          목표L  결과L   hitΔE   결보존   날아감   결과색'); }
  const bad = r.hit > 3 || r.keep < 0.55 || r.clip > 0.05;
  console.log('  ' + r.ko.padEnd(13) + r.tL.toFixed(0).padStart(5) + r.L.toFixed(0).padStart(7) +
    r.hit.toFixed(1).padStart(8) + r.keep.toFixed(2).padStart(9) +
    (r.clip * 100).toFixed(1).padStart(8) + '%  ' + r.after + (bad ? '   ✗' : ''));
}
console.log('\npage errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
