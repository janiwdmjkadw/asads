import Link from 'next/link';
import { ListenMark } from './ListenMark';

/**
 * Homepage footer. Closes the marketing page below the MEV section as a
 * slim dark band that continues the page background, with a hairline top
 * rule. Single row, collapsing to a stacked layout on narrow viewports.
 *
 *   [mark] Listen  © {year} · all rights reserved        docs  X  Discord
 *
 * `docs` is still a placeholder (`#`); wire real targets by editing
 * `FOOTER_LINKS`.
 */
const FOOTER_LINKS = {
  docs: '#',
  twitter: 'https://x.com/listendotmoney',
  discord: 'https://discord.gg/F2kxV5zPv5',
} as const;

function XIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M17.751 3H20.818L14.118 10.624L22 21H15.828L10.995 14.708L5.464 21H2.395L9.561 12.844L2 3H8.328L12.697 8.751L17.751 3ZM16.675 19.172H18.375L7.4 4.728H5.575L16.675 19.172Z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.075.075 0 0 0-.079.037 13.78 13.78 0 0 0-.608 1.249 18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.249.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.891.077.077 0 0 0-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}

export function HomeFooter() {
  const year = new Date().getFullYear();
  return (
    <footer
      aria-label="Site footer"
      className="relative z-[3] border-t border-homepage-line2 bg-homepage-bg"
    >
      {/* Single justified row at every width — the type, icons and gaps scale
          down on small screens so the line never wraps. Content is centered
          between the footer top and the registration frame's bottom line
          (hence the asymmetric pt/pb). */}
      <div className="mx-auto flex min-h-[60px] max-w-[1200px] items-center justify-between gap-3 whitespace-nowrap px-gutter pt-[14px] pb-[26px] font-geist-mono text-[9px] min-[400px]:text-[10px] min-[560px]:text-[11.5px]">
        <div className="flex min-w-0 items-center gap-2 text-homepage-ink2 min-[560px]:gap-3">
          <ListenMark className="block h-[14px] w-[14px] shrink-0 [filter:grayscale(1)_brightness(1.7)_opacity(0.7)] min-[560px]:h-[18px] min-[560px]:w-[18px]" />
          <span className="tracking-[0.1em] text-homepage-ink">Listen</span>
          <span className="truncate tracking-[0.04em] text-homepage-ink3">© {year} · all rights reserved</span>
        </div>
        <nav aria-label="Footer" className="flex shrink-0 items-center gap-3.5 min-[560px]:gap-[22px]">
          <Link
            href={FOOTER_LINKS.docs}
            className="tracking-[0.06em] text-homepage-ink2 transition-colors hover:text-homepage-ink"
          >
            docs
          </Link>
          <Link
            href={FOOTER_LINKS.twitter}
            aria-label="Listen on X"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-homepage-ink2 transition-colors hover:text-homepage-ink"
          >
            <XIcon className="h-3 w-3 min-[560px]:h-[14px] min-[560px]:w-[14px]" />
          </Link>
          <Link
            href={FOOTER_LINKS.discord}
            aria-label="Listen on Discord"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-homepage-ink2 transition-colors hover:text-homepage-ink"
          >
            <DiscordIcon className="h-3.5 w-3.5 min-[560px]:h-4 min-[560px]:w-4" />
          </Link>
        </nav>
      </div>
    </footer>
  );
}
