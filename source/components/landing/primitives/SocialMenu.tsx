'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { DiscordGlyph, XGlyph } from '../art';

/* Kept here rather than in Header.tsx: the footer links to the same two
   places, and one list is one place to change a handle. */
export const DISCORD_URL = 'https://discord.gg/F2kxV5zPv5';
export const TWITTER_URL = 'https://x.com/listendotmoney';

const SOCIALS = [
  { label: 'Discord', href: DISCORD_URL, Glyph: DiscordGlyph },
  { label: 'Twitter', href: TWITTER_URL, Glyph: XGlyph },
] as const;

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-lp-ground';

export interface SocialMenuProps {
  /** Word on the trigger. Omit for the icon-only trigger. */
  label?: string;
  className?: string;
}

/**
 * Both socials behind one trigger.
 *
 * They used to be two of the five nav items, wearing full words, ahead of
 * the section anchors. That is two permanent pieces of chrome for the two
 * least-pressed things in the header, and it is what made the old bar read
 * as crammed on the left. Collapsed to one control they cost a single
 * label, and the bar gets the width back.
 *
 * Closes on outside pointerdown and on Escape, and hands focus back to the
 * trigger when Escape closes it. Deliberately not a Radix menu: two links
 * do not justify the dependency, and the arrow-key roving Radix would add
 * is not behaviour anyone needs over a list of two.
 */
export function SocialMenu({ label, className }: SocialMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();

  /* Hover opens it on a mouse, and only on a mouse. A touch device
     synthesises a hover on tap, which would open the menu on the same
     gesture that then toggles it shut again — so the pointer has to be one
     that can actually hover before hover means anything. */
  const hoverable = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

  const openNow = () => {
    clearTimeout(closeTimer.current);
    if (hoverable()) setOpen(true);
  };

  /* A short grace period on the way out. Without it, crossing the gap
     between the trigger and the panel closes the thing you are reaching
     for. The panel's own wrapper carries that gap as padding, so the
     pointer never actually leaves the root — the delay is the belt to
     that braces. */
  const closeSoon = () => {
    if (!hoverable()) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      onPointerEnter={openNow}
      onPointerLeave={closeSoon}
      onFocus={openNow}
      className={cn('relative', className)}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label ? undefined : 'Community'}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-1.5 font-geist text-[15px] leading-none transition-colors',
          open ? 'text-lp-ink-1' : 'text-lp-ink-2 hover:text-lp-ink-1',
          FOCUS,
        )}
      >
        {label ?? (
          /* Three nodes on a spine. A community mark rather than either
             platform's logo, so the trigger does not privilege one. */
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false">
            <circle cx="4" cy="8" r="1.6" />
            <circle cx="8" cy="8" r="1.6" />
            <circle cx="12" cy="8" r="1.6" />
          </svg>
        )}
        {label ? (
          <svg
            width="9"
            height="6"
            viewBox="0 0 9 6"
            fill="none"
            aria-hidden
            focusable="false"
            className={cn('transition-transform', open && 'rotate-180')}
          >
            <path d="M1 1.5L4.5 4.5L8 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ) : null}
      </button>

      {open ? (
        /* The wrapper owns the 14px gap as PADDING rather than the panel
           owning it as offset, so the trigger and the panel are one
           contiguous hover target and the pointer can cross between them. */
        <div className="absolute right-0 top-full z-50 pt-3.5">
          <div
            role="menu"
            className="w-[178px] overflow-hidden rounded-xl border border-lp-hairline bg-lp-ground p-1 shadow-[0_16px_40px_rgba(0,0,0,0.6)]"
          >
            {SOCIALS.map((social) => (
              <a
                key={social.href}
                role="menuitem"
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 font-geist text-sm leading-none text-lp-ink-2 transition-colors hover:bg-[var(--lp-hover)] hover:text-lp-ink-1',
                  FOCUS,
                )}
              >
                <social.Glyph className="size-4 shrink-0" />
                {social.label}
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
