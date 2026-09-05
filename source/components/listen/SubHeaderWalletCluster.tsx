'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@clerk/nextjs';
import { useMe } from '@/lib/api/me';
import {
  isEligibleWallet,
  pickDefaultSelectedWallet,
  useSelectedWalletStore,
} from '@/lib/state/selected-wallet-store';
import { groupsFromResult, useWalletGroups } from '@/lib/state/wallet-groups-store';
import type { WalletGroup } from '@/lib/api/wallet-groups';
import { MultiWalletSelector } from './MultiWalletSelector';
import {
  formatLamportsBigInt,
  formatUsdcMicroBigInt,
  useMultiWalletSolBalance,
} from './useMultiWalletSolBalance';
import { Bookmark, Chevron, Folder, Settings, Solana, Wallet } from './icons/Icons';
import { BlacklistsModal } from '@/components/discover/BlacklistsModal';
import { HiddenTokensMenu } from '@/components/discover/HiddenTokensMenu';
import { useBlacklistStore } from '@/lib/state/blacklist-store';
import { Numeral } from './primitives';
import { pageZoom } from '@/lib/page-zoom';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { TradingSettingsModal } from '@/components/settings/TradingSettingsModal';
import './groups-popover-v2.css';
import './wallets-popover-v2.css';

/**
 * Right-side cluster of the AppSubHeader: a trading-settings cog, a
 * wallet-group selector chip and a wallet selector chip that mirrors the
 * GLOBAL trading selection (`multiSelectedWalletAccountIds`) and shows the
 * aggregate SOL / USDC balance of the selected set.
 *
 *   [cog]  [folder] Group name ⌄   [wallet] 3 | ◎ 5.111 | $ 12.40 ⌄
 *
 * Behavior:
 *   - The cog opens the global Trading Settings modal. It lives here —
 *     once, app-wide — rather than in each Discover section header, which
 *     is where it used to be repeated per row (New Pairs / Ripening /
 *     Graduated). The settings it edits are global, so one entry point
 *     next to the wallet selection is where they belong.
 *   - The wallet chip opens the same `MultiWalletSelector` checkbox
 *     list the trade page uses, so changing wallets here changes them
 *     everywhere (quick-buys, trade panel, batch routing).
 *   - The group chip lists the user's server-persisted wallet groups;
 *     picking one replaces the selection with that group's eligible
 *     members. "All wallets" selects every eligible wallet. The chip
 *     lights up with the group name when the current selection exactly
 *     matches a group.
 *   - Renders nothing while signed out / before `/me` resolves, so the
 *     strip stays clean and never shifts layout (the sub-header has a
 *     fixed `--h-subnav` height regardless).
 *
 * Popover mechanics (portal to `.listen-root`, fixed anchor that
 * follows the trigger on scroll/resize, Escape + click-outside close)
 * mirror `trade/WalletCountButton` — see that file for the stacking
 * and theme-scope rationale.
 */

const POPOVER_GAP = 6;
/*
 * 10, and it is also the width the popover subtracts.
 *
 * `computeAnchor` clamps the LEFT edge to this, but the popover's width
 * is a fixed number handed in by each caller — 224 for groups, 320 for
 * wallets — so on a narrow screen the left edge stayed inside and the
 * right edge ran off the side. Both the clamp and the width have to
 * respect the same margin; the width is capped in CSS beside it.
 */
const VIEWPORT_PADDING = 10;

// Mirrors the api/ batch-orders cap (see trade/WalletCountButton).
function batchMaxWallets(): number {
  return Math.min(100, Math.max(1, Math.floor(getRuntimeConfig().batchOrdersMaxWallets)));
}

function setEquals(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function SubHeaderWalletCluster(): React.ReactElement | null {
  const { isSignedIn } = useAuth();
  const { data: me } = useMe({ enabled: isSignedIn === true });
  const [openPanel, setOpenPanel] = useState<'group' | 'wallets' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [blacklistsOpen, setBlacklistsOpen] = useState(false);

  const eligible = useMemo(
    () => (me && !me.reauth_required ? me.wallets.filter(isEligibleWallet) : []),
    [me],
  );

  if (isSignedIn !== true || !me || me.reauth_required || eligible.length === 0) {
    return null;
  }

  return (
    <div data-subheader-cluster="" className="flex items-center gap-1.5 shrink-0">
      {/* Single modal root for the whole app — the cog is its only trigger. */}
      <TradingSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      {/*
       * The two board controls come FIRST, left of the cog.
       *
       * They are about what the board shows; the cog, the group and the
       * wallet chip are about what a trade does. Reading order follows
       * that split rather than the order they were built in.
       */}
      <HiddenTokensMenu />
      <BlacklistsModal open={blacklistsOpen} onOpenChange={setBlacklistsOpen} />
      <BlacklistsButton onClick={() => setBlacklistsOpen(true)} />
      <TradingSettingsButton onClick={() => setSettingsOpen(true)} />
      <GroupChip
        eligibleIds={eligible.map((w) => w.wallet_account_id)}
        fallbackPrimaryId={pickDefaultSelectedWallet(eligible)?.wallet_account_id ?? null}
        open={openPanel === 'group'}
        onToggle={() => setOpenPanel((p) => (p === 'group' ? null : 'group'))}
        onClose={() => setOpenPanel(null)}
      />
      <WalletChip
        open={openPanel === 'wallets'}
        onToggle={() => setOpenPanel((p) => (p === 'wallets' ? null : 'wallets'))}
        onClose={() => setOpenPanel(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Blacklists                                                          */
/* ------------------------------------------------------------------ */

/**
 * Bookmark that opens the three blacklists. Same 22px pill as the cog,
 * and it carries a dot when any list has something in it — a control
 * that is quietly filtering the board should say so without being
 * opened.
 */
function BlacklistsButton(props: { readonly onClick: () => void }): React.ReactElement {
  const devs = useBlacklistStore((s) => s.devs);
  const handles = useBlacklistStore((s) => s.handles);
  const active = devs.length > 0 || handles.length > 0;
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={active ? `Blacklists, ${devs.length + handles.length} entries` : 'Blacklists'}
      title="Blacklists"
      data-testid="subheader-blacklists"
      className="relative inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-colors hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      style={{
        color: active ? 'var(--ink-0)' : 'var(--ink-2)',
        background: 'var(--input-bg)',
        border: '1px solid var(--input-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        cursor: 'pointer',
      }}
    >
      <Bookmark style={{ width: 12, height: 12, display: 'block' }} />
      {active ? (
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{ top: 1, right: 1, width: 4, height: 4, background: '#ffffff' }}
        />
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Trading settings                                                    */
/* ------------------------------------------------------------------ */

/** Cog that opens the global Trading Settings modal. Sized and skinned to
 *  match the chips beside it (22px pill, same input surface + hairline). */
function TradingSettingsButton(props: { readonly onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label="Trading settings"
      title="Trading settings"
      data-testid="subheader-trading-settings"
      className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-colors hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      style={{
        color: 'var(--ink-2)',
        background: 'var(--input-bg)',
        border: '1px solid var(--input-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        cursor: 'pointer',
      }}
    >
      <Settings style={{ width: 12, height: 12, display: 'block' }} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Group selector                                                      */
/* ------------------------------------------------------------------ */

function GroupChip(props: {
  readonly eligibleIds: ReadonlyArray<string>;
  readonly fallbackPrimaryId: string | null;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const groupsQuery = useWalletGroups();
  const groups = groupsFromResult(groupsQuery.data);
  const selectedIds = useSelectedWalletStore((s) => s.multiSelectedWalletAccountIds);
  const setMultiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.setMultiSelectedWalletAccountIds,
  );

  const eligibleSet = useMemo(() => new Set(props.eligibleIds), [props.eligibleIds]);
  // A group's *effective* members are the ones still eligible — archived
  // or disabled wallets are ignored for both matching and applying.
  const effectiveMembers = (g: WalletGroup): string[] =>
    g.wallet_account_ids.filter((id) => eligibleSet.has(id));

  const activeGroup =
    groups.find((g) => {
      const members = effectiveMembers(g);
      return members.length > 0 && setEquals(members, selectedIds);
    }) ?? null;
  const allSelected = setEquals(props.eligibleIds, selectedIds);

  const apply = (ids: ReadonlyArray<string>) => {
    setMultiSelectedWalletAccountIds(ids, props.fallbackPrimaryId);
    props.onClose();
  };

  const label = activeGroup ? activeGroup.name : allSelected ? 'All wallets' : 'Groups';
  const lit = activeGroup !== null;

  return (
    <ChipPopover
      open={props.open}
      onToggle={props.onToggle}
      onClose={props.onClose}
      width={224}
      triggerAriaLabel={`Wallet group: ${label}. Click to pick a group.`}
      triggerTestId="subheader-group-chip"
      popoverAriaLabel="Select a wallet group"
      trigger={
        <>
          <Folder
            style={{
              width: 12,
              height: 12,
              color: lit ? 'var(--accent-primary)' : 'var(--ink-3)',
              flexShrink: 0,
            }}
          />
          <span
            className="max-w-[110px] truncate text-[11px]"
            style={{ color: lit ? 'var(--ink-0)' : 'var(--ink-2)', fontWeight: 500 }}
          >
            {label}
          </span>
          <Chevron
            style={{
              width: 10,
              height: 10,
              color: 'var(--ink-3)',
              flexShrink: 0,
              transform: props.open ? 'rotate(180deg)' : 'none',
              transition: 'transform 120ms var(--ease, ease)',
            }}
          />
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <GroupRowButton
          label="All wallets"
          count={props.eligibleIds.length}
          active={activeGroup === null && allSelected}
          onClick={() => apply(props.eligibleIds)}
          testId="subheader-group-all"
        />
        {groups.map((g) => {
          const members = effectiveMembers(g);
          return (
            <GroupRowButton
              key={g.id}
              label={g.name}
              count={members.length}
              active={activeGroup?.id === g.id}
              disabled={members.length === 0}
              onClick={() => apply(members)}
              testId={`subheader-group-${g.id}`}
            />
          );
        })}
        {groups.length === 0 ? (
          <div
            style={{
              padding: '8px 10px',
              color: 'var(--ink-3)',
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            No groups yet. Create them in Portfolio, under Wallets.
          </div>
        ) : null}
      </div>
    </ChipPopover>
  );
}

function GroupRowButton(props: {
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly testId: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={props.testId}
      onClick={props.onClick}
      disabled={props.disabled === true}
      title={props.disabled === true ? 'No eligible wallets in this group' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '7px 10px',
        borderRadius: 8,
        /* Longhands, not `border` plus `borderColor`. React warns when a
           shorthand and one of its parts are both set and one of them
           changes on a rerender, which this does every time the chip
           opens — and the warning is right that the result depends on
           property order rather than on intent. */
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: props.active
          ? 'color-mix(in srgb, var(--accent-primary) 35%, var(--hairline-2))'
          : 'transparent',
        background: props.active ? 'var(--accent-soft)' : 'transparent',
        color: props.disabled === true ? 'var(--ink-3)' : 'var(--ink-0)',
        opacity: props.disabled === true ? 0.55 : 1,
        cursor: props.disabled === true ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--sans)',
        fontSize: 12,
        textAlign: 'left',
      }}
    >
      <span className="truncate" style={{ minWidth: 0 }}>
        {props.label}
      </span>
      <span
        style={{
          color: 'var(--ink-3)',
          fontSize: 10.5,
          fontFamily: 'var(--mono)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        {props.count}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Wallet selector + balances                                          */
/* ------------------------------------------------------------------ */

function WalletChip(props: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const selectedIds = useSelectedWalletStore((s) => s.multiSelectedWalletAccountIds);
  const balances = useMultiWalletSolBalance(selectedIds);
  const ready = balances.status === 'ready';
  const sol = ready ? formatLamportsBigInt(balances.totalLamports) : '—';
  const usdc = ready ? formatUsdcMicroBigInt(balances.totalUsdcMicro) : '—';

  return (
    <ChipPopover
      open={props.open}
      onToggle={props.onToggle}
      onClose={props.onClose}
      width={320}
      triggerAriaLabel={`Wallets selected: ${selectedIds.length}. Aggregate balance ${sol} SOL, ${usdc} USDC. Click to change selection.`}
      triggerTestId="subheader-wallet-chip"
      popoverAriaLabel="Select wallets for trading"
      flush
      trigger={
        <>
          <Wallet style={{ width: 12, height: 12, color: 'var(--accent-primary)', flexShrink: 0 }} />
          <span data-testid="subheader-wallet-count" className="swc-fig inline-flex">
            <Numeral size="xs" tone="ink-0">
              {selectedIds.length}
            </Numeral>
          </span>
          <Divider />
          <span className="swc-fig inline-flex items-center gap-1">
            {/*
              13, TO MATCH THE WALLET PANEL THIS CHIP OPENS.

              It was 11, and the wallet's own SOL mark is 13, so the same
              logo appeared at two sizes two clicks apart and the smaller
              one read as a different, thinner mark rather than as the
              same one further away.
            */}
            <Solana style={{ width: 14, height: 14 }} />
            <Numeral size="xs" tone="ink-0">
              {sol}
            </Numeral>
          </span>
          {/*
           * NO USDC FIGURE ON THE CHIP.
           *
           * Three figures behind one caret made the trigger the widest
           * thing on the bar. SOL is the one that answers the question
           * the chip is there to answer — whether the selected wallets
           * can cover the next buy — because that is what a buy spends
           * unless the pair is quoted otherwise. The USDC total is still
           * in the panel this opens, and still in the label a screen
           * reader gets.
           */}
          <Chevron
            style={{
              width: 10,
              height: 10,
              color: 'var(--ink-3)',
              flexShrink: 0,
              transform: props.open ? 'rotate(180deg)' : 'none',
              transition: 'transform 120ms var(--ease, ease)',
            }}
          />
        </>
      }
    >
      <MultiWalletSelector variant="compact" maxWallets={batchMaxWallets()} />
    </ChipPopover>
  );
}

function Divider(): React.ReactElement {
  return (
    <span
      aria-hidden
      className="self-stretch my-[5px] w-px shrink-0"
      style={{ background: 'var(--hairline-2)' }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Shared chip + anchored popover                                      */
/* ------------------------------------------------------------------ */

interface PopoverAnchor {
  top: number;
  left: number;
}

function computeAnchor(rect: DOMRect, width: number): PopoverAnchor {
  // Rect and innerWidth are physical px; the popover's fixed left/top are
  // page-zoom-multiplied — convert to layout px so it hugs the trigger.
  const z = pageZoom();
  // Right-align with the trigger, clamped inside the viewport.
  let left = rect.right / z - width;
  if (typeof window !== 'undefined') {
    const maxLeft = window.innerWidth / z - width - VIEWPORT_PADDING;
    left = Math.max(VIEWPORT_PADDING, Math.min(left, maxLeft));
  } else {
    left = Math.max(VIEWPORT_PADDING, left);
  }
  return { top: rect.bottom / z + POPOVER_GAP, left };
}

function ChipPopover(props: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly width: number;
  readonly trigger: ReactNode;
  readonly triggerAriaLabel: string;
  readonly triggerTestId: string;
  readonly popoverAriaLabel: string;
  /** Edge-to-edge body (no inner padding) for children that render
   *  their own full-bleed header/rows, e.g. MultiWalletSelector. */
  readonly flush?: boolean;
  readonly children: ReactNode;
}): React.ReactElement {
  const { open, onClose, width } = props;
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const recompute = () => {
      const node = triggerRef.current;
      if (!node) return;
      setAnchor(computeAnchor(node.getBoundingClientRect(), width));
    };
    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Portal into the theme scope, not document.body — theme tokens live
  // under `.listen-root[data-theme-id]` (see trade/WalletCountButton).
  const portalTarget: HTMLElement | null = (() => {
    if (typeof document === 'undefined') return null;
    const trigger = triggerRef.current;
    if (trigger !== null) {
      const ancestor = trigger.closest<HTMLElement>('.listen-root');
      if (ancestor !== null) return ancestor;
    }
    return document.body;
  })();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={props.triggerAriaLabel}
        data-testid={props.triggerTestId}
        onClick={props.onToggle}
        className="inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 transition-colors hover:brightness-110"
        style={{
          color: 'var(--ink-0)',
          background: open ? 'var(--accent-soft)' : 'var(--input-bg)',
          border: open
            ? '1px solid color-mix(in srgb, var(--accent-primary) 50%, var(--hairline-2))'
            : '1px solid var(--input-border)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          cursor: 'pointer',
          transition: 'background 120ms var(--ease, ease), border-color 120ms var(--ease, ease)',
        }}
      >
        {props.trigger}
      </button>
      {open && portalTarget && anchor !== null
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={props.popoverAriaLabel}
              // Quick fade+scale on open — same treatment as the trade
              // page's wallet-count popover (see WalletCountButton).
              className="animate-in fade-in-0 zoom-in-95 duration-100"
              /* Tagged so the paper palette can reach it: everything below
                 is set as an INLINE style off the app's tokens, and an
                 inline style outranks any selector that is not important. */
              data-paper-pop=""
              style={{
                position: 'fixed',
                top: anchor.top,
                left: anchor.left,
                width,
                zIndex: 90,
                background: 'var(--surface-1)',
                border: '1px solid var(--hairline-2)',
                borderRadius: 'var(--r-lg)',
                boxShadow: 'var(--shadow-popover)',
                padding: props.flush === true ? 0 : 6,
                overflow: props.flush === true ? 'hidden' : undefined,
                transformOrigin: 'top right',
                color: 'var(--ink-1)',
                fontFamily: 'var(--sans)',
              }}
            >
              {props.children}
            </div>,
            portalTarget,
          )
        : null}
    </>
  );
}
