'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Solana } from '@/components/listen/icons/Icons';
import { walletDisplayName } from '@/components/listen/WalletSelector';
import type { MeWalletEntry } from '@/lib/api/me';
import { partitionTransfer } from './partitionTransfer';
import { AGENT_WITHDRAWAL_WARNING, isAgentWithdrawal } from './agentWallet';

/**
 * Slice "Portfolio page wallets tab": shadcn-backed Distribute /
 * Consolidate / Transfer modal. Opens off the rail's "Start
 * Distribution" CTA and owns the amount-entry surface (decimal SOL
 * input, percent input, 0-100% slider, available + per-wallet
 * readouts). The rail no longer carries an inline amount — that
 * concern lives here.
 *
 * Submit is fire-and-forget from this modal's perspective: we close
 * the dialog first (so the user sees the rail's `ResultsList`
 * underneath) and then defer to the parent's `onSubmit`. The parent
 * (WalletsTab) owns the `transferSol` execution loop and surfaces
 * per-pair status through the rail.
 *
 * Shape semantics, matched to `partitionTransfer`:
 *   - sources.length === 1, destinations.length > 1 → Distribute
 *   - sources.length > 1,  destinations.length === 1 → Consolidate
 *   - sources.length === 1, destinations.length === 1 → Transfer
 *   - both > 1 → unsupported (submit disabled with a hint)
 */

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly sources: ReadonlyArray<string>;
  readonly destinations: ReadonlyArray<string>;
  readonly walletsById: ReadonlyMap<string, MeWalletEntry>;
  readonly balancesByWalletId: ReadonlyMap<string, string>;
  readonly onSubmit: (totalLamports: bigint) => void | Promise<void>;
  readonly submitting: boolean;
  /**
   * The agent wallet's account id, or null when the user has none.
   * Used ONLY to detect a transfer out of it, which the api answers by
   * auto-pausing every armed conditional — see `AGENT_WITHDRAWAL_WARNING`.
   */
  readonly agentWalletAccountId?: string | null;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

// Shared typography tokens kept in one place so the modal's visual
// hierarchy stays in sync with the rest of the portfolio panel.
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink-3)',
  fontFamily: 'var(--sans)',
};
const readoutValueStyle: React.CSSProperties = {
  color: 'var(--ink-0)',
  fontFamily: 'var(--mono)',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 14,
  fontWeight: 500,
};

export function TransferModal(props: Props): React.ReactElement {
  const [amountSol, setAmountSol] = useState<string>('');
  const [percent, setPercent] = useState<number>(0);
  // Separate live-drag state for the Radix slider. Dragging fires
  // `onValueChange` on every tick (~60Hz); writing through to
  // `percent` / `amountSol` triggers the full memo recompute and a
  // re-render of the readout values, which makes the drag feel
  // strained. `sliderValue` updates cheaply during drag and the
  // expensive sync happens once in `onValueCommit`.
  const [sliderValue, setSliderValue] = useState<number>(0);

  // Reset inputs whenever the modal opens — stale values from a
  // previous selection are surprising once the source/destination
  // shape has changed.
  useEffect(() => {
    if (props.open) {
      setAmountSol('');
      setPercent(0);
      setSliderValue(0);
    }
  }, [props.open]);

  // Keep the slider thumb in sync with `percent` when `percent`
  // changes via other paths (typing in the amount input, typing in
  // the percent input). During an actual slider drag this is a
  // no-op because `percent` only changes on commit.
  useEffect(() => {
    setSliderValue(percent);
  }, [percent]);

  const availableLamports = useMemo<bigint>(() => {
    let total = 0n;
    for (const id of props.sources) {
      const lam = props.balancesByWalletId.get(id);
      if (typeof lam !== 'string') continue;
      try {
        total += BigInt(lam);
      } catch {
        /* skip malformed */
      }
    }
    return total;
  }, [props.sources, props.balancesByWalletId]);

  const parsedLamports = useMemo<bigint | null>(
    () => parseSolToLamports(amountSol),
    [amountSol],
  );

  const plan = useMemo(
    () =>
      partitionTransfer({
        sources: props.sources,
        destinations: props.destinations,
        totalLamports: parsedLamports ?? 0n,
      }),
    [props.sources, props.destinations, parsedLamports],
  );

  const splitCount = BigInt(Math.max(1, Math.max(props.destinations.length, props.sources.length)));
  const perWalletLamports =
    parsedLamports !== null ? parsedLamports / splitCount : 0n;

  // Consolidate splits the total EQUALLY across sources, so the
  // aggregate check above is not enough: a lopsided balance
  // distribution can leave one source unable to cover its share.
  // Surface the first offender so submit blocks with a clear hint
  // instead of a partial server-side failure.
  const shortfallSourceLabel = useMemo<string | null>(() => {
    if (plan.kind !== 'ok' || props.sources.length <= 1) return null;
    for (const pair of plan.pairs) {
      let balance = 0n;
      const lam = props.balancesByWalletId.get(pair.sourceWalletAccountId);
      if (typeof lam === 'string') {
        try {
          balance = BigInt(lam);
        } catch {
          /* treat malformed as zero */
        }
      }
      if (pair.lamports > balance) {
        return labelFor(pair.sourceWalletAccountId, props.walletsById);
      }
    }
    return null;
  }, [plan, props.sources.length, props.balancesByWalletId, props.walletsById]);

  const title = pickTitle(props.sources.length, props.destinations.length);
  const buttonLabel = props.submitting ? 'Sending…' : 'Start Distribution';

  const canSubmit =
    !props.submitting &&
    parsedLamports !== null &&
    parsedLamports > 0n &&
    parsedLamports <= availableLamports &&
    shortfallSourceLabel === null &&
    plan.kind === 'ok';

  const onPercentChange = (next: number): void => {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    setPercent(clamped);
    if (availableLamports <= 0n) {
      setAmountSol('');
      return;
    }
    // Floor to the 5-decimal display precision before formatting:
    // `formatLamportsToSol` rounds half-up, which could produce an
    // amount string that re-parses to MORE lamports than the balance
    // (blocking submit on 100%/Max).
    const target = (availableLamports * BigInt(clamped)) / 100n;
    setAmountSol(formatLamportsToSol(target - (target % 10_000n)));
  };

  const onAmountChange = (raw: string): void => {
    // Only accept numbers + a single optional decimal with up to 9
    // fractional digits — matches the lamports-precision parser
    // below. Empty string is allowed so the user can clear the input.
    if (raw.length > 0 && !/^\d*(\.\d{0,9})?$/.test(raw)) return;
    setAmountSol(raw);
    const parsed = parseSolToLamports(raw);
    if (parsed === null || availableLamports <= 0n) {
      setPercent(0);
      return;
    }
    if (parsed >= availableLamports) {
      setPercent(100);
      return;
    }
    // Compute percent in basis points then round to nearest int to
    // avoid Number(bigint) precision issues for very large balances.
    const bps = Number((parsed * 10_000n) / availableLamports);
    setPercent(Math.max(0, Math.min(100, Math.round(bps / 100))));
  };

  const onPercentInputChange = (raw: string): void => {
    if (raw === '') {
      setPercent(0);
      setAmountSol('');
      return;
    }
    if (!/^\d+$/.test(raw)) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onPercentChange(n);
  };

  const agentIsSource = isAgentWithdrawal(props.sources, props.agentWalletAccountId);

  const submit = (): void => {
    if (!canSubmit || parsedLamports === null) return;
    props.onOpenChange(false);
    void props.onSubmit(parsedLamports);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        data-testid="transfer-modal"
        className="max-w-md gap-4 sm:gap-5"
        style={{
          background: 'var(--surface-1)',
          color: 'var(--ink-1)',
          borderColor: 'var(--hairline-2)',
        }}
      >
        <DialogHeader>
          <DialogTitle
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--ink-0)',
              fontFamily: 'var(--sans)',
              letterSpacing: '-0.005em',
            }}
          >
            {title}
          </DialogTitle>
          <DialogDescription
            style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              fontFamily: 'var(--sans)',
            }}
          >
            {describeShape(props.sources, props.destinations, props.walletsById)}
          </DialogDescription>
        </DialogHeader>

        {/* Amount + percent row */}
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <label className="flex flex-col gap-1">
            <span style={labelStyle}>Amount</span>
            {/* Solana icon sits inside the field as a leading prefix
                — mirrors the way every other balance in the portfolio
                is presented (icon + amount, no trailing "SOL" text). */}
            <div
              className="flex items-center gap-2 rounded-md px-3"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--input-border, var(--hairline))',
                height: 36,
              }}
            >
              <Solana mono style={{ width: 16, height: 16, flexShrink: 0, color: 'var(--ink-3)' }} />
              <input
                type="text"
                inputMode="decimal"
                value={amountSol}
                onChange={(e) => onAmountChange(e.target.value)}
                placeholder="0.0"
                data-testid="transfer-modal-amount"
                className="w-full bg-transparent outline-none"
                style={{
                  color: 'var(--ink-0)',
                  fontFamily: 'var(--mono)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 14,
                }}
              />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span style={labelStyle}>Percent</span>
            <div
              className="flex items-center rounded-md px-3"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--input-border, var(--hairline))',
                height: 36,
              }}
            >
              <input
                type="text"
                inputMode="numeric"
                value={percent === 0 && amountSol === '' ? '' : String(percent)}
                onChange={(e) => onPercentInputChange(e.target.value)}
                placeholder="0"
                data-testid="transfer-modal-percent"
                className="w-full bg-transparent outline-none text-right"
                style={{
                  color: 'var(--ink-0)',
                  fontFamily: 'var(--mono)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 14,
                }}
              />
              <span
                style={{
                  marginLeft: 4,
                  color: 'var(--ink-3)',
                  fontFamily: 'var(--mono)',
                  fontSize: 14,
                }}
              >
                %
              </span>
            </div>
          </label>
        </div>

        {/* Slider with 0/25/50/75/100 stop labels.
            During drag we only update the cheap `sliderValue` state
            so the thumb tracks the mouse without re-rendering every
            downstream readout. The expensive sync (percent +
            amountSol + memo recomputes) fires once when the user
            releases via `onValueCommit`. */}
        <div className="flex flex-col gap-2">
          <Slider
            data-testid="transfer-modal-slider"
            min={0}
            max={100}
            step={1}
            value={[sliderValue]}
            onValueChange={(v) => setSliderValue(v[0] ?? 0)}
            onValueCommit={(v) => {
              const next = v[0] ?? 0;
              onPercentChange(next);
            }}
          />
          <div
            className="flex justify-between"
            style={{
              fontSize: 11,
              color: 'var(--ink-3)',
              fontFamily: 'var(--sans)',
            }}
          >
            {[0, 25, 50, 75, 100].map((stop) => (
              <span key={stop}>{stop}%</span>
            ))}
          </div>
        </div>

        {/* Available / per-wallet readout. Solana logomark sits in
            front of each value (matching the wallet row balance cells
            and the top header total). The trailing "SOL" text is
            redundant once the icon is present. */}
        <div
          className="flex items-center justify-between"
          style={{
            fontSize: 13,
            color: 'var(--ink-3)',
            fontFamily: 'var(--sans)',
          }}
        >
          <span className="inline-flex items-center gap-2">
            Available:
            <span className="inline-flex items-center gap-1" style={readoutValueStyle}>
              <Solana mono style={{ width: 14, height: 14, color: 'var(--ink-3)' }} />
              {formatLamportsToSol(availableLamports)}
            </span>
          </span>
          <span className="inline-flex items-center gap-2">
            Per wallet:
            <span className="inline-flex items-center gap-1" style={readoutValueStyle}>
              <Solana mono style={{ width: 14, height: 14, color: 'var(--ink-3)' }} />
              {formatLamportsToSol(perWalletLamports)}
            </span>
          </span>
        </div>

        {/* Horizontal divider before the CTA, matching the panel's
            internal hairline rhythm. */}
        <div
          aria-hidden
          style={{ height: 1, background: 'var(--hairline)' }}
        />

        {planHint(plan, parsedLamports, availableLamports, shortfallSourceLabel)}

        {/* Agent-withdrawal disclosure. Sits directly above the confirm
            button so it is read at the moment of commitment, not filed
            away in a card the user opened minutes ago. A warning LINE,
            not a second confirmation step: the side effect is
            reversible (re-enable the conditionals) and the transfer
            itself already has an explicit confirm. */}
        {agentIsSource ? (
          <p
            data-testid="agent-withdrawal-warning"
            className="m-0 rounded-md"
            style={{
              fontSize: 12,
              lineHeight: 1.45,
              fontFamily: 'var(--sans)',
              color: 'var(--hold)',
              background: 'color-mix(in srgb, var(--hold) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--hold) 35%, transparent)',
              padding: '8px 10px',
            }}
          >
            {AGENT_WITHDRAWAL_WARNING}
          </p>
        ) : null}

        <DialogFooter className="mt-1">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="transfer-modal-submit"
            className="w-full rounded-md disabled:cursor-not-allowed"
            style={{
              background: canSubmit ? 'var(--primary)' : 'var(--input-bg)',
              color: canSubmit ? 'var(--primary-foreground)' : 'var(--ink-3)',
              border: '1px solid',
              borderColor: canSubmit
                ? 'color-mix(in srgb, var(--accent-primary) 35%, var(--hairline))'
                : 'var(--hairline)',
              padding: '10px 14px',
              fontSize: 14,
              fontFamily: 'var(--sans)',
              fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {buttonLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── helpers ───────────────────────────

function pickTitle(sourcesCount: number, destinationsCount: number): string {
  if (destinationsCount > 1 && sourcesCount <= 1) {
    return `Distribute to ${destinationsCount} wallets`;
  }
  if (sourcesCount > 1 && destinationsCount <= 1) {
    return `Consolidate from ${sourcesCount} wallets`;
  }
  return 'Transfer';
}

function describeShape(
  sources: ReadonlyArray<string>,
  destinations: ReadonlyArray<string>,
  walletsById: ReadonlyMap<string, MeWalletEntry>,
): string {
  const fromLabel = sources.length === 1
    ? labelFor(sources[0]!, walletsById)
    : `${sources.length} source${sources.length === 1 ? '' : 's'}`;
  const toLabel = destinations.length === 1
    ? labelFor(destinations[0]!, walletsById)
    : `${destinations.length} destination${destinations.length === 1 ? '' : 's'}`;
  return `${fromLabel} → ${toLabel}`;
}

function labelFor(id: string, walletsById: ReadonlyMap<string, MeWalletEntry>): string {
  const w = walletsById.get(id);
  return w ? walletDisplayName(w) : '—';
}

function planHint(
  plan: ReturnType<typeof partitionTransfer>,
  parsedLamports: bigint | null,
  availableLamports: bigint,
  shortfallSourceLabel: string | null,
): React.ReactElement | null {
  const hintStyle: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--down)',
    fontFamily: 'var(--sans)',
    margin: 0,
  };
  if (parsedLamports !== null && availableLamports > 0n && parsedLamports > availableLamports) {
    return <p style={hintStyle}>Amount exceeds available balance.</p>;
  }
  if (shortfallSourceLabel !== null) {
    return (
      <p style={hintStyle}>
        Each source sends an equal share — {shortfallSourceLabel} does not have enough.
      </p>
    );
  }
  if (plan.kind === 'unsupported') {
    return (
      <p style={hintStyle}>
        N sources to M destinations is not supported. Use N→1 or 1→M.
      </p>
    );
  }
  if (plan.kind === 'self_transfer') {
    return <p style={hintStyle}>A wallet cannot transfer to itself.</p>;
  }
  if (plan.kind === 'amount_too_small') {
    return (
      <p style={hintStyle}>
        Amount is too small to split across {plan.fanOutCount} wallets.
      </p>
    );
  }
  return null;
}

/**
 * Parse a decimal SOL string ("1.5", "0.000001", ".5", "") into
 * integer lamports. Returns `null` for empty, malformed, or
 * non-positive inputs so the caller can disable the submit CTA in
 * one check.
 *
 * Accepts both leading-digit forms ("0.5") and leading-dot forms
 * (".5") so the parser matches the input-field whitelist used in
 * `onAmountChange` — keeping these two in sync was the source of a
 * bug where typing ".5" set `amountSol` but parsed to `null`, leaving
 * the submit button permanently disabled even though the field
 * looked valid.
 *
 * Precision: pads/truncates the fractional part to exactly 9 digits
 * (1 SOL = 1e9 lamports) using BigInt arithmetic, never Number, to
 * avoid the binary-floating-point rounding errors a naive
 * `Number(sol) * 1e9` introduces around the 8th decimal place.
 */
export function parseSolToLamports(value: string): bigint | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Mirror of the input filter — accept leading-dot decimals too.
  if (!/^\d*(\.\d{0,9})?$/.test(trimmed)) return null;
  if (trimmed === '.' || trimmed === '') return null;
  const [wholeRaw, frac = ''] = trimmed.split('.');
  const whole = wholeRaw && wholeRaw.length > 0 ? wholeRaw : '0';
  const padded = frac.padEnd(9, '0').slice(0, 9);
  try {
    const lamports = BigInt(whole) * LAMPORTS_PER_SOL + BigInt(padded || '0');
    return lamports > 0n ? lamports : null;
  } catch {
    return null;
  }
}

/**
 * Format an integer lamports value as a SOL string, rounded
 * half-up to 5 decimal places (matches the Axiom reference).
 * Trailing zeros are trimmed: 0.50000 → "0.5", 1.00000 → "1".
 */
function formatLamportsToSol(lamports: bigint): string {
  if (lamports <= 0n) return '0';
  // 1 SOL = 1e9 lamports. To get 5-decimal precision we divide by
  // 1e4 (since 1e9 / 1e5 = 1e4), rounding half-up via the classic
  // `(x + divisor/2) / divisor` trick on BigInts.
  const FIVE_DEC_DIVISOR = 10_000n; // 1e9 / 1e5
  const HALF = FIVE_DEC_DIVISOR / 2n;
  const rounded5dp = (lamports + HALF) / FIVE_DEC_DIVISOR; // units of 1e-5 SOL
  const SCALE_5 = 100_000n; // 1 SOL = 100,000 * 1e-5 SOL
  const whole = rounded5dp / SCALE_5;
  const frac = rounded5dp % SCALE_5;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(5, '0').replace(/0+$/, '');
  if (fracStr.length === 0) return whole.toString();
  return `${whole.toString()}.${fracStr}`;
}
