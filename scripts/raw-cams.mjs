// Cycle cameras with the real 'C' key and screenshot each, untouched.
import { chromium } from 'playwright';
const url = 'http://127.0.0.1:3000/monza.html';
const outDir = 'output/iterate/raw';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.MONZA?.sim?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const rows = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForFunction(() => !!window.MONZA?.scene, null, { timeout: 30000 });
    const st = await page.evaluate(() => {
      const r = { cam: null, vehTris: 0, meshes: 0, cockpitVisible: null, chassisVisible: null };
      try { r.cam = JSON.parse(window.render_game_to_text()).camera; } catch {}
      window.MONZA.scene.traverse(o => {
        if (o.name === 'cockpit-wheel-view') r.cockpitVisible = o.visible;
        if (o.name === 'vehicle-chassis') r.chassisVisible = o.visible;
        if (!o.isMesh) return;
        let inVeh = false; for (let n = o; n; n = n.parent) if (n.name === 'vehicle-view') inVeh = true;
        if (!inVeh) return;
        let vis = o.visible; for (let n = o; n; n = n.parent) if (!n.visible) vis = false;
        if (vis) { r.meshes++; const g = o.geometry; r.vehTris += g.index ? g.index.count/3 : (g.attributes.position?.count||0)/3; }
      });
      r.vehTris = Math.round(r.vehTris); return r;
    });
    await page.screenshot({ path: `${outDir}/cam-${i}-${st.cam}.png` });
    rows.push(st);
    await page.keyboard.press('c');
    await page.waitForTimeout(1200);
    // Guard: if anything remounted the page, wait for MONZA to come back.
    await page.waitForFunction(() => !!window.MONZA?.sim?.ready, null, { timeout: 30000 });
  }
  console.log(JSON.stringify({ rows, errors: errors.slice(0,5) }, null, 1));
} finally { await browser.close(); }
