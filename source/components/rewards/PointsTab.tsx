'use client';

import React, { useId, useState } from 'react';
import {
  useClaimAccolade,
  usePointsLeaderboard,
  usePointsMe,
  type Accolade,
} from '@/lib/api/cashback';
import {
  ClaimButton,
  Collage,
  CountUp,
  Empty,
  Eyebrow,
  GhostWord,
  Leaderboard,
  Panel,
  PartnerBadge,
  SECTION_COLORS,
  SectionTitle,
  Skeleton,
  fmtInt,
  tileStyle,
  type LeaderRow,
} from './primitives';
import { IconCheck, IconGift, IconLock, IconSpark, IconStar, IconTrophy } from './icons';
import { AccoladeMedal } from './AccoladeMedal';

// Slice "Cashback & Points": the Points sub-tab. Lifetime points hero, an
// interactive accolade grid (locked / claimable / claimed) with progress
// rings + a claim action, and a points leaderboard.

export function PointsTab(): React.ReactElement {
  const meQuery = usePointsMe();
  const leaderboardQuery = usePointsLeaderboard();

  const meResult = meQuery.data;
  const me = meResult?.kind === 'ok' ? meResult.data : null;
  const disabled = meResult?.kind === 'disabled';
  const leaderboard = leaderboardQuery.data?.kind === 'ok' ? leaderboardQuery.data.data : [];

  if (disabled) {
    return (
      <Panel>
        <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Points aren&apos;t live yet. Check back soon.</p>
      </Panel>
    );
  }
  if (meResult?.kind === 'reauth') {
    return <Panel><Empty text="Please sign in again to view points." /></Panel>;
  }
  if (meResult?.kind === 'error') {
    return <Panel><Empty text="Points are temporarily unavailable. Try again soon." /></Panel>;
  }
  if (meQuery.isLoading || !me) {
    return <Panel><Skeleton rows={4} /></Panel>;
  }

  const unlockedClaimable = me.accolades.filter((a) => a.status === 'unlocked').length;
  /*
   * Ten, and your own row if you are outside them.
   *
   * The endpoint returns fifty. A board that long stops being a board
   * and becomes a directory: nobody reads rank thirty eight, and the
   * only rows anybody looks for are the top of it and their own.
   *
   * So the tail is cut and YOUR row is put back if the cut removed it —
   * a top ten you are not in is a leaderboard with the one row you
   * came for missing.
   */
  const TOP_N = 10;
  const ranked = (() => {
    const top = leaderboard.slice(0, TOP_N);
    if (top.some((r) => r.isMe)) return top;
    const me = leaderboard.find((r) => r.isMe);
    return me ? [...top, me] : top;
  })();

  const leaderRows: ReadonlyArray<LeaderRow> = ranked.map((r) => ({
    rank: r.rank,
    label: r.label,
    value: fmtInt(r.lifetimePoints),
    isMe: r.isMe,
  }));

  /* Ready to claim, and everything else in the order you climb it:
     what is waiting, then what is close, then what is done. An
     accolade you have already collected is the least useful card on
     the page and it was sitting first. */
  const RANK: Record<string, number> = { unlocked: 0, locked: 1, claimed: 2 };
  const accolades = [...me.accolades].sort(
    (a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || b.progress - a.progress,
  );

  return (
    <div className="flex flex-col">
      {/*
       * ── THE FIGURES ──────────────────────────────────────────────
       *
       * It was a hero plate: `pts` in a tinted rounded badge, the
       * lifetime figure counting up in mono, two bordered tiles under
       * it and a pill announcing the claimable count in the section
       * hue.
       *
       * Points are not money and there is nothing to press, so the tab
       * does not need a hero — it needs the number and its two parts.
       * Same row the other two tabs use.
       */}
      <section className="rw-figs rw-rise rw-d0" style={{ marginTop: 4 }}>
        <span>
          <i>Lifetime points</i>
          <b>{fmtInt(me.points.lifetimePoints)}</b>
        </span>
        <span>
          <i>From trading</i>
          <b>{fmtInt(me.points.volumePoints)}</b>
        </span>
        <span>
          <i>From accolades</i>
          <b>{fmtInt(me.points.bonusPoints)}</b>
        </span>
        {unlockedClaimable > 0 ? (
          <span>
            <i>Ready to claim</i>
            <b>
              {unlockedClaimable} {unlockedClaimable === 1 ? 'accolade' : 'accolades'}
            </b>
          </span>
        ) : null}
      </section>

      <section className="rw-sec-wrap rw-rise rw-d1">
        <div className="rw-sec">
          Accolades
          <small>
            {me.accolades.filter((a) => a.status === 'claimed').length} of {me.accolades.length}{' '}
            collected
          </small>
        </div>
        {/* Struck in a metal set by what each one is worth. See
            `AccoladeMedal.tsx` for the thresholds. */}
        <div className="acm-grid">
          {accolades.map((a) => (
            <AccoladeMedal key={a.key} accolade={a} />
          ))}
        </div>
      </section>

      <section className="rw-sec-wrap rw-rise rw-d2">
        <div className="rw-sec">Points leaderboard</div>
        {leaderboardQuery.isLoading ? (
          <Skeleton rows={5} />
        ) : leaderRows.length === 0 ? (
          <Empty text="No ranked traders yet." />
        ) : (
          <div className="plb">
            {leaderRows.map((r) => (
              <div className="plb-r" key={`${r.rank}-${r.label}`} data-me={r.isMe ? '' : undefined}>
                <span className="plb-k">{String(r.rank).padStart(2, '0')}</span>
                <span className="plb-n">{r.label}</span>
                <span className="plb-v">{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ───────── Hero: lifetime points + breakdown + claimable badge ─────────

export function PointsHero({
  lifetime,
  fromTrading,
  fromAccolades,
  claimable,
  partnerActive,
}: {
  lifetime: number;
  fromTrading: number;
  fromAccolades: number;
  claimable: number;
  partnerActive: boolean;
}): React.ReactElement {
  const lens = SECTION_COLORS.points;
  return (
    <Panel className="relative overflow-hidden" style={{ padding: '20px 20px 18px' }}>
      <GhostWord color={lens} size={130} opacity={0.08} style={{ right: 140, bottom: -40 }}>
        pts
      </GhostWord>
      <Collage color={lens} soft="#f59e0b" style={{ top: -18, right: 24 }} />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(70% 130% at 0% 0%, color-mix(in srgb, ${lens} 10%, transparent), transparent 58%)`,
        }}
      />
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div>
          <Eyebrow
            color={lens}
            icon={<IconSpark size={14} />}
            after={partnerActive ? <PartnerBadge size="sm" /> : undefined}
          >
            Lifetime points
          </Eyebrow>
          <div className="mt-2.5 flex items-baseline gap-2.5">
            <CountUp
              value={lifetime}
              decimals={0}
              shine
              shineAccent
              style={{
                fontFamily: 'var(--mono)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 'clamp(40px, 5vw, 54px)',
                fontWeight: 600,
                lineHeight: 1,
                letterSpacing: '-0.03em',
              }}
            />
            <span
              style={{
                fontFamily: 'var(--display)',
                fontStyle: 'italic',
                fontSize: 20,
                color: lens,
              }}
            >
              pts
            </span>
          </div>

          <div className="mt-4 inline-flex items-stretch gap-0">
            <HeroCell label="From trading" value={fromTrading} tick="#38bdf8" />
            <span aria-hidden style={heroRuleStyle} />
            <HeroCell label="From accolades" value={fromAccolades} tone={lens} tick={lens} />
          </div>
        </div>

        <div className={claimable > 0 ? 'rw-lift rw-claim-live' : 'rw-lift'} style={claimBadgeStyle(claimable > 0)}>
          <span aria-hidden className="rw-etch" />
          <span className="relative" style={{ color: claimable > 0 ? lens : 'var(--ink-3)' }}>
            <IconGift size={18} />
          </span>
          <div className="relative flex flex-col">
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1.1,
                color: claimable > 0 ? lens : 'var(--ink-0)',
              }}
            >
              {claimable}
            </span>
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
              }}
            >
              claimable {claimable === 1 ? 'accolade' : 'accolades'}
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function HeroCell({
  label,
  value,
  tone = 'var(--ink-0)',
  tick,
}: {
  label: string;
  value: number;
  tone?: string;
  tick?: string;
}): React.ReactElement {
  return (
    <span className="flex flex-col gap-1" style={{ padding: '0 14px 0 0' }}>
      <span className="inline-flex items-center gap-1.5">
        {tick ? (
          <span
            aria-hidden
            style={{ width: 3, height: 9, borderRadius: 2, background: tick, flexShrink: 0 }}
          />
        ) : null}
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          {label}
        </span>
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums', fontSize: 16, fontWeight: 600, color: tone }}>
        <CountUp value={value} decimals={0} />
      </span>
    </span>
  );
}

const heroRuleStyle: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  margin: '2px 14px 2px 0',
  background: 'linear-gradient(180deg, transparent, var(--hairline-2), transparent)',
};

function claimBadgeStyle(live: boolean): React.CSSProperties {
  return {
    ...tileStyle(),
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    borderRadius: 14,
    borderColor: live ? 'color-mix(in srgb, var(--accent-primary) 32%, var(--hairline))' : undefined,
  };
}

// ───────── Accolade card (progress ring + status) ─────────

export function AccoladeCard({ accolade }: { accolade: Accolade }): React.ReactElement {
  const claim = useClaimAccolade();
  const [justClaimed, setJustClaimed] = useState(false);
  // Sanitize React's colon-bearing id so it's a valid SVG `url(#…)` target.
  const gid = `rw-ring-${useId().replace(/:/g, '')}`;
  const claimable = accolade.status === 'unlocked';
  const claimed = accolade.status === 'claimed' || justClaimed;
  const pct = Math.round(Math.min(Math.max(accolade.progress, 0), 1) * 100);

  const onClaim = () => {
    if (!claimable || claim.isPending) return;
    claim.mutate(accolade.key, {
      onSuccess: (res) => {
        if (res.kind === 'ok') setJustClaimed(true);
      },
    });
  };

  const ringColor = claimed ? 'var(--up)' : claimable ? `url(#${gid})` : 'color-mix(in srgb, var(--ink-2) 55%, transparent)';
  const ringPct = claimed || claimable ? 100 : pct;
  const glyphColor = claimed ? 'var(--up)' : claimable ? 'var(--accent-primary)' : 'var(--ink-3)';

  return (
    <div
      className="rw-lift relative flex flex-col items-center gap-2.5 overflow-hidden rounded-[14px] p-3.5 text-center"
      style={{
        ...tileStyle(),
        borderColor: claimable ? 'color-mix(in srgb, var(--accent-primary) 36%, var(--hairline))' : undefined,
        opacity: claimed || claimable ? 1 : 0.78,
      }}
    >
      <span aria-hidden className="rw-etch" />
      {/* Status strip: the accolade's state signs its top edge. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: 3,
          width: '58%',
          background: `linear-gradient(90deg, ${
            claimed
              ? 'color-mix(in srgb, var(--up) 70%, transparent)'
              : claimable
                ? `color-mix(in srgb, ${SECTION_COLORS.points} 75%, transparent)`
                : 'color-mix(in srgb, var(--ink-3) 35%, transparent)'
          }, transparent)`,
          pointerEvents: 'none',
        }}
      />
      <Ring size={58} stroke={3.5} pct={ringPct} color={ringColor} gradientId={gid} glow={claimable}>
        <span style={{ color: glyphColor }}>
          {claimed ? <IconCheck size={22} /> : claimable ? <IconStar size={22} /> : <IconLock size={19} />}
        </span>
      </Ring>

      <div className="relative flex flex-col items-center gap-0.5">
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-0)' }}>{accolade.name}</span>
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 10.5,
            fontWeight: 600,
            color: claimed ? 'var(--up)' : claimable ? 'var(--accent-primary)' : 'var(--ink-3)',
          }}
        >
          +{fmtInt(accolade.bonusPoints)} pts
        </span>
      </div>

      <p className="relative" style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--ink-3)' }}>{accolade.description}</p>

      <div className="relative mt-auto w-full pt-1">
        {claimed ? (
          <div className="rw-confirm flex items-center justify-center gap-1.5" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--up)' }}>
            <IconCheck size={14} /> Claimed
          </div>
        ) : claimable ? (
          <ClaimButton onClick={onClaim} pending={claim.isPending} height={30} full>
            {claim.isPending ? 'Claiming…' : 'Claim'}
          </ClaimButton>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', textAlign: 'center' }}>{pct}%</div>
        )}
      </div>
    </div>
  );
}

function Ring({
  size,
  stroke,
  pct,
  color,
  gradientId,
  glow,
  children,
}: {
  size: number;
  stroke: number;
  pct: number;
  color: string;
  gradientId: string;
  glow?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(pct, 0), 100);
  const offset = c * (1 - clamped / 100);
  return (
    <span style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {glow ? <span aria-hidden className="rw-ring-glow" /> : null}
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent-primary)" />
            <stop offset="100%" stopColor="var(--accent-secondary)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in srgb, var(--ink-3) 20%, transparent)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 900ms var(--ease-out, cubic-bezier(0.16,1,0.3,1))' }}
        />
      </svg>
      <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
    </span>
  );
}
