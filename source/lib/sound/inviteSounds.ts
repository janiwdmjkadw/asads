// Slice "Invite code modal": the modal's voice. Same synthesized ASMR
// family as `mosaicChime.ts` (sine body + barely-detuned octave partial
// + band-passed noise tick, whisper-quiet master), but shaped for
// typing: every letter seats with a click-chime that walks UP a
// pentatonic scale across the code, backspace steps back down, a wrong
// code lands a soft low buzz, and a correct one fires a fast ascending
// arpeggio that resolves on a deep root.
//
// No audio assets — pure Web Audio. Letter sounds fire inside keyboard
// events (a user gesture), so a suspended context may be resumed; if it
// cannot run promptly we stay silent rather than play late.
//
// NOT gated on prefers-reduced-motion: every sound here is direct
// feedback to an explicit user action (a keystroke, a click, a code
// THEY submitted). Reduced motion is about unexpected MOVEMENT — with
// it on, the visuals still (see the CSS) but the interaction must
// never go dead-silent, which read as "the button is broken".

let sharedCtx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedCtx) return sharedCtx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
  } catch {
    return null;
  }
  return sharedCtx;
}

/** C-major pentatonic — overlapping fast typing always harmonizes. */
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
const ROOT = 130.81; // C3

/**
 * Run `fn` against a running AudioContext. Called from user gestures
 * (keystrokes), so we attempt one resume; if the context does not
 * unblock within 300ms the sound is dropped (never played late).
 */
function withRunningCtx(fn: (ac: AudioContext) => void): void {
  const ac = audioCtx();
  if (!ac) return;
  if (ac.state === 'running') {
    fn(ac);
    return;
  }
  const askedAt = performance.now();
  void ac
    .resume()
    .then(() => {
      if (ac.state === 'running' && performance.now() - askedAt < 300) fn(ac);
    })
    .catch(() => undefined);
}

function chime(
  ac: AudioContext,
  t: number,
  freq: number,
  gain: number,
  tail: number,
): void {
  const master = ac.createGain();
  master.gain.value = 0.5;
  master.connect(ac.destination);
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const partial = ac.createOscillator();
  partial.type = 'sine';
  partial.frequency.value = freq * 2.003;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + tail);
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0, t);
  g2.gain.linearRampToValueAtTime(gain * 0.3, t + 0.008);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + tail * 0.7);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  osc.connect(g);
  partial.connect(g2);
  g.connect(lp);
  g2.connect(lp);
  lp.connect(master);
  osc.start(t);
  osc.stop(t + tail + 0.1);
  partial.start(t);
  partial.stop(t + tail * 0.7 + 0.1);
}

function seatTick(ac: AudioContext, t: number, level = 0.016): void {
  const dur = 0.045;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(level, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2100;
  bp.Q.value = 1.3;
  noise.connect(bp);
  bp.connect(ng);
  ng.connect(ac.destination);
  noise.start(t);
  noise.stop(t + dur);
}

/** A letter seats: click + a pentatonic note that climbs with position. */
export function playLetterTick(index: number): void {
  withRunningCtx((ac) => {
    const t = ac.currentTime;
    chime(ac, t, SCALE[Math.min(index, SCALE.length - 1)]!, 0.045, 0.55);
    seatTick(ac, t);
  });
}

/** A letter is removed: the same voice, one step back down, softer. */
export function playBackTick(index: number): void {
  withRunningCtx((ac) => {
    const t = ac.currentTime;
    chime(ac, t, SCALE[Math.max(0, Math.min(index, SCALE.length - 1))]! * 0.5, 0.028, 0.35);
    seatTick(ac, t, 0.01);
  });
}

/** Wrong code: a soft, low double-thud. Disappointment, not alarm. */
export function playErrorBuzz(): void {
  withRunningCtx((ac) => {
    const t = ac.currentTime;
    const thud = (at: number) => {
      const osc = ac.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, at);
      osc.frequency.exponentialRampToValueAtTime(72, at + 0.16);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.05, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      osc.connect(g);
      g.connect(lp);
      lp.connect(ac.destination);
      osc.start(at);
      osc.stop(at + 0.3);
    };
    thud(t);
    thud(t + 0.14);
  });
}

/**
 * Owl shockwave (click): one soft sub-bass swell — felt more than
 * heard. Fired from a click, so the gesture-resume path applies.
 */
export function playThoom(): void {
  withRunningCtx((ac) => {
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(88, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.5);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    osc.connect(g);
    g.connect(lp);
    lp.connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.7);
    seatTick(ac, t, 0.012);
  });
}

/**
 * Correct code: a fast ascending five-note arpeggio as the cells flash
 * gold, then the deep root as the owl bursts. ~0.9s total.
 */
export function playSuccessBurst(): void {
  withRunningCtx((ac) => {
    const t = ac.currentTime;
    const run = [0, 2, 4, 6, 8];
    run.forEach((step, i) => {
      chime(ac, t + i * 0.07, SCALE[step]!, 0.04, 0.9);
      seatTick(ac, t + i * 0.07, 0.012);
    });
    chime(ac, t + run.length * 0.07 + 0.08, ROOT, 0.05, 2.2);
  });
}
