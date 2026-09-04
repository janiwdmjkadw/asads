'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useMarkNotificationsRead,
  useNotifications,
  type UserNotification,
} from '@/lib/api/notifications';
import './partner-welcome.css';

/* ============================================================================
   Slice "Partner Program": one-time gilded welcome moment.
   ============================================================================
   Watches the (already-polling, shared) notifications query for an unseen
   `partner_welcome` row and presents a full-screen owl-themed modal with the
   partner's cashback + referral cuts (read from the notification metadata
   written by the admin upsert). Shown exactly once per activation:
     - localStorage records the notification id (survives reloads/sessions);
     - dismissing also marks the inbox row read.
   The brand heart-owl glyph (public/assets/logo.svg) is re-cut in gold for
   the crest. The surrounding kaomoji flock is pure CSS — hover bubbles use
   :hover only (no JS handlers, no re-renders), all motion is
   transform/opacity, and the modal renders nothing at all until triggered.
   ========================================================================== */

const SEEN_STORAGE_KEY = 'partnerWelcome.seen.v1';

export function PartnerWelcomeModal(): React.ReactElement | null {
  const notificationsQuery = useNotifications();
  const markRead = useMarkNotificationsRead();
  const router = useRouter();
  const [active, setActive] = useState<UserNotification | null>(null);
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => readSeenIds());

  // Latch onto the first unseen partner_welcome notification. Once latched,
  // stay open until dismissed (poll refetches must not close/replace it).
  const candidate = useMemo(() => {
    const page =
      notificationsQuery.data?.kind === 'ok' ? notificationsQuery.data.data : null;
    if (!page) return null;
    return (
      page.notifications.find(
        (n) => n.kind === 'partner_welcome' && n.readAt === null && !dismissedIds.has(n.id),
      ) ?? null
    );
  }, [notificationsQuery.data, dismissedIds]);

  useEffect(() => {
    if (candidate && !active) setActive(candidate);
  }, [candidate, active]);

  const dismiss = useCallback(
    (destination?: string) => {
      if (!active) return;
      const next = new Set(dismissedIds);
      next.add(active.id);
      setDismissedIds(next);
      writeSeenIds(next);
      markRead.mutate([active.id]);
      setActive(null);
      if (destination) router.push(destination);
    },
    [active, dismissedIds, markRead, router],
  );

  // Escape to dismiss + scroll lock — only while open.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [active, dismiss]);

  if (!active) return null;

  const slug = str(active.metadata.slug) || 'partner';
  const cashbackBps = bps(active.metadata.cashback_share_bps);
  const referralBps = bps(active.metadata.referral_share_bps);

  return (
    <div
      className="pw-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to the partner program"
    >
      <div className="pw-scrim" onClick={() => dismiss()} />

      <div className="pw-stage">
        <OwlFlock slug={slug} />
        <PartnerWelcomeCard
          slug={slug}
          cashbackBps={cashbackBps}
          referralBps={referralBps}
          onView={() => dismiss('/rewards')}
          onLater={() => dismiss()}
        />
      </div>
    </div>
  );
}

/** The card itself — exported so the render harness can see it. */
export function PartnerWelcomeCard({
  slug,
  cashbackBps,
  referralBps,
  onView,
  onLater,
}: {
  slug: string;
  cashbackBps: number | null;
  referralBps: number | null;
  onView: () => void;
  onLater: () => void;
}): React.ReactElement {
  return (
        <section className="pw-card pw-card-enter" onClick={(e) => e.stopPropagation()}>
          {/* Edition band: the confetti hairline that signs every listen
              surface — here it crowns the partner's card. */}
          <span aria-hidden className="pw-edition" />
          {/* Gold collage bleeding off the top edge, one confetti fleck. */}
          <span aria-hidden className="pw-collage">
            <span className="pw-collage-a" />
            <span className="pw-collage-b" />
            <span className="pw-collage-c" />
          </span>
          {/* Ghost signature: the program's name, watermarked in gold. */}
          <span aria-hidden className="pw-ghost">
            partner
          </span>
          <GoldMosaic />
          {/* One-shot star glints popping during the entrance. */}
          <span aria-hidden className="pw-glint" style={{ top: 66, left: '18%', '--gd': '650ms' } as React.CSSProperties}>✦</span>
          <span aria-hidden className="pw-glint" style={{ top: 40, right: '22%', '--gd': '950ms' } as React.CSSProperties}>✦</span>
          <span aria-hidden className="pw-glint" style={{ top: 150, right: '13%', '--gd': '1250ms', fontSize: 10 } as React.CSSProperties}>✦</span>

          <div className="pw-crest" aria-hidden>
            <span className="pw-crest-halo" />
            <span className="pw-crest-ring" />
            <span className="pw-crest-owl">
              <GoldOwl size={104} />
            </span>
          </div>

          <p className="pw-kicker">
            <span aria-hidden className="pw-kicker-tick" />
            Partner Program
          </p>
          <h2 className="pw-title">
            Welcome, <span className="pw-slug">{slug}</span>.
          </h2>
          <p className="pw-copy">
            Thank you for joining the partner program. Your custom rates are{' '}
            <strong>live right now</strong>. Every trade you and your frens make starts earning at
            your new cut immediately.
          </p>

          <div className="pw-rates">
            <div className="pw-rate">
              <span aria-hidden className="pw-rate-strip" />
              <div className="pw-rate-label">
                <span aria-hidden className="pw-rate-tick" />
                Cashback cut
              </div>
              <div className="pw-rate-value">{formatPct(cashbackBps)}</div>
              <div className="pw-rate-sub">of the 1% fee, back on your own trades</div>
            </div>
            <div className="pw-rate">
              <span aria-hidden className="pw-rate-strip" />
              <div className="pw-rate-label">
                <span aria-hidden className="pw-rate-tick" />
                Referral cut
              </div>
              <div className="pw-rate-value">{formatPct(referralBps)}</div>
              <div className="pw-rate-sub">of the 1% fee, from every fren&apos;s trade</div>
            </div>
          </div>

          <div className="pw-actions">
            <button type="button" className="pw-cta" onClick={onView}>
              View my rewards →
            </button>
            <button type="button" className="pw-later" onClick={onLater}>
              Later
            </button>
          </div>

          {/* The plate mark: how a listen print signs off. */}
          <div aria-hidden className="pw-plate">
            <span className="pw-plate-rule" />
            {['#ffd700', '#f4b942', '#f052d2', '#38bdf8'].map((c) => (
              <span key={c} className="pw-plate-tick" style={{ background: c }} />
            ))}
            <span className="pw-plate-rule pw-plate-rule-r" />
          </div>
          <div aria-hidden className="pw-plate-line">A LISTEN ORIGINAL · MMXXVI</div>
        </section>
  );
}

/* ── Kaomoji owl flock ──────────────────────────────────────────────────
   Static config: positions are percentages of the stage, sizes/delays vary
   so the flock never bobs in lockstep. Bubbles render up or down based on
   vertical position; edge owls hide on mobile. Pure CSS hover — React
   renders this subtree exactly once.

   Each owl carries its own CONFETTI color (the frens identity system) —
   the flock IS the frens, come to greet the new partner in their own
   colors around the gold card. */

interface FlockOwl {
  face: string;
  message: (slug: string) => string;
  /** The owl's confetti identity — face glow, bubble border, all of it. */
  tint: string;
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  size: number;
  floatDur: number;
  inDelay: number;
  floatDelay: number;
  bubbleBelow?: boolean;
  desktopOnly?: boolean;
}

const FLOCK: ReadonlyArray<FlockOwl> = [
  { face: '(◉Θ◉)',   tint: '#37d67a', message: (s) => `welcome, ${s}!`,            top: '-2%',  left: '6%',   size: 20, floatDur: 3.8, inDelay: 250,  floatDelay: 0 },
  { face: '{O,o}',    tint: '#38bdf8', message: (s) => `congrats ${s}!!`,           top: '-4%',  right: '8%',  size: 18, floatDur: 4.4, inDelay: 350,  floatDelay: 600 },
  { face: '(•Θ•)♡',  tint: '#f052d2', message: () => 'hoot hoot! a new partner!',  bottom: '0%', left: '4%',   size: 18, floatDur: 4.1, inDelay: 450,  floatDelay: 300, bubbleBelow: true },
  { face: '(ʘ▽ʘ)',   tint: '#fbbf24', message: (s) => `${s} made it!`,             bottom: '-2%', right: '5%', size: 20, floatDur: 3.6, inDelay: 550,  floatDelay: 900, bubbleBelow: true },
  { face: '(¬Θ¬ )',   tint: '#22d3ee', message: () => 'owl be watching your volume', top: '32%', left: '-4%',  size: 16, floatDur: 4.8, inDelay: 650,  floatDelay: 1200, desktopOnly: true },
  { face: '( ^Θ^)',   tint: '#8b5cf6', message: () => 'the flock salutes you',      top: '30%',  right: '-5%', size: 16, floatDur: 4.2, inDelay: 750,  floatDelay: 450, desktopOnly: true },
  { face: '◖(◉ω◉)◗', tint: '#7ce85e', message: () => 'gm partner',                 top: '64%',  left: '-6%',  size: 15, floatDur: 3.9, inDelay: 850,  floatDelay: 800, bubbleBelow: true, desktopOnly: true },
  { face: '(◕Θ◕)つ', tint: '#3b82f6', message: (s) => `so proud of you, ${s}`,     top: '66%',  right: '-7%', size: 15, floatDur: 4.6, inDelay: 950,  floatDelay: 150, bubbleBelow: true, desktopOnly: true },
];

export function OwlFlock({ slug }: { slug: string }): React.ReactElement {
  return (
    <div className="pw-flock" aria-hidden>
      {FLOCK.map((owl, i) => (
        <span
          key={i}
          className="pw-owl"
          data-bubble={owl.bubbleBelow ? 'below' : 'above'}
          data-desktop-only={owl.desktopOnly ? 'true' : undefined}
          style={
            {
              top: owl.top,
              bottom: owl.bottom,
              left: owl.left,
              right: owl.right,
              '--owl-size': `${owl.size}px`,
              '--owl-tint': owl.tint,
              '--float-dur': `${owl.floatDur}s`,
              '--in-delay': `${owl.inDelay}ms`,
              '--float-delay': `${owl.floatDelay}ms`,
            } as React.CSSProperties
          }
        >
          <span className="pw-owl-float">
            <span className="pw-owl-face">{owl.face}</span>
          </span>
          <span className="pw-bubble">{owl.message(slug)}</span>
        </span>
      ))}
    </div>
  );
}

/* ── Gold mosaic ────────────────────────────────────────────────────────
   The frens pixel mosaic, re-cut in partner gold with two confetti
   flecks. Assembles once on open with the same scatter physics as the
   frens masthead — deterministic vectors, spring, landing flash. */

const GOLD_PIXELS: ReadonlyArray<[number, number, string]> = [
  [0, 1, '#ffe48a'],
  [0, 2, '#ffd700'],
  [0, 5, '#f4b942'],
  [0, 6, '#e8a93a'],
  [1, 0, '#e8a93a'],
  [1, 2, '#fbbf24'],
  [1, 4, '#ffd700'],
  [1, 6, '#f052d2'],
  [2, 1, '#ffd700'],
  [2, 3, '#f4b942'],
  [2, 5, '#38bdf8'],
  [2, 6, '#ffe48a'],
  [3, 0, '#37d67a'],
  [3, 4, '#ffe48a'],
];

function GoldMosaic(): React.ReactElement {
  const cell = 11;
  return (
    <span
      aria-hidden
      className="pw-mosaic"
      style={{ width: 7 * (cell + 3), height: 4 * (cell + 3) }}
    >
      {GOLD_PIXELS.map(([r, c, color], index) => {
        const dx = ((index * 89 + 41) % 200) - 100;
        const dy = ((index * 67 + 13) % 160) - 80;
        const dr = ((index * 53 + 29) % 140) - 70;
        const delay = 450 + ((index * 83) % 800);
        const dur = 1400 + ((index * 59) % 600);
        return (
          <span
            key={index}
            className="pw-pixel"
            style={
              {
                top: r * (cell + 3),
                left: c * (cell + 3),
                width: cell,
                height: cell,
                background: color,
                color,
                '--dx': `${dx}px`,
                '--dy': `${dy}px`,
                '--dr': `${dr}deg`,
                '--fdel': `${delay}ms`,
                '--fd': `${dur}ms`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

/* ── Gold owl crest ─────────────────────────────────────────────────────
   The brand heart-owl glyph (public/assets/logo.svg paths verbatim),
   re-cut from its red/orange palette into gilded partner gold. */

function GoldOwl({ size }: { size: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none" aria-hidden>
      <path
        d="M317.5 452C307.5 403.2 329.333 376 341.5 368.5C381.5 362.5 423.667 432.833 438 469.5C439.2 518.7 395.667 523.167 374.5 518.5C339.3 513.7 321.833 472.167 317.5 452Z"
        fill="url(#pwOwlEyeL)"
      />
      <path
        d="M699.5 466C715.9 405.2 694.333 375.333 681.5 368C652.7 361.6 618.167 407.667 604.5 431.5C565.3 486.3 593.167 511 612 516.5C664.8 531.3 692.333 489 699.5 466Z"
        fill="url(#pwOwlEyeR)"
      />
      <path
        d="M541.5 585C535.9 589.4 512 748.5 512 748.5C488.4 596.5 450.833 484.167 435 447C400.2 377 299.167 300.167 253 270.5C329.4 290.1 380.5 332 396.5 350.5C420.9 375.3 445.667 404.833 455 416.5C477.4 454.1 502.333 513.5 512 538.5C516.4 516.9 546.833 458.167 561.5 431.5C605.5 374.5 602.5 373.5 655 332C697 298.8 745.167 290.833 764 291C728 301.5 716.5 320.5 712.5 319.5C708.5 318.5 654 355.5 620.5 399C587 442.5 590 444.5 568 493.5C546 542.5 548.5 579.5 541.5 585Z"
        fill="url(#pwOwlBeak)"
      />
      <path
        d="M562 880L573.5 935.5L297 710C138.6 585.6 132 422.167 148.5 356C206.1 124.4 429.833 79.8333 534.5 86.4999C710.9 105.7 801 214.167 824 266C699.6 82.8 491.167 108 402.5 143.5C189.3 219.5 180.333 399.167 202.5 479.5C246.5 622.7 429.167 757.167 515 806.5L645 710C756.6 624.8 802.833 520.833 812 479.5C854.4 283.1 753.667 264.333 698 279.5C843.2 205.1 882.833 362.5 884.5 450.5C880.1 590.9 695.333 758.333 603.5 824.5C565.9 847.7 560.167 871.167 562 880Z"
        fill="url(#pwOwlBody)"
      />
      <defs>
        <linearGradient id="pwOwlEyeL" x1="376.488" y1="368.139" x2="376.488" y2="519.927" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFF3C4" />
          <stop offset="0.45" stopColor="#FFD700" />
          <stop offset="1" stopColor="#E8A93A" />
        </linearGradient>
        <linearGradient id="pwOwlEyeR" x1="671.589" y1="347" x2="671.589" y2="519.57" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E8A93A" />
          <stop offset="1" stopColor="#FFE48A" />
        </linearGradient>
        <linearGradient id="pwOwlBeak" x1="508.5" y1="270.5" x2="508.5" y2="748.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFE48A" />
          <stop offset="0.45" stopColor="#FFC83D" />
          <stop offset="1" stopColor="#B8842C" />
        </linearGradient>
        <linearGradient id="pwOwlBody" x1="513.417" y1="85.8826" x2="513.417" y2="935.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFF6D8" />
          <stop offset="0.18" stopColor="#FFE48A" />
          <stop offset="0.35" stopColor="#FFD700" />
          <stop offset="0.52" stopColor="#F4B942" />
          <stop offset="0.7" stopColor="#FFC83D" />
          <stop offset="0.85" stopColor="#D99B33" />
          <stop offset="1" stopColor="#B8842C" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── helpers ────────────────────────────────────────────────────────── */

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Metadata bps → number, or null when absent/garbled (older rows). */
function bps(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000 ? v : null;
}

function formatPct(value: number | null): string {
  if (value === null) return '-';
  const pct = value / 100;
  return `${pct % 1 === 0 ? pct : pct.toFixed(2)}%`;
}

function readSeenIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function writeSeenIds(ids: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Array.from(ids).slice(-20)));
  } catch {
    // localStorage is replay prevention only; mark-read is the durable signal.
  }
}
