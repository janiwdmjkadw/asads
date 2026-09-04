'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Caption } from '@/components/listen/primitives';
import { formatUsdAmount } from '@/lib/format';
import { pageZoom } from '@/lib/page-zoom';
import { isLikelyMintAddress } from './math';
import { useListenRootPortal } from './useListenRootPortal';
import type { TokenOption } from './useSpotHoldings';

/**
 * Token selector for the Advanced/Limit tab cards. Renders the current
 * selection (logo + symbol) as a chip-style button; opens a dropdown
 * listing SOL, USDC and every SPL holding with balance + USD value.
 * When `allowPasteCa` is set, the dropdown carries a paste-CA input
 * accepting any base58 mint address.
 *
 * The dropdown renders via a portal into the nearest `.listen-root`
 * with `position: fixed` anchored to the trigger — the same pattern as
 * WalletCountButton — because `.panel { overflow: hidden }` plus
 * `.panel > * { z-index: 1 }` make any in-place overlay paint UNDER
 * later panel sections (unclickable + see-through).
 */

/** The pair leg a card currently points at. `decimals: null` marks a
 *  pasted, unheld mint (output-only — inputs always come from the
 *  picker options, which carry decimals). */
export interface SelectedToken {
  readonly mint: string;
  readonly symbol: string;
  readonly logo: string | null;
  readonly decimals: number | null;
}

export function optionToSelected(option: TokenOption): SelectedToken {
  return {
    mint: option.mint,
    symbol: option.symbol,
    logo: option.logo,
    decimals: option.decimals,
  };
}

export function shortMintLabel(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

function TokenGlyph({ logo, symbol, size = 18 }: { logo: string | null; symbol: string; size?: number }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        fontSize: Math.max(8, Math.floor(size / 2)),
        fontFamily: 'var(--mono)',
        color: 'var(--ink-2)',
        background: 'color-mix(in srgb, var(--accent-primary) 12%, rgba(255,255,255,0.04))',
        border: '1px solid var(--hairline)',
      }}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

const DROPDOWN_WIDTH = 240;
const DROPDOWN_GAP = 4;
const VIEWPORT_PADDING = 8;

interface DropdownAnchor {
  top: number;
  left: number;
}

function computeAnchor(rect: DOMRect): DropdownAnchor {
  // Rect is physical px; fixed top/left are page-zoom-multiplied —
  // divide by the zoom so the dropdown hugs the trigger (see
  // WalletCountButton.computeAnchor).
  const z = pageZoom();
  let left = rect.right / z - DROPDOWN_WIDTH;
  if (typeof window !== 'undefined') {
    const maxLeft = window.innerWidth / z - DROPDOWN_WIDTH - VIEWPORT_PADDING;
    left = Math.max(VIEWPORT_PADDING, Math.min(left, maxLeft));
  } else {
    left = Math.max(VIEWPORT_PADDING, left);
  }
  return { top: rect.bottom / z + DROPDOWN_GAP, left };
}

export function TokenPicker({
  selected,
  options,
  onSelect,
  allowPasteCa = false,
  onPasteMint,
  ariaLabel,
}: {
  selected: SelectedToken;
  options: ReadonlyArray<TokenOption>;
  onSelect: (option: TokenOption) => void;
  /** Show the paste-CA row (To Buy / Receive side). */
  allowPasteCa?: boolean;
  onPasteMint?: (mint: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [anchor, setAnchor] = useState<DropdownAnchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const { anchorRef, portalTarget } = useListenRootPortal();
  const pasteValid = useMemo(() => isLikelyMintAddress(pasteValue), [pasteValue]);

  // Anchor to the trigger while open; follow scroll/resize.
  useLayoutEffect(() => {
    if (!open) return;
    const recompute = (): void => {
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

  // Close on outside pointerdown (capture) + Escape. The trigger and
  // the portaled dropdown live in different subtrees — check both.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commitPaste = (): void => {
    if (!pasteValid || !onPasteMint) return;
    onPasteMint(pasteValue.trim());
    setPasteValue('');
    setOpen(false);
  };

  return (
    <div className="relative" style={{ minWidth: 0 }}>
      <span ref={anchorRef} hidden />
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5"
        style={{
          padding: '4px 8px',
          borderRadius: 'var(--r-md)',
          background: 'var(--tabs-bg)',
          border: '1px solid var(--hairline)',
          cursor: 'pointer',
          color: 'var(--ink-0)',
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        <TokenGlyph logo={selected.logo} symbol={selected.symbol} />
        <span>{selected.symbol}</span>
        <span aria-hidden style={{ color: 'var(--ink-3)', fontSize: 9 }}>
          ▾
        </span>
      </button>
      {open && portalTarget && anchor !== null ? (
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            aria-label={ariaLabel}
            className="flex flex-col"
            style={{
              position: 'fixed',
              top: anchor.top,
              left: anchor.left,
              width: DROPDOWN_WIDTH,
              maxHeight: 280,
              // Above the panel stacking context, WalletPanel modal
              // (z-50) and TradeToasts (z-80) — same tier as the
              // wallet-count popover.
              zIndex: 90,
              borderRadius: 'var(--r-lg)',
              // Opaque, theme-following card surface (`--surface` /
              // `--section-bg` are translucent in some themes).
              background: 'var(--surface-1)',
              border: '1px solid var(--hairline-2)',
              boxShadow: 'var(--shadow-popover, 0 12px 32px -12px rgba(0,0,0,0.8))',
              overflow: 'hidden',
            }}
          >
            <div className="scroll-hide flex-1 overflow-y-auto p-1">
              {options.map((option) => {
                const active = option.mint === selected.mint;
                return (
                  <button
                    key={option.mint}
                    type="button"
                    onClick={() => {
                      onSelect(option);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2"
                    style={{
                      padding: '6px 8px',
                      borderRadius: 'var(--r-sm)',
                      background: active
                        ? 'color-mix(in srgb, var(--accent-primary) 10%, transparent)'
                        : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <TokenGlyph logo={option.logo} symbol={option.symbol} size={20} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--ink-0)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {option.symbol}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--ink-3)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {option.name ?? shortMintLabel(option.mint)}
                      </span>
                    </span>
                    <span className="flex flex-col items-end" style={{ flexShrink: 0 }}>
                      <span
                        className="tabular-nums"
                        style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--ink-1)' }}
                      >
                        {option.balanceUi !== null ? formatPickerAmount(option.balanceUi) : '—'}
                      </span>
                      <span
                        className="tabular-nums"
                        style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-3)' }}
                      >
                        {option.valueUsd !== null ? formatUsdAmount(option.valueUsd) : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {allowPasteCa && onPasteMint ? (
              <div
                className="flex items-center gap-1 p-1.5"
                style={{ borderTop: '1px solid var(--hairline)' }}
              >
                <input
                  type="text"
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitPaste();
                  }}
                  placeholder="Paste CA…"
                  spellCheck={false}
                  className="min-w-0 flex-1 border-0 bg-transparent outline-none"
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--mono)',
                    color: 'var(--ink-0)',
                    padding: '4px 6px',
                  }}
                />
                <button
                  type="button"
                  onClick={commitPaste}
                  disabled={!pasteValid}
                  className="seg__btn"
                  style={{
                    opacity: pasteValid ? 1 : 0.4,
                    cursor: pasteValid ? 'pointer' : 'not-allowed',
                  }}
                >
                  Use
                </button>
              </div>
            ) : null}
            {allowPasteCa && pasteValue.length > 0 && !pasteValid ? (
              <div style={{ padding: '0 8px 6px' }}>
                <Caption size="sm" tone="ink-3">
                  Not a valid mint address (base58, 32–44 chars).
                </Caption>
              </div>
            ) : null}
          </div>,
          portalTarget,
        )
      ) : null}
    </div>
  );
}

/** Compact holdings amount for the dropdown rows. */
function formatPickerAmount(amountUi: number): string {
  if (!Number.isFinite(amountUi) || amountUi <= 0) return '0';
  if (amountUi >= 1_000_000) return `${(amountUi / 1_000_000).toFixed(2)}M`;
  if (amountUi >= 1_000) return `${(amountUi / 1_000).toFixed(2)}K`;
  if (amountUi >= 1) return amountUi.toFixed(3).replace(/\.?0+$/, '');
  return amountUi.toPrecision(3);
}
