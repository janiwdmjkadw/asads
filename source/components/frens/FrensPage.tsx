'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { compactAge, formatSolCompact } from '@/lib/format';
import { pageZoom } from '@/lib/page-zoom';
import { lamportsToSol, sol1 } from './solFormat';
import {
  useFrenLeaderboard,
  type FrenLeaderboardRow,
  type FrenWindow,
  type TopCall,
} from '@/lib/api/frens';
import { useTrackedWalletsContext } from '@/components/discover/TrackedWalletsProvider';
import { CallDetailModal, type CallOpenHint } from './CallDetailModal';
import { FrenProfileModal } from './FrenProfileModal';
import { navigateToToken } from '@/components/listen/navigation';
import { Solana } from '@/components/listen/icons/Icons';
import { scheduleMosaicChimes } from '@/lib/sound/mosaicChime';

/**
 * Slice "Frens": the social discovery page. One leaderboard payload
 * powers every lens — sort client-side across:
 *
 *   Best Calls — highest % from call-time MC to the tracked peak (ATH)
 *   PnL        — net SOL flow over the selected window
 *   Win Rate   — per-mint net-flow sign within the window, settled
 *                (fully exited) positions only
 *   Volume     — swap notional turned over within the window (fees,
 *                tips and platform fee excluded)
 *
 * Layout: masthead (serif wordmark + confetti streak field + pixel
 * mosaic) → lens/window controls → best-theses strip → top-3 podium →
 * ranked table. Every row carries one-click Track (name + emoji → the
 * viewer's wallet tracker, via the fren's primary wallet).
 *
 * Design language: flat confetti color blocks on near-black panels,
 * mono uppercase micro-labels, one serif display voice. Functional
 * color stays SEMANTIC (up/down/theme accent); the confetti palette is
 * decorative only — ranks, streaks, mosaics, card identities.
 */

type SortKey = 'pnl' | 'calls' | 'winrate' | 'volume';

const SORT_LABELS: Record<SortKey, string> = {
  pnl: 'PnL',
  calls: 'Best Calls',
  winrate: 'Win Rate',
  volume: 'Volume',
};

const WINDOWS: readonly FrenWindow[] = ['1d', '7d', '30d', 'all'] as const;

/* `7D` is a control label. In a sentence it reads as a stutter, so the
   heading says what the control means. */
const WINDOW_WORD: Record<FrenWindow, string> = {
  '1d': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  all: 'all time',
};

const TRACK_EMOJIS = ['🐋', '🦍', '🐸', '🔥', '💎', '🚀', '🥷', '🧠', '👑', '🎯', '🍀', '⚡'] as const;

// ───────── the confetti system ─────────

/*
 * Fixed brand confetti — deliberately NOT theme-reactive, like a print.
 *
 * ── AND MIXED FOR PAPER ──────────────────────────────────────────────
 *
 * These eight were picked to glow on black: a mint, a sky, a hot pink,
 * an amber. Over white the same eight are highlighter, and the two
 * lightest of them stopped being colours at all — a 5px tile in
 * #4f9c33 on a white page is a blank tile. Each one is deepened to the
 * point where it holds at tile size on paper, keeping the spacing that
 * lets eight frens be told apart at a glance.
 */
const CONFETTI = [
  '#0f8a5f',
  '#2a5fd0',
  '#1f8fc4',
  '#b8339c',
  '#c08a12',
  '#0e93ac',
  '#6b46c8',
  '#4f9c33',
] as const;

/** Each lens owns a color — its tick block, its section, its identity. */
const LENS_COLOR: Record<SortKey, string> = {
  pnl: '#0f8a5f',
  calls: '#b8339c',
  winrate: '#1f8fc4',
  volume: '#c08a12',
};

/** Podium identities: main block color + a companion for the collage. */
const RANK_THEME: Record<number, { main: string; soft: string }> = {
  1: { main: '#c99415', soft: '#0f8a5f' },
  2: { main: '#1f8fc4', soft: '#6b46c8' },
  3: { main: '#b8339c', soft: '#d9673a' },
};

function rankTheme(rank: number): { main: string; soft: string } {
  return RANK_THEME[rank] ?? { main: '#8a8a85', soft: '#5a5a55' };
}

function confetti(index: number): string {
  return CONFETTI[((index % CONFETTI.length) + CONFETTI.length) % CONFETTI.length]!;
}

/**
 * ── A FREN'S COLOUR ──────────────────────────────────────────────────
 *
 * Hashed on the USER ID, so it is the same colour on the board, in the
 * calls strip, on the podium and in the masthead, and it survives a
 * re-sort, a filter, and somebody new joining above them.
 *
 * This page had three palettes and none of them was a person:
 * `LENS_COLOR` gives a hue to the sort key you last pressed,
 * `RANK_THEME` gives one to a podium SLOT — so a fren changes colour
 * when they are overtaken — and `confetti(index)` gives one to an array
 * position, which changes the moment the list is ordered differently.
 * The same fren was green on the board, gold on the podium and cyan in
 * the mosaic, and none of those was them.
 *
 * Same function and same reasoning as `inkForMint` on the portfolio
 * tape: keyed on position it would repaint every time a figure moved.
 */
export function frenInk(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return CONFETTI[((h % CONFETTI.length) + CONFETTI.length) % CONFETTI.length]!;
}

// ───────── logic (unchanged) ─────────

function winRatePct(row: FrenLeaderboardRow): number | null {
  const settled = row.wins + row.losses;
  if (settled === 0) return null;
  return (row.wins / settled) * 100;
}

function sortRows(rows: FrenLeaderboardRow[], sort: SortKey): FrenLeaderboardRow[] {
  const sorted = [...rows];
  switch (sort) {
    case 'pnl':
      sorted.sort((a, b) => lamportsToSol(b.pnl_lamports) - lamportsToSol(a.pnl_lamports));
      break;
    case 'volume':
      sorted.sort((a, b) => lamportsToSol(b.volume_lamports) - lamportsToSol(a.volume_lamports));
      break;
    case 'winrate':
      sorted.sort((a, b) => (winRatePct(b) ?? -1) - (winRatePct(a) ?? -1));
      break;
    case 'calls':
      sorted.sort((a, b) => (b.best_call_pct ?? -1) - (a.best_call_pct ?? -1));
      break;
  }
  return sorted;
}

/**
 * Trader-style call readout: ≥2x shows the MULTIPLE (peak/entry — a
 * +120% gain reads "2.2x"), below that the plain percent gain.
 */
/**
 * A call's result, always as a MULTIPLE.
 *
 * This used to switch: `x` above 2x and `+N%` below it. The reasoning
 * was that `1.3x` reads worse than `+30%`, which is true in isolation
 * and wrong on a strip — two cards side by side reading `+95%` and
 * `7.6x` cannot be compared without doing arithmetic first, and the
 * whole job of this figure is being scannable against its neighbours.
 * One unit, always.
 *
 * Whole numbers at ten and above, because the decimal on `12.4x` is
 * noise at that size, and one decimal below it, where the gap between
 * 1.9x and 1.4x is the entire fact.
 *
 * A call that went DOWN lands under 1x on the same scale — 0.4x — which
 * is honest and needs no separate case.
 */
function formatCallPct(pct: number): string {
  const multiple = pct / 100 + 1;
  if (multiple >= 10) return `${Math.round(multiple)}x`;
  return `${multiple.toFixed(1)}x`;
}

export function FrensPage(): React.ReactElement {
  const [window, setWindow] = useState<FrenWindow>('7d');
  const [sort, setSort] = useState<SortKey>('pnl');
  const [search, setSearch] = useState('');
  const leaderboard = useFrenLeaderboard(window);
  const rows = useMemo(
    () => (leaderboard.data?.kind === 'ok' ? leaderboard.data.data.rows : []),
    [leaderboard.data],
  );
  const topCalls = useMemo(
    () => (leaderboard.data?.kind === 'ok' ? leaderboard.data.data.topCalls : []),
    [leaderboard.data],
  );

  // Track state rides the SHARED tracked-wallets store (same context the
  // popover / tracker page / dossier use), so TRACKED ✓ states are live in
  // both directions: a fren tracked here appears everywhere instantly, and
  // a wallet removed elsewhere reverts the button here without a reload.
  // (Previously this held a page-local set seeded by a one-shot DB fetch —
  // adds went straight to the DB API and desynced from the live store.)
  const trackedWallets = useTrackedWalletsContext();
  const trackedPubkeys = trackedWallets.addressSet;
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [openCall, setOpenCall] = useState<{ id: string; hint: CallOpenHint | null } | null>(null);
  // Every opener passes mint/createdAt hints so the chart read races the
  // card read — neither waits on the other.
  const openCallCard = (id: string, hint: CallOpenHint | null) => setOpenCall({ id, hint });
  // Kept for the TrackButton prop chain; the shared store already updates
  // addressSet synchronously on add, so there's nothing left to mark.
  const markTracked = (_pubkey: string) => undefined;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = query.length
      ? rows.filter(
          (row) =>
            row.label.toLowerCase().includes(query) ||
            (row.bio ?? '').toLowerCase().includes(query) ||
            (row.best_call_ticker ?? '').toLowerCase().includes(query),
        )
      : rows;
    // The Best Calls lens is a CALLERS board — frens who never called
    // (or whose calls carry no scoreable baseline) don't belong on it.
    const lensed = sort === 'calls' ? matched.filter((row) => row.best_call_pct !== null) : matched;
    return sortRows(lensed, sort);
  }, [rows, search, sort]);

  const bestTheses = useMemo(() => topCalls.slice(0, 6), [topCalls]);

  const filteredCalls = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query.length) return topCalls;
    return topCalls.filter(
      (call) =>
        call.label.toLowerCase().includes(query) ||
        call.thesis.toLowerCase().includes(query) ||
        (call.ticker ?? '').toLowerCase().includes(query),
    );
  }, [topCalls, search]);

  const podium = filtered.slice(0, 3);
  const rest = filtered.slice(3);
  const isLoading = leaderboard.isLoading;

  return (
    <div
      className="scroll-hide frens-page"
      style={{
        height: 'var(--h-app-content, 100%)',
        overflowY: 'auto',
        padding: '18px clamp(14px, 4vw, 48px) 48px',
        fontFamily: 'var(--sans)',
      }}
    >
      <FrensStyles />
      <EdgeRails />
      <div style={{ maxWidth: 1440, margin: '0 auto' }}>
        <div className="frens-sec">
          <Masthead
            frens={rows.length}
            calls={topCalls.length}
            loading={isLoading && rows.length === 0}
            ids={rows.map((r) => r.user_id)}
            boardPnlSol={rows.reduce((sum, r) => sum + lamportsToSol(r.pnl_lamports), 0)}
            bestCallPct={rows.reduce<number | null>(
              (best, r) =>
                r.best_call_pct === null
                  ? best
                  : best === null
                    ? r.best_call_pct
                    : Math.max(best, r.best_call_pct),
              null,
            )}
          />
        </div>

        {/* Lens / window / search controls */}
        {/*
         * ── THE CONTROLS ────────────────────────────────────────────
         *
         * WHAT THIS REPLACED. Four glass capsules, each with a 4px
         * coloured tick and mono capitals on a 0.1em track, where the
         * tick's hue came from `LENS_COLOR` — a colour per SORT KEY.
         * Then four more capsules for the windows, then a 999px search
         * pill.
         *
         * The ticks had to go, and not for taste. Colour on this page
         * now means A PERSON: every fren carries their own hue on the
         * board, the calls, and the roster in the masthead. A green tick
         * on a button meant `you pressed PnL`, so the same green said
         * two unrelated things on one screen. A palette that means two
         * things means neither.
         *
         * So the sorts and the windows are words, the live one white —
         * the control the rest of the product settled on. The search
         * keeps an outline, because a field you type into has to look
         * like somewhere to type.
         */}
        <div className="frc">
          <div className="frc-sorts">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                aria-pressed={sort === key}
                data-on={sort === key ? '' : undefined}
              >
                {SORT_LABELS[key]}
              </button>
            ))}
          </div>

          <div className="frc-right">
            <div className="frc-win">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWindow(w)}
                  aria-pressed={window === w}
                  data-on={window === w ? '' : undefined}
                >
                  {w === 'all' ? 'All' : w.toUpperCase()}
                </button>
              ))}
            </div>

            <input
              type="search"
              className="frc-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search frens, coins, theses"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Standout calls in the selected window */}
        {bestTheses.length > 0 ? (
          <div className="frens-sec-3 frens-block">
            <SectionTitle meta={window === 'all' ? 'all time' : WINDOW_WORD[window]}>
              Best calls
            </SectionTitle>
            <WheelRow style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '2px 2px 6px' }}>
              {bestTheses.map((call) => (
                <ThesisCard key={call.call_id} call={call} onOpen={openCallCard} />
              ))}
            </WheelRow>
          </div>
        ) : null}

        {/* The podium. Three owls on a rail at three heights. */}
        {podium.length > 0 ? (
          <div className="frens-sec-3 frens-block">
            <SectionTitle meta={SORT_LABELS[sort]}>{`Top ${podium.length}`}</SectionTitle>
            <Perch podium={podium} onOpenProfile={setProfileUserId} />
          </div>
        ) : null}

        {/* The board. Ranks 4 and down: the top three belong to the
            podium, which is not built yet, so those three are absent
            from the page for now rather than shown twice later. */}
        <div className="frens-sec-4 frens-block">
          <SectionTitle meta={filtered.length > 3 ? '4 to 10' : undefined}>The board</SectionTitle>
          <div className="frb-head">
            <span />
            <span>Fren</span>
            <span>Win rate</span>
            <span>Positions</span>
            <span>Trades</span>
            <span>Volume</span>
            <span>Best call</span>
            <span>PnL</span>
          </div>
          {isLoading && filtered.length === 0 ? <LoadingRows /> : null}
          {!isLoading && filtered.length <= 3 ? (
            /*
             * The podium takes the first three, so a search matching
             * three or fewer frens leaves this section with nothing —
             * and it was answering that with "no public frens yet",
             * which is a different fact and not true. Three cases, three
             * sentences.
             */
            <EmptyState>
              {search.trim().length === 0
                ? 'No public frens yet. Set your profile public in Settings to be first.'
                : filtered.length === 0
                  ? 'No frens match that search.'
                  : 'Everyone matching is in the top three above.'}
            </EmptyState>
          ) : (
            /* Four to ten. The podium takes the top three and the board
               stops at tenth; a top ten is the shape people expect. */
            filtered
              .slice(3, 10)
              .map((row, index) => (
                <TableRow key={row.user_id} row={row} rank={index + 4} onOpenProfile={setProfileUserId} />
              ))
          )}
        </div>

        <SignatureFooter />
      </div>

      <CallDetailModal
        callId={openCall?.id ?? null}
        hint={openCall?.hint ?? null}
        onClose={() => setOpenCall(null)}
      />

      <FrenProfileModal
        userId={profileUserId}
        onClose={() => setProfileUserId(null)}
        onOpenCall={openCallCard}
        renderTrack={(detail) => (
          <TrackButton
            row={detail}
            portal={false}
            tracked={
              detail.primary_wallet_pubkey !== null &&
              trackedPubkeys.has(detail.primary_wallet_pubkey)
            }
            onTracked={markTracked}
          />
        )}
      />
    </div>
  );
}

// ───────── scoped styles ─────────

/**
 * Namespaced (`frens-`) page styles: entrance choreography, hover
 * physics, streak drift, responsive podium stacking. Motion is fully
 * disabled under prefers-reduced-motion.
 */
export function FrensStyles(): React.ReactElement {
  return (
    <style>{`
      /*
       * ── THE PAGE'S PALETTE ──────────────────────────────────────
       *
       * Its own root, like every converted surface. It states a GROUND
       * and a base colour as well as the tokens: a rule that names no
       * colour inherits, and what it was inheriting is the terminal's
       * near white ink.
       *
       * This becomes the light half of the theme when the toggle is
       * built; nothing below is a literal that would have to be found
       * again.
       */
      .frens-page {
        --surface: #ffffff;
        --surface-1: #ffffff;
        --surface-2: #f7f9f8;
        --surface-3: #f4f7f6;
        --input-bg: rgba(11, 14, 20, 0.035);
        --input-border: rgba(11, 14, 20, 0.1);
        --chip-bg: rgba(11, 14, 20, 0.04);
        --chip-border: rgba(11, 14, 20, 0.1);
        --hairline: rgba(11, 14, 20, 0.09);
        --hairline-2: rgba(11, 14, 20, 0.16);
        --ink-0: #0b0e14;
        --ink-1: #2b3138;
        --ink-2: #5b6570;
        --ink-3: #8a9591;
        --ink-4: #d6dbd9;
        --up: #0f6d5f;
        --down: #b4482e;
        --hold: #c08a12;
        --accent-primary: #0b0e14;
        --accent-soft: rgba(11, 14, 20, 0.06);
        --accent: #0b0e14;
        --accent-ink: #ffffff;

        background: var(--surface);
        color: var(--ink-1);
      }

      @keyframes frens-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

      /* ── PAGE RHYTHM ─────────────────────────────────────────────
       *
       * One margin for the three sections under the controls, so the
       * gaps between them grow together on a narrow screen. They were
       * inline margins of 24, 34 and 30, which no media query can
       * reach.
       *
       * These sit at the TOP of the sheet on purpose: both mobile
       * blocks below override them, and a base rule written after a
       * media query wins on source order and quietly cancels it.
       * ───────────────────────────────────────────────────────────── */
      .frens-block { margin-top: 34px; }
      .frens-sig { margin-top: 40px; }

      /* ── THE MASTHEAD ────────────────────────────────────────────
       *
       * Black, like the rest of the product. It was a lifted plate on a
       * gradient with an inset top light, which made the page open on a
       * card sitting on a page rather than on the board.
       * ────────────────────────────────────────────────────────────*/
      /* A box, so the page opens on an object rather than on type
         floating over black with the first drawn edge being the
         hairline under the controls. Neutral white at a low alpha, and
         never a --surface token: those are hsl(220 12% …), which reads
         blue over a body that is pure black. */
      /*
       * A banner, not a box. The tiles run the full width behind
       * everything and the black is brought across from the left, so
       * the type sits on ground rather than on colour.
       */
      /*
       * Not a card. No border, no radius, and negative margins that
       * cancel the page's own padding — 18px at the top and
       * clamp(14px, 4vw, 48px) at the sides — so the banner runs to the
       * edges of the pane and the tiles bleed off it.
       *
       * One hairline along the foot is all that separates it from the
       * page, the way a masthead sits over a column.
       */
      .frm {
        position: relative;
        border-radius: 18px;
        overflow: hidden;
        background: #ffffff;
        border: 1px solid rgba(11, 14, 20, 0.09);
      }

      /* One tile per fren, in that fren's own hue. Forty eight of them
         so the grid fills any width, cycling the board's colours. */
      .frm-tiles {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: repeat(16, 1fr);
        grid-auto-rows: 1fr;
        gap: 5px;
        padding: 10px;
        /* 0.82, from 0.5. Half strength over black still gave a tile
           its hue, because the tile was the only light in that square.
           Over white the same half is a pastel, and forty eight pastel
           squares are a smudge rather than a mosaic of frens. */
        opacity: 0.82;
      }
      .frm-tiles > span { display: block; border-radius: 4px; }



      /* The ground the type stands on. Solid to 58%, gone by 84%, so
         the tiles are only ever behind the empty right side. */
      /* The type is capped at the same 1440 the rest of the page uses,
         so nothing runs wider than the board below it. */
      .frm-in {
        position: relative;
        padding: 30px 32px 0;
        /* Solid further right than it was on black: a dark ground hid a
           dark tile by 55%, and over paper a pale tile still reads
           through white at 62% — which put the stat labels under the
           headline on top of the mosaic. */
        background: linear-gradient(90deg, #ffffff 58%, rgba(255, 255, 255, 0.88) 84%, transparent);
      }

      /* Sans, not a 62px serif italic lowercase wordmark under a nav
         that already says Frens. */
      .frm h1 {
        margin: 0;
        font-size: 38px;
        font-weight: 600;
        letter-spacing: -0.032em;
        line-height: 1.05;
        color: var(--ink-0);
      }
      .frm p { margin: 10px 0 0; max-width: 470px; font-size: 13px; line-height: 1.5; color: var(--ink-3); }

      /* Figures, not two bordered capsules of mono capitals each with
         its own coloured block. The hues belong to people now. */
      /* Darker than the box it sits in. A lighter tray reads as a
         second panel stacked on the first; a darker one reads as set
         into it. */
      /* The figures sit inside the banner on the same black, not in a
         recessed panel of their own: a tray inside a banner is a box
         inside a box. */
      .frm-tray {
        position: relative;
        padding: 22px 32px 30px;
        /* Solid further right than it was on black: a dark ground hid a
           dark tile by 55%, and over paper a pale tile still reads
           through white at 62% — which put the stat labels under the
           headline on top of the mosaic. */
        background: linear-gradient(90deg, #ffffff 58%, rgba(255, 255, 255, 0.88) 84%, transparent);
      }
      .frm-figs {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 34px;
        font-variant-numeric: tabular-nums;
      }
      .frm-figs > span { display: inline-flex; flex-direction: column; gap: 2px; }
      .frm-figs b {
        display: inline-flex;
        align-items: center;
        font-size: 16px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--ink-0);
      }
      .frm-figs i { font-style: normal; font-size: 11px; color: var(--ink-3); }
      /* The tray's b rule is a class AND an element, so it outranks a
         bare colour class: the gain was rendering in --ink-0 with
         frb-up applied and doing nothing. */
      .frm-figs b.frb-up { color: var(--up); }
      .frm-figs b.frb-down { color: var(--down); }
      .frm-load { width: 180px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, transparent, rgba(11, 14, 20, 0.16), transparent); background-size: 200% 100%; }

      /*
       * A light crossing the grid. filter and transform only, so no
       * tile moves position and none of them changes hue — each keeps
       * the fren's own colour and only its luminance travels. Both
       * properties are composited, so twenty four tiles cost nothing.
       */
      /* ── THE PODIUM ──────────────────────────────────────────────
       *
       * Three owls on one rail. No plinths, no fills, no boxes: the
       * whole podium is a hairline, three legs and three marks.
       * ───────────────────────────────────────────────────────────── */
      .frp-row, .frp-names {
        display: grid;
        grid-template-columns: 1fr 1.1fr 1fr;
        gap: 16px;
      }
      .frp[data-thin] .frp-row, .frp[data-thin] .frp-names {
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      }
      .frp-row { align-items: end; }
      .frp-c { display: flex; flex-direction: column; align-items: center; }

      /* The mark is a MASK with a metal behind it, not an image, so it
         is sharp at any size and can be struck in any metal. */
      .frp-owl {
        display: block;
        flex: none;
        width: 28px;
        height: 28px;
        -webkit-mask-image: url('/assets/logo.svg');
        mask-image: url('/assets/logo.svg');
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-position: center;
        mask-position: center;
        -webkit-mask-size: contain;
        mask-size: contain;
      }
      .frp-c[data-place='0'] .frp-owl { width: 36px; height: 36px; }

      /* The leg puts the owl ON the rail, and its length is the rank. */
      .frp-leg {
        width: 1px;
        height: 14px;
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--tone) 55%, transparent),
          color-mix(in srgb, var(--tone) 18%, transparent)
        );
      }
      .frp-c[data-place='0'] .frp-leg { height: 52px; }
      .frp-c[data-place='1'] .frp-leg { height: 30px; }

      .frp-rail {
        height: 1px;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(11, 14, 20, 0.2) 12%,
          rgba(11, 14, 20, 0.2) 88%,
          transparent
        );
      }

      .frp-names { margin-top: 16px; align-items: start; text-align: center; }
      .frp-place {
        display: block;
        font-size: 10.5px;
        font-weight: 600;
        color: var(--tone);
      }
      .frp-name {
        display: block;
        margin-top: 3px;
        font-size: 17px;
        font-weight: 600;
        letter-spacing: -0.015em;
        color: var(--ink-0);
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      .frp-c[data-place='0'] ~ * .frp-name { font-size: 17px; }
      .frp-names > *:nth-child(2) .frp-name { font-size: 20px; }
      .frp[data-thin] .frp-names > *:nth-child(2) .frp-name { font-size: 17px; }
      .frp-gain {
        display: inline-flex;
        align-items: center;
        margin-top: 5px;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: -0.015em;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .frp-meta {
        display: block;
        margin-top: 7px;
        font-size: 11px;
        line-height: 1.5;
        color: var(--ink-3);
      }

      /* On a phone the three stay side by side — a podium that stacks is
         not a podium — so everything shrinks instead: smaller marks,
         shorter legs, and the meta line drops away below 420. */
      @media (max-width: 720px) {
        .frp-row, .frp-names { gap: 8px; }
        .frp-owl { width: 24px; height: 24px; }
        .frp-c[data-place='0'] .frp-owl { width: 30px; height: 30px; }
        .frp-c[data-place='0'] .frp-leg { height: 38px; }
        .frp-c[data-place='1'] .frp-leg { height: 22px; }
        .frp-c[data-place='2'] .frp-leg { height: 10px; }
        .frp-name, .frp-names > *:nth-child(2) .frp-name { font-size: 14px; }
        .frp-gain { font-size: 13px; }
        .frp-place { font-size: 10px; }
        .frp-meta { font-size: 10px; margin-top: 5px; }
      }
      @media (max-width: 420px) {
        .frp-meta { display: none; }
      }

      /* ── THE BOARD ───────────────────────────────────────────────
       *
       * Eight columns on one 38px line. No faces, no bio, nothing
       * stacked: a rank, a name and six figures, all on one baseline.
       *
       * Classes rather than inline styles, because the column set has
       * to change at two widths and a style attribute cannot be
       * answered by a media query.
       * ───────────────────────────────────────────────────────────── */
      .frb-head, .frb-row {
        display: grid;
        align-items: center;
        grid-template-columns: 22px minmax(120px, 1fr) 74px 80px 66px 82px 76px 112px;
        gap: 14px;
        padding: 0 10px;
      }
      .frb-head { padding-bottom: 9px; border-bottom: 1px solid var(--hairline); }
      .frb-head span { font-size: 10.5px; font-weight: 500; color: var(--ink-3); }
      .frb-head span:not(:nth-child(1)):not(:nth-child(2)) { text-align: right; }

      .frb-row {
        height: 38px;
        border-bottom: 1px solid rgba(11, 14, 20, 0.035);
        transition: background-color 120ms var(--ease, ease);
      }
      .frb-row:hover { background: rgba(11, 14, 20, 0.04); }

      .frb-n {
        text-align: right;
        font-size: 12px;
        color: var(--ink-3);
        font-variant-numeric: tabular-nums;
      }
      .frb-name {
        font-size: 13.5px;
        font-weight: 600;
        letter-spacing: -0.005em;
        color: var(--ink-0);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
        min-width: 0;
      }
      .frb-r { text-align: right; justify-self: end; }
      .frb-val, .frb-pnl {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .frb-val { font-size: 12.5px; color: var(--ink-2); }
      /* The gain is the sorted measure, so it is the only coloured thing
         on the row, but it is the same SIZE as the figures beside it. */
      .frb-pnl { font-size: 12.5px; font-weight: 600; letter-spacing: -0.015em; }
      .frb-up { color: var(--up); }
      .frb-down { color: var(--down); }
      /* A unit symbol, not a second figure. */
      .frb-sol { flex: none; margin-right: 4px; }

      /* Trades and best call are the two a narrow screen can lose: one
         is implied by positions, the other has its own strip above. */
      @media (max-width: 1040px) {
        .frb-head, .frb-row {
          grid-template-columns: 22px minmax(110px, 1fr) 70px 74px 78px 104px;
          gap: 12px;
        }
        .frb-head span:nth-child(5), .frb-row > *:nth-child(5),
        .frb-head span:nth-child(7), .frb-row > *:nth-child(7) { display: none; }
      }
      /* On a phone the board is who, how often they win, and by how
         much. The rest is a tap away on the profile. */
      @media (max-width: 680px) {
        .frb-head, .frb-row {
          grid-template-columns: 18px minmax(80px, 1fr) 56px 92px;
          gap: 10px;
          padding: 0 2px;
        }
        .frb-head span:nth-child(4), .frb-row > *:nth-child(4),
        .frb-head span:nth-child(6), .frb-row > *:nth-child(6) { display: none; }
        .frb-name { font-size: 13px; }
        .frb-val, .frb-pnl { font-size: 12px; }
      }

      /*
       * The signature dots bounce: a hop, a settle, then a smaller
       * second hop, on an overshooting ease so it lands like weight
       * rather than easing to a stop. transform and filter only, both
       * composited, so nothing re-lays out.
       */
      .frens-sig-dot { animation: frens-bounce 2400ms cubic-bezier(0.34, 1.56, 0.64, 1) infinite; }
      @keyframes frens-bounce {
        0%, 62%, 100% { transform: translateY(0) scale(1); filter: brightness(1); }
        18% { transform: translateY(-7px) scale(1.18); filter: brightness(1.55); }
        34% { transform: translateY(0) scale(0.94); }
        46% { transform: translateY(-3px) scale(1.06); }
      }

      /*
       * The rail dots sway toward the page and back instead of bouncing
       * — they sit in a vertical column at the screen edge, where a
       * horizontal drift reads as breathing and a vertical hop reads as
       * the column falling apart.
       */
      .frens-rail-dot { animation: frens-sway 5200ms ease-in-out infinite; }
      @keyframes frens-sway {
        0%, 100% { transform: translateX(0) scale(1); filter: brightness(1); }
        50% { transform: translateX(var(--sway, 3px)) scale(1.14); filter: brightness(1.5); }
      }

      @keyframes frm-wave {
        0%, 72%, 100% { filter: brightness(1); transform: scale(1); }
        12% { filter: brightness(1.6); transform: scale(1.12); }
      }

      /*
       * ── THE GROUND FOLLOWS THE TYPE ─────────────────────────────
       *
       * The banner's ground is solid to 58% because that is where the
       * headline and the figures end on a wide pane. As the pane
       * narrows, the same sentence takes a larger share of it — at
       * 768 the subtitle runs to about two thirds — so the fade has
       * to start later or the tail of it lands on the mosaic. One
       * step, between the wide setting and the phone's band.
       */
      @media (max-width: 1040px) and (min-width: 721px) {
        .frm-in,
        .frm-tray {
          background: linear-gradient(90deg, #ffffff 74%, rgba(255, 255, 255, 0.9) 92%, transparent);
        }
      }

      @media (max-width: 820px) {
        .frm-in { flex-direction: column; align-items: flex-start; gap: 22px; }
        .frm h1 { font-size: 26px; }
      }

      /* A header that pulses forever is exactly what this setting is
         for, and it costs one line. */
      @media (max-width: 720px) {
        /*
         * A phone is a column, so the only thing separating one section
         * from the next is space. At the desktop rhythm the calls
         * strip, the podium and the board ran together as one scroll
         * with three headings in it.
         */
        .frens-block { margin-top: 46px; }
        /* Room to breathe under the podium's names, and a taller row on
           the board: 38px is a fine line to read and a poor one to hit
           with a thumb. */
        .frp-names { margin-top: 20px; }
        .frb-row { height: 46px; }
        .frb-head { padding-bottom: 12px; }
        .frens-sig { margin-top: 54px; padding-bottom: 8px; }

        /*
         * ── ON A PHONE THE MOSAIC IS A BAND, NOT A FIELD ───────────
         *
         * On a wide banner the tiles live in the empty right side and
         * the ground fades across to keep the type off them. At 375px
         * there IS no empty right side: the headline, the sentence and
         * four figures all run the full width, so the fade left the
         * last stat sitting on colour — and where the two overlapped,
         * a 90% white over a tile read as a smudge rather than as
         * either one.
         *
         * So the tiles come out from behind the type and become a band
         * across the top of the card. Every fren's colour is still
         * there, the type is on clean paper, and nothing overlaps.
         */
        .frm-tiles {
          inset: 0 0 auto 0;
          height: 46px;
          grid-template-columns: repeat(10, 1fr);
          gap: 4px;
          padding: 6px;
          opacity: 0.9;
        }
        .frm-in {
          padding: 62px 18px 0;
          background: none;
        }
        .frm h1 { font-size: 30px; }
        .frm-tray {
          padding: 18px 18px 22px;
          background: none;
        }
        .frm-figs { gap: 10px 22px; }
        .frm-figs b { font-size: 15px; }
      }


      /* ── THE PULLABLE STRIP ──────────────────────────────────────
       *
       * It scrolled on a wheel and a trackpad swipe, and on a mouse
       * there was no way to move it: everything past the third card sat
       * behind a gesture the hardware could not make.
       *
       * user-select is off only WHILE dragging. Held permanently it
       * would stop anybody copying a thesis, which is the one thing on
       * these cards worth copying.
       * ────────────────────────────────────────────────────────────*/
      /* ── A SECTION NAME ──────────────────────────────────────────
       *
       * A word, in sentence case. It was a coloured lozenge in front of
       * 10px mono capitals on a 0.18em track, and the lozenge's hue came
       * from the same colour-per-sort-key table whose ticks came off the
       * buttons. Taking it off the controls and leaving it on the
       * headings was half a job.
       * ────────────────────────────────────────────────────────────*/
      .frens-h {
        margin-bottom: 14px;
        font-size: 14px;
        font-weight: 500;
        color: var(--ink-0);
      }
      /* The qualifier, set back: Best calls is the section and
         7 days is a note on it. They were the same size and weight. */
      .frens-h > small {
        margin-left: 8px;
        font-size: 11.5px;
        font-weight: 400;
        color: var(--ink-3);
      }

      .frens-pull { cursor: grab; }
      .frens-pulling { cursor: grabbing; user-select: none; }
      .frens-pulling * { pointer-events: none; }

      /* ── ONE CALL, AS A TICKET ───────────────────────────────────
       *
       * It was a glass pane: a translucent two stop gradient under a
       * 14px backdrop blur at 1.3 saturation, a hairline, an inset top
       * light and a 4px coloured strip, with the thesis clamped to
       * three lines inside it.
       * ────────────────────────────────────────────────────────────*/
      .frens-tk {
        flex: none;
        width: 268px;
        padding: 14px;
        border: 1px solid var(--hairline);
        border-radius: 12px;
        background: rgba(11, 14, 20, 0.035);
        text-align: left;
        cursor: pointer;
        transition: background-color 130ms var(--ease, ease);
      }
      .frens-tk:hover { background: rgba(11, 14, 20, 0.06); }

      .frens-tk-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .frens-tk-id { min-width: 0; }
      .frens-tk-n {
        font-size: 14px;
        font-weight: 600;
        color: var(--ink-0);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .frens-tk-when { margin-top: 2px; font-size: 10.5px; color: var(--ink-3); white-space: nowrap; }

      /* The reason anybody reads the card, at the size that says so. It
         was 15px, the same as the handle beside it. Green, not the
         fren's colour: a figure that went up is green everywhere in
         this product, and on a number that outranks identity. */
      .frens-tk-pct {
        margin-left: auto;
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--up);
        white-space: nowrap;
      }

      .frens-tk-thesis {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--ink-2);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        overflow-wrap: anywhere;
      }

      .frens-tk-by { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
      .frens-tk-who {
        font-size: 12px;
        font-weight: 500;
        color: var(--ink-1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      /* ── THE CONTROLS ────────────────────────────────────────────
       *
       * Words, the live one white. They were glass capsules carrying a
       * 4px coloured tick and mono capitals on a wide track, and the
       * tick's hue came from a colour-per-sort-key table.
       *
       * Those ticks are gone because colour on this page now means a
       * PERSON. Every fren carries their own hue on the board, in the
       * calls and in the roster above, so a green tick meaning "you
       * pressed PnL" made the same green say two unrelated things on
       * one screen.
       * ────────────────────────────────────────────────────────────*/
      .frc {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 14px 24px;
        margin: 22px 2px 24px;
        padding-top: 22px;
        border-top: 1px solid var(--hairline);
      }

      .frc-sorts, .frc-win { display: inline-flex; align-items: center; gap: 18px; }
      .frc-win { gap: 14px; }
      .frc-right { display: inline-flex; align-items: center; gap: 20px; }

      .frc-sorts > button, .frc-win > button {
        padding: 0;
        border: 0;
        background: none;
        font: 500 12.5px/1 var(--sans);
        color: var(--ink-3);
        cursor: pointer;
        transition: color 130ms var(--ease, ease);
      }
      .frc-win > button { font-size: 12px; }
      .frc-sorts > button[data-on], .frc-win > button[data-on] { color: var(--ink-0); }
      .frc-sorts > button:hover, .frc-win > button:hover { color: var(--ink-1); }
      .frc-sorts > button:focus-visible, .frc-win > button:focus-visible {
        outline: none;
        color: var(--ink-0);
        text-decoration: underline;
        text-underline-offset: 4px;
      }

      /* The one control that keeps an outline: a field you type into has
         to look like somewhere to type. A 7px corner and a hairline,
         not a 999px pill on a glass fill. */
      .frc-search {
        width: min(250px, 42vw);
        height: 30px;
        padding: 0 11px;
        border: 1px solid var(--hairline-2, rgba(11, 14, 20, 0.12));
        border-radius: 7px;
        background: transparent;
        color: var(--ink-0);
        font: 400 12px/1 var(--sans);
        outline: none;
        transition: border-color 130ms var(--ease, ease);
      }
      .frc-search::placeholder { color: var(--ink-3); }
      .frc-search:focus { border-color: rgba(11, 14, 20, 0.24); }

      @media (max-width: 820px) {
        /* Tap targets. Bare words are 13px tall, which is fine for a
           cursor and bad for a thumb: the padding grows the hit box to
           40 and an equal negative margin takes the space back, so the
           row looks identical. */
        .frc-sorts > button, .frc-win > button { padding: 13px 0; margin: -13px 0; }
        .frc { flex-direction: column; align-items: flex-start; }
        .frc-right { width: 100%; flex-direction: column; align-items: flex-start; gap: 16px; }
        .frc-search { width: 100%; }
      }
      @keyframes frens-drift { from { transform: translateX(0); } to { transform: translateX(16px); } }
      @keyframes frens-shimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
      .frens-sec { animation: frens-rise 420ms cubic-bezier(0.16, 1, 0.3, 1) both; }
      .frens-sec-2 { animation: frens-rise 440ms cubic-bezier(0.16, 1, 0.3, 1) 50ms both; }
      .frens-sec-3 { animation: frens-rise 460ms cubic-bezier(0.16, 1, 0.3, 1) 110ms both; }
      .frens-sec-4 { animation: frens-rise 480ms cubic-bezier(0.16, 1, 0.3, 1) 170ms both; }
      .frens-streak { animation: frens-drift 14s ease-in-out infinite alternate; }
      .frens-shimmerbar { animation: frens-shimmer 1.4s linear infinite; }
      .frens-row { transition: background 120ms ease; }
      .frens-row:hover { background: rgba(11, 14, 20, 0.035); }

      /* ── liquid glass system ────────────────────────────────────
         One recipe for every control on the page: a cool translucent
         pane (gradient body + backdrop blur), a specular top edge, a
         soft floor shadow. Tinted states pour the control's own color
         into the pane via --gc instead of switching to a flat fill —
         vibrant where it matters, calm everywhere else. */
      .frens-glass {
        background: linear-gradient(
          160deg,
          rgba(11,14,20,0.05) 0%,
          rgba(11,14,20,0.025) 46%,
          rgba(11,14,20,0.015) 100%
        );
        -webkit-backdrop-filter: blur(14px) saturate(1.35);
        backdrop-filter: blur(14px) saturate(1.35);
        border: 1px solid rgba(11,14,20,0.1);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.9),
          inset 0 -1px 0 rgba(11,14,20,0.05),
          0 10px 26px -18px rgba(11,14,20,0.35);
        transition: background 160ms ease, border-color 160ms ease,
          box-shadow 200ms ease, transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .frens-glass:hover {
        border-color: rgba(11,14,20,0.16);
        background: linear-gradient(
          160deg,
          rgba(11,14,20,0.075) 0%,
          rgba(11,14,20,0.04) 46%,
          rgba(11,14,20,0.02) 100%
        );
      }
      /* Tinted (active) pane: the control's color suffuses the glass. */
      .frens-glass[aria-pressed="true"], .frens-glass--tint {
        background: linear-gradient(
          160deg,
          color-mix(in srgb, var(--gc, var(--accent-primary)) 14%, rgba(11,14,20,0.03)) 0%,
          color-mix(in srgb, var(--gc, var(--accent-primary)) 6%, rgba(11,14,20,0.015)) 55%,
          color-mix(in srgb, var(--gc, var(--accent-primary)) 4%, transparent) 100%
        );
        border-color: color-mix(in srgb, var(--gc, var(--accent-primary)) 38%, rgba(11,14,20,0.12));
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.95),
          inset 0 -1px 0 rgba(11,14,20,0.05),
          0 0 24px -8px color-mix(in srgb, var(--gc, var(--accent-primary)) 65%, transparent),
          0 10px 26px -18px rgba(11,14,20,0.35);
      }
      /* No-blur fallback: lean on a slightly more opaque pane instead. */
      @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
        .frens-glass { background: rgba(255, 255, 255, 0.9); }
        .frens-glass[aria-pressed="true"], .frens-glass--tint {
          background: color-mix(in srgb, var(--gc, var(--accent-primary)) 12%, rgba(255, 255, 255, 0.94));
        }
      }

      .frens-card {
        transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), border-color 180ms ease, box-shadow 180ms ease;
      }
      .frens-card:hover {
        transform: translateY(-3px);
        border-color: color-mix(in srgb, var(--fc, #ffffff) 55%, var(--hairline)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.9),
          0 16px 36px -20px color-mix(in srgb, var(--fc, #ffffff) 50%, transparent);
      }
      .frens-lens { border-radius: 999px; cursor: pointer; }
      .frens-lens:hover .frens-lens-label { color: var(--ink-1); }
      .frens-win { border-radius: 999px; cursor: pointer; }
      .frens-search:focus {
        border-color: color-mix(in srgb, var(--accent-primary) 60%, transparent) !important;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.9),
          0 0 0 3px color-mix(in srgb, var(--accent-primary) 16%, transparent);
      }
      .frens-track { transition: filter 120ms ease, transform 120ms ease, box-shadow 200ms ease; }
      .frens-track:hover {
        filter: brightness(1.12);
        transform: translateY(-1px);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.95),
          0 0 26px -8px color-mix(in srgb, var(--accent-primary) 70%, transparent);
      }
      .frens-track:active { transform: none; }
      /* The mosaic's arrival: cells blow in from scattered positions with
         spin and blur, spring past their seat, settle, and FLASH as they
         land. One shot — mount only, never loops. */
      @keyframes frens-scatter {
        0% { transform: translate(var(--dx), var(--dy)) rotate(var(--dr)) scale(0.2); opacity: 0; filter: blur(4px); }
        18% { opacity: 1; }
        58% { transform: translate(calc(var(--dx) * -0.08), calc(var(--dy) * -0.08)) rotate(calc(var(--dr) * -0.12)) scale(1.12); filter: blur(0px); }
        78% { transform: translate(calc(var(--dx) * 0.03), calc(var(--dy) * 0.03)) rotate(calc(var(--dr) * 0.04)) scale(0.96); }
        100% { transform: none; opacity: 1; filter: none; }
      }
      @keyframes frens-spark {
        0% { box-shadow: 0 0 0 0 transparent; }
        30% { box-shadow: 0 0 6px 1px rgba(11,14,20,0.28), 0 0 18px 5px currentColor; }
        100% { box-shadow: 0 0 0 0 transparent; }
      }
      .frens-pixel {
        animation:
          frens-scatter var(--fd, 2s) cubic-bezier(0.16, 1, 0.3, 1) var(--fdel, 0s) both,
          frens-spark 650ms ease-out calc(var(--fdel, 0s) + var(--fd, 2s) * 0.58) both;
      }
      .frens-rail { position: fixed; top: 50%; transform: translateY(-50%); z-index: 1; pointer-events: none; }
      @media (max-width: 1580px) { .frens-rail { display: none; } }
      @media (max-width: 780px) {
        .frens-podium { grid-template-columns: 1fr !important; align-items: stretch !important; }
        .frens-podium-slot[data-rank="1"] { order: -1; }
        .frens-pixels { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .frens-sec, .frens-sec-2, .frens-sec-3, .frens-sec-4, .frens-streak, .frens-shimmerbar, .frens-pixel, .frens-sig-dot, .frens-rail-dot { animation: none; }
        .frens-card, .frens-track, .frens-glass { transition: none; }
      }

      /* ── PHONE, LAST WORD ────────────────────────────────────────
       *
       * These two have their base rules further down the sheet, so an
       * override written earlier loses on source order even though the
       * media query matches. Last block in the file wins.
       * ───────────────────────────────────────────────────────────── */
      @media (max-width: 720px) {
        .frens-h { margin-bottom: 18px; }
        .frc { margin: 22px 2px 6px; gap: 16px 20px; }
      }
    `}</style>
  );
}

// ───────── masthead ─────────

/** Racing confetti bars, right-anchored, bleeding off the panel edge. */
const STREAKS: ReadonlyArray<{ top: number; right: number; w: number; c: string }> = [
  { top: 0, right: -60, w: 240, c: '#0d7a45' },
  { top: 0, right: 198, w: 120, c: '#0f8a5f' },
  { top: 18, right: -28, w: 150, c: '#1f8fc4' },
  { top: 18, right: 138, w: 70, c: '#b8339c' },
  { top: 36, right: -70, w: 280, c: '#4f9c33' },
  { top: 36, right: 228, w: 80, c: '#1e4fc0' },
  { top: 54, right: -18, w: 130, c: '#c08a12' },
  { top: 54, right: 128, w: 90, c: '#1e40af' },
  { top: 72, right: -48, w: 190, c: '#0e93ac' },
];

/** Sparse pixel mosaic — the "crowd", one bright cell per fren. */
const PIXELS: ReadonlyArray<[number, number, string]> = [
  [0, 1, '#1f8fc4'],
  [0, 2, '#0e93ac'],
  [0, 5, '#0f8a5f'],
  [0, 6, '#0d7a45'],
  [1, 0, '#1e4fc0'],
  [1, 2, '#0b7ba8'],
  [1, 4, '#4f9c33'],
  [1, 6, '#c08a12'],
  [2, 1, '#b8339c'],
  [2, 3, '#9c1fac'],
  [2, 5, '#b8760a'],
  [2, 6, '#c08a12'],
  [3, 0, '#6b46c8'],
  [3, 4, '#a8921a'],
];

/**
 * ── THE MASTHEAD ─────────────────────────────────────────────────────
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * A lifted plate with a gradient ground and an inset top light,
 * carrying: a field of coloured streak bars in the top right; a sparse
 * pixel mosaic underneath them; the word `frens` set at up to 62px in a
 * serif italic lowercase, under a nav that already says Frens; and two
 * bordered capsules in mono capitals, each with its own coloured block.
 *
 * ── WHAT IT IS ───────────────────────────────────────────────────────
 *
 * The same parts, and one of them now carries data. The streaks and the
 * mosaic were decoration in eight hues; the ROSTER is one tile per
 * fren, in that fren's own colour, so the ornament is the board.
 *
 * The light crossing it is a `filter` on brightness plus a small
 * scale — nothing moves position and no tile changes hue, which is the
 * quietest way to make a static object feel live. It is cut entirely by
 * `prefers-reduced-motion`.
 */
export function Masthead({
  frens,
  calls,
  loading,
  ids,
  boardPnlSol,
  bestCallPct,
}: {
  frens: number;
  calls: number;
  loading: boolean;
  /** The user ids on the board, so each tile is a real person. */
  ids: ReadonlyArray<string>;
  /** Every row on the board, summed. */
  boardPnlSol: number;
  /** The highest multiple on the board; null if nobody has called. */
  bestCallPct: number | null;
}): React.ReactElement {
  return (
    <header className="frm">
      {/*
       * The banner is the BOARD, drawn large. One tile per fren, in
       * that fren's own hue — the same colour their roster tile, their
       * rank bar and their calls card carry — so when the board changes
       * the banner changes with it.
       *
       * It replaces a 90px block of the same tiles sitting in the top
       * right corner: same idea, given the whole width.
       *
       * Still, deliberately. It carried a brightness flash crossing on
       * a diagonal, and a flash is the wrong idea for a banner — this
       * is a place you arrive at, not a thing that blinks at you.
       */}
      {ids.length > 0 ? (
        <div className="frm-tiles" aria-hidden>
          {Array.from({ length: 48 }, (_, i) => (
            <span key={i} style={{ background: frenInk(ids[i % ids.length]!) }} />
          ))}
        </div>
      ) : null}

      <div className="frm-in">
        <h1>Frens</h1>
        <p>Best calls, real PnL, one click tracking. Find the people worth listening to.</p>
      </div>

      {/*
       * The figures, recessed into their own tray.
       *
       * The header carried two COUNTS OF ROWS and nothing else — `12
       * frens on the board`, `5 scored calls` — so the top of a
       * leaderboard opened without naming one thing that had been won.
       * The two added here are summed and maxed off the same rows the
       * board renders, so the header cannot disagree with the table
       * under it.
       *
       * The tray is DARKER than the box holding it, which is what makes
       * it read as set INTO the box rather than as a second panel
       * stacked on the first.
       */}
      <div className="frm-tray">
        {loading ? (
          <span className="frens-shimmerbar frm-load" aria-label="Loading leaderboard" />
        ) : (
          <div className="frm-figs">
            <span>
              <b>{frens}</b>
              <i>{frens === 1 ? 'fren on the board' : 'frens on the board'}</i>
            </span>
            <span>
              <b>{calls}</b>
              <i>scored {calls === 1 ? 'call' : 'calls'}</i>
            </span>
            <span>
              <b className={boardPnlSol < 0 ? 'frb-down' : 'frb-up'}>
                <Solana className="frb-sol" style={{ width: 10, height: 10 }} />
                {boardPnlSol >= 0 ? '+' : '−'}
                {/*
                 * No cents. This is four figures of SOL summed across a
                 * whole board, and `2,472.88` spends its two most
                 * precise digits on a number nobody reconciles — beside
                 * `12`, `5` and `12x` it was also twice the width of
                 * anything else in the tray. The rows themselves still
                 * carry their decimals, where the precision is read.
                 */}
                {Math.round(Math.abs(boardPnlSol)).toLocaleString('en-US')}
              </b>
              <i>{boardPnlSol < 0 ? 'down between them' : 'up between them'}</i>
            </span>
            {bestCallPct !== null ? (
              <span>
                <b>{formatCallPct(bestCallPct)}</b>
                <i>best call</i>
              </span>
            ) : null}
          </div>
        )}
      </div>
    </header>
  );
}

function MastChip({ block, children }: { block: string; children: string }): React.ReactElement {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontFamily: 'var(--mono)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        color: 'var(--ink-2)',
        border: '1px solid var(--hairline)',
        borderRadius: 8,
        padding: '5px 10px',
        background: 'rgba(11, 14, 20, 0.03)',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2.5, background: block }} />
      {children}
    </span>
  );
}

function PixelMosaic({
  className,
  style,
  cell = 13,
  chime = false,
}: {
  className?: string;
  style?: CSSProperties;
  cell?: number;
  /** Play the landing chimes (masthead only — empty states stay silent). */
  chime?: boolean;
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!chime) return undefined;
    // Hidden mosaic (mobile media query) → no landings → no sound.
    const el = rootRef.current;
    if (!el || el.getClientRects().length === 0) return undefined;
    // Landing times mirror the CSS exactly: delay + flight * 0.58 (the
    // spark moment) — the same formulas that set --fdel/--fd below.
    const landings = PIXELS.map((_, index) => ({
      atMs: ((index * 83) % 900) + (1700 + ((index * 53) % 700)) * 0.58,
      index,
    }));
    return scheduleMosaicChimes(landings);
  }, [chime]);
  return (
    <div
      ref={rootRef}
      aria-hidden
      className={className}
      style={{ pointerEvents: 'none', width: 7 * (cell + 3), height: 4 * (cell + 3), ...style }}
    >
      {PIXELS.map(([r, c, color], index) => {
        // One-shot assembly physics (load/refresh only, never loops).
        // Deterministic pseudo-random scatter per cell — SSR and client
        // must agree or hydration flags a style mismatch.
        const dx = ((index * 97 + 31) % 240) - 120;
        const dy = ((index * 61 + 17) % 200) - 100;
        const dr = ((index * 49 + 23) % 160) - 80;
        const delay = (index * 83) % 900;
        const dur = 1700 + ((index * 53) % 700);
        return (
          <span
            key={index}
            className="frens-pixel"
            style={
              {
                position: 'absolute',
                top: r * (cell + 3),
                left: c * (cell + 3),
                width: cell,
                height: cell,
                borderRadius: 4,
                background: color,
                color,
                '--dx': `${dx}px`,
                '--dy': `${dy}px`,
                '--dr': `${dr}deg`,
                '--fdel': `${delay}ms`,
                '--fd': `${dur}ms`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

// ───────── page edges: the gutters get an artist's hand ─────────

/**
 * Fixed gutter rails, shown only when real gutters exist (>1580px).
 * Left: a vertical inscription with a hanging hairline — the plate
 * signature. Right: a falling column of confetti dots, fading out.
 * Both are whisper-quiet: tiny, dim, pointer-transparent.
 */
export function EdgeRails(): React.ReactElement {
  return (
    <>
      <div aria-hidden className="frens-rail" style={{ left: 26 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {['#0f8a5f', '#b8339c', '#1f8fc4'].map((c, index) => (
              <span
                key={c}
                className="frens-rail-dot"
                style={
                  {
                    width: 7,
                    height: 7,
                    borderRadius: 2,
                    background: c,
                    opacity: 0.55,
                    '--sway': '4px',
                    animationDelay: `${index * 320}ms`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
          <span
            style={{
              width: 1,
              height: 120,
              background:
                'linear-gradient(180deg, var(--hairline-2, rgba(11, 14, 20, 0.14)), transparent)',
            }}
          />
        </div>
      </div>
      <div aria-hidden className="frens-rail" style={{ right: 30 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {CONFETTI.map((c, index) => (
            <span
              key={c}
              className="frens-rail-dot"
              style={
                {
                  width: index % 3 === 0 ? 8 : 6,
                  height: index % 3 === 0 ? 8 : 6,
                  borderRadius: index % 2 === 0 ? 2 : '50%',
                  background: c,
                  opacity: Math.max(0.12, 0.6 - index * 0.06),
                  marginTop: index === 0 ? 0 : [18, 10, 26, 14, 22, 12, 30][index % 7],
                  '--sway': '-4px',
                  animationDelay: `${index * 260}ms`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * The plate mark: how a print signs off. Serif italic monogram, a
 * confetti tick row, and an edition line — quiet, centered, final.
 */
export function SignatureFooter(): React.ReactElement {
  return (
    <div aria-hidden className="frens-sig" style={{ textAlign: 'center', userSelect: 'none' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          style={{
            width: 44,
            height: 1,
            background: 'linear-gradient(90deg, transparent, var(--hairline-2, rgba(11, 14, 20, 0.14)))',
          }}
        />
        {['#0f8a5f', '#1f8fc4', '#b8339c', '#c08a12'].map((c, index) => (
          <span
            key={c}
            className="frens-sig-dot"
            style={{
              width: 6,
              height: 6,
              borderRadius: 2,
              background: c,
              opacity: 0.7,
              animationDelay: `${index * 180}ms`,
            }}
          />
        ))}
        <span
          style={{
            width: 44,
            height: 1,
            background: 'linear-gradient(90deg, var(--hairline-2, rgba(11, 14, 20, 0.14)), transparent)',
          }}
        />
      </div>
      {/* Both lines take the masthead's type. The monogram was a serif
          italic and the line under it was 8.5px on a 0.32em track, so
          the only two words down here were set in two faces the page
          uses nowhere else. */}
      {/* A sign off, so it sits well back. At 20px in --ink-2 it was
          competing with the content above it. */}
      <div
        style={{
          marginTop: 10,
          fontFamily: 'var(--sans)',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink-3)',
        }}
      >
        frens
      </div>
      <div
        style={{
          marginTop: 2,
          fontFamily: 'var(--sans)',
          fontSize: 10.5,
          fontWeight: 400,
          letterSpacing: '-0.005em',
          color: 'var(--ink-4, #2a2d36)',
        }}
      >
        A Listen original
      </div>
    </div>
  );
}

/**
 * ── A SECTION NAME ───────────────────────────────────────────────────
 *
 * A word and its window, in sentence case.
 *
 * It was a coloured lozenge in front of 10px mono capitals on a 0.18em
 * track, and the lozenge took `LENS_COLOR` — a hue per SORT KEY. That
 * is the same table whose ticks came off the sort tabs, for the same
 * reason: colour on this page means a PERSON now, and a pink block
 * meaning `you are sorted by best calls` made the palette say two
 * unrelated things on one screen. Removing it from the buttons and
 * leaving it on the headings was half a job.
 *
 * The window is set back rather than shouted in capitals: `Best calls`
 * is the section, `7 days` is a qualifier on it, and they were the same
 * size and the same weight.
 */
function SectionTitle({ children, meta }: { children: string; meta?: string }): React.ReactElement {
  return (
    <div className="frens-h">
      {children}
      {meta ? <small>{meta}</small> : null}
    </div>
  );
}

// ───────── best-thesis strip ─────────

/**
 * Horizontal strip that consumes the mouse wheel while hovered — no
 * visible affordance, it just scrolls sideways. Native non-passive
 * listener (React's synthetic wheel is passive, so it can't
 * preventDefault); the page only keeps the event when the strip
 * actually moved, so wheeling past either end falls through to normal
 * page scroll.
 */
/**
 * ── THE STRIP YOU CAN PULL ───────────────────────────────────────────
 *
 * It scrolled on a wheel and on a trackpad swipe, and on a mouse there
 * was no way to move it at all: everything past the third card sat
 * behind a gesture the hardware could not make.
 *
 * Grab and drag now. Three details make it feel like an object rather
 * than a scroll hack:
 *
 * POINTER CAPTURE. The drag keeps working when the cursor leaves the
 * strip, so pulling fast off the edge does not drop it mid gesture.
 *
 * A THRESHOLD BEFORE IT COUNTS. The cards are buttons. Under four
 * pixels of travel the gesture is a click and the card opens; past it,
 * the pointer is dragging and `click` is swallowed once on release. Any
 * lower and a slightly shaky click opens nothing, which is the more
 * annoying failure.
 *
 * `user-select` OFF WHILE DRAGGING ONLY. Held permanently it would stop
 * anybody copying a thesis, which is the one thing on these cards worth
 * copying.
 */
function WheelRow({
  style,
  children,
}: {
  style?: CSSProperties;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Trackpad horizontal gestures already scroll the strip natively.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      const before = el.scrollLeft;
      el.scrollLeft = before + e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    /* Touch already drags natively, and hijacking it would fight the
       browser's own momentum. This is for pointers that cannot swipe. */
    if (!el || e.pointerType === 'touch' || e.button !== 0) return;
    if (el.scrollWidth <= el.clientWidth) return;
    drag.current = { id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setPulling(true);
    }
    el.scrollLeft = d.left - dx;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d || d.id !== e.pointerId) return;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    drag.current = null;
    setPulling(false);
  };

  return (
    <div
      ref={ref}
      className={pulling ? 'scroll-hide frens-pull frens-pulling' : 'scroll-hide frens-pull'}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      /* Swallowed once, on the release that ended a real drag, so the
         card underneath does not open the call you just dragged past. */
      onClickCapture={(e) => {
        if (pulling) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * ── ONE CALL, AS A TICKET ────────────────────────────────────────────
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * A glass pane: a two stop translucent gradient under a 14px backdrop
 * blur with saturation pushed to 1.3, a hairline, an inset top light,
 * and a 4px identity strip across the top edge — with the thesis
 * clamped to three lines in it.
 *
 * Three things were wrong underneath the paint:
 *
 * THE COLOUR WAS `confetti(index)`. Keyed to the card's position in the
 * array, so it changed whenever the window or the sort changed, and the
 * fren it belonged to was wearing somebody else's colour. It is
 * `frenInk` now, hashed on the user id, the same colour they carry on
 * the board and in the roster.
 *
 * THE PERCENTAGE WAS 15px, the same size as the handle beside it, when
 * it is the entire reason anybody reads the card.
 *
 * AND THE TOKEN WAS AT THE BOTTOM in 10px mono. A call is about a coin
 * before it is about a person: you scan this strip for a ticker you
 * hold, and it was the smallest thing on the card.
 *
 * ── AND THE GAIN STAYS GREEN ─────────────────────────────────────────
 *
 * Not the fren's colour. A figure that went up is green everywhere else
 * in this product, and on a number that meaning outranks identity — a
 * call up 95% rendered in violet is a violet number, not a win.
 */
export function ThesisCard({
  call,
  onOpen,
}: {
  call: TopCall;
  onOpen: (callId: string, hint: CallOpenHint | null) => void;
}): React.ReactElement {
  const ink = frenInk(call.user_id);
  return (
    <button
      type="button"
      className="frens-tk"
      onClick={() => onOpen(call.call_id, { mint: call.mint, createdAtMs: Date.parse(call.created_at) })}
    >
      <div className="frens-tk-head">
        <TokenImage src={call.image_url} ticker={call.ticker} size={30} />
        <div className="frens-tk-id">
          <div className="frens-tk-n">${call.ticker ?? '·'}</div>
          <div className="frens-tk-when">
            {compactAge(Date.now() - Date.parse(call.created_at))} ago · to ATH
          </div>
        </div>
        <span className="frens-tk-pct">{formatCallPct(call.pct)}</span>
      </div>

      <p className="frens-tk-thesis">{call.thesis}</p>

      {/* The fren, at the foot. They are the attribution on a call, and
          the mark is the only place their colour lands on this card. */}
      <div className="frens-tk-by">
        <Avatar who={call} size={20} />
        <span className="frens-tk-who" style={{ ['--fi' as string]: ink }}>
          @{call.label}
        </span>
      </div>
    </button>
  );
}

// ───────── calls table (Best Calls lens) ─────────

const CALLS_GRID_TEMPLATE =
  '58px minmax(140px, 1fr) minmax(130px, 0.9fr) 90px 80px minmax(220px, 1.8fr) 92px';

const callsRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: CALLS_GRID_TEMPLATE,
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
};

function RankCell({ rank, userId }: { rank: number; userId?: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span
        aria-hidden
        style={{
          width: 3,
          height: 16,
          borderRadius: 2,
          /* Keyed to the FREN, not to the array index. It was
             `confetti(rank - 1)`, so a row changed colour every time the
             board was sorted differently and wore whoever happened to be
             standing in that slot. */
          background: userId ? frenInk(userId) : 'var(--ink-4)',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 12, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>{rank}</span>
    </div>
  );
}

export function CallRow({
  call,
  rank,
  tracked,
  onTracked,
  onOpenProfile,
  onOpenCall,
}: {
  call: TopCall;
  rank: number;
  tracked: boolean;
  onTracked: (pubkey: string) => void;
  onOpenProfile: (userId: string) => void;
  onOpenCall: (callId: string, hint: CallOpenHint | null) => void;
}): React.ReactElement {
  return (
    <div
      className="frens-row"
      style={{
        ...callsRowStyle,
        borderTop: '1px solid color-mix(in srgb, var(--hairline) 60%, transparent)',
      }}
    >
      <RankCell rank={rank} />
      <button
        type="button"
        onClick={() => navigateToToken(call.mint)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          minWidth: 0,
        }}
      >
        <TokenImage src={call.image_url} ticker={call.ticker} size={26} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink-0)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          ${call.ticker ?? '·'}
        </span>
      </button>
      <div
        onClick={() => onOpenProfile(call.user_id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onOpenProfile(call.user_id)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, cursor: 'pointer' }}
      >
        <Avatar who={call} size={22} />
        <span
          style={{
            fontSize: 12,
            color: 'var(--ink-1)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {call.label}
        </span>
      </div>
      <div
        onClick={() => onOpenCall(call.call_id, { mint: call.mint, createdAtMs: Date.parse(call.created_at) })}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onOpenCall(call.call_id, { mint: call.mint, createdAtMs: Date.parse(call.created_at) })}
        style={{
          textAlign: 'right',
          fontFamily: 'var(--mono)',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--up)',
          cursor: 'pointer',
        }}
      >
        {formatCallPct(call.pct)}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>
        {compactAge(Date.now() - Date.parse(call.created_at))}
      </div>
      <div
        onClick={() => onOpenCall(call.call_id, { mint: call.mint, createdAtMs: Date.parse(call.created_at) })}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onOpenCall(call.call_id, { mint: call.mint, createdAtMs: Date.parse(call.created_at) })}
        title={call.thesis}
        style={{
          fontSize: 12,
          color: 'var(--ink-1)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          cursor: 'pointer',
        }}
      >
        {call.thesis}
      </div>
      <div style={{ textAlign: 'right' }}>
        <TrackButton row={call} tracked={tracked} onTracked={onTracked} />
      </div>
    </div>
  );
}

// ───────── podium ─────────

export function PodiumCard({
  row,
  rank,
  sort,
  tracked,
  onTracked,
  onOpenProfile,
  onOpenCall,
}: {
  row: FrenLeaderboardRow;
  rank: number;
  sort: SortKey;
  tracked: boolean;
  onTracked: (pubkey: string) => void;
  onOpenProfile: (userId: string) => void;
  onOpenCall: (callId: string, hint: CallOpenHint | null) => void;
}): React.ReactElement {
  const first = rank === 1;
  const theme = rankTheme(rank);
  const pnlSol = lamportsToSol(row.pnl_lamports);
  const rate = winRatePct(row);
  // Label and value must AGREE: on the calls lens a caller with no
  // scoreable call shows an honest placeholder dot, never their PnL
  // mislabeled as "BEST CALL".
  const callsLens = sort === 'calls';
  const headline = callsLens
    ? row.best_call_pct !== null
      ? formatCallPct(row.best_call_pct)
      : '·'
    : `${pnlSol >= 0 ? '+' : ''}${formatSolCompact(pnlSol)}`;
  const headlineColor = callsLens
    ? row.best_call_pct !== null
      ? 'var(--up)'
      : 'var(--ink-3)'
    : pnlSol >= 0
      ? 'var(--up)'
      : 'var(--down)';
  return (
    <div
      className="frens-card"
      style={
        {
          '--fc': theme.main,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 18,
          border: `1px solid ${
            first ? `color-mix(in srgb, ${theme.main} 40%, rgba(11,14,20,0.12))` : 'rgba(11,14,20,0.1)'
          }`,
          background:
            'linear-gradient(165deg, color-mix(in srgb, var(--surface-2) 68%, transparent), color-mix(in srgb, var(--surface-1) 62%, transparent))',
          backdropFilter: 'blur(14px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
          boxShadow: first
            ? `inset 0 1px 0 rgba(255,255,255,0.9), 0 0 38px -16px color-mix(in srgb, ${theme.main} 45%, transparent)`
            : 'inset 0 1px 0 rgba(255,255,255,0.9)',
          padding: first ? '14px 18px 14px' : '12px 16px 12px',
        } as CSSProperties
      }
    >
      {/* The collage band: overlapping confetti blocks + ghost numeral. */}
      <div aria-hidden style={{ position: 'relative', height: first ? 34 : 28, marginBottom: 8 }}>
        <span
          style={{
            position: 'absolute',
            top: -26,
            right: -30,
            width: 120,
            height: 44,
            borderRadius: 12,
            background: theme.main,
            opacity: 0.9,
          }}
        />
        <span
          style={{
            position: 'absolute',
            top: -6,
            right: 54,
            width: 52,
            height: 26,
            borderRadius: 9,
            background: theme.soft,
            opacity: 0.8,
          }}
        />
        <span
          style={{
            position: 'absolute',
            top: 8,
            right: 20,
            width: 20,
            height: 12,
            borderRadius: 5,
            background: theme.main,
            opacity: 0.45,
          }}
        />
        <span
          style={{
            position: 'absolute',
            top: -8,
            left: -4,
            fontFamily: 'var(--display)',
            fontStyle: 'italic',
            fontSize: first ? 64 : 52,
            lineHeight: 1,
            color: theme.main,
            opacity: 0.16,
            userSelect: 'none',
          }}
        >
          {rank}
        </span>
        <span
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: theme.main,
            background: `color-mix(in srgb, ${theme.main} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${theme.main} 38%, transparent)`,
            borderRadius: 7,
            padding: '2px 8px',
          }}
        >
          #{rank}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={() => onOpenProfile(row.user_id)}
          aria-label={`View ${row.label}'s profile`}
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }}
        >
          <Avatar who={row} size={first ? 46 : 38} ring={theme.main} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div
            onClick={() => onOpenProfile(row.user_id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onOpenProfile(row.user_id)}
            style={{
              fontSize: first ? 15 : 13,
              fontWeight: 700,
              color: 'var(--ink-0)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              cursor: 'pointer',
            }}
          >
            {row.label}
            {rate !== null ? (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: 'var(--ink-3)' }}>
                {rate.toFixed(1)}% wins
              </span>
            ) : null}
          </div>
          {row.bio ? (
            <div
              style={{
                fontSize: 10,
                color: 'var(--ink-3)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 220,
              }}
            >
              {row.bio}
            </div>
          ) : null}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 9,
              letterSpacing: '0.16em',
              color: 'var(--ink-3)',
            }}
          >
            {sort === 'calls' ? 'BEST CALL' : 'PNL'}
          </div>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: first ? 19 : 15,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: headlineColor,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {!callsLens ? <Solana style={{ width: first ? 14 : 12, height: first ? 14 : 12 }} /> : null}
            {headline}
          </div>
        </div>
      </div>
      {row.best_call_pct !== null && row.best_call_mint ? (
        <div style={{ marginTop: 10 }}>
          <BestCallChip row={row} onOpenCall={onOpenCall} />
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          rowGap: 8,
          marginTop: 12,
          padding: '8px 10px',
          borderRadius: 12,
          border: '1px solid var(--hairline)',
          background: 'rgba(11, 14, 20, 0.16)',
        }}
      >
        <MiniStat label="Positions" value={String(row.positions)} split={[row.wins, row.losses]} />
        <MiniStat label="Trades" value={String(row.trades)} split={[row.buys, row.sells]} />
        <MiniStat label="Volume" value={sol1(lamportsToSol(row.volume_lamports))} sol />
        <MiniStat label="Calls" value={String(row.calls_count)} />
        <div style={{ flex: 1 }} />
        <TrackButton row={row} tracked={tracked} onTracked={onTracked} />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  split,
  sol,
}: {
  label: string;
  value: string;
  split?: [number, number];
  sol?: boolean;
}): React.ReactElement {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ink-0)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {sol ? <Solana style={{ width: 11, height: 11 }} /> : null}
        {value}
      </div>
      <div style={{ fontSize: 9, color: 'var(--ink-3)', letterSpacing: '0.08em' }}>
        {label}
        {split ? (
          <span style={{ marginLeft: 6, fontFamily: 'var(--mono)', letterSpacing: 0 }}>
            <span style={{ color: 'var(--up)' }}>{split[0]}</span>
            {' / '}
            <span style={{ color: 'var(--down)' }}>{split[1]}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ───────── table ─────────

const GRID_TEMPLATE = '58px minmax(160px, 1.4fr) 110px 90px 110px 110px 100px minmax(120px, 1fr) 92px';

const tableRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: GRID_TEMPLATE,
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
};

const headerCellStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: 0,
  color: 'var(--ink-3)',
};

function columnStyle(index: number): CSSProperties {
  // Numeric columns right-align from PnL onward except Fren/BestCall.
  if (index >= 2 && index <= 6) return { textAlign: 'right' };
  return {};
}

function LoadingRows(): React.ReactElement {
  return (
    <div style={{ padding: '18px 16px', display: 'grid', gap: 12 }}>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="frens-shimmerbar"
          style={{
            height: 30,
            borderRadius: 8,
            background:
              'linear-gradient(90deg, transparent, rgba(11, 14, 20, 0.06), transparent)',
            backgroundSize: '200% 100%',
            animationDelay: `${index * 140}ms`,
          }}
        />
      ))}
    </div>
  );
}

function EmptyState({ children }: { children: string }): React.ReactElement {
  return (
    <div style={{ padding: '34px 24px', textAlign: 'center' }}>
      <div style={{ position: 'relative', display: 'inline-block', height: 4 * 16, width: 7 * 16 }}>
        <PixelMosaic style={{ position: 'absolute', inset: 0 }} cell={13} />
      </div>
      <div style={{ marginTop: 12, color: 'var(--ink-3)', fontSize: 12 }}>{children}</div>
    </div>
  );
}

/*
 * ── THE PODIUM ───────────────────────────────────────────────────────
 *
 * Three owls on one rail, at three heights.
 *
 * The owl is the mark the cashback ladder roosts, and it is not an
 * image: `/assets/logo.svg` is used as a MASK and a metal gradient shows
 * through it, so one mark can be struck in any metal and stays sharp at
 * any size. The three ramps are lifted from `TierRoost.tsx`, where gold,
 * silver and bronze are already indices 3, 2 and 1 of the same five.
 * Each is five stops — dark edge, body, a tight specular band, body,
 * darker foot — because two stops make a coloured shape and it is the
 * narrow bright band that makes an eye read metal.
 *
 * No plinths and no fills: the podium is one hairline and three
 * positions above it. The rail is what makes the heights legible, since
 * a height has to be measured against something, and the leg is what
 * puts the owl ON the rail rather than floating over it.
 */
const PODIUM_METAL: ReadonlyArray<string> = [
  'linear-gradient(145deg, #7a5408 0%, #d3a72c 30%, #eccb63 46%, #c09220 66%, #6b4806 100%)',
  'linear-gradient(145deg, #5f666e 0%, #a2abb5 30%, #cdd5dc 46%, #929ba6 66%, #4f565e 100%)',
  'linear-gradient(145deg, #5e3115 0%, #a9642f 32%, #d29155 47%, #96552a 66%, #4d2711 100%)',
];
/* A flat tone per place, because a gradient cannot be a text colour. */
const PODIUM_TONE = ['#d3a72c', '#b3bcc6', '#a9642f'] as const;
const PODIUM_PLACE = ['First', 'Second', 'Third'] as const;

function Perch({
  podium,
  onOpenProfile,
}: {
  podium: ReadonlyArray<FrenLeaderboardRow>;
  onOpenProfile: (userId: string) => void;
}): React.ReactElement {
  /* Second, first, third. A podium is not in rank order left to right —
     but with fewer than three there is no middle to raise. */
  const order = podium.length >= 3 ? [1, 0, 2] : podium.map((_, i) => i);

  return (
    <div className="frp" data-thin={podium.length < 3 ? '' : undefined}>
      <div className="frp-row">
        {order.map((p) => (
          <div className="frp-c" key={podium[p]!.user_id} data-place={p}>
            <span
              className="frp-owl"
              aria-hidden
              style={{ background: PODIUM_METAL[p] ?? PODIUM_METAL[2] }}
            />
            <span
              className="frp-leg"
              aria-hidden
              style={{ ['--tone' as string]: PODIUM_TONE[p] ?? PODIUM_TONE[2] }}
            />
          </div>
        ))}
      </div>
      <div className="frp-rail" aria-hidden />
      <div className="frp-names">
        {order.map((p) => {
          const row = podium[p]!;
          const pnlSol = lamportsToSol(row.pnl_lamports);
          const rate = winRatePct(row);
          return (
            <div
              className="frp-id"
              key={row.user_id}
              style={{ ['--tone' as string]: PODIUM_TONE[p] ?? PODIUM_TONE[2] }}
            >
              <span className="frp-place">{PODIUM_PLACE[p] ?? `${p + 1}`}</span>
              <b
                className="frp-name"
                role="button"
                tabIndex={0}
                onClick={() => onOpenProfile(row.user_id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpenProfile(row.user_id)}
              >
                {row.label}
              </b>
              <span className={`frp-gain ${pnlSol < 0 ? 'frb-down' : 'frb-up'}`}>
                <Solana className="frb-sol" style={{ width: 9, height: 9 }} />
                {pnlSol >= 0 ? '+' : '−'}
                {Math.abs(pnlSol).toFixed(2)}
              </span>
              <span className="frp-meta">
                {rate === null ? null : `${rate.toFixed(1)}% wins`}
                {rate === null ? null : ' · '}
                {row.positions} positions
                {row.best_call_pct !== null ? ` · ${formatCallPct(row.best_call_pct)} best call` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TableRow({
  row,
  rank,
  onOpenProfile,
}: {
  row: FrenLeaderboardRow;
  rank: number;
  onOpenProfile: (userId: string) => void;
}): React.ReactElement {
  const pnlSol = lamportsToSol(row.pnl_lamports);
  const rate = winRatePct(row);
  return (
    <div className="frb-row">
      <span className="frb-n">{rank}</span>
      <b
        className="frb-name"
        role="button"
        tabIndex={0}
        onClick={() => onOpenProfile(row.user_id)}
        onKeyDown={(e) => e.key === 'Enter' && onOpenProfile(row.user_id)}
      >
        {row.label}
      </b>
      <span className="frb-r frb-val">{rate === null ? '·' : `${rate.toFixed(1)}%`}</span>
      <span className="frb-r frb-val">{row.positions}</span>
      <span className="frb-r frb-val">{row.trades}</span>
      <span className="frb-r frb-val">
        <Solana className="frb-sol" style={{ width: 8, height: 8 }} />
        {formatVolume(lamportsToSol(row.volume_lamports))}
      </span>
      <span className="frb-r frb-val">
        {row.best_call_pct !== null ? formatCallPct(row.best_call_pct) : '·'}
      </span>
      <span className={`frb-r frb-pnl ${pnlSol < 0 ? 'frb-down' : 'frb-up'}`}>
        <Solana className="frb-sol" style={{ width: 8, height: 8 }} />
        {pnlSol >= 0 ? '+' : '−'}
        {Math.abs(pnlSol).toFixed(2)}
      </span>
    </div>
  );
}

function SplitCell({ total, a, b }: { total: number; a: string; b: string }): React.ReactElement {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 13, color: 'var(--ink-1)', fontVariantNumeric: 'tabular-nums' }}>{total}</div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
        {a} · {b}
      </div>
    </div>
  );
}

/*
 * Volume, short. `formatSolCompact` keeps three decimals for anything
 * above 1, which is right for a PnL figure and wrong for a column of
 * lifetime volume: it was printing `3829.756`. Nobody reads a volume
 * column to the milli SOL.
 */
function formatVolume(sol: number): string {
  const abs = Math.abs(sol);
  if (abs >= 1_000_000) return `${(sol / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(sol / 1_000).toFixed(1)}K`;
  if (abs >= 1) return sol.toFixed(1);
  return formatSolCompact(sol);
}

/* Every other numeric cell. Sans with tabular figures, the way
   `.spl-total` and the calls strip set numbers — the mono was the only
   place on the page still using it. */
const numCellStyle: CSSProperties = {
  textAlign: 'right',
  fontSize: 13,
  color: 'var(--ink-1)',
  fontVariantNumeric: 'tabular-nums',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
};

// ───────── shared bits ─────────

/**
 * Best-call pill: token image + $TICKER + multiple, thesis on hover,
 * click-through to the trade page. Shared by the podium and the table.
 */
function BestCallChip({
  row,
  onOpenCall,
}: {
  row: FrenLeaderboardRow;
  onOpenCall?: (callId: string, hint: CallOpenHint | null) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => {
        if (row.best_call_id && onOpenCall) {
          onOpenCall(row.best_call_id, {
            mint: row.best_call_mint ?? '',
            createdAtMs: row.best_call_at ? Date.parse(row.best_call_at) : null,
          });
        } else if (row.best_call_mint) {
          navigateToToken(row.best_call_mint);
        }
      }}
      title={row.best_call_thesis ?? undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        // Glass look without backdrop-filter: this chip repeats once per
        // table row, and dozens of live blur regions is real paint cost.
        // The gradient + specular edge carry the material instead.
        background:
          'linear-gradient(165deg, color-mix(in srgb, var(--up) 16%, rgba(11, 14, 20, 0.04)), color-mix(in srgb, var(--up) 6%, transparent))',
        border: '1px solid color-mix(in srgb, var(--up) 28%, rgba(11, 14, 20, 0.07))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)',
        borderRadius: 999,
        padding: '3px 10px 3px 4px',
        cursor: 'pointer',
        maxWidth: '100%',
      }}
    >
      <TokenImage src={row.best_call_image_url} ticker={row.best_call_ticker} size={18} />
      <span
        style={{
          fontSize: 11,
          color: 'var(--ink-1)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        ${row.best_call_ticker ?? '·'}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--up)' }}>
        {row.best_call_pct !== null ? formatCallPct(row.best_call_pct) : ''}
      </span>
    </button>
  );
}

function TokenImage({
  src,
  ticker,
  size,
}: {
  src: string | null;
  ticker: string | null;
  size: number;
}): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        overflow: 'hidden',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(7, Math.round(size * 0.4)),
        fontWeight: 700,
        color: 'var(--ink-2)',
        background: 'var(--input-bg)',
        border: '1px solid var(--hairline)',
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        (ticker ?? '?').slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function Avatar({
  who,
  size,
  ring,
}: {
  who: { label: string; avatar_data_url: string | null };
  size: number;
  /** Optional confetti ring color (podium identity). */
  ring?: string;
}): React.ReactElement {
  const initials = who.label.replace(/^@/, '').slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(9, Math.round(size * 0.34)),
        fontWeight: 700,
        color: 'var(--ink-0)',
        background: who.avatar_data_url
          ? `center / cover no-repeat url(${JSON.stringify(who.avatar_data_url)})`
          : 'linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 55%, #333), color-mix(in srgb, var(--accent-secondary, var(--accent-primary)) 55%, #133))',
        overflow: 'hidden',
        boxShadow: ring ? `0 0 0 2px color-mix(in srgb, ${ring} 65%, transparent)` : 'none',
      }}
    >
      {who.avatar_data_url ? null : initials}
    </span>
  );
}

const TRACK_POPOVER_WIDTH = 240;
const TRACK_POPOVER_EST_HEIGHT = 230;

/** Portal to <body> for page surfaces; render in place inside modals. */
function maybePortal(portal: boolean, node: React.ReactElement): React.ReactNode {
  return portal ? createPortal(node, document.body) : node;
}

function TrackButton({
  row,
  tracked,
  onTracked,
  portal = true,
}: {
  row: { label: string; primary_wallet_pubkey: string | null };
  tracked: boolean;
  onTracked: (pubkey: string) => void;
  /**
   * Body-portal the popover (default; escapes the table's rounded-corner
   * overflow clipping). MUST be false inside a modal Dialog: Radix sets
   * pointer-events:none on the body while open, so a body portal there
   * renders an unclickable popover and outside-click dismissal fights it.
   */
  portal?: boolean;
}): React.ReactElement {
  const trackedWalletsStore = useTrackedWalletsContext();
  const [open, setOpen] = useState(false);
  // Fixed-position anchor, PORTALED to <body>: the table container clips
  // overflow (rounded corners), so an in-flow absolute popover gets cut
  // off at the panel edge — and low rows must flip upward.
  const [anchor, setAnchor] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const [name, setName] = useState(row.label);
  const [emoji, setEmoji] = useState<string>(TRACK_EMOJIS[0]);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (!portal) {
      setAnchor(null);
      setOpen(true);
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Rect and innerWidth/Height are physical px; the popover's fixed
    // left/top are page-zoom-multiplied — compute the anchor in layout px.
    const z = pageZoom();
    const up = rect.bottom / z + TRACK_POPOVER_EST_HEIGHT > window.innerHeight / z - 12;
    setAnchor({
      top: up ? rect.top / z - 8 : rect.bottom / z + 6,
      left: Math.max(
        8,
        Math.min(rect.right / z, window.innerWidth / z - 8) - TRACK_POPOVER_WIDTH,
      ),
      up,
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Scrolling detaches a FIXED-position popover from its row — close
    // instead of drifting. The inline (in-modal) variant moves with its
    // container, so scroll must not close it.
    const onScroll = portal ? () => setOpen(false) : null;
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    if (onScroll) window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      if (onScroll) window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, portal]);

  const pubkey = row.primary_wallet_pubkey;
  if (pubkey === null) {
    return (
      <span title="This fren has no trackable wallet yet." style={{ fontSize: 10, color: 'var(--ink-3)' }}>
        ·
      </span>
    );
  }
  if (tracked) {
    return (
      <span
        className="frens-glass frens-glass--tint"
        style={
          {
            '--gc': 'var(--up)',
            fontFamily: 'var(--mono)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--up)',
            borderRadius: 999,
            padding: '4px 11px',
            whiteSpace: 'nowrap',
          } as CSSProperties
        }
      >
        TRACKED ✓
      </span>
    );
  }

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Shared store add: updates every tracker surface live (popover,
      // tracker page, dock manager, dossier) and mirrors to the DB
      // itself. Emoji rides its own field now instead of being baked
      // into the label string.
      const label = (name.trim() || row.label).slice(0, 64);
      const result = trackedWalletsStore.addWallet(pubkey, label, emoji);
      if (!result.ok && result.reason !== 'Wallet already tracked') {
        throw new Error(result.reason);
      }
      onTracked(pubkey);
      setOpen(false);
      toast('Tracking fren', { description: `${emoji} ${label} added to your Tracker.` });
    } catch {
      toast('Could not track wallet', { description: 'Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="frens-glass frens-glass--tint frens-track"
        onClick={toggleOpen}
        style={
          {
            '--gc': 'var(--accent-primary)',
            fontFamily: 'var(--mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: 'var(--accent-primary)',
            borderRadius: 999,
            padding: '5px 13px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          } as CSSProperties
        }
      >
        TRACK
      </button>
      {open && (!portal || anchor) && typeof document !== 'undefined' ? (
        maybePortal(
        portal,
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Track ${row.label}`}
          style={{
            ...(portal && anchor
              ? {
                  position: 'fixed' as const,
                  left: anchor.left,
                  top: anchor.top,
                  transform: anchor.up ? 'translateY(-100%)' : 'none',
                }
              : {
                  position: 'absolute' as const,
                  right: 0,
                  top: 'calc(100% + 6px)',
                }),
            pointerEvents: 'auto',
            zIndex: 60,
            width: TRACK_POPOVER_WIDTH,
            // Frosted panel, not flat surface: enough body (78%) that the
            // form stays readable over any confetti behind it, the blur
            // does the rest. Specular top edge sells the pane.
            background:
              'linear-gradient(165deg, color-mix(in srgb, var(--surface-2) 82%, transparent), color-mix(in srgb, var(--surface-1) 78%, transparent))',
            backdropFilter: 'blur(22px) saturate(1.35)',
            WebkitBackdropFilter: 'blur(22px) saturate(1.35)',
            border: '1px solid rgba(11, 14, 20, 0.13)',
            borderRadius: 16,
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.14), 0 24px 56px -16px rgba(11, 14, 20, 0.16)',
            padding: 12,
            textAlign: 'left',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.2em',
              color: 'var(--ink-3)',
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
            }}
          >
            <span
              aria-hidden
              style={{ width: 10, height: 4, borderRadius: 999, background: 'var(--accent-primary)' }}
            />
            TRACK FREN
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 6 }}>
            Name
          </div>
          <input
            type="text"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              borderRadius: 8,
              color: 'var(--ink-0)',
              fontSize: 12,
              padding: '7px 10px',
              outline: 'none',
            }}
          />
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-1)', margin: '10px 0 6px' }}>
            Emoji
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {TRACK_EMOJIS.map((option) => (
              <button
                key={option}
                type="button"
                className="frens-glass"
                onClick={() => setEmoji(option)}
                aria-pressed={emoji === option}
                style={
                  {
                    '--gc': 'var(--accent-primary)',
                    width: 30,
                    height: 30,
                    fontSize: 15,
                    borderRadius: 10,
                    cursor: 'pointer',
                  } as CSSProperties
                }
              >
                {option}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="frens-track"
            onClick={() => void confirm()}
            disabled={busy}
            style={{
              marginTop: 12,
              width: '100%',
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--accent-ink)',
              // Liquid CTA: lit from the top-left, specular edge, soft
              // accent bloom underneath — solid enough to stay the one
              // unmistakably primary action on the panel.
              background:
                'linear-gradient(170deg, color-mix(in srgb, #ffffff 30%, var(--accent-primary)), var(--accent-primary) 58%, color-mix(in srgb, var(--accent-secondary) 45%, var(--accent-primary)))',
              border: '1px solid color-mix(in srgb, #ffffff 25%, var(--accent-primary))',
              borderRadius: 12,
              padding: '8px 0',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.45), 0 8px 22px -10px color-mix(in srgb, var(--accent-primary) 80%, transparent)',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Tracking…' : `Track ${emoji}`}
          </button>
        </div>,
        )
      ) : null}
    </div>
  );
}
