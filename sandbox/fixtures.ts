/**
 * Fixture rows for the sandbox API routes, shaped as `LiveNewPair` — the wire
 * type the ingestion edge really sends (see `source/components/discover/
 * useLiveNewPairs.ts`). The client converts these with `livePairToCoin`, so
 * every formatting, bonding and holder-metric code path runs exactly as it
 * does in production.
 *
 * Generation is deterministic (a seeded PRNG, no Date.now inside the row
 * builder) so a reload does not reshuffle the board underneath you while you
 * are working on a card.
 */

/** Tokens the bonding curve puts up for sale; mirrors bonding.tsx. */
const TOKENS_FOR_SALE_BASE = 793_100_000_000_000n;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const WORDS = [
  'Quantum', 'Neural', 'Solar', 'Vector', 'Cobalt', 'Lunar', 'Prism', 'Onyx',
  'Vertex', 'Nimbus', 'Cipher', 'Halcyon', 'Zenith', 'Ember', 'Tundra', 'Vapor',
  'Obsidian', 'Aurora', 'Basalt', 'Cinder', 'Drift', 'Echo', 'Flux', 'Glacier',
  'Harbor', 'Ion', 'Jade', 'Kelvin', 'Lattice', 'Monsoon', 'Nova', 'Orbit',
];

const SUFFIX = ['AI', 'DAO', 'Labs', 'Protocol', 'Network', 'Coin', 'Cat', 'Dog', 'Inu', 'Fi'];

/** Mulberry32 — small, fast, deterministic. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)]!;
}

function base58(rng: () => number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i += 1) out += BASE58[Math.floor(rng() * BASE58.length)];
  return out;
}

/**
 * A coin logo, inlined so the board needs no image host.
 *
 * NINE ARCHETYPES, not one shape in nine colours. The first version of
 * this drew the same square, the same circle and the same three letters
 * for all hundred and thirty tokens, changing only the hue — and a lane
 * of those does not read as a market, it reads as a loading state that
 * finished. Real token art is wildly uneven: some is a hand drawn animal,
 * some is a wordmark, some is a gradient blob somebody made in ten
 * seconds, and the unevenness IS the texture of the page. A board tuned
 * against a uniform placeholder is tuned against the wrong picture.
 *
 * So: an orb, a diagonal split monogram, concentric rings, a pixel grid,
 * a chevron stack, a knocked out letterform, a blob, an outline mark, and
 * a full bleed wordmark. Which one a token gets is derived from its own
 * symbol, so it is stable across renders and across the SSR boundary.
 *
 * Everything is flat SVG with no external reference, so each one is a few
 * hundred bytes and costs no request.
 */
const LOGO_KINDS = 9;

/** Deterministic small hash, so a symbol always draws the same mark. */
function symbolSeed(symbol: string): number {
  let h = 2166136261;
  for (let i = 0; i < symbol.length; i += 1) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function avatar(symbol: string, hue: number): string {
  const seed = symbolSeed(symbol);
  const kind = seed % LOGO_KINDS;
  const label = symbol.slice(0, 3).toUpperCase();
  const initial = symbol.slice(0, 1).toUpperCase();

  /* One hue, four jobs. Deep is the ground, mid the mass, bright the
     highlight, ink the type — every mark is built from these so a lane of
     them holds together even though the shapes do not. */
  const deep = `hsl(${hue} 58% 14%)`;
  const mid = `hsl(${hue} 66% 42%)`;
  const bright = `hsl(${hue} 88% 62%)`;
  const pale = `hsl(${hue} 90% 86%)`;
  const off = `hsl(${(hue + 42) % 360} 78% 58%)`;

  const open = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">';
  const type = (t: string, size: number, y: number, fill: string, weight = 800) =>
    `<text x="48" y="${y}" font-family="system-ui,-apple-system,sans-serif" font-size="${size}"`
    + ` font-weight="${weight}" fill="${fill}" text-anchor="middle"`
    + ` letter-spacing="${size > 40 ? -2 : 0}">${t}</text>`;

  let body: string;

  switch (kind) {
    /* An orb with a light source: the generic memecoin sphere. */
    case 0:
      body =
        `<rect width="96" height="96" rx="20" fill="${deep}"/>`
        + `<circle cx="48" cy="48" r="30" fill="${mid}"/>`
        + `<circle cx="38" cy="36" r="11" fill="${pale}" fill-opacity="0.45"/>`
        + type(initial, 30, 60, deep);
      break;

    /* A diagonal split with the monogram straddling it. */
    case 1:
      body =
        `<rect width="96" height="96" rx="20" fill="${mid}"/>`
        + `<path d="M0 96 L96 0 L96 96 Z" fill="${deep}"/>`
        + type(label, 24, 58, pale);
      break;

    /* Concentric rings — the "protocol" look. */
    case 2:
      body =
        `<rect width="96" height="96" rx="20" fill="${deep}"/>`
        + `<circle cx="48" cy="48" r="31" fill="none" stroke="${bright}" stroke-width="5"/>`
        + `<circle cx="48" cy="48" r="18" fill="none" stroke="${mid}" stroke-width="5"/>`
        + `<circle cx="48" cy="48" r="6" fill="${pale}"/>`;
      break;

    /* A pixel grid. Reads as a tiny piece of pixel art at card size. */
    case 3: {
      const cells: string[] = [`<rect width="96" height="96" rx="20" fill="${deep}"/>`];
      let bit = seed;
      for (let gy = 0; gy < 5; gy += 1) {
        for (let gx = 0; gx < 5; gx += 1) {
          bit = (bit * 1103515245 + 12345) >>> 0;
          if (bit % 100 < 46) {
            const fill = bit % 7 === 0 ? off : bit % 3 === 0 ? pale : bright;
            cells.push(
              `<rect x="${13 + gx * 14}" y="${13 + gy * 14}" width="12" height="12" rx="2" fill="${fill}"/>`,
            );
          }
        }
      }
      body = cells.join('');
      break;
    }

    /* A chevron stack — the "up only" mark. */
    case 4:
      body =
        `<rect width="96" height="96" rx="20" fill="${deep}"/>`
        + `<path d="M24 60 L48 34 L72 60" fill="none" stroke="${bright}" stroke-width="9"`
        + ` stroke-linecap="round" stroke-linejoin="round"/>`
        + `<path d="M24 76 L48 50 L72 76" fill="none" stroke="${mid}" stroke-width="9"`
        + ` stroke-linecap="round" stroke-linejoin="round"/>`;
      break;

    /* A letter knocked OUT of a solid: the mark is the hole. */
    case 5:
      body =
        `<rect width="96" height="96" rx="20" fill="${bright}"/>`
        + `<mask id="k${seed % 9999}"><rect width="96" height="96" fill="white"/>`
        + `<text x="48" y="72" font-family="system-ui,sans-serif" font-size="66" font-weight="900"`
        + ` fill="black" text-anchor="middle">${initial}</text></mask>`
        + `<rect width="96" height="96" fill="${deep}" mask="url(#k${seed % 9999})"/>`;
      break;

    /* An off centre blob. The ten second logo, on purpose. */
    case 6:
      body =
        `<rect width="96" height="96" rx="20" fill="${deep}"/>`
        + `<path d="M22 40 C22 20 48 12 64 22 C82 33 84 60 70 72 C55 85 30 78 24 62 Z" fill="${mid}"/>`
        + `<path d="M40 32 C48 28 58 32 60 40" fill="none" stroke="${pale}" stroke-width="5"`
        + ` stroke-linecap="round"/>`;
      break;

    /* An outline mark on near black: the restrained one. */
    case 7:
      body =
        `<rect width="96" height="96" rx="20" fill="hsl(${hue} 20% 8%)"/>`
        + `<rect x="14" y="14" width="68" height="68" rx="14" fill="none" stroke="${bright}"`
        + ` stroke-width="4"/>`
        + type(label, 22, 57, bright, 700);
      break;

    /* A full bleed wordmark, type running edge to edge. */
    default:
      body =
        `<rect width="96" height="96" rx="20" fill="${mid}"/>`
        + `<rect y="52" width="96" height="44" fill="${deep}" fill-opacity="0.5"/>`
        + `<text x="48" y="46" font-family="system-ui,sans-serif" font-size="34" font-weight="900"`
        + ` fill="${pale}" text-anchor="middle" letter-spacing="-2">${initial}</text>`
        + `<text x="48" y="78" font-family="ui-monospace,monospace" font-size="15" font-weight="700"`
        + ` fill="${pale}" fill-opacity="0.85" text-anchor="middle">${label}</text>`;
      break;
  }

  /* `charset=utf-8`, not the bare `;utf8` this used to carry: the latter
     is not a valid media type parameter and only works because browsers
     forgive it. */
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(open + body + '</svg>')}`;
}

export interface FixtureOptions {
  /** How many rows to emit. Production sends a 150-deep pool. */
  count?: number;
  /** Seed offset, so the two lanes do not generate identical tokens. */
  seed?: number;
  /** Fraction of rows already past the curve. */
  graduatedRatio?: number;
  /** Lower bound on bonding progress, 0-1. Ripening rows sit high. */
  minProgress?: number;
  /** Upper bound on bonding progress, 0-1. */
  maxProgress?: number;
}

/**
 * Build one lane's worth of rows. `nowMs` is passed in rather than read here
 * so ages advance between requests while the token identities stay put.
 */
export function buildFixtureRows(nowMs: number, options: FixtureOptions = {}) {
  const {
    count = 60,
    seed = 1,
    graduatedRatio = 0,
    minProgress = 0.02,
    maxProgress = 0.94,
  } = options;

  const rng = makeRng(seed * 7919 + 13);
  const rows = [];

  for (let i = 0; i < count; i += 1) {
    const word = pick(rng, WORDS);
    const suffix = pick(rng, SUFFIX);
    const name = `${word} ${suffix}`;
    const symbol = (word.slice(0, 4) + suffix.slice(0, 2)).toUpperCase();
    const hue = Math.floor(rng() * 360);

    // Newest first: each row is a little older than the one above it.
    const ageMs = Math.floor(2_000 + i * (rng() * 40_000 + 6_000));
    const graduated = rng() < graduatedRatio;

    const progress = minProgress + rng() * (maxProgress - minProgress);
    const remaining = graduated
      ? 0n
      : BigInt(Math.floor(Number(TOKENS_FOR_SALE_BASE) * (1 - progress)));

    const buys = Math.floor(rng() * 900) + 12;
    const sells = Math.floor(rng() * 700) + 5;
    const volumeUsd = Math.round((rng() * 90_000 + 800) * 100) / 100;
    const marketCapUsd = graduated
      ? Math.round(rng() * 4_000_000 + 120_000)
      : Math.round(4_000 + progress * 68_000 + rng() * 6_000);

    const hasSocials = rng() > 0.25;
    const handle = word.toLowerCase() + suffix.toLowerCase();

    /*
     * VANITY MINT SUFFIXES, the way mainnet actually looks.
     *
     * Launchpads brand the tail of every mint they deploy: pump.fun ends
     * `pump`, letsbonk ends `bonk`, Bags ends `bags`. `coinLaunchpad` in
     * `discoverFilters` reads exactly that, because the feed carries no
     * launchpad field, so without a branded tail the protocol filter has
     * nothing to bite on and looks broken in the sandbox while working
     * on mainnet.
     *
     * The rest are left unbranded, like the launchpads that do not stamp
     * theirs — those coins pass every protocol filter, which is the
     * behaviour worth being able to see.
     */
    const brandRoll = rng();
    const brand = brandRoll < 0.55 ? 'pump' : brandRoll < 0.72 ? 'bonk' : brandRoll < 0.8 ? 'bags' : '';

    rows.push({
      mint: brand === '' ? base58(rng, 44) : base58(rng, 40) + brand,
      name,
      symbol,
      creator: base58(rng, 44),
      ageMs,
      createdAtMs: nowMs - ageMs,
      imageUrl: avatar(symbol, hue),
      imageSourceUrl: null,
      imageCdnUrl: null,
      imageThumbUrl: null,
      twitter: hasSocials ? `https://x.com/${handle}` : null,
      telegram: hasSocials && rng() > 0.5 ? `https://t.me/${handle}` : null,
      website: rng() > 0.6 ? `https://${handle}.fun` : null,
      txns: buys + sells,
      buys,
      sells,
      volumeUsd,
      vol24hUsd: Math.round(volumeUsd * (2 + rng() * 9) * 100) / 100,
      marketCapUsd,
      realTokenBaseUnits: remaining.toString(),
      realSolLamports: String(Math.floor(progress * 85 * 1e9)),
      totalSupplyBaseUnits: '1000000000000000',
      lastTradeAtMs: nowMs - Math.floor(rng() * 90_000),
      graduated,
      graduatedAtMs: graduated ? nowMs - Math.floor(rng() * 3_600_000) : null,
      devBuyLamports: rng() > 0.5 ? Math.floor(rng() * 9e9) : null,

      // Launch modes are mutually exclusive on-chain, so at most one is set.
      isMayhem: rng() > 0.9,
      isCashback: rng() > 0.93,
      agentMode: rng() > 0.88,
      isCharity: rng() > 0.96,

      devHoldingsPct: rng() > 0.2 ? Math.round(rng() * 1400) / 100 : null,
      sniperHoldingsPct: rng() > 0.3 ? Math.round(rng() * 2600) / 100 : null,
      bundlerHoldingsPct: rng() > 0.4 ? Math.round(rng() * 1800) / 100 : null,
      insiderHoldingsPct: rng() > 0.5 ? Math.round(rng() * 900) / 100 : null,
      viewers: rng() > 0.7 ? Math.floor(rng() * 240) + 1 : null,

      feeShareRecipients: null,
      feeShareLocked: null,
      feeShareAuthority: null,
    });
  }

  return rows;
}

/**
 * Lane presets.
 *
 * Only TWO envelopes exist on the wire. The Graduated lane is not its own
 * endpoint — `DiscoverPage` splits the new-pairs feed on `coin.graduated`
 * (the backend buckets graduated tokens into the top of the same envelope),
 * so the new-pairs payload has to carry both or that lane renders empty.
 */
export const LANE_PRESETS = {
  /*
   * COUNTS ARE A SANDBOX DECISION, and they were wrong.
   *
   * 85 + 45 was chosen to mirror the 150 deep pool production streams,
   * but nothing here virtualises: every row becomes a live card with its
   * own art, its own age counter and its own animations, and the board
   * was mounting 99 of them and 385 images on load. That cost seven
   * seconds to load and left the page running at two to four frames a
   * second, which makes it useless for exactly the thing it exists for —
   * looking at a design and judging how it moves.
   *
   * A lane shows six cards. 44 and 20 still overflow it by a wide margin,
   * still fill the scroller, and still carry the same spread of ages,
   * curve positions and market caps, because those are derived from the
   * ratios below rather than from the count.
   */
  /** New Pairs + Graduated. A quarter of the rows are already past the curve. */
  newPairs: { count: 44, seed: 3, graduatedRatio: 0.34, minProgress: 0.01, maxProgress: 0.55 },
  /** Ripening — its own DB-backed feed: climbing, high on the curve, none out. */
  almostGraduated: { count: 20, seed: 11, graduatedRatio: 0, minProgress: 0.55, maxProgress: 0.985 },
} as const satisfies Record<string, FixtureOptions>;
