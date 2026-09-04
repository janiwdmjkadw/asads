'use client';

import { FlashBolt } from './FlashBolt';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Solana } from '@/components/listen/icons/Icons';
import { AGENT_WALLET_QUERY_KEY } from '@/components/agent-wallet/AgentWalletPanel';
import { setupAgentWalletNonces } from '@/components/agent-wallet/client';
import {
  setupNoncesRecoveringAuthorization,
  type NonceSetupResult,
} from '@/lib/api/wallet-nonce-setup';
import {
  activeLanesLabel,
  flashLanes,
  flashWalletName,
  formatSol,
  initialFlashState,
  isFlashOn,
  laneLabel,
  nextFlashState,
  shortPubkey,
  shouldFireEnable,
  FLASH_COPY,
  FLASH_ESTIMATED_SOL,
  type FlashState,
  type FlashWallet,
} from './flash-state';

/**
 * Flash — the one-time per-wallet lightning upgrade, as a white document
 * on the dark terminal. The white card is deliberate and has precedent:
 * the shipped `/welcome` onboarding uses the same treatment, so the
 * palette here is hardcoded rather than themed. Theme tokens would drag
 * it back into the terminal's dark surface and lose the document voice.
 *
 * Five states, one card: the offer, the ten seconds of enabling, the
 * top-up dead-end, the finished pool, and the partial retry. Enabling
 * blocks close — Esc, the overlay and the footer all — because five
 * sequential on-chain txs are mid-flight.
 */

const INK = '#0B0E14';
const BODY = '#3E4A47';
const MUTED = '#6B7674';
const FAINT = '#8A9591';
const TEAL = '#134E4A';
const PANEL = '#E8ECEA';
const WARN = '#B4482E';

const SANS = 'var(--font-geist-sans), Geist, -apple-system, system-ui, sans-serif';
const MONO = 'var(--font-geist-mono), Geist Mono, ui-monospace, monospace';

/** While the pool fills, re-read the wallet's lane count this often. */
const LANE_POLL_MS = 1_500;

export interface FlashModalProps {
  /** The wallet Flash is being offered for; `null` = closed. */
  readonly wallet: FlashWallet | null;
  readonly onClose: () => void;
  /** Opens the deposit surface for this wallet (needs-balance state). */
  readonly onDeposit?: ((wallet: FlashWallet) => void) | undefined;
}

export function FlashModal(props: FlashModalProps): React.ReactElement | null {
  const { wallet } = props;
  if (wallet === null) return null;
  return (
    // Keyed by wallet so preflight/cost/error state can never leak from
    // one wallet's card into the next.
    <FlashDialog key={wallet.walletAccountId} {...props} wallet={wallet} />
  );
}

function FlashDialog({
  wallet,
  onClose,
  onDeposit,
}: FlashModalProps & { wallet: FlashWallet }): React.ReactElement {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<FlashState>(() => initialFlashState(wallet));
  // Mirrors `state` for the single-flight guard: without it a same-frame
  // double-click fires two live setups, and the second one waits out the
  // server's advisory lock for an idempotent no-op.
  const stateRef = useRef(state);
  stateRef.current = state;
  const costRef = useRef<number | null>(null);
  if (state.kind === 'offer' && state.costLamports !== null) costRef.current = state.costLamports;

  const lanes = flashLanes(wallet);
  const running = state.kind === 'enabling';

  const runSetup = useCallback(
    async (dryRun: boolean): Promise<NonceSetupResult> => {
      // The agent wallet provisions through its own route — it is not in
      // `/me`, and the wallet-scoped route filters `purpose = 'user'`.
      if (wallet.isAgent) return setupAgentWalletNonces({ dryRun });
      return setupNoncesRecoveringAuthorization({
        dryRun,
        authToken: await getToken(),
        walletAccountId: wallet.walletAccountId,
      });
    },
    [getToken, wallet.isAgent, wallet.walletAccountId],
  );

  const refreshLanes = useCallback(() => {
    const key = wallet.isAgent ? AGENT_WALLET_QUERY_KEY : ['api', 'v1', 'me'];
    void queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, wallet.isAgent]);

  // Open → preflight, so the price row shows this wallet's real cost
  // rather than the placeholder. Skipped when the pool is already full.
  useEffect(() => {
    if (isFlashOn(wallet)) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await runSetup(true);
        if (cancelled) return;
        setState(nextFlashState(result, { costLamports: costRef.current }));
      } catch {
        if (cancelled) return;
        setState({
          kind: 'offer',
          costLamports: costRef.current,
          notice: 'Network error. Check your connection and try again.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per wallet — the component is keyed by wallet id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live lane count while the pool fills: the bars read the wallet's own
  // `active_count`, refreshed from the source the caller already
  // observes, so the panel counts real confirmations rather than a timer.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(refreshLanes, LANE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, refreshLanes]);

  const enable = useCallback(() => {
    if (!shouldFireEnable(stateRef.current)) return;
    stateRef.current = { kind: 'enabling' };
    setState({ kind: 'enabling' });
    void (async () => {
      let next: FlashState;
      try {
        next = nextFlashState(await runSetup(false), { costLamports: costRef.current });
      } catch {
        next = {
          kind: 'offer',
          costLamports: costRef.current,
          notice: 'Network error. Check your connection and try again.',
        };
      }
      stateRef.current = next;
      setState(next);
      refreshLanes();
    })();
  }, [runSetup, refreshLanes]);

  const title =
    state.kind === 'on'
      ? FLASH_COPY.onTitle
      : state.kind === 'enabling' || state.kind === 'partial'
        ? FLASH_COPY.enablingTitle
        : state.kind === 'needs_balance'
          ? FLASH_COPY.needsBalanceTitle
          : FLASH_COPY.offerTitle;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !running) onClose();
      }}
    >
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        data-testid="flash-modal"
        className="flash-dialog grid-cols-1 gap-0 border-0 p-0 sm:rounded-[12px]"
        onEscapeKeyDown={(e) => {
          if (running) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (running) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (running) e.preventDefault();
        }}
        style={{
          width: 'min(640px, calc(100vw - 24px))',
          maxWidth: 'min(640px, calc(100vw - 24px))',
          background: '#FFFFFF',
          borderRadius: 12,
          color: INK,
          fontFamily: SANS,
          position: 'fixed',
          boxShadow: 'var(--shadow-modal, 0 24px 60px rgba(0,0,0,0.45))',
        }}
      >
        {/*
         * The phone rules. Everything here was fixed px sized for a
         * 640px dialog: 52px of side padding on a 351px screen is a
         * third of the width, a 42px title wrapped to three lines, and
         * the 110px bolt sat on top of it.
         */}
        <style>{DIALOG_SHEET}</style>
        {/* Inlined, so it draws itself in and strikes. As an <img> the
            only animatable thing was the box round it. */}
        <FlashBolt
          size={110}
          weight={1.2}
          className="flash-bolt"
          style={{ position: 'absolute', right: 42, top: 24, pointerEvents: 'none' }}
        />
        <DialogTitle
          data-testid="flash-title"
          className="p-0"
          style={{
            fontFamily: MONO,
            fontSize: 'var(--flash-title, 42px)',
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            fontWeight: 500,
            color: INK,
            margin: 0,
          }}
        >
          {title}
        </DialogTitle>

        {state.kind === 'loading' || state.kind === 'offer' ? (
          <FlashOfferBody
            wallet={wallet}
            costLamports={state.kind === 'offer' ? state.costLamports : null}
            notice={state.kind === 'offer' ? state.notice : null}
            onEnable={enable}
            onClose={onClose}
          />
        ) : null}

        {state.kind === 'enabling' || state.kind === 'partial' ? (
          <FlashEnablingBody
            active={lanes.active}
            target={lanes.target}
            partial={state.kind === 'partial'}
            onRetry={enable}
          />
        ) : null}

        {state.kind === 'needs_balance' ? (
          <FlashNeedsBalanceBody
            requiredLamports={state.requiredLamports}
            balanceLamports={state.balanceLamports}
            onDeposit={onDeposit ? () => onDeposit(wallet) : undefined}
          />
        ) : null}

        {state.kind === 'on' ? <FlashOnBody target={lanes.target} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

// ───────── states ─────────

export function FlashOfferBody({
  wallet,
  costLamports,
  notice,
  onEnable,
  onClose,
}: {
  wallet: FlashWallet;
  costLamports: number | null;
  notice: string | null;
  onEnable: () => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div data-testid="flash-offer">
      <p style={{ ...bodyTextStyle, maxWidth: 424, marginTop: 16 }}>{FLASH_COPY.offerPitch}</p>

      <div
        data-testid="flash-wallet-chip"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          border: `1px solid ${PANEL}`,
          borderRadius: 6,
          padding: '12px 16px',
          marginTop: 24,
          fontFamily: MONO,
        }}
      >
        <span style={{ fontSize: 10, letterSpacing: '0.1em', color: FAINT }}>
          {FLASH_COPY.forLabel}
        </span>
        <span style={{ fontSize: 12, color: INK }}>{flashWalletName(wallet)}</span>
        <span style={{ fontSize: 12, color: FAINT }}>{shortPubkey(wallet.pubkey)}</span>
      </div>

      <ul
        style={{
          listStyle: 'none',
          margin: '24px 0 0',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 13,
        }}
      >
        {FLASH_COPY.benefits.map((benefit) => (
          <li key={benefit} style={{ fontSize: 14, lineHeight: 1.6, color: INK }}>
            {benefit}
          </li>
        ))}
      </ul>

      <hr style={{ border: 'none', borderTop: `1px solid ${PANEL}`, margin: '26px 0 22px' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        {/* The Solana mark IS the unit — spelling out "SOL" beside it
            would say the same thing twice. */}
        <span data-testid="flash-price" style={{ fontFamily: MONO, fontSize: 28, color: INK }}>
          ~{costLamports === null ? FLASH_ESTIMATED_SOL : formatSol(costLamports)}
        </span>
        <Solana style={{ width: 22, height: 22, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: FAINT }}>{FLASH_COPY.priceCaption}</span>
      </div>

      {notice ? (
        <p data-testid="flash-notice" style={{ ...bodyTextStyle, color: WARN, marginTop: 14 }}>
          {notice}
        </p>
      ) : null}

      <div
        className="flash-foot"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 30,
        }}
      >
        <button
          type="button"
          data-testid="flash-maybe-later"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 12,
            color: BODY,
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          {FLASH_COPY.maybeLater}
        </button>
        <button
          type="button"
          data-testid="flash-enable"
          onClick={onEnable}
          style={primaryButtonStyle}
        >
          {FLASH_COPY.enableCta}
        </button>
      </div>
    </div>
  );
}

export function FlashEnablingBody({
  active,
  target,
  partial,
  onRetry,
}: {
  active: number;
  target: number;
  partial: boolean;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div data-testid={partial ? 'flash-partial' : 'flash-enabling'}>
      <p style={{ ...bodyTextStyle, maxWidth: 424, marginTop: 16 }}>
        {partial ? FLASH_COPY.partialBody : FLASH_COPY.enablingBody}
      </p>

      <div style={{ background: PANEL, borderRadius: 6, padding: 22, marginTop: 26 }}>
        <div data-testid="flash-lane-label" style={{ fontFamily: MONO, fontSize: 12, color: INK }}>
          {laneLabel({ active, target })}
        </div>
        <LaneBars active={active} target={target} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 30 }}>
        {partial ? (
          <button
            type="button"
            data-testid="flash-retry"
            onClick={onRetry}
            style={primaryButtonStyle}
          >
            {FLASH_COPY.partialCta}
          </button>
        ) : (
          <button type="button" data-testid="flash-enabling-cta" disabled style={disabledButtonStyle}>
            {FLASH_COPY.enablingCta}
          </button>
        )}
      </div>
    </div>
  );
}

export function FlashNeedsBalanceBody({
  requiredLamports,
  balanceLamports,
  onDeposit,
}: {
  requiredLamports: number;
  balanceLamports: number;
  onDeposit?: (() => void) | undefined;
}): React.ReactElement {
  const shortLamports = Math.max(0, requiredLamports - balanceLamports);
  return (
    <div data-testid="flash-needs-balance">
      <p style={{ ...bodyTextStyle, maxWidth: 424, marginTop: 16 }}>
        {FLASH_COPY.needsBalanceBody}
      </p>

      <div
        style={{
          background: PANEL,
          borderRadius: 6,
          padding: 22,
          marginTop: 26,
          fontFamily: MONO,
          fontSize: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <LedgerRow label="NEEDED" value={formatSol(requiredLamports)} />
        <LedgerRow label="BALANCE" value={formatSol(balanceLamports)} />
        <LedgerRow label="SHORT" value={formatSol(shortLamports)} tone={WARN} />
      </div>

      <div
        className="flash-foot"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 30,
        }}
      >
        <button
          type="button"
          data-testid="flash-deposit"
          onClick={onDeposit}
          disabled={onDeposit === undefined}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 12,
            color: BODY,
            textDecoration: 'underline',
            cursor: onDeposit === undefined ? 'default' : 'pointer',
          }}
        >
          {FLASH_COPY.depositCta}
        </button>
        <button type="button" data-testid="flash-enable" disabled style={disabledButtonStyle}>
          {FLASH_COPY.enableCta}
        </button>
      </div>
    </div>
  );
}

export function FlashOnBody({ target, onClose }: { target: number; onClose: () => void }): React.ReactElement {
  return (
    <div data-testid="flash-on">
      <p style={{ ...bodyTextStyle, maxWidth: 424, marginTop: 16 }}>{FLASH_COPY.onBody}</p>

      <div style={{ background: PANEL, borderRadius: 6, padding: 22, marginTop: 26 }}>
        <div style={{ fontFamily: MONO, fontSize: 12, color: TEAL }}>
          {activeLanesLabel({ active: target, target })}
        </div>
        <LaneBars active={target} target={target} />
      </div>

      <div
        className="flash-foot"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 30,
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 11, color: FAINT }}>{FLASH_COPY.onFooter}</span>
        <button type="button" data-testid="flash-done" onClick={onClose} style={primaryButtonStyle}>
          {FLASH_COPY.onCta}
        </button>
      </div>
    </div>
  );
}

// ───────── parts ─────────

function LaneBars({ active, target }: { active: number; target: number }): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 14 }} data-testid="flash-lane-bars">
      {Array.from({ length: target }, (_, i) => (
        <span
          key={i}
          aria-hidden
          data-lane-done={i < active ? 'true' : 'false'}
          style={{
            width: 92,
            maxWidth: '100%',
            height: 8,
            borderRadius: 3,
            flexShrink: 1,
            background: i < active ? TEAL : '#FFFFFF',
          }}
        />
      ))}
    </div>
  );
}

function LedgerRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 8, color: tone ?? MUTED }}>
      <span>{label}</span>
      <span style={{ color: tone ?? INK }}>{value} SOL</span>
    </div>
  );
}

const bodyTextStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: BODY,
  margin: 0,
};

/*
 * 15px type in 15/32 padding made a 54px slab wider than the panel it
 * sat in was tall. A dialog's confirm is a button, not a billboard: the
 * dialog is already the emphasis.
 */
const DIALOG_SHEET = `
.flash-dialog{ padding:44px 52px 40px; --flash-title:42px; }
@media (max-width: 560px){
  .flash-dialog{ padding:26px 20px 24px; border-radius:14px; }
  .flash-dialog{ --flash-title:26px; }
  /* The bolt goes to a corner mark rather than a picture the title has
     to flow around. */
  .flash-bolt{ width:56px !important; right:16px !important; top:14px !important; }
  .flash-dialog p{ max-width:none !important; }
  /* The ledger and lane panels lose the padding of a desktop card. */
  .flash-dialog [data-testid='flash-on'] > div,
  .flash-dialog [data-testid='flash-offer'] > div{ padding:16px !important; margin-top:18px !important; }
  /* Footer rows stack: a link and a button side by side at 351px put
     the button half off the edge. */
  .flash-foot{ flex-direction:column; align-items:stretch !important; gap:12px; margin-top:22px !important; }
  .flash-foot button{ width:100%; }
}
`;

const primaryButtonStyle: React.CSSProperties = {
  background: INK,
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 6,
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1.2,
  cursor: 'pointer',
};

const disabledButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: PANEL,
  color: FAINT,
  cursor: 'default',
};
