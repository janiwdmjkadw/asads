import type { CSSProperties } from 'react';
import './grounds.css';

/**
 * Six ways of putting KAOMOJI into the invite ground, in arctic mint.
 *
 * An experiment, kept off the live page. The ground that ships is the
 * chips wall with a mint halo; these ask what happens when a face is added
 * to it, which is a real question and not a small one — a kaomoji is the
 * only thing on this page with a personality, and everything around it is
 * deliberately cold and mechanical.
 *
 * WHAT VARIES is how much of it there is and what job it does: scattered
 * among the chips, inside them, only where the light already is, in place
 * of some conditions, or appearing only at the moment a rule arms.
 *
 * Worth flagging before you look: an earlier version of the invite page
 * had four ASCII faces floating in it and they were part of what got that
 * whole art field binned. These are drawn deliberately rather than
 * scattered as decoration, but the risk is the same one.
 *
 * No client JavaScript.
 */

export const GROUNDS = [
  'sparse', 'inline', 'lit', 'instead', 'big', 'armed',
] as const;
export type GroundName = (typeof GROUNDS)[number];

const S = (o: Record<string, unknown>) => o as CSSProperties;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

const CONDITIONS = [
  'the deployer touches their wallet',
  'a wallet I track buys it twice',
  'the same buyer comes back a third time',
  'nobody has sold for an hour',
  'it survives its first big exit',
  'the bonding curve completes',
  'the snipers are finally gone',
  'three of my frens are holding it',
  'the top holder stops adding',
  'supply stops moving between wallets',
  'it makes a new high while I sleep',
  'liquidity gets locked and stays locked',
  'the mint authority is burned',
  'it trades every hour for six hours',
  'the crowd goes quiet but the pool grows',
  'a wallet that never sells buys in',
  'it holds its floor through the weekend',
  'the first whale exits and it does not break',
  'insiders stop holding the float',
  'someone pays more for it than I did',
  'it outlives the account that shilled it',
  'the deployer funds a fresh wallet',
  'two of my rules agree at once',
  'it gets quiet enough to accumulate',
];

/**
 * Kept to the ones that read at small sizes and in a monospaced face.
 *
 * Anything with a bracket pair and a wide glyph inside it — the shrug, the
 * flip — turns to mush below about 18px, and half the well known ones lean
 * on characters Geist Mono has no glyph for, which renders as a fallback
 * face mid-line and looks like a bug rather than a face.
 */
const FACES = ['^_^', '(•‿•)', '^‿^', '(◡‿◡)', '(¬‿¬)', '(·‿·)', '(＾▽＾)', '(>‿<)'];

const REF_W = 1440;
const ADVANCE = 0.6;
const PAD_CHARS = 4;
const BANDS = 13;
const SIZE: [number, number] = [13, 24];
const GAP: [number, number] = [4, 18];
const CYCLE = 24;

const vw = (px: number) => `${((px / REF_W) * 100).toFixed(4)}vw`;

/** The welcome page's own values, so the surfaces cannot drift. The face
 *  hue is one step in from the chip ink, so it reads as lit rather than as
 *  a different colour. */
const INK = (a: number) => `rgba(206,240,229,${a})`;
const LIVE = (a: number) => `rgba(138,226,200,${a})`;

interface Chip {
  key: number;
  left: number;
  top: number;
  size: number;
  text: string;
  delay: number;
  band: number;
}

const CHIPS: Chip[] = (() => {
  const r = rng(0x51a7);
  const bandHeight = 100 / BANDS;
  const chips: Chip[] = [];
  let key = 0;
  for (let band = 0; band < BANDS; band += 1) {
    let x = r() < 0.5 ? -(4 + r() * 9) : r() * 6;
    while (x < 104) {
      const size = SIZE[0] + r() * (SIZE[1] - SIZE[0]);
      const text = CONDITIONS[Math.floor(r() * CONDITIONS.length)]!;
      const width = (((text.length + PAD_CHARS) * size * ADVANCE) / REF_W) * 100;
      chips.push({
        key: key++,
        left: x,
        top: band * bandHeight + bandHeight * 0.34 * r(),
        size,
        text,
        delay: -((((x + 12) / 116 + band / BANDS) / 2) * CYCLE + (r() - 0.5) * 2.4),
        band,
      });
      x += width + GAP[0] + r() * (GAP[1] - GAP[0]);
    }
  }
  return chips;
})();

const faceFor = (i: number) => FACES[i % FACES.length]!;

interface Config {
  /** How often a chip is joined by a face, as one in N. */
  every?: number;
  /** The face sits inside the chip rather than beside it. */
  inline?: boolean;
  /** The face REPLACES a condition rather than accompanying one. */
  instead?: boolean;
  /** Faces only near the middle, where the halo already is. */
  centreOnly?: boolean;
  /** Faces at their own size rather than the chip's. */
  scale?: number;
  /** Faces are invisible at rest and appear only as the chip arms. */
  onArm?: boolean;
}

const CONFIG: Record<GroundName, Config> = {
  /* One face for every seventh chip, beside it, at the chip's own size.
     The lightest touch: you notice them on the second look. */
  sparse: { every: 7 },
  /* Inside the plate, so the face is part of the rule rather than a
     sticker next to it. */
  inline: { every: 5, inline: true },
  /* Only where the mint light already falls. The faces read as the warm
     part of the room rather than as scattered decoration. */
  lit: { every: 4, centreOnly: true },
  /* In place of a condition: some plates hold a face and nothing else,
     which is the only version where the wall is not all language. */
  instead: { every: 6, instead: true },
  /* Fewer and much larger, at their own scale, floating between the
     chips. The most present, and the most at risk of reading as clip
     art. */
  big: { every: 11, scale: 3.4 },
  /* Invisible at rest, appearing only as a rule arms. The face becomes
     the reaction to a condition being met rather than a decoration on
     the page. */
  armed: { every: 4, onArm: true },
};

export function Ground({ ground }: { ground: GroundName }) {
  const c = CONFIG[ground] ?? CONFIG.sparse;
  const every = c.every ?? 7;

  return (
    <div className="gr-root" style={S({ background: '#000000' })}>
      <span className="gr-halo" style={S({ animation: 'gr-breathe 34s ease-in-out infinite' })} />

      <div className="gr-wall">
        {CHIPS.map((chip, i) => {
          const hasFace = i % every === 0;
          /* Distance from the middle, for the treatment that keeps faces
             where the light is. */
          const nearCentre = Math.abs(chip.left - 50) < 34 && Math.abs(chip.top - 50) < 34;
          const showFace = hasFace && (!c.centreOnly || nearCentre);
          const face = faceFor(i);

          /* `instead` swaps the words out entirely on the chips that carry
             a face; everything else keeps its condition. */
          const body = showFace && c.instead ? face : chip.text;

          return (
            <span key={chip.key}>
              <span
                className="gr-chip"
                style={S({
                  left: `${chip.left.toFixed(2)}%`,
                  top: `${chip.top.toFixed(2)}%`,
                  fontSize: vw(chip.size),
                  color: showFace && c.instead ? LIVE(1) : INK(1),
                  borderColor: showFace && c.instead ? LIVE(0.5) : INK(0.45),
                  background: showFace && c.instead ? LIVE(0.07) : INK(0.05),
                  gap: '0.55em',
                  '--gr-base': 0.09,
                  '--gr-lit': 0.2,
                  opacity: 0.09,
                  animation: `gr-arm ${CYCLE}s ease-in-out ${chip.delay.toFixed(2)}s infinite`,
                })}
              >
                {body}
                {/* Inline faces ride inside the plate, after the words. */}
                {showFace && c.inline && !c.instead ? (
                  <span style={S({ color: LIVE(1) })}>{face}</span>
                ) : null}
              </span>

              {/* Free-standing faces sit beside the chip rather than in it.
                  Offset by the chip's own width so they never overlap it —
                  the band packing does not know about them. */}
              {showFace && !c.inline && !c.instead ? (
                <span
                  className="gr-face"
                  style={S({
                    left: `${(chip.left + (chip.text.length + PAD_CHARS) * chip.size * ADVANCE / REF_W * 100 + 1.4).toFixed(2)}%`,
                    top: `${chip.top.toFixed(2)}%`,
                    fontSize: vw(chip.size * (c.scale ?? 1)),
                    color: LIVE(1),
                    '--gr-base': c.onArm ? 0 : 0.14,
                    '--gr-lit': c.onArm ? 0.5 : 0.3,
                    opacity: c.onArm ? 0 : 0.14,
                    animation: `gr-arm ${CYCLE}s ease-in-out ${chip.delay.toFixed(2)}s infinite`,
                  })}
                >
                  {face}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>

      {range(9).map((i) => {
        const t = (i + 1) / 9;
        return (
          <span
            key={i}
            className="gr-plate"
            style={S({
              opacity: 0.85 - t * 0.55,
              borderColor: INK(0.16),
              background: 'rgba(4,16,15,0.62)',
              '--gr-dx': `${(t * 96).toFixed(1)}px`,
              '--gr-dy': `${(t * 62).toFixed(1)}px`,
              animation: `gr-recede 24s ease-in-out ${-(t * 3.4)}s infinite`,
            })}
          />
        );
      })}
    </div>
  );
}
