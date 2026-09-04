'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useClerk } from '@clerk/nextjs';
import { Wallet, Solana } from '@/components/listen/icons/Icons';
import {
  formatSolFromLamports,
  pickStageFromResult,
  type EnableTradingStage,
} from '@/components/listen/EnableTradingPanel';
import { DepositAddress } from '@/components/wallet/DepositAddress';
import { setupNoncesRecoveringAuthorization } from '@/lib/api/wallet-nonce-setup';
import { useMe } from '@/lib/api/me';
import { nonceSetupSurface } from '@/lib/auth/nonce-setup-surface';
import { pickPrimaryWalletEntry, pickDefaultExportWallet } from '@/lib/auth/wallet-export';

/**
 * Live SOL/USD rate for the setup-cost copy. Pulled from CoinGecko's
 * public simple-price endpoint (no auth, CORS-friendly) and long-cached.
 * Degrades gracefully (USD hidden) on any failure. Swap for an internal
 * price endpoint if/when one exists.
 */
export function useSolPriceUsd(): number | null {
  const { data } = useQuery<number | null>({
    queryKey: ['onboarding', 'sol-price-usd'],
    queryFn: async () => {
      try {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
        );
        if (!res.ok) return null;
        const json = (await res.json()) as { solana?: { usd?: number } };
        const price = json?.solana?.usd;
        return typeof price === 'number' && price > 0 ? price : null;
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return data ?? null;
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Rent-exempt minimum for a single durable nonce account (80-byte data,
 * ~0.00144768 SOL). Used to estimate the setup cost up front, before the
 * live preflight resolves, so the SOL + USD figure is always shown. The
 * real on-chain cost from the preflight replaces this once available.
 */
const NONCE_RENT_LAMPORTS_PER_ACCOUNT = 1_447_680;

function StepBadge({ n }: { n: number }): React.ReactElement {
  return (
    <span
      aria-hidden
      className="grid h-5 w-5 place-items-center rounded-full border border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-center text-[11px] font-semibold leading-none tabular-nums text-[var(--accent-primary)]"
    >
      {n}
    </span>
  );
}

/**
 * Onboarding step 2: deposit + trading setup.
 *
 * Two cohesive panels that share the same surface treatment:
 *   1. Deposit — QR + copyable Solana address.
 *   2. Set up trading — runs the nonce preflight on mount so the cost /
 *      balance is stated up front, then commits the on-chain setup.
 *
 * Both key off the user's primary wallet from `/me`.
 *
 * Slice "No-nonce trading" (D10): when `/me` reports nonce setup
 * OPTIONAL for that wallet, the second panel is not a step at all — the
 * wallet already trades — so the card renders deposit-only, runs no
 * preflight and polls nothing. `required` and `complete` are unchanged.
 */
export function DepositCard(): React.ReactElement {
  const { data: me } = useMe();

  const wallet = useMemo(() => {
    if (!me || me.reauth_required) return null;
    return pickPrimaryWalletEntry(me.wallets) ?? pickDefaultExportWallet(me.wallets);
  }, [me]);

  const pubkey = wallet?.wallet_pubkey ?? null;
  const walletAccountId = wallet?.wallet_account_id ?? null;
  const targetCount = wallet?.nonce_setup.target_count ?? 5;
  const nonceRequired = wallet?.nonce_setup.required ?? false;
  // Only a RESOLVED wallet can turn this card deposit-only: before `/me`
  // lands we render exactly what we render today, so a user who does
  // need setup never sees the step appear late.
  const depositOnly = wallet !== null && nonceSetupSurface(wallet.nonce_setup) === 'optional';

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      {/* Accent wallet glyph with a gentle breathing glow. */}
      <div className="relative flex items-center justify-center">
        <motion.span
          aria-hidden
          className="absolute h-16 w-16 rounded-full bg-[radial-gradient(circle,var(--accent-primary),transparent_70%)] blur-xl"
          animate={{ opacity: [0.35, 0.6, 0.35], scale: [0.9, 1.12, 0.9] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span
          aria-hidden
          className="relative flex h-16 w-16 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--accent-primary)_32%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-[var(--accent-primary)]"
        >
          <Wallet className="h-8 w-8" strokeWidth={2} />
        </span>
      </div>

      {/* Action copy. Lede states up front that nothing on this step
          gates the rest of the app — only trading waits on funding. */}
      <h2 className="m-0 text-2xl font-semibold text-[var(--ink-0)]">Fund your wallet</h2>
      <p className="m-0 max-w-[34rem] text-[13.5px] leading-relaxed text-[var(--ink-2)]">
        Whenever you&rsquo;re ready to trade, this is where SOL comes in. Nothing here blocks
        you from looking around first.
      </p>

      <DepositPanel pubkey={pubkey} showStep={!depositOnly} />
      {depositOnly ? (
        <p className="m-0 max-w-[34rem] text-[13.5px] leading-relaxed text-[var(--ink-3)]">
          That&rsquo;s the only step — your wallet can trade the moment SOL lands.
        </p>
      ) : (
        <SetupPanel
          walletAccountId={walletAccountId}
          targetCount={targetCount}
          nonceRequired={nonceRequired}
        />
      )}
    </div>
  );
}

// ───────── Deposit panel ─────────

function DepositPanel({
  pubkey,
  showStep,
}: {
  pubkey: string | null;
  /** False when depositing is the whole card — a lone "1" reads as a queue. */
  showStep: boolean;
}): React.ReactElement {
  return (
    <div className="flex w-full flex-col gap-3.5 rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_srgb,var(--ink-0)_4%,transparent)] px-6 py-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {showStep ? <StepBadge n={1} /> : null}
          <span className="text-[14px] font-semibold text-[var(--ink-0)]">Deposit SOL</span>
        </div>
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink-3)]">
          <Solana style={{ width: 14, height: 14 }} />
          Solana network
        </span>
      </div>

      <DepositAddress pubkey={pubkey} />
    </div>
  );
}

// ───────── Trading-setup panel ─────────

type SetupStage = EnableTradingStage | { kind: 'done' };

function SetupPanel({
  walletAccountId,
  targetCount,
  nonceRequired,
}: {
  walletAccountId: string | null;
  targetCount: number;
  nonceRequired: boolean;
}): React.ReactElement {
  const [stage, setStage] = useState<SetupStage>({ kind: 'idle' });
  const queryClient = useQueryClient();
  const clerk = useClerk();
  const { getToken } = useAuth();
  const solPriceUsd = useSolPriceUsd();
  // Guards a background balance poll from overlapping itself.
  const preflightInFlight = useRef(false);
  // Mirrors `stage` so async callbacks can read the latest value
  // without re-arming on every change. `runLive` writes it
  // synchronously so an in-flight preflight resolving mid-setup
  // can't clobber the executing/done state.
  const stageRef = useRef(stage);
  stageRef.current = stage;

  // `silent` refreshes the balance/cost in place without flipping the UI
  // back to the loading state — used by the background poll so a deposit
  // landing doesn't cause a flicker.
  const runPreflight = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!walletAccountId || preflightInFlight.current) return;
      preflightInFlight.current = true;
      if (!options.silent) setStage({ kind: 'preflight_loading' });
      try {
        const result = await setupNoncesRecoveringAuthorization({
          dryRun: true,
          authToken: await getToken(),
          walletAccountId,
        });
        const settled = stageRef.current.kind;
        if (settled === 'executing' || settled === 'done' || settled === 'partial') return;
        // A SILENT background poll must never clobber a visible error
        // (e.g. a failed live run's copy vanishing ≤3s after it
        // rendered). Explicit retries (non-silent) still refresh.
        if (options.silent && settled === 'error') return;
        if (result.kind === 'reauth') {
          // Land on a retryable error stage FIRST: leaving the stage at
          // `preflight_loading` wedged the card forever (that state is
          // in the poll's `settling` set, so nothing re-drove it).
          setStage({
            kind: 'error',
            copy: 'Your session expired. Sign in again to continue.',
            retryable: true,
          });
          // The silent 3s poll must never pop the sign-in modal — it
          // used to re-open it on EVERY tick once the session went
          // stale. Explicit user action (mount/Retry) still opens it.
          if (!options.silent) clerk.openSignIn();
          return;
        }
        const next = pickStageFromResult(result, { targetCount });
        if (next) setStage(next);
      } catch {
        // getToken()/network rejection: without this the stage stayed
        // `preflight_loading` forever (an unrecoverable spinner).
        if (!options.silent && stageRef.current.kind === 'preflight_loading') {
          setStage({
            kind: 'error',
            copy: 'Network error. Check your connection and try again.',
            retryable: true,
          });
        }
      } finally {
        preflightInFlight.current = false;
      }
    },
    [walletAccountId, targetCount, getToken, clerk],
  );

  const runLive = useCallback(async () => {
    if (!walletAccountId) return;
    // Re-entry guard: the button unmounts on the next render, but a
    // double-click in the same frame would fire setupNonces twice.
    if (stageRef.current.kind === 'executing') return;
    stageRef.current = { kind: 'executing' };
    setStage({ kind: 'executing' });
    // Any path that leaves `executing` latched wedges the card forever:
    // the re-entry guard blocks future clicks and the background poll
    // treats `executing` as settling. Every exit must land on a real
    // stage.
    const fail = (copy: string): void => {
      const next = { kind: 'error', copy, retryable: true } as const;
      stageRef.current = next;
      setStage(next);
    };
    try {
      const result = await setupNoncesRecoveringAuthorization({
        authToken: await getToken(),
        walletAccountId,
      });
      if (result.kind === 'reauth') {
        fail('Your session expired. Sign in again to continue.');
        clerk.openSignIn();
        return;
      }
      if (result.kind === 'ok') {
        await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
        setStage({ kind: 'done' });
        return;
      }
      const next = pickStageFromResult(result, { targetCount });
      if (next) setStage(next);
    } catch {
      fail('Network error. Check your connection and try again.');
    }
  }, [walletAccountId, targetCount, getToken, clerk, queryClient]);

  // Auto-run the preflight so the cost/balance is visible immediately.
  // Skip when the wallet isn't resolved yet or setup is already done.
  useEffect(() => {
    if (!walletAccountId) {
      setStage({ kind: 'idle' });
      return;
    }
    if (!nonceRequired) {
      setStage({ kind: 'done' });
      return;
    }
    void runPreflight();
  }, [walletAccountId, nonceRequired, runPreflight]);

  // Live balance polling: a deposit can land at any moment, so while the
  // wallet still needs funding we silently re-check every few seconds
  // (and immediately on window focus, e.g. returning from a wallet app)
  // so the cost/balance and the enabled state update without a manual
  // refresh. Reads the latest stage via a ref to avoid re-arming the
  // interval on every poll; stops fetching once funded or once setup is
  // underway/complete.
  useEffect(() => {
    if (!walletAccountId || !nonceRequired) return;
    const refresh = (): void => {
      const current = stageRef.current;
      const funded = current.kind === 'preflight_ready' && current.preflight.sufficient;
      const settling =
        current.kind === 'executing' ||
        current.kind === 'done' ||
        current.kind === 'partial' ||
        current.kind === 'preflight_loading' ||
        // Errors stay visible until the user explicitly retries; the
        // silent poll must not race the error copy off the screen.
        current.kind === 'error';
      if (funded || settling) return;
      void runPreflight({ silent: true });
    };
    const interval = window.setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [walletAccountId, nonceRequired, runPreflight]);

  return (
    <div className="flex w-full flex-col gap-3.5 rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_srgb,var(--ink-0)_4%,transparent)] px-6 py-4 text-left">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <StepBadge n={2} />
          <span className="text-[14px] font-semibold leading-none text-[var(--ink-0)]">
            Set up trading
          </span>
        </div>
        {stage.kind === 'done' ? (
          <span className="flex items-center gap-1.5 text-[12px] font-medium leading-none text-[var(--up)]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--up)]" />
            Ready
          </span>
        ) : (
          // Deliberately quiet: this states a fact, not a blocker. The
          // accent is reserved for things the user can actually press.
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--hairline-2)] px-2.5 py-0.5 text-[12px] font-medium leading-none text-[var(--ink-3)]">
            <svg
              aria-hidden
              className="h-3 w-3 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
            Unlocks trading
          </span>
        )}
      </div>

      <SetupBody
        stage={stage}
        targetCount={targetCount}
        solPriceUsd={solPriceUsd}
        onConfirm={() => void runLive()}
        onRetry={() => void runPreflight()}
        onRetryLive={() => void runLive()}
      />
    </div>
  );
}

function SetupBody({
  stage,
  targetCount,
  solPriceUsd,
  onConfirm,
  onRetry,
  onRetryLive,
}: {
  stage: SetupStage;
  targetCount: number;
  solPriceUsd: number | null;
  onConfirm: () => void;
  onRetry: () => void;
  onRetryLive: () => void;
}): React.ReactElement {
  if (stage.kind === 'done') {
    return (
      <p className="m-0 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
        Your wallet is set up for fast, reliable execution and ready to trade.
      </p>
    );
  }

  if (stage.kind === 'executing') {
    // Visible motion while the 10-20s on-chain setup runs so the step
    // never reads as frozen.
    return (
      <p className="m-0 flex items-center gap-2.5 text-[13.5px] leading-relaxed text-[var(--ink-1)]">
        <span
          aria-hidden
          className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--hairline-2)] border-t-[var(--accent-primary)]"
        />
        <span>
          Setting up your wallet…
          <span className="ml-1 text-[var(--ink-3)]">This usually takes a few seconds.</span>
        </span>
      </p>
    );
  }

  if (stage.kind === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13.5px] leading-relaxed text-[var(--down)]">{stage.copy}</p>
        {stage.retryable ? <PrimaryButton onClick={onRetry}>Retry</PrimaryButton> : null}
      </div>
    );
  }

  if (stage.kind === 'partial') {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13.5px] leading-relaxed text-[var(--down)]">
          {stage.createdCount} of {stage.targetCount} accounts created. Retry to finish.
        </p>
        <PrimaryButton onClick={onRetryLive}>Retry</PrimaryButton>
      </div>
    );
  }

  // idle / preflight_loading / preflight_ready all show the explainer.
  // Until the preflight confirms a fundable balance the CTA slot holds a
  // "Waiting for your deposit" bar instead of a disabled button — a
  // pending state, not a barricade — and the live button appears the
  // moment the balance covers the cost.
  const preflight = stage.kind === 'preflight_ready' ? stage.preflight : null;
  const ready = preflight !== null;
  const sufficient = preflight?.sufficient ?? false;

  // Cost: real preflight value when we have it, otherwise an estimate
  // from the per-nonce rent so the SOL + USD figure always renders.
  const costLamports = preflight
    ? preflight.estimated_cost_lamports
    : targetCount * NONCE_RENT_LAMPORTS_PER_ACCOUNT;
  const costSolLabel = formatSolFromLamports(costLamports);
  const costUsd = solPriceUsd !== null ? formatUsd((costLamports / 1e9) * solPriceUsd) : null;
  const shortfallLamports = preflight
    ? Math.max(0, preflight.estimated_cost_lamports - preflight.wallet_balance_lamports)
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
        Trading runs through nonce accounts for fast, reliable execution, so it takes a
        one-time on-chain setup. It costs about{' '}
        <span className="font-semibold text-[var(--ink-0)]">{costSolLabel} SOL</span>
        {costUsd ? <span className="text-[var(--ink-1)]"> ({costUsd})</span> : null}, paid from
        your wallet — none of it goes to Listen.
      </p>

      {sufficient ? (
        <PrimaryButton onClick={onConfirm}>Set up trading</PrimaryButton>
      ) : (
        <>
          <div className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--hairline)] bg-[var(--input-bg)] px-6 py-3 text-[14px] font-semibold text-[var(--ink-1)]">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent-secondary)]"
            />
            Waiting for your deposit
          </div>
          <p className="m-0 text-center text-[12.5px] text-[var(--ink-3)]">
            {ready
              ? `We check the address every few seconds — setup takes one tap once ${formatSolFromLamports(shortfallLamports)} more SOL lands.`
              : 'We check the address every few seconds — setup takes one tap once your deposit lands.'}
          </p>
        </>
      )}
    </div>
  );
}

function PrimaryButton({
  onClick,
  children,
  disabled = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl bg-[linear-gradient(135deg,var(--accent-primary),var(--accent-secondary))] px-6 py-3 text-center text-[14px] font-semibold text-[var(--accent-ink)] shadow-[0_8px_24px_-12px_var(--accent-primary)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      {children}
    </button>
  );
}
