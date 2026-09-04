/**
 * Attention sounds for the Discover surfaces, synthesized with WebAudio
 * (decaying sine partials) instead of shipping audio assets:
 *
 *   - alpha-call bell        (new coin call lands in the alpha lane)
 *   - graduation bell        (a coin freshly graduates — same timbre)
 *   - wallet-toast chime     (tracked-wallet mint/trade toast — related
 *                             but distinct: a soft descending two-note)
 *
 * Every sound has a user volume (0..1, persisted in localStorage, surfaced
 * as sliders in the Tweaks popover) where 0.5 is the designed loudness and
 * 0 skips synthesis entirely. The wallet chime additionally has a mute
 * toggle (the bell button on the Wallet Activity panel).
 *
 * Browser autoplay policy: an AudioContext created before any user gesture
 * starts 'suspended' and refuses to resume. `primeAttentionSoundsOnGesture`
 * installs one-shot listeners that create/resume the context on the first
 * pointer/key interaction, so an event minutes later can ring. When no
 * gesture has happened yet, sounds silently skip — they are attention
 * polish, never worth surfacing an error for.
 *
 * Cold-output guard: after the tab sits silent for a while (backgrounded or
 * just idle) Chrome parks the tab's OS audio output stream. The first frames
 * rendered through a reopening pipe can glitch at full scale on some
 * drivers, so whichever chime reopened it played EAR-SPLITTINGLY loud on
 * refocus. A "cold" play therefore reopens the pipe with an inaudible primer
 * tone and rings the real sound a beat later; refocusing the tab also primes
 * proactively so the first post-refocus chime is both clean and on time.
 */

const BELL_VOLUME_KEY = 'sound:attention-bell-volume:v1';
const WALLET_TOAST_VOLUME_KEY = 'sound:wallet-toast-volume:v1';
const WALLET_TOAST_MUTED_KEY = 'sound:wallet-toast-muted:v1';
const TWEET_CHIME_VOLUME_KEY = 'sound:tweet-chime-volume:v1';
const TWEET_CHIME_MUTED_KEY = 'sound:tweet-chime-muted:v1';
const PLAY_IN_BACKGROUND_KEY = 'sound:play-in-background:v1';
const WALLET_TOAST_STACK_KEY = 'sound:wallet-toast-stack:v1';
const DEFAULT_VOLUME = 0.5;

/** Peak gain of a fundamental at volume 1. Volume 0.5 → 0.05, the loudness
 *  the alpha bell shipped with (well below the trade cha-ching). */
const MAX_PEAK_GAIN = 0.1;

const BELL_MIN_INTERVAL_MS = 1_500;
const WALLET_TOAST_MIN_INTERVAL_MS = 1_000;
const TWEET_CHIME_MIN_INTERVAL_MS = 1_000;
/** Same event pushed by both toast stacks rings once (see
 *  playWalletToastSoundFor). Window comfortably covers the dual-push. */
const WALLET_RING_KEY_DEDUPE_MS = 3_000;
const WALLET_RING_KEY_CAP = 200;
const recentWalletRingKeys = new Map<string, number>();
/** The tweet feed mounts more than once (Discover dock, Trade dock, the
 *  Trackers page), each with its own EventSource — the same tweet arrives in
 *  every mount within milliseconds. Dedupe by tweet id, module-wide. */
const TWEET_RING_ID_DEDUPE_MS = 30_000;
const TWEET_RING_ID_CAP = 200;
const recentTweetRingIds = new Map<string, number>();

/** After this much wall-clock silence, assume the browser parked the tab's
 *  audio output stream (see the cold-output guard in the header comment). */
const OUTPUT_COLD_AFTER_MS = 30_000;
/** How long the primer gets to reopen the pipe before a real sound rings. */
const OUTPUT_WARM_UP_MS = 250;

let audioContext: AudioContext | null = null;
let alphaBellRangAtMs = 0;
let graduationBellRangAtMs = 0;
let walletToastRangAtMs = 0;
let tweetChimeRangAtMs = 0;
/** Wall-clock ms through which the output stream is assumed open (last
 *  scheduled sound's tail + slack). 0 = never rang, so the first-ever
 *  sound also takes the primed path. */
let outputOpenUntilMs = 0;
/** When a pending primer finishes reopening the pipe — rings queue behind it. */
let outputWarmReadyAtMs = 0;

// ───────── settings (localStorage; read at play time — no reactivity needed) ─────────

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, value));
}

function readVolume(key: string): number {
  if (typeof window === 'undefined') return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? DEFAULT_VOLUME : clampVolume(Number(raw));
  } catch {
    return DEFAULT_VOLUME;
  }
}

function writeVolume(key: string, value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(clampVolume(value)));
  } catch {
    // Preference only.
  }
}

/** Shared volume for the alpha-call AND graduation bells (same sound). */
export function getAttentionBellVolume(): number {
  return readVolume(BELL_VOLUME_KEY);
}

export function setAttentionBellVolume(value: number): void {
  writeVolume(BELL_VOLUME_KEY, value);
}

export function getWalletToastVolume(): number {
  return readVolume(WALLET_TOAST_VOLUME_KEY);
}

export function setWalletToastVolume(value: number): void {
  writeVolume(WALLET_TOAST_VOLUME_KEY, value);
}

/** Wallet-toast mute — the bell toggle on the Wallet Activity panel. */
export function getWalletToastMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(WALLET_TOAST_MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setWalletToastMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WALLET_TOAST_MUTED_KEY, muted ? 'true' : 'false');
  } catch {
    // Preference only.
  }
}

/** Tweet-chime volume (Tweaks → Sound → "New tweets"). */
export function getTweetChimeVolume(): number {
  return readVolume(TWEET_CHIME_VOLUME_KEY);
}

export function setTweetChimeVolume(value: number): void {
  writeVolume(TWEET_CHIME_VOLUME_KEY, value);
}

/** Tweet-chime mute — the bell toggle on the Tweet Tracker panel. */
export function getTweetChimeMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TWEET_CHIME_MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setTweetChimeMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TWEET_CHIME_MUTED_KEY, muted ? 'true' : 'false');
  } catch {
    // Preference only.
  }
}

/** Play notification sounds even while the tab is hidden (Tweaks →
 *  "Play in background"). Covers EVERY WebAudio chime here — wallet
 *  toasts, alpha calls, graduation — by exempting the hidden-tab gates
 *  in `play()` and the deferred ring. Off by default. */
export function getPlayInBackground(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PLAY_IN_BACKGROUND_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPlayInBackground(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PLAY_IN_BACKGROUND_KEY, on ? 'true' : 'false');
  } catch {
    // Preference only.
  }
}

export type WalletSoundStackMode = 'chill' | 'stack';

/** Wallet-toast sound stacking (Tweaks → "Stacking"): 'chill' keeps the
 *  historical ≥1s spacing between rings; 'stack' rings every distinct
 *  event and lets chimes overlap (the same event pushed by both toast
 *  stacks is still collapsed via the per-event dedupe key). */
export function getWalletToastStackMode(): WalletSoundStackMode {
  if (typeof window === 'undefined') return 'chill';
  try {
    return window.localStorage.getItem(WALLET_TOAST_STACK_KEY) === 'stack' ? 'stack' : 'chill';
  } catch {
    return 'chill';
  }
}

export function setWalletToastStackMode(mode: WalletSoundStackMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WALLET_TOAST_STACK_KEY, mode);
  } catch {
    // Preference only.
  }
}

// ───────── synthesis ─────────

/** Set by the one-shot gesture unlock — fallback signal for browsers
 *  without `navigator.userActivation`. */
let gestureObserved = false;

/** Chrome prints "An AudioContext was prevented from starting" for any
 *  context constructed before the first user gesture — and such a context
 *  starts suspended and unresumable anyway, so pre-gesture play() calls
 *  were already silent no-ops. Gating construction on sticky user
 *  activation keeps the exact same audible behavior minus the warning. */
function userHasInteracted(): boolean {
  if (typeof navigator !== 'undefined') {
    const activation = (
      navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
    ).userActivation;
    if (activation) return activation.hasBeenActive;
  }
  return gestureObserved;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    if (!userHasInteracted()) return null;
    try {
      audioContext = new AudioContext();
    } catch {
      return null;
    }
    installRefocusWarmUp();
  }
  return audioContext;
}

/** Force the destination stream open with 200ms of a −66dB tone — real
 *  (non-zero) output the renderer can't skip, far below audibility — so any
 *  reopen glitch mangles near-silence instead of a chime. */
function primeOutput(ctx: AudioContext): void {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 220;
    gain.gain.value = 0.0005;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + 0.2);
  } catch {
    // Non-critical polish.
  }
}

let refocusWarmUpInstalled = false;

/** Prime on tab refocus (the reported blast trigger) so the pipe is already
 *  open — and any reopen glitch already spent — before the first real chime,
 *  which then rings without the warm-up delay. Running-state check keeps
 *  this a no-op before the first unlock gesture. */
function installRefocusWarmUp(): void {
  if (refocusWarmUpInstalled || typeof document === 'undefined') return;
  refocusWarmUpInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const ctx = audioContext;
    if (!ctx || ctx.state !== 'running') return;
    const now = Date.now();
    if (now <= outputOpenUntilMs || now < outputWarmReadyAtMs) return;
    primeOutput(ctx);
    outputWarmReadyAtMs = now + OUTPUT_WARM_UP_MS;
    outputOpenUntilMs = now + OUTPUT_WARM_UP_MS + OUTPUT_COLD_AFTER_MS;
  });
}

interface Voice {
  freq: number;
  /** Exponential pitch glide target — lasers, droplets, bubbles. */
  freqEnd?: number;
  /** Peak gain relative to the sound's fundamental (1 = fundamental). */
  level: number;
  decaySec: number;
  /** Delay from note-on — sequential notes make chimes/arpeggios. */
  startSec?: number;
  /** Waveform; 'sine' (default) is bell-like, 'triangle' woody/warm. */
  wave?: OscillatorType;
}

function ring(ctx: AudioContext, voices: readonly Voice[], peakGain: number): void {
  const now = ctx.currentTime;
  for (const voice of voices) {
    const start = now + (voice.startSec ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = voice.wave ?? 'sine';
    osc.frequency.setValueAtTime(voice.freq, start);
    if (voice.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(voice.freqEnd, start + voice.decaySec);
    }
    // 5ms attack avoids a click at note-on; exponential release to silence.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peakGain * voice.level, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + voice.decaySec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + voice.decaySec + 0.05);
  }
}

/** Fundamental + one upper partial: the "new coin" bell (E6 strike). */
const BELL_PARTIALS: readonly Voice[] = [
  { freq: 1318.5 /* E6 */, level: 1, decaySec: 0.8 },
  { freq: 2637.0 /* E7 */, level: 0.35, decaySec: 0.45 },
];

/** Soft ascending two-note (G5 → B5) — the tweet arrival chime. Rises where
 *  the wallet chime falls, so the two feeds stay tellable apart by ear. */
const TWEET_PARTIALS: readonly Voice[] = [
  { freq: 784.0, level: 0.9, decaySec: 0.35 },
  { freq: 1568.0, level: 0.25, decaySec: 0.22 },
  { freq: 987.77, level: 0.9, decaySec: 0.5, startSec: 0.09 },
  { freq: 1975.5, level: 0.25, decaySec: 0.28, startSec: 0.09 },
];

// ───────── wallet toast sound library ─────────
// Per-wallet pickable presets (the bell button on each Wallet Tracker
// row). All synthesized, all deliberately short and soft — a busy feed
// must never turn into a slot machine.

export interface WalletSound {
  id: string;
  name: string;
  voices: readonly Voice[];
}

export const DEFAULT_WALLET_SOUND_ID = 'chime';

export const WALLET_SOUNDS: readonly WalletSound[] = [
  {
    // The original wallet chime — soft descending two-note (B5 → G5).
    id: 'chime',
    name: 'Chime',
    voices: [
      { freq: 987.77, level: 0.9, decaySec: 0.4 },
      { freq: 1975.5, level: 0.25, decaySec: 0.25 },
      { freq: 784.0, level: 0.9, decaySec: 0.55, startSec: 0.09 },
      { freq: 1568.0, level: 0.25, decaySec: 0.3, startSec: 0.09 },
    ],
  },
  {
    // Single bright strike — the alpha bell's little sibling.
    id: 'ding',
    name: 'Ding',
    voices: [
      { freq: 1318.5, level: 1, decaySec: 0.5 },
      { freq: 2637.0, level: 0.3, decaySec: 0.3 },
    ],
  },
  {
    // Fast ascending coin arpeggio (C6-E6-G6-C7) with a sparkle tail.
    id: 'kaching',
    name: 'Kaching',
    voices: [
      { freq: 1046.5, level: 0.7, decaySec: 0.18 },
      { freq: 1318.5, level: 0.7, decaySec: 0.18, startSec: 0.055 },
      { freq: 1568.0, level: 0.7, decaySec: 0.2, startSec: 0.11 },
      { freq: 2093.0, level: 0.85, decaySec: 0.5, startSec: 0.165 },
      { freq: 4186.0, level: 0.18, decaySec: 0.4, startSec: 0.165 },
    ],
  },
  {
    // Water plink: quick downward glide with a soft body.
    id: 'droplet',
    name: 'Droplet',
    voices: [
      { freq: 1400, freqEnd: 520, level: 0.9, decaySec: 0.22 },
      { freq: 700, level: 0.35, decaySec: 0.3, startSec: 0.02 },
    ],
  },
  {
    // Warm woody double-tap (triangle wave, A4 then C5).
    id: 'marimba',
    name: 'Marimba',
    voices: [
      { freq: 440.0, level: 1, decaySec: 0.28, wave: 'triangle' },
      { freq: 880.0, level: 0.3, decaySec: 0.16, wave: 'triangle' },
      { freq: 523.25, level: 1, decaySec: 0.4, startSec: 0.12, wave: 'triangle' },
      { freq: 1046.5, level: 0.3, decaySec: 0.2, startSec: 0.12, wave: 'triangle' },
    ],
  },
  {
    // Playful pew — fast dive from high to low.
    id: 'laser',
    name: 'Laser',
    voices: [{ freq: 1900, freqEnd: 260, level: 0.8, decaySec: 0.16 }],
  },
  {
    // Cheerful up-blip.
    id: 'bubble',
    name: 'Bubble',
    voices: [
      { freq: 360, freqEnd: 940, level: 0.9, decaySec: 0.14 },
      { freq: 720, freqEnd: 1880, level: 0.25, decaySec: 0.12 },
    ],
  },
  {
    // Dreamy staggered bell trio (E6 → C6 → G5), long ring-out.
    id: 'dreambells',
    name: 'Dreambells',
    voices: [
      { freq: 1318.5, level: 0.7, decaySec: 0.9 },
      { freq: 1046.5, level: 0.7, decaySec: 0.9, startSec: 0.14 },
      { freq: 784.0, level: 0.7, decaySec: 1.1, startSec: 0.28 },
      { freq: 2637.0, level: 0.15, decaySec: 0.6 },
    ],
  },
];

function walletSoundById(id: string | undefined): WalletSound | undefined {
  return WALLET_SOUNDS.find((sound) => sound.id === id);
}

/**
 * Resolve the toast sound for a tracked wallet: null = silent (bell
 * toggled off / picked "None"), otherwise a WALLET_SOUNDS id with unknown
 * ids degrading to the default chime. Structural param so trackedWallets
 * doesn't have to import this module's types.
 */
export function resolveWalletToastSound(
  wallet: { sound?: string; soundEnabled?: boolean } | undefined,
): string | null {
  if (wallet?.soundEnabled === false) return null;
  const picked = walletSoundById(wallet?.sound);
  return picked ? picked.id : DEFAULT_WALLET_SOUND_ID;
}

/** Ring immediately on a warm output stream; on a cold one (or while a
 *  primer is still reopening it), prime first and defer the ring behind the
 *  warm-up window so the reopen glitch never lands on audible content. */
function ringWhenWarm(ctx: AudioContext, voices: readonly Voice[], peakGain: number): void {
  const now = Date.now();
  if (now > outputOpenUntilMs && now >= outputWarmReadyAtMs) {
    primeOutput(ctx);
    outputWarmReadyAtMs = now + OUTPUT_WARM_UP_MS;
  }
  const delayMs = Math.max(0, outputWarmReadyAtMs - now);
  let tailSec = 0;
  for (const voice of voices) {
    tailSec = Math.max(tailSec, (voice.startSec ?? 0) + voice.decaySec);
  }
  outputOpenUntilMs = now + delayMs + tailSec * 1000 + OUTPUT_COLD_AFTER_MS;
  if (delayMs === 0) {
    ring(ctx, voices, peakGain);
    return;
  }
  window.setTimeout(() => {
    if (
      typeof document !== 'undefined'
      && document.visibilityState === 'hidden'
      && !getPlayInBackground()
    ) return;
    try {
      ring(ctx, voices, peakGain);
    } catch {
      // Non-critical polish.
    }
  }, delayMs);
}

function play(partials: readonly Voice[], volume: number): void {
  if (typeof document === 'undefined') return;
  // Hidden tabs are silent by default; the "Play in background" tweak
  // lifts the gate so tracked-wallet/alpha/graduation chimes still ring
  // while the user is tabbed away.
  if (document.visibilityState === 'hidden' && !getPlayInBackground()) return;
  if (volume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const peakGain = MAX_PEAK_GAIN * volume;
  try {
    if (ctx.state === 'suspended') {
      // A resume this late only succeeds if a gesture already happened;
      // otherwise the promise rejects and the sound just skips.
      void ctx.resume().then(() => ringWhenWarm(ctx, partials, peakGain)).catch(() => undefined);
      return;
    }
    ringWhenWarm(ctx, partials, peakGain);
  } catch {
    // Non-critical polish.
  }
}

/** Test-only: reset the cold-output bookkeeping (module state is a singleton). */
export function __resetAttentionSoundOutputStateForTests(): void {
  outputOpenUntilMs = 0;
  outputWarmReadyAtMs = 0;
  alphaBellRangAtMs = 0;
  graduationBellRangAtMs = 0;
  walletToastRangAtMs = 0;
  tweetChimeRangAtMs = 0;
  recentWalletRingKeys.clear();
  recentTweetRingIds.clear();
}

/** New alpha call landed (throttled; skips pre-gesture / backgrounded / 0-volume). */
export function playAlphaCallBell(): void {
  const now = Date.now();
  if (now - alphaBellRangAtMs < BELL_MIN_INTERVAL_MS) return;
  alphaBellRangAtMs = now;
  play(BELL_PARTIALS, getAttentionBellVolume());
}

/** A coin freshly graduated — same bell, own throttle so a simultaneous
 *  alpha call can't swallow it (and vice versa). */
export function playGraduationBell(): void {
  const now = Date.now();
  if (now - graduationBellRangAtMs < BELL_MIN_INTERVAL_MS) return;
  graduationBellRangAtMs = now;
  play(BELL_PARTIALS, getAttentionBellVolume());
}

/**
 * Tracked-wallet toast sound: the wallet's picked preset (resolved at
 * toast-creation via resolveWalletToastSound; null = that wallet's bell is
 * off). The throttle doubles as the double-fire guard: the Discover and
 * Trade pages each own a toast stack and both stay mounted under the
 * persistent shell, so one wallet event can push two toasts within
 * milliseconds — only the first rings.
 */
export function playWalletToastSoundFor(
  soundId: string | null | undefined,
  eventKey?: string,
): void {
  if (soundId === null) return;
  if (getWalletToastMuted()) return;
  const sound = walletSoundById(soundId) ?? walletSoundById(DEFAULT_WALLET_SOUND_ID)!;
  const now = Date.now();
  // Per-EVENT dedupe: the Discover and Trade toast stacks both stay
  // mounted and push the same event within milliseconds — collapse those
  // by key in every mode (the interval throttle used to double as this
  // guard; 'stack' mode removes the throttle, so the dedupe must be
  // explicit).
  if (eventKey !== undefined) {
    const rangAt = recentWalletRingKeys.get(eventKey);
    if (rangAt !== undefined && now - rangAt < WALLET_RING_KEY_DEDUPE_MS) return;
    recentWalletRingKeys.set(eventKey, now);
    if (recentWalletRingKeys.size > WALLET_RING_KEY_CAP) {
      for (const [key, at] of recentWalletRingKeys) {
        if (recentWalletRingKeys.size <= WALLET_RING_KEY_CAP) break;
        if (now - at >= WALLET_RING_KEY_DEDUPE_MS) recentWalletRingKeys.delete(key);
        else break; // insertion-ordered: everything after is younger
      }
    }
  }
  // 'chill' keeps the historical ≥1s spacing; 'stack' rings every
  // distinct event and lets the short decaying chimes overlap.
  if (getWalletToastStackMode() === 'chill') {
    if (now - walletToastRangAtMs < WALLET_TOAST_MIN_INTERVAL_MS) return;
  }
  walletToastRangAtMs = now;
  play(sound.voices, getWalletToastVolume());
}

/**
 * New tracked tweet landed. Deduped by tweet id module-wide (the feed
 * mounts several times, each with its own EventSource — see
 * recentTweetRingIds), then throttled so a reconnect burst rings once.
 * Mute/volume/visibility/gesture gates all apply as usual.
 */
export function playTweetChime(tweetId: string): void {
  if (getTweetChimeMuted()) return;
  const now = Date.now();
  const rangAt = recentTweetRingIds.get(tweetId);
  if (rangAt !== undefined && now - rangAt < TWEET_RING_ID_DEDUPE_MS) return;
  recentTweetRingIds.set(tweetId, now);
  if (recentTweetRingIds.size > TWEET_RING_ID_CAP) {
    for (const [id, at] of recentTweetRingIds) {
      if (recentTweetRingIds.size <= TWEET_RING_ID_CAP) break;
      if (now - at >= TWEET_RING_ID_DEDUPE_MS) recentTweetRingIds.delete(id);
      else break; // insertion-ordered: everything after is younger
    }
  }
  if (now - tweetChimeRangAtMs < TWEET_CHIME_MIN_INTERVAL_MS) return;
  tweetChimeRangAtMs = now;
  play(TWEET_PARTIALS, getTweetChimeVolume());
}

/**
 * Sound-picker preview: plays on the click that selects it — a direct
 * gesture, so it bypasses the throttle and the mute toggle, and floors
 * the volume so a zeroed slider still lets the user audition presets.
 */
export function previewWalletSound(soundId: string): void {
  const sound = walletSoundById(soundId);
  if (!sound) return;
  // Called from the selecting click — a gesture by definition, so it may
  // construct the AudioContext even where `navigator.userActivation` is
  // unavailable (older browsers, DOM test environments).
  gestureObserved = true;
  play(sound.voices, Math.max(getWalletToastVolume(), 0.25));
}

/**
 * One-shot gesture unlock: create/resume the AudioContext on the user's
 * first interaction so later pushed events can ring. Returns a cleanup that
 * removes the listeners (page unmount before any gesture).
 */
export function primeAttentionSoundsOnGesture(): () => void {
  if (typeof window === 'undefined') return () => {};
  const unlock = () => {
    gestureObserved = true;
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    remove();
  };
  const remove = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  return remove;
}
