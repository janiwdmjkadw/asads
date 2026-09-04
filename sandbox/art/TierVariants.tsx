'use client';

import type { ReactNode } from 'react';
import './tier-variants.css';

/*
 * ── CASHBACK · THE PROGRESS, FIVE WAYS ───────────────────────────────
 *
 * The roost is settled and the metals are settled. The open question is
 * how far through the band you are, and the segmented rail under the
 * owls is not landing.
 *
 * Worth naming what that rail was solving, because whatever replaces it
 * has the same problem to solve: the bands are 250, 750, 1,500 and
 * 7,500 SOL wide. Any single bar scaled across the whole ladder puts
 * four of the five tiers inside its first quarter, so somebody most of
 * the way through silver sees a bar at 13% and reads it as barely
 * started. Progress has to be measured against the BAND you are in, not
 * against the ladder.
 *
 *   1  Segmented   what is there now, for comparison
 *   2  Span        one bar, only between the two owls it concerns
 *   3  Next        the owl AHEAD fills as you approach it
 *   4  Ring        an arc around the owl you are standing on
 *   5  None        no bar; the sentence already says the number
 */

interface Tier {
  readonly key: string;
  readonly pct: number;
  readonly ramp: string;
}

const TIERS: ReadonlyArray<Tier> = [
  { key: 'Base', pct: 10, ramp: 'linear-gradient(145deg, #3f454b 0%, #7d858d 34%, #aab2ba 48%, #6c747c 64%, #383d43 100%)' },
  { key: 'Bronze', pct: 18, ramp: 'linear-gradient(145deg, #5e3115 0%, #a9642f 32%, #e0a066 47%, #96552a 66%, #4d2711 100%)' },
  { key: 'Silver', pct: 25, ramp: 'linear-gradient(145deg, #6c737c 0%, #c2c9d1 30%, #f4f7fa 46%, #a8b0b9 66%, #5f666e 100%)' },
  { key: 'Gold', pct: 40, ramp: 'linear-gradient(145deg, #7a5408 0%, #d3a72c 30%, #f7dd8a 46%, #c09220 66%, #6b4806 100%)' },
  { key: 'Platinum', pct: 60, ramp: 'linear-gradient(145deg, #3d6d96 0%, #8ec6e8 27%, #e8f7ff 45%, #6fa9d2 68%, #315a80 100%)' },
];

const AT = 2;
const BAND = 0.19; // 1,284.6 of the way from 1,000 to 2,500
const REMAINING = '1,215.4';

/**
 * One owl.
 *
 * The PARENT carries the logo mask; the two children are plain metal
 * layers inside it. The fill layer is clipped from the top with
 * `clip-path`, so the metal appears to rise from the foot of the mark.
 *
 * Two masks cannot simply be stacked — a `mask-image` on the child
 * replaces the parent's rather than compositing with it — so the shape
 * is done once, on the box, and the level is done with a clip.
 */
function Owl({ size, ramp, fill = 1, rest = 0.26 }: { size: number; ramp: string; fill?: number; rest?: number }) {
  const cut = `${Math.round((1 - fill) * 100)}%`;
  return (
    <span className="tv-owl" aria-hidden style={{ width: size, height: size }}>
      {/* Held back, so a barely filled owl still reads as the owl. */}
      <i style={{ background: ramp, opacity: rest }} />
      {fill > 0 ? <i style={{ background: ramp, clipPath: `inset(${cut} 0 0 0)` }} /> : null}
    </span>
  );
}

function Roost({ mode }: { mode: 'plain' | 'next' | 'ring' }) {
  return (
    <div className="tv-roost">
      {TIERS.map((t, i) => {
        const ahead = i > AT;
        const isNext = i === AT + 1;
        /* Only in `next` mode does the rung ahead of you carry a fill.
           Everything further out stays a ghost. */
        const fill = mode === 'next' && isNext ? BAND : ahead ? 0 : 1;
        const rest = ahead ? 0.26 : 1;
        return (
          <div key={t.key} className="tv-roost-c" data-on={i === AT ? '' : undefined}>
            {mode === 'ring' && i === AT ? (
              <span className="tv-arc">
                <Arc pct={BAND} />
                <span className="tv-arc-in">
                  <Owl size={46} ramp={t.ramp} />
                </span>
              </span>
            ) : (
              <Owl size={i === AT ? 60 : 46} ramp={t.ramp} fill={fill} rest={rest} />
            )}
            <span className="tv-roost-k">{t.key}</span>
            <span className="tv-roost-p">{t.pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function Arc({ pct }: { pct: number }) {
  const r = 33;
  const c = 2 * Math.PI * r;
  return (
    <svg width={76} height={76} viewBox="0 0 76 76" aria-hidden style={{ display: 'block' }}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="2.5" />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 38 38)"
      />
    </svg>
  );
}

function Say() {
  return (
    <p className="tv-say">
      <b>{REMAINING} SOL</b> of volume to Gold, which pays 40% back.
    </p>
  );
}

function Slot({ tag, name, note, children }: { tag: string; name: string; note: string; children: ReactNode }) {
  return (
    <div className="tv-slot">
      <div className="tv-cap">
        <b>
          {tag} {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="tv-frame">{children}</div>
    </div>
  );
}

export function TierVariants() {
  return (
    <div className="tv">
      <h2>CASHBACK · THE PROGRESS, FIVE WAYS</h2>
      <p className="tv-note">
        The roost and the metals are settled; only the progress is open. Whatever replaces the rail
        has the same constraint: the bands are 250, 750, 1,500 and 7,500 SOL wide, so any single bar
        scaled across the whole ladder puts four of the five tiers in its first quarter, and
        somebody most of the way through silver sees 13% and reads it as barely started. Progress is
        measured against the band, never the ladder. All five below say the same 19%.
      </p>

      <div className="tv-stack">
        <Slot tag="1." name="Segmented" note="what is there now, for comparison">
          <Roost mode="plain" />
          <div className="tv-rail4">
            {[1, 1, BAND, 0].map((f, i) => (
              <span key={i} data-done={i < AT ? '' : undefined}>
                <i style={{ width: `${f * 100}%` }} />
              </span>
            ))}
          </div>
          <Say />
        </Slot>

        {/* One bar, spanning only the two owls it is about. The other
            three gaps were drawing segments to say `done` and `not
            started`, which the metals and the ghosting already say. */}
        <Slot tag="2." name="Span" note="one bar, only between the two owls it concerns">
          <Roost mode="plain" />
          <div className="tv-span">
            <span className="tv-span-b">
              <i style={{ width: `${BAND * 100}%` }} />
            </span>
          </div>
          <Say />
        </Slot>

        {/* No bar at all: the LADDER is the meter. The rung ahead fills
            with its own metal as you approach it, so the thing you are
            working toward is the thing that moves. */}
        <Slot tag="3." name="Next" note="the owl ahead fills as you approach it">
          <Roost mode="next" />
          <Say />
        </Slot>

        {/* An arc around the owl you are on. Keeps the progress on the
            mark itself, and never draws a line across the section. */}
        <Slot tag="4." name="Ring" note="an arc around the owl you are standing on">
          <Roost mode="ring" />
          <Say />
        </Slot>

        {/* The sentence under the roost already carries the only number
            anybody acts on. A bar is a second, vaguer copy of it. */}
        <Slot tag="5." name="None" note="no bar; the sentence already says the number">
          <Roost mode="plain" />
          <Say />
        </Slot>
      </div>
    </div>
  );
}
