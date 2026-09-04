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
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
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
}

function computeAnchor(rect: DOMRect): PopoverAnchor {
  // Rect and innerWidth are physical px; the popover's fixed left/top are
  // page-zoom-multiplied — convert to layout px so it hugs the trigger.
  const z = pageZoom();
  // Right-align the popover with the trigger button by default.
  let left = rect.right / z - POPOVER_WIDTH;
  if (typeof window !== 'undefined') {
    const maxLeft = window.innerWidth / z - POPOVER_WIDTH - VIEWPORT_PADDING;
    left = Math.max(VIEWPORT_PADDING, Math.min(left, maxLeft));
  } else {
    left = Math.max(VIEWPORT_PADDING, left);
  }
  const top = rect.bottom / z + POPOVER_GAP;
  return { top, left };
}

export function WalletCountButton(props: WalletCountButtonProps = {}): React.ReactElement {
  const selectedIds = useSelectedWalletStore((s) => s.multiSelectedWalletAccountIds);
  const count = props.count ?? selectedIds.length;
  const testIdPrefix = props.testIdPrefix ?? 'wallet-count';
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
      setAnchor(computeAnchor(node.getBoundingClientRect()));
    };
    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [open]);

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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Wallets selected: ${count}. Click to change selection.`}
        data-testid={`${testIdPrefix}-button`}
        onClick={() => setOpen((prev) => !prev)}
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
              style={{
                // `position: fixed` + body portal escapes the trade
                // panel's `overflow: hidden` clip and the
                // `.panel > * { z-index: 1 }` stacking rule. Without
                // this the buy/sell form rendered on top of the
                // popover.
                position: 'fixed',
                top: anchor.top,
                left: anchor.left,
                width: POPOVER_WIDTH,
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
                transformOrigin: 'top right',
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
