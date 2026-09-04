const TRADE_SUCCESS_SOUND_SRC = '/sounds/chaching.m4a';
const TRADE_SUCCESS_SOUND_START_SEC = 1.5;
const TRADE_SUCCESS_VOLUME_KEY = 'trade:success-sound-volume:v1';
const DEFAULT_TRADE_SUCCESS_VOLUME = 0.55;

let successAudio: HTMLAudioElement | null = null;

function getSuccessAudio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!successAudio) {
    successAudio = new Audio(TRADE_SUCCESS_SOUND_SRC);
    successAudio.preload = 'auto';
  }
  return successAudio;
}

export function getTradeSuccessVolume(): number {
  if (typeof window === 'undefined') return DEFAULT_TRADE_SUCCESS_VOLUME;
  const raw = window.localStorage.getItem(TRADE_SUCCESS_VOLUME_KEY);
  if (raw == null) return DEFAULT_TRADE_SUCCESS_VOLUME;
  const value = Number(raw);
  return clampVolume(value);
}

export function setTradeSuccessVolume(value: number): void {
  const next = clampVolume(value);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TRADE_SUCCESS_VOLUME_KEY, String(next));
  }
  const audio = getSuccessAudio();
  if (audio) audio.volume = next;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TRADE_SUCCESS_VOLUME;
  return Math.max(0, Math.min(1, value));
}

// Latched on the first unlock ATTEMPT (not success): if the muted play is
// blocked (autoplay policy), retrying on every submit click would re-run
// `audio.load()` — a media reset + refetch — on the order's pre-POST hot
// path, for an unlock that would just be blocked again. One attempt per
// page load is enough; `playTradeSuccessSound` retries unmuted anyway.
let unlockAttempted = false;

/**
 * Browser audio is usually blocked unless a user gesture has happened.
 * Call this from the trade CTA click path so later async confirmations can
 * play the success sound reliably.
 */
export function unlockTradeSuccessSound(): void {
  if (unlockAttempted) return;
  const audio = getSuccessAudio();
  if (!audio) return;
  unlockAttempted = true;
  audio.volume = getTradeSuccessVolume();
  audio.load();
  audio.muted = true;
  void audio.play()
    .then(() => {
      audio.pause();
      audio.currentTime = TRADE_SUCCESS_SOUND_START_SEC;
    })
    .catch(() => undefined)
    .finally(() => {
      audio.muted = false;
    });
}

export function playTradeSuccessSound(): void {
  const audio = getSuccessAudio();
  if (!audio) return;
  try {
    audio.volume = getTradeSuccessVolume();
    audio.pause();
    audio.currentTime = TRADE_SUCCESS_SOUND_START_SEC;
    audio.muted = false;
    void audio.play().catch(() => undefined);
  } catch {
    // Audio playback is non-critical UI polish.
  }
}
