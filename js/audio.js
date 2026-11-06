// Tiny synthesized foley — no audio files to download.
// pour (continuous, rate-driven), lid click, sleeve slide, pop, thud, chime.

let ac = null, master = null, noiseBuf = null, pourNode = null, slideNode = null;
let muted = false;
try { muted = localStorage.getItem('sw:muted') === '1'; } catch {}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('sw:muted', m ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05);
}

// Must be called from a user gesture (iOS).
export function unlock() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ac.destination);
  const len = ac.sampleRate * 2;
  noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 2.5; }
}

function noise(loop = true) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = loop; return s;
}

function burst({ freq = 2000, q = 1, dur = 0.05, gain = 0.4, type = 'bandpass', at = 0 }) {
  if (!ac) return;
  const t = ac.currentTime + at, n = noise(false), f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(g).connect(master);
  n.start(t, Math.random()); n.stop(t + dur + 0.02);
}

function tone({ freq = 440, dur = 0.3, gain = 0.15, type = 'sine', at = 0, slide = 0 }) {
  if (!ac) return;
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}

// Continuous pour: band-passed noise + low "glug" modulation.
// rate 0..1; fill 0..1 raises pitch as the cup fills (like the real thing).
export function pour(rate, fill = 0, intoCup = true) {
  if (!ac) return;
  if (!pourNode) {
    const n = noise(), f = ac.createBiquadFilter(), f2 = ac.createBiquadFilter(), g = ac.createGain();
    const lfo = ac.createOscillator(), lg = ac.createGain();
    f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.value = 900;
    f2.type = 'lowpass'; f2.frequency.value = 3500;
    lfo.frequency.value = 7; lg.gain.value = 220; lfo.connect(lg).connect(f.frequency);
    g.gain.value = 0;
    n.connect(f).connect(f2).connect(g).connect(master);
    n.start(); lfo.start();
    pourNode = { f, g, lfo };
  }
  const t = ac.currentTime;
  pourNode.g.gain.setTargetAtTime(rate * 0.32, t, 0.04);
  pourNode.f.frequency.setTargetAtTime(intoCup ? 500 + fill * 1400 : 1600, t, 0.08);
  pourNode.lfo.frequency.setTargetAtTime(5 + rate * 6, t, 0.1);
}

// Sleeve: paper friction, gain follows speed.
export function slide(speed) {
  if (!ac) return;
  if (!slideNode) {
    const n = noise(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 0.7; g.gain.value = 0;
    n.connect(f).connect(g).connect(master); n.start();
    slideNode = { f, g };
  }
  const s = Math.min(1, speed);
  slideNode.g.gain.setTargetAtTime(s * 0.22, ac.currentTime, 0.03);
  slideNode.f.frequency.setTargetAtTime(1800 + s * 1800, ac.currentTime, 0.05);
}

export function lidClick() {
  burst({ freq: 3200, q: 4, dur: 0.035, gain: 0.55 });
  burst({ freq: 1500, q: 3, dur: 0.05, gain: 0.35, at: 0.028 });
  tone({ freq: 210, dur: 0.08, gain: 0.12, type: 'triangle', at: 0.01, slide: 0.6 });
}
export function pop() { burst({ freq: 900, q: 2, dur: 0.06, gain: 0.35 }); tone({ freq: 520, dur: 0.07, gain: 0.08, slide: 1.6 }); }
export function sleeveSeat() { burst({ freq: 700, q: 1, dur: 0.12, gain: 0.25, type: 'lowpass' }); }
export function thud(v = 1) { tone({ freq: 110, dur: 0.12, gain: 0.18 * v, type: 'sine', slide: 0.5 }); burst({ freq: 400, q: 1, dur: 0.05, gain: 0.15 * v, type: 'lowpass' }); }
export function splash() { burst({ freq: 1800, q: 0.8, dur: 0.09, gain: 0.12 }); }
export function chime() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ freq: f, dur: 0.9, gain: 0.07, type: 'sine', at: i * 0.07 }));
}
export function tick() { tone({ freq: 1800, dur: 0.025, gain: 0.04, type: 'square' }); }

export function haptic(ms = 10) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }
