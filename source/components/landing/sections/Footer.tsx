import type { CSSProperties, ReactElement } from 'react';

import { DiscordGlyph, XGlyph, type SocialGlyphProps } from '../art';
import { DisclosuresDialog } from '../DisclosuresDialog';
import './footer.css';

/**
 * The footer.
 *
 * A sitemap, and deliberately the plainest thing on the page. Everything
 * above it has already been argued, and a footer that tries to be
 * interesting reads as a page that did not know it was finished.
 *
 * ── IT IS PAPER, NOT BLACK ───────────────────────────────────────────
 *
 * The one it replaces was a dark khaki band under a WebGL smoke shader,
 * with four tracked uppercase mono links and the word "Listen" set 405px
 * wide. That made sense when the page ended on a black Close band and the
 * footer was the second half of one dark ending. This page has no dark
 * band in it at all, so a black footer would be a lone slab under four
 * white ones: not a close, a stop.
 *
 * White with a hairline over it is the same object the header is, at the
 * other end. The page opens and shuts on the same note.
 *
 * ── THE LINKS ARE REAL, AND THE DEAD ONE IS GONE ─────────────────────
 *
 * Every anchor here points at a band that exists on the page today:
 * `#agent`, `#rewards`, `#frens`. The old footer also carried
 * `Terminal → #terminal`, and the terminal band was cut, so that link is
 * not here.
 *
 * NOTE: `Header.tsx` still carries the same `#terminal` link and it is
 * now dead. It wants either repointing or removing, and which one is a
 * decision about what the nav should say rather than a bug to quietly
 * patch, so it is flagged rather than changed here.
 *
 * Terms and Privacy have no route in this export and are the only two
 * placeholders. Agentic Disclosures is not an href at all: it opens the
 * dialog, so it is a button.
 */

const DISCORD_URL = 'https://discord.gg/F2kxV5zPv5';
const TWITTER_URL = 'https://x.com/listendotmoney';

const SANS = 'font-[family-name:var(--font-instrument-sans)]';

const LIGHT: CSSProperties = {
  '--lp-ground': '#ffffff',
  '--lp-ink-1': '#0b0b0b',
  '--lp-ink-2': '#55555a',
  '--lp-ink-3': '#8a8a90',
  '--lp-hairline': 'rgba(11, 11, 11, 0.13)',
  '--lp-hover': 'rgba(11, 11, 11, 0.06)',
} as CSSProperties;

/* The ink comes up to full and nothing is ever drawn underneath it. An
   underline on hover reads as a link in a paragraph, which in a column of
   nothing but links is every line at once. */
const LINK =
  'w-fit transition-colors duration-150 ease-in-out hover:text-lp-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lp-ink-1 focus-visible:ring-offset-2 focus-visible:ring-offset-lp-ground';

interface FooterLink {
  readonly label: string;
  readonly href: string;
  /** Socials only: the brand mark, and what marks the link as external. */
  readonly Glyph?: (props: SocialGlyphProps) => ReactElement;
}

interface FooterColumn {
  readonly head: string;
  readonly links: readonly FooterLink[];
}

const COLUMNS: readonly FooterColumn[] = [
  {
    head: 'Product',
    links: [
      /* In the page's own order, so somebody scanning the footer and
         somebody scrolling the page meet the bands in the same sequence. */
      { label: 'Conditionals', href: '#agent' },
      { label: 'Rewards', href: '#rewards' },
      { label: 'Frens', href: '#frens' },
    ],
  },
  {
    head: 'Community',
    links: [
      { label: 'Discord', href: DISCORD_URL, Glyph: DiscordGlyph },
      { label: 'Twitter', href: TWITTER_URL, Glyph: XGlyph },
    ],
  },
  /* Agentic Disclosures is not in this list: it is a dialog rather than an
     href, so it is rendered separately at the head of the Legal column. */
  {
    head: 'Legal',
    links: [
      { label: 'Terms', href: '#' },
      { label: 'Privacy', href: '#' },
    ],
  },
];

export function Footer() {
  return (
    <footer id="footer" data-lp-footer="" style={LIGHT} className="w-full border-t border-lp-hairline bg-lp-ground">
      {/* The header's column, verbatim, so the mark down here starts on
          the same line as the mark in the bar. */}
      <div className="mx-auto w-full max-w-[760px] px-5 pb-8 pt-14 lg:w-[min(1400px,100%-48px)] lg:max-w-none lg:px-0 lg:pb-10 lg:pt-16">
        <div className="flex flex-col gap-12 lg:flex-row lg:justify-between lg:gap-16">
          <div className="lg:max-w-[320px]">
            <div className="flex items-center gap-3">
              <span aria-hidden className="lpf-mark" />
              <span className={`${SANS} text-[17px] font-semibold tracking-[-0.02em] text-lp-ink-1`}>Listen</span>
            </div>
            <p className={`${SANS} mt-4 text-[15px] leading-6 text-lp-ink-2`}>
              Set a condition. The agent watches the chain and asks before it fires.
            </p>
          </div>

          {/* Two up on a phone, one row of three from `lg`. Three columns
              at 375 leaves each about 100px, which wraps "Conditionals"
              and "Agentic Disclosures" onto two lines apiece. */}
          <div className="grid grid-cols-2 gap-x-10 gap-y-10 lg:flex lg:gap-x-20">
            {COLUMNS.map((column) => (
              <div key={column.head}>
                <span className={`${SANS} text-[13px] font-medium leading-5 text-lp-ink-1`}>{column.head}</span>
                <div className="mt-4 flex flex-col gap-3">
                  {column.head === 'Legal' ? (
                    <DisclosuresDialog>
                      <button type="button" className={`${SANS} text-left text-[15px] leading-5 text-lp-ink-2 ${LINK}`}>
                        Agentic Disclosures
                      </button>
                    </DisclosuresDialog>
                  ) : null}
                  {column.links.map((link) => (
                    <a
                      key={link.label}
                      href={link.href}
                      {...(link.Glyph ? { target: '_blank', rel: 'noopener noreferrer' } : null)}
                      className={`${SANS} flex items-center gap-2 text-[15px] leading-5 text-lp-ink-2 ${LINK}`}
                    >
                      {link.label}
                      {link.Glyph ? <link.Glyph className="size-3.5 shrink-0" /> : null}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 border-t border-lp-hairline pt-6">
          <span className={`${SANS} text-[13px] leading-5 text-lp-ink-3`}>
            &copy; {new Date().getFullYear()} Listen
          </span>
        </div>
      </div>
    </footer>
  );
}
