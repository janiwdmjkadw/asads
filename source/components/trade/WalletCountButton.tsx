'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { isEligibleWallet, useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { useMe } from '@/lib/api/me';
import { MultiWalletSelector } from '@/components/listen/MultiWalletSelector';
import { Wallet } from '@/components/listen/icons/Icons';
import { routeForWalletCount, type WalletCountRoute } from './walletCountRoute';
import { pageZoom } from '@/lib/page-zoom';
import { getRuntimeConfig } from '@/lib/runtime-config';

/**
 * Slice "Multi-wallet split buy/sell orders" (UI revision): compact
 * wallet-count button mounted next to the trade form header.
 *
 * Behavior:
 *   - The button shows the integer count of currently-selected
 *     wallets (`multiSelectedWalletAccountIds.length`). The store
 *     invariant guarantees this is always >= 1, so the button never
 *     shows `0`.
 *   - Clicking the button toggles a popover anchored directly below
 *     it. The popover contains ONLY the wallet selector (checkboxes,
 *     Select all eligible, Clear). No amount inputs, no buy/sell
 *     controls, no submit.
 *   - Escape, click-outside, and a second click on the trigger
 *     close the popover.
 *
 * Implementation:
 *   - The popover renders via a React portal to `document.body` so
 *     it escapes the `.panel { overflow: hidden }` clip AND the
 *     `.panel > * { z-index: 1 }` stacking rule. Without the portal
 *     the buy/sell form rendered ON TOP of the popover because every
 *     direct child of the trade panel is forced into the same
 *     stacking context (see `terminal/components/listen/listen.css`).
 *   - The popover is positioned with `position: fixed` using the
 *     trigger button's `getBoundingClientRect()`. We update the
 *     position on scroll / resize so the popover follows the
 *     trigger.
 *
 * Routing is implicit downstream:
 *   - count === 1 -> single-wallet order (existing /api/v1/trade/orders)
 *   - count >= 2  -> batch order (/api/v1/trade/batch-orders)
 */

export interface WalletCountButtonProps {
  className?: string;
  style?: CSSProperties;
  /** Trade-page mint: enables per-wallet balances + Split/Aggregate
   *  inside the popover's wallet selector. */
  mint?: string | null;
  /** Controlled count/content let the EVM panel reuse the exact desktop
   * shell while retaining its chain-qualified wallet source. */
  count?: number;
  popoverContent?: ReactNode;
  testIdPrefix?: string;
  /**
   * How the trigger draws itself.
   *
   *   `pill`  — the 26px icon + number chip that sits in a header row.
   *   `field` — a full width input, for a form column where the wallet
   *             is one of the fields of the order rather than a chip
   *             off in the chrome. It reads "Wallets selected" and the
   *             COUNT: which wallets they are is what the list is for,
   *             and a name in the trigger goes stale the moment a
   *             second wallet is ticked.
   */
  layout?: 'pill' | 'field';
  /** Trigger copy in the `field` layout. */
  label?: string;
}

// Re-export the pure routing rule so existing callers that do
// `import { routeForWalletCount } from './WalletCountButton'` keep
// compiling. The rule lives in `./walletCountRoute.ts` so it can be
// imported by surfaces (e.g. discover/CoinCard) that must not pull
// the React component graph in.
export { routeForWalletCount, type WalletCountRoute };

const POPOVER_WIDTH = 320;
const POPOVER_GAP = 6;
// Edge padding so the popover never overlaps the viewport's right
// gutter when the trigger sits flush against the right edge.
const VIEWPORT_PADDING = 8;

// Selection cap for the batch route. MUST match the api/ batch-orders
// cap (`BATCH_ORDERS_MAX_WALLETS`, default 20) — the selector's old
// implicit 100 let users select more wallets than the api accepts,
// turning every submit into a wholesale 400. Ops: when raising the api
// cap, set NEXT_PUBLIC_BATCH_ORDERS_MAX_WALLETS to the same value.
function batchMaxWallets(): number {
  return Math.min(100, Math.max(1, Math.floor(getRuntimeConfig().batchOrdersMaxWallets)));
}

interface PopoverAnchor {
  top: number;
  left: number;
  width: number;
}

// Narrow enough for a phone, wide enough for a name and two figures.
const FIELD_MIN_WIDTH = 260;

function computeAnchor(rect: DOMRect, layout: 'pill' | 'field'): PopoverAnchor {
  // Rect and innerWidth are physical px; the popover's fixed left/top are
  // page-zoom-multiplied — convert to layout px so it hugs the trigger.
  const z = pageZoom();
  /*
   * A field trigger is already the width of the column it lives in, so
   * the list takes THAT width and hangs off its left edge: the popover
   * is the field opening rather than a card that happens to appear near
   * it. The pill keeps its fixed card, right aligned with the chip.
   */
  const width =
    layout === 'field' ? Math.max(rect.width / z, FIELD_MIN_WIDTH) : POPOVER_WIDTH;
  let left = layout === 'field' ? rect.left / z : rect.right / z - width;
  if (typeof window !== 'undefined') {
    const maxLeft = window.innerWidth / z - width - VIEWPORT_PADDING;
    left = Math.max(VIEWPORT_PADDING, Math.min(left, maxLeft));
  } else {
    left = Math.max(VIEWPORT_PADDING, left);
  }
  const top = rect.bottom / z + POPOVER_GAP;
  return { top, left, width };
}

export function WalletCountButton(props: WalletCountButtonProps = {}): React.ReactElement {
  const selectedIds = useSelectedWalletStore((s) => s.multiSelectedWalletAccountIds);
  const count = props.count ?? selectedIds.length;
  const testIdPrefix = props.testIdPrefix ?? 'wallet-count';
  const layout = props.layout ?? 'pill';
  /*
   * HOW MANY WALLETS THERE ARE TO CHOOSE BETWEEN.
   *
   * With one wallet the picker is a control that cannot change
   * anything: the selection is already that wallet, it cannot be
   * unticked (the store's invariant reseeds it), and opening the list
   * shows a single row with a tick already in it. In the `field`
   * layout that is a whole row of the order form spent on a decision
   * that does not exist, so the field does not render at all.
   *
   * The `pill` layout keeps rendering either way — it is a readout in
   * a header strip, not a field, and the count is worth showing on its
   * own. Controlled callers (the EVM panel passes its own count and
   * body) are never gated: their wallet source is not this one.
   */
  const { data: me } = useMe();
  /*
   * ONLY WHEN WE KNOW. `me` is undefined while the call is in flight and
   * whenever it fails, and a missing answer is not the same fact as "you
   * have one wallet" — treating them alike is how a control disappears
   * for a reason that has nothing to do with the user's wallets. So the
   * field hides only when the list has actually arrived and holds fewer
   * than two wallets; anything else renders it.
   */
  const walletsKnown = me !== undefined && me !== null && !me.reauth_required;
  const nothingToChoose =
    layout === 'field' &&
    props.popoverContent === undefined &&
    walletsKnown &&
    me.wallets.filter(isEligibleWallet).length < 2;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Recompute popover position when opening, and follow the trigger
  // on scroll / resize while open.
  useLayoutEffect(() => {
    if (!open) return;
    const recompute = () => {
      const node = triggerRef.current;
      if (!node) return;
      setAnchor(computeAnchor(node.getBoundingClientRect(), layout));
    };
    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [open, layout]);

  // Close on click-outside. The trigger AND the popover both live
  // outside the trade panel's stacking context (the popover is in a
  // body portal), so we check both refs.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // CRITICAL: theme tokens (--surface-1, --accent-soft, --ink-*, etc.)
  // live under `.listen-root[data-theme-id="..."]` — they are NOT
  // defined at `:root`. If we portal to `document.body` the popover
  // escapes the listen-root scope and inherits the global dark
  // defaults, which is why the popover rendered as a dark card on
  // zen parchment even after switching to --surface-1.
  //
  // Find the trigger's nearest `.listen-root` ancestor and portal
  // there instead. Falls back to `document.body` only if the trigger
  // is somehow outside the listen tree (defensive; should not happen
  // on the trade page).
  const portalTarget: HTMLElement | null = (() => {
    if (typeof document === 'undefined') return null;
    const trigger = triggerRef.current;
    if (trigger !== null) {
      const ancestor = trigger.closest<HTMLElement>('.listen-root');
      if (ancestor !== null) return ancestor;
    }
    return document.body;
  })();

  const commonTriggerProps = {
    ref: triggerRef,
    type: 'button' as const,
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': open,
    'aria-label': `Wallets selected: ${count}. Click to change selection.`,
    'data-testid': `${testIdPrefix}-button`,
    onClick: () => setOpen((prev) => !prev),
  };

  if (nothingToChoose) return <></>;

  return (
    <>
      {layout === 'field' ? (
        <button
          {...commonTriggerProps}
          className={props.className}
          style={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            gap: 7,
            height: 34,
            padding: '0 10px',
            borderRadius: 8,
            background: open ? 'var(--accent-soft)' : 'var(--input-bg)',
            border: open
              ? '1px solid color-mix(in srgb, var(--accent-primary) 50%, var(--hairline-2))'
              : '1px solid var(--input-border, var(--hairline))',
            color: 'var(--ink-1)',
            fontFamily: 'var(--sans)',
            fontSize: 12.5,
            cursor: 'pointer',
            textAlign: 'left',
            transition:
              'background 120ms var(--ease, ease), border-color 120ms var(--ease, ease)',
            ...props.style,
          }}
        >
          <Wallet style={{ width: 13, height: 13, color: 'var(--ink-2)', flex: '0 0 auto' }} />
          {/* One line, always. The field is a fixed 34px and the name of
              the control is the first thing to wrap when a holding is
              carried at the other end — which turns the control into a
              two line block that no longer lines up with the amount
              under it. */}
          <span style={{ color: 'var(--ink-1)', whiteSpace: 'nowrap' }}>
            {props.label ?? 'Wallets selected'}
          </span>
          {/* The count sits at the right end, where every other figure
              in this column sits, so the eye reads down one line. */}
          <span
            data-testid={`${testIdPrefix}-value`}
            style={{
              marginLeft: 'auto',
              color: 'var(--ink-0)',
              fontFamily: 'var(--font-mono, monospace)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 12.5,
              fontWeight: 500,
            }}
          >
            {count}
          </span>
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            style={{
              width: 12,
              height: 12,
              flex: '0 0 auto',
              color: 'var(--ink-3)',
              transform: open ? 'rotate(180deg)' : undefined,
              transition: 'transform 130ms var(--ease, ease)',
            }}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9.5 6 6 6-6" />
          </svg>
        </button>
      ) : (
        <button
          {...commonTriggerProps}
          className={`t-num-xs inline-flex h-[26px] items-center gap-1 rounded-[var(--r-sm)] px-2 ${props.className ?? ''}`}
          style={{
            color: 'var(--ink-0)',
            // When the popover is open, lift the trigger with an
            // accent-soft fill + accent border so it visually pairs
            // with the popover and follows the active theme's accent.
            background: open ? 'var(--accent-soft)' : 'var(--input-bg)',
            border: open
              ? '1px solid color-mix(in srgb, var(--accent-primary) 50%, var(--hairline-2))'
              : '1px solid var(--hairline)',
            cursor: 'pointer',
            transition: 'background 120ms var(--ease, ease), border-color 120ms var(--ease, ease)',
            ...props.style,
          }}
        >
          <Wallet style={{ width: 12, height: 12, color: 'var(--accent-primary)' }} />
          <span
            data-testid={`${testIdPrefix}-value`}
            style={{ color: 'var(--ink-0)', fontVariantNumeric: 'tabular-nums' }}
          >
            {count}
          </span>
        </button>
      )}
      {open && portalTarget && anchor !== null
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Select wallets for trading"
              data-testid={`${testIdPrefix}-popover`}
              // Quick fade+scale so opening feels responsive instead of
              // popping in a frame late (the anchor is computed in a
              // layout effect). tailwindcss-animate, same as tooltips.
              className="animate-in fade-in-0 zoom-in-95 duration-100"
              /* Tagged so the paper palette can reach it: everything below
                 is set as an INLINE style off the app's tokens, and an
                 inline style outranks any selector that is not important. */
              data-paper-pop=""
              style={{
                // `position: fixed` + body portal escapes the trade
                // panel's `overflow: hidden` clip and the
                // `.panel > * { z-index: 1 }` stacking rule. Without
                // this the buy/sell form rendered on top of the
                // popover.
                position: 'fixed',
                top: anchor.top,
                left: anchor.left,
                width: anchor.width,
                // Above the WalletPanel modal (z-50) and the
                // TradeToasts (z-80) so a stray toast or modal can
                // never partially obscure the wallet list.
                zIndex: 90,
                // Style tokens match the sibling `WalletSelector`
                // dropdown so both wallet popovers share the same
                // visual language. Use `--surface-1` (not `--surface`)
                // for the card body because `--surface` is intentionally
                // TRANSPARENT in the zen / parchment theme so the page
                // art shows through — elevated cards need an opaque
                // surface that follows the theme (rice paper in zen,
                // dark in cyan / sunset / etc.).
                background: 'var(--surface-1)',
                border: '1px solid var(--hairline-2)',
                borderRadius: 'var(--r-lg)',
                boxShadow: 'var(--shadow-popover)',
                // The selector owns the full body (its header row and
                // ledger rows run edge-to-edge); overflow-hidden keeps
                // square row highlights inside the rounded corners.
                padding: 0,
                overflow: 'hidden',
                transformOrigin: layout === 'field' ? 'top left' : 'top right',
                color: 'var(--ink-1)',
                fontFamily: 'var(--sans)',
              }}
            >
              {props.popoverContent ?? (
                <MultiWalletSelector
                  variant="compact"
                  maxWallets={batchMaxWallets()}
                  mint={props.mint ?? null}
                />
              )}
            </div>,
            portalTarget,
          )
        : null}
    </>
  );
}
