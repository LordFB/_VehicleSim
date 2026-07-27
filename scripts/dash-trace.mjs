import { chromium } from 'playwright';
const browser = await chromium.launch();
try{
 const page = await browser.newPage({viewport:{width:1280,height:800}});
 const logs=[]; page.on('console',m=>logs.push(m.text()));
 page.on('pageerror',e=>logs.push('PAGEERROR '+e));
 await page.goto('http://127.0.0.1:3000/monza.html');
 await page.waitForFunction(()=>window.MONZA?.sim?.ready,null,{timeout:60000});
 await page.waitForTimeout(2000);
 const r = await page.evaluate(()=>{
  let panel=null;
  window.MONZA.scene.traverse(o=>{
   if(o.isMesh&&o.material&&o.material.map&&o.material.map.image&&o.material.map.image.width===512) panel=o;
  });
  if(!panel) return {error:'no panel'};
  const img = panel.material.map.image;
  // Can we get a 2d context off the very canvas the texture wraps?
  const ctx = img.getContext ? img.getContext('2d') : null;
  let manualDrawWorked=false;
  if(ctx){
   ctx.fillStyle='#ff0000'; ctx.fillRect(0,0,50,50);
   const d=ctx.getImageData(5,5,1,1).data;
   manualDrawWorked = d[0]>200;
  }
  return {
   isCanvas: img instanceof HTMLCanvasElement,
   tag: img.tagName,
   hasGetContext: typeof img.getContext === 'function',
   ctxAvailable: !!ctx,
   manualDrawWorked,
  };
 });
 console.log(JSON.stringify(r,null,1));
 console.log('logs:', logs.slice(0,5));
} finally { await browser.close(); }
