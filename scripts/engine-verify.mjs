import { chromium } from '@playwright/test';

const URL = process.argv[2] ?? 'http://127.0.0.1:3000/?e2e=1';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(600);

const result = await page.evaluate(async () => {
  const { EngineAudio } = await import('/src/audio/EngineAudio.ts');
  const ctx = new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  // Tap EngineAudio's realtime graph through an analyser instead of the speakers.
  const audio = new EngineAudio();
  audio.startOffline(ctx); // builds the graph in this (realtime) ctx, returns master
  // startOffline only builds synth; sample load needs a realtime path. Rebuild via tryStart-like:
  // Instead, drive update() which lazy-starts on first call for the real path.

  const wheel = () => ({ id:'frontLeft', loadN:3500, slipRatio:0, slipAngleRad:0, suspensionTravel:0, contact:true,
    tireSurfaceTempC:80, tireMuScale:1, brakeTempC:40, surfaceMaterialId:'asphalt_new' });
  const frame = (rpm, throttle) => ({ time:0, speedMps: rpm/250, yawRate:0, sideslipRad:0, steeringAngleRad:0,
    rpm, gear:3, throttle, brake:0, simFrameMs:1,
    wheels:{ frontLeft:wheel(), frontRight:wheel(), rearLeft:wheel(), rearRight:wheel() } });

  // Wait for sample buffers to load (poll up to 6s).
  let ready = false;
  for (let i = 0; i < 60; i++) {
    audio.update(frame(900, 0), 1/60);
    // @ts-ignore private probe
    ready = audio.sampleEngine?.isReady?.() ?? false;
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Measure dominant low frequency at several rpm by Goertzel on an analyser tap.
  function goertzel(buf, f, sr) { const w=2*Math.PI*f/sr, c=2*Math.cos(w); let s1=0,s2=0,s0;
    for (let i=0;i<buf.length;i++){ s0=buf[i]+c*s1-s2; s2=s1; s1=s0; } return Math.sqrt(s1*s1+s2*s2-c*s1*s2)/buf.length; }
  function dominant(buf, sr){ let bf=0,bp=0; for(let f=30;f<=900;f+=3){ const p=goertzel(buf,f,sr); if(p>bp){bp=p;bf=f;} } return {f:bf,p:bp}; }

  // Use a ScriptProcessor-free capture: render a short window via analyser time-domain.
  const sr = ctx.sampleRate;
  async function capture(rpm, throttle) {
    // prime the mix
    for (let i=0;i<20;i++) audio.update(frame(rpm, throttle), 1/60);
    await new Promise((r)=>setTimeout(r, 120));
    const an = ctx.createAnalyser(); an.fftSize = 16384;
    // tap master: EngineAudio connects master->compressor->destination; re-tap via destination is hard.
    // Instead expose master through startOffline's return — already connected to destination.
    // We connect analyser in parallel by grabbing the master node.
    // @ts-ignore private
    const master = audio.master; master.connect(an);
    const td = new Float32Array(an.fftSize);
    await new Promise((r)=>setTimeout(r, 60));
    an.getFloatTimeDomainData(td);
    master.disconnect(an);
    let rms=0; for(const v of td) rms+=v*v; rms=Math.sqrt(rms/td.length);
    return { dom: dominant(td, sr), rms:+rms.toFixed(4) };
  }

  const idle = await capture(900, 0.0);
  const mid = await capture(3500, 1.0);
  const high = await capture(7200, 1.0);

  return {
    sampleReady: ready,
    sampleRate: sr,
    idle: { rpm:900, dominantHz: Math.round(idle.dom.f), rms: idle.rms },
    mid: { rpm:3500, dominantHz: Math.round(mid.dom.f), rms: mid.rms },
    high: { rpm:7200, dominantHz: Math.round(high.dom.f), rms: high.rms },
    risesWithRpm: idle.dom.f < mid.dom.f && mid.dom.f <= high.dom.f,
  };
});

console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('ERRORS:', errors);
await browser.close();
