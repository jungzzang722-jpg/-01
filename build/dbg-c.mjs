import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
await p.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await p.waitForFunction(() => window.GARMENTS);
const gf = fs.readFileSync('build/fixture-garment.js', 'utf8');
const o = await p.evaluate((gf) => {
  new Function(gf)();
  const g = GARMENT_FIXTURE.hoodie();
  const work = DETECT.toWorkCanvas(g.canvas, 560);
  const w = work.w, h = work.h;
  const d = work.ctx.getImageData(0, 0, w, h).data;
  const at = (x, y) => { const i = (y * w + x) * 4; return { rgb: [d[i], d[i+1], d[i+2]], lab: CC.rgbToLab(d[i], d[i+1], d[i+2]) }; };
  // 배경 한 점, 후드 몸통 여러 점
  const bgp = at(5, 5);
  const pts = [[280, 150], [280, 220], [280, 300], [180, 250], [380, 250], [120, 330], [440, 330]];
  const cut = GARMENTS.cutout(g.canvas, 560);
  return {
    centers: cut.centers.map(c => 'L' + c.L.toFixed(1) + ' a' + c.a.toFixed(1) + ' b' + c.b.toFixed(1)),
    th: cut.threshold, ratio: +cut.ratio.toFixed(3),
    bg: { rgb: bgp.rgb, L: +bgp.lab.L.toFixed(1) },
    pts: pts.map(([x, y]) => {
      const q = at(x, y);
      return { x, y, rgb: q.rgb.join(','), L: +q.lab.L.toFixed(1),
        dE: +CC.deltaE2000(q.lab, bgp.lab).toFixed(1) };
    })
  };
}, gf);
console.log('배경 군집:', o.centers, ' 임계 ΔE', o.th, ' 전경비', o.ratio);
console.log('배경', o.bg.rgb.join(','), 'L' + o.bg.L);
console.log('\n지점        색            L      배경과 ΔE');
for (const q of o.pts) console.log(('(' + q.x + ',' + q.y + ')').padEnd(12), q.rgb.padEnd(14), String(q.L).padEnd(7), q.dE);
await b.close();
