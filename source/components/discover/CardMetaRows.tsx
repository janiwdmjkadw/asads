import { Fragment, type ComponentType, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import {
  Users,
  Globe,
  Cpu,
  Crown,
  Eye,
  Search,
  Usdc,
} from '@/components/listen/icons/Icons';
import { compactNumber } from '@/lib/format';
import { useCreatorCoinStats } from '@/lib/api/creator-coins';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TweetHoverCard } from '@/components/tweet/TweetHoverCard';
import { WalletFundingHoverCard } from './WalletFundingHoverCard';
import { FeeShareHoverCard } from './FeeShareHoverCard';
import { hoverTweetId } from '@/lib/api/tweet';
import { isUsdcPair } from '@/lib/trade/spend-currency';
import { openWalletProfile } from '@/lib/state/wallet-profile-store';
import { useTrackedWalletsContext } from './TrackedWalletsProvider';
import { useCardArmed } from './cardArming';
import { displayName } from './trackedWallets';
import type { CoinLinks, CoinMode, FeeShareRecipient, Platform } from './mockCoins';
import type {
  EvmLaunchpad,
  EvmLaunchProfile,
  EvmLaunchVariant,
} from '@/lib/evm/discoverAdapter';
import { EvmLaunchpadBadge } from './EvmLaunchpadBadge';
import { explorerAddressUrl, explorerName } from '@/lib/evm/explorer';

interface IconProps {
  className?: string;
  style?: CSSProperties;
}

type MetaTintStyle = CSSProperties & { '--meta-tint': string };

export interface MetaRowCoin {
  /**
   * Mint pubkey, when available. Solana rows use it for the pump.fun token
   * page; chain-bound rows use `chain` + `chainAddress` for an exact explorer.
   */
  id?: string;
  ticker: string;
  ageLabel: string;
  /** Absent = not known (see `MockCoin.txns`), never "zero trades". */
  txns?: number;
  /** Absent = not scored. A `0` would be the WORST score, not "unscored". */
  score?: number;
  platforms?: Platform[];
  holderCount?: number;
  /** Live trade-page viewers (presence). Absent/null = unknown or zero —
   *  the cell hides rather than showing "0 watching". */
  viewers?: number | null;
  hasWebsite?: boolean;
  hasLink?: boolean;
  hasAgent?: boolean;
  links?: CoinLinks;
  /**
   * Active mutex mode. The contract enforces at most one of
   * mayhem/agent/cashback/charity. MetaRow renders a single tinted
   * icon for whichever mode is set; absent = no mode badge.
   */
  mode?: CoinMode;
  /**
   * Quote mint base58 for non-SOL pairs. USDC pairs render the Circle
   * USDC mark in the meta row (next to the tweet/pump glyphs); absent
   * or non-USDC = no marker.
   */
  quoteMint?: string | null;
  /**
   * Dev wallet (token creator). Present = IconRow renders the crown
   * "migrated/created" dev-history badge; absent = the badge collapses
   * (mock fixtures, alpha lane rows without a creator).
   */
  creator?: string | null;
  /**
   * The creator's launch tally when the ROW already carries it.
   *
   * Present = the crown badge renders from this and mounts NO query. A
   * chain-bound row's tally arrives on the wire (`creatorCreated` /
   * `creatorMigrated`), and routing it through `useCreatorCoinStats` instead
   * would ask the Solana creator endpoint about a `0x` address — a request
   * that can only come back empty, after which the badge collapses and a dev
   * with a launch history renders as none.
   */
  creatorStats?: { created: number; migrated: number };
  /**
   * Creator fee-sharing config (pfee program). The pie-chart badge
   * renders ONLY when `feeShareLocked` is true (shares permanently
   * set); its hover card shows the authority + shareholder split.
   */
  feeShareRecipients?: FeeShareRecipient[] | null;
  feeShareLocked?: boolean | null;
  feeShareAuthority?: string | null;
  /**
   * The row's CONTRACT address when it is chain-bound; absent on every Solana
   * row — the same "absent binding == Solana" rule as `MockCoin.chainBinding`,
   * of which this is the one field IconRow needs.
   *
   * A SCALAR, NOT THE BINDING OBJECT, deliberately. `cardAdapter.toDiscoverRow`
   * rebuilds `ChainBinding` on every clock tick, so a slice carrying the object
   * fails the live islands' content compare once a second and re-renders the
   * meta row forever. The address is a stable string and compares by `===`.
   *
   * IconRow reads it for two things a Solana-shaped assumption gets wrong on an
   * EVM row: the holder ESTIMATE (a pump.fun-shaped guess with no meaning off
   * Solana) and the X-search query (whose subject is the contract address, not
   * this row's chain-qualified store key).
   */
  chainAddress?: string;
  chain?: string;
  evmLaunchpad?: EvmLaunchpad;
  evmLaunchVariant?: EvmLaunchVariant;
  evmLaunchProfile?: EvmLaunchProfile | null;
}

export type MetaRowSize = 'sm' | 'md' | 'lg';

/* ---- size token tables ---------------------------------------------- */

const META_TEXT_CLS: Record<MetaRowSize, string> = {
  sm: 'text-[11px]',
  md: 'text-[13px]',
  lg: 'text-[15px]',
};
/* Outer button shell. Icon glyph sits centered inside.
   INVARIANT: `(META_BTN_PX - META_GLYPH_PX)` must be EVEN per size so the
   glyph's top edge inside its inline-flex `items-center` shell lands on a
   whole pixel. Same rationale as ROW_BOX_PX/ROW_ICON_PX in IconRow.
   sm shell 16px (was 18): on the merged card row (age + links + mode +
   search + holders share one line) every slot's 2px of shell chrome was
   the difference between fitting and clipping; glyph size is unchanged. */
const META_BTN_PX: Record<MetaRowSize, number> = { sm: 16, md: 22, lg: 30 };
const META_GLYPH_PX: Record<MetaRowSize, number> = { sm: 12, md: 14, lg: 18 };
const META_BTN_RADIUS: Record<MetaRowSize, number> = { sm: 2, md: 2, lg: 2 };
/* Gaps are pinned to whole CSS pixels. Tailwind's spacing scale resolves
   against the rem unit, which at this app's 14px root font size gives
   half-pixel values for many small classes (`gap-1` = 3.5px,
   `gap-1.5` = 5.25px). Those fractional gaps propagate down through the
   layout and shift the IconRow off a whole-pixel Y. */
const META_GAP_CLS: Record<MetaRowSize, string> = {
  sm: 'gap-[3px]',
  md: 'gap-[4px]',
  lg: 'gap-[6px]',
};

const ROW_TEXT_CLS: Record<Exclude<MetaRowSize, 'lg'>, string> = {
  sm: 'text-[10px]',
  md: 'text-[12px]',
};
/* IMPORTANT: keep `(ROW_BOX_PX - ROW_ICON_PX)` AND `(ROW_BOX_PX - textPx)`
   both EVEN per size. Centering the icon inside its row-height cell via
   grid/flex `place-items: center` resolves to `(box - icon) / 2`; when
   that is fractional (e.g. 16 − 11 = 5 ⇒ 2.5px), the icon's painted top
   edge rounds depending on the absolute Y of the row — which changes
   from section to section as the cumulative page Y parity flips. That
   is what made the same IconRow look aligned in Graduated and shifted
   in Almost Graduated. Keeping the difference even pins the icon's top
   edge to a whole pixel regardless of where on the page the row lives. */
const ROW_ICON_PX: Record<Exclude<MetaRowSize, 'lg'>, number> = { sm: 12, md: 14 };
const ROW_BOX_PX: Record<Exclude<MetaRowSize, 'lg'>, number> = { sm: 16, md: 18 };
const ROW_GAP_CLS: Record<Exclude<MetaRowSize, 'lg'>, string> = {
  sm: 'gap-[3px]',
  md: 'gap-[4px]',
};

/**
 * Compress a multi-unit age label down to its largest unit only.
 *
 *   '1h 08m'  -> '1h'
 *   '1d 4h'   -> '1d'
 *   '42m'     -> '42m'   (unchanged)
 *   '10s'     -> '10s'   (unchanged)
 *
 * Card real estate is tight — secondary units after the first are noise.
 */
function compactAge(label: string): string {
  const head = label.split(/\s+/)[0];
  return head ?? label;
}

/* ---- per-icon tints (matches Trade's TokenMetaRow vocabulary) -------
 *
 * The tint colors the hover shell (`--meta-tint` -> background +
 * border) and the icon glyph itself for `currentColor`-stroked SVGs.
 * Asset-baked SVGs (mayham/cashback/charity/youtube/blue-tweet) have
 * their fill colors fixed inside the asset, so the tint only colors
 * the surrounding shell on hover for those. */

const TINT_GLOBE = '#34d399'; // green — generic website (Globe)
const TINT_TELEGRAM = '#38e1ff'; // cyan — Telegram community link
const TINT_TWEET_BLUE = '#36d8ff'; // blue — Twitter / X (BlueTweetIcon)
const TINT_GITHUB = '#e5e7eb'; // bone — Github source link
const TINT_YOUTUBE = '#ff0033'; // red — YouTube link (matches the asset)
const TINT_PUMP = '#60cb8b'; // green — pump.fun launch page (matches Trade's TokenMetaRow)
const TINT_USDC = '#2775ca'; // Circle blue — USDC-quoted pair marker
const TINT_FEE_SHARE = '#a78bfa'; // violet — locked creator fee-sharing config
const TINT_MAYHEM = '#fb5374'; // red — Mayhem mode
const TINT_AGENT = '#fbbf24'; // amber — Tokenized agent
const TINT_CASHBACK = '#5ddf6c'; // green — Cashback mode
const TINT_CHARITY = '#ec4899'; // pink — Charity mode

function assetIcon(src: string): ComponentType<IconProps> {
  return function AssetIcon({ style, className }: IconProps) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        className={className}
        style={{ ...style, display: 'block' }}
      />
    );
  };
}

const BlueTweetIcon = assetIcon('/assets/blue_tweet_icon.svg');
const MayhemIcon = assetIcon('/assets/mayham_icon.svg');
const CashbackIcon = assetIcon('/assets/cashback_icon.svg');
const CharityIcon = assetIcon('/assets/charity_icon.svg');
const YoutubeIcon = assetIcon('/assets/youtube_icon.svg');
const PumpIcon = assetIcon('/assets/pump_icon.svg');

/* Remix pie-chart-2-line: locked creator fee-sharing badge. */
function PieChartIcon({ style, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M12 0.5C18.3513 0.5 23.5 5.64873 23.5 12C23.5 12.3369 23.4855 12.6704 23.4571 13H21.9506C21.4489 18.0533 17.1853 22 12 22C6.47715 22 2 17.5228 2 12C2 6.81465 5.94668 2.5511 11 2.04938V0.542876C11.3296 0.514488 11.6631 0.5 12 0.5ZM11 4.06189C7.05369 4.55399 4 7.92038 4 12C4 16.4183 7.58172 20 12 20C16.0796 20 19.446 16.9463 19.9381 13H11V4.06189ZM13 2.552V11H21.448C20.9827 6.55197 17.448 3.01732 13 2.552Z" />
    </svg>
  );
}

function GithubIcon({ style, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M12 2a10 10 0 00-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.9-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 015 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0012 2z" />
    </svg>
  );
}

/**
 * Square icon-only button shell. Used for the 3 feature-flag slots
 * (Globe / Link / Cpu) where there's no count.
 */
function MetaIconButton({
  Icon,
  tint,
  present = true,
  size,
  ariaLabel,
  href,
}: {
  Icon: ComponentType<IconProps>;
  tint: string;
  present?: boolean;
  size: MetaRowSize;
  ariaLabel: string;
  href?: string | null;
}) {
  /* Absent feature flags collapse out of the row entirely instead of
     rendering a greyed-out shell. Earlier we kept the shell to hold
     a constant card geometry; new direction is "remove, don't disable"
     so cards visually communicate which features the token actually
     ships. */
  if (!present) return null;

  const btn = META_BTN_PX[size];
  const glyph = META_GLYPH_PX[size];
  const radius = META_BTN_RADIUS[size];
  const shellStyle: MetaTintStyle = {
    width: btn,
    height: btn,
    borderRadius: radius,
    color: tint,
    '--meta-tint': tint,
  };

  /* `aria-label` carries the accessible name for screen readers; the
     native `title=…` attribute is intentionally dropped in favor of
     the shadcn Tooltip below, which gives us a styled themed hover
     label keyboard-accessible on focusable triggers. */
  const commonProps = {
    'aria-label': ariaLabel,
    className: 'meta-hover-shell inline-flex items-center justify-center shrink-0',
    style: shellStyle,
  };

  const icon = <Icon style={{ width: glyph, height: glyph, display: 'block' }} />;
  // Sink guard. Every `href` here originates in on-chain token metadata,
  // which an anonymous deployer controls, and React does not block a
  // `javascript:` URL. Most feeds normalize upstream — but one did not
  // (token search), which is exactly why this belongs at the sink: a new
  // feed added later inherits the guard instead of having to remember it.
  const safeHref = isSafeLinkHref(href) ? href : null;
  const trigger = safeHref ? (
    <a
      {...commonProps}
      href={safeHref}
      target="_blank"
      rel="noreferrer"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {icon}
    </a>
  ) : (
    <span role="img" {...commonProps}>
      {icon}
    </span>
  );

  return <CardTooltip content={ariaLabel}>{trigger}</CardTooltip>;
}

/**
 * Card-arming-aware shadcn Tooltip (see `cardArming.tsx`): until the
 * card has seen hover/focus intent, the trigger renders BARE — same
 * DOM, aria-label intact, none of the Radix wrapper render cost that
 * every feed tick would otherwise pay. Outside an arming scope the
 * context defaults to armed, so this is a plain Tooltip there.
 */
function CardTooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  const armed = useCardArmed();
  if (!armed) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Twitter slot. When `twitterUrl` is a specific `/status/<id>` tweet,
 * the X icon becomes a rich tweet-preview hover trigger (the icon still
 * links to X on click). Profile / community links and missing links
 * keep the plain icon-button + tooltip behavior — there is no single
 * tweet to preview for those.
 */
function TwitterMetaSlot({ twitterUrl, size }: { twitterUrl: string | null; size: MetaRowSize }) {
  const armed = useCardArmed();
  // No twitter link → no icon (the slot collapses out of the row entirely).
  if (!twitterUrl) return null;

  const tweetId = hoverTweetId(twitterUrl);

  if (!tweetId) {
    // Profile / community link (not a /status/ tweet) → plain icon that opens
    // X on click, no preview (there's no single tweet to show).
    return (
      <MetaIconButton
        Icon={BlueTweetIcon}
        tint={TINT_TWEET_BLUE}
        size={size}
        ariaLabel="Open on X"
        href={twitterUrl}
      />
    );
  }

  const btn = META_BTN_PX[size];
  const glyph = META_GLYPH_PX[size];
  const radius = META_BTN_RADIUS[size];
  const shellStyle: MetaTintStyle = {
    width: btn,
    height: btn,
    borderRadius: radius,
    color: TINT_TWEET_BLUE,
    '--meta-tint': TINT_TWEET_BLUE,
  };

  const anchor = (
    <a
      aria-label="Preview tweet"
      className="meta-hover-shell inline-flex shrink-0 items-center justify-center"
      style={shellStyle}
      href={twitterUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <BlueTweetIcon style={{ width: glyph, height: glyph, display: 'block' }} />
    </a>
  );

  /* Unarmed card: plain X link, no tweet-preview HoverCard mounted yet. */
  if (!armed) return anchor;

  return (
    <TweetHoverCard tweetId={tweetId} tweetUrl={twitterUrl ?? 'https://x.com'}>
      {anchor}
    </TweetHoverCard>
  );
}

function TelegramIcon({ style, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d="M21 3L3 10.5l6.5 2.5L12 21l3.5-6.5L21 3z" />
      <path d="M9.5 13L21 3" />
    </svg>
  );
}

/* ---- secondary-link slot ------------------------------------------- *
 *
 * Each card surfaces at most TWO link buttons in MetaRow: the Twitter
 * slot (always primary) and a single secondary slot. The secondary
 * slot picks ONE of telegram / website by priority — telegram wins
 * if present, otherwise we render the website with an icon chosen by
 * URL host (github, youtube, generic). Returning `null` collapses the
 * slot out of the row entirely. */

/**
 * True only for links safe to put in an `href`.
 *
 * Token socials come from on-chain metadata that an anonymous deployer
 * writes, and React will happily render `javascript:…` — which executes
 * in this origin, where the Clerk session lives. Only http(s) survives.
 */
export function isSafeLinkHref(raw: string | null | undefined): raw is string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return false;
  try {
    const url = new URL(raw, 'https://listen.money');
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** `href`-safe value, or null. */
function safeLinkOrNull(raw: string | null | undefined): string | null {
  return isSafeLinkHref(raw) ? raw : null;
}

interface SecondaryLink {
  Icon: ComponentType<IconProps>;
  tint: string;
  ariaLabel: string;
  href: string;
}

function pickSecondaryLink(links: CoinLinks | undefined): SecondaryLink | null {
  const telegram = safeLinkOrNull(links?.telegram);
  if (telegram) {
    return { Icon: TelegramIcon, tint: TINT_TELEGRAM, ariaLabel: 'Open Telegram', href: telegram };
  }
  const website = safeLinkOrNull(links?.website);
  if (!website) return null;
  const host = parseHost(website);
  if (host && /(?:^|\.)github\.com$/.test(host)) {
    return { Icon: GithubIcon, tint: TINT_GITHUB, ariaLabel: 'Open GitHub', href: website };
  }
  if (host && /(?:^|\.)(?:youtube\.com|youtu\.be)$/.test(host)) {
    return { Icon: YoutubeIcon, tint: TINT_YOUTUBE, ariaLabel: 'Open YouTube', href: website };
  }
  return { Icon: Globe, tint: TINT_GLOBE, ariaLabel: 'Open website', href: website };
}

function parseHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/* ---- mode slot ----------------------------------------------------- *
 *
 * One badge per card for the contract-level mutex mode. Asset SVGs
 * for mayhem/cashback/charity have the glyph color baked in; the
 * tint colors the hover shell. Agent uses the `currentColor`-stroked
 * Cpu glyph so its color follows the tint. */

interface ModeIconDef {
  Icon: ComponentType<IconProps>;
  tint: string;
  ariaLabel: string;
}

const MODE_ICON: Record<CoinMode, ModeIconDef> = {
  mayhem: { Icon: MayhemIcon, tint: TINT_MAYHEM, ariaLabel: 'Mayhem mode' },
  agent: { Icon: Cpu, tint: TINT_AGENT, ariaLabel: 'Tokenized agent' },
  cashback: { Icon: CashbackIcon, tint: TINT_CASHBACK, ariaLabel: 'Cashback mode' },
  charity: { Icon: CharityIcon, tint: TINT_CHARITY, ariaLabel: 'Charity mode' },
};

/**
 * Fee-share slot: pie-chart badge shown ONLY once the mint's creator
 * fee-sharing config is locked (`update_fee_shares[_v2]` observed —
 * the split is then permanent under pump.fun's one-time policy).
 * Hovering opens the fee-authority dossier; all data is already on
 * the streamed card, so the popover costs no fetch.
 */
function FeeShareMetaSlot({
  coin,
  size,
}: {
  coin: MetaRowCoin;
  size: MetaRowSize;
}) {
  const armed = useCardArmed();
  if (coin.feeShareLocked !== true) return null;
  const btn = META_BTN_PX[size];
  const glyph = META_GLYPH_PX[size];
  const shellStyle: MetaTintStyle = {
    width: btn,
    height: btn,
    borderRadius: META_BTN_RADIUS[size],
    color: TINT_FEE_SHARE,
    '--meta-tint': TINT_FEE_SHARE,
  };
  const badge = (
    <span
      role="img"
      aria-label="Creator fee sharing (locked)"
      className="meta-hover-shell inline-flex items-center justify-center shrink-0"
      style={shellStyle}
    >
      <PieChartIcon style={{ width: glyph, height: glyph, display: 'block' }} />
    </span>
  );

  /* Unarmed card: bare badge, no dossier HoverCard mounted yet. */
  if (!armed) return badge;

  return (
    <FeeShareHoverCard
      authority={coin.feeShareAuthority ?? null}
      recipients={coin.feeShareRecipients ?? []}
      locked
    >
      {badge}
    </FeeShareHoverCard>
  );
}

/**
 * MetaRow — primary identity row on cards.
 *
 * Slots, left → right:
 *
 *   [age]  [twitter]  [token-link]  [secondary-link]  [mode]  [fee-share]
 *
 * - Age: plain text (compacted to a single unit).
 * - Twitter: tweet/X link, rendered whenever `links.twitter` is set.
 * - Token link: pump.fun for Solana; the exact chain explorer for EVM.
 *   Unknown/malformed chain-bound subjects fail closed with no link.
 * - Secondary link: AT MOST ONE of telegram / website. Telegram wins
 *   if present; otherwise the website renders with a host-aware icon
 *   (github / youtube / generic globe). See `pickSecondaryLink()`.
 * - Mode: AT MOST ONE of mayhem / agent / cashback / charity. The
 *   pump.fun contract makes these mutex, so MetaRow simply reads
 *   `coin.mode` (with a legacy fallback to the first matching entry
 *   in `coin.kinds` during the migration window — see `pickMode()`).
 * - Fee-share: pie-chart badge when the creator fee-sharing config is
 *   locked; hover opens the fee-authority dossier (see
 *   `FeeShareMetaSlot`).
 *
 * Absent slots collapse out of the row entirely; the row never
 * renders a greyed-out shell as a placeholder.
 */
export function MetaRow({
  coin,
  size = 'sm',
}: {
  coin: MetaRowCoin & { kinds?: CoinMode[] | readonly string[] };
  size?: MetaRowSize;
}) {
  const chainAddress = coin.chainAddress;
  const isEvm = chainAddress !== undefined;
  const tokenUrl = chainAddress !== undefined
    ? coin.chain === undefined
      ? null
      : explorerAddressUrl(coin.chain, chainAddress)
    : coin.id
      ? `https://pump.fun/${coin.id}`
      : null;
  const tokenLinkLabel = isEvm
    ? `Open on ${coin.chain === undefined ? 'chain explorer' : (explorerName(coin.chain) ?? 'chain explorer')}`
    : 'Open on pump.fun';
  // Guarded at derivation: both feed <a href> below and both come from
  // attacker-writable on-chain metadata.
  const twitterUrl = safeLinkOrNull(coin.links?.twitter);
  const secondary = pickSecondaryLink(coin.links);
  const mode = pickMode(coin);
  const modeDef = mode ? MODE_ICON[mode] : null;
  const textCls = META_TEXT_CLS[size];
  const gapCls = META_GAP_CLS[size];
  const rowHeight = META_BTN_PX[size];

  return (
    /* Tooltip delay/skip config comes from a single page-level
       `TooltipProvider` (mounted once by `DiscoverPage`), not one per
       card -- mounting ~150 providers was pure overhead and is the
       opposite of Radix's intended usage (one provider wrapping many
       tooltips). */
    <div
      className={`flex items-center ${gapCls} ${textCls} min-w-0 overflow-hidden tabular-nums leading-none`}
      style={{ fontFamily: 'var(--mono)', height: rowHeight }}
    >
      <span
        className="inline-flex h-full shrink-0 items-center font-semibold"
        style={{ color: 'var(--up)' }}
      >
        {compactAge(coin.ageLabel)}
      </span>
      {coin.chain !== undefined
        && coin.evmLaunchpad !== undefined
        && coin.evmLaunchVariant !== undefined ? (
          <EvmLaunchpadBadge
            chain={coin.chain}
            launchpad={coin.evmLaunchpad}
            launchVariant={coin.evmLaunchVariant}
            profile={coin.evmLaunchProfile}
          />
        ) : null}
      <TwitterMetaSlot twitterUrl={twitterUrl} size={size} />
      {tokenUrl ? (
        <MetaIconButton
          Icon={isEvm ? Globe : PumpIcon}
          tint={isEvm ? TINT_GLOBE : TINT_PUMP}
          size={size}
          ariaLabel={tokenLinkLabel}
          href={tokenUrl}
        />
      ) : null}
      {/* USDC-quoted pair marker: the quickbuy/trade surfaces for this
          coin spend + settle USDC. Brand-colored Circle mark (fixed
          fills), shelled like the other meta glyphs. */}
      {isUsdcPair(coin.quoteMint) ? (
        <MetaIconButton
          Icon={Usdc}
          tint={TINT_USDC}
          size={size}
          ariaLabel="USDC pair"
        />
      ) : null}
      {secondary ? (
        <MetaIconButton
          Icon={secondary.Icon}
          tint={secondary.tint}
          size={size}
          ariaLabel={secondary.ariaLabel}
          href={secondary.href}
        />
      ) : null}
      {modeDef ? (
        <MetaIconButton
          Icon={modeDef.Icon}
          tint={modeDef.tint}
          size={size}
          ariaLabel={modeDef.ariaLabel}
        />
      ) : null}
      <FeeShareMetaSlot coin={coin} size={size} />
    </div>
  );
}

/**
 * Resolve the active mode for rendering. Prefers the canonical
 * `coin.mode` field. Falls through to the deprecated `coin.kinds`
 * array (first matching mode value) so older cached payloads still
 * render their mode badge during the transition window.
 */
function pickMode(coin: MetaRowCoin & { kinds?: readonly string[] }): CoinMode | null {
  if (coin.mode) return coin.mode;
  const kinds = coin.kinds;
  if (!kinds || kinds.length === 0) return null;
  for (const kind of kinds) {
    if (kind === 'mayhem' || kind === 'agent' || kind === 'cashback' || kind === 'charity') {
      return kind;
    }
  }
  return null;
}

/* Crown badge gold — matches Axiom's migrated-dev crown. Grey when the
   dev has zero migrations. */
const CROWN_GOLD = '#fbbf24';

interface CrownChrome {
  textCls: string;
  iconCellStyle: CSSProperties;
  valueStyle: CSSProperties;
  iconPx: number;
}

/**
 * The crown badge's MARKUP, given a tally. No data access at all.
 *
 * Split out because the tally now has two sources — a react-query lookup on a
 * Solana row, and the row itself on a chain-bound one — and a component that
 * calls a hook cannot skip it conditionally. One presentation, two callers, so
 * the two chains cannot drift into different-looking crowns.
 */
function CrownBadgeChrome({
  stats,
  textCls,
  iconCellStyle,
  valueStyle,
  iconPx,
}: CrownChrome & { stats: { created: number; migrated: number } }) {
  /* A dev with no launches on record has nothing to say. Note this is
     `created === 0` and NOT "no stats": an absent record never reaches here,
     because neither caller invents a `{0, 0}` to stand in for one. */
  if (stats.created === 0) return null;
  const crowned = stats.migrated > 0;
  const fmt = (value: number) => (value > 999 ? compactNumber(value) : String(value));
  return (
    <CardTooltip
      content={`Dev migrations: ${stats.migrated} of ${stats.created} coins created`}
    >
      <span className="inline-flex items-center gap-[2px] shrink-0">
        <span style={iconCellStyle}>
          <Crown
            style={{
              width: iconPx,
              height: iconPx,
              color: crowned ? CROWN_GOLD : 'var(--ink-3)',
              flexShrink: 0,
              display: 'block',
            }}
          />
        </span>
        <span className={textCls} style={valueStyle}>
          {fmt(stats.migrated)}/{fmt(stats.created)}
        </span>
      </span>
    </CardTooltip>
  );
}

/**
 * Crown "migrated/created" badge: how many of this dev's deployed coins
 * graduated. Isolated component so the react-query hook only mounts when
 * the card actually carries a creator (IconRow renders in hook-free SSR
 * tests, and mock fixtures have no creator).
 *
 * THE QUERY IS SOLANA'S. `useCreatorCoinStats` hits the Solana creator-coins
 * endpoint, which is keyed by a base58 mint authority and knows nothing about
 * a `0x` address — so this component must never mount for a chain-bound row.
 * IconRow enforces that by preferring `coin.creatorStats`, which such a row
 * always carries when the fold has a record.
 */
function CreatorCrownBadge({ creator, ...chrome }: CrownChrome & { creator: string }) {
  const stats = useCreatorCoinStats(creator);
  if (!stats) return null;
  return <CrownBadgeChrome stats={stats} {...chrome} />;
}

/**
 * IconRow — search glyph + crown dev-history badge + holder count.
 * (The old traders/viewers readouts were mock-data heuristics derived
 * from `score`/`txns` already on the card — zero real information —
 * and were dropped when the row merged onto MetaRow's line.)
 *
 * Kept as plain inline icons (not button-shelled) — IconRow's purpose
 * is dense numeric readout, not action affordance, so the shell would
 * just steal horizontal space.
 */
export function IconRow({
  coin,
  size = 'sm',
}: {
  coin: MetaRowCoin;
  /* `lg` doesn't apply to IconRow; only `sm` and `md` are meaningful here. */
  size?: Exclude<MetaRowSize, 'lg'>;
}) {
  /* Routed through `compactNumber()` so 999_999 reads as `1.0M` — raw
     integers exploded the row width at any non-trivial scale.

     The `txns / 40` term is an ESTIMATE, not a measurement, and it stands
     only because a Solana row always carries a real trade count. When
     NEITHER a holder count nor a trade count is known there is nothing to
     estimate from, and the honest render is the unknown mark — inventing
     "1" from an absent numerator would be a fabricated holder population.
     Solana rows never reach that branch (`txns` is always set), so this
     row is unchanged for them.

     IT IS SOLANA-ONLY, AND THAT IS ENFORCED HERE. The ratio is a pump.fun
     shape — one holder per ~40 trades on a bonding curve with pump.fun's
     economics — and it means nothing on a four.meme curve or a Pancake
     pool. `cardAdapter.ts` already leaves `holderCount` genuinely absent
     for exactly this reason, and its comment says the estimate is what it
     is avoiding; without this gate the absence fell straight through to
     `txns` (which an EVM row DOES carry) and the card rendered the guess
     anyway, defeating the adapter. A chain-bound row therefore gets the
     unknown mark, never an estimate: absent binding == Solana. */
  const isChainBound = coin.chainAddress !== undefined;
  const holderCount =
    coin.holderCount !== undefined
      ? compactNumber(coin.holderCount)
      : !isChainBound && coin.txns !== undefined
        ? compactNumber(Math.max(1, Math.round(coin.txns / 40)))
        : '—';

  const textCls = ROW_TEXT_CLS[size];
  const iconPx = ROW_ICON_PX[size];
  const gapCls = ROW_GAP_CLS[size];
  const rowHeight = ROW_BOX_PX[size];
  /* Every cell — icon-cell and value-cell — renders as a flex/grid box
     that owns its own explicit height equal to `rowHeight`. The icon is
     a `display: block` glyph centered inside a row-height grid cell; the
     digit lives in a `display: flex; align-items: center` value cell
     with `line-height: 1` so the text box collapses to font-size and
     centers cleanly. There is intentionally NO `vertical-align`, NO
     `inline-block`, and NO inherited line-height anywhere in the row —
     those models route alignment through the line-box strut, which is
     sensitive to inherited font metrics and is what made the same
     IconRow visually drift between sections. */
  const mutedIconStyle: CSSProperties = {
    width: iconPx,
    height: iconPx,
    color: 'var(--ink-3)',
    flexShrink: 0,
    display: 'block',
  };
  const iconCellStyle: CSSProperties = {
    width: iconPx,
    height: rowHeight,
    display: 'grid',
    placeItems: 'center',
  };
  const valueStyle: CSSProperties = {
    color: 'var(--ink-0)',
    fontWeight: 600,
    height: rowHeight,
    display: 'flex',
    alignItems: 'center',
    lineHeight: 1,
  };
  /* `gap-[2px]` — explicit whole-pixel gap. Tailwind's `gap-0.5` is
     0.125rem which resolves to 1.75px at the app's 14px root font size,
     a fractional gap that adds another rounding gremlin between the
     icon cell and the value cell. */
  const statItemClass = 'inline-flex items-center gap-[2px] shrink-0';

  /* Search glyph links to an X (Twitter) search of the contract address —
     the fastest "what is CT saying about this CA" lookup. Collapses to
     a plain glyph for mock fixtures without a real mint.

     THE SUBJECT IS THE ADDRESS, NOT THE ROW KEY. `coin.id` is the store
     key, and on a chain-bound row that key is chain-qualified (`bsc:0x…`)
     precisely because the same address exists on four EVM chains. Nobody
     posts the qualified form, so searching it returns zero results on
     every EVM card — the binding carries the bare address and that is what
     a human would paste. Solana's `id` IS the mint, so it is unchanged. */
  const searchSubject = coin.chainAddress ?? coin.id;
  const xSearchUrl = searchSubject
    ? `https://x.com/search?q=${encodeURIComponent(searchSubject)}`
    : null;

  return (
    /* Order = clip priority on the merged card row (the wrapper is
       overflow-hidden and clips from the END): crown + holders are real
       signal and render first; the X-search glyph is a convenience link
       and yields first on narrow cards. */
    <div
      className={`flex items-center ${gapCls} tabular-nums leading-none`}
      style={{ color: 'var(--ink-1)', fontFamily: 'var(--mono)', height: rowHeight }}
    >
      {/* THE ROW'S OWN TALLY WINS, and on a chain-bound row it is the ONLY
          source. `CreatorCrownBadge` resolves its numbers from the Solana
          creator-coins endpoint; asked about a `0x` address that endpoint can
          only answer empty, so an EVM dev with forty launches rendered no
          crown at all while spending a request to find that out. The wire
          carries `creatorCreated`/`creatorMigrated` on every such card.

          A chain-bound row with NO tally renders no crown and mounts no query
          either — its record is genuinely absent (the producer refuses to
          serve a `{0, 0}` for one), and falling through to the Solana lookup
          would be the same wrong request one branch later. */}
      {coin.creatorStats ? (
        <CrownBadgeChrome
          stats={coin.creatorStats}
          textCls={textCls}
          iconCellStyle={iconCellStyle}
          valueStyle={valueStyle}
          iconPx={iconPx}
        />
      ) : coin.creator && !isChainBound ? (
        <CreatorCrownBadge
          creator={coin.creator}
          textCls={textCls}
          iconCellStyle={iconCellStyle}
          valueStyle={valueStyle}
          iconPx={iconPx}
        />
      ) : null}
      <CardTooltip content="Holders">
        <span className={statItemClass}>
          <span style={iconCellStyle}>
            <Users style={mutedIconStyle} />
          </span>
          <span className={textCls} style={valueStyle}>
            {holderCount}
          </span>
        </span>
      </CardTooltip>
      {/* Live viewers (presence): REAL people on this trade page right
          now, unlike the estimated holder ratio above. Hidden until the
          overlay reports a non-zero count — absent must never read as
          "0 watching". */}
      {typeof coin.viewers === 'number' && coin.viewers > 0 ? (
        <CardTooltip content="Watching now">
          <span className={statItemClass}>
            <span style={iconCellStyle}>
              <Eye style={mutedIconStyle} />
            </span>
            <span className={textCls} style={valueStyle}>
              {compactNumber(coin.viewers)}
            </span>
          </span>
        </CardTooltip>
      ) : null}
      {xSearchUrl ? (
        <CardTooltip content="Search CA on X">
          <a
            style={iconCellStyle}
            href={xSearchUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Search mint on X"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Search style={mutedIconStyle} />
          </a>
        </CardTooltip>
      ) : (
        <span style={iconCellStyle}>
          <Search style={mutedIconStyle} aria-label="Search" />
        </span>
      )}
    </div>
  );
}

/* ---- MetricsRow ------------------------------------------------------ *
 *
 * Bottom card row: dev / sniper / bundle / insider holdings as % of
 * total supply, streamed live from the ingestion engine. Same dense
 * icon+value readout model as IconRow (no button shells; each metric's
 * label rides a shadcn Tooltip on the icon), sharing its
 * pixel-alignment tokens. */

/* Lucide chef-hat: the dev (cooked this token up). */
function ChefHatIcon({ style, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z" />
      <path d="M6 17h12" />
    </svg>
  );
}

/* Remix crosshair-2-line: snipers. */
function CrosshairIcon({ style, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M11 5.07089C7.93431 5.5094 5.5094 7.93431 5.07089 11H7V13H5.07089C5.5094 16.0657 7.93431 18.4906 11 18.9291V17H13V18.9291C16.0657 18.4906 18.4906 16.0657 18.9291 13H17V11H18.9291C18.4906 7.93431 16.0657 5.5094 13 5.07089V7H11V5.07089ZM3.05493 11C3.51608 6.82838 6.82838 3.51608 11 3.05493V1H13V3.05493C17.1716 3.51608 20.4839 6.82838 20.9451 11H23V13H20.9451C20.4839 17.1716 17.1716 20.4839 13 20.9451V23H11V20.9451C6.82838 20.4839 3.51608 17.1716 3.05493 13H1V11H3.05493ZM14 12C14 13.1046 13.1046 14 12 14C10.8954 14 10 13.1046 10 12C10 10.8954 10.8954 10 12 10C13.1046 10 14 10.8954 14 12Z" />
    </svg>
  );
}

/* Lucide boxes: bundled buys. */
function BundleIcon({ style, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" />
      <path d="m7 16.5-4.74-2.85" />
      <path d="m7 16.5 5-3" />
      <path d="M7 16.5v5.17" />
      <path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" />
      <path d="m17 16.5-5-3" />
      <path d="m17 16.5 4.74-2.85" />
      <path d="M17 16.5v5.17" />
      <path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" />
      <path d="M12 8 7.26 5.15" />
      <path d="m12 8 4.74-2.85" />
      <path d="M12 13.5V8" />
    </svg>
  );
}

/* Remix ghost-line: transferred-in wallets that never bought. */
function InsiderIcon({ style, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M12 2C16.9706 2 21 6.02944 21 11V18.5C21 20.433 19.433 22 17.5 22C16.3001 22 15.2413 21.3962 14.6107 20.476C14.0976 21.3857 13.1205 22 12 22C10.8795 22 9.9024 21.3857 9.38728 20.4754C8.75869 21.3962 7.69985 22 6.5 22C4.63144 22 3.10487 20.5357 3.00518 18.692L3 18.5V11C3 6.02944 7.02944 2 12 2ZM12 4C8.21455 4 5.1309 7.00478 5.00406 10.7593L5 11L4.99927 18.4461L5.00226 18.584C5.04504 19.3751 5.70251 20 6.5 20C6.95179 20 7.36652 19.8007 7.64704 19.4648L7.73545 19.3478C8.57033 18.1248 10.3985 18.2016 11.1279 19.4904C11.3053 19.8038 11.6345 20 12 20C12.3651 20 12.6933 19.8044 12.8687 19.4934C13.5692 18.2516 15.2898 18.1317 16.1636 19.2151L16.2606 19.3455C16.5401 19.7534 16.9976 20 17.5 20C18.2797 20 18.9204 19.4051 18.9931 18.6445L19 18.5V11C19 7.13401 15.866 4 12 4ZM12 12C13.1046 12 14 13.1193 14 14.5C14 15.8807 13.1046 17 12 17C10.8954 17 10 15.8807 10 14.5C10 13.1193 10.8954 12 12 12ZM9.5 8C10.3284 8 11 8.67157 11 9.5C11 10.3284 10.3284 11 9.5 11C8.67157 11 8 10.3284 8 9.5C8 8.67157 8.67157 8 9.5 8ZM14.5 8C15.3284 8 16 8.67157 16 9.5C16 10.3284 15.3284 11 14.5 11C13.6716 11 13 10.3284 13 9.5C13 8.67157 13.6716 8 14.5 8Z" />
    </svg>
  );
}

export interface MetricsRowCoin {
  /** Dev wallet (token creator). Present = the dev chip becomes a
   *  funding hover-card trigger; absent = plain readout. */
  creator?: string | null;
  devHoldingsPct?: number | null;
  sniperHoldingsPct?: number | null;
  bundlerHoldingsPct?: number | null;
  insiderHoldingsPct?: number | null;
  /**
   * WHY the percentages above are absent, as a sentence for the chip tooltip.
   *
   * The chips already render `—` for an absent share and must keep doing so —
   * a `0%` dev share is a positive claim that the creator holds nothing, and
   * printing one about a token whose classes were never anchored is a
   * fabricated all-clear on the card's only security row. What this adds is
   * the account of itself: `unanchored` never resolves, `supply_unknown`
   * resolves on the next successful call, and a bare dash cannot tell a reader
   * which they are looking at.
   */
  holdingsUnavailableReason?: string;
  /** Qualifiers on PRESENT shares — overlapping dev/sniper buckets, or a
   *  wallet cap that makes each share a lower bound. */
  holdingsQualifier?: string;
}

interface HolderMetricDef {
  key: keyof MetricsRowCoin;
  Icon: ComponentType<IconProps>;
  label: string;
  /** Values above this % render in the warn color instead of green. */
  warnAbovePct: number;
}

/* Axiom's card order: dev, snipers, insiders, bundlers — users A/B the
   two screens side by side, so ours matches. */
const HOLDER_METRICS: HolderMetricDef[] = [
  { key: 'devHoldingsPct', Icon: ChefHatIcon, label: 'Dev Holding', warnAbovePct: 5 },
  { key: 'sniperHoldingsPct', Icon: CrosshairIcon, label: 'Snipers Holding', warnAbovePct: 10 },
  { key: 'insiderHoldingsPct', Icon: InsiderIcon, label: 'Insiders Holding', warnAbovePct: 5 },
  { key: 'bundlerHoldingsPct', Icon: BundleIcon, label: 'Bundler Holding', warnAbovePct: 20 },
];

/**
 * Compact percent readout: whole percent, HARD-capped at two digits
 * ("0%".."99%") so four metrics always fit the row budget. No decimals
 * by design; 99.5+ clamps to 99% rather than growing to three digits.
 */
function formatHoldingsPct(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(Math.max(0, Math.min(100, value)));
  return `${Math.min(99, rounded)}%`;
}

/* Dev-sold state: exactly-zero dev holdings render a blue "DS" instead
   of "0%" (Axiom's convention — a fully-exited dev is a distinct signal,
   not just a healthy-green zero). Strictly === 0: the ledger pins dev
   balance to chain truth, so a full exit is a true zero while dust
   holdings still read "0%" green. Same 2-char width as "0%", so the
   row budget is unaffected. */
const DEV_SOLD_COLOR = '#38bdf8';

/**
 * What one holdings chip's tooltip says.
 *
 * Exported and pure because the tooltip CONTENT never reaches static markup —
 * Radix mounts it on open — so a render test cannot see it. This is the part
 * worth pinning: the chip's own glyph is a bare `—` for an absent share, and
 * the whole question is whether a reader can find out that the dash means
 * "this token was never anchored, so no share of it can ever be measured"
 * rather than "the backfill has not reached it yet". Only one of those
 * improves by waiting.
 *
 * A PRESENT share gets the qualifiers instead: the dev bucket overlaps the
 * sniper bucket, and a truncated wallet scan makes every figure a lower bound.
 * Both change how the number should be read, and neither is visible in it.
 */
export function holdingsChipTooltip(input: {
  label: string;
  devSold: boolean;
  value: number | null;
  coin: Pick<MetricsRowCoin, 'holdingsUnavailableReason' | 'holdingsQualifier'>;
}): string {
  const head = input.devSold ? 'Dev sold' : input.label;
  const detail = input.value === null
    ? input.coin.holdingsUnavailableReason
    : input.coin.holdingsQualifier;
  return detail === undefined ? head : `${head} — ${detail}`;
}

/**
 * MetricsRow — bottom stat row: four icon+percent holder metrics
 * (dev / sniper / bundle / insider), green when healthy and warn-red
 * above per-metric thresholds. Unhydrated values render a muted em
 * dash, filled in when the engine/backfill hydrates the mint.
 */
/* MetricsRow runs its own (smaller) size tokens instead of sharing
   IconRow's: four icon+"99%" pairs must fit a ~116px column in the
   worst case, which IconRow's 12px icons + 10px digits overflow by
   ~20px. 10px icons keep the even-parity centering rule (16 − 10 = 6).

   Wider cards (the card is a container via CoinCard's `@container`
   class) upgrade once at `@[300px]`: 16px icons + 12px digits, held
   through every wider tier — the row is the card's densest signal and
   sizing it DOWN on wide cards made it the smallest ink on the card.
   300 (not the old 340): in the current layout the row is a FULL-WIDTH
   band below the image on every card narrower than the beside-image
   breakpoint, so even the minimum card (--card-min 312) gives it
   ~298px — the 340 gate was tuned for the retired stat-column layout
   and silently kept ROW VIEW (312px slots) on the tiny base tier
   ("definitely too small... looks great in column view just not row
   view"). The base tier survives only for sub-300px edge cases.
   Sizes stay class-driven (not inline px) so container queries win. */
const METRICS_ICON_CLS: Record<Exclude<MetaRowSize, 'lg'>, string> = {
  /* 10px at every tier (was 16 as bare chips, then 12): inside the
     capsule the border carries the visual weight, so the icon sits a
     hair under the 12px value text — the reference's pill proportion. */
  sm: 'w-[10px] h-[10px]',
  md: 'w-3 h-3',
};
const METRICS_ICON_CELL_CLS: Record<Exclude<MetaRowSize, 'lg'>, string> = {
  sm: 'w-[10px]',
  md: 'w-3',
};
const METRICS_TEXT_CLS: Record<Exclude<MetaRowSize, 'lg'>, string> = {
  /* 10px to match the icons — icon and value share one cap height
     inside the capsule (9px only on the sub-300 edge-case tier). */
  sm: 'text-[9px] @[300px]:text-[10px]',
  md: 'text-[11px]',
};
/* Capsule chrome is BACK (restored from the pre-redesign pill chips,
   per request — the reference also rings each icon+value pair): from
   the @300 tier up every chip is a hairline-bordered rounded-full
   capsule with a faint fill. Below 300px chips stay bare. */
const METRICS_PILL_CLS: Record<Exclude<MetaRowSize, 'lg'>, string> = {
  sm: 'h-full gap-[1px] @[300px]:gap-[3px] @[300px]:rounded-full @[300px]:border @[300px]:border-[var(--hairline)] @[300px]:bg-white/[0.04] @[300px]:px-[6px]',
  md: 'h-full gap-[1px]',
};
/* Row height: NATURAL, not h-full. In CoinCard the row is the last child
   of a justify-between column — if it stretched, its box would start at
   the image's bottom edge and the chips would float centered inside the
   slack (visually glued to the image, dead space below). A fixed own
   height pins the chips flush to the card's bottom padding.

   Each tier's height EQUALS its tallest ink (base: 10px icons; @340:
   14px icons; @430: the capsule border IS the box edge). The card's
   vertical rhythm is judged against visible ink — a 16px box around
   14px ink floated the glyphs ~3px above the box bottom, so the bottom
   inset read ~10px while the image frame at the top read ~7px ("still
   doesn't feel like equal padding"). */
const METRICS_ROW_H_CLS: Record<Exclude<MetaRowSize, 'lg'>, string> = {
  /* Every tier's height = its tallest VISIBLE ink: bare 10px icons on
     the sub-300 tier; from @300 up the capsule border is the box edge —
     18px capsule around the 12px icon/text leaves 2px air per side.
     Band form re-splits its remaining slack via CoinCard's asymmetric
     12/6 vertical pads. */
  sm: 'h-[12px] @[300px]:h-[18px]',
  md: 'h-full',
};

/* Placement-coupled justify (see CoinCard's adaptive metrics row): below
   `besideMin` the row is a full-width band under the image, spread by
   justify-between with a px-1 inset each side ("feels a little too
   spread out, it can come in a little bit" — edge-to-edge read wider
   than the rows above). At/above it the row sits beside the image
   inside the text column, where it left-aligns with the other rows on
   even 12px gaps (the cohesive train read). Both variants are static
   strings so Tailwind's scanner sees every class. Arbitrary px (not the
   spacing scale): the 14px root font makes scale utilities fractional. */
const METRICS_JUSTIFY_CLS: Record<430 | 560, string> = {
  /* Band min-gap is 4px (was 8): justify-between spreads chips out when
     there's room, so the gap only binds when the row is TIGHT — exactly
     the tracked-dev-chip case, where those 16px decide whether the
     wallet address prefix fits (row view's band is ~205px). */
  430: 'justify-between gap-[4px] px-[4px] @[430px]:justify-start @[430px]:gap-[12px] @[430px]:px-0',
  560: 'justify-between gap-[4px] px-[4px] @[560px]:justify-start @[560px]:gap-[12px] @[560px]:px-0',
};

export function MetricsRow({
  coin,
  size = 'sm',
  besideMin = 430,
}: {
  coin: MetricsRowCoin;
  size?: Exclude<MetaRowSize, 'lg'>;
  /** Container width at which the row moves beside the image (matches
   *  CoinCard's grid placement breakpoint for this card). */
  besideMin?: 430 | 560;
}) {
  const armed = useCardArmed();
  const textCls = METRICS_TEXT_CLS[size];
  const iconCls = METRICS_ICON_CLS[size];
  const iconCellCls = METRICS_ICON_CELL_CLS[size];
  const pillCls = METRICS_PILL_CLS[size];
  const rowHCls = METRICS_ROW_H_CLS[size];
  const justifyCls = METRICS_JUSTIFY_CLS[besideMin];

  /* Chip order: dev % + its tracked-dev chip (paired below), then the
     rest. Two reasons: the tracker chip sits beside the signal it
     annotates (this dev is on your tracker — same placement as the
     reference), and the row clips from the END under overflow-hidden,
     so on a worst-case band the casualty is the last percent chip —
     never the tracked wallet's identity. */
  const chips = HOLDER_METRICS.map(({ key, Icon, label, warnAbovePct }) => {
        const raw = coin[key];
        const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
        const devSold = key === 'devHoldingsPct' && value === 0;
        const color = devSold
          ? DEV_SOLD_COLOR
          : value === null
            ? 'var(--ink-3)'
            : value > warnAbovePct
              ? 'var(--down)'
              : 'var(--up)';
        const devWallet = key === 'devHoldingsPct' ? (coin.creator ?? null) : null;
        const tooltip = holdingsChipTooltip({ label, devSold, value, coin });
        const chip = (
          <span className={`inline-flex items-center shrink-0 ${pillCls}`}>
            <span className={`${iconCellCls} grid h-full place-items-center`}>
              <Icon className={`${iconCls} block shrink-0`} style={{ color }} />
            </span>
            <span
              className={`${textCls} flex h-full items-center`}
              style={{
                color,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              {devSold ? 'DS' : value === null ? '—' : formatHoldingsPct(value)}
            </span>
          </span>
        );
        /* The funding hover card owns the whole dev chip when a wallet is
           known; the label tooltip is suppressed there so the two popovers
           never fight. Everywhere else the WHOLE capsule (icon + percent)
           is the tooltip trigger. Unarmed cards render the bare chip
           (cardArming) — no hover machinery until real intent. */
        if (devWallet) {
          if (!armed) return <Fragment key={key}>{chip}</Fragment>;
          return (
            <WalletFundingHoverCard key={key} wallet={devWallet}>
              {chip}
            </WalletFundingHoverCard>
          );
        }
        return (
          <CardTooltip key={key} content={tooltip}>
            {chip}
          </CardTooltip>
        );
      });
  /* The tracked chip is GLUED to the dev metric — one flex unit on a
     fixed 4px pair gap — so "0% 🍖dev" (or "DS 🍖dev") reads as a single
     annotated stat and justify-between can never spread the pair apart.
     TrackedDevChip renders null for untracked creators, leaving the
     plain dev chip. */
  const devGroup = coin.creator ? (
    <span key="dev-group" className="inline-flex h-full shrink-0 items-center gap-[4px]">
      {chips[0]}
      <TrackedDevChip creator={coin.creator} textCls={textCls} />
    </span>
  ) : (
    chips[0]
  );

  return (
    <div
      className={`flex ${rowHCls} items-center ${justifyCls} min-w-0 overflow-hidden tabular-nums leading-none`}
      style={{ fontFamily: 'var(--mono)' }}
    >
      {devGroup}
      {chips.slice(1)}
    </div>
  );
}

/**
 * Tracked-wallet dev chip: when the coin's creator is on the viewer's
 * wallet tracker, the tracker's own emoji + label render at the end of
 * the metrics row ("🍖 bwam…") — the strongest deploy signal the card
 * can show. Renders nothing for untracked creators, so the row budget
 * is unchanged in the common case. Isolated component so the tracker
 * context reads only on cards that carry a creator. Clicking opens the
 * wallet profile (same as tracker rows/caller chips); propagation stops
 * so the card's navigate handler doesn't also fire.
 */
function TrackedDevChip({ creator, textCls }: { creator: string; textCls: string }) {
  const trackedWallets = useTrackedWalletsContext();
  const wallet = trackedWallets.lookup(creator);
  if (!wallet) return null;
  const name = displayName(wallet);
  const shortName = name.length > 12 ? `${name.slice(0, 12)}…` : name;
  /* Band-form budget: a tracked card's metrics row stays a full-width
     band under the image up to @[560px] (besideMin), and in row view
     that band is ~205px — four metric chips already need ~170 of it,
     so the full chip (emoji + "Dp3G…yxKF") clipped its own address.
     Below @[560px] the chip renders compact: NO emoji, first 4 chars
     ("Dp3G…" — for unlabeled wallets displayName is the address, so
     the first-4 slice is exactly the address prefix the user needs to
     recognize). At/after @[560px] the full form swaps in. Static
     classes; the chip only renders on tracked cards, whose besideMin
     is always 560. */
  const compactName = name.length <= 6 ? name : `${name.slice(0, 4).trimEnd()}…`;
  return (
    <button
      type="button"
      className="inline-flex h-full shrink-0 items-center gap-[3px] cursor-pointer"
      title={`Deployed by tracked wallet ${name}`}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        openWalletProfile(creator);
      }}
    >
      {wallet.emoji ? (
        <span className={`${textCls} leading-none hidden @[560px]:inline`}>{wallet.emoji}</span>
      ) : null}
      <span
        className={`${textCls} h-full items-center flex @[560px]:hidden`}
        style={{ color: TINT_AGENT, fontWeight: 600, lineHeight: 1 }}
      >
        {compactName}
      </span>
      <span
        className={`${textCls} h-full items-center hidden @[560px]:flex`}
        style={{ color: TINT_AGENT, fontWeight: 600, lineHeight: 1 }}
      >
        {shortName}
      </span>
    </button>
  );
}
