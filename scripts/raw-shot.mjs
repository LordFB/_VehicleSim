// Screenshot the page EXACTLY as it renders itself. No visibility overrides, no
// camera manipulation, no stopping the loop. Whatever the user sees, we see.
import { chromium } from 'playwright';
const url = process.env.URL || 'http://127.0.0.1:3000/monza.html';
const out = process.env.OUT || 'output/iterate/raw/as-rendered.png';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.MONZA?.sim?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const r = { cam: null, vehTris: 0, vehVisibleMeshes: 0, cockpitVisible: null, chassisVisible: null };
    try { r.cam = JSON.parse(window.render_game_to_text()).camera; } catch {}
    window.MONZA.scene.traverse(o => {
      if (o.name === 'cockpit-wheel-view') r.cockpitVisible = o.visible;
      if (o.name === 'vehicle-chassis') r.chassisVisible = o.visible;
      if (!o.isMesh) return;
      let inVeh = false; for (let n = o; n; n = n.parent) if (n.name === 'vehicle-view') inVeh = true;
      if (!inVeh) return;
      let vis = o.visible; for (let n = o; n; n = n.parent) if (!n.visible) vis = false;
      if (vis) { r.vehVisibleMeshes++; const g = o.geometry; r.vehTris += g.index ? g.index.count/3 : (g.attributes.position?.count||0)/3; }
    });
    r.vehTris = Math.round(r.vehTris);
    return r;
  });
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ ...info, errors: errors.slice(0,5) }, null, 1));
} finally { await browser.close(); }
