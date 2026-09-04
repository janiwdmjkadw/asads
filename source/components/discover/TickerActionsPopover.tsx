'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Copy, Search } from '@/components/listen/icons/Icons';
import { openTokenSearch } from '@/lib/state/token-search-store';
import { openInNewTab } from './cardLinkInteractions';

/**
 * Ticker action popover — the small copy glyph next to a card's
 * ticker/name. Hover (or click) opens a shadcn Popover with quick
 * actions on the token's identity:
 *
 *   - Copy <short mint>   → copies the full contract address
 *   - Copy TICKER         → copies the ticker text
 *   - Google for TICKER   → Google search in a new tab
 *   - X Search for TICKER → X search (ticker OR mint) in a new tab
 *   - Search for TICKER   → in-app token search modal, pre-filled
 *
 * Hover-open is a controlled Popover: enter opens, leaving BOTH the
 * trigger and the content past a short grace delay closes (the delay
 * covers the trigger→content mouse travel). Every handler stops
 * propagation because the whole card is a click-to-navigate surface.
 */

const CLOSE_DELAY_MS = 160;
const COPIED_FLASH_MS = 1000;

function shortMint(mint: string): string {
  return mint.length <= 12 ? mint : `${mint.slice(0, 5)}…${mint.slice(-4)}`;
}

function GoogleGlyph({ style }: { style?: React.CSSProperties }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden style={style}>
      <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z" />
    </svg>
  );
}

function XGlyph({ style }: { style?: React.CSSProperties }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden style={style}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
    </svg>
  );
}

function copyText(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

interface RowSpec {
  key: string;
  icon: ReactElement;
  label: string;
  onSelect: () => void;
  /** Copy rows flash "Copied" instead of closing the popover. */
  copies?: boolean;
}

export function TickerActionsPopover({
  mint,
  ticker,
}: {
  mint: string;
  /** Display ticker, `$`-stripped. */
  ticker: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const copiedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  const flashCopied = (key: string) => {
    setCopiedKey(key);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedKey(null), COPIED_FLASH_MS);
  };

  const glyph = { width: 13, height: 13, display: 'block' as const };
  const rows: RowSpec[] = [
    {
      key: 'copy-mint',
      icon: <Copy style={glyph} />,
      label: `Copy ${shortMint(mint)}`,
      onSelect: () => copyText(mint),
      copies: true,
    },
    {
      key: 'copy-ticker',
      icon: <Copy style={glyph} />,
      label: `Copy ${ticker}`,
      onSelect: () => copyText(ticker),
      copies: true,
    },
    {
      key: 'google',
      icon: <GoogleGlyph style={glyph} />,
      label: `Google for ${ticker}`,
      onSelect: () =>
        openInNewTab(`https://www.google.com/search?q=${encodeURIComponent(`${ticker} ${mint}`)}`),
    },
    {
      key: 'x-search',
      icon: <XGlyph style={glyph} />,
      label: `X Search for ${ticker}`,
      onSelect: () =>
        openInNewTab(
          `https://x.com/search?q=${encodeURIComponent(`(${ticker} OR ${mint})`)}&src=typed_query`,
        ),
    },
    {
      key: 'app-search',
      icon: <Search style={glyph} />,
      label: `Search for ${ticker}`,
      onSelect: () => {
        setOpen(false);
        openTokenSearch(ticker);
      },
    },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${ticker} actions`}
          className="inline-flex items-center justify-center shrink-0 cursor-pointer outline-none focus:outline-none focus-visible:outline-none"
          style={{
            /* Width = the glyph (12px), not 16: in the identity row the
               name truncates against a FULL flex line, so the button's
               invisible side padding was 4px stolen from visible text
               ("i feel like there is still space for text here"). Height
               keeps the 16px click target. */
            width: 12,
            height: 16,
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            color: open ? 'var(--ink-1)' : 'var(--ink-3)',
            padding: 0,
          }}
          onMouseEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onMouseLeave={scheduleClose}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            // Direct click = quick CA copy (matches the icon's glyph).
            e.stopPropagation();
            e.preventDefault();
            copyText(mint);
            flashCopied('copy-mint');
            setOpen(true);
          }}
        >
          <Copy style={{ width: 12, height: 12, display: 'block' }} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[232px] p-1"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Hover-driven open/close: without this, Radix returns focus to
        // the trigger on close and the button lights up its focus ring.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[12px] transition-colors hover:bg-[var(--chip-bg)]"
            style={{
              height: 32,
              border: 'none',
              background: 'transparent',
              color: 'var(--ink-0)',
              cursor: 'pointer',
              fontFamily: 'var(--sans)',
            }}
            onClick={(e) => {
              e.stopPropagation();
              row.onSelect();
              if (row.copies) flashCopied(row.key);
              else if (row.key !== 'app-search') setOpen(false);
            }}
          >
            <span
              className="inline-flex shrink-0 items-center justify-center"
              style={{ width: 14, color: 'var(--ink-2)' }}
            >
              {row.icon}
            </span>
            <span className="truncate">
              {copiedKey === row.key ? 'Copied' : row.label}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
