import type { CSSProperties } from 'react';

// Slice "Cashback & Points": a small, self-contained stroke-icon set for the
// Rewards surface. Inline SVG (no icon-lib coupling) so the slice stays
// liftable and every glyph inherits `currentColor` + the active theme.

interface IconProps {
  readonly size?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly strokeWidth?: number;
}

function base(size: number, style?: CSSProperties): CSSProperties {
  return { width: size, height: size, display: 'block', flexShrink: 0, ...style };
}

function Svg({
  size = 16,
  className,
  style,
  strokeWidth = 1.75,
  children,
}: IconProps & { children: React.ReactNode }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={base(size, style)}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconLink(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M9 15l6-6" />
      <path d="M11 6l.5-.5a4 4 0 0 1 5.66 5.66l-2 2" />
      <path d="M13 18l-.5.5a4 4 0 0 1-5.66-5.66l2-2" />
    </Svg>
  );
}

export function IconCopy(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6a2.5 2.5 0 0 1 2.5-2.5H15" />
    </Svg>
  );
}

export function IconCheck(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Svg>
  );
}

export function IconUsers(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.9" />
      <path d="M17.5 13.5a5.5 5.5 0 0 1 3 5" />
    </Svg>
  );
}

export function IconTrophy(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4.5a2.5 2.5 0 0 0 3 2.4" />
      <path d="M17 6h2.5a2.5 2.5 0 0 1-3 2.4" />
      <path d="M12 13v3.5" />
      <path d="M8.5 20h7" />
      <path d="M10 16.5h4l-.5 3.5h-3z" />
    </Svg>
  );
}

export function IconStar(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.85L12 17.9l-5.25 2.75 1-5.85L3.5 9.66l5.9-.86z" />
    </Svg>
  );
}

export function IconSpark(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M12 8.5c.6 2 1.5 2.9 3.5 3.5-2 .6-2.9 1.5-3.5 3.5-.6-2-1.5-2.9-3.5-3.5 2-.6 2.9-1.5 3.5-3.5z" />
    </Svg>
  );
}

export function IconArrowUpRight(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </Svg>
  );
}

export function IconPercent(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M6 18L18 6" />
      <circle cx="7.5" cy="7.5" r="2.2" />
      <circle cx="16.5" cy="16.5" r="2.2" />
    </Svg>
  );
}

export function IconCoins(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <ellipse cx="9" cy="7" rx="5.5" ry="3" />
      <path d="M3.5 7v4c0 1.66 2.46 3 5.5 3" />
      <path d="M14.5 10.2c2.9.3 5 1.55 5 3.05 0 1.66-2.57 3-5.75 3.25" />
      <path d="M9.5 14v3c0 1.66 2.46 3 5.5 3s5.5-1.34 5.5-3v-4" />
    </Svg>
  );
}

export function IconGift(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <rect x="4" y="9" width="16" height="11" rx="1.5" />
      <path d="M4 13h16" />
      <path d="M12 9v11" />
      <path d="M12 9S10.5 4.5 8 5s-1 4 4 4z" />
      <path d="M12 9s1.5-4.5 4-4 1 4-4 4z" />
    </Svg>
  );
}

export function IconCrown(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M3.5 8.5l3.5 3 5-6 5 6 3.5-3-1.5 10h-14z" />
      <path d="M5.5 19.5h13" />
    </Svg>
  );
}

export function IconLock(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  );
}

export function IconBolt(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M13 3L5 13h5l-1 8 8-10h-5z" />
    </Svg>
  );
}

export function IconChevronRight(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

export function IconWallet(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <rect x="3.5" y="6" width="17" height="13" rx="2.5" />
      <path d="M3.5 9.5h13.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H17a2 2 0 0 1 0-4z" />
    </Svg>
  );
}

export function IconFlame(p: IconProps): React.ReactElement {
  return (
    <Svg {...p}>
      <path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c0-.5-.1-1-.3-1.4 2 1 3.3 3 3.3 5.4a5 5 0 0 1-10 0c0-3.5 3-5.5 5-11z" />
    </Svg>
  );
}
