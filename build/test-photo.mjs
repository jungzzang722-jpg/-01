import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport:{width:1000,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.resolve('퍼스널컬러진단.html')); await p.waitForTimeout(400);
const fx = fs.readFileSync('build/fixture-photo.js','utf8');
const r = await p.evaluate((fx) => {
  const person = new Function(fx + '; return person;')();
  const img = person().canvas;
  const body = BODY.analyzeFull(img, { gender:'male' });
  if (!body.ok) return { fail:'analyze', issues: body.issues };
  const prep = TRYON.prepare(body, img, 900);
  const L = TRYON.saneLM(prep.lm);
  const sc = prep.h / 2000;
  const out = { w:prep.w, h:prep.h, scale:+sc.toFixed(3), src: prep.lmSource, seg: prep.seg && prep.seg.from,
    lm: { top:L.top, chin:L.chinY, sh:L.shoulder.y, shW:Math.round(L.shoulder.w),
          bust:L.bust.y, waist:L.waist.y, waistW:Math.round(L.waist.w),
          hip:L.hip.y, hipW:Math.round(L.hip.w), crotch:L.crotchY, bot:L.bottom } };
  // 정답 (사진 좌표 × scale)
  out.truth = { top:150, chin:430, sh:455, shW:600, waist:880, hip:960, crotch:1180, bot:1880 };
  Object.keys(out.truth).forEach(k => out.truth[k] = Math.round(out.truth[k]*sc));
  const Ab = TRYON.bodyAnchors(prep, GARMENTS.byId('b-straight-denim'), { ease:1 });
  if (Ab) { const R=v=>Array.isArray(v[0])?v.map(q=>q.map(Math.round)):v.map(Math.round);
    out.bot = { axis: Math.round((Ab.waistL[0]+Ab.waistR[0])/2),
      waist:[R(Ab.waistL),R(Ab.waistR)], hip:[R(Ab.hipL),R(Ab.hipR)],
      crotch:R(Ab.crotchC), hem:[R(Ab.hemL),R(Ab.hemR)],
      hemIn:[R(Ab.hemLin),R(Ab.hemRin)], legL:R(Ab.legL), legR:R(Ab.legR) }; }
  try {
    const res = TRYON.compose(prep, [
      { garmentId:'b-straight-denim', colorHex:'#3A4A63' },
      { garmentId:'t-crew-cotton',    colorHex:'#8B2D48' }], 
      { ease:1, lightAmount:0.75, eraseOriginal:true });
    out.layers = res.report.layers.map(l=>({id:l.id, px:l.pixels}));
    out.reveal = +(res.report.revealRatio||0).toFixed(3);
    out.skin = +(res.report.skinRatio||0).toFixed(3);
    const cv=document.createElement('canvas'); cv.width=prep.w; cv.height=prep.h;
    cv.getContext('2d').putImageData(res.imageData,0,0);
    out.after = cv.toDataURL('image/png');
    const bf=document.createElement('canvas'); bf.width=prep.w; bf.height=prep.h;
    bf.getContext('2d').putImageData(prep.image,0,0);
    out.before = bf.toDataURL('image/png');
  } catch (e) { out.composeError = e.message; }
  return out;
}, fx);
if (r.fail) { console.log('FAIL', r.fail, JSON.stringify(r.issues)); }
else {
  console.log('분리:', r.seg, '| 랜드마크 출처:', r.src, '|', r.w+'x'+r.h, 'scale', r.scale);
  const t=r.truth, l=r.lm;
  const row=(k,a,bv)=>console.log('  '+k.padEnd(7), String(a).padStart(4), '정답', String(bv).padStart(4),
    (bv? (Math.abs(a-bv)/bv*100).toFixed(0)+'%' : ''), Math.abs(a-bv)>bv*0.08?'  ✗':'');
  row('top',l.top,t.top); row('chin',l.chin,t.chin); row('shoulder',l.sh,t.sh);
  row('waist',l.waist,t.waist); row('hip',l.hip,t.hip);
  row('crotch',l.crotch,t.crotch); row('bottom',l.bot,t.bot);
  console.log('  어깨폭', l.shW, '정답', t.shW, '| 허리폭', l.waistW, '| 골반폭', l.hipW);
  if (r.bot) { console.log('하의 대응점 (축', r.bot.axis, '):');
    ['waist','hip','crotch','hem','hemIn'].forEach(k=>console.log('   ',k, JSON.stringify(r.bot[k])));
    console.log('    legL', JSON.stringify(r.bot.legL));
    console.log('    legR', JSON.stringify(r.bot.legR)); }
  console.log('레이어:', JSON.stringify(r.layers), '| reveal', r.reveal, '| skin', r.skin, r.composeError||'');
  for (const k of ['before','after']) if (r[k]) fs.writeFileSync(`build/out/photo-${k}.png`, Buffer.from(r[k].split(',')[1],'base64'));
}
console.log('errors:', errs.length?errs.join('\n'):'none');
await b.close();
