/**
 * Production-shaped data for every backend route the export calls.
 *
 * WHY THIS EXISTS. The catch-all answered everything with one permissive
 * envelope of empty arrays. Every page rendered, nothing 404'd, and every
 * data surface showed its empty state — so the portfolio, the rewards
 * ladder, the frens leaderboard, the fills table and the conditionals list
 * were all being designed blind. A layout that is only ever seen with no
 * rows in it is a layout nobody has actually seen.
 *
 * THE SHAPES ARE NOT INVENTED. Every field name here is read off the
 * export's own parser in `source/lib/api/`. Those parsers are defensive —
 * they require a few strings and coerce the rest with fallbacks — so a
 * wrong key does not error, it silently produces a zero or a null and the
 * row renders as blank. That failure is quiet, which is exactly why the
 * names have to be right rather than plausible.
 *
 * THE NUMBERS ARE DELIBERATELY UNEVEN. Round, identical values make a
 * table look correct when it is not: every column the same width, every
 * bar the same length, no negative case, no long name, no missing logo.
 * These carry losses as well as gains, one very long token name, a null
 * price, and a wallet with no label, because those are the cells that
 * break a layout.
 *
 * Lamports and base units are STRINGS. They are u64 on the wire and the
 * parsers keep them as strings; a number here would be a different type
 * than production sends and would round above 2^53.
 */

const SOL = 1_000_000_000;
const lam = (sol: number) => Math.round(sol * SOL).toString();

/*
 * ── THE CLOCK ────────────────────────────────────────────────────────
 *
 * Not `Date.now()` directly: this module is imported by a server route,
 * and a clock that moves on every call makes each render of a page
 * differ from the last.
 *
 * It was a hardcoded constant for that reason, pinned to 2025-08-28 —
 * and then real time went past it. By the time anybody looked, every
 * relative age on the frens page read `1y ago` for a call made that
 * morning, and every payout was dated the previous August. A fixture
 * that is stable and WRONG is worse than one that moves.
 *
 * Rounded down to the hour instead. Stable for anything rendered inside
 * the same hour, which is what the determinism was actually for, and it
 * never drifts again.
 */
const NOW_MS = Math.floor(Date.now() / 3_600_000) * 3_600_000;
const iso = (msAgo: number) => new Date(NOW_MS - msAgo).toISOString();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/*
 * ── THESE HAVE TO BE UUIDs ───────────────────────────────────────────
 *
 * They were `wa_sandbox_primary` and friends, which read nicely and
 * broke every write on the wallets tab.
 *
 * `patchWallet` and `setPrimaryWallet` both begin with
 * `UUID_REGEX.test(walletAccountId)` and return `invalid_input` when it
 * fails — before any request is made. The row's handler then falls
 * through its `error` / `reauth` branches to the default and toasts
 * `Network error. Try again.`
 *
 * So the enable switch and the primary star did nothing, and every
 * click produced a toast blaming a network that was never reached. Not
 * a bug in the tab: a fixture whose ids could not pass the client's own
 * guard.
 */
export const WALLET_ID = '8f14e45f-ce6a-4f7c-b9a1-2d3e4f5a6b7c';
export const WALLET_PUBKEY = 'SandboxWa11etPubkey11111111111111111111111111';
const WALLET_2_ID = 'c9d0e1f2-a3b4-4c5d-8e9f-0a1b2c3d4e5f';
const WALLET_2_PUBKEY = 'SandboxWa11etSecondary1111111111111111111111';
/* The rest of the bench. Distinct tails, because `…1111` four times
   over is the one thing the address column must never be. */
const WALLET_3_ID = 'd1e2f3a4-b5c6-4d7e-9f80-1a2b3c4d5e6f';
const WALLET_3_PUBKEY = 'SandboxWa11etSniper1111111111111111117hQd';
const WALLET_4_ID = 'e2f3a4b5-c6d7-4e8f-a091-2b3c4d5e6f70';
const WALLET_4_PUBKEY = 'SandboxWa11etRunner111111111111111111k39P';
const WALLET_5_ID = 'f3a4b5c6-d7e8-4f90-b1a2-3c4d5e6f7081';
const WALLET_5_PUBKEY = 'SandboxWa11etCo1d11111111111111111111x82M';
const WALLET_6_ID = 'a4b5c6d7-e8f9-4a01-c2b3-4d5e6f708192';
const WALLET_6_PUBKEY = 'SandboxWa11etSix111111111111111111111tR5w';
const WALLET_7_ID = 'b5c6d7e8-f9a0-4b12-d3c4-5e6f70819203';
const WALLET_7_PUBKEY = 'SandboxWa11etSca1ps1111111111111111119vZn';

/* ── tokens ──────────────────────────────────────────────────────────
   One long name, one missing logo and one null price on purpose: those
   are the three cells that break a holdings table. */
/**
 * ── THE TOKEN MARKS ──────────────────────────────────────────────────
 *
 * The real logos, by mint.
 *
 * These were `https://assets.listen.local/<sym>.png`, a hostname that
 * resolves nowhere — every request failed, each `<img>` hid itself on
 * error, and the holdings tape rendered empty frames. Then they were
 * drawn: an inline SVG per token, a coloured square with initials on
 * it. That fixed the empty frames and was still obviously not a logo.
 *
 * `dd.dexscreener.com/ds-data/tokens/solana/<mint>.png` serves the
 * actual artwork keyed by mint, which is the only key a fixture like
 * this has. Every one of the seven below was loaded in a browser before
 * being written down — the token-list repo only has SOL and USDC (it is
 * archived, and predates every memecoin here), and both `static.jup.ag`
 * and `img.birdeye.so` returned nothing for all seven.
 *
 * PRODUCTION DOES NOT USE THIS. The real page reads `logo` off the API
 * response; this is the sandbox's fixture and nothing more. The row
 * still hides an `<img>` that fails, so a dead URL costs an empty frame
 * rather than a broken one.
 */
const logo = (mint: string) => `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png`;

const TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9 },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5 },
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', name: 'dogwifhat', decimals: 6 },
  { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', name: 'Popcat', decimals: 9 },
  { mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', symbol: 'MEW', name: 'cat in a dogs world', decimals: 5 },
  { mint: '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC', symbol: 'PONKE', name: 'Ponke The Monkey Of Solana', decimals: 9 },
].map((t) => ({ ...t, logo: logo(t.mint) }));


/* ── portfolio ───────────────────────────────────────────────────────*/

const HOLDINGS = [
  { t: 0, amount: 41.284, price: 214.62, cost: 7_910, pct: 44.1, ch: 3.2, bucket: 'sol' },
  { t: 1, amount: 2_140.5, price: 1.0, cost: 2_140, pct: 12.1, ch: 0.01, bucket: 'stable' },
  { t: 2, amount: 18_400_000, price: 0.0000241, cost: 610, pct: 2.5, ch: -8.4, bucket: 'spl' },
  { t: 3, amount: 1_284.11, price: 2.31, cost: 2_180, pct: 16.7, ch: 12.8, bucket: 'spl' },
  { t: 4, amount: 3_910.4, price: null, cost: 1_020, pct: 0, ch: null, bucket: 'spl' },
  { t: 5, amount: 940_112, price: 0.00412, cost: 5_120, pct: 21.9, ch: -2.1, bucket: 'spl' },
  { t: 6, amount: 88_400, price: 0.0184, cost: 2_460, pct: 2.7, ch: 41.6, bucket: 'spl' },
];

function holding(h: (typeof HOLDINGS)[number]) {
  const token = TOKENS[h.t]!;
  const value = h.price === null ? null : h.amount * h.price;
  const unrealized = value === null ? null : value - h.cost;
  return {
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    logo: token.logo,
    decimals: token.decimals,
    amount_raw: Math.round(h.amount * 10 ** token.decimals).toString(),
    amount_ui: h.amount,
    price_usd: h.price,
    value_usd: value,
    pct_of_portfolio: h.pct,
    change_24h_pct: h.ch,
    bucket: h.bucket,
    /* Two wallets on the first two holdings only — a breakdown that is
       always one row never exercises the expander. */
    wallet_breakdown:
      h.t < 2
        ? [
            { wallet_account_id: WALLET_ID, wallet_pubkey: WALLET_PUBKEY, amount_ui: h.amount * 0.72, value_usd: value === null ? null : value * 0.72 },
            { wallet_account_id: WALLET_2_ID, wallet_pubkey: WALLET_2_PUBKEY, amount_ui: h.amount * 0.28, value_usd: value === null ? null : value * 0.28 },
          ]
        : [{ wallet_account_id: WALLET_ID, wallet_pubkey: WALLET_PUBKEY, amount_ui: h.amount, value_usd: value }],
    cost_basis_usd: h.cost,
    unrealized_usd: unrealized,
    unrealized_pct: unrealized === null ? null : (unrealized / h.cost) * 100,
    realized_usd: h.t === 3 ? 412.8 : 0,
    cost_basis_provenance: 'trade_history',
  };
}

export const portfolioSpot = {
  total_usd: 20_142.66,
  sol_usd: 8_860.44,
  stable_usd: 2_140.5,
  spl_usd: 9_141.72,
  sol_price_usd: 214.62,
  coverage_pct: 98.4,
  change_24h_usd: 412.19,
  change_24h_pct: 2.09,
  holdings: HOLDINGS.map(holding),
  wallet_aggregates: [
    { wallet_account_id: WALLET_ID, wallet_pubkey: WALLET_PUBKEY, total_usd: 16_284.11 },
    { wallet_account_id: WALLET_2_ID, wallet_pubkey: WALLET_2_PUBKEY, total_usd: 3_858.55 },
  ],
  backfill: [{ wallet_account_id: WALLET_ID, status: 'done', earliest_at_ms: NOW_MS - 90 * DAY, last_run_at_ms: NOW_MS - 2 * HOUR, last_error: null }],
  degraded_reasons: [],
  snapshot_at_ms: NOW_MS - 90_000,
  realized_usd: 412.8,
  unrealized_usd: 1_284.4,
  cost_basis_usd: 18_858.26,
};

/**
 * A walk, not a line: a performance chart drawn from evenly rising
 * points proves nothing about how the real one will look.
 *
 * ── THE FIELD NAMES WERE WRONG ───────────────────────────────────────
 *
 * This shipped as `{ at_ms, value_usd }`. `parsePoint` reads `t_ms` and
 * `total_usd` and returns null for anything else, so every one of the
 * ninety points was silently dropped, `points` came back empty, and the
 * chart rendered its "history is building" empty state on a page whose
 * totals were all populated. The panel looked broken and the fixture
 * looked fine.
 *
 * The three bucket fields are filled too, so the chart's hover readout
 * has a split to show rather than three zeroes, and they sum to the
 * total the way the real endpoint's do.
 */
export const portfolioPerformance = {
  range: '30d',
  resolution_ms: DAY,
  chart_partial: false,
  tracking_started_ms: NOW_MS - 90 * DAY,
  change_usd: 3_912.55,
  change_pct: 8.83,
  points: Array.from({ length: 90 }, (_, i) => {
    const t = i / 89;
    const wobble = Math.sin(i * 0.7) * 380 + Math.sin(i * 0.23) * 620;
    const total = 12_400 + t * 7_400 + wobble;
    /* Roughly the split the snapshot reports, drifting a little across
       the range so the three series are not parallel. */
    const sol = total * (0.46 - 0.04 * t);
    const stable = total * (0.09 + 0.02 * t);
    return {
      t_ms: NOW_MS - (89 - i) * DAY,
      total_usd: total,
      sol_usd: sol,
      stable_usd: stable,
      spl_usd: total - sol - stable,
    };
  }),
};

export const portfolioTransactions = {
  transactions: Array.from({ length: 24 }, (_, i) => {
    const token = TOKENS[(i * 3 + 1) % TOKENS.length]!;
    const isBuy = i % 3 !== 0;
    return {
      signature: `Sandbox${i}Tx1111111111111111111111111111111111111111`,
      slot: 298_400_000 + i * 1_200,
      block_time_ms: NOW_MS - i * 5 * HOUR,
      kind: isBuy ? 'buy' : 'sell',
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      logo: token.logo,
      decimals: token.decimals,
      amount_ui: 120 + i * 41.2,
      value_usd: 180 + i * 62.4,
      sol_delta_lamports: lam(isBuy ? -(0.4 + i * 0.11) : 0.4 + i * 0.11),
      fee_lamports: lam(0.000_012),
    };
  }),
  next_cursor: null,
};

/* ── trading ─────────────────────────────────────────────────────────*/

export const tradeFills = {
  wallet_account_id: WALLET_ID,
  fills: Array.from({ length: 18 }, (_, i) => {
    const token = TOKENS[(i * 2 + 2) % TOKENS.length]!;
    const side = i % 3 === 0 ? 'sell' : 'buy';
    return {
      fill_id: `fill_${1000 + i}`,
      order_id: `ord_${2000 + i}`,
      client_order_id: `cli_${3000 + i}`,
      signature: `SandboxFill${i}11111111111111111111111111111111111111`,
      slot: 298_400_000 + i * 900,
      side,
      mint: token.mint,
      sol_delta_lamports: lam(side === 'buy' ? -(0.25 + i * 0.08) : 0.25 + i * 0.08),
      token_delta_base_units: Math.round((900 + i * 140) * 10 ** token.decimals).toString(),
      fee_lamports: lam(0.000_014),
      tip_lamports: lam(0.000_1),
      venue: i % 2 ? 'jupiter' : 'pump_amm',
      confirmed_at_ms: NOW_MS - i * 2.5 * HOUR,
      order_state: 'filled',
      created_at: iso(i * 2.5 * HOUR),
    };
  }),
};

/** Every status the list can render, so no state is only ever theoretical. */
const ORDER_STATUSES = ['active', 'active', 'triggered', 'completed', 'cancelled', 'failed', 'expired'];

export const advancedOrders = {
  orders: Array.from({ length: 7 }, (_, i) => {
    const token = TOKENS[(i + 2) % TOKENS.length]!;
    const kind = i % 2 ? 'limit' : 'recurring';
    return {
      id: `adv_${4000 + i}`,
      client_order_id: `cli_adv_${4000 + i}`,
      chain: 'solana',
      kind,
      status: ORDER_STATUSES[i],
      status_detail: ORDER_STATUSES[i] === 'failed' ? 'route not found' : null,
      wallet_account_id: WALLET_ID,
      input_mint: TOKENS[0]!.mint,
      output_mint: token.mint,
      quote_asset: 'SOL',
      gate_asset: null,
      total_input_base_units: lam(2 + i * 0.5),
      suborders_total: kind === 'recurring' ? 12 : 1,
      suborders_executed: kind === 'recurring' ? Math.min(12, i * 2) : i > 2 ? 1 : 0,
      interval_seconds: kind === 'recurring' ? 3600 : 0,
      slippage_bps: 150,
      price_basis: kind === 'limit' ? 'market_cap_usd' : null,
      price_floor_usd: null,
      price_ceiling_usd: null,
      trigger_cmp: kind === 'limit' ? 'gte' : null,
      trigger_value_usd: kind === 'limit' ? (250_000 + i * 40_000).toString() : null,
      expires_at: iso(-7 * DAY),
      next_run_at: kind === 'recurring' ? iso(-45 * 60_000) : null,
      input_spent_base_units: lam(0.5 + i * 0.2),
      output_received_base_units: Math.round((1200 + i * 310) * 10 ** token.decimals).toString(),
      priority_lamports: lam(0.000_05),
      bribe_lamports: lam(0.000_1),
      error_retry_count: ORDER_STATUSES[i] === 'failed' ? 3 : 0,
      last_error_kind: ORDER_STATUSES[i] === 'failed' ? 'route_not_found' : null,
      created_at: iso((i + 1) * DAY),
      updated_at: iso(i * HOUR),
      terminal_at: ['completed', 'cancelled', 'failed', 'expired'].includes(ORDER_STATUSES[i]!) ? iso(i * HOUR) : null,
    };
  }),
};

/* ── rewards ─────────────────────────────────────────────────────────*/

/*
 * Snake case, like the wire, and the same fault the referral fixtures
 * carried: `parseCashbackMe` reads `cashback_bps`,
 * `lifetime_volume_lamports` and `next_tier`, so against camelCase keys
 * the tab rendered a `silver` tier at a 0% rate over 0.00 SOL of
 * lifetime volume — a page that looked built but was reporting nothing.
 *
 * The bps figures are basis points of the FEE, not percentages: 2,500
 * bps is the 25% back that the silver tier pays. They were written as
 * `25`, which would have been 0.25% if it had ever parsed.
 */
export const cashbackMe = {
  tier: { index: 2, key: 'silver', cashback_bps: 2_500 },
  partner: null,
  lifetime_volume_lamports: lam(1_284.6),
  next_tier: {
    key: 'gold',
    min_volume_lamports: lam(2_500),
    remaining_lamports: lam(1_215.4),
    cashback_bps: 4_000,
  },
  balance: {
    accrued_lamports: lam(3.214),
    claimed_lamports: lam(1.86),
    pending_lamports: lam(0.12),
    claimable_lamports: lam(1.234),
  },
  min_claim_lamports: Number(lam(0.5)),
  tiers: [
    { index: 0, key: 'base', min_volume_lamports: '0', cashback_bps: 1_000 },
    { index: 1, key: 'bronze', min_volume_lamports: lam(250), cashback_bps: 1_800 },
    { index: 2, key: 'silver', min_volume_lamports: lam(1_000), cashback_bps: 2_500 },
    { index: 3, key: 'gold', min_volume_lamports: lam(2_500), cashback_bps: 4_000 },
    { index: 4, key: 'platinum', min_volume_lamports: lam(10_000), cashback_bps: 6_000 },
  ],
  evm_pending: [],
};

/*
 * Snake case, like the wire. `fetchPayouts` reads `amount_lamports` and
 * `created_at`; against camelCase keys every row rendered `0 SOL` and
 * `Invalid Date`, which looked like two separate bugs in the table and
 * was one bug in this object.
 */
export const cashbackPayouts = {
  payouts: Array.from({ length: 6 }, (_, i) => ({
    id: `pay_${5000 + i}`,
    amount_lamports: lam(0.3 + i * 0.22),
    status: i === 0 ? 'pending' : i === 1 ? 'submitted' : 'confirmed',
    signature: i < 2 ? null : `SandboxPayout${i}111111111111111111111111111111111`,
    created_at: iso(i * 6 * DAY),
    terminal_at: i < 2 ? null : iso(i * 6 * DAY - HOUR),
  })),
};

export const cashbackWallets = {
  wallets: [
    { wallet_pubkey: WALLET_PUBKEY, label: 'Main', is_primary: true, volume_lamports: lam(1_040.2), cashback_lamports: lam(2.61), trade_count: 412 },
    /* No label on purpose — the row has to render without one. */
    { wallet_pubkey: WALLET_2_PUBKEY, label: null, is_primary: false, volume_lamports: lam(244.4), cashback_lamports: lam(0.6), trade_count: 88 },
  ],
};

/*
 * Snake case, like the wire, and the third fixture in this file with
 * the same fault: `fetchPointsMe` reads `volume_points` and
 * `bonus_points`, so the tab reported a lifetime of 0 next to a list of
 * accolades that all read `+0 pts`.
 */
export const pointsMe = {
  partner_active: false,
  points: { volume_points: 12_840, bonus_points: 3_200, lifetime_points: 16_040 },
  accolades: [
    { key: 'first_trade', name: 'First Trade', description: 'Place your first trade', icon: 'spark', bonus_points: 100, status: 'claimed', progress: 1 },
    { key: 'ten_trades', name: 'Getting Warm', description: 'Place ten trades', icon: 'flame', bonus_points: 250, status: 'claimed', progress: 1 },
    { key: 'hundred_trades', name: 'Regular', description: 'Place a hundred trades', icon: 'anvil', bonus_points: 1_000, status: 'unlocked', progress: 1 },
    { key: 'first_conditional', name: 'Set And Forget', description: 'Arm your first conditional', icon: 'clock', bonus_points: 500, status: 'unlocked', progress: 1 },
    { key: 'fren_five', name: 'Five Frens', description: 'Bring five frens', icon: 'people', bonus_points: 750, status: 'locked', progress: 0.6 },
    { key: 'volume_10k', name: 'Ten Thousand', description: 'Trade 10,000 SOL of volume', icon: 'wave', bonus_points: 2_500, status: 'locked', progress: 0.128 },
  ],
};

const LEADER_LABELS = ['aster', 'brixby', 'you', 'delune', 'evren', 'fenwick', 'grigg', 'halcy', 'ibsen', 'jorvik', 'kessel', 'lumen'];

/* `rows`, not `entries`: `fetchPointsLeaderboard` reads `body.rows`, so
   under the old key the board was always empty. */
export const pointsLeaderboard = {
  rows: LEADER_LABELS.map((label, i) => ({
    rank: i + 1,
    label: label === 'you' ? 'You' : `@${label}`,
    lifetime_points: Math.round(84_000 / (i + 1.4) + 2_000),
    is_me: label === 'you',
  })),
};

/* ── frens ───────────────────────────────────────────────────────────*/

export const referralMe = {
  enabled: true,
  code: { slug: 'designer', link: 'https://listen.local/fren/designer', created_at: iso(60 * DAY) },
  referred_by: { slug: 'degenmike' },
  partner: null,
  economics: {
    platform_fee_bps: 100,
    referral_share_bps: 3_000,
    min_claim_lamports: Number(lam(0.5)),
  },
  lifetime: {
    referee_count: 14,
    volume_lamports: lam(4_212.8),
    platform_fee_lamports: lam(42.1),
    referral_fee_lamports: lam(12.6),
  },
  balance: {
    accrued_lamports: lam(12.6),
    claimed_lamports: lam(9.4),
    pending_lamports: lam(0.4),
    claimable_lamports: lam(2.8),
  },
  evm_pending: [],
};

/*
 * ── SNAKE CASE, AND NESTED UNDER `stats` ─────────────────────────────
 *
 * Every figure on the referral tab rendered as zero while the names
 * beside them rendered fine, and this fixture is why. Two faults:
 *
 *   `fetchReferralStats` reads `body.stats` and `body.balance`. This
 *   was a FLAT object, so `parseStats` got `undefined` and returned a
 *   zero for every field.
 *
 *   The keys were camelCase. Every parser in `referral.ts` reads the
 *   wire format, which is snake_case — `referee_count`, not
 *   `refereeCount` — so even nested correctly, each one would have
 *   fallen back to zero.
 *
 * The referee rows had the same second fault, which is exactly why nine
 * names appeared with `0.0000 SOL` against all of them.
 */
export const referralStats = {
  stats: {
    referee_count: 14,
    volume_lamports: lam(4_212.8),
    platform_fee_lamports: lam(42.1),
    referral_fee_lamports: lam(12.6),
  },
  balance: {
    accrued_lamports: lam(12.6),
    claimed_lamports: lam(9.4),
    pending_lamports: lam(0.4),
    claimable_lamports: lam(2.8),
  },
};

/*
 * Nine rows against a `referee_count` of 14, on purpose. The endpoint
 * pages the list and reports the total separately, so the tail line
 * that says what everybody after the tenth adds up to only has
 * something to say when the two disagree.
 */
export const referralReferees = {
  referees: LEADER_LABELS.slice(0, 9).map((label, i) => ({
    label: `@${label}`,
    volume_lamports: lam(880 / (i + 1) + 40),
    referral_fee_lamports: lam(2.6 / (i + 1) + 0.1),
    trade_count: Math.round(180 / (i + 1)) + 4,
  })),
};

export const referralLeaderboard = {
  entries: LEADER_LABELS.map((label, i) => ({
    rank: i + 1,
    label: label === 'you' ? 'You' : `@${label}`,
    volumeLamports: lam(9_400 / (i + 1.2)),
    referralFeeLamports: lam(28 / (i + 1.2)),
    refereeCount: Math.round(64 / (i + 1.1)),
    isMe: label === 'you',
  })),
};

export const referralPayouts = cashbackPayouts;

/* ── notifications ───────────────────────────────────────────────────*/

const NOTIFICATION_KINDS = [
  ['order_filled', 'Order filled', 'Bought 1,284 WIF for 2.4 SOL'],
  ['conditional_armed', 'Conditional armed', 'Watching market cap on POPCAT'],
  ['conditional_triggered', 'Conditional triggered', 'Market cap crossed 250K, order sent'],
  ['deposit_seen', 'Deposit received', '4.0 SOL landed in your wallet'],
  ['cashback_paid', 'Cashback paid', '1.23 SOL sent to your wallet'],
  ['fren_joined', 'A fren joined', '@kessel signed up through your link'],
  ['order_failed', 'Order failed', 'Route not found, nothing was spent'],
];

export const notifications = {
  unread_count: 3,
  notifications: NOTIFICATION_KINDS.map(([kind, title, body], i) => ({
    id: `ntf_${6000 + i}`,
    kind,
    title,
    body,
    metadata: {},
    /* The first three unread, so the badge and the read/unread split are
       both exercised. */
    read_at: i < 3 ? null : iso(i * 3 * HOUR),
    created_at: iso(i * 4 * HOUR),
  })),
  prefs: { act: 'alert', beat: 'alert', trace: 'inbox', sound: true },
};

/* ── wallets ─────────────────────────────────────────────────────────*/

/*
 * A WALLET'S HOLDING OF ONE MINT.
 *
 * `/v1/trade/token-balance?mint=…&wallet_account_id=…` is what the
 * trade page's wallet picker reads to fill its TOKENS column, one call
 * per listed wallet. Nothing served it, so the column was an em dash on
 * every row — the same failure the SOL figures had before the balances
 * fixture was wired up.
 *
 * Seeded off the two ids so a wallet holds the SAME amount every time
 * the list opens, and deliberately uneven: two wallets hold nothing,
 * which is the case the column exists to show.
 */
export function tokenBalanceFor(mint: string, walletAccountId: string | null): string {
  if (walletAccountId === null) return '0';
  let hash = 0;
  const key = `${mint}|${walletAccountId}`;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  /* One in three holds none of it. */
  if (hash % 3 === 0) return '0';
  /* Six decimal token, so these are base units: between ~1.2K and ~890K
     tokens, which is the range a real position on a pump mint sits in. */
  const whole = 1_200 + (hash % 890_000);
  return `${whole}000000`;
}

export const walletBalances = {
  balances: [
    { wallet_account_id: WALLET_ID, wallet_pubkey: WALLET_PUBKEY, lamports: lam(29.74), usdc_micro: '1540220000' },
    { wallet_account_id: WALLET_2_ID, wallet_pubkey: WALLET_2_PUBKEY, lamports: lam(11.54), usdc_micro: '600280000' },
    { wallet_account_id: WALLET_3_ID, wallet_pubkey: WALLET_3_PUBKEY, lamports: lam(6.208), usdc_micro: '241900000' },
    { wallet_account_id: WALLET_4_ID, wallet_pubkey: WALLET_4_PUBKEY, lamports: lam(3.417), usdc_micro: '88400000' },
    { wallet_account_id: WALLET_5_ID, wallet_pubkey: WALLET_5_PUBKEY, lamports: lam(74.02), usdc_micro: '0' },
    { wallet_account_id: WALLET_6_ID, wallet_pubkey: WALLET_6_PUBKEY, lamports: lam(0.812), usdc_micro: '12050000' },
    { wallet_account_id: WALLET_7_ID, wallet_pubkey: WALLET_7_PUBKEY, lamports: lam(0.094), usdc_micro: '0' },
  ],
};

/*
 * THE WALLET LIST, which more surfaces gate on than you would expect.
 *
 * The portfolio does not render "no holdings" when its holdings are empty —
 * it renders "No wallets yet" and never asks for holdings at all, because
 * it gates on this endpoint first. Filling `/portfolio/spot` alone left the
 * page in its create-a-wallet state with seven holdings sitting unused
 * behind it.
 *
 * `trade_ready` and `nonce_setup.required` are the other two gates: a
 * wallet that is not trade ready pushes the terminal into its setup path
 * regardless of balances.
 */
const wallet = (id: string, pubkey: string, label: string | null, primary: boolean, order: number) => ({
  wallet_account_id: id,
  turnkey_wallet_id: `tk_${id}`,
  turnkey_wallet_account_id: `tka_${id}`,
  label,
  wallet_pubkey: pubkey,
  pubkey,
  chain: 'solana',
  /*
   * 'active', NOT 'ready'.
   *
   * `isEligibleWallet` in `selected-wallet-store` tests
   * `status === 'active'`, and every wallet in this fixture said 'ready'
   * — so `eligible` came back empty and the whole sub-header wallet
   * cluster (settings, Groups, the wallet chip with the SOL and USDC
   * balances) rendered NOTHING in the sandbox. On a mock site built to
   * look at the UI, a control that never appears cannot be judged.
   *
   * 'ready' is the right word for the top level `wallet.status` a few
   * lines down, which is provisioning state. Per-wallet status is the
   * account's own lifecycle, and 'active' is what the api/ sends.
   */
  status: 'active',
  is_primary: primary,
  is_enabled: true,
  is_archived: false,
  display_order: order,
  backup_confirmed_at: iso(60 * DAY),
  nonce_setup: { required: false, target_count: 5, active_count: 5 },
  trading_authorization: { expires_at: null },
  trade_ready: true,
});

/*
 * A LIST LONG ENOUGH TO BE A LIST.
 *
 * The picker is a multi select with a cap of 20 and a scrolling body,
 * and against three rows none of that is visible: nothing scrolls, the
 * count never leaves single digits, and two of the three shared the
 * `…1111` tail so the one thing the address column is for — telling two
 * wallets apart when neither name helps — was never exercised.
 *
 * Every tail here is distinct, one is unlabelled so the fallback name
 * shows, and the balances descend so the list reads as real accounts
 * rather than copies.
 */
export const wallets = {
  wallets: [
    wallet(WALLET_ID, WALLET_PUBKEY, 'Main', true, 0),
    /* No label: every list that shows one has to fall back to the
       address, and a fixture where they all have labels never proves it. */
    wallet(WALLET_2_ID, WALLET_2_PUBKEY, null, false, 1),
    wallet('3b2a1c0d-9e8f-4a7b-b6c5-d4e3f2a1b0c9', 'SandboxAgentWa11et1111111111111111111111111', 'Agent', false, 2),
    wallet(WALLET_3_ID, WALLET_3_PUBKEY, 'Sniper', false, 3),
    wallet(WALLET_4_ID, WALLET_4_PUBKEY, 'Runner', false, 4),
    wallet(WALLET_5_ID, WALLET_5_PUBKEY, 'Cold store', false, 5),
    wallet(WALLET_6_ID, WALLET_6_PUBKEY, null, false, 6),
    wallet(WALLET_7_ID, WALLET_7_PUBKEY, 'Scalps', false, 7),
  ],
};

/*
 * IMPORTING ONE. The sandbox has no keypair maths and does not want any:
 * it derives a stable fake pubkey from the secret's own characters, so
 * pasting the same key twice lands on the same address and the duplicate
 * path is reachable. The secret is read for that hash and then dropped
 * on the floor; nothing here stores it.
 */
export function importWalletFixture(
  secret: string,
  label: string | null,
): { readonly duplicate: string | null; readonly wallet: Record<string, unknown> } {
  let h = 0;
  for (let i = 0; i < secret.length; i += 1) h = (h * 31 + secret.charCodeAt(i)) >>> 0;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let tail = '';
  let n = h;
  for (let i = 0; i < 36; i += 1) {
    n = (n * 1664525 + 1013904223) >>> 0;
    tail += alphabet[n % alphabet.length];
  }
  const pubkey = `Imp${tail}`;
  const existing = wallets.wallets.find(
    (w: Record<string, unknown>) => w['wallet_pubkey'] === pubkey,
  );
  if (existing) {
    return { duplicate: String(existing['wallet_account_id']), wallet: existing };
  }
  const id = `${h.toString(16).padStart(8, '0')}-0000-4000-8000-${(h ^ 0xa5a5a5a5).toString(16).padStart(12, '0').slice(-12)}`;
  const row = wallet(id, pubkey, label, false, wallets.wallets.length);
  wallets.wallets.push(row);
  /* Imported wallets arrive with whatever they hold; this one arrives
     empty, which is the honest default for a fixture that cannot read a
     chain. The balances list is what the table reads. */
  walletBalances.balances.push({
    wallet_account_id: id,
    wallet_pubkey: pubkey,
    lamports: lam(0),
    usdc_micro: '0',
  });
  return { duplicate: null, wallet: row };
}

/* ── tracker ─────────────────────────────────────────────────────────*/

export const trackedWallets = {
  wallets: [
    { address: 'Trak1ngWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', label: 'whale one', createdAtMs: NOW_MS - 12 * DAY },
    { address: 'Trak1ngWa11etBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', label: null, createdAtMs: NOW_MS - 5 * DAY },
    { address: 'Trak1ngWa11etCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', label: 'dev wallet', createdAtMs: NOW_MS - 2 * DAY },
  ],
};

export const trackerActivity = {
  events: Array.from({ length: 20 }, (_, i) => {
    const token = TOKENS[(i * 5 + 3) % TOKENS.length]!;
    return {
      signature: `SandboxTrack${i}1111111111111111111111111111111111111`,
      slot: 298_400_000 + i * 640,
      block_time_ms: NOW_MS - i * 40 * 60_000,
      wallet: trackedWallets.wallets[i % 3]!.address,
      mint: token.mint,
      is_buy: i % 3 !== 0,
      sol_lamports: lam(0.4 + i * 0.18),
      tokens: Math.round((2_400 + i * 610) * 10 ** token.decimals).toString(),
      venue: i % 2 ? 'amm' : 'bonding_curve',
      market_cap_lamports: lam(1_400 + i * 220),
    };
  }),
};

export const trackedAccounts = {
  accounts: [
    { handle: 'degenmike', createdAtMs: NOW_MS - 20 * DAY },
    { handle: 'kessel', createdAtMs: NOW_MS - 9 * DAY },
  ],
};

export const trackableAccounts = {
  accounts: LEADER_LABELS.slice(0, 8).map((handle, i) => ({
    handle,
    tweets: 240 - i * 22,
    lastMs: NOW_MS - i * 3 * HOUR,
  })),
};

/* ── the tracker's tweet feed ────────────────────────────────────────
 *
 * The left panel had nothing to render locally: `/api/tracker/available`
 * and `/api/tracker/accounts` fell through to the permissive bag, so the
 * page opened on "No accounts tracked" no matter what, and the tweet
 * card — header, media, quote, metrics — could never be looked at.
 *
 * These are the shape `TweetDTO` actually specifies, read off the type
 * rather than guessed, so the feed exercises the real card. Imagery
 * comes from picsum, the same source the hover card's own dev fixture
 * already uses.
 */

const MIN = 60_000;

/*
 * Tweet ages are the one thing in this file that CANNOT hang off the
 * frozen `NOW_MS`. Every other fixture is a figure you read; a tweet's
 * age is a figure you check against your own clock, and against a
 * timestamp from last August the whole feed reads "1y" — which is not a
 * feed. Evaluated once when the server module loads, so the column opens
 * with a spread of minutes and stays deterministic within a run.
 */
const TWEET_NOW = Date.now();
const pic = (seed: string, w = 600, h = 400) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const face = (seed: string) => `https://picsum.photos/seed/${seed}/96`;

interface FeedTweetSpec {
  handle: string;
  name: string;
  verified: boolean;
  followers: number;
  agoMin: number;
  text: string;
  images?: number;
  metrics: [views: number, likes: number, rts: number, replies: number];
}

const FEED: FeedTweetSpec[] = [
  {
    handle: 'degenmike',
    name: 'mike',
    verified: true,
    followers: 184_300,
    agoMin: 3,
    text: 'the tape does not care what you think it should do. it only cares what it is doing.',
    metrics: [88_400, 2_140, 318, 96],
  },
  {
    handle: 'kessel',
    name: 'kessel',
    verified: true,
    followers: 61_800,
    agoMin: 14,
    text:
      'four charts from this morning. same setup, four different outcomes, and the only thing that changed was where people were already sitting.',
    images: 4,
    metrics: [212_000, 6_910, 1_240, 402],
  },
  {
    handle: 'degenmike',
    name: 'mike',
    verified: true,
    followers: 184_300,
    agoMin: 38,
    text: 'sold the top. bought it back higher. this is the job.',
    metrics: [41_200, 1_880, 214, 173],
  },
  {
    handle: 'kessel',
    name: 'kessel',
    verified: true,
    followers: 61_800,
    agoMin: 71,
    text:
      'a wallet that has been quiet for eleven weeks moved forty thousand this morning and everyone found out at the same time. that is the whole edge, gone in one block.',
    images: 1,
    metrics: [604_000, 18_400, 5_120, 890],
  },
  {
    handle: 'degenmike',
    name: 'mike',
    verified: true,
    followers: 184_300,
    agoMin: 126,
    text: 'unpopular: most of you do not need a faster fill. you need to press fewer buttons.',
    metrics: [156_000, 7_240, 1_640, 511],
  },
  {
    handle: 'kessel',
    name: 'kessel',
    verified: true,
    followers: 61_800,
    agoMin: 204,
    text: 'nothing happened today and that is also information.',
    metrics: [22_900, 940, 88, 41],
  },
];

export const trackerTweets = {
  tweets: FEED.map((t, i) => ({
    id: `sandbox-tweet-${i}`,
    url: `https://x.com/${t.handle}/status/19${(1_000_000_000 + i * 7_331).toString()}`,
    createdAtMs: TWEET_NOW - t.agoMin * MIN,
    text: t.text,
    lang: 'en',
    author: {
      handle: t.handle,
      name: t.name,
      avatarUrl: face(t.handle),
      verified: t.verified,
      followersCount: t.followers,
      joinedAtMs: TWEET_NOW - 2_100 * DAY,
    },
    media: {
      images: Array.from({ length: t.images ?? 0 }, (_, k) => ({
        url: pic(`${t.handle}-${i}-${k}`, 600, 400),
        width: 600,
        height: 400,
      })),
      videos: [],
    },
    metrics: {
      views: t.metrics[0],
      likes: t.metrics[1],
      retweets: t.metrics[2],
      replies: t.metrics[3],
      bookmarks: Math.round(t.metrics[1] / 9),
    },
    card: null,
    replyTo: null,
    quoted: null,
    source: 'fixture' as const,
    capturedAtMs: TWEET_NOW - t.agoMin * MIN + 400,
  })),
};

/**
 * `/api/tracker/available` — the handles the capture has tweets for.
 * The reader takes `handles`, not `accounts`; the older
 * `trackableAccounts` fixture named the wrong key and was never wired
 * to this route.
 */
export const trackerAvailable = {
  handles: [
    { handle: 'degenmike', tweets: 312, lastMs: TWEET_NOW - 3 * MIN },
    { handle: 'kessel', tweets: 208, lastMs: TWEET_NOW - 14 * MIN },
    { handle: 'chainwatch', tweets: 141, lastMs: TWEET_NOW - 2 * HOUR },
    { handle: 'solnoise', tweets: 96, lastMs: TWEET_NOW - 5 * HOUR },
    { handle: 'mintfloor', tweets: 74, lastMs: TWEET_NOW - 9 * HOUR },
    { handle: 'thintape', tweets: 51, lastMs: TWEET_NOW - 26 * HOUR },
  ],
};

/* ── settings and capabilities ───────────────────────────────────────*/

export const tradeCapabilities = {
  ok: true,
  can_trade: true,
  chains: ['solana'],
  max_slippage_bps: 5_000,
  min_sol_lamports: lam(0.001),
};

export const tradingSettings = {
  slippage_bps: 150,
  priority_fee_lamports: lam(0.000_05),
  bribe_lamports: lam(0.000_1),
  confirm_before_send: true,
  default_sol_amount: 0.5,
};

/* ── frens ───────────────────────────────────────────────────────────*/

/*
 * ── THIS FIXTURE DID NOT EXIST ───────────────────────────────────────
 *
 * `v1/frens/leaderboard` was not in the route table at all, so it fell
 * through to the generic empty bag and the board rendered `No public
 * frens yet` over `0 FRENS ON THE BOARD · 0 SCORED CALLS`.
 *
 * That is a different fault from the camelCase ones on rewards: those
 * fixtures existed and were shaped wrong, this one was simply absent.
 * Same symptom on screen, and the same problem for design work — a
 * header cannot be judged against zeros.
 *
 * Snake case throughout, because `fetchFrenLeaderboard` reads the wire
 * format key by key.
 */

const FREN_NAMES: ReadonlyArray<readonly [string, string, string]> = [
  ['soren', 'Soren', 'Momentum only. If it is not moving I am not looking.'],
  ['aster', 'aster', 'Early on infra plays. Long horizons, few positions.'],
  ['brixby', 'brixby', 'Scalps the open, flat by noon.'],
  ['delune', 'delune', 'Reads the chain, not the chat.'],
  ['evren', 'evren', 'Mostly wrong, occasionally very right.'],
  ['fenwick', 'fenwick', 'Size when it is obvious, nothing when it is not.'],
  ['grigg', 'grigg', 'Meme structure and liquidity. Nothing else.'],
  ['halcy', 'halcy', 'Patient. Two or three calls a month.'],
  ['ibsen', 'ibsen', 'Fades every top signal he sees.'],
  ['jorvik', 'jorvik', 'Runs a basket, rebalances weekly.'],
  ['kessel', 'kessel', 'Only trades what he already holds.'],
  ['lumen', 'lumen', 'New here. Learning in public.'],
];

/* Pulled off `TOKENS` rather than written out again, so a call always
   points at a mint the rest of the sandbox already knows about — the
   logo, the price and the name all resolve. */
const CALL_MINTS: ReadonlyArray<readonly [string, string]> = TOKENS.filter(
  (t) => t.symbol !== 'SOL' && t.symbol !== 'USDC',
).map((t) => [t.mint, t.symbol] as const);

const THESES: ReadonlyArray<string> = [
  'Supply is tight and the dev wallet has not moved in three weeks.',
  'Every dip since launch has been bought inside an hour.',
  'Holder count is up and the top ten is flat. That is real distribution.',
  'It survived a 40% drawdown without the book thinning. That matters.',
  'Liquidity doubled overnight and nobody is talking about it yet.',
  'The chart is ugly and the flow is not. I trust the flow.',
];

/*
 * PnL is signed on purpose and two of the twelve are DOWN. A board
 * where everybody is up is a board nobody believes, and the row that
 * renders a loss is the one most likely to be styled wrong.
 */
export const frensLeaderboard = {
  rows: FREN_NAMES.map(([slug, label, bio], i) => {
    const down = i === 4 || i === 10;
    const pnl = down ? -(18 + i * 4.5) : 940 / (i + 1.15) + 12;
    const wins = Math.max(1, Math.round(38 - i * 2.6));
    const losses = Math.max(1, Math.round(6 + i * 1.7));
    const [mint, ticker] = CALL_MINTS[i % CALL_MINTS.length]!;
    return {
      user_id: `fren_${1000 + i}`,
      label,
      slug,
      avatar_data_url: null,
      bio,
      primary_wallet_pubkey: null,
      pnl_lamports: lam(pnl),
      volume_lamports: lam(14_800 / (i + 1.1) + 220),
      /*
       * These four have to add up or the cells that show them lie.
       * `positions` is every closed position, so wins and losses
       * PARTITION it; `trades` is the fills those positions took, so it
       * is always the larger number, and buys and sells partition that.
       *
       * It shipped the other way round: 9 positions carrying a 38 / 6
       * split under them.
       */
      positions: wins + losses,
      wins,
      losses,
      trades: Math.round((wins + losses) * 2.3),
      buys: Math.round(Math.round((wins + losses) * 2.3) * 0.56),
      sells: Math.round((wins + losses) * 2.3) - Math.round(Math.round((wins + losses) * 2.3) * 0.56),
      /*
       * Spread as MULTIPLES, because that is how the figure reads now:
       * 12.4x at the top down to about 3.3x, so the strip shows the
       * range the format is built for rather than a dozen cards all
       * under 2x.
       *
       * One fren has never made a call, so the column has to render a
       * row with nothing in it.
       */
      best_call_pct: i === 11 ? null : Math.round((12.4 / (1 + i * 0.28) - 1) * 1000) / 10,
      best_call_id: i === 11 ? null : `call_${2000 + i}`,
      best_call_mint: i === 11 ? null : mint,
      best_call_ticker: i === 11 ? null : ticker,
      best_call_image_url: i === 11 ? null : logo(mint),
      best_call_thesis: i === 11 ? null : THESES[i % THESES.length]!,
      best_call_at: i === 11 ? null : iso(i * 9 * HOUR),
      calls_count: Math.max(0, 21 - i * 2),
    };
  }),
  top_calls: CALL_MINTS.map(([mint, ticker], i) => {
    const [slug, label] = FREN_NAMES[i]!;
    return {
      call_id: `call_${2000 + i}`,
      user_id: `fren_${1000 + i}`,
      label,
      avatar_data_url: null,
      primary_wallet_pubkey: null,
      mint,
      ticker,
      image_url: logo(mint),
      thesis: THESES[i % THESES.length]!,
      created_at: iso(i * 9 * HOUR),
      pct: Math.round((12.4 / (1 + i * 0.28) - 1) * 1000) / 10,
      slug,
    };
  }),
};

export const frensProfile = {
  label: 'Soren',
  slug: 'designer',
  bio: 'Momentum only. If it is not moving I am not looking.',
  avatar_data_url: null,
  banner_data_url: null,
  visibility: 'public',
};

/*
 * ── ONE CALL, IN FULL ────────────────────────────────────────────────
 *
 * `v1/frens/call` had no fixture either, so clicking a card on the
 * strip opened nothing at all — the modal fetched, got the generic
 * empty bag, failed its shape guard and rendered as if the call did not
 * exist. Third missing route on this page.
 *
 * The market caps are the whole story of a call and they are what the
 * badge is computed from: what it was worth when they called it, what
 * it peaked at, what it is worth now, and where they sold if they did.
 *
 * The five badges are all represented across the six calls, because a
 * card that has only ever been seen in its `banger` state is a card
 * whose other four states have never been looked at.
 */
const CALL_SHAPES: ReadonlyArray<{
  badge: 'banger' | 'semi_fumble' | 'fumble' | 'loss' | 'holding';
  called: number;
  peak: number;
  now: number | null;
  sold: number | null;
}> = [
  /* Called early, rode it, still holding. */
  { badge: 'holding', called: 210_000, peak: 2_610_000, now: 2_410_000, sold: null },
  /* Sold near the top. */
  { badge: 'banger', called: 340_000, peak: 3_290_000, now: 1_880_000, sold: 3_100_000 },
  /* Sold on the way up and left most of it on the table. */
  { badge: 'semi_fumble', called: 480_000, peak: 3_810_000, now: 2_240_000, sold: 1_150_000 },
  /* Sold near the bottom after a run. */
  { badge: 'fumble', called: 520_000, peak: 3_500_000, now: 1_640_000, sold: 610_000 },
  /* Never worked. */
  { badge: 'loss', called: 1_240_000, peak: 1_310_000, now: 380_000, sold: 410_000 },
  { badge: 'holding', called: 690_000, peak: 2_270_000, now: 2_050_000, sold: null },
];

/*
 * Keyed off FREN_NAMES, not CALL_MINTS.
 *
 * The board has twelve frens and each one's `best_call_id` is
 * `call_2000 + i`, but this was built from the five call mints — so
 * ids `call_2005` and up resolved to nothing and seven of the twelve
 * cards opened on `This call is private or unavailable`. The mints
 * cycle instead.
 */
export const frensCalls = Object.fromEntries(
  FREN_NAMES.slice(0, 11).map(([, label], i) => {
    const [mint, ticker] = CALL_MINTS[i % CALL_MINTS.length]!;
    const shape = CALL_SHAPES[i % CALL_SHAPES.length]!;
    const at = i * 9 * HOUR;
    return [
      `call_${2000 + i}`,
      {
        call_id: `call_${2000 + i}`,
        caller_user_id: `fren_${1000 + i}`,
        caller_label: label,
        caller_avatar_data_url: null,
        mint,
        ticker,
        name: TOKENS.find((t) => t.mint === mint)?.name ?? ticker,
        image_url: logo(mint),
        thesis: THESES[i % THESES.length]!,
        created_at: iso(at),
        called_mc_usd: shape.called,
        peak_mc_usd: shape.peak,
        current_mc_usd: shape.now,
        sold_mc_usd: shape.sold,
        badge: shape.badge,
        /* A buy at the call and, where they sold, a sell after it. The
           chart draws these as bubbles on the caller's own line. */
        caller_trades: shape.sold
          ? [
              { t_ms: NOW_MS - at, side: 'buy' },
              { t_ms: NOW_MS - at + 6 * HOUR, side: 'sell' },
            ]
          : [{ t_ms: NOW_MS - at, side: 'buy' }],
      },
    ];
  }),
);

/*
 * ── CANDLES ──────────────────────────────────────────────────────────
 *
 * The call card's chart read `No chart data yet.` in a box taller than
 * anything else on the card. It was not broken: it fetches
 * `/api/token/<mint>/candles` from the ingestion service, and
 * `NEXT_PUBLIC_INGESTION_API_BASE` is empty here, so the request came
 * back to this app's own catch-all and found nothing.
 *
 * Prices are a NUMERATOR over a DENOMINATOR, not floats. That is how
 * they arrive on the wire — an exact ratio of lamports to token base
 * units — and rounding them to a number here would be a different type
 * than production sends.
 *
 * The walk is seeded off the mint, so a token's chart is the same shape
 * every time it is opened rather than reshuffling on each render.
 */
export function candlesFor(mint: string, limit: number, bucketSec: number) {
  let seed = 0;
  for (let i = 0; i < mint.length; i += 1) seed = (seed * 31 + mint.charCodeAt(i)) | 0;
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const n = Math.max(24, Math.min(limit, 240));
  const nowSec = Math.floor(NOW_MS / 1000);
  const start = nowSec - n * bucketSec;

  /* A shape a call actually has: a base, a run, a peak, a fade. Pure
     noise would draw a chart no call was ever made on. */
  let price = 0.0000012 + rand() * 0.0000004;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const arc = t < 0.62 ? t / 0.62 : 1 - ((t - 0.62) / 0.38) * 0.28;
    const drift = 1 + arc * 9.4;
    const noise = 1 + (rand() - 0.5) * 0.09;
    const close = price * drift * noise;
    const open = i === 0 ? close * 0.98 : close / (1 + (rand() - 0.5) * 0.05);
    const high = Math.max(open, close) * (1 + rand() * 0.04);
    const low = Math.min(open, close) * (1 - rand() * 0.04);
    const q = (v: number) => ({ num: Math.round(v * 1e18).toString(), den: '1000000000000000000' });
    const o = q(open);
    const h = q(high);
    const l = q(low);
    const c = q(close);
    out.push({
      resolution: '1m',
      bucketStartSec: start + i * bucketSec,
      open_num: o.num,
      open_den: o.den,
      high_num: h.num,
      high_den: h.den,
      low_num: l.num,
      low_den: l.den,
      close_num: c.num,
      close_den: c.den,
      volBuyLamports: lam(40 + rand() * 260),
      volSellLamports: lam(30 + rand() * 220),
      trades: Math.round(18 + rand() * 90),
    });
  }
  return out;
}

/*
 * ── ONE FREN, IN FULL ────────────────────────────────────────────────
 *
 * `v1/frens/detail` had no fixture, so the profile modal fetched, got
 * the generic empty bag, found no `detail` key, failed its shape guard
 * with `malformed_detail` and rendered "This fren is private or
 * unavailable" for every fren on the board.
 *
 * `v1/frens/profile` DOES exist and is a different endpoint: it is the
 * signed in user's OWN editable profile (label, slug, visibility), not
 * another fren's public one. Having one and not the other is what made
 * this look like a permissions problem rather than a missing route.
 *
 * Built from the leaderboard row so the modal and the board can never
 * disagree about somebody's PnL, and the windows are derived from the
 * all time figure rather than invented: 7 days is a slice of 30, which
 * is a slice of all.
 */
export function frenDetailFor(userId: string): Record<string, unknown> | null {
  const row = frensLeaderboard.rows.find((r) => r.user_id === userId);
  if (!row) return null;

  const pnlAll = Number(row.pnl_lamports);
  const volAll = Number(row.volume_lamports);
  const agg = (pnlShare: number, volShare: number, tradeShare: number) => ({
    pnl_lamports: Math.round(pnlAll * pnlShare).toString(),
    volume_lamports: Math.round(volAll * volShare).toString(),
    trades: Math.max(1, Math.round(row.trades * tradeShare)),
  });

  const topCalls = Object.entries(frensCalls)
    .filter(([, c]) => (c as { caller_user_id: string }).caller_user_id === userId)
    .map(([callId, c]) => {
      const call = c as Record<string, unknown>;
      const called = call['called_mc_usd'] as number;
      const peak = call['peak_mc_usd'] as number;
      return {
        call_id: callId,
        user_id: userId,
        label: row.label,
        avatar_data_url: null,
        primary_wallet_pubkey: row.primary_wallet_pubkey,
        mint: call['mint'],
        ticker: call['ticker'],
        image_url: call['image_url'],
        thesis: call['thesis'],
        created_at: call['created_at'],
        /* Percent to peak, which is what the strip and the board both
           render as a multiple. */
        pct: Math.round((peak / called - 1) * 1000) / 10,
      };
    });

  return {
    user_id: row.user_id,
    label: row.label,
    bio: row.bio,
    avatar_data_url: null,
    banner_data_url: null,
    primary_wallet_pubkey: row.primary_wallet_pubkey,
    trading: {
      all: agg(1, 1, 1),
      d30: agg(0.72, 0.68, 0.7),
      d7: agg(0.31, 0.24, 0.26),
    },
    wins: row.wins,
    losses: row.losses,
    calls_count: row.calls_count,
    calls_2x: Math.max(0, Math.round(row.calls_count * 0.6)),
    best_call_pct: row.best_call_pct,
    top_calls: topCalls,
  };
}

/*
 * ── CONDITIONALS ─────────────────────────────────────────────────────
 *
 * `GET /api/trade/conditionals` had no fixture, so the page rendered its
 * empty state — "Nothing is watching yet" — on every tab, and there was
 * nothing to design the ledger against.
 *
 * The set below fills all four tabs, because membership is by HOW A PLAY
 * ENDED (`views.ts`): History is what ended well or by your own hand,
 * Expired is what ran out of time, Failed is what ended in an error, and
 * Active is everything still running.
 *
 * It also covers the states that are not just "watching": both pause
 * reasons, a cancel in flight, a plan the evaluator is behind on, and a
 * semantic plan carrying a classifier tally. Each renders differently,
 * and an all-armed fixture would show none of them.
 */
const COND_MINTS: ReadonlyArray<readonly [string, string]> = [
  ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'BONK'],
  ['EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 'WIF'],
  ['7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', 'POPCAT'],
  ['MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', 'MEW'],
  ['5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC', 'PONKE'],
  ['CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', 'GOAT'],
];

const condIso = (msAgo: number) => new Date(NOW_MS - msAgo).toISOString();

interface CondSeed {
  readonly state: string;
  readonly effective?: string;
  readonly summary: string;
  readonly source: string;
  readonly mint: number;
  readonly createdAgo: number;
  readonly expiresIn: number | null;
  readonly fired?: number;
  readonly qualifier?: { kind: string; n?: number; cooldown_s?: number };
  readonly economics?: { spent: number; received: number; openRuns: number };
  readonly pause?: { reason: string; required: number; balance: number; leg: number };
  readonly classifier?: { evaluations: number; accepted: number; rejected: number };
  readonly syncPending?: boolean;
  readonly notify?: string;
}

const COND_SEEDS: ReadonlyArray<CondSeed> = [
  {
    state: 'armed',
    summary: 'Every time BONK falls 15% in an hour, buy 2 SOL. Until Friday.',
    source: 'every time bonk dumps 15% in an hour put 2 sol in, stop friday',
    mint: 0,
    createdAgo: 4 * HOUR,
    expiresIn: 3 * DAY,
    fired: 2,
    qualifier: { kind: 'every', cooldown_s: 3600 },
    economics: { spent: 4, received: 4.86, openRuns: 1 },
    notify: 'alert',
  },
  {
    state: 'armed',
    summary: 'When WIF crosses $2.40, sell half the position. Once.',
    source: 'sell half my wif at 2.40',
    mint: 1,
    createdAgo: 19 * HOUR,
    expiresIn: 6 * DAY,
    qualifier: { kind: 'once' },
  },
  {
    /* A semantic predicate: the judge keeps a running tally and the row
       renders it. An all-armed fixture never shows this. */
    state: 'armed',
    summary: 'If the POPCAT team ships the promised burn, buy 3 SOL. First 2.',
    source: 'if popcat actually does the burn they promised, ape 3 sol, twice max',
    mint: 2,
    createdAgo: 2 * DAY,
    expiresIn: 11 * DAY,
    qualifier: { kind: 'first_n', n: 2 },
    classifier: { evaluations: 41, accepted: 0, rejected: 38 },
    notify: 'inbox',
  },
  {
    /* The evaluator is still behind this plan's version. */
    state: 'armed',
    summary: 'When MEW liquidity doubles, buy 1.5 SOL. Once.',
    source: 'buy 1.5 sol of mew if liquidity doubles',
    mint: 3,
    createdAgo: 40 * 60_000,
    expiresIn: 2 * DAY,
    qualifier: { kind: 'once' },
    syncPending: true,
  },
  {
    /* 0159: not enough SOL to claim the next firing. */
    state: 'paused',
    summary: 'Every 10% dip on PONKE, buy 5 SOL. Until the end of the month.',
    source: 'ladder into ponke, 5 sol every 10% down',
    mint: 4,
    createdAgo: 3 * DAY,
    expiresIn: 9 * DAY,
    fired: 3,
    qualifier: { kind: 'every', cooldown_s: 1800 },
    economics: { spent: 15, received: 12.4, openRuns: 2 },
    pause: { reason: 'insufficient_funds', required: 5.02, balance: 1.86, leg: 1 },
  },
  {
    /* 0189: the exit kept failing and the core gave up. */
    state: 'budget_paused',
    summary: 'If GOAT drops below $1.80, sell everything. Once.',
    source: 'dump all my goat under 1.80',
    mint: 5,
    createdAgo: 5 * DAY,
    expiresIn: 4 * DAY,
    qualifier: { kind: 'once' },
    pause: { reason: 'exit_failed', required: 0.14, balance: 0.09, leg: 1 },
  },
  {
    state: 'cancel_requested',
    summary: 'When BONK reclaims $0.000042, buy 4 SOL. Once.',
    source: 'buy 4 sol bonk if it reclaims 42',
    mint: 0,
    createdAgo: 26 * HOUR,
    expiresIn: 5 * DAY,
    qualifier: { kind: 'once' },
  },

  /* ── ended well, or by your own hand: History ── */
  {
    state: 'armed',
    effective: 'completed',
    summary: 'When WIF hit $1.90, buy 3 SOL. Once.',
    source: 'grab 3 sol of wif at 1.90',
    mint: 1,
    createdAgo: 6 * DAY,
    expiresIn: null,
    fired: 1,
    qualifier: { kind: 'once' },
    economics: { spent: 3, received: 7.42, openRuns: 0 },
  },
  {
    state: 'cancelled',
    summary: 'Every time MEW gains 20% in a day, take 1 SOL off. Until Sunday.',
    source: 'trim 1 sol of mew on every 20% up day',
    mint: 3,
    createdAgo: 8 * DAY,
    expiresIn: null,
    fired: 2,
    qualifier: { kind: 'every', cooldown_s: 86400 },
    economics: { spent: 0, received: 2.31, openRuns: 0 },
  },

  /* ── ran out of time: Expired ── */
  {
    state: 'expired',
    summary: 'If POPCAT broke $1.10 before Tuesday, buy 2 SOL. Once.',
    source: 'buy 2 sol popcat if it breaks 1.10 before tuesday',
    mint: 2,
    createdAgo: 11 * DAY,
    expiresIn: null,
    qualifier: { kind: 'once' },
  },
  {
    state: 'expiry_pending',
    summary: 'Every 5% dip on GOAT, buy 1 SOL. Lifetime reached.',
    source: 'dca into goat every 5% down',
    mint: 5,
    createdAgo: 9 * DAY,
    expiresIn: null,
    fired: 4,
    qualifier: { kind: 'every', cooldown_s: 7200 },
    economics: { spent: 4, received: 3.12, openRuns: 1 },
  },

  /* -- ended in an error: Failed --
     Not one of migration 0072's ten states, so it can only arrive as an
     open enum value. Without a row here the fourth tab can never be seen. */
  {
    state: 'failed',
    summary: 'When PONKE crossed $0.60, buy 6 SOL. Once.',
    source: 'buy 6 sol of ponke at 60c',
    mint: 4,
    createdAgo: 7 * DAY,
    expiresIn: null,
    fired: 1,
    qualifier: { kind: 'once' },
    economics: { spent: 6, received: 0, openRuns: 1 },
  },
];

export const conditionalsList = {
  conditionals: COND_SEEDS.map((c, i) => {
    const [mint, symbol] = COND_MINTS[c.mint]!;
    const row: Record<string, unknown> = {
      conditional_id: `cond_${3000 + i}`,
      state: c.state,
      version: 1,
      qualifier: c.qualifier ?? { kind: 'once' },
      ast_hash: `0x${(0xa1b2c3 + i * 7919).toString(16)}`,
      created_by: 'chat',
      created_at: condIso(c.createdAgo),
      expires_at: c.expiresIn === null ? null : new Date(NOW_MS + c.expiresIn).toISOString(),
      summary: c.summary,
      source_text: c.source,
      token: { mint, symbol },
      notification_mode: c.notify ?? 'inherit',
    };
    if (c.effective !== undefined) row['effective_state'] = c.effective;
    if (c.fired !== undefined) row['fired_count'] = c.fired;
    if (c.economics) {
      const net = c.economics.received - c.economics.spent;
      row['economics'] = {
        spent_lamports: lam(c.economics.spent),
        received_lamports: lam(c.economics.received),
        net_lamports: lam(net),
        net_bps: c.economics.spent > 0 ? Math.round((net / c.economics.spent) * 10_000) : null,
        open_runs: c.economics.openRuns,
      };
    }
    if (c.pause) {
      row['pause'] = {
        reason: c.pause.reason,
        required_lamports: lam(c.pause.required),
        balance_lamports: lam(c.pause.balance),
        available_lamports: lam(Math.max(0, c.pause.balance - 0.02)),
        shortfall_lamports: lam(Math.max(0, c.pause.required - c.pause.balance)),
        leg_no: c.pause.leg,
        ...(c.pause.reason === 'exit_failed' ? { attempts: 5, max_attempts: 5 } : {}),
      };
    }
    if (c.classifier) {
      row['classifier'] = {
        evaluations: c.classifier.evaluations,
        accepted: c.classifier.accepted,
        rejected: c.classifier.rejected,
        unknown: c.classifier.evaluations - c.classifier.accepted - c.classifier.rejected,
        pending: 0,
        cost_micro: String(c.classifier.evaluations * 1_240),
        last_evaluated_at: condIso(11 * 60_000),
        model_version: 'judge-2026-08',
        rubrics: [],
      };
    }
    if (c.syncPending !== undefined) row['sync_pending'] = c.syncPending;
    return row;
  }),
};

/*
 * ── ONE CONDITIONAL, OPENED ──────────────────────────────────────────
 *
 * `GET /api/trade/conditionals/:id` and `/:id/state` had no fixture, so
 * every row on the ledger linked to a page that said "Conditionals are
 * unreachable" — the list was clickable and the click went nowhere.
 *
 * Both are derived from the SAME seeded row the list serves, so the
 * detail can never disagree with the row you clicked: the legs, the
 * firings, the executions and the event timeline are all built from that
 * row's own state, fired count and clock.
 */

type CondRow = Record<string, unknown>;

function condRow(id: string): CondRow | null {
  return conditionalsList.conditionals.find((r) => r['conditional_id'] === id) ?? null;
}

/** A firing per fire, spread across the plan's life, newest last. */
function condFirings(row: CondRow): Record<string, unknown>[] {
  const fired = typeof row['fired_count'] === 'number' ? (row['fired_count'] as number) : 0;
  if (fired <= 0) return [];
  const born = Date.parse(String(row['created_at']));
  const ends = row['expires_at'] === null ? born + 7 * DAY : Date.parse(String(row['expires_at']));
  const open = ((row['economics'] as Record<string, unknown> | undefined)?.['open_runs'] as number) ?? 0;
  const failed = row['state'] === 'failed';
  const buys = Array.from({ length: fired }, (_, i) => {
    const at = born + ((ends - born) * (i + 1)) / (fired + 2);
    // The runs still open are the LAST ones: a plan settles in order.
    const stillOpen = i >= fired - open;
    return {
      id: `fir_${row['conditional_id']}_${i + 1}`,
      leg_id: `leg_${row['conditional_id']}_1`,
      slot_no: null,
      occurrence_seq: i + 1,
      entity_key: null,
      plan_run_id: `run_${row['conditional_id']}_${i + 1}`,
      operation_id: `op_${row['conditional_id']}_${i + 1}`,
      claimed_version: 1,
      state: failed ? 'failed' : stillOpen ? 'dispatched' : 'filled',
      claimed_at: new Date(at).toISOString(),
      mint: (row['token'] as Record<string, unknown>)['mint'],
      token: row['token'],
      side: 'buy',
    };
  });
  /*
   * The exit. A plan that received anything sold at some point, and
   * without a sell firing the page can compute a spend and never a net
   * — which is how the detail showed no money at all while the row that
   * links to it showed +0.86.
   */
  const got = solOf((row['economics'] as Record<string, unknown> | undefined)?.['received_lamports']);
  if (got <= 0) return buys;
  return [
    ...buys,
    {
      id: `fir_${row['conditional_id']}_exit`,
      leg_id: `leg_${row['conditional_id']}_1`,
      slot_no: null,
      /* The exit belongs to the run it closes, so it shares that run's
         sequence: a sell is not a third time the plan fired, and the
         page counts distinct sequences to say how many runs there were. */
      occurrence_seq: fired,
      entity_key: null,
      plan_run_id: `run_${row['conditional_id']}_exit`,
      operation_id: `op_${row['conditional_id']}_exit`,
      claimed_version: 1,
      state: 'filled',
      claimed_at: new Date(born + ((ends - born) * (fired + 1)) / (fired + 2)).toISOString(),
      mint: (row['token'] as Record<string, unknown>)['mint'],
      token: row['token'],
      side: 'sell',
    },
  ];
}

/** Lamport string to a number of SOL. */
function solOf(lamports: unknown): number {
  return typeof lamports === 'string' && /^-?\d+$/.test(lamports) ? Number(lamports) / 1e9 : 0;
}

/**
 * The engine's fill facts, which is where the page's money actually
 * comes from: the plan's spend split across the buys, its receipts on
 * the exit, and one token count both sides agree on so the rollup can
 * call it a round trip.
 */
function condFillTimes(row: CondRow, firings: Record<string, unknown>[]): Record<string, unknown> {
  const econ = row['economics'] as Record<string, unknown> | undefined;
  if (econ === undefined) return { available: false };
  const spent = solOf(econ['spent_lamports']);
  const got = solOf(econ['received_lamports']);
  const filled = firings.filter((f) => f['state'] === 'filled');
  const buys = filled.filter((f) => f['side'] === 'buy');
  const tokensEach = 1_000_000_000; // 1000 whole tokens at 1e6 base units
  return {
    available: true,
    entries: filled.map((f) => {
      const sell = f['side'] === 'sell';
      const sol = sell ? got : buys.length === 0 ? 0 : spent / buys.length;
      const tokens = sell ? tokensEach * buys.length : tokensEach;
      return {
        operation_id: f['operation_id'],
        confirmed_at_ms: Date.parse(String(f['claimed_at'])) + 90_000,
        fill_count: 1,
        side: sell ? 'sell' : 'buy',
        sol_delta_lamports: String(Math.round(sol * 1e9) * (sell ? 1 : -1)),
        swap_sol_lamports: String(Math.round(sol * 1e9)),
        token_delta_base_units: String(tokens * (sell ? -1 : 1)),
      };
    }),
  };
}

function condExecutions(row: CondRow, firings: Record<string, unknown>[]): Record<string, unknown>[] {
  return firings.map((f) => ({
    operation_id: f['operation_id'],
    firing_id: f['id'],
    proposal_id: `prop_${row['conditional_id']}`,
    state: f['state'] === 'filled' ? 'filled' : f['state'] === 'failed' ? 'failed' : 'dispatched',
    tx_signature:
      f['state'] === 'filled' ? `${String(f['operation_id'])}xSIGNATUREabcdefghijklmnopqrstuvwxyz012345` : null,
    created_at: f['claimed_at'],
    updated_at: f['claimed_at'],
  }));
}

/** The lifecycle journal, oldest first, exactly as the route serves it. */
function condEvents(row: CondRow, firings: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [
    { seq: 1, transition: 'armed', actor: 'api', evidence: null, created_at: row['created_at'] },
  ];
  firings.forEach((f) => {
    out.push({
      seq: out.length + 1,
      transition: 'firing_claimed',
      actor: 'evaluator',
      evidence: { firing_id: f['id'] },
      created_at: f['claimed_at'],
    });
    if (f['state'] !== 'dispatched') {
      out.push({
        seq: out.length + 1,
        transition: 'firing_settled',
        actor: 'executor',
        evidence: { firing_id: f['id'], result: f['state'] },
        created_at: new Date(Date.parse(String(f['claimed_at'])) + 4 * 60_000).toISOString(),
      });
    }
  });
  const last: Record<string, string> = {
    paused: 'paused',
    budget_paused: 'budget_paused',
    cancelled: 'cancelled',
    cancel_requested: 'cancelled',
    expired: 'expired',
    expiry_pending: 'expired',
    failed: 'failed',
  };
  const closing = last[String(row['effective_state'] ?? row['state'])];
  if (closing !== undefined) {
    out.push({
      seq: out.length + 1,
      transition: closing,
      actor: closing === 'cancelled' ? 'you' : 'sweep',
      evidence: null,
      created_at: condIso(2 * HOUR),
    });
  }
  if (row['effective_state'] === 'completed') {
    out.push({ seq: out.length + 1, transition: 'completed', actor: 'api', evidence: null, created_at: condIso(2 * HOUR) });
  }
  return out;
}

function condLeg(row: CondRow): Record<string, unknown> {
  const ended = ['completed', 'cancelled', 'expired', 'expiry_pending', 'failed'].includes(
    String(row['effective_state'] ?? row['state']),
  );
  return {
    id: `leg_${row['conditional_id']}_1`,
    leg_no: 1,
    condition_nodes: null,
    condition_hash: `0x${String(row['conditional_id']).slice(-4)}c0nd`,
    action_payload: null,
    payload_hash: `0x${String(row['conditional_id']).slice(-4)}pay1`,
    position_binding: null,
    partial_fill_policy: 're_arm_remainder',
    state: ended ? 'completed' : row['state'] === 'paused' || row['state'] === 'budget_paused' ? 'paused' : 'armed',
    expires_at: row['expires_at'],
  };
}

export function conditionalDetailFor(id: string): Record<string, unknown> | null {
  const row = condRow(id);
  if (row === null) return null;
  return {
    conditional_id: row['conditional_id'],
    state: row['state'],
    ...(row['effective_state'] === undefined ? {} : { effective_state: row['effective_state'] }),
    ...(row['pause'] === undefined ? {} : { pause: row['pause'] }),
    version: row['version'],
    qualifier: row['qualifier'],
    ast_hash: row['ast_hash'],
    proposal_id: `prop_${row['conditional_id']}`,
    created_by: row['created_by'],
    source_text: row['source_text'],
    summary: row['summary'],
    token: row['token'],
    notification_mode: row['notification_mode'],
    created_at: row['created_at'],
    expires_at: row['expires_at'],
    legs: [condLeg(row)],
    firings: condFirings(row),
    ...(row['economics'] === undefined ? {} : { economics: row['economics'] }),
  };
}

export function conditionalStateFor(id: string): Record<string, unknown> | null {
  const row = condRow(id);
  if (row === null) return null;
  const firings = condFirings(row);
  return {
    conditional_id: row['conditional_id'],
    state: row['state'],
    ...(row['effective_state'] === undefined ? {} : { effective_state: row['effective_state'] }),
    ...(row['pause'] === undefined ? {} : { pause: row['pause'] }),
    version: row['version'],
    legs: [condLeg(row)],
    firings,
    executions: condExecutions(row, firings),
    events: condEvents(row, firings),
    /* The event plane is a separate service and this sandbox does not
       stand one up. Saying so is what the real route does when it is
       down, and the page is built to degrade on exactly this flag. */
    fill_times: condFillTimes(row, firings),
    detail: { detail_available: false, reason: 'event_plane_unreachable' },
    ...(row['classifier'] === undefined ? {} : { classifier: row['classifier'] }),
    sync: { in_sync: row['sync_pending'] !== true, platform_version: 1 },
    ...(row['economics'] === undefined ? {} : { economics: row['economics'] }),
  };
}
