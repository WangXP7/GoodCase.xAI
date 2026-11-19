import { setControlRate } from './audio-synthesis.js';

// js/audio-tropics.js
// Singapore's soundscape, synthesized like the rest of the city's audio (no samples):
// - the Asian koel ("uwu" bird): series of rising "ko-EL" whistles, each higher and more urgent than the last, from
//   somewhere among the trees; mostly by day, and now and then in the small hours
// - cicadas: a shrill pulsing chorus that swells and fades, loudest around dusk; crickets' chirps at night
// - thunderstorms: rain on the city, close cracks and long rolling rumbles, each arriving after its lightning flash by
//   the time sound takes to cover the distance (js/weather.js flashes)
// All of it ambient: stereo, quieter up in a helicopter, under the roar of traffic and inside the downtown canyons.

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

function randomSource(seed) {
  let s = (Math.floor(seed * 2654435761) >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// How loud each layer is for a time of day (js/lighting.js presets) — [koel calls per minute, cicadas, crickets]
const TIME_OF_DAY = {
  golden: { koel: 1.6, cicadas: 1, crickets: 0 },
  midday: { koel: 1.2, cicadas: 0.55, crickets: 0 },
  twilight: { koel: 0.7, cicadas: 0.85, crickets: 0.45 },
  midnight: { koel: 0.25, cicadas: 0, crickets: 1 }
};

// Seconds of noise for the cicadas, crickets, rain & thunder
function noiseBuffer(ctx, seconds, seed) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = randomSource(seed);
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  return buffer;
}

// A loop of the cicadas' buzz envelope: ~90 pulses a second in phrases of a few seconds, rising, holding, falling
function cicadaEnvelope(ctx, seconds, seed) {
  const rate = 3000; // (the lowest sample rate an AudioBuffer may have)
  const buffer = ctx.createBuffer(1, seconds * rate, rate);
  const data = buffer.getChannelData(0);
  const random = randomSource(seed);
  let t = 0;
  while (t < seconds) {
    const length = 2.5 + random() * 4;
    const gap = 0.4 + random() * 2.2;
    const pulse = 80 + random() * 30;
    for (let i = Math.floor(t * rate); i < Math.min(data.length, (t + length) * rate); i++) {
      const u = (i / rate - t) / length;
      const swell = Math.min(1, u / 0.25) * Math.min(1, (1 - u) / 0.15);
      const p = (i / rate) * pulse;
      data[i] = swell * (0.55 + 0.45 * Math.max(0, Math.sin(p * Math.PI * 2)));
    }
    t += length + gap;
  }
  return buffer;
}

// A loop of crickets' chirps: three or four quick pulses, then a pause
function cricketEnvelope(ctx, seconds, seed) {
  const rate = 3000;
  const buffer = ctx.createBuffer(1, seconds * rate, rate);
  const data = buffer.getChannelData(0);
  const random = randomSource(seed);
  for (let t = 0; t < seconds - 0.3;) {
    const pulses = 3 + Math.floor(random() * 2);
    for (let k = 0; k < pulses; k++) {
      const start = Math.floor((t + k * 0.045) * rate);
      for (let i = 0; i < 0.026 * rate; i++) data[start + i] = Math.sin((i / (0.026 * rate)) * Math.PI);
    }
    t += 0.42 + random() * 0.35;
  }
  return buffer;
}

// A layer: noise or a tone through a band-pass, its loudness driven by a looping envelope, panned
function pulsedBand(ctx, out, { source, frequency, q, envelope, rate = 1, pan, startOffset = 0 }) {
  const band = ctx.createBiquadFilter();
  setControlRate(band.frequency, band.detune, band.Q, band.gain);
  band.type = 'bandpass';
  band.frequency.value = frequency;
  band.Q.value = q;
  const vca = ctx.createGain();
  vca.gain.value = 0;
  const env = ctx.createBufferSource();
  env.buffer = envelope;
  env.loop = true;
  env.playbackRate.value = rate;
  env.connect(vca.gain);
  const level = ctx.createGain();
  level.gain.value = 0;
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  source.connect(band).connect(vca).connect(level).connect(panner).connect(out);
  env.start(ctx.currentTime, startOffset);
  return { level, nodes: [band, vca, env, level, panner], sources: [env] };
}

export function createTropicalAmbience(ctx, output) {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
  master.connect(output);
  const nodes = [master];
  const sources = [];
  const random = randomSource(7.31);
  let disposed = false;

  // shared noise
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 4, 3.7);
  noise.loop = true;
  noise.start();
  sources.push(noise);
  nodes.push(noise);

  // --- cicadas: three trees' worth, in different keys and places -------------------------------------------------------
  const cicadaEnv = cicadaEnvelope(ctx, 23, 11.3);
  const cicadas = [
    pulsedBand(ctx, master, { source: noise, frequency: 4300, q: 7, envelope: cicadaEnv, pan: -0.6 }),
    pulsedBand(ctx, master, { source: noise, frequency: 5600, q: 9, envelope: cicadaEnv, rate: 0.83, pan: 0.5, startOffset: 7.7 }),
    pulsedBand(ctx, master, { source: noise, frequency: 6900, q: 10, envelope: cicadaEnv, rate: 1.13, pan: 0.05, startOffset: 15.1 })
  ];
  // --- crickets: pure tones, chirping in turn --------------------------------------------------------------------------
  const cricketEnv = cricketEnvelope(ctx, 9, 5.9);
  const crickets = [4400, 4950].map((f, i) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    osc.start();
    sources.push(osc);
    nodes.push(osc);
    return pulsedBand(ctx, master, { source: osc, frequency: f, q: 2, envelope: cricketEnv, rate: i ? 1.07 : 1, pan: i ? 0.55 : -0.45, startOffset: i * 3.3 });
  });
  for (const layer of [...cicadas, ...crickets]) { nodes.push(...layer.nodes); sources.push(...layer.sources); }

  // --- rain: a wash of broadband noise and a nearer patter --------------------------------------------------------------
  const rainHigh = ctx.createBiquadFilter();
  rainHigh.type = 'highpass';
  rainHigh.frequency.value = 500;
  const rainLow = ctx.createBiquadFilter();
  rainLow.type = 'lowpass';
  rainLow.frequency.value = 7000;
  const rain = ctx.createGain();
  rain.gain.value = 0;
  const patterBand = ctx.createBiquadFilter();
  patterBand.type = 'bandpass';
  patterBand.frequency.value = 2600;
  patterBand.Q.value = 0.8;
  const patter = ctx.createGain();
  patter.gain.value = 0;
  // the patter flickers: noise read slowly as its loudness (1 +- 0.6), before its level
  const flickerVca = ctx.createGain();
  flickerVca.gain.value = 1;
  const flicker = ctx.createBufferSource();
  flicker.buffer = noiseBuffer(ctx, 3, 9.1);
  flicker.loop = true;
  flicker.playbackRate.value = 0.02;
  const flickerDepth = ctx.createGain();
  flickerDepth.gain.value = 0.6;
  flicker.connect(flickerDepth).connect(flickerVca.gain);
  flicker.start();
  noise.connect(rainHigh).connect(rainLow).connect(rain).connect(master);
  noise.connect(patterBand).connect(flickerVca).connect(patter).connect(master);
  sources.push(flicker);
  nodes.push(rainHigh, rainLow, rain, patterBand, flickerVca, patter, flicker, flickerDepth);
  for (const node of [rainHigh, rainLow, patterBand]) setControlRate(node.frequency, node.detune, node.Q, node.gain);

  // --- one-shots: koel calls and thunder, each disconnected when done ------------------------------------------------
  const oneShots = new Set();
  const track = (list, end) => {
    const shot = { list, end };
    oneShots.add(shot);
    return shot;
  };
  const reap = (now) => {
    for (const shot of oneShots) {
      if (now < shot.end) continue;
      for (const n of shot.list) n.disconnect();
      oneShots.delete(shot);
    }
  };

  // A koel's series: "ko-EL", "ko-EL", ... each a little higher, closer together, louder
  function koel(when, loudness) {
    const notes = 4 + Math.floor(random() * 5);
    const base = 560 + random() * 140;
    const panner = ctx.createStereoPanner();
    panner.pan.value = random() * 1.6 - 0.8;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600 - random() * 900; // further away, duller
    panner.connect(master);
    tone.connect(panner);
    const list = [panner, tone];
    let t = when;
    for (let k = 0; k < notes; k++) {
      const f = base * (1 + k * 0.055);
      const level = loudness * (0.45 + 0.55 * (k / Math.max(1, notes - 1)));
      // "ko": short, low; "EL": a whistle swooping up
      for (const [dt, len, f0, f1, g] of [[0, 0.11, f * 0.86, f * 0.9, 0.55], [0.15, 0.36, f * 0.92, f * 1.32, 1]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const gain = ctx.createGain();
        const t0 = t + dt;
        osc.frequency.setValueAtTime(f0, t0);
        osc.frequency.exponentialRampToValueAtTime(f1, t0 + len * 0.8);
        osc.frequency.linearRampToValueAtTime(f1 * 0.97, t0 + len);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(level * g * 0.09, t0 + 0.03);
        gain.gain.setValueAtTime(level * g * 0.09, t0 + len * 0.7);
        gain.gain.linearRampToValueAtTime(0, t0 + len);
        // a breathy second harmonic
        const h = ctx.createOscillator();
        h.type = 'sine';
        h.frequency.setValueAtTime(f0 * 2, t0);
        h.frequency.exponentialRampToValueAtTime(f1 * 2, t0 + len * 0.8);
        const hg = ctx.createGain();
        hg.gain.value = 0.12;
        osc.connect(gain);
        h.connect(hg).connect(gain);
        gain.connect(tone);
        osc.start(t0); osc.stop(t0 + len + 0.02);
        h.start(t0); h.stop(t0 + len + 0.02);
        list.push(osc, h, hg, gain);
      }
      t += 0.78 - k * 0.045;
    }
    track(list, t + 0.5);
  }

  // Thunder `distance` m away, its flash now: a crack when it's close, then a rumble rolling for seconds
  function thunder(distance) {
    if (disposed) return;
    const now = ctx.currentTime;
    const d = clamp(finite(distance, 2000), 200, 9000);
    const when = now + d / 343;
    const near = clamp(1 - d / 2500);
    const length = 3.5 + (d / 9000) * 5 + random() * 2;
    const src = ctx.createBufferSource();
    src.buffer = noise.buffer;
    src.loop = true;
    src.playbackRate.value = 0.45;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(180 + near * 900, when);
    low.frequency.exponentialRampToValueAtTime(70, when + length);
    const gain = ctx.createGain();
    const peak = 0.55 * (0.35 + 0.65 * (1 - d / 9000));
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak * (near > 0.4 ? 1 : 0.5), when + (near > 0.4 ? 0.03 : 0.4));
    // the roll: a few swells as the sound comes in from further along the bolt
    let t = when + 0.3;
    while (t < when + length - 0.6) {
      gain.gain.linearRampToValueAtTime(peak * (0.25 + random() * 0.6), t);
      t += 0.35 + random() * 0.8;
    }
    gain.gain.linearRampToValueAtTime(0, when + length);
    src.connect(low).connect(gain).connect(master);
    src.start(when, random() * 3);
    src.stop(when + length + 0.05);
    const list = [src, low, gain];
    if (near > 0.3) {
      // the crack of a close strike
      const crack = ctx.createBufferSource();
      crack.buffer = noise.buffer;
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 900;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0, when);
      cg.gain.linearRampToValueAtTime(0.5 * near, when + 0.006);
      cg.gain.exponentialRampToValueAtTime(0.001, when + 0.5);
      crack.connect(high).connect(cg).connect(master);
      crack.start(when, random() * 3);
      crack.stop(when + 0.55);
      list.push(crack, high, cg);
    }
    track(list, when + length + 0.2);
  }

  const smooth = (param, value, now, tc) => {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, tc);
  };
  let nextKoel = ctx.currentTime + 4 + random() * 6;
  return {
    thunder,
    // `time`: the lighting preset id; `storm` 0..1; `altitude` (m); `enclosure` 0..1 (js/audio-acoustics.js); `traffic`
    update({ time = 'golden', storm = 0, altitude = 0, enclosure = 0, traffic = 0 } = {}, now = ctx.currentTime) {
      if (disposed) return;
      reap(now);
      const tod = TIME_OF_DAY[time] || TIME_OF_DAY.golden;
      const wet = clamp(storm);
      // wildlife is down in the trees: further away up in the air, muffled by the canyons and the traffic, and hushed
      // by the rain (the cicadas stop, the birds wait it out)
      const ground = 1 - clamp(altitude / 160);
      const wild = ground * (1 - clamp(enclosure) * 0.55) * (1 - clamp(traffic) * 0.35) * (1 - wet * 0.9);
      for (const layer of cicadas) smooth(layer.level.gain, 0.12 * tod.cicadas * wild, now, 1.5);
      for (const layer of crickets) smooth(layer.level.gain, 0.05 * tod.crickets * wild, now, 1.5);
      smooth(rain.gain, 0.11 * wet * (0.6 + 0.4 * ground), now, 1.2);
      smooth(patter.gain, 0.05 * wet * ground * (1 - clamp(altitude / 40) * 0.8), now, 1.2);
      if (now >= nextKoel) {
        const perMinute = tod.koel * (1 - wet);
        if (perMinute > 0 && wild > 0.15) koel(now + 0.05, wild);
        // the next series in about 60 / rate seconds, with some spread
        nextKoel = now + (perMinute > 0 ? (60 / perMinute) * (0.5 + random()) : 20);
      }
    },
    dispose(immediate = false) {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.02);
      const stop = immediate || ctx.state !== 'running' ? 0 : 0.1;
      for (const s of sources) { try { s.stop(now + stop); } catch { /* not started */ } }
      for (const shot of oneShots) for (const n of shot.list) { try { n.stop?.(now + stop); } catch { /* ended */ } }
      const disconnect = () => {
        for (const n of nodes) n.disconnect();
        for (const shot of oneShots) for (const n of shot.list) n.disconnect();
        oneShots.clear();
      };
      if (stop) setTimeout(disconnect, 200);
      else disconnect();
    }
  };
}

export { TIME_OF_DAY };
