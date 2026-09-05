import { NextResponse } from 'next/server';
import { idleSseResponse, wantsEventStream } from '../../../sandbox/idleStream';
import * as mock from '../../../sandbox/mockData';
import * as mockLane from '../../../sandbox/laneResponse';

/**
 * Catch-all for every backend route the export references but does not
 * include: auth, trading, orders, portfolio, tracker, rewards, frens,
 * notifications, telemetry, wallet custody. Without it the UI still paints
 * but the console fills with 404s, which buries the real errors you want to
 * see while you are working.
 *
 * The two discover envelopes are NOT handled here — they have their own
 * routes with real fixture data, and Next matches those static segments
 * ahead of this catch-all.
 *
 * Everything is read-only and local. Writes are accepted and discarded, so a
 * click that would place an order in production does nothing here.
 */

export const dynamic = 'force-dynamic';

const SANDBOX_WALLET = 'SandboxWa11etPubkey11111111111111111111111111';
const AGENT_WALLET = 'SandboxAgentWa11et1111111111111111111111111';

/**
 * Permissive default. Client code reads these defensively
 * (`Array.isArray(data.tokens) ? … : []`), so one object carrying every
 * common collection name satisfies the readers without a per-route stub.
 */
const PERMISSIVE: Record<string, unknown> = {
  ok: true,
  items: [],
  tokens: [],
  mints: [],
  wallets: [],
  accounts: [],
  calls: [],
  fills: [],
  orders: [],
  positions: [],
  transactions: [],
  payouts: [],
  notifications: [],
  conditionals: [],
  conversations: [],
  messages: [],
  next_cursor: null,
  groups: [],
  holders: [],
  tweets: [],
  viewers: [],
  online: [],
  added: [],
  // `/api/token/:mint/wallet-classes` — the only reader that iterates its
  // response fields without an Array.isArray guard first.
  bundlers: [],
  snipers: [],
  dev: null,
  data: [],
  count: 0,
  totalHolders: 0,
  // Referral verbs read a single boolean off the body and otherwise render
  // their rejection state: `/referral/resolve`, `/referral/bind` and
  // `/referral/code`. Answering yes is what lets the fren signup page reach
  // its success screen.
  valid: true,
  bound: true,
  accepted: true,
};

function body(path: string, query: URLSearchParams): Record<string, unknown> {
  // Health probe — the cold-boot gate waits on this.
  if (path === 'readyz') return { ok: true, ready: true };

  /*
   * WALLET GROUPS.
   *
   * The catch-all answers any unknown path with a bag of empty arrays,
   * `groups: []` among them — so the Groups dropdown on the strip only
   * ever rendered its empty state and nothing about the list could be
   * looked at locally.
   *
   * Shaped like a real account rather than three tidy rows: one group
   * holding both trading wallets, one holding a single wallet, one with
   * a name long enough to truncate in a 224px popover, and one EMPTY —
   * which is the state the list disables and the only one that proves
   * the disabled treatment renders at all.
   */
  /*
   * TOKEN SEARCH.
   *
   * The catch-all answered `/api/search` with its generic bag — an
   * `items: []` — so the overlay opened, took a query, and returned
   * nothing every time. Its whole subject is the result row, and there
   * was never a result row to look at.
   *
   * The lane fixtures already carry every field `SearchCard` reads
   * (mint, symbol, name, ageMs, imageUrl, txns, volumeUsd, marketCapUsd,
   * graduated), so the search is served from the same rows the board is
   * — which also means a token found here is the same token you can go
   * and look at on the board.
   */
  if (path === 'search') {
    const rows = [
      ...mockLane.laneItems('newPairs', Date.now()),
      ...mockLane.laneItems('almostGraduated', Date.now()),
    ] as ReadonlyArray<Record<string, unknown>>;

    /*
     * LAUNCHPAD AND DEX PAID, which the lane fixtures do not carry.
     *
     * The search strip filters by source — Pump, Bonk, Dex Paid — and
     * those chips cannot exist as real controls until the payload says
     * which is which. Derived from the mint rather than randomised, so a
     * token is the same launchpad on every request and the filter is
     * stable while you type.
     */
    const stamped: ReadonlyArray<Record<string, unknown>> = rows.map((r) => {
      const mint = String(r['mint'] ?? '');
      let hash = 0;
      for (let i = 0; i < mint.length; i += 1) hash = (hash * 31 + mint.charCodeAt(i)) | 0;
      const n = Math.abs(hash);
      return {
        ...r,
        launchpad: n % 3 === 0 ? 'bonk' : 'pump',
        /* Roughly a third, and never one that has not bonded — paying for
           a listing before graduating is not a thing. */
        dexPaid: r['graduated'] === true && n % 2 === 0,
      };
    });

    /*
     * It has to actually SEARCH. Returning the whole catalog for every
     * query means the list never changes as you type, which is the one
     * behaviour the overlay exists to have — you cannot tell a ranked
     * result from a dump if they look identical.
     *
     * Symbol first, then name, then a contract prefix, which is the
     * order a trader tries them in.
     */
    const q = query.get('q')?.trim().toLowerCase() ?? '';
    const limit = Math.max(1, Math.min(50, Number(query.get('limit')) || 20));
    const graduatedOnly = query.get('graduated') === 'true';

    const source = query.get('source');
    const dexPaidOnly = query.get('dexPaid') === 'true';

    const matched = stamped.filter((r) => {
      if (graduatedOnly && r['graduated'] !== true) return false;
      if (source && r['launchpad'] !== source) return false;
      if (dexPaidOnly && r['dexPaid'] !== true) return false;
      if (q === '') return true;
      const sym = String(r['symbol'] ?? '').toLowerCase();
      const name = String(r['name'] ?? '').toLowerCase();
      const mint = String(r['mint'] ?? '').toLowerCase();
      return sym.includes(q) || name.includes(q) || mint.startsWith(q);
    });

    /* A symbol that STARTS with the query beats one that merely contains
       it — `sol` should find SOL before SOLACA. */
    const ranked = matched.slice().sort((a, b) => {
      const rank = (r: Record<string, unknown>): number => {
        const sym = String(r['symbol'] ?? '').toLowerCase();
        if (q !== '' && sym === q) return 0;
        if (q !== '' && sym.startsWith(q)) return 1;
        return 2;
      };
      return rank(a) - rank(b);
    });

    /*
     * THE `stats` SIDE MAP.
     *
     * Every result row carries three figure columns beside market cap —
     * 1h volume, fees paid, curve liquidity — and all three read from
     * `stats`, which the fixture never sent. So the row shipped its
     * market cap and then three em dashes, and the search list could not
     * be judged as the thing it is: five tokens next to their numbers.
     *
     * Derived from the row's own market cap rather than randomised, so a
     * token holds the same figures while you type and a big token looks
     * like a big token.
     */
    const page = ranked.slice(0, limit);
    const stats: Record<string, Record<string, number>> = {};
    for (const r of page) {
      const mint = String(r['mint'] ?? '');
      const mc = Number(r['marketCapUsd'] ?? 0);
      if (mint === '' || !Number.isFinite(mc) || mc <= 0) continue;
      let hash = 0;
      for (let i = 0; i < mint.length; i += 1) hash = (hash * 31 + mint.charCodeAt(i)) | 0;
      const spread = 0.6 + (Math.abs(hash) % 90) / 100;
      stats[mint] = {
        vol1hUsd: Math.round(mc * 0.18 * spread),
        liquidityUsd: Math.round(mc * 0.09 * spread),
        feesPaidUsd: Math.round(mc * 0.004 * spread),
        athMarketCapUsd: Math.round(mc * (1 + spread * 0.7)),
      };
    }

    return { items: page, stats };
  }

  /*
   * WALLET BALANCES.
   *
   * `sandbox/mockData.ts` has carried a `walletBalances` fixture all
   * along and nothing ever served it, so the catch-all answered with its
   * generic bag of empty arrays — no `balances` key and no
   * `reauth_required` — and `listWalletBalances` fell through to
   * `shape_mismatch`. Every SOL figure in the terminal rendered as an em
   * dash: the aggregate on the wallet chip, and now the per-wallet
   * figure on each row of the picker.
   *
   * The agent wallet is deliberately absent from the fixture, so one row
   * in the list shows a zero rather than every row showing the same
   * healthy number.
   */
  /*
   * `v1/frens/call` is keyed by a QUERY parameter, so it cannot live in
   * the flat path table below — it needs the call id to pick a row.
   * Without it the modal fetched, got the generic empty bag, failed its
   * shape guard, and clicking a call opened nothing.
   */
  /*
   * The candles the call card's chart draws.
   *
   * `NEXT_PUBLIC_INGESTION_API_BASE` is empty in the sandbox, so the
   * ingestion client's URL resolves to this app and the request lands
   * here. Without a branch it fell through to the empty bag and the
   * chart rendered `No chart data yet.` in the largest box on the card.
   */
  const candles = /^token\/([^/]+)\/candles$/.exec(path);
  if (candles) {
    const mint = decodeURIComponent(candles[1]!);
    const resolution = query.get('resolution') ?? '1m';
    const limit = Number(query.get('limit') ?? '240');
    const bucketSec = resolution === '1m' ? 60 : resolution === '5m' ? 300 : resolution === '1h' ? 3600 : 900;
    return {
      v: '1',
      mint,
      resolution,
      beforeSec: null,
      limit,
      hasMoreOlder: false,
      candles: mock.candlesFor(mint, limit, bucketSec).map((c) => ({ ...c, resolution })),
    };
  }

  /*
   * `v1/frens/detail` is another query keyed route, and it had no
   * branch at all: the modal got the empty bag, found no `detail`, and
   * every fren rendered as "private or unavailable".
   *
   * Note it is NOT `v1/frens/profile` below — that one is the signed in
   * user's own editable profile, which is why having one and not the
   * other looked like a permissions bug.
   */
  if (path === 'v1/frens/detail') {
    const detail = mock.frenDetailFor(query.get('user_id') ?? '');
    return detail ? { detail } : { detail: null };
  }

  /*
   * The conditionals ledger. It was reading the generic empty bag, so
   * the page rendered "Nothing is watching yet" on all four tabs.
   */
  if (path === 'trade/conditionals') {
    return mock.conditionalsList;
  }

  /*
   * One conditional, opened. Both routes read the same seeded row the
   * list serves, so the page you land on can never disagree with the row
   * you clicked.
   */
  if (path.startsWith('trade/conditionals/')) {
    const rest = path.slice('trade/conditionals/'.length);
    const id = decodeURIComponent(rest.split('/')[0] ?? '');
    if (rest.endsWith('/state')) return mock.conditionalStateFor(id) ?? {};
    if (rest === id) return mock.conditionalDetailFor(id) ?? {};
  }

  if (path === 'v1/frens/call') {
    const id = query.get('call_id') ?? '';
    const call = (mock.frensCalls as Record<string, unknown>)[id];
    return call ? { call } : { call: null };
  }

  if (path === 'v1/wallets/balances') {
    return { reauth_required: false, ...mock.walletBalances };
  }

  /*
   * One wallet's holding of one mint — the TOKENS column in the trade
   * page's wallet picker, read once per listed wallet. Unserved, every
   * row in that column showed an em dash.
   */
  if (path === 'v1/trade/token-balance') {
    return {
      mint: query.get('mint') ?? '',
      wallet_account_id: query.get('wallet_account_id'),
      tokens: mock.tokenBalanceFor(
        query.get('mint') ?? '',
        query.get('wallet_account_id'),
      ),
    };
  }

  if (path === 'v1/wallets/groups') {
    const stamp = '2026-06-01T12:00:00.000Z';
    return {
      /*
       * `reauth_required: false` IS LOAD BEARING.
       *
       * `listWalletGroups` only reads `groups` when the payload says
       * this explicitly — anything else falls through to the error
       * branch and `groupsFromResult` returns an empty array. Without
       * it the fixture below served four groups and the dropdown still
       * rendered "No groups yet".
       */
      reauth_required: false,
      groups: [
        {
          id: 'grp_mains',
          name: 'Mains',
          display_order: 0,
          wallet_account_ids: ['8f14e45f-ce6a-4f7c-b9a1-2d3e4f5a6b7c', 'c9d0e1f2-a3b4-4c5d-8e9f-0a1b2c3d4e5f'],
          created_at: stamp,
          updated_at: stamp,
        },
        {
          id: 'grp_snipe',
          name: 'Snipers',
          display_order: 1,
          wallet_account_ids: ['c9d0e1f2-a3b4-4c5d-8e9f-0a1b2c3d4e5f'],
          created_at: stamp,
          updated_at: stamp,
        },
        {
          id: 'grp_long',
          name: 'Long term holds and cold storage',
          display_order: 2,
          wallet_account_ids: ['3b2a1c0d-9e8f-4a7b-b6c5-d4e3f2a1b0c9'],
          created_at: stamp,
          updated_at: stamp,
        },
        {
          id: 'grp_empty',
          name: 'Retired',
          display_order: 3,
          wallet_account_ids: [],
          created_at: stamp,
          updated_at: stamp,
        },
      ],
    };
  }

  /*
   * A signed-in user whose wallet is fully set up.
   *
   * The shape is not optional. `parseMeResponse` narrows a payload to
   * "reauth required" unless `reauth_required` is EXPLICITLY false and
   * `session`, `user` and `provisioning` all validate — and the nav's wallet
   * cluster renders nothing at all in the reauth state.
   *
   * `ready_to_trade` is deliberate: it is the state the terminal spends its
   * life in, and it keeps the first-run onboarding gate from firing over the
   * board every time you reload. To design onboarding instead, either open
   * /welcome directly or change this to `wallet_ready_needs_nonce_setup`.
   */
  if (path === 'v1/me') {
    return {
      reauth_required: false,
      session: { provider: 'clerk', clerk_session_id: 'sess_sandbox', expires_at: null },
      user: {
        id: 'user_sandbox_designer',
        status: 'active',
        handle: 'designer',
        display_name: 'Design Sandbox',
        access_code_redeemed: true,
        user_number: 1,
      },
      provisioning: { state: 'ready_to_trade' },
      wallet: { pubkey: mock.WALLET_PUBKEY, status: 'ready' },
      /*
       * THE SAME WALLET OBJECTS `/v1/wallets` SERVES.
       *
       * These were a hand-written short shape — no `chain`, no
       * `is_enabled`, no `display_order` — and `parseMeResponse` dropped
       * every one of them on the floor. `me.wallets.length` came back 0,
       * which is the exact condition the portfolio reads to decide nobody
       * has a wallet yet, so it rendered "No wallets yet" over a fully
       * populated holdings payload it never even asked for.
       *
       * One definition, both endpoints. A wallet shape that exists twice
       * is a wallet shape that disagrees with itself eventually.
       */
      wallets: mock.wallets.wallets,
      primary_wallet_pubkey: mock.WALLET_PUBKEY,
      backup: { methods: [] },
      trading_authorization: { authorized: true, expires_at: null },
      nonce_setup: { required: false, target_count: 5, active_count: 5 },
    };
  }

  /*
   * REAL-SHAPED DATA, so every surface can be designed with rows in it.
   *
   * Everything below used to fall through to PERMISSIVE, which answers with
   * empty arrays: the pages all rendered and every one of them showed its
   * empty state, so the portfolio, the rewards ladder, the frens
   * leaderboard, the fills table and the conditionals list were being
   * designed blind. A layout only ever seen with no rows is a layout nobody
   * has seen.
   *
   * The keys come from the export's own parsers in `source/lib/api/`. Those
   * parsers are defensive — they require a few strings and coerce the rest
   * with fallbacks — so a wrong key does not throw, it quietly yields a zero
   * and the row renders blank. That is why the names have to be exact
   * rather than plausible, and why anything added here should be read off
   * the parser rather than guessed.
   *
   * Matched on the path WITHOUT its query string (see `respond`), so
   * `?window=30d` and `?limit=50` land on the same fixture.
   */
  const fixtures: Record<string, unknown> = {
    'v1/portfolio/spot': mock.portfolioSpot,
    'v1/portfolio/spot/performance': mock.portfolioPerformance,
    'v1/portfolio/spot/transactions': mock.portfolioTransactions,
    'v1/trade/fills': mock.tradeFills,
    'v1/trade/advanced-orders': mock.advancedOrders,
    'v1/trade/capabilities': mock.tradeCapabilities,
    'v1/settings/trading': mock.tradingSettings,
    'v1/cashback/me': mock.cashbackMe,
    'v1/cashback/payouts': mock.cashbackPayouts,
    'v1/cashback/wallets': mock.cashbackWallets,
    'v1/points/me': mock.pointsMe,
    'v1/points/leaderboard': mock.pointsLeaderboard,
    'v1/referral/me': mock.referralMe,
    'v1/referral/stats': mock.referralStats,
    'v1/referral/referees': mock.referralReferees,
    'v1/referral/leaderboard': mock.referralLeaderboard,
    /* The frens board had no entry at all, so it fell through to the
       generic empty bag and the page rendered `No public frens yet`
       over `0 FRENS ON THE BOARD`. */
    'v1/frens/leaderboard': mock.frensLeaderboard,
    'v1/frens/profile': mock.frensProfile,
    'v1/referral/payouts': mock.referralPayouts,
    'v1/notifications': mock.notifications,
    'v1/wallets': mock.wallets,
    'v1/wallets/balances': mock.walletBalances,
    'v1/tracker/wallets': mock.trackedWallets,
    'v1/tracker/activity': mock.trackerActivity,
    'v1/tracker/accounts': mock.trackedAccounts,
    'v1/tracker/trackable': mock.trackableAccounts,
    /*
     * THE TRACKER PAGE'S OWN ROUTES.
     *
     * The four above are the trading service's `v1` shapes. The page
     * itself calls the terminal's routes — no `v1` — and those were
     * falling through to PERMISSIVE, which is why the left panel opened
     * on "No accounts tracked" and stayed there.
     */
    'tracker/available': mock.trackerAvailable,
    'tracker/accounts': mock.trackedAccounts,
    'tracker/tweets': mock.trackerTweets,
    /*
     * The wallets panel is only ever as full as this list: the activity
     * stream takes the tracked addresses as a query parameter and answers
     * with an idle socket when there are none. Empty here meant the panel
     * opened on "No wallets tracked" on any machine that had not typed an
     * address into it by hand.
     */
    'tracker/wallets': mock.trackedWallets,
  };

  const fixture = fixtures[path];
  if (fixture) {
    /*
     * Spread over PERMISSIVE rather than returned alone. Readers reach for
     * differently named collections on the same payload — `items`, `data`,
     * `orders` — and a fixture that names one of them would leave the others
     * undefined where they used to be empty arrays. This keeps every
     * defensive default and overrides only what the fixture actually knows.
     */
    return { ...PERMISSIVE, ...(fixture as Record<string, unknown>) };
  }

  return PERMISSIVE;
}

/*
 * A LIVE TAPE FOR THE WALLET ACTIVITY PANEL.
 *
 * Every stream in the sandbox answers with `idleSseResponse()` — the right
 * default, since a wrong content type puts the client in a reconnect loop.
 * But it means the one panel whose entire job is to show a tape opens on
 * "No entries", so nothing about its rows can be looked at locally.
 *
 * These frames are named `trade`, which is the event the feed listens for,
 * and carry the real `WalletActivityEvent` shape: lamports and token
 * amounts as string-encoded bigints, a signature that keys the row.
 */
/* `mc` is the at-trade market cap in lamports, the field the feed reads
   as `mcLamports`. Without it every row's MC cell renders the em-dash and
   a whole column of the tape is dashes. */
const TAPE = [
  { mint: 'HHaebZMt1xEGGb7jH8c3WydaaQQnJUWgAkPJuEffLtAB', sol: '2404100000', tok: '184000000000', buy: true, mc: '286000000000' },
  { mint: 'sqPT6GMZDMa82QroHZ7siX7Xidnt8G3Nfog8fv9Pj12U', sol: '1081200000', tok: '92400000000', buy: true, mc: '141000000000' },
  { mint: 's4b3FYYrLk68DrK5ftHcc6WcfyKrXHuxaFhPyRAB8MW8', sol: '420700000', tok: '61000000000', buy: false, mc: '52400000000' },
  { mint: 'msDKBwPpurHXvq3Eb6vMtW3aVdXavX38qYhmVkVfDunh', sol: '68204000000', tok: '1200000000000', buy: true, mc: '904000000000' },
  { mint: 'xLdW17MK3VrQNMfwYbCEQvcmXkUVSaJTotpvU8vecfmE', sol: '5761000000', tok: '410000000000', buy: false, mc: '73800000000' },
  { mint: 'B8zcK6rVTcHmE9U6YCqFL6KVFXMbNY8BKnLvAX3MRMDi', sol: '900400000', tok: '76800000000', buy: true, mc: '31200000000' },
  { mint: 'ZXZHPtk7s8DUorm9skLVdyAnuEvCx2WpfyMaMtgJSmUT', sol: '12030000000', tok: '2400000000000', buy: true, mc: '198000000000' },
  { mint: 'Jf1UFibrfKSj4ziR7YB4rxJxk5BsHYuxcnKSHeSS1zZx', sol: '3140000000', tok: '330000000000', buy: false, mc: '44600000000' },
] as const;

/*
 * OPEN POSITIONS, for the strip under the nav.
 *
 * `PositionsBar` returns null when it has no items, so in the sandbox the
 * whole left half of that bar was blank — and a mock site exists to be
 * looked at. One `positions` frame, then the stream stays open.
 */
const POSITIONS = [
  { mint: 'HHaebZMt1xEGGb7jH8c3WydaaQQnJUWgAkPJuEffLtAB', symbol: 'WIF', usd: 1842.5, pnl: 12.4 },
  { mint: 'sqPT6GMZDMa82QroHZ7siX7Xidnt8G3Nfog8fv9Pj12U', symbol: 'POPCAT', usd: 921.0, pnl: 3.1 },
  { mint: 's4b3FYYrLk68DrK5ftHcc6WcfyKrXHuxaFhPyRAB8MW8', symbol: 'FWOG', usd: 410.75, pnl: -8.7 },
  { mint: 'msDKBwPpurHXvq3Eb6vMtW3aVdXavX38qYhmVkVfDunh', symbol: 'GOAT', usd: 2604.2, pnl: 41.9 },
  { mint: 'xLdW17MK3VrQNMfwYbCEQvcmXkUVSaJTotpvU8vecfmE', symbol: 'PNUT', usd: 188.4, pnl: -2.2 },
  { mint: 'B8zcK6rVTcHmE9U6YCqFL6KVFXMbNY8BKnLvAX3MRMDi', symbol: 'MEW', usd: 76.8, pnl: 0.4 },
  { mint: 'ZXZHPtk7s8DUorm9skLVdyAnuEvCx2WpfyMaMtgJSmUT', symbol: 'ZEREBRO', usd: 1330.0, pnl: 18.6 },
] as const;

function positionsSse(request: Request): Response {
  const encoder = new TextEncoder();
  const frame = {
    positions: POSITIONS.map((p) => ({
      mint: p.mint,
      symbol: p.symbol,
      logo: null,
      amountRaw: '1000000000',
      amountUsd: p.usd,
      pnlPct: p.pnl,
      costBasisLamports: '1000000000',
      contributors: [
        { walletAccountId: '8f14e45f-ce6a-4f7c-b9a1-2d3e4f5a6b7c', amountRaw: '1000000000', costBasisLamports: '1000000000' },
      ],
    })),
  };

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: positions
data: ${JSON.stringify(frame)}

`));
      // Held open, not closed: EventSource reconnects on close and the
      // frame would replay forever.
      request.signal.addEventListener('abort', () => {
        try {
          controller.close();
        } catch {
          /* already closed by the runtime */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  });
}

function walletActivitySse(request: Request): Response {
  const wallets = new URL(request.url).searchParams.get('wallets')?.split(',').filter(Boolean) ?? [];
  if (wallets.length === 0) return idleSseResponse();

  const encoder = new TextEncoder();
  let n = 0;

  const stream = new ReadableStream({
    start(controller) {
      const emit = () => {
        const t = TAPE[n % TAPE.length]!;
        const event = {
          signature: `sandbox-${n}-${t.mint.slice(0, 6)}`,
          slot: 300_000_000 + n,
          // Staggered backwards so the column opens with a spread of ages
          // rather than eight rows all reading "0s".
          blockTimeMs: Date.now() - n * 11_000,
          wallet: wallets[n % wallets.length]!,
          mint: t.mint,
          isBuy: t.buy,
          solLamports: t.sol,
          tokens: t.tok,
          venue: n % 3 === 0 ? 'amm' : 'bonding_curve',
          mcLamports: t.mc,
          postTokens: null,
        };
        controller.enqueue(encoder.encode(`event: trade
data: ${JSON.stringify(event)}

`));
        n += 1;
      };

      /*
       * The backlog lands at once, and then the stream just STAYS OPEN.
       *
       * Closing after the backlog looked tidier and was wrong: EventSource
       * reconnects on close, the backlog replays, and the panel filled
       * with sixty rows of the same eight trades. Staying open costs
       * nothing that was not already being paid — the path answered with
       * `idleSseResponse()` before this, which holds the same socket and
       * simply never says anything on it.
       */
      for (let i = 0; i < TAPE.length; i += 1) emit();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  });
}

async function respond(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  // Answer EventSource callers in their own content type. A JSON body here
  // aborts the connection on a MIME mismatch and the client reconnects in a
  // loop (alpha calls, notifications and wallet activity all open streams).
  if (wantsEventStream(request)) {
    const streamPath = ((await ctx.params).path ?? []).join('/');
    if (streamPath === 'wallet-activity/stream') return walletActivitySse(request);
    if (streamPath === 'v1/trade/positions/stream') return positionsSse(request);
    return idleSseResponse();
  }

  /* The query string is dropped: `?window=30d`, `?limit=50` and `?chain=…`
     are all variations on one surface, and a fixture table keyed by full
     URL would miss every one it did not anticipate. */
  const path = ((await ctx.params).path ?? []).join('/');
  const query = new URL(request.url).searchParams;

  /*
   * ── THE ONE WRITE THAT IS NOT DISCARDED ──────────────────────────
   *
   * `PATCH /v1/wallets/<id>` is the enable switch and the primary star
   * on the wallets tab, and it is the only control on that page whose
   * whole job is to CHANGE something. Answering it from the generic
   * fixture bag returns an object with no `wallet` key and no
   * `reauth_required`, so `parsePatchWalletResponse` falls through to
   * `shape_mismatch` and the row toasts `Could not update wallet`.
   *
   * That toast has been chased twice. The first cause was client side:
   * the fixture ids were `wa_sandbox_primary`, so `patchWallet` failed
   * `UUID_REGEX` and returned `invalid_input` before making a request
   * at all. Real UUIDs fixed that, the request finally went out, and it
   * landed here — on a handler that had no idea what to say back.
   *
   * So this one applies. It mutates the fixture in module scope, which
   * means the change SURVIVES the refetch that follows it; echoing the
   * patch without storing it would light the switch and then have the
   * next `GET /v1/wallets` turn it straight back off.
   */
  const patched = await patchWalletFixture(request, path);
  if (patched) return NextResponse.json(patched, { headers: { 'cache-control': 'no-store' } });

  /* The other write that has to stick: an imported wallet must be in the
     list the next GET serves, or the modal closes onto an unchanged
     table. Same module-scope mutation as the patch above. */
  const imported = await importWalletFixtureRoute(request, path);
  if (imported) {
    return NextResponse.json(imported.body, {
      status: imported.status,
      headers: { 'cache-control': 'no-store' },
    });
  }

  return NextResponse.json(body(path, query), { headers: { 'cache-control': 'no-store' } });
}

async function importWalletFixtureRoute(
  request: Request,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if (request.method !== 'POST' || path !== 'v1/wallets/import') return null;
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const secret = typeof payload['secret'] === 'string' ? payload['secret'] : '';
  const label = typeof payload['label'] === 'string' ? payload['label'] : null;
  if (secret === '') return { status: 400, body: { message: 'invalid_secret' } };
  const result = mock.importWalletFixture(secret, label);
  if (result.duplicate !== null) {
    return { status: 409, body: { wallet_account_id: result.duplicate } };
  }
  return { status: 200, body: { wallet: result.wallet } };
}

const WALLET_PATH = /^v1\/wallets\/([0-9a-f-]{36})$/i;

async function patchWalletFixture(
  request: Request,
  path: string,
): Promise<Record<string, unknown> | null> {
  if (request.method !== 'PATCH') return null;
  const id = WALLET_PATH.exec(path)?.[1];
  if (!id) return null;

  const row = mock.wallets.wallets.find(
    (w: Record<string, unknown>) => w['wallet_account_id'] === id,
  );
  if (!row) return null;

  const patch = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof patch['is_enabled'] === 'boolean') row['is_enabled'] = patch['is_enabled'];
  if (typeof patch['is_archived'] === 'boolean') row['is_archived'] = patch['is_archived'];
  if (patch['label'] === null || typeof patch['label'] === 'string') row['label'] = patch['label'];
  if (typeof patch['display_order'] === 'number') row['display_order'] = patch['display_order'];

  /* Primary is exclusive. Setting it on one row without clearing the
     others leaves two stars lit, and the list has no way to choose. */
  if (patch['is_primary'] === true) {
    for (const w of mock.wallets.wallets as Array<Record<string, unknown>>) {
      w['is_primary'] = w['wallet_account_id'] === id;
    }
  } else if (patch['is_primary'] === false) {
    row['is_primary'] = false;
  }

  return { reauth_required: false, wallet: row };
}

export const GET = respond;
export const POST = respond;
export const PUT = respond;
export const PATCH = respond;
export const DELETE = respond;
