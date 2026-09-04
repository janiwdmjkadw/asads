'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { fetchHotTradePoll, isTradingApiConfigured } from '@/lib/api/trading';
import { listWalletBalances } from '@/lib/api/wallet-balances';
import { transferTokens } from '@/lib/api/wallets';
import type { MeWalletEntry } from '@/lib/api/me';
import { useTradeActivityStore } from '@/lib/state/trade-activity-store';
import { buildTokenBalanceUrl } from './useTradeStream';
import {
  computeAggregatePlan,
  computeSplitPlan,
  type PlannedTransfer,
  type WalletTokenHolding,
} from './tokenRebalance';

/**
 * Slice "Per-mint token split/aggregate": per-wallet SOL + THIS-mint
 * token balances for the multi-wallet selector, plus the Split /
 * Aggregate actions. Everything is scoped to ONE mint — the planner
 * inputs come exclusively from this mint's token-balance reads, and
 * the server-side verifier re-binds every account to the mint, so no
 * other token can ever move.
 */

/** Mirrors the api/ WALLET_TRANSFER_MAX_DESTINATIONS default. */
const MAX_DESTINATIONS_PER_CALL = 8;

export interface WalletHolding {
  readonly solLamports: bigint | null;
  readonly tokenBaseUnits: bigint | null;
}

export interface MintWalletHoldings {
  readonly byWalletId: ReadonlyMap<string, WalletHolding>;
  readonly loading: boolean;
  readonly refetch: () => void;
  /**
   * Apply exact post-transfer token deltas (base units, signed) so the
   * rows update the instant a transfer confirms — the balance endpoint
   * can lag the chain by seconds, and a refetch would show stale
   * values. Deltas come from the executed plan, so they're exact.
   */
  readonly applyTokenDeltas: (deltas: ReadonlyMap<string, bigint>) => void;
}

/**
 * One-shot (plus manual refetch) balance read for every listed wallet:
 * one `listWalletBalances` call for SOL, one token-balance read per
 * wallet for the mint. Fetches only while the selector is OPEN
 * (`enabled`), so the trade page's steady-state polling is untouched.
 */
export function useMintWalletHoldings(
  mint: string | null,
  wallets: ReadonlyArray<MeWalletEntry>,
  enabled: boolean,
): MintWalletHoldings {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  // Seed from the last fetch for this mint so REOPENING the selector
  // shows balances instantly (the fresh fetch still runs and replaces
  // them). The popover unmounts on close, so without this every open
  // started from a blank map.
  const [byWalletId, setByWalletId] = useState<ReadonlyMap<string, WalletHolding>>(
    () => (mint !== null ? (holdingsCacheByMint.get(mint) ?? EMPTY_MAP) : EMPTY_MAP),
  );
  const [loading, setLoading] = useState(false);
  const [fetchNonce, setFetchNonce] = useState(0);
  const walletIdsKey = wallets.map((w) => w.wallet_account_id).join('|');
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  useEffect(() => {
    if (!enabled || !mint || !isTradingApiConfigured() || !isLoaded || isSignedIn !== true) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const token = await getToken();
        const list = walletsRef.current;
        const [solResult, tokenResults] = await Promise.all([
          listWalletBalances({ authToken: token }).catch(() => null),
          Promise.all(
            list.map(async (wallet) => {
              const url = buildTokenBalanceUrl(mint, wallet.wallet_account_id);
              if (url === null) return { id: wallet.wallet_account_id, tokens: null };
              try {
                const res = await fetchHotTradePoll(url, { authToken: token });
                if (!res.ok) return { id: wallet.wallet_account_id, tokens: null };
                const body = (await res.json()) as { tokens?: string };
                const tokens =
                  typeof body.tokens === 'string' && /^[0-9]+$/.test(body.tokens)
                    ? BigInt(body.tokens)
                    : 0n;
                return { id: wallet.wallet_account_id, tokens };
              } catch {
                return { id: wallet.wallet_account_id, tokens: null };
              }
            }),
          ),
        ]);
        if (cancelled) return;
        const solById = new Map<string, bigint>();
        if (solResult && solResult.kind === 'ok') {
          for (const balance of solResult.balances) {
            try {
              solById.set(balance.wallet_account_id, BigInt(balance.lamports));
            } catch {
              // skip malformed rows
            }
          }
        }
        const next = new Map<string, WalletHolding>();
        for (const entry of tokenResults) {
          next.set(entry.id, {
            solLamports: solById.get(entry.id) ?? null,
            tokenBaseUnits: entry.tokens,
          });
        }
        cacheHoldings(mint, next);
        setByWalletId(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, fetchNonce, getToken, isLoaded, isSignedIn, mint, walletIdsKey]);

  const refetch = useCallback(() => setFetchNonce((n) => n + 1), []);
  const applyTokenDeltas = useCallback(
    (deltas: ReadonlyMap<string, bigint>) => {
      if (deltas.size === 0) return;
      setByWalletId((prev) => {
        const next = new Map(prev);
        for (const [id, delta] of deltas) {
          const current = next.get(id) ?? { solLamports: null, tokenBaseUnits: null };
          const base = current.tokenBaseUnits ?? 0n;
          const updated = base + delta;
          next.set(id, { ...current, tokenBaseUnits: updated < 0n ? 0n : updated });
        }
        if (mint !== null) cacheHoldings(mint, next);
        return next;
      });
    },
    [mint],
  );
  return useMemo(
    () => ({ byWalletId, loading, refetch, applyTokenDeltas }),
    [applyTokenDeltas, byWalletId, loading, refetch],
  );
}

const EMPTY_MAP: ReadonlyMap<string, WalletHolding> = new Map();

/** Last-known holdings per mint, so reopening the selector paints
 *  immediately while the fresh fetch is in flight. Values are exact
 *  post-transfer states (deltas are written back too). Bounded: keep
 *  only the most recent handful of mints a session touched. */
const holdingsCacheByMint = new Map<string, ReadonlyMap<string, WalletHolding>>();
const HOLDINGS_CACHE_MAX_MINTS = 8;

function cacheHoldings(mint: string, value: ReadonlyMap<string, WalletHolding>): void {
  holdingsCacheByMint.delete(mint);
  if (holdingsCacheByMint.size >= HOLDINGS_CACHE_MAX_MINTS) {
    const oldest = holdingsCacheByMint.keys().next().value;
    if (oldest !== undefined) holdingsCacheByMint.delete(oldest);
  }
  holdingsCacheByMint.set(mint, value);
}

export function formatTokenAmount(baseUnits: bigint): string {
  // Pump tokens are 6-decimal; display in whole tokens, compact.
  const tokens = Number(baseUnits) / 1e6;
  if (!Number.isFinite(tokens)) return '—';
  if (tokens >= 1e9) return `${(tokens / 1e9).toFixed(2)}B`;
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(2)}M`;
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)}K`;
  if (tokens >= 1) return tokens.toFixed(2).replace(/\.00$/, '');
  if (tokens > 0) return tokens.toPrecision(2);
  return '0';
}

function formatSolSafe(lamports: string): string {
  try {
    return formatSol(BigInt(lamports));
  } catch {
    return '?';
  }
}

export function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / 1e9;
  if (!Number.isFinite(sol)) return '—';
  if (sol >= 1) return sol.toFixed(2);
  if (sol > 0) return sol.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return '0';
}

type PendingAction = 'split' | 'aggregate' | null;

/**
 * Split / Aggregate footer for the multi-wallet selector. Single-click
 * actions; execution fans out one `transferTokens` call per SOURCE
 * wallet (chunked at the api/'s per-call destination cap), all sources
 * in parallel — each source signs its own atomic tx with its own
 * nonce, so plans never contend.
 */
export function WalletRebalanceActions({
  mint,
  wallets,
  selectedIds,
  holdings,
}: {
  mint: string;
  wallets: ReadonlyArray<MeWalletEntry>;
  selectedIds: ReadonlyArray<string>;
  holdings: MintWalletHoldings;
}): React.ReactElement | null {
  const { getToken } = useAuth();
  const applyTransferBalanceFloors = useTradeActivityStore((s) => s.applyTransferBalanceFloors);
  const [busy, setBusy] = useState<PendingAction>(null);

  const primaryId =
    wallets.find((w) => w.is_primary)?.wallet_account_id ?? null;

  const selectedHoldings = useMemo<WalletTokenHolding[]>(() => {
    const out: WalletTokenHolding[] = [];
    for (const id of selectedIds) {
      const holding = holdings.byWalletId.get(id);
      // Unknown balances are treated as 0 for planning; the server's
      // holdings preflight is the authoritative gate.
      out.push({ walletAccountId: id, balanceBaseUnits: holding?.tokenBaseUnits ?? 0n });
    }
    return out;
  }, [holdings.byWalletId, selectedIds]);

  const splitPlans = useMemo(() => computeSplitPlan(selectedHoldings), [selectedHoldings]);
  const aggregatePlans = useMemo(
    () => (primaryId ? computeAggregatePlan(selectedHoldings, primaryId) : []),
    [primaryId, selectedHoldings],
  );

  const runPlans = useCallback(
    async (plans: ReadonlyArray<PlannedTransfer>, label: string) => {
      const token = await getToken();
      // Chunk each source's destinations at the per-call cap; every
      // chunk is its own idempotent transfer.
      const calls: Array<{ source: string; dests: PlannedTransfer['destinations'] }> = [];
      for (const plan of plans) {
        for (let i = 0; i < plan.destinations.length; i += MAX_DESTINATIONS_PER_CALL) {
          calls.push({
            source: plan.sourceWalletAccountId,
            dests: plan.destinations.slice(i, i + MAX_DESTINATIONS_PER_CALL),
          });
        }
      }
      const results = await Promise.all(
        calls.map((call) =>
          transferTokens(
            {
              sourceWalletAccountId: call.source,
              clientTransferId:
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                  ? crypto.randomUUID()
                  : `tt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              mint,
              destinations: call.dests.map((d) => ({
                walletAccountId: d.walletAccountId,
                amountBaseUnits: d.amountBaseUnits.toString(),
              })),
            },
            { authToken: token },
          ).catch(() => ({ kind: 'network_error', reason: 'network' }) as const),
        ),
      );
      const pending = results.filter((r) => r.kind === 'pending_unconfirmed');
      const failed = results.filter(
        (r) => r.kind !== 'ok' && r.kind !== 'pending_unconfirmed',
      );
      if (failed.length === 0 && pending.length === 0) {
        toast(`${label} complete`, {
          description: `${calls.length} transfer${calls.length === 1 ? '' : 's'} confirmed.`,
        });
      } else if (failed.length === 0) {
        // Dispatched but unconfirmed — may still land. Never say "retry".
        toast(
          `${label}: ${pending.length} transfer${pending.length === 1 ? '' : 's'} still confirming`,
          { description: 'Check balances in a moment — do not resubmit.' },
        );
      } else {
        const firstError = failed[0]!;
        toast(
          `${label}: ${results.length - failed.length - pending.length}/${results.length} confirmed`,
          {
            description:
              firstError.kind === 'error'
                ? firstError.message
                : firstError.kind === 'insufficient_balance'
                  ? `A source wallet needs ${formatSolSafe(firstError.requiredLamports)} SOL free for fees/rent (has ${formatSolSafe(firstError.observedLamports)}).`
                  : 'Some transfers failed — balances are unchanged for those. Retry after refresh.',
          },
        );
      }
      // Exact signed deltas for the calls that CONFIRMED (skip pending/
      // failed — their balances did not provably move).
      const deltas = new Map<string, bigint>();
      const bump = (id: string, by: bigint) => deltas.set(id, (deltas.get(id) ?? 0n) + by);
      for (let i = 0; i < calls.length; i += 1) {
        if (results[i]?.kind !== 'ok') continue;
        const call = calls[i]!;
        for (const dest of call.dests) {
          bump(call.source, -dest.amountBaseUnits);
          bump(dest.walletAccountId, dest.amountBaseUnits);
        }
      }
      return deltas;
    },
    [getToken, mint],
  );

  const execute = useCallback(
    async (action: 'split' | 'aggregate') => {
      const plans = action === 'split' ? splitPlans : aggregatePlans;
      if (plans.length === 0 || busy !== null) return;
      setBusy(action);
      try {
        const deltas = await runPlans(plans, action === 'split' ? 'Split tokens' : 'Aggregate');
        // Instant UI: apply the exact confirmed deltas to the rows (the
        // balance endpoint can lag the chain), and stamp the panel's
        // optimistic floors — receivers get their post-transfer balance
        // (sell hints reflect it immediately), drained senders lose any
        // stale buy floor.
        holdings.applyTokenDeltas(deltas);
        const floors: Array<{ walletAccountId: string; mint: string; floorTokens: string | null }> =
          [];
        for (const [walletId, delta] of deltas) {
          if (delta > 0n) {
            const before = holdings.byWalletId.get(walletId)?.tokenBaseUnits ?? 0n;
            const after = before + delta;
            floors.push({
              walletAccountId: walletId,
              mint,
              floorTokens: (after < 0n ? 0n : after).toString(),
            });
          } else if (delta < 0n) {
            floors.push({ walletAccountId: walletId, mint, floorTokens: null });
          }
        }
        applyTransferBalanceFloors(floors);
      } finally {
        setBusy(null);
      }
    },
    [aggregatePlans, applyTransferBalanceFloors, busy, holdings, mint, runPlans, splitPlans],
  );

  if (selectedIds.length === 0) return null;
  const splitDisabled = busy !== null || splitPlans.length === 0 || selectedIds.length < 2;
  const aggregateDisabled = busy !== null || aggregatePlans.length === 0 || primaryId === null;

  // The what-moves/rent explanation lives in hover tooltips instead of
  // a standing footer paragraph (2026-07 popover redesign). Local
  // provider: the popover portals outside any page-level provider.
  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={300}>
      <div
        data-testid="wallet-rebalance-actions"
        style={{
          display: 'flex',
          gap: 8,
          borderTop: '1px solid var(--hairline)',
          padding: '10px 14px 12px',
          marginTop: 4,
        }}
      >
        <ActionButton
          testId="rebalance-split"
          label={busy === 'split' ? 'Splitting…' : 'Split'}
          tooltip="Evens this coin's tokens across selected wallets (±1 unit stays with the largest). Sources pay ~0.002 SOL rent per new token account."
          disabled={splitDisabled}
          onClick={() => void execute('split')}
        />
        <ActionButton
          testId="rebalance-aggregate"
          label={busy === 'aggregate' ? 'Aggregating…' : 'Aggregate'}
          tooltip="Sweeps this coin's tokens from selected wallets to your primary. Sources pay ~0.002 SOL rent per new token account."
          disabled={aggregateDisabled}
          onClick={() => void execute('aggregate')}
        />
      </div>
    </TooltipProvider>
  );
}

function ActionButton({
  label,
  tooltip,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  tooltip: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
          style={{
            flex: 1,
            minWidth: 0,
            background: disabled
              ? 'transparent'
              : 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',
            color: disabled ? 'var(--ink-2)' : 'var(--accent-primary)',
            border: disabled
              ? '1px solid var(--hairline)'
              : '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)',
            borderRadius: 8,
            padding: '7px 10px',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </button>
      </TooltipTrigger>
      {/* z-[100]: the wallets popover sits at zIndex 90, and the tooltip
          portal shares its stacking context (.listen-root), so the default
          z-50 would put the tip behind the popover. */}
      <TooltipContent side="top" className="z-[100] max-w-[220px] text-[10px] leading-relaxed">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
