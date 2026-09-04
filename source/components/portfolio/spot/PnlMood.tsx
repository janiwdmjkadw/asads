'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * Slice "Portfolio Spot tab": the little companion under the hero.
 *
 * Reads the selected-range PnL and reacts with a kaomoji + a short,
 * contextual line — euphoric when you're flying, reassuring when
 * you're red, zen when the market's crabbing sideways. It's the
 * difference between a dashboard and something that feels like it's
 * rooting for you.
 *
 * It also has a temper. Hover it and it gets MAD (red, trembling,
 * "hey dont touch me"); pull away and it softens into a grateful yellow
 * "thanks" for two seconds before settling back to its PnL mood.
 *
 * Two principles keep the PnL read from being annoying:
 *   - SELECTION IS STABLE. The variant is seeded by (range + tier), so
 *     a 15s refetch never re-rolls the face. It only changes when you
 *     switch timeframe or actually cross a PnL threshold — and when it
 *     does, it pops, so the *change* itself reads as a reaction.
 *   - IT KNOWS WHEN TO BE QUIET. No data → renders nothing.
 */

/** Faces for the hover tantrum + the grateful cooldown. */
const MAD_FACES = ['ヽ(`Д´)ﾉ', '(╬ಠ益ಠ)', '(ノಠ益ಠ)ノ', '(҂≖‿≖)', '(>益<)'];
const THANKS_FACES = ['(◕‿◕)♡', '(づ｡◕‿‿◕｡)づ', 'ヽ(*・ω・)ﾉ', '(´｡• ᵕ •｡`)♡', '(＾▽＾)'];
const THANKS_HOLD_MS = 2000;

interface Props {
  /** Range-scoped change in percent (the header's delta). */
  readonly changePct: number | null;
  /**
   * Range-scoped change in USD. Used as a direction fallback when the
   * percentage is unavailable — e.g. a brand-new book that went 0 → $X
   * has an undefined %, but we still know it's green.
   */
  readonly changeUsd?: number | null;
  /** Seed for stable variant selection — the active range id. */
  readonly seed: string;
  /** Larger, stacked presentation for the header's center slot. */
  readonly prominent?: boolean;
}

type MoodId =
  | 'euphoric'
  | 'great'
  | 'good'
  | 'flat'
  | 'soft_down'
  | 'rough'
  | 'brutal';

interface Mood {
  readonly id: MoodId;
  /** Trend family for tinting. */
  readonly tone: 'up' | 'down' | 'flat';
  readonly kaomoji: ReadonlyArray<string>;
  readonly messages: ReadonlyArray<string>;
}

/**
 * Kaomoji lean on CJK punctuation and a handful of text-symbols
 * (✧ ✿ ♡ ☆). This stack front-loads gothic CJK faces that carry those
 * glyphs cleanly, keeps a symbol fallback, and parks the color-emoji
 * font dead last so nothing gets "emoji-fied" into a blob.
 */
const KAOMOJI_FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Yu Gothic UI", Meiryo, "Noto Sans CJK JP", "MS PGothic", "Segoe UI Symbol", system-ui, sans-serif';

const MOODS: ReadonlyArray<Mood> = [
  {
    id: 'euphoric',
    tone: 'up',
    kaomoji: ['ヽ(>∀<☆)ノ', '(≧▽≦)', '＼(^o^)／', '٩(◕‿◕)۶', '(* ^ ω ^)'],
    messages: [
      'wow so much',
      'we are SO back',
      'up only, baby',
      'generational wealth ✧',
      'screenshot this one',
    ],
  },
  {
    id: 'great',
    tone: 'up',
    kaomoji: ['(◕‿◕✿)', '(｡•̀ᴗ-)✧', '(*≧ω≦)', 'ヽ(・∀・)ﾉ'],
    messages: [
      "lookin' good",
      'comfy gains',
      'green looks good on you',
      'we eatin today',
    ],
  },
  {
    id: 'good',
    tone: 'up',
    kaomoji: ['(´｡• ᵕ •｡`)', '(｡◕‿◕｡)', '( ˶ˆ ꒳ ˆ˵ )', '(•◡•)'],
    messages: ['slow and steady', 'green is green', 'we move ♡', 'nice and tidy'],
  },
  {
    id: 'flat',
    tone: 'flat',
    kaomoji: ['(￣ω￣)', '( -_-)', '¯\\_(ツ)_/¯', '(。-‿-。)', '(・_・)'],
    messages: ['perfectly balanced', 'crab season', 'patience…', 'flat is fine', 'we wait'],
  },
  {
    id: 'soft_down',
    tone: 'down',
    kaomoji: ['(´･_･`)', '(._.)', '( ˘･з･)', '(；・∀・)'],
    messages: ["it's okie, let's lock in", 'dips happen', "we'll be fine", 'shake it off'],
  },
  {
    id: 'rough',
    tone: 'down',
    kaomoji: ['(｡•́︿•̀｡)', '(っ˘̩╭╮˘̩)っ', '( ; ; )', '(◞‸◟)'],
    messages: ['stay strong', "it's just paper", 'hands of diamond', 'breathe, we hold'],
  },
  {
    id: 'brutal',
    tone: 'down',
    kaomoji: ['(╥﹏╥)', '(ノД`)', '⊙﹏⊙', '(T⌓T)'],
    messages: [
      "we don't look at it",
      'deep breaths',
      'down bad but still cute',
      'tomorrow we recover',
    ],
  },
];

const MOOD_BY_ID: Readonly<Record<MoodId, Mood>> = Object.fromEntries(
  MOODS.map((m) => [m.id, m]),
) as Record<MoodId, Mood>;

/** Map a PnL percentage to a mood tier. */
function moodForPct(pct: number): Mood {
  if (pct >= 25) return MOOD_BY_ID.euphoric;
  if (pct >= 8) return MOOD_BY_ID.great;
  if (pct >= 1.5) return MOOD_BY_ID.good;
  if (pct > -1.5) return MOOD_BY_ID.flat;
  if (pct > -8) return MOOD_BY_ID.soft_down;
  if (pct > -25) return MOOD_BY_ID.rough;
  return MOOD_BY_ID.brutal;
}

/** Tiny deterministic string hash for stable variant selection. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pick<T>(arr: ReadonlyArray<T>, seed: string): T {
  return arr[hashStr(seed) % arr.length]!;
}

type Interaction = 'idle' | 'mad' | 'thanks';

export function PnlMood(props: Props): React.ReactElement | null {
  const [interaction, setInteraction] = useState<Interaction>('idle');
  // Counter advances per hover so successive tantrums show different
  // faces — deterministic rotation, no extra render state.
  const touchRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleEnter = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    touchRef.current += 1;
    setInteraction('mad');
  };

  const handleLeave = (): void => {
    setInteraction('thanks');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setInteraction('idle');
      timerRef.current = null;
    }, THANKS_HOLD_MS);
  };

  // Prefer the true percentage; fall back to the USD delta's *sign*
  // when % is undefined so the companion still reacts (it just can't
  // judge magnitude, so it stays in the gentle good / soft-down tiers).
  const pctValid =
    props.changePct != null && Number.isFinite(props.changePct);
  const usd = props.changeUsd;
  let effectivePct: number | null = null;
  if (pctValid) {
    effectivePct = props.changePct as number;
  } else if (typeof usd === 'number' && Number.isFinite(usd) && usd !== 0) {
    effectivePct = usd > 0 ? 3 : -3;
  } else if (typeof usd === 'number' && usd === 0) {
    effectivePct = 0;
  }
  if (effectivePct === null) return null;

  const mood = moodForPct(effectivePct);
  const moodColor =
    mood.tone === 'up'
      ? 'var(--up)'
      : mood.tone === 'down'
        ? 'var(--down)'
        : 'var(--ink-2)';

  // Resolve the active face / message / color by interaction state.
  let face: string;
  let message: string;
  let faceColor: string;
  let msgColor: string;
  let madly = false;
  if (interaction === 'mad') {
    face = MAD_FACES[touchRef.current % MAD_FACES.length]!;
    message = 'hey dont touch me';
    faceColor = 'var(--down)';
    msgColor = 'var(--down)';
    madly = true;
  } else if (interaction === 'thanks') {
    face = THANKS_FACES[touchRef.current % THANKS_FACES.length]!;
    message = 'thanks';
    faceColor = 'var(--hold)';
    msgColor = 'var(--hold)';
  } else {
    face = pick(mood.kaomoji, `${props.seed}:${mood.id}:k`);
    message = pick(mood.messages, `${props.seed}:${mood.id}:m`);
    faceColor = moodColor;
    msgColor = `color-mix(in srgb, ${moodColor} 58%, var(--ink-1))`;
  }

  const prominent = props.prominent === true;
  const faceSize = prominent ? 30 : 18;
  const msgSize = prominent ? 13.5 : 12.5;

  return (
    // Keyed by mood so the *pop* replays only when the PnL mood changes
    // (timeframe switch or crossing a threshold), not on hover or
    // refetch.
    <div
      key={mood.id}
      className="spot-mood"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={prominent ? prominentWrapStyle : inlineWrapStyle}
    >
      <span
        aria-hidden
        className={madly ? 'spot-mood-mad' : undefined}
        style={{
          fontFamily: KAOMOJI_FONT,
          fontSize: faceSize,
          lineHeight: 1,
          color: faceColor,
          letterSpacing: '0.01em',
          display: 'inline-block',
          transition: 'color 240ms ease, text-shadow 240ms ease',
          // A whisper of glow so the face feels lit, not pasted.
          textShadow: `0 0 ${prominent ? 20 : 12}px color-mix(in srgb, ${faceColor} ${
            madly ? 55 : 40
          }%, transparent)`,
        }}
      >
        {face}
      </span>
      <span
        style={{
          ...messageStyle,
          fontSize: msgSize,
          color: msgColor,
          textAlign: prominent ? 'center' : 'left',
          transition: 'color 240ms ease',
        }}
      >
        {message}
      </span>
    </div>
  );
}

const inlineWrapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  marginTop: 7,
};

const prominentWrapStyle: CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 5,
};

const messageStyle: CSSProperties = {
  fontFamily: 'var(--sans)',
  fontWeight: 500,
  letterSpacing: '0.005em',
};
