// Slice "Frens": the mosaic's voice. Each cell landing plays a soft
// synthesized chime — sine body with a long ASMR tail, an airy detuned
// octave partial, and a feather of band-passed noise for the tactile
// "block seats" tick. Notes walk a pentatonic scale so overlapping
// landings always harmonize; the final landing resolves on a deep root.
//
// No audio assets: everything is Web Audio, ~zero bytes, master gain
// kept whisper-quiet. Autoplay-safe: if the AudioContext can't run
// (cold page load with no prior gesture), we skip ENTIRELY rather than
// queue notes that would fire late and desynced after the next click.
// prefers-reduced-motion also silences (no landings happen visually).

let sharedCtx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedCtx) return sharedCtx;
  // Pre-gesture construction is a guaranteed console warning ("An
  // AudioContext was prevented from starting") and the context couldn't
  // run anyway — the "skip ENTIRELY" contract above already covers it.
  const activation = (
    navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
  ).userActivation;
  if (activation && !activation.hasBeenActive) return null;
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

/** C-major pentatonic across two octaves — nothing can clash. */
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
const ROOT = 130.81; // C3 — the settle.

export interface MosaicLanding {
  /** ms from now when this cell visually lands (delay + flight * 0.58). */
  atMs: number;
  /** cell index — picks the note deterministically. */
  index: number;
}

/**
 * Schedule one chime per landing on the Web Audio timeline. Returns a
 * cleanup that silences anything still ringing (call on unmount).
 */
export function scheduleMosaicChimes(landings: ReadonlyArray<MosaicLanding>): () => void {
  const ac = audioCtx();
  if (!ac || landings.length === 0) return () => undefined;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => undefined;

  let cancelled = false;
  let master: GainNode | null = null;
  const sources: AudioScheduledSourceNode[] = [];
  const mountedAt = performance.now();

  const start = () => {
    if (cancelled || ac.state !== 'running') return;
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);
    const t0 = ac.currentTime;

    const note = (t: number, freq: number, gain: number, tail: number) => {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const partial = ac.createOscillator();
      partial.type = 'sine';
      partial.frequency.value = freq * 2.003; // barely-detuned octave: the shimmer
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + tail);
      const g2 = ac.createGain();
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(gain * 0.32, t + 0.008);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + tail * 0.7);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      osc.connect(g);
      partial.connect(g2);
      g.connect(lp);
      g2.connect(lp);
      lp.connect(master!);
      osc.start(t);
      osc.stop(t + tail + 0.1);
      partial.start(t);
      partial.stop(t + tail * 0.7 + 0.1);
      sources.push(osc, partial);
    };

    const seatTick = (t: number) => {
      const dur = 0.05;
      const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const noise = ac.createBufferSource();
      noise.buffer = buf;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.014, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 1.2;
      noise.connect(bp);
      bp.connect(ng);
      ng.connect(master!);
      noise.start(t);
      noise.stop(t + dur);
      sources.push(noise);
    };

    let lastMs = 0;
    for (const { atMs, index } of landings) {
      const t = t0 + atMs / 1000;
      note(t, SCALE[(index * 7) % SCALE.length]!, 0.05, 1.6);
      seatTick(t);
      if (atMs > lastMs) lastMs = atMs;
    }
    // The resolution: a deep, slow root as the last block settles.
    note(t0 + (lastMs + 70) / 1000, ROOT, 0.04, 2.4);
  };

  if (ac.state === 'running') {
    start();
  } else {
    // One resume attempt; only start if it unblocks promptly, so notes
    // stay in sync with the animation. Otherwise stay silent this time.
    void ac
      .resume()
      .then(() => {
        if (!cancelled && ac.state === 'running' && performance.now() - mountedAt < 400) start();
      })
      .catch(() => undefined);
  }

  return () => {
    cancelled = true;
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    try {
      master?.disconnect();
    } catch {
      // already gone
    }
  };
}
