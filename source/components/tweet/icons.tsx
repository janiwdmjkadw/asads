/**
 * X-brand SVG icons (added under /public/assets). They carry X's real
 * baked colors (verified blue, like pink, comment grey, …), so we render
 * them as plain images rather than currentColor SVGs. The X logo stays an
 * inline `currentColor` SVG so it flips black/white with the theme.
 */

function xAssetIcon(file: string, defaultSize: number, label?: string) {
  return function XAssetIcon({ size = defaultSize }: { size?: number }) {
    return (
      <img
        src={`/assets/${file}`}
        alt=""
        aria-label={label}
        aria-hidden={label ? undefined : true}
        width={size}
        height={size}
        draggable={false}
        className="shrink-0"
        style={{ display: 'block' }}
      />
    );
  };
}

export const VerifiedBadge = xAssetIcon('x_blue_check_icon.svg', 15, 'Verified');
export const JoinedIcon = xAssetIcon('x_joined_icon.svg', 13);

/**
 * Engagement icons are tinted per action. The X assets are flat filled
 * shapes on a transparent ground, so (since an <img> can't be recolored) we
 * render the SVG as a CSS mask over a solid color and pick the color per
 * metric.
 */
const ICON_PINK = '#f91880'; // like
const ICON_GREEN = '#00ba7c'; // repost
const ICON_BLUE = '#1d9bf0'; // comment + bookmark
const ICON_PURPLE = '#8b5cf6'; // impressions

function maskIcon(file: string, defaultSize: number, color: string) {
  return function MaskIcon({ size = defaultSize }: { size?: number }) {
    const mask = `url(/assets/${file}) center / contain no-repeat`;
    return (
      <span
        aria-hidden
        className="block shrink-0"
        style={{ width: size, height: size, backgroundColor: color, mask, WebkitMask: mask }}
      />
    );
  };
}

export const HeartIcon = maskIcon('x_like_button_icon.svg', 15, ICON_PINK);
export const ReplyIcon = maskIcon('x_comment_icon.svg', 15, ICON_BLUE);
export const RepostIcon = maskIcon('x_repost_icon.svg', 15, ICON_GREEN);
export const EyeIcon = maskIcon('x_analytics_icon.svg', 14, ICON_PURPLE);
export const BookmarkIcon = maskIcon('x_bookmark_icon.svg', 14, ICON_BLUE);

export function XLogo({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
