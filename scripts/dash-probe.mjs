// Check whether the dash panel is occluded by the bezel, and that it draws.
import { chromium } from 'playwright';
const browser = await chromium.launch();
try{
 const page = await browser.newPage({viewport:{width:1280,height:800}});
 const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
 await page.goto('http://127.0.0.1:3000/monza.html');
 await page.waitForFunction(()=>window.MONZA?.sim?.ready,null,{timeout:60000});
 await page.waitForTimeout(2000);
 const r = await page.evaluate(()=>{
  let rim=null;
  window.MONZA.scene.traverse(o=>{ if(o.name==='cockpit-steering-wheel') rim=o; });
  if(!rim) return {error:'no steering wheel'};
  const parts=[];
  rim.traverse(o=>{
   if(!o.isMesh) return;
   o.geometry.computeBoundingBox();
   const bb=o.geometry.boundingBox;
   parts.push({
    type:o.geometry.type,
    name:o.name||'',
    hasMap: !!(o.material && o.material.map),
    pos:[+o.position.x.toFixed(4),+o.position.y.toFixed(4),+o.position.z.toFixed(4)],
    zMin:+(bb.min.z+o.position.z).toFixed(4),
    zMax:+(bb.max.z+o.position.z).toFixed(4),
    rotY:+o.rotation.y.toFixed(3),
   });
  });
  return {parts: parts.filter(p=>p.type==='PlaneGeometry'||p.hasMap||Math.abs(p.pos[1]-0.022)<0.03)};
 });
 console.log(JSON.stringify(r,null,1));
 if(errs.length) console.log('ERRORS',errs.slice(0,3));
} finally { await browser.close(); }
