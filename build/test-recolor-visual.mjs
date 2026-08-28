import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto('file://'+path.resolve('퍼스널컬러진단.html'));
await page.waitForTimeout(300);
const png = await page.evaluate(() => {
  const ids = ['o-leather-rider','t-blouse-silk','b-slim-denim','t-cable','o-tweed-jk'];
  const cols = [null,'#F2E3C8','#8E2F4A','#2F5FA8','#D8722C'];
  const CW=170, CH=220;
  const out=document.createElement('canvas');
  out.width=CW*cols.length; out.height=CH*ids.length;
  const oc=out.getContext('2d');
  oc.fillStyle='#fff'; oc.fillRect(0,0,out.width,out.height);
  ids.forEach((id,r)=>{
    const G=GARMENTS.get(id);
    const gw=G.canvas.width, gh=G.canvas.height;
    const base=G.canvas.getContext('2d').getImageData(0,0,gw,gh);
    const m=new Uint8Array(gw*gh);
    for(let i=0,p=0;i<base.data.length;i+=4,p++) m[p]=base.data[i+3]>8?1:0;
    cols.forEach((hex,c)=>{
      const tmp=document.createElement('canvas'); tmp.width=gw; tmp.height=gh;
      let img;
      if(!hex){ img=new ImageData(gw,gh); img.data.set(base.data); }
      else { const w2=new ImageData(gw,gh); w2.data.set(base.data);
             img=RECOLOR.recolor(w2,m,gw,gh,hex,{material:GARMENTS.byId(id).material}).imageData; }
      tmp.getContext('2d').putImageData(img,0,0);
      oc.drawImage(tmp, c*CW+6, r*CH+6, CW-12, CH-12);
      oc.fillStyle='#333'; oc.font='10px sans-serif';
      oc.fillText(c===0?id:hex, c*CW+8, r*CH+CH-4);
    });
  });
  return out.toDataURL('image/png');
});
fs.writeFileSync('build/out/recolor-grid.png', Buffer.from(png.split(',')[1],'base64'));
await browser.close();
console.log('ok');
