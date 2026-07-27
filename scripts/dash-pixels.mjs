// Confirm the dash canvas has real pixels drawn on it (not a blank texture).
import { chromium } from 'playwright';
const browser = await chromium.launch();
try{
 const page = await browser.newPage({viewport:{width:1280,height:800}});
 await page.goto('http://127.0.0.1:3000/monza.html');
 await page.waitForFunction(()=>window.MONZA?.sim?.ready,null,{timeout:60000});
 await page.waitForTimeout(2500);
 const r = await page.evaluate(()=>{
  let panel=null;
  window.MONZA.scene.traverse(o=>{
   if(o.isMesh && o.material && o.material.map && o.material.map.image
      && o.material.map.image.width===512) panel=o;
  });
  if(!panel) return {error:'no dash panel found'};
  const img=panel.material.map.image;
  const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
  const x=c.getContext('2d'); x.drawImage(img,0,0);
  const d=x.getImageData(0,0,c.width,c.height).data;
  let nonBg=0; const seen=new Set();
  for(let i=0;i<d.length;i+=4){
   const k=`${d[i]},${d[i+1]},${d[i+2]}`;
   seen.add(k);
   // Background is #05080c; anything brighter is drawn content.
   if(d[i]>20||d[i+1]>20||d[i+2]>30) nonBg++;
  }
  return {
   drawnPixels:nonBg,
   distinctColors:seen.size,
   verdict: nonBg>500 ? 'CANVAS HAS CONTENT' : 'CANVAS BLANK',
   textureNeedsUpdate: panel.material.map.needsUpdate,
  };
 });
 console.log(JSON.stringify(r,null,1));
} finally { await browser.close(); }
