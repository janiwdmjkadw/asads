import type { CSSProperties } from 'react';

/* The brand mark recolors with the active theme. An <img> can't be
   restyled (its gradient is baked into the file), so the logo silhouette
   is applied as a CSS mask and filled with the theme accent gradient
   (`--accent-primary` → `--accent-secondary`, injected by ThemeProvider
   on `.listen-root`). Theme switch → logo recolors for free. */
const markStyle: CSSProperties = {
  height: 22,
  width: 22,
  userSelect: 'none',
  background:
    'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
  WebkitMaskImage: "url('/assets/logo.svg')",
  maskImage: "url('/assets/logo.svg')",
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
};

export function BrandMark() {
  return (
    /*
     * THE MARK ALONE. The wordmark that used to sit beside it is gone.
     *
     * It was Geist Mono 20/28, and on a 56px bar that is the largest type
     * in the header by a wide margin — larger than the tabs it sits next
     * to, larger than anything on the board below. It was spending the
     * bar's loudest slot telling a signed in user the name of the app
     * they are already inside.
     *
     * The name is still in the tab title and on every surface a stranger
     * reaches first. Here the silhouette carries it, and roughly seventy
     * pixels go back to the bar.
     */
    <div className="flex items-center shrink-0">
      <span aria-hidden className="block shrink-0" style={markStyle} />
      {/* The accessible name the wordmark used to provide. */}
      <span className="sr-only">Listen</span>
    </div>
  );
}
