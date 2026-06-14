import { chromium } from '@playwright/test';

const URL = process.argv[2] ?? 'http://127.0.0.1:3000/?e2e=1';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(400);

const result = await page.evaluate(async () => {
  const { EngineAudio } = await import('/src/audio/EngineAudio.ts');
  const ctx = new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const audio = new EngineAudio();
  audio.startOffline(ctx); // builds graph in realtime ctx (loads samples + scrub loop)

  const wheel = (slip) => ({ id:'frontLeft', loadN:3500, slipRatio:slip, slipAngleRad:slip, suspensionTravel:0, contact:true,
    tireSurfaceTempC:80, tireMuScale:1, brakeTempC:40, surfaceMaterialId:'asphalt_new' });
  const frame = (rpm, throttle, slip, speed) => ({ time:0, speedMps:speed, yawRate:0, sideslipRad:0, steeringAngleRad:0,
    rpm, gear:3, throttle, brake:0, simFrameMs:1,
    wheels:{ frontLeft:wheel(slip), frontRight:wheel(slip), rearLeft:wheel(slip), rearRight:wheel(slip) } });

  // Wait for the scrub loop to load.
  let ready = false;
  for (let i = 0; i < 60; i++) {
    audio.update(frame(2000, 0.2, 0, 20), 1/60);
    // @ts-ignore private probe
    ready = audio.scrubSampleReady ?? false;
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const probe = () => ({
    // @ts-ignore private
    sampleGain: +(audio.scrubSampleGain?.gain.value ?? -1).toFixed(4),
    // @ts-ignore private
    sampleDetune: Math.round(audio.scrubSampleSrc?.detune.value ?? 0),
    // @ts-ignore private
    fallback: +audio.scrubFallbackGain.toFixed(3),
  });

  // No slip: squeal should be silent.
  for (let i=0;i<30;i++) audio.update(frame(2000, 0.2, 0.0, 20), 1/60);
  await new Promise((r)=>setTimeout(r,150));
  const noSlip = probe();

  // Heavy slide at speed: squeal should be loud.
  for (let i=0;i<30;i++) audio.update(frame(4000, 0.0, 0.8, 25), 1/60);
  await new Promise((r)=>setTimeout(r,150));
  const bigSlip = probe();

  // Same slip but crawling: speed gate should keep it quiet.
  for (let i=0;i<30;i++) audio.update(frame(1000, 0.0, 0.8, 0.5), 1/60);
  await new Promise((r)=>setTimeout(r,150));
  const slowSlip = probe();

  return {
    scrubReady: ready,
    noSlip, bigSlip, slowSlip,
    loudWhenSliding: bigSlip.sampleGain > 0.1,
    silentWhenGripping: noSlip.sampleGain < 0.02,
    quietWhenCrawling: slowSlip.sampleGain < bigSlip.sampleGain * 0.5,
    synthFadedOut: bigSlip.fallback < 0.1,
  };
});

console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('ERRORS:', errors); else console.log('no console/page errors');
await browser.close();
