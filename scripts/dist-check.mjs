// Photograph the car from the already-running static server (dist build).
import { chromium } from 'playwright';
const url = process.env.URL || 'http://127.0.0.1:8080/monza.html?e2e=1&debug=1';
const outDir = 'output/iterate/dist-check';
const SHOTS = [['front-3q',4.2,1.5,5.2],['side',6.5,1.1,0.2],['rear-3q',-4.4,1.6,-5.0],['front',0.2,1.0,6.4]];
const browser = await chromium.launch();
try{
 const page = await browser.newPage({viewport:{width:1280,height:800}});
 const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(url);
 await page.waitForFunction(()=>window.MONZA?.sim?.ready,null,{timeout:60000});
 await page.waitForFunction(()=>{
   const c=window.MONZA?.car; return c && (Math.abs(c.pos.x)+Math.abs(c.pos.z))>1;
 },null,{timeout:30000});
 await page.waitForTimeout(1500);
 const info=await page.evaluate(()=>{
  window.MONZA.renderer.setAnimationLoop(null);
  for(const el of document.querySelectorAll('body > *:not(canvas)')) if(el.tagName!=='SCRIPT') el.style.display='none';
  let veh=null,cock=null;
  window.MONZA.scene.traverse(o=>{if(o.name==='vehicle-view')veh=o; if(o.name==='cockpit-wheel-view')cock=o;});
  if(!veh) return {found:false};
  if(window.MONZA.sim.setCameraMode) window.MONZA.sim.setCameraMode('NOSE');
  veh.visible=true; const ch=veh.getObjectByName('vehicle-chassis'); if(ch)ch.visible=true;
  if(cock)cock.visible=false;
  window.__v=veh;
  // Count tris to confirm this is the new lofted model, not the old box car.
  let tris=0; veh.traverse(o=>{if(!o.isMesh)return;const g=o.geometry;tris+=g.index?g.index.count/3:(g.attributes.position?.count||0)/3;});
  return {found:true, tris:Math.round(tris)};
 });
 console.log(JSON.stringify(info));
 for(const [n,x,y,z] of SHOTS){
  await page.evaluate(([x,y,z])=>{
   const v=window.__v, cam=window.MONZA.camera;
   const p=window.MONZA.car.pos, o={x:p.x,y:p.y,z:p.z};
   const yaw=window.MONZA.car.yaw||0, cs=Math.cos(yaw), sn=Math.sin(yaw);
   cam.position.set(o.x+(x*cs+z*sn), o.y+y, o.z+(z*cs-x*sn));
   cam.lookAt(o.x,o.y+0.1,o.z); cam.fov=40; cam.near=0.05; cam.updateProjectionMatrix();
   window.MONZA.renderer.render(window.MONZA.scene,cam);
  },[x,y,z]);
  await page.screenshot({path:`${outDir}/${n}.png`});
 }
 if(errors.length) console.log('ERRORS: '+errors.slice(0,5).join(' | '));
 console.log('done');
} finally { await browser.close(); }
