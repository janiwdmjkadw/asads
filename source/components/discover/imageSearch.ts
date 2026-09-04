/*
 * ── SEARCHING A COIN'S ARTWORK ───────────────────────────────────────
 *
 * Lens takes an image by url and runs the reverse search itself, so
 * there is nothing to upload and no key: the whole action is a link.
 *
 * That is the search anybody actually wants on a coin picture — whether
 * this artwork has been used before, and by whom — and it is the one
 * question the ticker search in `TickerActionsPopover` cannot answer.
 *
 * Two callers share this: the row's thumbnail on the Discover board and
 * the enlarged hover preview on the cards.
 */

/** Reverse image search. Google fetches the url itself. */
const LENS_BY_URL = 'https://lens.google.com/uploadbyurl?url=';

/** Plain web search, for artwork Lens has no way to fetch. */
const WEB_SEARCH = 'https://www.google.com/search?q=';

/**
 * Only an absolute http(s) url can go to Lens — it is Google that
 * fetches the bytes, not the browser. A relative path or a data uri
 * would open a tab on an error page.
 */
export function isSearchableImage(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/**
 * Where the picture's search button goes.
 *
 * Real artwork reverse searches. Artwork that cannot be handed over —
 * the drawn placeholder a token with no image falls back to, and the
 * generated art on this board's fixtures — searches the words instead,
 * which is still what the label promises and is never a dead tab.
 * Without any of that, there is nothing to search and the button should
 * not be rendered at all: hence the null.
 */
export function imageSearchHref(
  src: string | null | undefined,
  fallbackQuery?: string | null,
): string | null {
  if (isSearchableImage(src)) return `${LENS_BY_URL}${encodeURIComponent(src)}`;
  const query = fallbackQuery?.trim();
  if (query) return `${WEB_SEARCH}${encodeURIComponent(query)}`;
  return null;
}
