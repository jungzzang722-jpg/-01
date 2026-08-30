/* 세 축이 조명 오차에 각각 얼마나 흔들리는지. ITA·채도 상대화의 효과 확인용. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
await p.goto('file:///home/user/-01/퍼스널컬러진단.html');
await p.waitForFunction(() => window.DIAGNOSE);
const raw = await p.evaluate(() => {
  const CC = window.CC, D = window.DIAGNOSE;
  function cctToXy(T){let x;if(T<4000)x=-0.2661239e9/(T**3)-0.2343589e6/(T*T)+0.8776956e3/T+0.179910;else x=-3.0258469e9/(T**3)+2.1070379e6/(T*T)+0.2226347e3/T+0.240390;let y;if(T<2222)y=-1.1063814*x**3-1.34811020*x*x+2.18555832*x-0.20219683;else if(T<4000)y=-0.9549476*x**3-1.37418593*x*x+2.09137015*x-0.16748867;else y=3.0817580*x**3-5.87338670*x*x+3.75112997*x-0.37001483;return[x,y];}
  const M=[[0.8951,0.2664,-0.1614],[-0.7502,1.7135,0.0367],[0.0389,-0.0685,1.0296]];
  const Mi=[[0.9869929,-0.1470543,0.1599627],[0.4323053,0.5183603,0.0492912],[-0.0085287,0.0400428,0.9684867]];
  const mul=(m,v)=>m.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
  const xyToXyz=(x,y)=>[x/y,1,(1-x-y)/y];
  function shoot(lab,T){const c=CC.labToRgb(lab.L,lab.a,lab.b);const l=[CC.srgbToLinear(c.r),CC.srgbToLinear(c.g),CC.srgbToLinear(c.b)];
    const X=l[0]*0.4124564+l[1]*0.3575761+l[2]*0.1804375,Y=l[0]*0.2126729+l[1]*0.7151522+l[2]*0.0721750,Z=l[0]*0.0193339+l[1]*0.1191920+l[2]*0.9503041;
    const ws=mul(M,xyToXyz(...cctToXy(6500))),wd=mul(M,xyToXyz(...cctToXy(T))),co=mul(M,[X,Y,Z]);
    const xyz=mul(Mi,[co[0]*wd[0]/ws[0],co[1]*wd[1]/ws[1],co[2]*wd[2]/ws[2]]);
    return CC.xyzToRgb(xyz[0]*100,xyz[1]*100,xyz[2]*100);}
  const KEYS=['skin','hair','iris','sclera','lip'];
  const S=[{skin:{L:72,a:12.5,b:18},hair:{L:26,a:5,b:9},iris:{L:32,a:4,b:7},sclera:{L:80,a:0.3,b:2.2},lip:{L:58,a:22,b:11}},
           {skin:{L:63,a:14,b:20.5},hair:{L:22,a:5,b:8},iris:{L:28,a:4,b:6},sclera:{L:76,a:0.3,b:2.6},lip:{L:50,a:24,b:13}},
           {skin:{L:48,a:15,b:22},hair:{L:18,a:4,b:7},iris:{L:24,a:3,b:6},sclera:{L:72,a:0.3,b:2.8},lip:{L:40,a:20,b:12}}];
  const res={on:{warm:0,light:0,bright:0},off:{warm:0,light:0,bright:0}};
  for(const s of S){
    for(const use of [true,false]){
      const v={warm:[],light:[],bright:[]};
      for(const T of [5500,6000,6500,7000,7500]){
        const shot={},f={quality:{skinVarL:3.4}};
        for(const k of KEYS) shot[k]=shoot(s[k],T);
        const g=CC.gainsFromNeutral(shot.sclera,true);
        const half={r:Math.pow(g.r,0.5),g:Math.pow(g.g,0.5),b:Math.pow(g.b,0.5)};
        const cor={};
        for(const k of KEYS){const c=CC.applyGains(shot[k],half);cor[k]=CC.rgbToLab(c.r,c.g,c.b);f[k]=cor[k];}
        f.neutral=use?{lab:cor.sclera,chroma:CC.SCLERA_CHROMA,src:'sclera'}:null;
        const a=D.computeAxes(f,{});
        v.warm.push(a.warm);v.light.push(a.light);v.bright.push(a.bright);
      }
      const t=use?'on':'off';
      
      for(const k of ['warm','light','bright']) res[t][k]+=(Math.max(...v[k])-Math.min(...v[k]))/S.length;
    }
  }
  const t=(()=>{const f={quality:{skinVarL:3.4}};for(const k of KEYS)f[k]=S[1][k];f.neutral={lab:S[1].sclera,chroma:CC.SCLERA_CHROMA,src:'sclera'};return D.computeAxes(f,{});})();
  return {res, probe:{warm:t.warm,light:t.light,bright:t.bright,m:t.metrics}};
});
const out = raw.res;
console.log('probe', JSON.stringify(raw.probe));
console.log('±1000K 범위에서 축이 움직인 폭 (축 범위는 -1~+1)');
console.log('축       상대화 끔   상대화 켬    개선');
for(const k of ['warm','light','bright'])
  console.log(k.padEnd(8), out.off[k].toFixed(3).padStart(9), out.on[k].toFixed(3).padStart(11),
    (out.off[k]/Math.max(out.on[k],1e-6)).toFixed(2).padStart(8)+'배');
await b.close();
