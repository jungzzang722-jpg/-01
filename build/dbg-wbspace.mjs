/* 감마공간 게인으로 선형공간 조명 오차를 되돌릴 수 있는가.
 * 공막을 완벽하게 찾았다고 가정하고, 앱의 실제 보정 경로를 그대로 태운 뒤
 * 피부에 남는 잔차를 잰다. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
await p.goto('file:///home/user/-01/퍼스널컬러진단.html');
await p.waitForFunction(() => window.CC && window.DIAGNOSE);

const out = await p.evaluate(() => {
  const CC = window.CC, D = window.DIAGNOSE;
  function cctToXy(T){let x;if(T<4000)x=-0.2661239e9/(T**3)-0.2343589e6/(T*T)+0.8776956e3/T+0.179910;else x=-3.0258469e9/(T**3)+2.1070379e6/(T*T)+0.2226347e3/T+0.240390;let y;if(T<2222)y=-1.1063814*x**3-1.34811020*x*x+2.18555832*x-0.20219683;else if(T<4000)y=-0.9549476*x**3-1.37418593*x*x+2.09137015*x-0.16748867;else y=3.0817580*x**3-5.87338670*x*x+3.75112997*x-0.37001483;return[x,y];}
  const M=[[0.8951,0.2664,-0.1614],[-0.7502,1.7135,0.0367],[0.0389,-0.0685,1.0296]];
  const Mi=[[0.9869929,-0.1470543,0.1599627],[0.4323053,0.5183603,0.0492912],[-0.0085287,0.0400428,0.9684867]];
  const mul=(m,v)=>m.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
  const xyToXyz=(x,y)=>[x/y,1,(1-x-y)/y];
  // 물리적 조명 변화: 선형 공간에서 일어난다
  function shoot(lab,T){const c=CC.labToRgb(lab.L,lab.a,lab.b);const l=[CC.srgbToLinear(c.r),CC.srgbToLinear(c.g),CC.srgbToLinear(c.b)];
    const X=l[0]*0.4124564+l[1]*0.3575761+l[2]*0.1804375,Y=l[0]*0.2126729+l[1]*0.7151522+l[2]*0.0721750,Z=l[0]*0.0193339+l[1]*0.1191920+l[2]*0.9503041;
    const ws=mul(M,xyToXyz(...cctToXy(6500))),wd=mul(M,xyToXyz(...cctToXy(T))),co=mul(M,[X,Y,Z]);
    const xyz=mul(Mi,[co[0]*wd[0]/ws[0],co[1]*wd[1]/ws[1],co[2]*wd[2]/ws[2]]);
    return CC.xyzToRgb(xyz[0]*100,xyz[1]*100,xyz[2]*100);}

  // 선형 공간에서 기준점을 무채로 만드는 게인
  function linGains(rgb){const l=[CC.srgbToLinear(rgb.r),CC.srgbToLinear(rgb.g),CC.srgbToLinear(rgb.b)];
    const m=(l[0]+l[1]+l[2])/3||1;return[m/Math.max(l[0],1e-6),m/Math.max(l[1],1e-6),m/Math.max(l[2],1e-6)];}
  function applyLin(rgb,g){const l=[CC.srgbToLinear(rgb.r),CC.srgbToLinear(rgb.g),CC.srgbToLinear(rgb.b)];
    return{r:CC.linearToSrgb(l[0]*g[0]),g:CC.linearToSrgb(l[1]*g[1]),b:CC.linearToSrgb(l[2]*g[2])};}

  const S=[{ko:'밝은',skin:{L:72,a:12.5,b:18},sclera:{L:80,a:0,b:2}},
           {ko:'중간',skin:{L:63,a:14,b:20.5},sclera:{L:76,a:0,b:3}},
           {ko:'짙은',skin:{L:48,a:15,b:22},sclera:{L:72,a:0,b:3}}];
  const Ts=[4500,5500,6000,6500,7000,7500,8500];
  const rows=[];
  for(const s of S) for(const T of Ts){
    const shotSkin=shoot(s.skin,T), shotScl=shoot(s.sclera,T);
    // (a) 현행 — 감마공간 게인
    const gG=CC.gainsFromNeutral(shotScl,true);
    const aG=CC.rgbToLab(...['r','g','b'].map(k=>CC.applyGains(shotSkin,gG)[k]));
    // (b) 선형공간 게인 (공막 편향 동일 적용)
    const bias=[1.000,0.995,0.978];
    const gL=linGains(shotScl).map((v,i)=>v*bias[i]);
    const cL=applyLin(shotSkin,gL);
    const aL=CC.rgbToLab(cL.r,cL.g,cL.b);
    rows.push({ko:s.ko,T,
      eG:CC.deltaE2000(s.skin,aG), eL:CC.deltaE2000(s.skin,aL),
      hG:CC.labToLch(aG.L,aG.a,aG.b).h-CC.labToLch(s.skin.L,s.skin.a,s.skin.b).h,
      hL:CC.labToLch(aL.L,aL.a,aL.b).h-CC.labToLch(s.skin.L,s.skin.a,s.skin.b).h});
  }
  return rows;
});
console.log('주체  색온도   감마공간보정 ΔE   Δh°      선형공간보정 ΔE   Δh°');
for(const r of out) console.log(r.ko.padEnd(5), String(r.T).padStart(5),
  r.eG.toFixed(2).padStart(13), r.hG.toFixed(2).padStart(8),
  r.eL.toFixed(2).padStart(17), r.hL.toFixed(2).padStart(8));
await b.close();
