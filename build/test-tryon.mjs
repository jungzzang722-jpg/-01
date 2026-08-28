import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = 'build/out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await page.goto('file://' + path.resolve('퍼스널컬러진단.html'));
await page.waitForTimeout(400);

// 모듈 로드 확인
const mods = await page.evaluate(() => ['CC','DETECT','BODY','GARMENTS','RECOLOR','TRYON','FITROOM','REPORT']
  .map(k => k + '=' + (typeof window[k])));;
console.log('modules:', mods.join(' '));

const result = await page.evaluate(async () => {
  const log = [];
  /* ---- 합성 전신 사진: 단색 배경 + 피부색 몸통/머리/팔/다리 + 옷 ---- */
  function synth(w, h, skin, shirt, pants, bg, lightSkew) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    const cx = w / 2, headR = h * 0.060;
    const headTop = h * 0.045, chinY = headTop + headR * 2.1;
    const shY = chinY + h * 0.035, waistY = h * 0.44, hipY = h * 0.54, footY = h * 0.965;
    const shHalf = w * 0.145, waistHalf = w * 0.105, hipHalf = w * 0.128;
    // 머리 · 목
    c.fillStyle = skin;
    c.beginPath(); c.ellipse(cx, headTop + headR * 1.05, headR * 0.82, headR * 1.05, 0, 0, 7); c.fill();
    c.fillRect(cx - w * 0.026, chinY - 4, w * 0.052, shY - chinY + 8);
    // 다리 (피부 위에 바지)
    c.fillStyle = skin;
    c.fillRect(cx - hipHalf * 0.92, hipY, hipHalf * 0.82, footY - hipY);
    c.fillRect(cx + hipHalf * 0.10, hipY, hipHalf * 0.82, footY - hipY);
    // 팔
    c.fillStyle = skin;
    c.save(); c.translate(cx - shHalf, shY); c.rotate(0.16);
    c.fillRect(-w * 0.032, 0, w * 0.062, h * 0.36); c.restore();
    c.save(); c.translate(cx + shHalf, shY); c.rotate(-0.16);
    c.fillRect(-w * 0.030, 0, w * 0.062, h * 0.36); c.restore();
    // 상의
    c.fillStyle = shirt; c.beginPath();
    c.moveTo(cx - shHalf, shY); c.lineTo(cx - shHalf * 1.06, shY + h * 0.20);
    c.lineTo(cx - waistHalf, waistY); c.lineTo(cx - hipHalf * 0.96, hipY + h * 0.015);
    c.lineTo(cx + hipHalf * 0.96, hipY + h * 0.015); c.lineTo(cx + waistHalf, waistY);
    c.lineTo(cx + shHalf * 1.06, shY + h * 0.20); c.lineTo(cx + shHalf, shY);
    c.closePath(); c.fill();
    // 하의
    c.fillStyle = pants;
    c.beginPath(); c.moveTo(cx - hipHalf, hipY); c.lineTo(cx - hipHalf * 0.80, footY - h * 0.02);
    c.lineTo(cx - hipHalf * 0.10, footY - h * 0.02); c.lineTo(cx, hipY + h * 0.16);
    c.lineTo(cx + hipHalf * 0.10, footY - h * 0.02); c.lineTo(cx + hipHalf * 0.80, footY - h * 0.02);
    c.lineTo(cx + hipHalf, hipY); c.closePath(); c.fill();
    // 왼쪽에서 든 빛 — 조명 이식이 작동하는지 보려면 방향성이 있어야 한다.
    // 배경까지 덮으면 인물 분리가 깨지므로(실루엣이 배경 그라디언트를 삼킨다)
    // 인물 픽셀에만 적용한다. 실제 단색 배경 촬영이 이 모습이다.
    if (lightSkew) {
      const im = c.getImageData(0, 0, w, h), d = im.data;
      const bgc = document.createElement('canvas').getContext('2d');
      bgc.fillStyle = bg; bgc.fillRect(0, 0, 1, 1);
      const b0 = bgc.getImageData(0, 0, 1, 1).data;
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
        if (Math.abs(d[i] - b0[0]) < 6 && Math.abs(d[i+1] - b0[1]) < 6 && Math.abs(d[i+2] - b0[2]) < 6) continue;
        const m = 1.18 - 0.34 * (x / w);
        d[i] = Math.min(255, d[i] * m); d[i+1] = Math.min(255, d[i+1] * m); d[i+2] = Math.min(255, d[i+2] * m);
      }
      c.putImageData(im, 0, 0);
    }
    return cv;
  }

  const photo = synth(420, 900, '#d9a97f', '#3F6EA8', '#2E3A52', '#EEEEF1', true);
  const t0 = performance.now();
  const body = BODY.analyzeFull(photo, { gender: 'female' });
  log.push('analyzeFull ok=' + body.ok + ' t=' + (performance.now() - t0).toFixed(0) + 'ms');
  if (!body.ok) return { log, fail: 'body analyze failed', issues: body.issues };
  log.push('landmarks(raw,640) top=' + body.landmarks.top + ' chin=' + body.landmarks.chinY +
           ' sh=' + body.landmarks.shoulder.y + ' waist=' + body.landmarks.waist.y +
           ' hip=' + body.landmarks.hip.y + ' bottom=' + body.landmarks.bottom);

  const t1 = performance.now();
  const prep = TRYON.prepare(body, photo, 900);
  log.push('prepare ' + prep.w + 'x' + prep.h + ' t=' + (performance.now() - t1).toFixed(0) + 'ms');
  const SL = TRYON.saneLM(prep.lm);
  log.push('landmarks(sane,' + prep.h + ') top=' + SL.top + ' chin=' + SL.chinY +
           ' sh=' + SL.shoulder.y + ' waist=' + SL.waist.y + ' hip=' + SL.hip.y + ' bottom=' + SL.bottom);
  log.push('landmarks(truth) sh=' + Math.round(900*0.045 + 900*0.060*2.1 + 900*0.035) +
           ' waist=' + Math.round(900*0.44) + ' hip=' + Math.round(900*0.54) + ' foot=' + Math.round(900*0.965));

  // 카탈로그 렌더 성능
  const t2 = performance.now();
  const g1 = GARMENTS.get('t-shirt-oxford');
  log.push('render oxford ' + g1.canvas.width + 'x' + g1.canvas.height +
           ' t=' + (performance.now() - t2).toFixed(0) + 'ms');
  const t2b = performance.now();
  GARMENTS.thumb('o-trench', 128);
  log.push('thumb t=' + (performance.now() - t2b).toFixed(0) + 'ms');

  // 색 변환 검증
  const gc = g1.canvas.getContext('2d');
  const gi = gc.getImageData(0, 0, g1.canvas.width, g1.canvas.height);
  const gm = new Uint8Array(g1.canvas.width * g1.canvas.height);
  for (let i = 0, p = 0; i < gi.data.length; i += 4, p++) gm[p] = gi.data[i + 3] > 8 ? 1 : 0;
  const before = new ImageData(g1.canvas.width, g1.canvas.height); before.data.set(gi.data);
  const t3 = performance.now();
  const rc = RECOLOR.recolor(gi, gm, g1.canvas.width, g1.canvas.height, '#8E2F4A', { material: 'cotton' });
  const ver = RECOLOR.verify(before, rc.imageData, gm, g1.canvas.width, g1.canvas.height, '#8E2F4A');
  log.push('recolor t=' + (performance.now() - t3).toFixed(0) + 'ms clusters=' + rc.clusters.length +
           ' hitDE=' + ver.hitDeltaE.toFixed(2) + ' textureKeep=' + ver.textureKeep.toFixed(2) +
           ' after=' + ver.hexAfter);
  const mat = RECOLOR.estimateMaterial(gi.data, gm, g1.canvas.width, g1.canvas.height);
  log.push('material guess=' + mat.key + ' conf=' + mat.conf.toFixed(2));

  // 합성
  const t4 = performance.now();
  const comp = TRYON.compose(prep, [
    { garmentId: 'b-straight-denim', colorHex: '#33404C' },
    { garmentId: 't-shirt-oxford', colorHex: '#E9C7B4' },
    { garmentId: 'o-blazer', colorHex: '#3B4250' }
  ], { ease: 1, lightAmount: 0.75, eraseOriginal: true });
  log.push('compose 3 layers t=' + (performance.now() - t4).toFixed(0) + 'ms layers=' +
           comp.report.layers.length + ' revealRatio=' +
           (comp.report.revealRatio || 0).toFixed(3));
  comp.report.layers.forEach(L => log.push('  layer ' + L.id + ' px=' + L.pixels +
    (L.recolor ? ' hitDE=' + L.recolor.verify.hitDeltaE.toFixed(1) +
      ' keep=' + L.recolor.verify.textureKeep.toFixed(2) : '')));
  comp.report.warnings.forEach(w => log.push('  warn: ' + w));

  // 슬라이더를 움직였을 때(색은 그대로, 여유분만 변경) 재합성 비용
  const t5 = performance.now();
  TRYON.compose(prep, [
    { garmentId: 'b-straight-denim', colorHex: '#33404C' },
    { garmentId: 't-shirt-oxford', colorHex: '#E9C7B4' },
    { garmentId: 'o-blazer', colorHex: '#3B4250' }
  ], { ease: 1.08, lightAmount: 0.75, eraseOriginal: true });
  log.push('recompose (slider, color cached) t=' + (performance.now() - t5).toFixed(0) + 'ms');

  // 단일 레이어 — 겹침 없이 워핑 자체만 본다. 여기서도 구멍이 나면 TPS 문제다.
  const solo = TRYON.compose(prep, [{ garmentId: 't-shirt-oxford', colorHex: '#E9C7B4' }],
    { ease: 1, lightAmount: 0.75, eraseOriginal: false });
  const scv = document.createElement('canvas'); scv.width = prep.w; scv.height = prep.h;
  scv.getContext('2d').putImageData(solo.imageData, 0, 0);
  log.push('solo oxford px=' + solo.report.layers[0].pixels);

  // 워핑 지도 진단: 몸통 조각이 옷본의 어느 y로 보내는가
  const g1c = GARMENTS.get('t-shirt-oxford');
  const A = TRYON.bodyAnchors(prep, GARMENTS.byId('t-shirt-oxford'), { ease: 1 });
  // 실제 합성이 쓰는 경로 그대로 — 진단이 프로덕션과 어긋나면 아무 의미가 없다
  const prts = TRYON.buildParts(GARMENTS.byId('t-shirt-oxford'), g1c, A);
  const torso = prts.filter(q => q.name === 'torso')[0];
  log.push('parts = ' + prts.map(q => q.name + '(' + q.dst.length + ')').join(', '));
  const tf = TRYON.solveTPS(torso.dst, torso.src, 8e-4);
  // 몸통 중앙 세로선을 따라 매핑을 찍어본다 — 단조로워야 한다
  const cxb = (A.waistL[0] + A.waistR[0]) / 2;
  let prevY = -1e9, nonMono = 0; const col = [];
  for (let y = Math.round(A.shL[1]); y <= Math.round(A._hemY); y += 24) {
    const m = tf(cxb, y);
    col.push(y + '->' + m[1].toFixed(0) + '/' + m[0].toFixed(0));
  }
  for (let y = Math.round(A.shL[1]); y <= Math.round(A._hemY); y += 8) {
    const m = tf(cxb, y);
    if (m[1] < prevY) nonMono++;
    prevY = m[1];
  }
  log.push('center column (bodyY -> gY/gX): ' + col.join('  '));
  log.push('center column non-monotonic steps = ' + nonMono);
  // 몸통 전체에서 알파 0으로 떨어지는 비율
  const gi2 = g1c.canvas.getContext('2d').getImageData(0, 0, g1c.canvas.width, g1c.canvas.height);
  let miss = 0, tot = 0;
  for (let y = Math.round(A.shL[1]); y <= Math.round(A._hemY); y += 3) {
    for (let x = 0; x < prep.w; x += 3) {
      // 몸통 중심부만 센다 — 팔은 소매 조각이 맡으므로 몸통 지도가 놓치는 게 정상이다
      const rr = prep.rows[y];
      if (rr.cx0 < 0 || x < rr.cx0 + 3 || x > rr.cx1 - 3) continue;
      if (!prep.mask[y * prep.w + x]) continue;
      tot++;
      const m = tf(x, y);
      const gx2 = Math.round(m[0]), gy2 = Math.round(m[1]);
      if (gx2 < 0 || gy2 < 0 || gx2 >= g1c.canvas.width || gy2 >= g1c.canvas.height) { miss++; continue; }
      if (gi2.data[(gy2 * g1c.canvas.width + gx2) * 4 + 3] < 8) miss++;
    }
  }
  log.push('torso map miss rate = ' + (miss / Math.max(1, tot) * 100).toFixed(1) + '%');

  // 출력 이미지
  const out = document.createElement('canvas');
  out.width = prep.w; out.height = prep.h;
  out.getContext('2d').putImageData(comp.imageData, 0, 0);
  const bcv = document.createElement('canvas');
  bcv.width = prep.w; bcv.height = prep.h;
  bcv.getContext('2d').putImageData(prep.image, 0, 0);

  // 실제로 픽셀이 바뀌었는가 (합성이 무성 실패하지 않았는지)
  const a = prep.image.data, b = comp.imageData.data;
  let diff = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 6) diff++;
  log.push('changed pixels = ' + (diff / (prep.w * prep.h) * 100).toFixed(1) + '%');

  return { log, before: bcv.toDataURL('image/png'), after: out.toDataURL('image/png'), solo: scv.toDataURL('image/png') };
});

console.log(result.log.join('\n'));
if (result.fail) { console.log('FAIL:', result.fail, JSON.stringify(result.issues)); }
for (const k of ['before', 'after', 'solo']) {
  if (result[k]) fs.writeFileSync(path.join(OUT, k + '.png'),
    Buffer.from(result[k].split(',')[1], 'base64'));
}
console.log('--- errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
await browser.close();
