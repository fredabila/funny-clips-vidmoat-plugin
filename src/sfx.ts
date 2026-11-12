/**
 * Comedy sound effects, synthesised from scratch so there is nothing to
 * license: every sample is computed here. Output is 44.1 kHz 16-bit mono WAV.
 */

const RATE = 44100;

export interface SfxInfo {
  name: string;
  description: string;
  seconds: number;
}

type Gen = () => Float32Array;

const TAU = Math.PI * 2;

function buf(seconds: number) {
  return new Float32Array(Math.round(seconds * RATE));
}

/** Deterministic noise so the same effect is byte-identical every time. */
function noiseGen(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff * 2 - 1;
  };
}

function env(t: number, attack: number, decay: number) {
  return t < attack ? t / attack : Math.exp(-(t - attack) / decay);
}

function saw(phase: number) {
  return 2 * (phase - Math.floor(phase + 0.5));
}

function normalize(b: Float32Array, peak = 0.9) {
  let m = 0;
  for (const v of b) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < b.length; i++) b[i] = (b[i] / m) * peak;
  return b;
}

/** Simple one-pole low-pass, in place. */
function lowpass(b: Float32Array, cutoffHz: number) {
  const a = 1 - Math.exp((-TAU * cutoffHz) / RATE);
  let y = 0;
  for (let i = 0; i < b.length; i++) b[i] = y += a * (b[i] - y);
  return b;
}

const boom: Gen = () => {
  // Deep pitch-dropping thud with a soft-clipped body: the "dramatic boom".
  const b = buf(1.6);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / RATE;
    const f = 40 + 110 * Math.exp(-t * 9);
    ph += f / RATE;
    const body = Math.sin(TAU * ph) + 0.4 * Math.sin(TAU * ph * 2);
    b[i] = Math.tanh(2.5 * body) * env(t, 0.004, 0.45);
  }
  return normalize(b);
};

const sadTrombone: Gen = () => {
  // Four descending "wah" notes, the last one long with vibrato.
  const notes = [
    { f: 233.08, d: 0.42 },
    { f: 220.0, d: 0.42 },
    { f: 207.65, d: 0.42 },
    { f: 196.0, d: 1.3 },
  ];
  const total = notes.reduce((s, n) => s + n.d, 0);
  const b = buf(total + 0.1);
  let i = 0;
  let ph = 0;
  for (const [k, n] of notes.entries()) {
    const len = Math.round(n.d * RATE);
    for (let j = 0; j < len; j++, i++) {
      const t = j / RATE;
      const vib = k === 3 ? 1 + 0.025 * Math.sin(TAU * 5.5 * t) * Math.min(1, t * 2) : 1;
      const f = n.f * (1 - 0.03 * Math.exp(-t * 20)) * vib;
      ph += f / RATE;
      const wah = 0.55 + 0.45 * Math.sin(Math.min(Math.PI, (t / n.d) * Math.PI)); // swell per note
      const tone = saw(ph) * 0.6 + Math.sin(TAU * ph) * 0.4;
      const fade = k === 3 ? Math.min(1, (n.d - t) / 0.4) : Math.min(1, (n.d - t) / 0.03);
      b[i] = tone * wah * Math.min(1, t / 0.02) * fade;
    }
  }
  return normalize(lowpass(b, 1800));
};

const recordScratch: Gen = () => {
  // Filtered noise whose "playback speed" swings back and forth, then stops.
  const b = buf(0.75);
  const n = noiseGen(7);
  let lp = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / RATE;
    const speed = Math.abs(Math.sin(TAU * 3.2 * t)) * (t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 4));
    const a = 0.02 + 0.35 * speed;
    lp += a * (n() - lp);
    const tone = Math.sin(TAU * (300 + 900 * speed) * t) * 0.3;
    b[i] = (lp * 3 + tone * speed) * Math.min(1, t / 0.005);
  }
  return normalize(b);
};

const ding: Gen = () => {
  // Bell: inharmonic partials with long decays.
  const b = buf(1.8);
  const partials = [
    [1, 1, 0.9],
    [2.76, 0.5, 0.5],
    [5.4, 0.25, 0.25],
    [8.93, 0.12, 0.12],
  ];
  for (let i = 0; i < b.length; i++) {
    const t = i / RATE;
    let s = 0;
    for (const [m, a, d] of partials) s += a * Math.sin(TAU * 1046.5 * m * t) * Math.exp(-t / d);
    b[i] = s * Math.min(1, t / 0.002);
  }
  return normalize(b, 0.8);
};

const whoosh: Gen = () => {
  // Noise through a swept resonant band-pass, swelling and fading.
  const b = buf(0.9);
  const n = noiseGen(3);
  let lo = 0;
  let bp = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / RATE;
    const f = 300 + 2700 * Math.sin(Math.PI * (t / 0.9));
    const fc = 2 * Math.sin((Math.PI * f) / RATE);
    const hi = n() - lo - 0.4 * bp;
    bp += fc * hi;
    lo += fc * bp;
    b[i] = bp * Math.sin(Math.PI * (t / 0.9)) ** 2;
  }
  return normalize(b, 0.8);
};

const crickets: Gen = () => {
  // Chirps: trains of short high pulses, two "crickets" slightly out of step.
  const b = buf(3.0);
  for (const [f, offset] of [
    [4400, 0],
    [4100, 0.37],
  ]) {
    for (let start = offset; start < 2.8; start += 0.75) {
      for (let p = 0; p < 4; p++) {
        const s0 = start + p * 0.045;
        const len = Math.round(0.03 * RATE);
        const i0 = Math.round(s0 * RATE);
        for (let j = 0; j < len && i0 + j < b.length; j++) {
          const t = j / RATE;
          b[i0 + j] += Math.sin(TAU * f * t) * Math.sin((Math.PI * j) / len) * 0.5;
        }
      }
    }
  }
  return normalize(b, 0.6);
};

const rimshot: Gen = () => {
  // "Ba-dum-tss": two toms then a cymbal.
  const b = buf(1.6);
  const n = noiseGen(11);
  const hit = (at: number, f0: number, f1: number) => {
    let ph = 0;
    const i0 = Math.round(at * RATE);
    for (let j = 0; j < 0.3 * RATE && i0 + j < b.length; j++) {
      const t = j / RATE;
      ph += (f1 + (f0 - f1) * Math.exp(-t * 25)) / RATE;
      b[i0 + j] += Math.sin(TAU * ph) * Math.exp(-t / 0.08) + n() * 0.15 * Math.exp(-t / 0.01);
    }
  };
  hit(0, 260, 160);
  hit(0.2, 200, 110);
  const i0 = Math.round(0.42 * RATE);
  let prev = 0;
  for (let j = 0; i0 + j < b.length; j++) {
    const t = j / RATE;
    const x = n();
    const hp = x - prev; // crude high-pass for the cymbal sizzle
    prev = x;
    b[i0 + j] += hp * 0.5 * Math.exp(-t / 0.35);
  }
  return normalize(b);
};

const airhorn: Gen = () => {
  // Three bursts of a detuned sawtooth chord, the last one held.
  const b = buf(1.9);
  const bursts = [
    [0, 0.18],
    [0.25, 0.18],
    [0.5, 1.3],
  ];
  const freqs = [466, 470, 587, 592, 698];
  for (const [at, d] of bursts) {
    const i0 = Math.round(at * RATE);
    const len = Math.round(d * RATE);
    for (let j = 0; j < len; j++) {
      const t = j / RATE;
      let s = 0;
      for (const f of freqs) s += saw(f * t * (1 - 0.02 * Math.exp(-t * 30)));
      b[i0 + j] += Math.tanh(s * 0.6) * Math.min(1, t / 0.01) * Math.min(1, (d - t) / 0.03);
    }
  }
  return normalize(lowpass(b, 5000));
};

const suspense: Gen = () => {
  // "Dun dun duuun": three low brass-ish stabs, the last held and falling.
  const b = buf(2.6);
  const stabs = [
    { at: 0, f: 146.83, d: 0.3 },
    { at: 0.4, f: 138.59, d: 0.3 },
    { at: 0.8, f: 110.0, d: 1.7 },
  ];
  for (const s of stabs) {
    const i0 = Math.round(s.at * RATE);
    let ph = 0;
    for (let j = 0; j < s.d * RATE && i0 + j < b.length; j++) {
      const t = j / RATE;
      ph += (s.f * (s.d > 1 ? 1 - 0.04 * (t / s.d) : 1)) / RATE;
      const tone = saw(ph) * 0.5 + saw(ph * 1.005) * 0.5 + Math.sin(TAU * ph * 0.5) * 0.6;
      b[i0 + j] += tone * Math.min(1, t / 0.015) * Math.min(1, (s.d - t) / (s.d > 1 ? 0.6 : 0.05));
    }
  }
  return normalize(lowpass(b, 1400));
};

const pop: Gen = () => {
  const b = buf(0.25);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / RATE;
    ph += (400 + 1400 * Math.exp(-t * 60)) / RATE;
    b[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.04);
  }
  return normalize(b, 0.8);
};

const GENERATORS: Record<string, { gen: Gen; description: string }> = {
  boom: { gen: boom, description: "Deep dramatic boom for a reveal, a stare or a punchline." },
  sad_trombone: { gen: sadTrombone, description: "Descending wah-wah-wah-waaah for a fail." },
  record_scratch: { gen: recordScratch, description: "Record scratch: everything stops, often before 'yep, that's me'." },
  ding: { gen: ding, description: "Bright bell ding for an idea, a correct answer or a price." },
  whoosh: { gen: whoosh, description: "Air whoosh for a transition, a time skip or someone leaving." },
  crickets: { gen: crickets, description: "Crickets chirping over an awkward silence." },
  rimshot: { gen: rimshot, description: "Ba-dum-tss after a bad joke." },
  airhorn: { gen: airhorn, description: "Air-horn blasts for hype or a win." },
  suspense: { gen: suspense, description: "Dun-dun-duuun dramatic sting." },
  pop: { gen: pop, description: "Short cartoon pop for a text or sticker appearing." },
};

export const SFX_NAMES = Object.keys(GENERATORS);

export function listSfx(): SfxInfo[] {
  return SFX_NAMES.map((name) => ({
    name,
    description: GENERATORS[name].description,
    seconds: Math.round((renderSfx(name)!.length - 44) / 2 / RATE * 100) / 100,
  }));
}

const cache = new Map<string, Buffer>();

/** Returns a WAV file, or null for an unknown name. */
export function renderSfx(name: string): Buffer | null {
  const g = GENERATORS[name];
  if (!g) return null;
  let wav = cache.get(name);
  if (!wav) {
    wav = toWav(g.gen());
    cache.set(name, wav);
  }
  return wav;
}

function toWav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
