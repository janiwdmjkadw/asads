'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { SolscanButton } from '@/components/listen/SolscanButton';
import { SolDefs, SolMark } from '@/components/discover/column/sol';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { compactNumber, compactUsd } from '@/lib/format';
import { navigateToToken } from '@/components/listen/navigation';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { useTrackedWalletsContext } from '@/components/discover/TrackedWalletsProvider';
import { EmojiPickerPopover } from '@/components/discover/WalletTrackerPopover';
import { displayName, shortAddress } from '@/components/discover/trackedWallets';
import { useWalletProfileStore } from '@/lib/state/wallet-profile-store';
import {
  useWalletPnl,
  type WalletPnl,
  type WalletPnlPoint,
  type WalletPnlPosition,
  type WalletPnlTimeframe,
} from '@/lib/api/wallet-pnl';

// ═══════════════════════════════════════════════════════════════════
// Wallet profile modal — the address dossier, as a designed object.
//
// Opens on ANY address anywhere via `openWalletProfile()`. Three-panel
// dossier (Balance · PnL curve · Performance) over a positions ledger
// (Active / History / Top 100 wins / Activity), all derived from the
// ingestion PnL fold (`/wallet/:wallet/pnl` — our pump.fun tape, cost-
// basis realized + latest-state unrealized). Timeframe (1D/7D/30D/MAX)
// drives BOTH the curve and the performance numbers.
//
// Track/rename: untracked wallets get a one-click "Rename to track"
// (label + emoji inline); tracked wallets show their emoji + name and
// rename in place — same store as the Wallet Tracker popover.
//
// Design language (confetti-geometric): every wallet gets an IDENTITY
// COLOR hashed from its address — it inks the edition tick, the orb
// ring, the aurora wash, the active timeframe pill and the ledger tab
// underline (`--wp-lens`). Everything is set in the product's sans: the
// dossier used to speak in a serif display face with mono-uppercase
// eyebrows under it, which read as a machine printout rather than as the
// rest of the terminal. Labels are sentence case words with color ticks;
// numerals keep tabular figures without the typewriter face. Semantic
// up/down greens/reds are never replaced.
// ═══════════════════════════════════════════════════════════════════

const TIMEFRAMES: readonly { id: WalletPnlTimeframe; label: string }[] = [
  { id: '1d', label: '1D' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: 'max', label: 'MAX' },
];

const DAY_MS = 86_400_000;

const CONFETTI = [
  '#37d67a',
  '#3b82f6',
  '#38bdf8',
  '#f052d2',
  '#fbbf24',
  '#22d3ee',
  '#8b5cf6',
  '#7ce85e',
] as const;

/** Deterministic identity color for an address — same hash family as
 *  the frens / portfolio identity systems. */
function identityColor(address: string): string {
  let hash = 0;
  for (let i = 0; i < address.length; i += 1) {
    hash = (hash * 31 + address.charCodeAt(i)) | 0;
  }
  return CONFETTI[((hash % CONFETTI.length) + CONFETTI.length) % CONFETTI.length]!;
}

const BUCKETS: readonly { label: string; tone: string }[] = [
  { label: '>500%', tone: 'var(--up)' },
  { label: '200% ~ 500%', tone: 'color-mix(in srgb, var(--up) 75%, var(--ink-3))' },
  { label: '0% ~ 200%', tone: 'color-mix(in srgb, var(--up) 50%, var(--ink-3))' },
  { label: '0% ~ -50%', tone: 'color-mix(in srgb, var(--down) 60%, var(--ink-3))' },
  { label: '< -50%', tone: 'var(--down)' },
];

type LedgerTab = 'active' | 'history' | 'wins' | 'activity';

const LEDGER_TABS: readonly { id: LedgerTab; label: string }[] = [
  { id: 'active', label: 'Active Positions' },
  { id: 'history', label: 'History' },
  { id: 'wins', label: 'Top 100' },
  { id: 'activity', label: 'Activity' },
];

export function WalletProfileModal() {
  const address = useWalletProfileStore((s) => s.address);
  const close = useWalletProfileStore((s) => s.close);
  const open = address !== null;
  const pnl = useWalletPnl(address, open);
  const [timeframe, setTimeframe] = useState<WalletPnlTimeframe>('max');
  const [tab, setTab] = useState<LedgerTab>('active');

  // Fresh dossier per wallet: reset view state when the subject changes.
  useEffect(() => {
    if (open) {
      setTimeframe('max');
      setTab('active');
    }
  }, [address, open]);

  if (!open) return null;
  const lens = identityColor(address);
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        className="max-w-[880px] gap-0 overflow-hidden p-0"
        style={
          {
            fontFamily: 'var(--sans)',
            '--wp-lens': lens,
            borderRadius: 18,
            border: '1px solid var(--hairline-2)',
            boxShadow:
              '0 40px 120px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)',
          } as CSSProperties
        }
      >
        <WpStyles />
        {/* One `<defs>` per surface: every SolMark below fills from it. */}
        <SolDefs />
        {/* Edition band — the five-color signature, lens-first. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 z-10 h-[3px]"
          style={{
            background: `linear-gradient(90deg, var(--wp-lens), #38bdf8, #8b5cf6, #f052d2, #fbbf24)`,
          }}
        />
        {/* Identity aurora + ghost watermark, behind everything. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(90% 55% at 8% 0%, color-mix(in srgb, var(--wp-lens) 9%, transparent), transparent 60%)`,
          }}
        />
        {/* Radix requires a title for a11y; header renders the visible one. */}
        <DialogTitle className="sr-only">Wallet profile {shortAddress(address)}</DialogTitle>
        <ProfileHeader
          address={address}
          timeframe={timeframe}
          onTimeframe={setTimeframe}
        />
        <ProfileSummary data={pnl.data} loading={pnl.loading} error={pnl.error} timeframe={timeframe} />
        <ProfileLedger
          data={pnl.data}
          loading={pnl.loading}
          tab={tab}
          onTab={setTab}
          onOpenToken={(mint, symbol, name) => {
            close();
            navigateToToken(mint, { symbol: symbol ?? undefined, name: name ?? undefined });
          }}
        />
        {/* Plate mark — attribution as a signature. */}
        <div
          className="flex items-center justify-between px-4 py-[7px] text-[10px]"
          style={{
            color: 'var(--ink-4, var(--ink-3))',
            borderTop: '1px solid var(--hairline)',
            fontFamily: 'var(--sans)',
          }}
        >
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-flex gap-[3px]">
              {CONFETTI.slice(0, 5).map((c) => (
                <span
                  key={c}
                  className="inline-block h-[8px] w-[3px] rounded-[1px]"
                  style={{ background: c, opacity: 0.7 }}
                />
              ))}
            </span>
            pump.fun activity seen by listen · cost-basis PnL
          </span>
          {/* `tradesAnalyzed` is optional on the wire: a wallet the
              indexer has never seen comes back as a body with no counts
              in it, and calling `.toLocaleString()` on the missing field
              took the whole modal down rather than showing an empty
              footnote. */}
          <span className="tabular-nums">
            {typeof pnl.data?.tradesAnalyzed === 'number'
              ? `${pnl.data.tradesAnalyzed.toLocaleString()}${pnl.data.truncated ? '+' : ''} trades analyzed`
              : ''}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One-shot entrance physics + shared chrome. Stilled under
 *  prefers-reduced-motion. */
function WpStyles() {
  return (
    <style>{`
      @keyframes wp-rise {
        0% { opacity: 0; transform: translateY(10px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      .wp-rise { animation: wp-rise 460ms var(--ease-out, ease-out) backwards; }
      .wp-rise-1 { animation-delay: 40ms; }
      .wp-rise-2 { animation-delay: 110ms; }
      .wp-rise-3 { animation-delay: 180ms; }
      .wp-row-hover { transition: background 120ms ease, box-shadow 120ms ease; }
      .wp-row-hover:hover {
        background: color-mix(in srgb, var(--wp-lens) 4%, transparent);
        box-shadow: inset 2px 0 0 color-mix(in srgb, var(--wp-lens) 65%, transparent);
      }
      @media (prefers-reduced-motion: reduce) {
        .wp-rise { animation: none; }
      }
    `}</style>
  );
}

/** Sentence-case label with a color tick — the dossier's label voice.
 *  It was uppercase mono on a wide track; "BALANCE" and "PERFORMANCE"
 *  are words, not stamps, and now read as words. */
function Eyebrow({ tick, children }: { tick: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-[7px]">
      <span
        aria-hidden
        className="h-[11px] w-[3.5px] shrink-0 rounded-[2px]"
        style={{ background: tick, boxShadow: `0 0 8px -2px ${tick}` }}
      />
      <span
        className="text-[11px] font-semibold"
        style={{ color: 'var(--ink-2)', letterSpacing: '0.01em' }}
      >
        {children}
      </span>
    </div>
  );
}

// ───────── header: identity + track/rename + timeframe ─────────

function ProfileHeader({
  address,
  timeframe,
  onTimeframe,
}: {
  address: string;
  timeframe: WalletPnlTimeframe;
  onTimeframe: (next: WalletPnlTimeframe) => void;
}) {
  const trackedWallets = useTrackedWalletsContext();
  const tracked = trackedWallets.lookup(address);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const startEditing = () => {
    setLabel(tracked?.label ?? '');
    setEmoji(tracked?.emoji ?? '');
    setEditing(true);
  };
  const save = () => {
    if (tracked) {
      trackedWallets.updateLabel(address, label);
      trackedWallets.updateEmoji(address, emoji || undefined);
    } else {
      trackedWallets.addWallet(address, label, emoji);
    }
    setEditing(false);
  };
  const copyAddress = () => {
    void navigator.clipboard?.writeText(address).catch(() => undefined);
    setCopied(true);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1_200);
  };

  return (
    <div
      className="wp-rise relative flex items-center gap-3.5 px-5 py-[15px]"
      style={{ borderBottom: '1px solid var(--hairline)' }}
    >
      {/* No orb. There was a 40px coin here — a gradient disc for an
          untracked wallet, the tracked emoji for a tracked one — and it
          read as a token logo on a panel that is not about a token. The
          emoji is still set and still shown everywhere it belongs: the
          tracker list, the rename row, the address surfaces. */}

      <div className="min-w-0 flex-1">
        {/* The row above the name carried a "Wallet dossier" stamp — a
            label for a thing you are already looking at. Only the tracked
            badge earns the line, so the line exists only when there is
            one; otherwise the name starts at the top. */}
        {tracked ? (
          <div className="mb-1 flex items-center gap-2">
            <span
              className="shrink-0 rounded-full px-2 py-[1px] text-[10px] font-semibold"
              style={{
                color: 'var(--up)',
                background: 'color-mix(in srgb, var(--up) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--up) 35%, transparent)',
                fontFamily: 'var(--sans)',
              }}
            >
              tracked
            </span>
          </div>
        ) : null}
        {editing ? (
          <div className="flex items-center gap-1.5">
            <EmojiPickerPopover
              onPick={setEmoji}
              triggerClassName="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-input bg-[var(--input-bg)] text-[15px] leading-none hover:border-[var(--wp-lens)]"
              triggerLabel="Pick an emoji"
            >
              {/* Its own colour, set or not. Greying the placeholder made
                  the one warm thing in the row into a smudge. */}
              <span aria-hidden>
                {emoji || '🙂'}
              </span>
            </EmojiPickerPopover>
            <input
              autoFocus
              type="text"
              value={label}
              maxLength={24}
              placeholder="Name this wallet"
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                else if (e.key === 'Escape') setEditing(false);
              }}
              className="h-7 w-[190px] rounded-md border border-input bg-[var(--input-bg)] px-2 text-[12px] text-[var(--ink-0)] outline-none"
              style={{ borderColor: 'color-mix(in srgb, var(--wp-lens) 45%, var(--hairline))' }}
            />
            <button
              type="button"
              onClick={save}
              className="h-7 rounded-md px-2.5 text-[11px] font-bold"
              style={{
                color: '#08110c',
                background: `linear-gradient(135deg, var(--wp-lens), color-mix(in srgb, var(--wp-lens) 60%, #fff))`,
                cursor: 'pointer',
              }}
            >
              {tracked ? 'Save' : 'Track'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-7 rounded-md px-2 text-[11px]"
              style={{ color: 'var(--ink-3)', cursor: 'pointer' }}
            >
              cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEditing}
            title={tracked ? 'Rename this wallet' : 'Name + emoji it into your tracker'}
            className="block max-w-full truncate text-left text-[21px] leading-[1.05]"
            style={{
              /* Was the serif display face, italic, at 400 — the one line
                 of the modal that spoke in another voice. In the sans that
                 slant is just a lean, so it goes, and the weight carries
                 the name instead. */
              fontFamily: 'var(--sans)',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: tracked ? 'var(--wp-lens)' : 'var(--ink-0)',
              cursor: 'pointer',
              textDecorationColor: 'color-mix(in srgb, var(--wp-lens) 55%, transparent)',
            }}
          >
            {tracked ? displayName(tracked) : 'Rename to track'}
          </button>
        )}
        <button
          type="button"
          onClick={copyAddress}
          title="Copy address"
          className="mt-1 flex max-w-full items-center gap-1.5 truncate text-[10px] tabular-nums hover:text-[var(--ink-1)]"
          style={{
            color: 'var(--ink-3)',
            letterSpacing: '0.04em',
            cursor: 'pointer',
            fontFamily: 'var(--sans)',
          }}
        >
          <span className="truncate">{address}</span>
          <SolscanButton kind="account" id={address} />
          <span className="shrink-0" style={{ color: copied ? 'var(--up)' : 'var(--ink-3)' }}>
            {copied ? '✓ copied' : '⧉'}
          </span>
        </button>
      </div>

      {/* Timeframe — drives the curve AND the performance numbers. */}
      <div
        className="mr-7 flex shrink-0 items-center gap-0.5 rounded-full p-0.5"
        style={{ background: 'var(--input-bg)', border: '1px solid var(--hairline)' }}
      >
        {TIMEFRAMES.map((t) => {
          const active = t.id === timeframe;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTimeframe(t.id)}
              aria-pressed={active}
              className="rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] transition-colors"
              style={{
                cursor: 'pointer',
                fontFamily: 'var(--sans)',
                color: active ? '#08110c' : 'var(--ink-2)',
                background: active
                  ? `linear-gradient(135deg, var(--wp-lens), color-mix(in srgb, var(--wp-lens) 55%, #fff))`
                  : 'transparent',
                boxShadow: active
                  ? '0 0 14px -4px color-mix(in srgb, var(--wp-lens) 80%, transparent)'
                  : undefined,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────── summary: Balance · PnL curve · Performance ─────────

function ProfileSummary({
  data,
  loading,
  error,
  timeframe,
}: {
  data: WalletPnl | null;
  loading: boolean;
  error: string | null;
  timeframe: WalletPnlTimeframe;
}) {
  /*
   * ── THE BODY CAN COME BACK HALF FILLED ───────────────────────────
   *
   * A wallet the indexer has never seen returns a shape with the top
   * level present and its arrays absent. `data?.windows` guards the
   * response being missing; it does not guard `windows` being missing
   * FROM the response, which is the case that actually happens — and
   * `.find` on undefined took the whole modal down.
   */
  const window = data?.windows?.find((w) => w.id === timeframe) ?? null;
  const slice = useMemo(() => sliceSeries(data, timeframe), [data, timeframe]);
  const solUsd = data?.solUsd ?? 0;
  const totalPnl = data ? data.totalRealizedPnlSol + data.totalUnrealizedPnlSol : 0;

  return (
    <div
      className="grid gap-px"
      style={{
        gridTemplateColumns: 'minmax(200px, 1fr) minmax(280px, 1.5fr) minmax(210px, 1fr)',
        background: 'var(--hairline)',
      }}
    >
      {/* Balance */}
      <section
        className="wp-rise wp-rise-1 flex flex-col gap-3 p-4"
        style={{ background: 'var(--surface-1)' }}
      >
        <Eyebrow tick="#38bdf8">Balance</Eyebrow>
        <div>
          <div className="text-[10.5px]" style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
            Holdings value
          </div>
          {/* No tabular figures on the headline. They exist so a COLUMN
              of numbers lines up; on one large amount they only cost it
              its proportions, which is what made this read as machine
              output. The ledger below keeps them. */}
          <div
            className="mt-1 flex items-center text-[26px] font-semibold leading-none"
            style={{ color: 'var(--ink-0)', fontFamily: 'var(--sans)', letterSpacing: '-0.01em' }}
          >
            {data ? <Amount v={usd(data.holdingsValueSol, solUsd)} mark={17} /> : loading ? '…' : '—'}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
            {data ? (
              <>
                <SolAmount value={data.holdingsValueSol} />
                {data.solBalanceLamports != null ? (
                  <>
                    <span aria-hidden>·</span>
                    <SolAmount value={data.solBalanceLamports / 1e9} />
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <div>
          <div className="text-[10.5px]" style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
            Unrealized PnL
          </div>
          <div
            className="mt-1 flex items-center text-[16px] font-semibold leading-none"
            style={{
              color: data ? pnlTone(data.totalUnrealizedPnlSol) : 'var(--ink-2)',
              fontFamily: 'var(--sans)',
            }}
          >
            {data ? <Amount v={signedUsd(data.totalUnrealizedPnlSol, solUsd)} mark={12} /> : '—'}
          </div>
        </div>
        <div className="mt-auto flex items-end justify-between gap-2">
          <div>
            <div className="text-[10.5px]" style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
              First seen
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums" style={{ color: 'var(--ink-1)', fontFamily: 'var(--sans)' }}>
              {data?.firstTradeAtMs ? new Date(data.firstTradeAtMs).toLocaleDateString() : '—'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10.5px]" style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
              Volume ({timeframe.toUpperCase()})
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums" style={{ color: 'var(--ink-1)', fontFamily: 'var(--sans)' }}>
              {window ? <SolAmount value={window.volumeSol} /> : '—'}
            </div>
          </div>
        </div>
        {error ? (
          <div className="text-[10px]" style={{ color: 'var(--down)' }}>
            profile unavailable: {error}
          </div>
        ) : null}
      </section>

      {/* PnL curve */}
      <section
        className="wp-rise wp-rise-2 relative flex flex-col p-4"
        style={{ background: 'var(--surface-1)' }}
      >
        <div className="flex items-baseline justify-between">
          <Eyebrow tick="var(--wp-lens)">PnL</Eyebrow>
          <span
            className="inline-flex items-center text-[14px] font-semibold"
            style={{
              color: slice ? pnlTone(slice.finalValue) : 'var(--ink-2)',
              fontFamily: 'var(--sans)',
            }}
          >
            {slice ? <Amount v={signedUsd(slice.finalValue, solUsd)} mark={12} /> : ''}
          </span>
        </div>
        <div className="mt-2 min-h-[150px] flex-1">
          {slice && slice.points.length > 1 ? (
            <PnlAreaChart slice={slice} solUsd={solUsd} />
          ) : (
            <div
              className="flex h-full items-center justify-center text-[11px]"
              style={{ color: 'var(--ink-3)' }}
            >
              {loading
                ? 'reading the tape…'
                : data && data.tradesAnalyzed === 0
                  ? 'no pump.fun activity seen for this wallet yet'
                  : 'no realized trades in this window'}
            </div>
          )}
        </div>
      </section>

      {/* Performance */}
      <section
        className="wp-rise wp-rise-3 flex flex-col gap-2 p-4"
        style={{ background: 'var(--surface-1)' }}
      >
        <Eyebrow tick="#fbbf24">Performance</Eyebrow>
        <StatRow
          label="Total PnL"
          value={data ? <Amount v={signedUsd(totalPnl, solUsd)} /> : '—'}
          tone={data ? pnlTone(totalPnl) : undefined}
        />
        <StatRow
          label="Realized PnL"
          value={window ? <Amount v={signedUsd(window.realizedPnlSol, solUsd)} /> : '—'}
          tone={window ? pnlTone(window.realizedPnlSol) : undefined}
        />
        <StatRow
          label="Total TXNS"
          value={window ? `${window.txns.toLocaleString()}` : '—'}
          detail={window ? `${window.buys}b / ${window.sells}s` : undefined}
        />
        <div className="mt-1 flex flex-col gap-[5px]">
          {BUCKETS.map((bucket, index) => (
            <div
              key={bucket.label}
              className="flex items-center justify-between text-[10px] tabular-nums"
              style={{ fontFamily: 'var(--sans)' }}
            >
              <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                <span
                  aria-hidden
                  className="inline-block h-[9px] w-[3px] rounded-[1px]"
                  style={{ background: bucket.tone, boxShadow: `0 0 6px -1px ${bucket.tone}` }}
                />
                {bucket.label}
              </span>
              <span style={{ color: 'var(--ink-1)' }}>{window ? window.buckets[index] : '—'}</span>
            </div>
          ))}
        </div>
        <BucketBar buckets={window?.buckets ?? null} />
      </section>
    </div>
  );
}

function StatRow({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between text-[11px]">
      <span style={{ color: 'var(--ink-3)' }}>{label}</span>
      <span className="tabular-nums" style={{ fontFamily: 'var(--sans)' }}>
        {detail ? (
          <span className="mr-1.5 text-[9px]" style={{ color: 'var(--ink-3)' }}>
            {detail}
          </span>
        ) : null}
        <span className="inline-flex items-center" style={{ color: tone ?? 'var(--ink-0)', fontWeight: 600 }}>
          {value}
        </span>
      </span>
    </div>
  );
}

/** Win-distribution bar: one stacked strip, bucket tones, animated width. */
function BucketBar({ buckets }: { buckets: readonly number[] | null }) {
  const total = buckets ? buckets.reduce((sum, n) => sum + n, 0) : 0;
  return (
    <div
      className="mt-1 flex h-[5px] w-full overflow-hidden rounded-full"
      style={{ background: 'var(--input-bg)', boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.3)' }}
      aria-hidden
    >
      {buckets && total > 0
        ? buckets.map((count, index) => (
            <span
              key={index}
              style={{
                width: `${(count / total) * 100}%`,
                background: BUCKETS[index]!.tone,
                transition: 'width 400ms var(--ease-out)',
              }}
            />
          ))
        : null}
    </div>
  );
}

// ───────── the curve ─────────

interface SeriesSlice {
  points: WalletPnlPoint[];
  /** Realized value at window start (rebased to 0 on the chart). */
  baseline: number;
  /** Window PnL — last point minus baseline. */
  finalValue: number;
}

function sliceSeries(data: WalletPnl | null, timeframe: WalletPnlTimeframe): SeriesSlice | null {
  if (!data || !data.series || data.series.length === 0) return null;
  const cutoff =
    timeframe === 'max'
      ? Number.NEGATIVE_INFINITY
      : Date.now() - (timeframe === '1d' ? 1 : timeframe === '7d' ? 7 : 30) * DAY_MS;
  const inWindow = data.series.filter((p) => p.tMs >= cutoff);
  const before = data.series.filter((p) => p.tMs < cutoff);
  const baseline = before.length > 0 ? before[before.length - 1]!.realizedSol : 0;
  // Carry the baseline in as the window's opening point so the curve
  // starts at 0 instead of teleporting.
  const points: WalletPnlPoint[] =
    inWindow.length > 0
      ? [{ tMs: Math.max(cutoff, inWindow[0]!.tMs - 1), realizedSol: baseline }, ...inWindow]
      : [];
  if (points.length === 0) return null;
  return {
    points,
    baseline,
    finalValue: points[points.length - 1]!.realizedSol - baseline,
  };
}

const CHART_W = 560;
const CHART_H = 150;

/**
 * The PnL curve: gradient-filled area with a glow-tipped line, animated
 * draw-in, faint quarter gridlines, and a pointer crosshair with a value
 * flag. Pure SVG — no chart library — so it weighs nothing and matches
 * the app's ink exactly.
 */
function PnlAreaChart({ slice, solUsd }: { slice: SeriesSlice; solUsd: number }) {
  const [drawn, setDrawn] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; point: WalletPnlPoint } | null>(null);
  useEffect(() => {
    // Draw-in on mount / timeframe switch.
    setDrawn(false);
    const handle = window.requestAnimationFrame(() => setDrawn(true));
    return () => window.cancelAnimationFrame(handle);
  }, [slice]);

  const up = slice.finalValue >= 0;
  const tone = up ? 'var(--up)' : 'var(--down)';
  const geometry = useMemo(() => {
    const values = slice.points.map((p) => p.realizedSol - slice.baseline);
    const t0 = slice.points[0]!.tMs;
    const t1 = slice.points[slice.points.length - 1]!.tMs;
    const spanT = Math.max(t1 - t0, 1);
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (max - min < 1e-9) {
      max += 1;
      min -= 1;
    }
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
    const x = (tMs: number) => ((tMs - t0) / spanT) * CHART_W;
    const y = (value: number) => CHART_H - ((value - min) / (max - min)) * CHART_H;
    const coords = slice.points.map((p, i) => ({
      px: x(p.tMs),
      py: y(values[i]!),
      point: p,
    }));
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.px.toFixed(1)},${c.py.toFixed(1)}`).join(' ');
    const area = `${line} L${CHART_W},${CHART_H} L0,${CHART_H} Z`;
    return { coords, line, area, zeroY: y(0) };
  }, [slice]);

  const last = geometry.coords[geometry.coords.length - 1]!;
  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * CHART_W;
          let best = geometry.coords[0]!;
          for (const c of geometry.coords) {
            if (Math.abs(c.px - px) < Math.abs(best.px - px)) best = c;
          }
          setHover({ x: best.px, y: best.py, point: best.point });
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="wp-pnl-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.34" />
            <stop offset="100%" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Faint quarter gridlines — depth without noise. */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={CHART_W}
            y1={CHART_H * f}
            y2={CHART_H * f}
            stroke="color-mix(in srgb, var(--ink-0) 4%, transparent)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Zero line */}
        <line
          x1="0"
          x2={CHART_W}
          y1={geometry.zeroY}
          y2={geometry.zeroY}
          stroke="var(--hairline)"
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={geometry.area}
          fill="url(#wp-pnl-fill)"
          style={{ opacity: drawn ? 1 : 0, transition: 'opacity 600ms var(--ease-out)' }}
        />
        <path
          d={geometry.line}
          fill="none"
          stroke={tone}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={drawn ? 0 : 1}
          style={{ transition: 'stroke-dashoffset 700ms var(--ease-out)' }}
        />
        {/* Glow tip */}
        <circle
          cx={last.px}
          cy={last.py}
          r={3}
          fill={tone}
          style={{
            opacity: drawn ? 1 : 0,
            transition: 'opacity 300ms var(--ease-out) 500ms',
            filter: `drop-shadow(0 0 6px ${tone})`,
          }}
        />
        {hover ? (
          <g>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={0}
              y2={CHART_H}
              stroke="color-mix(in srgb, var(--ink-0) 30%, transparent)"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={hover.x} cy={hover.y} r={3.5} fill={tone} stroke="var(--surface-1)" strokeWidth={1.5} />
          </g>
        ) : null}
      </svg>
      {hover ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md px-2 py-1 text-[10px] tabular-nums"
          style={{
            left: `${(hover.x / CHART_W) * 100}%`,
            top: 0,
            color: 'var(--ink-0)',
            background: 'var(--tooltip-bg)',
            border: '1px solid var(--tooltip-border)',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--sans)',
          }}
        >
          <span style={{ color: pnlTone(hover.point.realizedSol - slice.baseline), fontWeight: 700 }}>
            <Amount v={signedUsd(hover.point.realizedSol - slice.baseline, solUsd)} mark={10} />
          </span>{' '}
          <span style={{ color: 'var(--ink-3)' }}>
            {new Date(hover.point.tMs).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ───────── ledger tabs ─────────

function ProfileLedger({
  data,
  loading,
  tab,
  onTab,
  onOpenToken,
}: {
  data: WalletPnl | null;
  loading: boolean;
  tab: LedgerTab;
  onTab: (tab: LedgerTab) => void;
  onOpenToken: (mint: string, symbol: string | null, name: string | null) => void;
}) {
  const rows = useMemo(() => {
    if (!data) return [];
    if (tab === 'active') {
      return data.positions
        .filter((p) => p.remainingTokens > 0 && (p.remainingValueSol ?? 1) > 0.000001)
        .sort((a, b) => (b.remainingValueSol ?? 0) - (a.remainingValueSol ?? 0));
    }
    if (tab === 'history') {
      return data.positions
        .filter((p) => !(p.remainingTokens > 0 && (p.remainingValueSol ?? 1) > 0.000001))
        .sort((a, b) => b.lastTradeAtMs - a.lastTradeAtMs);
    }
    // Top 100 wins: biggest positive total PnL.
    return data.positions
      .filter((p) => p.totalPnlSol > 0)
      .sort((a, b) => b.totalPnlSol - a.totalPnlSol)
      .slice(0, 100);
  }, [data, tab]);

  return (
    <div className="flex min-h-0 flex-col" style={{ borderTop: '1px solid var(--hairline)' }}>
      <div
        className="flex h-[38px] shrink-0 items-center gap-1 px-3"
        style={{ borderBottom: '1px solid var(--hairline)', background: 'var(--tabs-bg)' }}
      >
        {LEDGER_TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              className={cn(
                'relative rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors',
              )}
              style={{
                cursor: 'pointer',
                fontFamily: 'var(--sans)',
                color: active ? 'var(--ink-0)' : 'var(--ink-3)',
                background: active
                  ? 'color-mix(in srgb, var(--wp-lens) 8%, transparent)'
                  : 'transparent',
              }}
            >
              {t.label}
              {t.id === 'wins' ? <CrownGlyph /> : null}
              {active ? (
                <span
                  aria-hidden
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-full"
                  style={{
                    background: 'var(--wp-lens)',
                    boxShadow: '0 0 8px -1px var(--wp-lens)',
                  }}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="max-h-[240px] min-h-[160px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {tab === 'activity' ? (
          <ActivityRows data={data} loading={loading} onOpenToken={onOpenToken} />
        ) : (
          <PositionRows
            rows={rows}
            solUsd={data?.solUsd ?? 0}
            loading={loading}
            emptyLabel={
              tab === 'active'
                ? 'No open positions.'
                : tab === 'history'
                  ? 'No closed positions yet.'
                  : 'No wins yet — the tape is patient.'
            }
            onOpenToken={onOpenToken}
          />
        )}
      </div>
    </div>
  );
}

const LEDGER_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(150px,1.5fr) minmax(90px,1fr) minmax(90px,1fr) minmax(110px,1fr) minmax(110px,1fr)',
  columnGap: 14,
  alignItems: 'center',
};

function PositionRows({
  rows,
  solUsd,
  loading,
  emptyLabel,
  onOpenToken,
}: {
  rows: WalletPnlPosition[];
  solUsd: number;
  loading: boolean;
  emptyLabel: string;
  onOpenToken: (mint: string, symbol: string | null, name: string | null) => void;
}) {
  return (
    <>
      <div
        className="sticky top-0 z-10 px-4 py-2 text-[10px] font-semibold"
        style={{
          ...LEDGER_GRID,
          color: 'var(--ink-3)',
          background: 'var(--surface-1)',
          fontFamily: 'var(--sans)',
          boxShadow: '0 1px 0 var(--hairline)',
        }}
      >
        <span>Token</span>
        <span>Bought</span>
        <span>Sold</span>
        <span>Remaining</span>
        <span className="text-right">PnL</span>
      </div>
      {rows.map((row) => (
        <button
          key={row.mint}
          type="button"
          onClick={() => onOpenToken(row.mint, row.symbol, row.name)}
          className="wp-row-hover w-full px-4 py-2 text-left text-[11px] tabular-nums"
          style={{
            ...LEDGER_GRID,
            borderTop: '1px solid var(--hairline)',
            cursor: 'pointer',
            fontFamily: 'var(--sans)',
          }}
          title={`Open ${row.symbol ?? shortAddress(row.mint)} trade page`}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <img
              src={ingestionTokenImageUrl(row.mint) ?? undefined}
              alt=""
              loading="lazy"
              className="size-[22px] shrink-0 rounded-[6px] object-cover"
              style={{
                background: 'var(--surface-3)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
              }}
            />
            <span className="min-w-0">
              <span
                className="block truncate text-[11.5px] font-semibold"
                style={{ color: 'var(--ink-0)', fontFamily: 'var(--sans)', letterSpacing: '0.01em' }}
              >
                {row.symbol ?? shortAddress(row.mint)}
              </span>
              <span
                className="block truncate text-[9px]"
                style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}
              >
                {row.name ?? ''}
              </span>
            </span>
          </span>
          <span style={{ color: 'var(--ink-1)' }}>
            <Amount v={usd(row.boughtSol, solUsd)} mark={10} />
          </span>
          <span style={{ color: 'var(--ink-1)' }}>
            <Amount v={usd(row.soldSol, solUsd)} mark={10} />
          </span>
          <span style={{ color: 'var(--ink-1)' }}>
            {row.remainingValueSol != null ? <Amount v={usd(row.remainingValueSol, solUsd)} mark={10} /> : '—'}
            <span className="ml-1 text-[9px]" style={{ color: 'var(--ink-3)' }}>
              {compactNumber(row.remainingTokens / 1e6)}
            </span>
          </span>
          {/* Unknown cost basis (held but never traded on our tape):
              PnL is unknowable — show a dash, never a fabricated +$0. */}
          {row.trades === 0 && row.unrealizedPnlSol == null ? (
            <span className="text-right" style={{ color: 'var(--ink-3)' }}>
              —
            </span>
          ) : (
            <span className="text-right font-semibold" style={{ color: pnlTone(row.totalPnlSol) }}>
              <Amount v={signedUsd(row.totalPnlSol, solUsd)} mark={10} />
              {row.pnlPct != null ? (
                <span className="ml-1 text-[9px] font-normal" style={{ color: 'var(--ink-3)' }}>
                  ({row.pnlPct >= 0 ? '+' : ''}
                  {Math.abs(row.pnlPct) >= 100 ? Math.round(row.pnlPct) : row.pnlPct.toFixed(1)}%)
                </span>
              ) : null}
            </span>
          )}
        </button>
      ))}
      {rows.length === 0 ? <LedgerEmpty label={loading ? 'reading the tape…' : emptyLabel} /> : null}
    </>
  );
}

function ActivityRows({
  data,
  loading,
  onOpenToken,
}: {
  data: WalletPnl | null;
  loading: boolean;
  onOpenToken: (mint: string, symbol: string | null, name: string | null) => void;
}) {
  const trades = data?.recentTrades ?? [];
  return (
    <>
      {trades.map((trade, index) => (
        <button
          key={`${trade.mint}:${trade.tMs}:${index}`}
          type="button"
          onClick={() => onOpenToken(trade.mint, trade.symbol, null)}
          className="wp-row-hover flex w-full items-center gap-3 px-4 py-1.5 text-left text-[11px] tabular-nums"
          style={{ borderTop: '1px solid var(--hairline)', cursor: 'pointer', fontFamily: 'var(--sans)' }}
        >
          <span
            className="w-8 shrink-0 text-[10px] font-bold"
            style={{ color: trade.isBuy ? 'var(--up)' : 'var(--down)', letterSpacing: '0.12em' }}
          >
            {trade.isBuy ? 'BUY' : 'SELL'}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-semibold"
            style={{ color: 'var(--ink-0)', fontFamily: 'var(--sans)' }}
          >
            {trade.symbol ?? shortAddress(trade.mint)}
          </span>
          <span style={{ color: 'var(--ink-1)' }}>
            <SolAmount value={trade.sol} />
          </span>
          <span className="w-[120px] shrink-0 text-right text-[10px]" style={{ color: 'var(--ink-3)' }}>
            {new Date(trade.tMs).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </button>
      ))}
      {trades.length === 0 ? (
        <LedgerEmpty label={loading ? 'reading the tape…' : 'No recent activity.'} />
      ) : null}
    </>
  );
}

function LedgerEmpty({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-[11px]"
      style={{ color: 'var(--ink-3)' }}
    >
      {/* Mini mosaic — the house empty-state mark. */}
      <span aria-hidden className="flex gap-[3px]">
        {CONFETTI.slice(0, 4).map((c) => (
          <span
            key={c}
            className="inline-block size-[6px] rounded-[1.5px]"
            style={{ background: c, opacity: 0.35 }}
          />
        ))}
      </span>
      {label}
    </div>
  );
}

function CrownGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="var(--hold)" aria-hidden style={{ width: 12, height: 12, display: 'inline', marginLeft: 4, filter: 'drop-shadow(0 0 4px color-mix(in srgb, var(--hold) 60%, transparent))' }}>
      <path d="M3 8l4 4 5-6 5 6 4-4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8z" />
    </svg>
  );
}

/**
 * A money value with the SOL mark after it when it is denominated in
 * SOL. The word "SOL" is not a unit anyone reads at this size — the mark
 * is, and it is the one glyph in the product that carries its own
 * colour, so a column of amounts stays scannable.
 */
function Amount({ v, mark = 11 }: { v: Money; mark?: number }) {
  if (!v.inSol) return <>{v.text}</>;
  return (
    <span className="inline-flex items-center gap-[4px]">
      {v.text}
      <SolMark size={mark} />
    </span>
  );
}

/** The same, for the places that only ever hold a raw SOL figure. */
function SolAmount({ value, mark = 10 }: { value: number; mark?: number }) {
  return (
    <span className="inline-flex items-center gap-[4px]">
      {sol(value)}
      <SolMark size={mark} />
    </span>
  );
}

// ───────── formatting ─────────

function pnlTone(value: number): string {
  return value >= 0 ? 'var(--up)' : 'var(--down)';
}

/*
 * ── A MONEY VALUE KNOWS WHICH CURRENCY IT IS IN ──────────────────────
 *
 * These used to return a finished sentence — "0.42 SOL" — which meant
 * the SOL case could only ever be spelled out in words. It is a value
 * plus which currency it is in; the renderer decides whether that shows
 * as a `$` in front or as Solana's mark after.
 */
interface Money {
  text: string;
  inSol: boolean;
}

function usd(valueSol: number, solUsd: number): Money {
  if (!Number.isFinite(valueSol) || !Number.isFinite(solUsd) || solUsd <= 0) {
    return { text: sol(valueSol), inSol: true };
  }
  return { text: compactUsd(Math.abs(valueSol * solUsd), '$0'), inSol: false };
}

function signedUsd(valueSol: number, solUsd: number): Money {
  const sign = valueSol >= 0 ? '+' : '-';
  const base = usd(Math.abs(valueSol), solUsd);
  return { text: `${sign}${base.text}`, inSol: base.inSol };
}

function sol(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000) return compactNumber(abs);
  if (abs >= 10) return abs.toFixed(1);
  if (abs >= 0.01) return abs.toFixed(2);
  return abs.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') || '0';
}
