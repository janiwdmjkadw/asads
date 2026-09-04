'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';

import './header.css';

/**
 * The landing header.
 *
 * One row: the mark, three destinations, Log in, Start Trading. Capped to
 * a 1400 column that every band under it shares, so the mark and the
 * headline start on the same line. The hairline under it runs full bleed,
 * because that line is the bottom of the page's chrome and not the bottom
 * of the column.
 *
 * The measurements and the palette are in `header.css`, which explains
 * each one where it is written. What lives here is the two pieces of
 * behaviour a static stylesheet cannot do.
 *
 * ── 1 · THE SCROLLED STATE ───────────────────────────────────────────
 *
 * The bar is sticky, and a sticky bar needs to say it is above the page
 * once the page is under it. `data-moved` swaps the hairline for a soft
 * lift. It is read from ONE passive scroll listener with a `ref` guard,
 * so the state only ever sets when the answer actually changes rather
 * than on every frame of a scroll.
 *
 * ── 2 · THE COMMUNITY MENU ───────────────────────────────────────────
 *
 * Deliberately not a Radix popover: it is two links, it never needs a
 * focus trap, and a portal would put it outside the header's own scope
 * and lose the palette declared there. It closes on Escape and on a
 * pointer down anywhere outside itself, which is the whole contract.
 *
 * ── AND NO BURGER ────────────────────────────────────────────────────
 *
 * There is no drawer and no menu button at any width. This is a one page
 * site: the destinations are anchors into the page you are already on, so
 * hiding two words behind a button costs a tap to reach something that
 * fits on screen anyway. Below 900 the row keeps every destination and
 * drops Log in, which is the one control that is genuinely redundant
 * there since Start Trading leads to the same place for a new visitor.
 */

const DESTINATIONS: ReadonlyArray<readonly [string, string]> = [
  ['Terminal', '#terminal'],
  ['Rewards', '#rewards'],
];

/*
 * The real brand marks, as single filled paths. Both are the shapes the
 * companies actually publish rather than something drawn to look like
 * them, which matters here because these two glyphs are the only artwork
 * in the bar and a hand made approximation of a logo reads instantly as
 * one.
 */
const DISCORD_PATH =
  'M20.317 4.369a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.79.037c-.211.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.32.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.009c.12.099.246.198.373.292a.077.077 0 01-.6.127 12.3 12.3 0 01-1.873.891.077.077 0 00-.41.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z';

const X_PATH =
  'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';

const COMMUNITY: ReadonlyArray<{
  readonly label: string;
  readonly meta: string;
  readonly href: string;
  readonly d: string;
}> = [
  {
    label: 'Discord',
    meta: 'Join the community',
    href: 'https://discord.gg/F2kxV5zPv5',
    d: DISCORD_PATH,
  },
  {
    label: 'Twitter',
    meta: '@listendotmoney',
    href: 'https://x.com/listendotmoney',
    d: X_PATH,
  },
];

function Brandmark({ d }: { readonly d: string }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

export function Header(): ReactElement {
  const [moved, setMoved] = useState(false);
  const [community, setCommunity] = useState(false);
  const menuRef = useRef<HTMLSpanElement | null>(null);

  /* One passive listener, and the guard so it only sets state when the
     answer changes rather than on every frame. */
  useEffect(() => {
    const movedRef = { current: false };
    const onScroll = (): void => {
      const next = window.scrollY > 4;
      if (next === movedRef.current) return;
      movedRef.current = next;
      setMoved(next);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Escape and an outside pointer close the menu. Bound only while it is
     open, so nothing listens when it is shut. */
  useEffect(() => {
    if (!community) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCommunity(false);
    };
    const onDown = (e: PointerEvent): void => {
      const node = menuRef.current;
      if (node && e.target instanceof Node && !node.contains(e.target)) setCommunity(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [community]);

  return (
    <header id="header" data-lp-header="" data-moved={moved ? 'true' : 'false'}>
      <div className="lph-row">
        {/* The mark, and only the mark. The name is here for anything that
            reads rather than looks. */}
        <a className="lph-brand" href="#header">
          <span aria-hidden className="lph-mark" />
          <span className="lph-sr">Listen, back to top</span>
        </a>

        <nav className="lph-nav" aria-label="Primary">
          {DESTINATIONS.map(([label, href]) => (
            <a key={href} href={href} className="lph-a">
              {label}
            </a>
          ))}

          <span className="lph-menu" ref={menuRef}>
            <button
              type="button"
              className="lph-a"
              aria-expanded={community}
              aria-haspopup="true"
              onClick={() => setCommunity((v) => !v)}
            >
              Community
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden focusable="false" className="lph-chev">
                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {community ? (
              <div className="lph-pop">
                {COMMUNITY.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setCommunity(false)}
                  >
                    <Brandmark d={item.d} />
                    {item.label}
                    <span>{item.meta}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </span>
        </nav>

        <span className="lph-gap" />

        <button type="button" className="lph-login">
          Log in
        </button>
        <button type="button" className="lph-cta">
          Start Trading
        </button>
      </div>
    </header>
  );
}
