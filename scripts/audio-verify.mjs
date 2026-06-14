import { chromium } from 'playwright';

const URL = (process.env.SHOT_URL || 'http://localhost:3001');
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text()); });

await page.goto(URL, { waitUntil: 'load' });

const result = await page.evaluate(async () => {
  const { EngineAudio } = await import('/src/audio/EngineAudio.ts');
  const SR = 44100;

  const wheel = (o = {}) => ({ id:'frontLeft', loadN:3500, slipRatio:0, slipAngleRad:0, camberRad:0, toeRad:0, fx:0, fy:0, fz:0, mz:0, suspensionTravel:0, angularVelocity:0, contactPoint:[0,0,0], forceWorld:[0,0,0], tireSurfaceTempC:80, tireCarcassTempC:80, tireWear:0, tireMuScale:1, brakeTempC:40, brakeFade:1, surfaceMaterialId:'asphalt_new', contact:true, ...o });
  const frame = (o = {}) => ({ time:0, speedMps:0, yawRate:0, sideslipRad:0, steeringAngleRad:0, rpm:900, gear:1, throttle:0, brake:0, simFrameMs:1,
    wheels:{ frontLeft:wheel(o.w), frontRight:wheel(o.w), rearLeft:wheel(o.w), rearRight:wheel(o.w) }, ...o });

  // Steady-state render: prime params with a few update() calls, then render `dur`s.
  // No suspend/resume (which can hang offline). For transients, pass a `pulse` fn that
  // is invoked once at the start of rendering via a primed update sequence.
  async function render(dur, frameObj, { primeSteps = 12, pulse = null } = {}) {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * dur), SR);
    const audio = new EngineAudio();
    audio.startOffline(ctx);
    const dt = 1/60;
    // Prime so setTargetAtTime values converge before/at t=0.
    for (let i = 0; i < primeSteps; i++) audio.update(frameObj, dt);
    if (pulse) pulse(audio); // e.g. fire a one-off transient at t=0
    const buf = await ctx.startRendering();
    return buf.getChannelData(0);
  }

  const peak = (x, from=0, to=x.length) => { let m=0; for(let i=from;i<to;i++){ const a=Math.abs(x[i]); if(a>m)m=a; } return m; };
  const rms = (x, from=0, to=x.length) => { let s=0; for(let i=from;i<to;i++) s+=x[i]*x[i]; return Math.sqrt(s/(to-from)); };
  const hasNaN = (x) => { for(let i=0;i<x.length;i++) if(!Number.isFinite(x[i])) return true; return false; };
  function goertzel(x, f, from, to){ const w=2*Math.PI*f/SR, c=2*Math.cos(w); let s1=0,s2=0,s0; for(let i=from;i<to;i++){ s0=x[i]+c*s1-s2; s2=s1; s1=s0; } return Math.sqrt(s1*s1+s2*s2-c*s1*s2)/(to-from); }
  function dominantLowFreq(x, from, to){ let bf=0,bp=0; for(let f=24;f<=720;f+=2){ const p=goertzel(x,f,from,to); if(p>bp){bp=p;bf=f;} } return { f:bf, p:bp }; }
  // measure harmonic structure at a known firing freq: levels at orders 1..6
  function orderLevels(x, firing, from, to){ const o={}; for(const k of [0.5,1,2,3,4,5,6]) o[k]=+goertzel(x,firing*k,from,to).toFixed(5); return o; }

  const out = {};
  const back = (n) => [Math.floor(n*0.55), n];

  // 1. IDLE rpm 900 -> firing 60 Hz.
  {
    const x = await render(0.9, frame({ rpm:900, throttle:0 }));
    const [a,b] = back(x.length);
    const dom = dominantLowFreq(x, a, b);
    out.idle = { dominantHz: Math.round(dom.f), expectedHz: 60, orders: orderLevels(x, 60, a, b), peak:+peak(x).toFixed(3), rms:+rms(x,a,b).toFixed(4), nan:hasNaN(x) };
  }

  // 2. SWEEP via discrete steady renders: dominant freq must rise with rpm.
  {
    const doms = [];
    for (const rpm of [900, 2500, 4500, 7000]) {
      const x = await render(0.8, frame({ rpm, throttle:1, speedMps: rpm/250 }));
      const [a,b] = back(x.length);
      doms.push({ rpm, expectedFiring: Math.round(rpm/15), dominantHz: Math.round(dominantLowFreq(x,a,b).f) });
    }
    const rising = doms.every((d,i)=> i===0 || d.dominantHz > doms[i-1].dominantHz);
    out.sweep = { points: doms, rises: rising };
  }

  // 3. WIND: high-speed coast vs idle. Expect louder + real high-band energy.
  {
    const idle = await render(0.8, frame({ rpm:900, throttle:0, speedMps:0 }));
    const cruise = await render(0.8, frame({ rpm:1200, throttle:0, speedMps:70 }));
    const [a,b] = back(cruise.length);
    out.wind = { idleRms:+rms(idle).toFixed(4), cruiseRms:+rms(cruise,a,b).toFixed(4),
      louderThanIdle: rms(cruise,a,b) > rms(idle)*1.4,
      highBand3k:+goertzel(cruise,3000,a,b).toFixed(5), nan:hasNaN(cruise) };
  }

  // 4. ON-POWER vs OVERRUN timbre at same rpm: power should be brighter (more 4th order).
  {
    const power = await render(0.7, frame({ rpm:4000, throttle:1.0 }));
    const over  = await render(0.7, frame({ rpm:4000, throttle:0.0, speedMps:30 }));
    const [a,b] = back(power.length); const fir = Math.round(4000/15);
    out.loadTimbre = { firing:fir, power4th:+goertzel(power,fir*4,a,b).toFixed(5), overrun4th:+goertzel(over,fir*4,a,b).toFixed(5),
      powerBrighter: goertzel(power,fir*4,a,b) > goertzel(over,fir*4,a,b) };
  }

  // 5. BUMP transient: prime calm, then a travel spike at t=0; expect early-buffer peak.
  {
    const calm = frame({ rpm:1000, throttle:0, speedMps:10 });
    const x = await render(0.6, calm, { pulse: (audio) => {
      // one big-compression frame then release, simulating an impact edge.
      audio.update(frame({ rpm:1000, throttle:0, speedMps:10, w:{ suspensionTravel:0.06 } }), 1/60);
    }});
    const n = x.length;
    out.bump = { earlyPeak:+peak(x, 0, (n*0.25)|0).toFixed(4), latePeak:+peak(x,(n*0.6)|0,n).toFixed(4),
      transientFired: peak(x,0,(n*0.25)|0) > peak(x,(n*0.6)|0,n)*1.3, nan:hasNaN(x) };
  }

  // 6. CLIP check on a loud everything-on scenario.
  {
    const x = await render(1.0, frame({ rpm:6000, throttle:1, speedMps:60, w:{ slipRatio:0.9 } }));
    out.loud = { peak:+peak(x).toFixed(3), clips: peak(x) > 1.001, rms:+rms(x).toFixed(4), nan:hasNaN(x) };
  }

  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
