'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useDrag } from 'react-dnd';
import { toast } from 'sonner';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import type { MeWalletEntry } from '@/lib/api/me';
import { walletDisplayName } from '@/components/listen/WalletSelector';
import { patchWallet } from '@/lib/api/wallets';
import { Bolt, Copy, ExternalLink, Key, Settings, Solana, Star, Trash } from '@/components/listen/icons/Icons';
import { flashWalletFromEntry, isFlashOn } from '@/components/flash/flash-state';
import { openFlash } from '@/lib/state/flash-store';
import { WALLET_DND_TYPE, type WalletDndItem, type WalletDndOrigin } from './dnd';
import { WALLETS_GRID_TEMPLATE } from './tableLayout';
import { AgentBadge } from './AgentBadge';
import type { DelegationChip, DelegationTone } from './agentWallet';

/**
 * Slice "Portfolio page wallets tab": single wallet row in the
 * left-side table. Mirrors Axiom's structure:
 *
 *   [color swatch + name + short pubkey + inline external-link]
 *   [≡ <SOL balance>]
 *   [<enable switch> <holdings count>]
 *   [hover-only action icons: Star · Copy · Trash]
 *
 * The colored swatch IS the selection affordance — clicking it
 * toggles the wallet in `useSelectedWalletStore`. The whole row is
 * still a react-dnd drag source so the user can drop into Source /
 * Destination on the TransferRail.
 */

export interface WalletRowProps {
  readonly wallet: MeWalletEntry;
  readonly selected: boolean;
  readonly onToggleSelect: (walletAccountId: string) => void;
  readonly balanceLamports: string | null;
  readonly holdingsCount: number | null;
  /** When set, renders a remove (trash) icon as the only action. Used in TransferRail. */
  readonly onRemove?: () => void;
  /** When set, hides the Star pin action. Useful for compact rail rows. */
  readonly hidePin?: boolean;
  /**
   * When provided, renders a Key (Export Private Key) IconButton in
   * the action cluster that fires this callback with the wallet's
   * account id. The parent is responsible for opening the secure
   * recovery-key modal (`WalletRecoveryKeyPanel`).
   */
  readonly onExportKey?: (walletAccountId: string) => void;
  /**
   * Where this row lives. Stamped onto the react-dnd payload so drop
   * targets can distinguish main-list, From-Wallet, and To-Wallet
   * originated drags and apply the right add/move/no-op behaviour.
   * Defaults to 'main'.
   */
  readonly origin?: WalletDndOrigin;
  /**
   * Slice "Per-wallet nonce setup": when provided AND the wallet is
   * not `trade_ready`, renders a clickable "needs setup" pill next to
   * the name that fires this with the wallet's account id. The parent
   * opens the `WalletSetupModal` (same nonce-setup flow as
   * onboarding, wallet-scoped).
   */
  readonly onSetup?: (walletAccountId: string) => void;
  /**
   * Slice "Agent wallet in Portfolio → Wallets": when set, this row IS
   * the agent wallet and renders its distinguished variant — an AGENT
   * badge, the delegation-state chip, and a Manage action in place of
   * the per-wallet controls that do not apply to it.
   *
   * Three controls are suppressed rather than merely hidden, because
   * each would issue a WRONG write against an agent wallet:
   *   - the enable switch (`patchWallet`) — agent enablement is owned by
   *     the grant / revoke ceremony, not this toggle;
   *   - Make primary — primary is a USER-wallet role (cashback and
   *     referral payouts), and the api's wallet listing excludes agent
   *     wallets from it entirely;
   *   - Export private key — the agent wallet's key material is not
   *     user-exportable.
   */
  readonly agent?: AgentRowDecoration;
}

export interface AgentRowDecoration {
  /**
   * Pre-derived chip (see `delegationChip`); the row never re-derives
   * it. `null` while the agent-wallet status read has not landed yet —
   * the row itself comes from `/me.wallets` and no longer waits on it.
   */
  readonly delegation: DelegationChip | null;
  /** Opens the agent-wallet management/setup modal. */
  readonly onManage?: (() => void) | undefined;
}

function shortPubkey(pubkey: string): string {
  if (pubkey.length <= 10) return pubkey;
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

export function formatSolBalance(lamports: string | null): string {
  if (lamports === null) return '0';
  try {
    const raw = BigInt(lamports);
    const sol = Number(raw) / 1_000_000_000;
    if (Number.isNaN(sol)) return '0';
    if (sol === 0) return '0';
    if (sol < 0.0001) return sol.toExponential(2);
    return sol.toFixed(4).replace(/\.?0+$/, '');
  } catch {
    return '0';
  }
}

export function WalletRow(props: WalletRowProps): React.ReactElement {
  const { wallet } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [hovered, setHovered] = useState(false);
  const origin: WalletDndOrigin = props.origin ?? 'main';

  const [{ isDragging }, dragRef] = useDrag<WalletDndItem, void, { isDragging: boolean }>(
    () => ({
      type: WALLET_DND_TYPE,
      item: {
        walletAccountId: wallet.wallet_account_id,
        label: walletDisplayName(wallet),
        walletPubkey: wallet.wallet_pubkey,
        origin,
      },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
      canDrag: () => !wallet.is_archived,
    }),
    [wallet.wallet_account_id, wallet.is_archived, origin],
  );

  useEffect(() => {
    if (ref.current) dragRef(ref.current);
  }, [dragRef]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.wallet_pubkey);
    } catch {
      // best-effort
    }
  };

  const onOpenExplorer = () => {
    if (typeof window === 'undefined') return;
    const url = `https://solscan.io/account/${encodeURIComponent(wallet.wallet_pubkey)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Star → primary. The api/ promotion is transactional under a per-user
  // advisory lock (demote singleton + promote, with archived/disabled/
  // inactive guards), and every primary consumer — cashback claims,
  // referral claims, provisioning fallback, selector defaults — resolves
  // `is_primary` at read time, so the swap propagates everywhere on the
  // /me refetch.
  const [makingPrimary, setMakingPrimary] = useState(false);
  const canMakePrimary =
    !wallet.is_primary && !wallet.is_archived && wallet.is_enabled && wallet.status === 'active';
  const onMakePrimary = async () => {
    if (!canMakePrimary || makingPrimary) return;
    setMakingPrimary(true);
    try {
      const token = await getToken();
      const result = await patchWallet(
        { walletAccountId: wallet.wallet_account_id, isPrimary: true },
        { authToken: token },
      );
      if (result.kind !== 'ok') {
        toast('Could not set primary wallet', {
          description:
            result.kind === 'error'
              ? result.message
              : result.kind === 'reauth'
                ? 'Session expired. Sign in again.'
                : 'Network error. Try again.',
        });
        return;
      }
      toast('Primary wallet updated', {
        description: `${walletDisplayName(wallet)} now receives cashback and referral claims.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
    } catch {
      toast('Could not set primary wallet', { description: 'Network error. Try again.' });
    } finally {
      setMakingPrimary(false);
    }
  };

  const showActions = hovered || props.selected;

  /*
   * THE WHOLE ROW IS THE CHECKBOX.
   *
   * The box on the left was the only thing that selected a wallet, which
   * is a 15px target on a row 40px tall and the width of the panel. The
   * row toggles now, and the box stays as the thing that SHOWS the
   * state. Every control inside the row already stops propagation, so
   * the star, the copy, the trash and the link still do their own jobs.
   *
   * Nothing is locked: none selected is a state the page is allowed to
   * be in, so the last one unselects like any other.
   */
  const onRowClick = () => {
    if (wallet.is_archived) return;
    props.onToggleSelect(wallet.wallet_account_id);
  };

  return (
    <div
      ref={ref}
      role="row"
      data-testid={`wallet-row-${wallet.wallet_account_id}`}
      onClick={onRowClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...rowStyle,
        opacity: isDragging ? 0.4 : 1,
        cursor: wallet.is_archived ? 'default' : 'grab',
        /* Selected is a white rule down the left and one step of lift —
           the language the docked panels and the tracker rows already
           use. It was an 8% accent wash under a 2px accent rule with the
           name turning accent too: three colour applications to say
           "this one", in a hue this page dropped everywhere else. */
        /* One step above the PANEL, not above black: the pane took its
           own ground at 5% white, which is exactly what selected used to
           be, so a selected row and the plate under it were the same
           value and the selection stopped reading. */
        background: props.selected
          ? 'rgba(255, 255, 255, 0.07)'
          : hovered
            ? 'rgba(255, 255, 255, 0.04)'
            : 'transparent',
        boxShadow: props.selected ? 'inset 2px 0 0 var(--ink-0)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleSelect(wallet.wallet_account_id);
          }}
          aria-pressed={props.selected}
          aria-label={`Select ${walletDisplayName(wallet)}`}
          title={props.selected ? 'Unselect wallet' : 'Select wallet'}
          /* A box that is empty or filled, rather than a coloured
             swatch that was 75% accent when OFF and 100% when on — two
             states of the same colour, which is not two states. */
          style={{
            ...swatchButtonStyle,
            background: props.selected ? 'var(--ink-0)' : 'transparent',
            border: props.selected
              ? '1px solid var(--ink-0)'
              : '1px solid color-mix(in srgb, var(--ink-0) 26%, transparent)',
            opacity: wallet.is_archived ? 0.45 : 1,
            cursor: 'pointer',
          }}
        />
        <span
          style={{
            fontSize: 13,
            color: 'var(--ink-0)',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {walletDisplayName(wallet)}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            fontFamily: 'var(--sans)',
            whiteSpace: 'nowrap',
          }}
        >
          {shortPubkey(wallet.wallet_pubkey)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenExplorer();
          }}
          title="Open on Solscan"
          aria-label="Open on Solscan"
          style={inlineIconButtonStyle}
        >
          <ExternalLink style={{ width: 11, height: 11 }} />
        </button>
        {props.agent ? (
          <>
            <AgentBadge />
            {/* The listing now comes from `/me.wallets` while the
                delegation enums still come from the agent-wallet status
                read, so the row can legitimately render one tick before
                the other lands. Omit the chip rather than guess a
                state — an absent chip is honest, a wrong one is not. */}
            {props.agent.delegation !== null ? (
              <span
                data-testid="agent-delegation-chip"
                title={props.agent.delegation.title}
                style={delegationChipStyle(props.agent.delegation.tone)}
              >
                {props.agent.delegation.label}
              </span>
            ) : null}
          </>
        ) : null}
        {wallet.is_archived ? (
          <span
            style={{
              marginLeft: 4,
              fontSize: 10,
              color: 'var(--ink-3)',
              border: '1px solid var(--hairline)',
              borderRadius: 999,
              padding: '0 6px',
            }}
          >
            archived
          </span>
        ) : null}
        {/* The pill keys on nonce provisioning specifically — NOT
            `trade_ready`, which also flips false when the user merely
            disables the wallet (the enable switch) or an authorization
            is mid-refresh. A provisioned-but-disabled wallet shows the
            off switch, not a bogus "needs setup". */}
        {!wallet.is_archived && wallet.nonce_setup.required && props.onSetup ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onSetup?.(wallet.wallet_account_id);
            }}
            title="Set up nonce accounts so this wallet can trade"
            aria-label={`Set up ${walletDisplayName(wallet)} for trading`}
            data-testid={`wallet-setup-pill-${wallet.wallet_account_id}`}
            style={{
              marginLeft: 4,
              fontSize: 10,
              color: 'var(--hold)',
              background: 'color-mix(in srgb, var(--hold) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--hold) 40%, transparent)',
              borderRadius: 999,
              padding: '0 6px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            needs setup
          </button>
        ) : null}
      </div>
      <div style={balanceCellStyle}>
        {/* 12, not 16. The mark was set ~1.15x the digits to cancel the
            whitespace inside its own viewBox, which is sound reasoning
            for a 14px figure — but the figure came down and the mark did
            not follow, so a unit symbol ended up the largest thing in
            the row and the balance it belongs to read as its caption. It
            compensates against the SMALLER figure now. */}
        <Solana style={{ width: 12, height: 12 }} />
        <span style={{ color: 'var(--ink-1)' }}>{formatSolBalance(props.balanceLamports)}</span>
      </div>
      <div style={holdingsCellStyle}>
        {props.agent ? (
          // No enable switch: `patchWallet` is the USER-wallet toggle and
          // the agent wallet's enablement follows its authorization, not
          // this control. A dash reads as "not applicable" rather than
          // offering a write that would be wrong.
          <span
            data-testid="agent-holdings-na"
            title="Managed by the agent-wallet authorization, not this toggle"
            style={{ color: 'var(--ink-3)' }}
          >
            —
          </span>
        ) : (
          /*
           * NO SWITCH. The row carried a sliding on/off track beside the
           * holdings count, which is a second selector on a row that
           * already has one: the box on the left says which wallets you
           * are working with, and two controls that both look like
           * "this one is on" is the row asking the same question twice.
           * A wallet that is off says so in words, where the state
           * belongs.
           */
          <>
            {wallet.is_enabled ? null : (
              <span data-testid="wallet-disabled" title="Disabled for trading" style={{ color: 'var(--ink-3)' }}>
                off
              </span>
            )}
            <span style={{ color: 'var(--ink-3)' }}>
              {props.holdingsCount === null ? '0' : props.holdingsCount.toLocaleString()}
            </span>
          </>
        )}
      </div>
      <div style={actionsClusterStyle}>
        {/* Flash is offered on every Solana wallet, the agent's included,
            and is ALWAYS visible rather than hover-gated — like Manage,
            a touch viewport never produces the hover that would reveal
            it. Suppressed on the compact rail rows (`onRemove`), whose
            only action is the removal itself. */}
        {props.onRemove || wallet.is_archived ? null : (
          <FlashAction wallet={wallet} isAgent={props.agent !== undefined} />
        )}
        {props.onRemove ? (
          <span style={hoverRevealStyle(showActions)}>
            <IconButton label="Remove" onClick={props.onRemove} icon={<Trash style={iconSize} />} />
          </span>
        ) : props.agent ? (
          // Manage is ALWAYS visible (not hover-gated): it is the only
          // route to funding, nonce provisioning, re-authorize and
          // revoke, so it must be discoverable without a hover — which
          // a touch viewport never produces.
          <>
            {props.agent.onManage ? (
              <IconButton
                label="Manage agent wallet"
                onClick={props.agent.onManage}
                icon={<Settings style={iconSize} />}
              />
            ) : null}
            <span style={hoverRevealStyle(showActions)}>
              <IconButton
                label="Copy funding address"
                onClick={() => void onCopy()}
                icon={<Copy style={iconSize} />}
              />
            </span>
          </>
        ) : (
          <>
            {props.hidePin ? null : wallet.is_primary ? (
              // The current primary's star is ALWAYS visible (not
              // hover-gated) — it's the row's primary indicator.
              <span
                title="Primary wallet — receives cashback and referral claims"
                aria-label="Primary wallet"
                data-testid={`wallet-primary-star-${wallet.wallet_account_id}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  color: 'var(--hold, #f3c709)',
                }}
              >
                <Star style={iconSize} fill="currentColor" />
              </span>
            ) : (
              <span style={hoverRevealStyle(showActions)}>
                <IconButton
                  label={
                    canMakePrimary
                      ? 'Make primary — cashback and referral claims will pay here'
                      : wallet.is_archived
                        ? 'Unarchive this wallet to make it primary'
                        : !wallet.is_enabled
                          ? 'Enable this wallet to make it primary'
                          : 'Wallet is not active'
                  }
                  onClick={() => void onMakePrimary()}
                  disabled={!canMakePrimary || makingPrimary}
                  icon={<Star style={iconSize} />}
                />
              </span>
            )}
            <span style={hoverRevealStyle(showActions)}>
              {props.onExportKey ? (
                <IconButton
                  label="Export Private Key"
                  onClick={() => props.onExportKey?.(wallet.wallet_account_id)}
                  icon={<Key style={iconSize} />}
                />
              ) : null}
              <IconButton label="Copy address" onClick={() => void onCopy()} icon={<Copy style={iconSize} />} />
            </span>
          </>
        )}
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: WALLETS_GRID_TEMPLATE,
  alignItems: 'center',
  gap: 12,
  padding: '6px 10px',
  fontSize: 13,
  userSelect: 'none',
  transition: 'background 120ms var(--ease, ease), box-shadow 120ms var(--ease, ease)',
};

const swatchButtonStyle: CSSProperties = {
  width: 13,
  height: 13,
  borderRadius: 3.5,
  padding: 0,
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background-color 130ms ease, border-color 130ms ease',
};

const inlineIconButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 2,
  color: 'var(--ink-3)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
};

const balanceCellStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 4,
  textAlign: 'right',
  /* Sans, like every other figure on this page. It was `--mono` here
     and on the holdings count beside it — the last two numbers in the
     portfolio still set in the printout face. */
  fontFamily: 'var(--sans)',
  /*
   * 11.5. At 13 with a 16px mark in front of it this was the loudest
   * column in a row whose SUBJECT is the wallet name two columns to the
   * left, so the eye landed on the balance first every time.
   *
   * It sits BELOW the holdings count beside it on purpose. The count is
   * one or two digits and the balance is five or six, and a longer
   * number at the same size still carries more weight — matching them
   * numerically would leave the balance louder than the thing it is
   * supposed to be quieter than.
   */
  fontSize: 11.5,
  fontVariantNumeric: 'tabular-nums',
};

const holdingsCellStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  textAlign: 'right',
  fontFamily: 'var(--sans)',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
};

/**
 * ── THE ONE SWITCH ON THE TAB ────────────────────────────────────────
 *
 * It was 26x14 with a 10px thumb travelling 12px. At that size the
 * difference between on and off is a shape you have to LOOK at rather
 * than one you see, and the travel is short enough that clicking it
 * reads as a flicker rather than as a thing moving.
 *
 * 32x18 with a 14px thumb. Same proportions, enough of them to register
 * down a column of three rows, and a 30px hit area in a 34px row.
 *
 * ── IT ACTUALLY SLIDES ───────────────────────────────────────────────
 *
 * The thumb moves on `transform`, not on `left`. `left` is a layout
 * property: the browser re-lays the button out every frame of the
 * animation, which is both the expensive way to do it and the one that
 * stutters. A transform is composited, so the travel is smooth.
 *
 * And it OVERSHOOTS slightly, on a curve that ends past 1 and settles
 * back. A linear 120ms slide is technically an animation and reads as a
 * redraw; the small bounce at the end is what makes a switch feel like
 * it was thrown rather than repainted.
 *
 * ── THE COLOUR IS WHITE ──────────────────────────────────────────────
 *
 * It went through `rgba(255,255,255,0.34)`, then arctic mint, then the
 * product's green, and white is the one that belongs here.
 *
 * Green is a MEANING on this page. `--up` is on every figure that went
 * up and `--down` on every figure that went down, and a wallet being
 * switched on is neither — borrowing the gain colour for a state that
 * has nothing to do with gains puts a third meaning on a hue that
 * already carries two. The row went green in a product where green is
 * how you read a number at a glance.
 *
 * White is what this tab already uses to say "this one is live": the
 * range that is selected, the tab that is open, the one filled control
 * on the strip. The switch now says it the same way everything else on
 * the page says it.
 *
 * Full white, not the 34% it started at — at a third, on against off
 * was two greys a few percent apart and you had to look twice at a
 * control whose whole job is to read in one glance down a column.
 *
 * The thumb goes BLACK on. A white thumb on a white track is nothing at
 * all; the page's own ground cut out of the fill is the crispest circle
 * available at this size.
 */

const SWITCH_W = 32;
const SWITCH_H = 18;
const THUMB = 14;

const actionsClusterStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 2,
};

const iconSize: CSSProperties = { width: 13, height: 13 };

/**
 * Delegation chip, styled off the same token trio the "needs setup"
 * pill and the archived pill already use, so the agent row reads as
 * part of this table rather than an import from another surface.
 */
function delegationChipStyle(tone: DelegationTone): CSSProperties {
  const color =
    tone === 'good' ? 'var(--up)' : tone === 'bad' ? 'var(--down)' : 'var(--hold)';
  return {
    marginLeft: 2,
    fontSize: 10,
    color,
    background: `color-mix(in srgb, ${color} 10%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
    borderRadius: 999,
    padding: '0 6px',
    whiteSpace: 'nowrap',
  };
}

/** Hover-gated wrapper for action icons; the primary star opts out. */
function hoverRevealStyle(visible: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
    transition: 'opacity 120ms var(--ease, ease)',
  };
}

/**
 * The Flash bolt. Accent while the wallet's lane pool is incomplete (the
 * upgrade is available), quiet ink once it is on — the same glyph either
 * way, because the modal it opens explains both.
 */
function FlashAction({
  wallet,
  isAgent,
}: {
  wallet: MeWalletEntry;
  isAgent: boolean;
}): React.ReactElement {
  const on = isFlashOn(flashWalletFromEntry(wallet, { isAgent }));
  return (
    <>
      {/*
       * The bolt CHARGES while flash is on: a slow build in brightness
       * and then one quick discharge, ten seconds apart, so a row that
       * is racing relays looks like it. Opacity only, so it composites
       * and costs no layout, and it holds still under reduced motion.
       */}
      <style>{BOLT_SHEET}</style>
      <IconButton
        label={on ? 'Flash is on' : 'Enable Flash'}
        color={on ? 'var(--ink-0)' : 'var(--ink-3)'}
        onClick={() => openFlash(wallet.wallet_account_id)}
        icon={<Bolt style={iconSize} className={on ? 'wr-bolt is-on' : 'wr-bolt'} />}
      />
    </>
  );
}

const BOLT_SHEET = `
.wr-bolt.is-on{ animation: wr-charge 10s ease-in-out infinite; }
@keyframes wr-charge {
  0%, 62% { opacity: .55; }
  /* the charge */
  82% { opacity: 1; }
  /* the strike, and back down */
  85% { opacity: .35; }
  88% { opacity: 1; }
  100% { opacity: .55; }
}
@media (prefers-reduced-motion: reduce) { .wr-bolt.is-on { animation: none; opacity: 1; } }
`;

function IconButton(props: {
  label: string;
  onClick: () => void;
  icon: React.ReactElement;
  disabled?: boolean;
  /** Resting tint; defaults to the cluster's quiet `--ink-3`. */
  color?: string;
}): React.ReactElement {
  const disabled = props.disabled === true;
  const restColor = props.color ?? 'var(--ink-3)';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) props.onClick();
      }}
      title={props.label}
      aria-label={props.label}
      style={{
        background: 'transparent',
        border: 'none',
        borderRadius: 6,
        width: 22,
        height: 22,
        padding: 0,
        color: restColor,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--chip-bg)';
        e.currentTarget.style.color = 'var(--ink-1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = restColor;
      }}
    >
      {props.icon}
    </button>
  );
}
