/* 후보 특징들이 조명색 오차에 얼마나 끌려다니는지 잰다.
 * 절대량(피부 h°, b*)과 상대량(부위 간 차이)의 표류 폭을 직접 비교. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto('file:///home/user/-01/퍼스널컬러진단.html');
await page.waitForFunction(() => window.CC);

const out = await page.evaluate(() => {
  const CC = window.CC;
  function cctToXy(T){let x;if(T<4000)x=-0.2661239e9/(T**3)-0.2343589e6/(T*T)+0.8776956e3/T+0.179910;else x=-3.0258469e9/(T**3)+2.1070379e6/(T*T)+0.2226347e3/T+0.240390;let y;if(T<2222)y=-1.1063814*x**3-1.34811020*x*x+2.18555832*x-0.20219683;else if(T<4000)y=-0.9549476*x**3-1.37418593*x*x+2.09137015*x-0.16748867;else y=3.0817580*x**3-5.87338670*x*x+3.75112997*x-0.37001483;return[x,y];}
  const M=[[0.8951,0.2664,-0.1614],[-0.7502,1.7135,0.0367],[0.0389,-0.0685,1.0296]];
  const Mi=[[0.9869929,-0.1470543,0.1599627],[0.4323053,0.5183603,0.0492912],[-0.0085287,0.0400428,0.9684867]];
  const mul=(m,v)=>m.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
  const xyToXyz=(x,y)=>[x/y,1,(1-x-y)/y];
  function adapt(lab,s,d){const c=CC.labToRgb(lab.L,lab.a,lab.b);const l=[CC.srgbToLinear(c.r),CC.srgbToLinear(c.g),CC.srgbToLinear(c.b)];
    const X=l[0]*0.4124564+l[1]*0.3575761+l[2]*0.1804375,Y=l[0]*0.2126729+l[1]*0.7151522+l[2]*0.0721750,Z=l[0]*0.0193339+l[1]*0.1191920+l[2]*0.9503041;
    const ws=mul(M,xyToXyz(...cctToXy(s))),wd=mul(M,xyToXyz(...cctToXy(d))),co=mul(M,[X,Y,Z]);
    const xyz=mul(Mi,[co[0]*wd[0]/ws[0],co[1]*wd[1]/ws[1],co[2]*wd[2]/ws[2]]);
    const r=CC.xyzToRgb(xyz[0]*100,xyz[1]*100,xyz[2]*100);return CC.rgbToLab(r.r,r.g,r.b);}

  const S=[{ko:'밝은',skin:{L:72,a:12.5,b:18},hair:{L:26,a:5,b:9},iris:{L:32,a:4,b:7},sclera:{L:80,a:0,b:2},lip:{L:58,a:22,b:11}},
           {ko:'중간',skin:{L:63,a:14,b:20.5},hair:{L:22,a:5,b:8},iris:{L:28,a:4,b:6},sclera:{L:76,a:0,b:3},lip:{L:50,a:24,b:13}},
           {ko:'짙은',skin:{L:48,a:15,b:22},hair:{L:18,a:4,b:7},iris:{L:24,a:3,b:6},sclera:{L:72,a:0,b:3},lip:{L:40,a:20,b:12}}];
  const h=l=>CC.labToLch(l.L,l.a,l.b).h, C=l=>Math.hypot(l.a,l.b);
  const FEAT={
    '피부 h° (현행 34%)':      f=>h(f.skin),
    '피부 b* (현행 18%)':      f=>f.skin.b,
    '피부 b/a (현행 20%)':     f=>f.skin.b/Math.max(f.skin.a,1),
    '피부 C* (bright 25%)':    f=>C(f.skin),
    'ITA° (light 45%)':        f=>CC.ita(f.skin),
    '피부 L* (light 30%)':     f=>f.skin.L,
    '── 상대량 ──':            ()=>0,
    '피부 b* − 공막 b*':       f=>f.skin.b-f.sclera.b,
    '피부 a* − 공막 a*':       f=>f.skin.a-f.sclera.a,
    '피부 h° − 입술 h°':       f=>h(f.skin)-h(f.lip),
    '피부 h° − 모발 h°':       f=>h(f.skin)-h(f.hair),
    '피부 C* / 입술 C*':       f=>C(f.skin)/C(f.lip),
    '피부 L* − 모발 L* (대비)': f=>f.skin.L-f.hair.L,
    '공막 L* − 홍채 L*':       f=>f.sclera.L-f.iris.L,
    '피부 L* / 공막 L*':       f=>f.skin.L/f.sclera.L
  };
  const Ts=[5500,6000,6500,7000,7500];
  const rows=[];
  for(const [name,fn] of Object.entries(FEAT)){
    let drift=0, n=0, vals=[];
    for(const s of S){
      const at=T=>{const f={};for(const k of ['skin','hair','iris','sclera','lip'])f[k]=adapt(s[k],6500,T);return fn(f);};
      const v=Ts.map(at);
      drift+=Math.max(...v)-Math.min(...v); n++;
      vals.push(fn(s));
    }
    drift/=n;
    const spread=Math.max(...vals)-Math.min(...vals);
    rows.push({name, drift, spread, ratio: drift?spread/drift:Infinity});
  }
  return rows;
});
console.log('특징                         ±1000K 표류   대상자 간 편차   신호/표류');
for(const r of out){
  if(r.name.startsWith('──')){console.log(r.name);continue;}
  console.log(r.name.padEnd(26), r.drift.toFixed(2).padStart(10), r.spread.toFixed(2).padStart(14), (r.ratio>99?'∞':r.ratio.toFixed(2)).padStart(11));
}
await browser.close();
