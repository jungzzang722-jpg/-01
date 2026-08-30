/* relativeToNeutral 이 정말 조명 게인을 상쇄하는가 — 구현 검증.
 * 조명 변화 모델을 두 가지로 나눠 본다.
 *   diag : sRGB 선형 공간의 순수 대각 게인 (이론상 완전 상쇄되어야 함)
 *   brad : Bradford 색순응 (LMS 콘 공간의 대각 = sRGB 에선 비대각)
 * 둘의 잔차 차이가 곧 "이 방법의 이론적 상한"이다. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
await p.goto('file:///home/user/-01/퍼스널컬러진단.html');
await p.waitForFunction(() => window.CC);

const out = await p.evaluate(() => {
  const CC = window.CC;
  function cctToXy(T){let x;if(T<4000)x=-0.2661239e9/(T**3)-0.2343589e6/(T*T)+0.8776956e3/T+0.179910;else x=-3.0258469e9/(T**3)+2.1070379e6/(T*T)+0.2226347e3/T+0.240390;let y;if(T<2222)y=-1.1063814*x**3-1.34811020*x*x+2.18555832*x-0.20219683;else if(T<4000)y=-0.9549476*x**3-1.37418593*x*x+2.09137015*x-0.16748867;else y=3.0817580*x**3-5.87338670*x*x+3.75112997*x-0.37001483;return[x,y];}
  const M=[[0.8951,0.2664,-0.1614],[-0.7502,1.7135,0.0367],[0.0389,-0.0685,1.0296]];
  const Mi=[[0.9869929,-0.1470543,0.1599627],[0.4323053,0.5183603,0.0492912],[-0.0085287,0.0400428,0.9684867]];
  const mul=(m,v)=>m.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
  const xyToXyz=(x,y)=>[x/y,1,(1-x-y)/y];
  const lin=l=>{const c=CC.labToRgb(l.L,l.a,l.b);return[CC.srgbToLinear(c.r),CC.srgbToLinear(c.g),CC.srgbToLinear(c.b)];};
  const unlin=v=>CC.rgbToLab(CC.linearToSrgb(v[0]),CC.linearToSrgb(v[1]),CC.linearToSrgb(v[2]));

  function brad(lab,T){const l=lin(lab);
    const X=l[0]*0.4124564+l[1]*0.3575761+l[2]*0.1804375,Y=l[0]*0.2126729+l[1]*0.7151522+l[2]*0.0721750,Z=l[0]*0.0193339+l[1]*0.1191920+l[2]*0.9503041;
    const ws=mul(M,xyToXyz(...cctToXy(6500))),wd=mul(M,xyToXyz(...cctToXy(T))),co=mul(M,[X,Y,Z]);
    const xyz=mul(Mi,[co[0]*wd[0]/ws[0],co[1]*wd[1]/ws[1],co[2]*wd[2]/ws[2]]);
    const r=CC.xyzToRgb(xyz[0]*100,xyz[1]*100,xyz[2]*100);return CC.rgbToLab(r.r,r.g,r.b);}
  // 같은 색온도 변화를 sRGB 선형 대각으로 근사 (백색점 비율)
  function diagGains(T){const w=lin({L:100,a:0,b:0});const s=brad({L:100,a:0,b:0},T);const t=lin(s);
    return[t[0]/w[0],t[1]/w[1],t[2]/w[2]];}
  function diag(lab,T){const g=diagGains(T),l=lin(lab);return unlin([l[0]*g[0],l[1]*g[1],l[2]*g[2]]);}

  const skin={L:63,a:14,b:20.5}, scl={L:76,a:0.3,b:2.6};
  const CH=CC.SCLERA_CHROMA;
  const base=CC.relativeToNeutral(skin,scl,CH);
  const rows=[];
  for(const T of [4500,5500,6000,7000,7500,8500]){
    const r={T};
    for(const [k,fn] of [['diag',diag],['brad',brad]]){
      const rel=CC.relativeToNeutral(fn(skin,T),fn(scl,T),CH);
      r[k]=CC.deltaE2000(base,rel);
      r[k+'h']=CC.labToLch(rel.L,rel.a,rel.b).h-CC.labToLch(base.L,base.a,base.b).h;
      r[k+'abs']=CC.deltaE2000(skin,fn(skin,T));
    }
    rows.push(r);
  }
  return rows;
});
console.log('색온도   [순수 대각 조명]              [Bradford 조명]');
console.log('        보정없음ΔE  상대화후ΔE  Δh°     보정없음ΔE  상대화후ΔE  Δh°');
for(const r of out) console.log(String(r.T).padStart(5),
  r.diagabs.toFixed(2).padStart(11), r.diag.toFixed(2).padStart(11), r.diagh.toFixed(2).padStart(7),
  r.bradabs.toFixed(2).padStart(12), r.brad.toFixed(2).padStart(11), r.bradh.toFixed(2).padStart(7));
await b.close();
