'use client';

import type { ReactNode } from 'react';
import './accolade-variants.css';

/*
 * ── POINTS · ACCOLADES, FIVE WAYS ────────────────────────────────────
 *
 * ── A REGRESSION TO FIX WHILE WE ARE HERE ────────────────────────────
 *
 * The row that shipped says `Ready` and gives you nothing to press.
 * The old card carried a Claim button wired to `useClaimAccolade`, and
 * when I replaced the grid with rows I kept the STATE and dropped the
 * ACTION — so two accolades sit there announcing they are collectable
 * and cannot be collected.
 *
 * Every variant below has a real claim on it. That is not a design
 * choice between them, it is the thing the section is for.
 *
 * ── WHAT THE DATA IS ─────────────────────────────────────────────────
 *
 * Six accolades in three states. `claimed` is done. `unlocked` means
 * the condition is met and the points are waiting. `locked` carries a
 * progress fraction toward the condition.
 *
 * The interesting shape is that the states are NOT evenly split and
 * never will be: early on almost everything is locked, later almost
 * everything is claimed, and `unlocked` is a small set that appears and
 * empties. A layout that treats the three equally is wrong at both
 * ends of an account's life.
 *
 *   1  Rows       what ships, with the claim put back
 *   2  Grouped    ready, in progress, and done, as three sections
 *   3  Cards      a grid; progress drawn as a ring on each
 *   4  Checklist  the tightest; a mark, a name, a number
 *   5  Medals     each one an owl, struck when earned
 */

interface Acc {
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  readonly pts: number;
  readonly state: 'claimed' | 'unlocked' | 'locked';
  readonly progress: number;
}

const ACC: ReadonlyArray<Acc> = [
  { key: 'hundred_trades', name: 'Regular', desc: 'Place a hundred trades', pts: 1000, state: 'unlocked', progress: 1 },
  { key: 'first_conditional', name: 'Set And Forget', desc: 'Arm your first conditional', pts: 500, state: 'unlocked', progress: 1 },
  { key: 'fren_five', name: 'Five Frens', desc: 'Bring five frens', pts: 750, state: 'locked', progress: 0.6 },
  { key: 'volume_10k', name: 'Ten Thousand', desc: 'Trade 10,000 SOL of volume', pts: 2500, state: 'locked', progress: 0.128 },
  { key: 'first_trade', name: 'First Trade', desc: 'Place your first trade', pts: 100, state: 'claimed', progress: 1 },
  { key: 'ten_trades', name: 'Getting Warm', desc: 'Place ten trades', pts: 250, state: 'claimed', progress: 1 },
];

const READY = ACC.filter((a) => a.state === 'unlocked');
const DOING = ACC.filter((a) => a.state === 'locked');
const DONE = ACC.filter((a) => a.state === 'claimed');

const n = (v: number) => v.toLocaleString();
const pctOf = (a: Acc) => Math.round(a.progress * 100);

function Slot({ i, name, note, children }: { i: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="av-slot">
      <div className="av-cap">
        <b>
          {i}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="av-frame">{children}</div>
    </div>
  );
}

/* ── 1 ── ROWS ────────────────────────────────────────────────────────
 * What ships, with the claim put back. Ready first, then close, then
 * collected; progress fills the row behind the type. */
function Rows() {
  return (
    <div className="av-rows">
      {ACC.map((a) => (
        <div
          key={a.key}
          className="av-row"
          data-ready={a.state === 'unlocked' ? '' : undefined}
          data-done={a.state === 'claimed' ? '' : undefined}
        >
          {a.state === 'locked' ? (
            <span className="av-fill" aria-hidden style={{ width: `${pctOf(a)}%` }} />
          ) : null}
          <span className="av-n">{a.name}</span>
          <span className="av-d">{a.desc}</span>
          <span className="av-p">+{n(a.pts)}</span>
          <span className="av-s">
            {a.state === 'unlocked' ? (
              <button type="button" className="av-go">
                Claim
              </button>
            ) : a.state === 'claimed' ? (
              'Collected'
            ) : (
              `${pctOf(a)}%`
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── 2 ── GROUPED ─────────────────────────────────────────────────────
 * Three sections rather than one sorted list. The states are never
 * evenly split — early on everything is locked, later everything is
 * claimed — and a heading makes the empty case say something instead
 * of the list silently getting shorter.
 *
 * Collected collapses to a single line, because a done accolade is a
 * fact you want counted, not read. */
function Grouped() {
  return (
    <div className="av-grp">
      <div className="av-grp-h">
        Ready to claim<small>{READY.length}</small>
      </div>
      <div className="av-rows">
        {READY.map((a) => (
          <div key={a.key} className="av-row" data-ready>
            <span className="av-n">{a.name}</span>
            <span className="av-d">{a.desc}</span>
            <span className="av-p">+{n(a.pts)}</span>
            <span className="av-s">
              <button type="button" className="av-go">
                Claim
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="av-grp-h">In progress</div>
      <div className="av-rows">
        {DOING.map((a) => (
          <div key={a.key} className="av-row">
            <span className="av-fill" aria-hidden style={{ width: `${pctOf(a)}%` }} />
            <span className="av-n">{a.name}</span>
            <span className="av-d">{a.desc}</span>
            <span className="av-p">+{n(a.pts)}</span>
            <span className="av-s">{pctOf(a)}%</span>
          </div>
        ))}
      </div>

      <div className="av-collected">
        {DONE.length} collected
        <em>
          {DONE.map((a) => a.name).join(', ')}
        </em>
      </div>
    </div>
  );
}

/* ── 3 ── CARDS ───────────────────────────────────────────────────────
 * A grid, with progress as a ring rather than a bar. The one case this
 * wins: at twenty accolades a list is a scroll and a grid is a screen.
 * The cost is that every tile weighs the same, which is exactly the
 * thing rows were chosen to avoid. */
function Cards() {
  return (
    <div className="av-cards">
      {ACC.map((a) => (
        <div
          key={a.key}
          className="av-card"
          data-ready={a.state === 'unlocked' ? '' : undefined}
          data-done={a.state === 'claimed' ? '' : undefined}
        >
          <Ring pct={a.state === 'locked' ? a.progress : 1} muted={a.state === 'claimed'} />
          <span className="av-n">{a.name}</span>
          <span className="av-d">{a.desc}</span>
          <span className="av-card-f">
            <span className="av-p">+{n(a.pts)}</span>
            {a.state === 'unlocked' ? (
              <button type="button" className="av-go">
                Claim
              </button>
            ) : (
              <span className="av-s">{a.state === 'claimed' ? 'Collected' : `${pctOf(a)}%`}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function Ring({ pct, muted }: { pct: number; muted?: boolean }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <svg width={32} height={32} viewBox="0 0 32 32" aria-hidden className="av-ring">
      <circle cx="16" cy="16" r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="2.5" />
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        stroke={muted ? 'rgba(255,255,255,0.22)' : '#fff'}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 16 16)"
      />
    </svg>
  );
}

/* ── 4 ── CHECKLIST ───────────────────────────────────────────────────
 * The tightest of the five. A mark, a name, a number, and the claim
 * only where there is one. Reads like a to-do list, which is what an
 * accolade list actually is — and it fits twenty in the height the
 * cards fit six. */
function Checklist() {
  return (
    <div className="av-check">
      {ACC.map((a) => (
        <div
          key={a.key}
          className="av-check-r"
          data-ready={a.state === 'unlocked' ? '' : undefined}
          data-done={a.state === 'claimed' ? '' : undefined}
        >
          <span className="av-box" aria-hidden>
            {a.state === 'claimed' ? (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 6.5 5 9l4.5-5.5" />
              </svg>
            ) : a.state === 'locked' ? (
              <i style={{ height: `${pctOf(a)}%` }} />
            ) : null}
          </span>
          <span className="av-n">{a.name}</span>
          <span className="av-p">+{n(a.pts)}</span>
          <span className="av-s">
            {a.state === 'unlocked' ? (
              <button type="button" className="av-go">
                Claim
              </button>
            ) : a.state === 'locked' ? (
              `${pctOf(a)}%`
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── 5 ── MEDALS ──────────────────────────────────────────────────────
 * Each accolade is an owl, struck when you earn it. Ties the section to
 * the cashback roost, where the same mark carries rank.
 *
 * The risk is real and worth seeing rather than arguing: the owl means
 * TIER two tabs over, and reusing it for accolades may make both
 * weaker. */
const GOLD = 'linear-gradient(145deg, #7a5408 0%, #d3a72c 30%, #f7dd8a 46%, #c09220 66%, #6b4806 100%)';
const STEEL = 'linear-gradient(145deg, #3f454b 0%, #7d858d 34%, #aab2ba 48%, #6c747c 64%, #383d43 100%)';

function Medals() {
  return (
    <div className="av-medals">
      {ACC.map((a) => (
        <div
          key={a.key}
          className="av-medal"
          data-ready={a.state === 'unlocked' ? '' : undefined}
        >
          <span
            className="av-owl"
            aria-hidden
            style={{
              background: a.state === 'claimed' ? GOLD : STEEL,
              opacity: a.state === 'locked' ? 0.22 : 1,
            }}
          />
          <span className="av-n">{a.name}</span>
          <span className="av-p">+{n(a.pts)}</span>
          {a.state === 'unlocked' ? (
            <button type="button" className="av-go">
              Claim
            </button>
          ) : (
            <span className="av-s">{a.state === 'claimed' ? 'Collected' : `${pctOf(a)}%`}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function AccoladeVariants() {
  return (
    <div className="av">
      <h2>POINTS · ACCOLADES, FIVE WAYS</h2>
      <p className="av-note">
        First, a fix that is in all five: the row that shipped says Ready and gives you nothing to
        press. The old card had a Claim wired to `useClaimAccolade` and I kept the state while
        dropping the action, so two accolades are announcing they are collectable and cannot be
        collected.
      </p>
      <p className="av-note">
        The shape worth designing around is that the three states are never evenly split. Early on
        almost everything is locked; later almost everything is claimed; and ready is a small set
        that appears and empties. A layout that treats the three equally is wrong at both ends of an
        account's life.
      </p>

      <div className="av-stack">
        <Slot i={1} name="Rows" note="what ships, with the claim put back">
          <Rows />
        </Slot>
        <Slot i={2} name="Grouped" note="ready, in progress and done, as three sections">
          <Grouped />
        </Slot>
        <Slot i={3} name="Cards" note="a grid; progress as a ring on each">
          <Cards />
        </Slot>
        <Slot i={4} name="Checklist" note="the tightest; a mark, a name, a number">
          <Checklist />
        </Slot>
        <Slot i={5} name="Medals" note="each one an owl, struck when earned">
          <Medals />
        </Slot>
      </div>
    </div>
  );
}
