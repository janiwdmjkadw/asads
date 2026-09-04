import type { CSSProperties } from 'react';
import './invite-ground.css';

/**
 * The ground behind the fren invite: the conditions the agent holds, as
 * chips, behind a stack receding under the card.
 *
 * See `invite-ground.css` for why the grammar is stripped out, why the
 * plates are opaque, and what is banned here.
 *
 * No client JavaScript.
 */

const S = (o: Record<string, unknown>) => o as CSSProperties;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Deterministic. This renders on the server too, and a random wall would
 *  draw one field there and another on the client. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

/**
 * The values, without their grammar.
 *
 * BEHAVIOUR, NOT ARITHMETIC. A metric crossing a number is the most
 * generic thing a trading product can say, and it describes no product in
 * particular. Every one of these is something a person would sit and watch
 * for, and could not watch for without an agent.
 *
 * No price, no size, no side anywhere: these are the tests, never the
 * trade.
 */
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
 * THE FACES.
 *
 * The one warm thing on a page that is otherwise deliberately cold, and
 * the only element here with a personality rather than a function. That is
 * the argument for them and also the risk: an earlier version of this page
 * had ASCII faces floating in it, and they were part of what got that
 * whole art field binned.
 *
 * What makes these different is that they are PACKED, not scattered. A
 * face takes a slot in a band exactly the way a chip does, so it sits in
 * the wall's rhythm instead of on top of it.
 *
 * Kept to the ones that survive a monospaced face at small sizes. Anything
 * with a wide glyph between brackets turns to mush, and half the well
 * known ones lean on characters Geist Mono has no glyph for, which renders
 * a fallback mid line and reads as a bug rather than as a face.
 */
const FACES = [
  '^_^',
  '(•‿•)',
  '^‿^',
  '(◡‿◡)',
  '(¬‿¬)',
  '(·‿·)',
  '(>‿<)',
];

/**
 * How often a slot goes to a face instead of a chip, and how much bigger
 * it is drawn.
 *
 * Both numbers come from the lab rather than from taste. At the chip's own
 * size and the chip's own opacity a face is invisible: one every fourth
 * chip at 8% could not be found on the screen at all. Twice the size, at
 * twice the opacity, in the live mint rather than the chip ink, is where
 * it starts to read without becoming the subject.
 *
 * 0.16 puts seven or eight on the wall. 0.09 was the first guess and it
 * landed three, two of which were the same face: sparse enough that the
 * page read as unchanged. Much denser than this and it stops being a wall
 * of rules with something living in it and becomes a wall of faces.
 */
const FACE_ODDS = 0.16;
const FACE_SCALE = 2.2;
const FACE_BASE = 0.16;

/**
 * The frame the wall is measured against.
 *
 * Widths have to be known to pack without collisions, and the only way to
 * know them without measuring in a browser is to compute them: the face is
 * monospaced, so a chip is characters times size times the advance width,
 * plus its own padding. 0.6 is Geist Mono's advance.
 *
 * Sizes are px AT THIS WIDTH and rendered in `vw`, so the type scales with
 * the frame. With absolute px the slot shrinks on a narrow screen while
 * the text inside it does not, and every chip overflows into its
 * neighbour.
 */
const REF_W = 1440;
const ADVANCE = 0.6;
const PAD_CHARS = 4;

const BANDS = 13;
const SIZE: [number, number] = [13, 24];
const GAP: [number, number] = [4, 18];
const BASE = 0.08;
const CYCLE = 24;

const vw = (px: number) => `${((px / REF_W) * 100).toFixed(4)}vw`;

interface Chip {
  key: number;
  left: number;
  top: number;
  size: number;
  text: string;
  delay: number;
  /** A face is drawn bare: no plate, bigger, and in the live mint. */
  face: boolean;
}

/**
 * The wall, packed once at module scope.
 *
 * A band owns a horizontal strip nothing may leave, so two chips can never
 * land on each other. Overlap matters even at 8%: two faint plates
 * crossing make a darker smudge that reads as a stain rather than as
 * interface.
 *
 * Rejection sampling was the alternative and it fails unpredictably at
 * density — it silently drops what it cannot place, so a full wall quietly
 * stops being full.
 */
const CHIPS = (() => {
  const r = rng(0x51a7);
  const bandHeight = 100 / BANDS;
  const chips: Chip[] = [];
  let key = 0;
  let faceCount = 0;

  for (let band = 0; band < BANDS; band += 1) {
    /* Starts off the left edge about half the time: a wall whose every
       chip begins inside the frame reads as a layout. */
    let x = r() < 0.5 ? -(4 + r() * 9) : r() * 6;

    while (x < 104) {
      /* A FACE TAKES A SLOT, it does not sit on one. Deciding it here
         rather than decorating chips afterwards is what keeps the wall
         collision free: a face consumes its own width in the band, so the
         packer moves past it like anything else. Overlap matters even at
         this opacity, since two things crossing make a smudge that reads
         as a stain rather than as interface. */
      const face = r() < FACE_ODDS;
      const base = SIZE[0] + r() * (SIZE[1] - SIZE[0]);
      const size = face ? base * FACE_SCALE : base;
      /* Faces are dealt IN ORDER, chips at random. There are seven faces
         and about eight slots, so drawing them randomly reliably repeats
         one and drops three, and a repeat is far more visible than a
         repeated condition: the eye finds two identical faces across a
         wall it is not even reading. */
      const text = face
        ? FACES[faceCount++ % FACES.length]!
        : CONDITIONS[Math.floor(r() * CONDITIONS.length)]!;
      /* Two characters of slack on a face against the chip's four: it has
         no plate to pay for, and some of its glyphs may come from a
         fallback whose advance is not the one this arithmetic assumes. */
      const width = (((text.length + (face ? 2 : PAD_CHARS)) * size * ADVANCE) / REF_W) * 100;

      chips.push({
        key: key++,
        left: x,
        /* A third of the band at most, so a nudge cannot push a chip into
           its neighbour's strip, and no jitter at all on a face: it is
           over twice as tall and would otherwise reach into the band
           below. */
        top: band * bandHeight + (face ? 0 : bandHeight * 0.34 * r()),
        size,
        text,
        face,
        /* A DIAGONAL FRONT, not a scatter. Derived from the chip's own
           position, so the arming crosses the frame top-left to
           bottom-right and the wall reads as being swept rather than
           twinkling. The jitter keeps the front from arriving as a hard
           line. */
        delay: -((((x + 12) / 116 + band / BANDS) / 2) * CYCLE + (r() - 0.5) * 2.4),
      });

      x += width + GAP[0] + r() * (GAP[1] - GAP[0]);
    }
  }
  return chips;
})();

const STACK = 9;

export function InviteGround(): React.ReactElement {
  return (
    <div aria-hidden className="ivg-root">
      {/* The pool of mint light, behind everything. */}
      <span className="ivg-halo" style={S({ animation: 'ivg-breathe 34s ease-in-out infinite' })} />

      <div className="ivg-wall">
        {CHIPS.map((chip) => (
          <span
            key={chip.key}
            className={chip.face ? 'ivg-chip ivg-face' : 'ivg-chip'}
            style={S({
              left: `${chip.left.toFixed(2)}%`,
              top: `${chip.top.toFixed(2)}%`,
              fontSize: vw(chip.size),
              /* A face rests brighter and arms brighter. It is competing
                 with its own size for attention rather than with the
                 card. */
              '--ivg-base': chip.face ? FACE_BASE : BASE,
              opacity: chip.face ? FACE_BASE : BASE,
              animation: `ivg-arm ${CYCLE}s ease-in-out ${chip.delay.toFixed(2)}s infinite`,
            })}
          >
            {chip.text}
          </span>
        ))}
      </div>

      {range(STACK).map((i) => {
        const t = (i + 1) / STACK;
        return (
          <span
            key={i}
            className="ivg-plate"
            style={S({
              opacity: 0.85 - t * 0.55,
              '--ivg-dx': `${(t * 96).toFixed(1)}px`,
              '--ivg-dy': `${(t * 62).toFixed(1)}px`,
              animation: `ivg-recede 24s ease-in-out ${-(t * 3.4)}s infinite`,
            })}
          />
        );
      })}
    </div>
  );
}
